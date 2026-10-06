import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { registeredKinds, structureAsset } from '../src/renderer/assetRegistry.js';
import { ALLOWED, ASSET_DIRS, validate } from '../../../tools/license-gate.mjs';

/**
 * The three places an asset enters this project still agree with each other.
 *
 * Two of them were broken when this file was written, and neither was visible to any
 * other check.
 *
 * `assetRegistry.ts` documents the Blender/glTF landing spot as being explained in
 * `docs/asset-pipeline.md`, and that file did not exist -- a promise in a comment with
 * nothing behind it. `assets/manifest.json` declared `"$schema":
 * "./manifest.schema.json"` and that file did not exist either, so the manifest had no
 * schema, no editor validation, and a reference nothing would ever follow up on.
 *
 * The third was a hole rather than a dangling reference. The licence gate walked
 * `assets/` and nothing else, while `tools/make-branding.mjs` copies five typefaces and
 * a favicon into `src/Engine/src/public/` -- the directory Vite ships. Those files had
 * licence records but no check, so anything else dropped in there would have shipped
 * with no record at all and the gate would have reported PASS.
 *
 * The tests below are the reason those three cannot quietly come back.
 */

/** Walks up from wherever vitest was started to the directory holding the manifest. */
function findRoot(start: string): string {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, 'assets', 'manifest.json'))) return dir;
    dir = join(dir, '..');
  }
  throw new Error(`could not find the repository root from ${start}`);
}

const ROOT = findRoot(process.cwd());

