/**
 * Proves nothing unreachable ships.
 *
 *   node tools/verify-dead-code.mjs            check the repository
 *   node tools/verify-dead-code.mjs --selftest prove the check still detects it
 *
 * Why this exists
 * ---------------
 * Four modules under `src/Engine/src` had no path to `main.ts`, and every one of
 * them was a liability rather than a plan:
 *
 *   - `platform/SQLitePersistence.ts` imported `better-sqlite3`, a native Node module,
 *     as a *runtime* dependency of a browser bundle. 26 MB in node_modules for code
 *     nothing constructed. The real store is a JSON file, and `StateStore.cs` says why.
 *   - `renderer/DayNightCycle.ts` was a complete second renderer -- its own sky table,
 *     stars, clouds, landscape, forest, cabin, radio tower, observatory -- superseded by
 *     `WorldRenderer`. Its test asserted `expect(cycle).toBeDefined()`.
 *   - `integrations/*.ts` are three adapters that cannot run, because the page's CSP
 *     sets `connect-src 'none'`. These are deliberate, and they stay, listed below.
 *
 * And one C# file was worse than dead: `AnomalyEngineDb.cs` P/Invokes `sqlite3` while
 * the project references `System.Data.SQLite.Core`, which ships its native library as
 * `SQLite.Interop.dll`. Constructing it throws `DllNotFoundException`. Verified by
 * building and running it, not by reading it.
 *
 * None of this is visible to any other check. `tsc` compiles an unreachable file
 * perfectly happily, vitest is happy to import one and assert `toBeDefined()`, and the
 * bundler drops it silently so the shipped JavaScript is unaffected. That is the
 * point: dead code costs nothing to *carry* and everything to *misread*, and the
 * cheapest moment to delete it is before someone builds on it.
 *
 * What it asserts
 * ---------------
 *  1. Every module under `src/Engine/src` is reachable from `main.ts` by import, or
 *     appears in `DEAD_BY_DESIGN` with a reason.
 *  2. Every `DEAD_BY_DESIGN` entry is *still* dead. An entry that has been wired up
 *     is worse than no entry: it reads as a permanent exemption and stops anyone
 *     looking, which is the mistake `WindowEvents.test.ts` documents at length.
 *  3. No dependency is imported by nothing. That is what `better-sqlite3` was: a
 *     26 MB runtime dependency with no importer.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ENGINE = join(ROOT, 'src', 'Engine');
const SRC = join(ENGINE, 'src');
const ENTRY = 'main.ts';

/**
 * Code that is unreachable on purpose, and why.
 *
 * Each reason has to survive the question "what would it take to delete this?", and
 * the answer for these three is a product decision rather than an oversight: the
 * README lists ARG event sources as deliberate scaffold, and the adapter code is the
 * part that would survive the endpoint and rate-limit work. Deleting them would throw
 * away work that is one decision away from being live.
 *
 * The CSP is the reason they cannot run today. `connect-src 'none'` on the page means
 * a `fetch` from the renderer is blocked before it starts, so wiring an adapter up
 * without changing that would produce a feature that fails silently -- worse than one
 * that is visibly absent.
 */
export const DEAD_BY_DESIGN = {
  'integrations/GitHubSource.ts':
    'ARG event source. Deliberate scaffold: the README lists it as such. Blocked today by the page CSP, which sets connect-src to none.',
  'integrations/RSSSource.ts':
    'ARG event source. Deliberate scaffold: the README lists it as such. Blocked today by the page CSP, which sets connect-src to none.',
  'integrations/RemoteEventSource.ts':
    'ARG event source. Deliberate scaffold: the README lists it as such. Blocked today by the page CSP, which sets connect-src to none.',
};

/**
 * Modules that are not part of the shipped renderer but are still maintained.
 *
 * They are reachable from the test suite rather than from `main.ts`, and a test that
 * passes against code nothing runs is not evidence of anything -- it is the reason the
 * entry point is the right thing to measure reachability from. Listed here only so a
 * deliberate deletion is a one-line edit rather than an accident.
 */
export const TEST_ONLY = new Set([]);

function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * The import graph, as module-relative names.
 *
 * The sources import each other with the emitted `.js` extension while the files on
 * disk are `.ts`; TypeScript resolves the pair and so does this, or every module looks
 * like it imports nothing.
 */
