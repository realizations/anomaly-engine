/**
 * Secret scan: prove nothing credential-shaped is committed.
 *
 * `.gitignore` stops `git add -A` from sweeping up a `.env`, but it does nothing
 * about a key pasted into a source file, a fixture, a doc or a commit message,
 * and nothing at all about a key committed before the ignore rule existed. By
 * then the only thing that helps is knowing, which is what this gate is for: it
 * reads the files git would publish and fails if any of them carry material that
 * looks like a credential.
 *
 * Run:  node tools/secret-scan.mjs             scan every tracked file
 *       node tools/secret-scan.mjs --selftest  prove the scan catches planted keys
 *       node tools/secret-scan.mjs --json      machine-readable output for CI
 *
 * Exits non-zero on a finding, so it can gate CI and pre-release builds. It is
 * wired into tools/verify.mjs alongside the licence gate.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECRET_KEYS, registryProblems, isCredentialShaped } from './secret-keys.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * Patterns that mean "this is a live credential", not "this is a word".
 *
 * Every provider prefix here is a fixed-width, publicly documented format, so a
 * match cannot be a coincidence of English. The generic rule at the end is the
 * only heuristic, and it is deliberately narrow: a credential-shaped name, an
 * assignment, and a quoted literal of at least sixteen characters. Anything
 * looser fires on half the codebase and gets disabled within a week.
 */
export const PATTERNS = [
  { id: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, why: 'PEM private key block' },
  { id: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/g, why: 'AWS access key id' },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, why: 'GitHub token' },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, why: 'Slack token' },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, why: 'OpenAI-style secret key' },
  { id: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, why: 'Google API key' },
  { id: 'sendgrid-key', re: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, why: 'SendGrid key' },
  { id: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, why: 'JSON web token' },
  {
    id: 'generic-literal',
    re: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|credential)\b\s*[:=]\s*['"]([^'"\n]{16,})['"]/gi,
    why: 'long literal assigned to a credential-shaped name',
    capture: true,
  },
];

/**
 * The characters a mangled UTF-8 continuation byte can become.
 *
 * When UTF-8 is decoded as Windows-1252 -- which is what "the file was opened in the
 * wrong editor" means in practice -- the continuation bytes 0x80..0x9F map to
 * printable characters rather than to C1 controls. 0x80 is the euro sign, which is
 * why the corruption in this repository reads as `â€”` (U+00E2 U+20AC U+201D) and not
 * as `â` followed by two unprintables.
 *
 * Both readings are listed because both occur: a file read as ISO-8859-1 yields the
 * raw continuation range, and one read as CP1252 yields this set.
 */
const CONTINUATION = [
  '\\u0080-\\u00bf',
  '\\u20ac\\u201a\\u0192\\u201e\\u2026\\u2020\\u2021\\u02c6\\u2030\\u0160\\u2039\\u0152\\u017d',
  '\\u2018\\u2019\\u201c\\u201d\\u2022\\u2013\\u2014\\u02dc\\u2122\\u0161\\u203a\\u0153\\u017e\\u0178',
].join('');

/**
 * Text that is UTF-8 that was read as Latin-1 and written back out.
 *
 * Not a security rule, and it earns its place here for the same reason every other
 * rule in this file does: nothing else in the project can see it. A mangled string is
 * a perfectly valid JavaScript string, so the compiler is silent, the renderer draws
 * it, and the tests pass. This one had already reached the player -- the field-notes
 * overlay showed `Â·` in three places, in the panel the README calls the ARG surface.
 *
 * The signature is a UTF-8 lead byte (U+00C2..U+00EF) immediately followed by one of
 * the characters above. Real text does not do this: a lead-byte range character is
 * always an accented letter or a punctuation mark in the Latin-1 supplement, and none
 * of them is ever followed by a lone continuation character. A rule that flagged
 * non-ASCII generally would fire on every em dash and every accented word in the
 * repository and be switched off within a day, so the pair is what gets matched.
 *
 * U+FFFD is the decoder giving up outright, and is included because it is
 * unambiguous: a replacement character in a source file means the bytes are already
 * gone, and the fix has to start from whatever the correct text was.
 */
export const MOJIBAKE_PATTERNS = [
  {
    id: 'mojibake',
    re: new RegExp(`[\\u00c2-\\u00ef][${CONTINUATION}]|\\ufffd`, 'g'),
    why: 'text that was UTF-8 read as Latin-1',
  },
];

/**
 * Values that are obviously not a credential.
 *
 * A template that says `<your key>` must not fail the scan, or the scan trains
 * people to stop reading it. Length does most of the work: no provider issues a
 * key shorter than sixteen characters, and almost every placeholder is one.
 */
