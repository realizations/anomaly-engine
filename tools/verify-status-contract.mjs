/**
 * Checks that the status document is a contract, not a coincidence.
 *
 * The settings window and the renderer exchange a JSON object roughly once a second,
 * and nothing ties the two ends together: the renderer builds an object literal, the
 * window reads keys out of a dictionary, and a key that is spelled differently -- or
 * that one side simply never wrote -- fails silently rather than loudly.
 *
 * ## The bug this exists to prevent is real, and was shipped
 *
 * The window read `motionIntensity` from the status document. The renderer never
 * emitted it: the field had been dropped at some point and the reader had been left
 * behind. The helper that reads a missing double returns zero, which is a defensible
 * default for a frame counter and catastrophic for a *setting* -- so the settings
 * window pinned the motion slider to 0 on every poll. Dragging it changed the value,
 * the value was pushed to the engine, and within a second the one-second poll wrote
 * zero back. The control was inert and looked broken.
 *
 * Nothing failed. No exception, no log line, no failing test. The slider simply
 * reverted to "still" forever, and the plausible explanation is that the feature was
 * buggy rather than that a string had drifted.
 *
 * So: every key the window reads must be a key the renderer writes. A reader may fall
 * back for a field it knows to be optional, but it has to be a deliberate fallback,
 * recorded in `OPTIONAL_READS`, rather than a missing field that happens to default
 * to zero.
 *
 * Self-test included, because a gate that cannot be made to fail is not a gate.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const read = (...parts) => readFileSync(resolve(ROOT, ...parts), 'utf8');

/** Comments stripped, so prose naming a field is not mistaken for a read of it. */
const withoutComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

/**
 * Reads that are allowed to miss.
 *
 * Each one needs a reason. `motionEffective` is the only entry: it was added at the
 * same time as the fix and a renderer on disk from before that should fall back to the
 * requested level rather than to zero, which is the fallback the reader implements.
 */
const OPTIONAL_READS = new Set(['motionEffective']);

/**
 * Top-level keys of the object `getStatus()` returns.
 *
 * Brace-depth tracked rather than matched by indentation: the document nests four deep
 * (`media`, `feeds`, `sky`, `world`), and an indentation heuristic picks those inner
 * keys up as top-level ones, which would let a real mismatch hide behind them.
 */
function emittedStatusKeys(mainSource) {
  // Comments stripped here for the same reason as in the reader: the status
  // declaration carries doc comments, and one of them mentioning "return" was enough
  // to anchor the scan on a comment rather than on the returned literal -- which then
  // reported the first two real fields as missing.
  const src = withoutComments(mainSource);

  const start = src.indexOf('getStatus(): {');
  if (start < 0) return [];

  // The returned object literal. Anchored on `return {` rather than on the first
  // brace after the first "return", so a type annotation cannot redirect it.
  const ret = /return\s*\{/.exec(src.slice(start));
  if (!ret) return [];
  const open = start + ret.index + ret[0].length - 1;

  const keys = [];
  // Starts at 1, not 0: the scan begins immediately *after* the literal's opening
  // brace, so the scanner is already inside the object. Starting at 0 skips every
  // top-level field until the first nested `{` nudges the counter up, which is a
  // failure that looks like "the first few fields are missing" rather than like a
  // broken parser.
  let depth = 1;
  let i = open + 1;
  let expectingKey = true;

  for (; i < src.length; i++) {
    const c = src[i];

    if (c === '{' || c === '[' || c === '(') {
      depth++;
      // A `{` that opens an object at depth 1 is the start of a value, so the next
      // identifier is a property name rather than a shorthand.
      if (c === '{' && depth === 1) expectingKey = true;
      continue;
    }
    if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) break;
      continue;
    }
    if (c === ',') {
      if (depth === 1) expectingKey = true;
      continue;
    }
    if (!expectingKey || depth !== 1) continue;
    if (!/[A-Za-z_$]/.test(c)) continue;

    let j = i;
    while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j++;
    keys.push(src.slice(i, j));
    i = j - 1;
    // Skip past the colon; `key: value` and shorthand `key` both land here.
    while (i < src.length && src[i] !== ':' && src[i] !== ',') {
      if (src[i] === '\n') break;
      i++;
    }
    if (src[i] === ':') expectingKey = false;
  }

  return [...new Set(keys)];
}

