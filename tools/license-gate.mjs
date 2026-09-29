/**
 * Asset licence gate.
 *
 * The project may ship paid tiers later, so every third-party asset must permit
 * commercial use, modification and redistribution. This script enforces that
 * mechanically instead of relying on a human remembering the policy.
 *
 * Run:   node tools/license-gate.mjs            validate assets/
 *        node tools/license-gate.mjs --selftest  prove the gate rejects bad licences
 *        node tools/license-gate.mjs --json     machine-readable output for CI
 *
 * Exits non-zero if any asset is missing a licence record or carries a
 * restrictive term, so it can gate CI and pre-release builds.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const MANIFEST = join(ROOT, 'assets', 'manifest.json');

// Licences we accept. CC0 and PUBLIC-DOMAIN carry no downstream obligation, so
// they are preferred. CC-BY is accepted because attribution is machine
// checkable. OFL is accepted for fonts, where bundling with software is
// explicitly permitted by the licence itself.
export const ALLOWED = new Set([
  'CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0', 'OFL-1.1', 'MIT',
  'PUBLIC-DOMAIN', 'PROPRIETARY-ORIGINAL',
]);

// Terms that make an asset unusable for this project. ShareAlike is rejected
// because a viral obligation would contaminate the codebase; NonCommercial
// because a paid tier would violate it; NoDerivatives because we composite
// assets into generated scenes rather than shipping them verbatim.
export const FORBIDDEN = [
  { re: /NonCommercial|Non-?Commercial/i, why: 'non-commercial use only' },
  { re: /(^|[^A-Za-z])NC([^A-Za-z]|$)/, why: 'non-commercial use only' },
  { re: /NoDerivatives|No-?Derivatives/i, why: 'no derivatives' },
  { re: /(^|[^A-Za-z])ND([^A-Za-z]|$)/, why: 'no derivatives' },
  { re: /ShareAlike|Share-?Alike/i, why: 'share-alike is viral and would contaminate the codebase' },
  { re: /(^|[^A-Za-z])SA([^A-Za-z]|$)/, why: 'share-alike is viral and would contaminate the codebase' },
  { re: /GPL/i, why: 'copyleft is viral' },
  { re: /LGPL|MPL-|EPL|CDDL/i, why: 'weak copyleft still imposes redistribution conditions' },
  { re: /personal use only|non-?commercial use only|evaluation only|educational use only/i, why: 'not licensed for commercial use' },
  { re: /fair use|all rights reserved/i, why: 'no redistribution grant' },
];

const ASSET_DIRS = ['assets'];
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.bmp', '.tga',
  '.mp3', '.ogg', '.wav', '.flac', '.m4a', '.aac',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.glsl', '.vert', '.frag', '.hlsl', '.cube', '.3ds', '.obj', '.fbx', '.gltf', '.glb',
  '.mp4', '.webm', '.mov', '.hdr', '.exr', '.ktx2', '.basis',
]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Validates one manifest record. Returns a list of {path, why}. */
export function validateRecord(rel, rec) {
  const problems = [];
  if (!rec || typeof rec !== 'object') {
    return [{ path: rel, why: 'manifest entry is not an object' }];
  }
  const license = String(rec.license || '').trim();
  if (!license) return [{ path: rel, why: 'licence field is empty' }];

  const bad = FORBIDDEN.find((f) => f.re.test(license));
  if (bad) return [{ path: rel, why: `licence "${license}" is restrictive: ${bad.why}` }];

  if (!ALLOWED.has(license.toUpperCase())) {
    return [{ path: rel, why: `licence "${license}" is not in the approved allow-list (${[...ALLOWED].join(', ')})` }];
  }
  const u = license.toUpperCase();
  if (u.startsWith('CC-BY') && !rec.attribution) {
    problems.push({ path: rel, why: 'CC-BY requires an "attribution" string' });
  }
  if (u.startsWith('OFL') && !rec.sourceUrl) {
    problems.push({ path: rel, why: 'OFL assets should record "sourceUrl" so the licence text can be located' });
  }
  if (rec.sourceUrl && !/^https:\/\//i.test(String(rec.sourceUrl))) {
    problems.push({ path: rel, why: 'sourceUrl must be https so the licence can be re-verified' });
  }
  return problems;
}