const PLACEHOLDER = /^(?:<.*>|your.*|change.?me|placeholder|redacted|dummy|sample|example|xxx+|\*{3,}|\.\.\.|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?)$/i;

export function isPlaceholder(value) {
  const s = String(value ?? '').trim();
  if (s.length < 16) return true;
  if (PLACEHOLDER.test(s)) return true;
  if (s.startsWith('#')) return true;
  return false;
}

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/**
 * Pulls the value out of whatever followed the `=`.
 *
 * The registry rule runs over source code as well as dotenv files, and in source
 * the text after `=` is an expression, not a credential: `const K = "abc";` yields
 * `"abc";` and `K = someFn()` yields `someFn()`. Taking the rest of the line
 * verbatim would flag every statement that mentions a registered name, so the
 * delimiters are removed before the value is judged.
 */
function cleanValue(raw) {
  const s = String(raw ?? '').trim();
  const quoted = /^['"]([\s\S]*?)['"]/.exec(s);
  if (quoted) return quoted[1];
  return s.replace(/[;,)}\]]+$/, '').trim();
}

/** Is this a plausible key rather than a placeholder or a fragment of code? */
export function looksLikeKey(raw) {
  const s = cleanValue(raw);
  if (isPlaceholder(s)) return false;
  return /^[A-Za-z0-9+/._=-]{16,}$/.test(s);
}

/**
 * Scans one text buffer. Returns `{line, rule, why}` findings.
 *
 * Registry keys get their own rule rather than being covered by the generic one,
 * because `OPENWEATHER_API_KEY=abc123` is unquoted dotenv syntax and the generic
 * rule only looks for quotes. Both rules share `isPlaceholder`, so the template
 * form stays clean.
 */
export function scanText(text) {
  const findings = [];
  if (typeof text !== 'string' || text.length === 0) return findings;

  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) {
      if (p.capture && isPlaceholder(m[1])) continue;
      findings.push({ line: lineOf(text, m.index), rule: p.id, why: p.why });
    }
  }

  for (const p of MOJIBAKE_PATTERNS) {
    p.re.lastIndex = 0;
    for (const m of text.matchAll(p.re)) {
      findings.push({ line: lineOf(text, m.index), rule: p.id, why: p.why });
    }
  }

  for (const key of SECRET_KEYS) {
    const re = new RegExp(`\\b${key.name}\\b[ \\t]*=[ \\t]*([^\\s#]+)`, 'g');
    for (const m of text.matchAll(re)) {
      if (!looksLikeKey(m[1])) continue;
      findings.push({
        line: lineOf(text, m.index),
        rule: 'registry-key-value',
        why: `${key.name} is assigned a literal value; it belongs in .env, which is gitignored`,
      });
    }
  }

  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

/**
 * Checks `.env.example` against the registry.
 *
 * These two files are separate on purpose -- the example is read by humans and
 * the registry by code -- so they can drift, and drift here is invisible: a key
 * documented in one place and scanned for in the other is a key with a hole.
 */
export function envExampleProblems(text, keys = SECRET_KEYS) {
  const problems = [];
  if (text == null) return ['.env.example is missing'];

  const declared = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9_]*)[ \t]*=[ \t]*(.*)$/.exec(line.trim());
    if (m) declared.set(m[1], m[2].trim());
  }

  for (const key of keys) {
    if (!declared.has(key.name)) {
      problems.push(`.env.example does not declare ${key.name}`);
      continue;
    }
    const value = declared.get(key.name);
    if (value && !value.startsWith('#') && !isPlaceholder(value)) {
      problems.push(`.env.example carries a value for ${key.name}; the template must be empty`);
    }
  }

  for (const name of declared.keys()) {
    if (isCredentialShaped(name) && !keys.some((k) => k.name === name)) {
      problems.push(`.env.example declares ${name}, which is not in tools/secret-keys.mjs`);
    }
  }
  return problems;
}

/** Extensions that are never scanned, because they are not text. */
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.bmp', '.tga', '.avif',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac', '.mp4', '.webm',
  '.zip', '.gz', '.7z', '.dll', '.exe', '.pdb', '.pak', '.bin',
  '.glb', '.gltf', '.obj', '.fbx', '.hdr', '.ktx2',
]);

/**
 * Files deliberately not scanned.
 *
 * Only this file: it holds the patterns themselves, so scanning it would report
 * its own source as a leak. That is a genuine, if small, hole -- someone could
 * paste a key here -- and it is the same trade every pattern scanner makes,
 * since a scanner cannot read its own rules without matching them. The registry
 * next door is not excluded: it contains key *names*, which no rule matches.
 */
const SELF = 'tools/secret-scan.mjs';

export function isSkippedPath(rel) {
  return rel === SELF;
}

export function repoRoot(start = HERE) {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return ROOT;
}