/**
 * Keys the settings window reads out of the status document.
 *
 * Scoped to `GetStatusAsync` and its object initialiser. A wider scan picks up reads
 * of other dictionaries that happen to use the same four helpers, which have nothing
 * to do with the status document and would produce noise this gate then gets ignored
 * for.
 */
function readStatusKeys(settingsSource) {
  const code = withoutComments(settingsSource);

  // The declaration, not the first mention. `GetStatusAsync` also appears as a call
  // site several hundred lines earlier, and anchoring on that lands the scan in the
  // middle of an unrelated method -- which reads as "no keys found" rather than as a
  // bug, which is the worst way for this gate to fail.
  const decl = /GetStatusAsync\(\)\s*\{/.exec(code);
  if (!decl) return { reads: [], nested: [] };
  const start = decl.index;

  // From the method to the next method declaration, which is the whole parse.
  const next = code.indexOf('\n    private ', start + 16);
  const scope = next > 0 ? code.slice(start, next) : code.slice(start);

  const reads = new Set();
  for (const m of scope.matchAll(/\b(?:Db|I|S|B)\("([A-Za-z0-9_]+)"/g)) reads.add(m[1]);

  const nested = [];
  for (const m of scope.matchAll(/\bNB\("([A-Za-z0-9_]+)",\s*"([A-Za-z0-9_]+)"/g)) {
    nested.push({ outer: m[1], inner: m[2] });
  }

  return { reads: [...reads], nested };
}

/**
 * Property names declared by a TypeScript interface.
 *
 * The emitted side of two of the three channels is an interface rather than an object
 * literal, and an interface is the honest declaration: it is what the renderer agrees
 * to send and what a TypeScript caller is checked against.
 */
function interfaceKeys(source, name) {
  const body = new RegExp(`export\\s+interface\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!body) return [];
  const stripped = withoutComments(body[1]);
  const keys = [];
  for (const line of stripped.split('\n')) {
    // `name: Type;` and `name?: Type;`, ignoring anything inside a comment.
    const m = /^\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\??\s*:/.exec(line);
    if (m) keys.push(m[1]);
  }
  return [...new Set(keys)];
}

/**
 * Fields the settings window reads out of the effect list.
 *
 * `TryGetProperty` rather than the `Db`/`I`/`S`/`B` helpers the status document uses,
 * because this one is walked element by element as a `JsonElement`.
 */
function readEffectKeys(settingsSource) {
  const code = withoutComments(settingsSource);
  const start = code.indexOf('EnsureEffectsAsync');
  if (start < 0) return [];
  const next = code.indexOf('\n    private ', start + 16);
  const scope = next > 0 ? code.slice(start, next) : code.slice(start);
  const keys = new Set();
  for (const m of scope.matchAll(/TryGetProperty\("([A-Za-z0-9_]+)"/g)) keys.add(m[1]);
  return [...keys];
}

/**
 * Fields the settings window reads out of a feed.
 *
 * Feeds travel as `JsonNode` rather than `JsonElement`, so they are read with indexers
 * rather than `TryGetProperty`. The negative lookahead is what separates a read from a
 * write: building a feed uses `["url"] = url`, reading one uses `f["url"]`, and counting
 * the writes would check the window against itself and always pass.
 */
function readFeedKeys(settingsSource) {
  const code = withoutComments(settingsSource);
  const keys = new Set();
  for (const m of code.matchAll(/\b[a-zA-Z_]\w*\["([A-Za-z0-9_]+)"\](?!\s*=[^=])/g)) {
    keys.add(m[1]);
  }
  return [...keys];
}

/**
 * The effects the registry sends to the rule editor.
 *
 * True of the ones the window actually reads: a field the renderer sends and the
 * window ignores is not a defect, whereas the reverse silently drops information the
 * user was meant to see. Descriptions and the landscape hint are exactly that kind of
 * field, so losing one to a rename would be invisible.
 */
function effectContractProblems(f) {
  const problems = [];
  const emitted = interfaceKeys(f.REGISTRY, 'EffectInfo');
  const reads = readEffectKeys(f.SETTINGS);
  if (!emitted.length) {
    problems.push('could not read the EffectInfo interface out of the effect registry.');
    return problems;
  }
  if (!reads.length) {
    problems.push('could not read the effect list out of the settings window.');
    return problems;
  }
  const emittedSet = new Set(emitted);
  for (const key of reads) {
    if (emittedSet.has(key)) continue;
    problems.push(
      `the settings window reads "${key}" from the effect registry, and EffectInfo does ` +
        'not declare it. The reader defaults it to empty, so the rule editor shows a ' +
        'blank description or a missing landscape hint.'
    );
  }
  return problems;
}

/**
 * The feed fields the host needs and the renderer must send.
 *
 * This is the allow-list channel rather than the status one, so a field the window
 * writes but does not read is checked just as hard: `allowedHosts` and `rules` are
 * never rendered, and losing them in a round trip would leave a configured feed that
 * silently cannot be fetched or cannot fire.
 */
function feedContractProblems(f) {
  const problems = [];
  const emitted = interfaceKeys(f.PERSISTENCE, 'PersistedFeed');
  const reads = readFeedKeys(f.SETTINGS);
  if (!emitted.length) {
    problems.push('could not read the PersistedFeed interface out of the persistence layer.');
    return problems;
  }
  if (!reads.length) {
    problems.push('could not read the feed list out of the settings window.');
    return problems;
  }
  const emittedSet = new Set(emitted);
  for (const key of reads) {
    if (emittedSet.has(key)) continue;
    problems.push(
      `the settings window reads "${key}" from a feed, and PersistedFeed does not ` +
        'declare it. Every reader here falls back to an empty string, so the field ' +
        'disappears rather than failing.'
    );
  }
  return problems;
}

export function statusContractProblems(files) {
  const f = files ?? {
    MAIN: read('src', 'Engine', 'src', 'main.ts'),
    SETTINGS: read('src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml.cs'),
    REGISTRY: read('src', 'Engine', 'src', 'anomalies', 'effects.ts'),
    PERSISTENCE: read('src', 'Engine', 'src', 'platform', 'Persistence.ts'),
  };

  const problems = [];

  const emitted = emittedStatusKeys(f.MAIN);
  if (emitted.length === 0) {
    problems.push('could not read the object getStatus() returns.');
    return problems;
  }

  const { reads, nested } = readStatusKeys(f.SETTINGS);
  if (reads.length === 0) {
    problems.push('could not read the status document out of the settings window.');
    return problems;
  }

  const emittedSet = new Set(emitted);
  for (const key of reads) {
    if (emittedSet.has(key)) continue;
    if (OPTIONAL_READS.has(key)) continue;
    problems.push(
      `the settings window reads "${key}" from the status document, and getStatus() never ` +
        'writes it. The reader falls back to a zero, which for a setting means the ' +
        'control silently resets on every poll.'
    );
  }

  for (const { outer, inner } of nested) {
    if (!emittedSet.has(outer)) {
      problems.push(
        `the settings window reads "${outer}.${inner}" from the status document, and ` +
          `getStatus() never writes "${outer}".`
      );
    }
  }

  // The other two channels. Reported through the same gate because it is the same
  // defect: a JSON object crossing a process boundary with nothing holding the two
  // ends to the same shape, and a reader that defaults quietly when the shape drifts.
  problems.push(...effectContractProblems(f));
  problems.push(...feedContractProblems(f));

  return problems;
}

/* --------------------------------- self-test --------------------------------- */

if (process.argv.includes('--selftest')) {
  const base = {
    MAIN: read('src', 'Engine', 'src', 'main.ts'),
    SETTINGS: read('src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml.cs'),
    REGISTRY: read('src', 'Engine', 'src', 'anomalies', 'effects.ts'),
    PERSISTENCE: read('src', 'Engine', 'src', 'platform', 'Persistence.ts'),
  };
  const cases = [];
  const record = (name, files, shouldFail) => {
    const problems = statusContractProblems(files);
    cases.push({ name, ok: (problems.length > 0) === shouldFail, problems });
  };

  record('the repository as it stands is consistent', base, false);

  // The regression this gate was written for, reproduced exactly: a reader left
  // behind after the writer dropped the field.
  record('a field the renderer stopped writing is caught', {
    ...base,
    MAIN: base.MAIN.replace(/\n      motionIntensity: [^\n]*\n/, '\n'),
  }, true);

  record('a field read under the wrong name is caught', {
    ...base,
    SETTINGS: base.SETTINGS.replace('Db("motionIntensity")', 'Db("motionLevel")'),
  }, true);

  // A nested block that is not emitted must be caught, which is what the brace walk
  // is for: an indentation heuristic would have found `media`'s children and missed it.
  record('a missing nested block is caught', {
    ...base,
    MAIN: base.MAIN.replace(/\n      accessibility: [^\n]*\n/, '\n'),
  }, true);

  record('an empty status document is caught', { ...base, MAIN: 'const x = 1;' }, true);

  // The effect channel. A rename here costs the rule editor its descriptions and its
  // landscape hints, which is exactly the guidance that stops a user mapping a
  // forest-watcher onto a salt flat.
  record('an effect field the registry dropped is caught', {
    ...base,
    REGISTRY: base.REGISTRY.replace(/^\s*needsLandscape\?: string;\s*$/m, ''),
  }, true);

  record('an effect field the window reads but the registry lacks is caught', {
    ...base,
    REGISTRY: base.REGISTRY.replace(/^\s*durationSeconds: number;\s*$/m, ''),
  }, true);

  record('an unreadable effect registry is caught', { ...base, REGISTRY: 'export const x = 1;' }, true);

  // The feed channel. `allowedHosts` is never rendered, so a rename here is invisible
  // until every configured feed silently stops being fetchable.
  record('a feed field the persistence layer dropped is caught', {
    ...base,
    PERSISTENCE: base.PERSISTENCE.replace(/^\s*allowedHosts: string\[\];\s*$/m, ''),
  }, true);

  record('an unreadable feed interface is caught', { ...base, PERSISTENCE: 'export const x = 1;' }, true);

  let failed = 0;
  for (const c of cases) {
    if (!c.ok) failed++;
    process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n`);
    if (!c.ok) for (const p of c.problems) process.stdout.write(`        ${p}\n`);
  }
  process.stdout.write(
    failed ? `\n${failed} assertion(s) failed.\n` : '\nThe status contract check behaves.\n'
  );
  process.exit(failed ? 1 : 0);
}

/* ------------------------------- the repository ------------------------------ */

function existsSyncSafe(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

if (!existsSyncSafe(join(ROOT, 'src', 'Engine', 'src', 'main.ts'))) {
  console.error('FAIL  status contract: run this from the repository root.');
  process.exit(1);
}

const problems = statusContractProblems();
if (problems.length) {
  console.error('FAIL  the settings window and the renderer disagree about the status document:');
  for (const p of problems) console.error(`      ${p}`);
  process.exit(1);
}
console.log(
  'PASS  every field the settings window reads from the status document, the effect ' +
    'registry and a feed is one the renderer actually writes'
);