function readJson(file: string): any {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Every `.ts` under `src/`, skipping build output and installed packages. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const MANIFEST = readJson(join(ROOT, 'assets', 'manifest.json'));
const SCHEMA = readJson(join(ROOT, 'assets', MANIFEST.$schema));
const BY_PATH = new Map<string, any>(
  MANIFEST.assets.map((a: any) => [String(a.path).replace(/\\/g, '/').toLowerCase(), a])
);

describe('dangling references', () => {
  it('every docs file named in the source exists', () => {
    // This is the check that would have caught the missing asset-pipeline.md.
    const missing: string[] = [];
    for (const file of sourceFiles(join(ROOT, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/docs\/[a-z0-9-]+\.md/g)) {
        if (!existsSync(join(ROOT, m[0]))) {
          missing.push(`${m[0]} referenced from ${relative(ROOT, file)}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('the manifest declares a schema that exists', () => {
    expect(typeof MANIFEST.$schema).toBe('string');
    expect(existsSync(join(ROOT, 'assets', MANIFEST.$schema))).toBe(true);
  });

  it('the schema is a schema for this manifest', () => {
    expect(SCHEMA.$schema).toContain('json-schema.org');
    for (const def of ['asset', 'source', 'rejectedSource']) {
      expect(Object.keys(SCHEMA.$defs ?? {})).toContain(def);
    }
    expect(SCHEMA.$defs.asset.required).toContain('path');
  });
});

describe('manifest and schema stay in step', () => {
  it('the schema declares every field the manifest actually uses', () => {
    // The other direction is not a defect -- a manifest with no notes field is fine --
    // but a field nobody declared is one the editor will not validate and the next
    // contributor will assume is meaningless.
    const undeclared: string[] = [];
    for (const [def, entries] of [
      ['asset', MANIFEST.assets],
      ['source', MANIFEST.sources],
      ['rejectedSource', MANIFEST.rejectedSources],
    ] as const) {
      const declared = new Set(Object.keys(SCHEMA.$defs[def].properties ?? {}));
      for (const entry of entries ?? []) {
        for (const key of Object.keys(entry)) {
          if (!declared.has(key)) undeclared.push(`${def}.${key}`);
        }
      }
    }
    expect([...new Set(undeclared)]).toEqual([]);
  });

  it('every asset record carries exactly one source of licence truth', () => {
    // `copiedFrom` entries carry no licence on purpose: two records describing the same
    // bytes are two facts that can disagree, and the disagreement would be invisible.
    const wrong: string[] = [];
    for (const a of MANIFEST.assets) {
      const count = [typeof a.license, typeof a.copiedFrom].filter((t) => t === 'string').length;
      if (count !== 1) wrong.push(`${a.path} has ${count} licence sources`);
    }
    expect(wrong).toEqual([]);
  });

  it('every copied file names a source that is recorded and on disk', () => {
    const problems: string[] = [];
    for (const a of MANIFEST.assets) {
      if (!a.copiedFrom) continue;
      const src = BY_PATH.get(String(a.copiedFrom).replace(/\\/g, '/').toLowerCase());
      if (!src) problems.push(`${a.path}: source ${a.copiedFrom} has no record`);
      else if (typeof src.license !== 'string') problems.push(`${a.path}: source record has no licence`);
      if (!existsSync(join(ROOT, a.path))) problems.push(`${a.path}: does not exist`);
      if (!existsSync(join(ROOT, a.copiedFrom))) problems.push(`${a.path}: source ${a.copiedFrom} does not exist`);
    }
    expect(problems).toEqual([]);
  });
});

describe('the written policy and the enforced one', () => {
  it('assets/manifest.json policy.accepted matches ALLOWED in the gate', () => {
    // Two lists that mean the same thing in two files. The manifest's is prose a human
    // reads and edits; the gate's is what actually decides. Nothing links them, so this
    // is the link.
    const written = new Set<string>(
      MANIFEST.policy.accepted.map((s: string) => s.split(' (')[0].toUpperCase())
    );
    const enforced = new Set<string>([...ALLOWED].map((s: string) => s.toUpperCase()));
    expect([...written].sort()).toEqual([...enforced].sort());
  });
});

describe('the gate sees everything that ships', () => {
  it('covers both directories binaries are shipped from', () => {
    expect(ASSET_DIRS).toContain('assets');
    // The hole: this directory is copied verbatim into the renderer the user runs, and
    // it was not walked at all.
    expect(ASSET_DIRS).toContain('src/Engine/src/public');
  });

  it('actually finds files in each covered directory', () => {
    // A path in ASSET_DIRS that does not exist would satisfy the assertions above and
    // prove nothing, so the directories are walked here too.
    for (const dir of ASSET_DIRS) {
      expect(existsSync(join(ROOT, dir))).toBe(true);
    }
    const publicDir = join(ROOT, 'src', 'Engine', 'src', 'public');
    const binaries = readdirSync(publicDir, { recursive: true })
      .map(String)
      .filter((f) => /\.(png|ttf|otf|woff2?)$/i.test(f));
    expect(binaries.length).toBeGreaterThanOrEqual(6);
  });

  it('passes on the repository as it stands', () => {
    const { problems, checked } = validate(MANIFEST, ROOT);
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });
});

describe('3D models', () => {
  /**
   * Live code rather than a guard for a state nobody is in.
   *
   * No structure declares a `model` today, so this returns an empty list -- which is
   * the point of writing it now: the constraint is enforced from the moment the first
   * one appears, and it is the constraint the licence gate cannot enforce by itself,
   * because it only walks ASSET_DIRS and a reference from anywhere else would slip
   * through entirely.
   */
  function modelProblems(): string[] {
    const out: string[] = [];
    for (const kind of registeredKinds()) {
      const model = structureAsset(kind).model;
      if (!model) continue;
      if (!model.src.startsWith('assets/')) {
        out.push(`${kind}: "${model.src}" is outside assets/, so license-gate.mjs will never see it`);
        continue;
      }
      if (!existsSync(join(ROOT, model.src))) {
        out.push(`${kind}: "${model.src}" does not exist`);
        continue;
      }
      const rec = BY_PATH.get(model.src.replace(/\\/g, '/').toLowerCase());
      if (!rec) {
        out.push(`${kind}: "${model.src}" has no licence record`);
        continue;
      }
      if (typeof rec.copiedFrom === 'string') {
        out.push(`${kind}: "${model.src}" is a copy; its source should be the licensed record`);
        continue;
      }
      if (!ALLOWED.has(String(rec.license).toUpperCase())) {
        out.push(`${kind}: "${model.src}" is under "${rec.license}", not in the allow-list`);
      }
    }
    return out;
  }

  it('every declared model is somewhere the gate can reach', () => {
    expect(modelProblems()).toEqual([]);
  });

  it('models come from assets/, where the manifest and the gate both look', () => {
    // Stated separately so a failure names the rule rather than one instance of it.
    expect(ASSET_DIRS).toContain('assets');
    for (const kind of registeredKinds()) {
      const model = structureAsset(kind).model;
      if (model) expect(model.src.startsWith('assets/')).toBe(true);
    }
  });
});