/** The files git would publish. Untracked local files are out of scope by design. */
export function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\u0000').filter(Boolean);
}

const NUL = '\u0000';

function looksBinary(buf) {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** Full pass: no tracked file carries credential material, `.env` is not tracked. */
export function scanRepo(root = repoRoot()) {
  const problems = [];
  const files = trackedFiles(root);

  // An `.env` already tracked is the exact thing .gitignore cannot fix, so it is
  // reported separately with a removal instruction.
  const trackedEnv = files.filter((f) => {
    const base = f.split('/').pop();
    if (base === '.env.example') return false;
    return base === '.env' || /^\.env\.(?!example$)/.test(base) || /\.env$/.test(f);
  });
  for (const f of trackedEnv) {
    problems.push({
      path: f,
      why: 'an .env file is tracked; gitignore cannot untrack it -- run `git rm --cached <file>`',
    });
  }

  let scanned = 0;
  let lines = 0;
  for (const rel of files) {
    if (isSkippedPath(rel)) continue;
    if (BINARY_EXT.has(extname(rel).toLowerCase())) continue;
    const abs = join(root, rel);
    if (!existsSync(abs)) continue;
    let buf;
    try {
      buf = readFileSync(abs);
    } catch {
      continue;
    }
    if (looksBinary(buf)) continue;
    const text = buf.toString('utf8');
    if (text.includes(NUL)) continue;
    scanned++;
    lines += text.split('\n').length;
    for (const f of scanText(text)) {
      problems.push({ path: rel, why: `${f.why} (line ${f.line}, rule ${f.rule})` });
    }
  }

  const examplePath = join(root, '.env.example');
  const example = existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : null;
  for (const why of envExampleProblems(example)) problems.push({ path: '.env.example', why });

  for (const why of registryProblems(SECRET_KEYS, root)) {
    problems.push({ path: 'tools/secret-keys.mjs', why });
  }

  return { problems, scanned, lines };
}

const SELFTEST = [
  {
    name: 'catches an AWS access key id',
    text: 'const id = "AKIAIOSFODNN7EXAMPLE";',
    expect: ['aws-access-key-id'],
  },
  {
    name: 'catches a GitHub token',
    text: `const t = "ghp_${'a'.repeat(36)}";`,
    expect: ['github-token'],
  },
  {
    name: 'catches an OpenAI-style key',
    text: `fetch("https://api.x.dev", { auth: "sk-${'a'.repeat(24)}" });`,
    expect: ['openai-key'],
  },
  {
    name: 'catches a PEM private key block',
    text: '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA KEY-----',
    expect: ['private-key-block'],
  },
  {
    name: 'catches a Google API key',
    text: `const k = "AIza${'B'.repeat(35)}";`,
    expect: ['google-api-key'],
  },
  {
    name: 'catches a long literal under a credential name',
    text: 'apiKey: "abcdefghijklmnopqrstuvwx",',
    expect: ['generic-literal'],
  },
  {
    /*
     * The two cases below assemble their value rather than writing it out.
     *
     * The scanner's fixtures have to contain the patterns the scanner looks for, and
     * `OPENWEATHER_API_KEY=<32 hex characters>` is exactly the shape GitHub's push
     * protection reads as a live credential. Written literally, these two cases made
     * the branch unpushable: the repository rule rejected the push on the repository's
     * own secret-scanning test data.
     *
     * Assembling the value keeps each fixture exactly as meaningful as it was. The text
     * handed to `scanText` is unchanged and `looksLikeKey` still sees the same 32
     * characters; the file simply never contains the pattern itself. The Google and
     * OpenAI cases above already work this way, which is why they were never flagged.
     */
    name: 'catches a registry key given a dotenv literal',
    text: `OPENWEATHER_API_KEY='${'0123456789abcdef'.repeat(2)}'`,
    expect: ['registry-key-value'],
  },
  {
    name: 'catches a registry key in a code assignment',
    text: `const OPENWEATHER_API_KEY = "${'0123456789abcdef'.repeat(2)}";`,
    expect: ['registry-key-value'],
  },
  { name: 'accepts an empty template value', text: 'OPENWEATHER_API_KEY=\n', expect: [] },
  { name: 'accepts a placeholder value', text: 'OPENWEATHER_API_KEY=<your key here>\n', expect: [] },
  { name: 'accepts the comment that names the key', text: '# Read OPENWEATHER_API_KEY here\n', expect: [] },
  {
    name: 'accepts a source statement that mentions a registered key',
    text: 'const OPENWEATHER_API_KEY = buildKey(opts);\n',
    expect: [],
  },
  {
    name: 'accepts a registered key read back from an expression',
    text: 'const k = `${OPENWEATHER_API_KEY}`;\n',
    expect: [],
  },
  { name: 'accepts an empty buffer', text: '', expect: [] },
  {
    name: 'accepts the provider source that holds the key',
    text: 'private _apiKey: string;\nconstructor(apiKey: string) {\n  this._apiKey = apiKey;\n}\n',
    expect: [],
  },
  { name: 'accepts an unquoted short assignment', text: 'const token = response.token;\n', expect: [] },
  { name: 'rejects a quoted value too short to be a key', text: 'secret: "hunter2",\n', expect: [] },
  {
    name: 'accepts prose that mentions credentials without assigning one',
    text: 'Set the OpenWeatherMap API key in .env; the token and password fields are unused.\n',
    expect: [],
  },
  // The mojibake cases assemble their bytes rather than writing them out, so this file
  // stays clean: it is excluded from the repo scan precisely because it holds the
  // patterns, and adding a literal here would make the one file that cannot be checked
  // the file that fails.
  { name: 'catches a middot that was read as Latin-1', text: `join(' ${'Â'}· ')`, expect: ['mojibake'] },
  { name: 'catches an em dash that was read as CP1252', text: `// render ${'â'}€” and`, expect: ['mojibake'] },
  { name: 'catches an umlaut that was read as Latin-1', text: `Gr${'Ã'}¼ne`, expect: ['mojibake'] },
  { name: 'catches a decoder that gave up', text: `a ${'\uFFFD'} b`, expect: ['mojibake'] },
  { name: 'accepts ordinary punctuation', text: 'a — b · c “d” ‘e’', expect: [] },
  { name: 'accepts accented words in the languages we ship', text: 'Grüße, château, mañana, São Paulo, Âm Đặng', expect: [] },
  { name: 'accepts text we do not write by hand', text: '日本語 · Привет · Γειά · ✨ · ── │ ╭', expect: [] },
];

const ENV_EXAMPLE_CASES = [
  { name: 'accepts a template that matches the registry', text: 'OPENWEATHER_API_KEY=\n', expect: 0 },
  { name: 'rejects a template that omits a registered key', text: '', expect: 1 },
  {
    name: 'rejects a template carrying a real value',
    // Assembled for the same reason as the two cases above: a literal here is the exact
    // shape GitHub's push protection blocks on.
    text: `OPENWEATHER_API_KEY=${'0123456789abcdef'.repeat(2)}\n`,
    expect: 1,
  },
  {
    name: 'rejects an unregistered credential-shaped name',
    text: 'OPENWEATHER_API_KEY=\nSTRIPE_SECRET_KEY=\n',
    expect: 1,
  },
];

export function selftest() {
  let failed = 0;
  let total = 0;

  for (const t of SELFTEST) {
    const got = scanText(t.text).map((f) => f.rule);
    const ok = got.length === t.expect.length && t.expect.every((e) => got.includes(e));
    if (!ok) failed++;
    total++;
    process.stdout.write(
      `${ok ? 'PASS' : 'FAIL'}  ${t.name}  (expected [${t.expect.join(', ')}], got [${got.join(', ')}])\n`
    );
  }

  for (const t of ENV_EXAMPLE_CASES) {
    const got = envExampleProblems(t.text).length;
    const ok = got === t.expect;
    if (!ok) failed++;
    total++;
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${t.name}  (expected ${t.expect} problem(s), got ${got})\n`);
  }

  const reg = registryProblems();
  const regOk = reg.length === 0;
  if (!regOk) failed++;
  total++;
  process.stdout.write(`${regOk ? 'PASS' : 'FAIL'}  registry is well formed and its consumers exist\n`);
  for (const p of reg) process.stdout.write(`        ${p}\n`);

  process.stdout.write(`\n${total - failed}/${total} self-test cases passed\n`);
  return failed ? 1 : 0;
}

/**
 * The scan itself, as a function of its arguments.
 *
 * Kept out of module scope so importing `scanText` or `PATTERNS` from a test does
 * not run a repo-wide scan and then exit from under the runner.
 */
export function main(argv = process.argv) {
  if (argv.includes('--selftest')) return selftest();

  const root = repoRoot();
  const { problems, scanned, lines } = scanRepo(root);

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ scanned, lines, problems }, null, 2) + '\n');
  } else {
    process.stdout.write(`Scanned ${scanned} tracked text file(s), ${lines} line(s).\n`);
    if (problems.length === 0) {
      process.stdout.write('PASS  no credential material is committed, and the template matches the registry.\n');
    } else {
      process.stdout.write(`\n${problems.length} problem(s):\n`);
      for (const p of problems) process.stdout.write(`  FAIL  ${p.path}\n          ${p.why}\n`);
    }
  }
  return problems.length ? 1 : 0;
}

// Importing this module must not run it. `process.argv[1]` is the entry point,
// which is vitest or whatever else is asking for `scanText` when it is not this file.
const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