export function importGraph(files) {
  const known = new Set(files.map(rel));
  const graph = new Map();

  const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const deps = [];
    for (const m of text.matchAll(IMPORT)) {
      const spec = m[1] || m[2];
      if (!spec || !spec.startsWith('.')) continue;
      // Resolved to an absolute path by the join, so it has to be put back into the
      // graph's own naming before it can be looked up or recorded.
      let target = rel(normalize(join(dirname(file), spec)));
      if (target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
      if (known.has(target)) deps.push(target);
    }
    graph.set(rel(file), [...new Set(deps)].sort());
  }
  return graph;
}

const rel = (f) => relative(SRC, f).split(/[\\/]/).join('/');
const normalize = (p) => p.split(/[\\/]/).join('/');

/** Modules reachable from `entry` by import, including the entry itself. */
export function reachableFrom(graph, entry = ENTRY) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const next = stack.pop();
    if (seen.has(next)) continue;
    seen.add(next);
    for (const dep of graph.get(next) ?? []) stack.push(dep);
  }
  return seen;
}

/**
 * Every dependency in package.json that nothing under `src/` imports.
 *
 * Only `dependencies`, not `devDependencies`: a build tool that nothing imports at
 * runtime is being invoked from a config file instead, and flagging those would be
 * noise. `better-sqlite3` was in `dependencies` and imported by exactly one file
 * that nothing imported, which is how a native Node module ended up a runtime
 * requirement of a browser bundle.
 */