/** Full pass: every shipped asset file has an approved, non-restrictive record. */
export function validate(manifest, root) {
  const problems = [];
  const assets = Array.isArray(manifest.assets) ? manifest.assets : null;
  if (!assets) return { problems: [{ path: '(manifest)', why: 'manifest must contain an "assets" array' }], checked: 0 };

  const byPath = new Map();
  for (const a of assets) {
    const p = a && typeof a.path === 'string' ? a.path.replace(/\\/g, '/').toLowerCase() : null;
    if (!p) { problems.push({ path: '(manifest entry)', why: 'entry has no "path" field' }); continue; }
    byPath.set(p, a);
  }

  let checked = 0;
  for (const dir of ASSET_DIRS) {
    for (const file of walk(join(root, dir))) {
      const rel = relative(root, file).replace(/\\/g, '/');
      if (rel.toLowerCase() === 'assets/manifest.json') continue;
      if (!BINARY_EXT.has(extname(file).toLowerCase())) continue;
      checked++;
      const rec = byPath.get(rel.toLowerCase());
      if (!rec) {
        problems.push({ path: rel, why: 'no licence record in assets/manifest.json' });
        continue;
      }
      problems.push(...validateRecord(rel, rec));
    }
  }

  for (const a of assets) {
    if (!a || typeof a.path !== 'string') continue;
    if (!existsSync(join(root, a.path))) {
      problems.push({ path: a.path, why: 'listed in the manifest but the file does not exist' });
    }
  }

  return { problems, checked };
}

const SELFTEST = [
  { name: 'accepts CC0', rec: { license: 'CC0-1.0', sourceUrl: 'https://x.dev' }, expect: 0 },
  { name: 'accepts public domain', rec: { license: 'PUBLIC-DOMAIN' }, expect: 0 },
  { name: 'accepts first-party', rec: { license: 'PROPRIETARY-ORIGINAL' }, expect: 0 },
  { name: 'accepts CC-BY with attribution', rec: { license: 'CC-BY-4.0', attribution: 'Credit: X', sourceUrl: 'https://x.dev' }, expect: 0 },
  { name: 'rejects CC-BY without attribution', rec: { license: 'CC-BY-4.0', sourceUrl: 'https://x.dev' }, expect: 1 },
  { name: 'rejects CC-BY-NC', rec: { license: 'CC-BY-NC-4.0' }, expect: 1 },
  { name: 'rejects NonCommercial wording', rec: { license: 'Custom NonCommercial Only' }, expect: 1 },
  { name: 'rejects bare NC token', rec: { license: 'CC-BY-NC' }, expect: 1 },
  { name: 'rejects CC-BY-ND', rec: { license: 'CC-BY-ND-4.0' }, expect: 1 },
  { name: 'rejects CC-BY-SA as viral', rec: { license: 'CC-BY-SA-4.0' }, expect: 1 },
  { name: 'rejects ShareAlike wording', rec: { license: 'Creative Commons ShareAlike 4.0' }, expect: 1 },
  { name: 'rejects GPL as viral', rec: { license: 'GPL-3.0' }, expect: 1 },
  { name: 'rejects LGPL', rec: { license: 'LGPL-2.1' }, expect: 1 },
  { name: 'rejects personal-use-only', rec: { license: 'Free for personal use only' }, expect: 1 },
  { name: 'rejects all rights reserved', rec: { license: 'All rights reserved' }, expect: 1 },
  { name: 'rejects unknown licence', rec: { license: 'Totally Custom Thing' }, expect: 1 },
  { name: 'rejects empty licence', rec: {}, expect: 1 },
  { name: 'rejects non-https sourceUrl', rec: { license: 'CC0-1.0', sourceUrl: 'http://x.dev' }, expect: 1 },
  { name: 'rejects OFL without sourceUrl', rec: { license: 'OFL-1.1' }, expect: 1 },
];

function selftest() {
  let failed = 0;
  for (const t of SELFTEST) {
    const got = validateRecord('x.png', t.rec).length;
    const ok = got === t.expect;
    if (!ok) failed++;
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${t.name}  (expected ${t.expect} problem(s), got ${got})\n`);
  }
  process.stdout.write(`\n${SELFTEST.length - failed}/${SELFTEST.length} self-test cases passed\n`);
  process.exit(failed ? 1 : 0);
}

if (process.argv.includes('--selftest')) {
  selftest();
} else {
  if (!existsSync(MANIFEST)) {
    process.stdout.write(
      'FAIL  assets/manifest.json not found.\n' +
      '      Every third-party asset needs a licence record before it can ship.\n'
    );
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch (e) {
    process.stdout.write(`FAIL  assets/manifest.json is not valid JSON: ${e.message}\n`);
    process.exit(1);
  }

  const { problems, checked } = validate(manifest, ROOT);

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify({ checked, problems }, null, 2) + '\n');
  } else {
    process.stdout.write(`Checked ${checked} shipped asset file(s) against ${manifest.assets.length} manifest record(s).\n`);
    if (problems.length === 0) {
      process.stdout.write('PASS  every asset carries an approved, non-restrictive licence.\n');
    } else {
      process.stdout.write(`\n${problems.length} problem(s):\n`);
      for (const p of problems) process.stdout.write(`  FAIL  ${p.path}\n          ${p.why}\n`);
    }
  }
  process.exit(problems.length ? 1 : 0);
}