export function unusedDependencies(declared, imported) {
  const used = new Set();
  for (const spec of imported) {
    if (!spec.startsWith('.')) {
      // `@scope/pkg/sub` -> `@scope/pkg`, `pkg/sub` -> `pkg`
      const parts = spec.split('/');
      used.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
  }
  return Object.keys(declared).filter((name) => !used.has(name)).sort();
}

/** Bare package specifiers imported anywhere under `src/`. */
export function bareImports(files) {
  const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g;
  const out = new Set();
  for (const file of files) {
    for (const m of readFileSync(file, 'utf8').matchAll(IMPORT)) {
      const spec = m[1] || m[2];
      if (spec && !spec.startsWith('.')) out.add(spec);
    }
  }
  return out;
}

/** Every problem with what is reachable, what is exempt, and what is declared. */
export function deadCodeProblems({ graph, declared = {}, dead = DEAD_BY_DESIGN, testOnly = TEST_ONLY }) {
  const problems = [];
  const reachable = reachableFrom(graph);

  for (const name of [...graph.keys()].sort()) {
    if (reachable.has(name)) continue;
    if (dead[name]) continue;
    if (testOnly.has(name)) continue;
    problems.push(
      `${name} is unreachable from ${ENTRY} and is not listed in DEAD_BY_DESIGN. ` +
      'Either it is finished work that was never wired up, or it is dead weight. Deleting is almost always right.'
    );
  }

  for (const name of Object.keys(dead).sort()) {
    if (!graph.has(name)) {
      problems.push(`DEAD_BY_DESIGN lists ${name}, which no longer exists. Delete the entry.`);
      continue;
    }
    if (reachable.has(name)) {
      problems.push(
        `${name} is listed as deliberately unreachable but is now reachable from ${ENTRY}. ` +
        'Delete the entry -- an exemption that outlives its reason reads as a permanent pass.'
      );
    }
  }

  const enginePkg = join(ENGINE, 'package.json');
  try {
    const declaredDeps = JSON.parse(readFileSync(enginePkg, 'utf8')).dependencies ?? {};
    const unused = unusedDependencies(declaredDeps, bareImports(tsFiles(SRC)));
    for (const name of unused) {
      problems.push(
        `package.json lists "${name}" as a runtime dependency and nothing under src/ imports it. ` +
        'A dependency nothing imports is installed on every machine and shipped in the lockfile for nothing.'
      );
    }
  } catch (err) {
    problems.push(`could not read ${relative(ROOT, enginePkg)}: ${err.message}`);
  }

  return problems;
}

// ---------------------------------------------------------------------------

function main() {
  const files = tsFiles(SRC);
  const graph = importGraph(files);
  const problems = deadCodeProblems({ graph });

  if (process.argv.includes('--selftest')) return selftest(files);

  process.stdout.write(`Graph of ${files.length} module(s) from ${ENTRY}.\n`);
  process.stdout.write(`  reachable: ${reachableFrom(graph).size}, deliberately not: ${Object.keys(DEAD_BY_DESIGN).length}\n`);
  if (problems.length === 0) {
    process.stdout.write('PASS  nothing unreachable ships, and no dependency is imported by nothing.\n');
    return 0;
  }
  for (const p of problems) process.stdout.write(`FAIL  ${p}\n`);
  process.stdout.write(`\n${problems.length} problem(s).\n`);
  return 1;
}

/**
 * The reachability walk is a graph traversal over regexes, and both parts can fail
 * quietly: a regex that stops matching makes every module look unreachable, and one
 * that matches too much makes everything look reachable. Both would leave the gate
 * green for the wrong reason, so the fixtures cover the walk itself, not just the
 * findings.
 */
function selftest(realFiles) {
  const realGraph = importGraph(realFiles);
  const cases = [];

  const fake = (edges) => new Map(Object.entries(edges));

  // --- the walk ------------------------------------------------------------
  cases.push({
    label: 'follows a chain of imports',
    expect: 4,
    got: reachableFrom(fake({
      'main.ts': ['a.ts'],
      'a.ts': ['b.ts'],
      'b.ts': ['c.ts'],
      'c.ts': [],
      'unrelated.ts': [],
    })).size,
  });

  cases.push({
    label: 'does not loop forever on a cycle',
    expect: 2,
    got: reachableFrom(fake({ 'main.ts': ['a.ts'], 'a.ts': ['main.ts'] })).size,
  });

  cases.push({
    label: 'finds a module that only a dead module imports',
    // The actual SQLitePersistence shape: reachable from nothing at all.
    expect: 0,
    got: reachableFrom(fake({ 'main.ts': [], 'sqlite.ts': [] })).has('sqlite.ts') ? 1 : 0,
  });

  // --- the exemptions -----------------------------------------------------
  cases.push({
    label: 'reports an unreachable module that is not exempt',
    expect: 1,
    got: deadCodeProblems({
      graph: fake({ 'main.ts': [], 'ghost.ts': [] }),
      dead: {},
    }).length,
  });

  cases.push({
    label: 'accepts an exempt module',
    expect: 0,
    got: deadCodeProblems({
      graph: fake({ 'main.ts': [], 'integrations/RSSSource.ts': [] }),
      dead: { 'integrations/RSSSource.ts': 'deliberate scaffold' },
    }).length,
  });

  cases.push({
    label: 'rejects an exemption for a module that is now wired up',
    expect: 1,
    got: deadCodeProblems({
      graph: fake({ 'main.ts': ['integrations/RSSSource.ts'], 'integrations/RSSSource.ts': [] }),
      dead: { 'integrations/RSSSource.ts': 'deliberate scaffold' },
    }).filter((p) => p.includes('now reachable')).length,
  });

  cases.push({
    label: 'rejects an exemption for a module that was deleted',
    expect: 1,
    got: deadCodeProblems({
      graph: fake({ 'main.ts': [] }),
      dead: { 'gone.ts': 'used to be deliberate' },
    }).filter((p) => p.includes('no longer exists')).length,
  });

  // --- the dependency rule -------------------------------------------------
  cases.push({
    label: 'reports a dependency nothing imports',
    expect: 1,
    got: unusedDependencies({ 'better-sqlite3': '^13.0.3' }, []).length,
  });

  cases.push({
    label: 'accepts a dependency something imports',
    expect: 0,
    got: unusedDependencies({ 'better-sqlite3': '^13.0.3' }, ['better-sqlite3']).length,
  });

  cases.push({
    label: 'matches a scoped package, and a subpath import of a package',
    expect: [],
    got: unusedDependencies(
      { '@scope/thing': '1', 'other': '2' },
      ['@scope/thing/sub', 'other/deep/path']
    ),
  });

  // --- and the real repository --------------------------------------------
  cases.push({ label: 'accepts the repository as it now stands', expect: 0, got: problemsForReal() });
  cases.push({
    label: 'still finds the five modules that were unreachable',
    expect: 0,
    got: [SQLITE, DAY_NIGHT].filter((m) => reachableFrom(realGraph).has(m) ? 1 : 0).length,
  });

  let failed = 0;
  for (const c of cases) {
    const ok = JSON.stringify(c.expect) === JSON.stringify(c.got);
    if (!ok) failed++;
    process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${c.label}  (expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(c.got)})\n`);
  }
  process.stdout.write(`\n${cases.length - failed}/${cases.length} self-test cases passed\n`);
  return failed === 0 ? 0 : 1;

  function problemsForReal() {
    return deadCodeProblems({ graph: importGraph(realFiles) }).length;
  }
}

/** The two modules this gate was written for, so the check cannot rot into a no-op. */
const SQLITE = 'platform/SQLitePersistence.ts';
const DAY_NIGHT = 'renderer/DayNightCycle.ts';

const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
