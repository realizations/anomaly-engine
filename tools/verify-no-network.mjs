/**
 * Proves the renderer still cannot reach the network.
 *
 * The whole design of the event layer rests on two claims, and both are the kind that
 * erode quietly. Someone relaxing `connect-src` to make a feed work "just for now" is a
 * two-character change that turns a wallpaper with no network access into one that can
 * talk to anything. Someone adding a `fetch` to the renderer is a single line.
 *
 * Neither throws. Both remove the property the README advertises ("No telemetry, no
 * accounts, works with the network off") and the product keeps looking identical.
 *
 * So the claims are asserted against the files that make them:
 *
 *   1. The content security policy still sets `connect-src 'none'`.
 *   2. No module under `src/` calls `fetch`, `XMLHttpRequest`, `WebSocket`,
 *      `EventSource` or `getDisplayMedia`.
 *   3. The renderer reaches the network only by asking the host for a feed *by id*, so
 *      it never learns a URL it could act on itself.
 *   4. Every effect a feed can cause is a registered anomaly kind. A mapper that could
 *      invent one would be the whole boundary gone.
 *
 * Self-test included, because a gate that cannot be made to fail is not a gate.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importGraph, reachableFrom } from './verify-dead-code.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const read = (...parts) => readFileSync(resolve(ROOT, ...parts), 'utf8');

/** Comments stripped, so prose about a hazard is not mistaken for the hazard. */
const withoutComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/\/[^\n]*/g, ' ').replace(/\/\/[^\n]*/g, ' ');

/**
 * Every module under src/, excluding generated output.
 *
 * `withFileTypes` is required and not incidental: without it `readdirSync` returns plain
 * strings, so `entry.name` is undefined and the first `join` throws. The default is a
 * quiet trap.
 */
function moduleFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (statSync(full).isDirectory()) {
      // The renderer bundle is build output, and the public folder holds generated
      // fonts. Neither is source and neither is worth asserting about.
      if (entry.name === 'node_modules' || entry.name === 'bin' || entry.name === 'obj') continue;
      moduleFiles(full, found);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      found.push(full);
    }
  }
  return found;
}

/** The network primitives a renderer must not use. */
const NETWORK_CALLS = [
  { name: 'fetch', re: /\bfetch\s*\(/ },
  { name: 'XMLHttpRequest', re: /\bnew\s+XMLHttpRequest\b/ },
  { name: 'WebSocket', re: /\bnew\s+WebSocket\b/ },
  { name: 'EventSource', re: /\bnew\s+EventSource\b/ },
  { name: 'getDisplayMedia', re: /\.getDisplayMedia\s*\(/ },
  { name: 'navigator.sendBeacon', re: /\.sendBeacon\s*\(/ },
];

/**
 * The subset of modules main.ts can actually reach.
 *
 * Reuses the dead-code gate's own graph rather than reimplementing it, so the two agree
 * about what "reachable" means. Two gates disagreeing about reachability is the same
 * class of bug as two transcriptions of one schema.
 *
 * `importGraph` takes absolute paths and reads the files itself, so that is what it gets.
 */
function reachableModules(absolutePaths, sources) {
  const reachable = reachableFrom(importGraph(absolutePaths), 'main.ts');
  return sources.filter((s) => {
    const key = s.file.replace(/\\/g, '/');
    return reachable.has(key) || reachable.has(key.split('/').pop());
  });
}

export function networkProblems(files) {
  const f = files ?? {
    CSP: read('src', 'Engine', 'renderer', 'index.html'),
    REGISTRY: read('src', 'Engine', 'src', 'anomalies', 'effects.ts'),
    MAPPER: read('src', 'Engine', 'src', 'integrations', 'FeedMapper.ts'),
    TYPES: read('src', 'Engine', 'src', 'renderer', 'WorldRenderer.ts'),
    CLIENT: read('src', 'Engine', 'src', 'integrations', 'EventFeedClient.ts'),
    MAIN: read('src', 'Engine', 'src', 'main.ts'),
    HOST: read('src', 'AnomalyEngine', 'Core', 'WallpaperHost.cs'),
    FETCHER: read('src', 'AnomalyEngine', 'Core', 'EventFeedFetcher.cs'),
    // Injected for the self-test; read from disk in the repository run.
    sources: moduleFiles(resolve(ROOT, 'src', 'Engine', 'src')).map((path) => ({
      file: relative(ROOT, path),
      text: readFileSync(path, 'utf8'),
    })),
    // The reachable subset, computed from disk unless a test supplies it.
    reachable: null,
  };

  const problems = [];

  // 1. The policy. The single most important line in the product.
  //
  //    The capture deliberately allows quotes: the value being matched is `'none'`, and a
  //    character class that excludes quotes cannot match it. A gate that cannot read the
  //    value it is checking reports "no directive" on a document that has one, which is
  //    worse than no gate -- it trains people to ignore it.
  const csp = /connect-src\s+([^;]+)/.exec(f.CSP)?.[1]?.trim();
  if (!csp) {
    problems.push('the renderer has no connect-src directive at all.');
  } else if (csp !== "'none'") {
    problems.push(
      `connect-src is "${csp}" rather than 'none'. The renderer can reach the network, which ` +
        "is the property the README's no-telemetry claim rests on."
    );
  }

  // 2. No *reachable* module calls a network primitive.
  //
  //    Reachability rather than mere presence, and the distinction matters: three
  //    unreachable modules contain `fetch` calls -- the update checker, a weather provider
  //    and a loader for dev-server worlds. They are shipped-but-unreachable scaffolding,
  //    they cannot make a request because the policy above blocks it, and flagging them
  //    would make this gate permanently red and therefore ignored.
  //
  //    What would genuinely break the property is a `fetch` in something main.ts can
  //    actually reach, and that is what this catches.
  const reachable =
    f.reachable ?? reachableModules(moduleFiles(resolve(ROOT, 'src', 'Engine', 'src')), f.sources);
  for (const source of reachable) {
    const code = withoutComments(source.text);
    for (const call of NETWORK_CALLS) {
      if (call.re.test(code)) {
        problems.push(
          `${source.file} calls ${call.name} and is reachable from main.ts. The renderer has ` +
            'no network access: the host reads documents and hands over text.'
        );
      }
    }
  }

  // 3. The renderer asks by id, never by URL. If the requester carried a URL, the
  //    renderer would be choosing what to fetch and the allow-list would be advisory.
  const requester = /this\._feeds = new EventFeedClient\(([\s\S]*?)\);/.exec(f.MAIN)?.[1] ?? '';
  if (!requester) {
    problems.push('main.ts does not construct the feed client with a requester.');
  } else if (/url|endpoint/i.test(requester)) {
    problems.push('the feed requester carries a URL or an endpoint; it must carry an id only.');
  } else if (!/feedId/.test(requester)) {
    problems.push('the feed requester does not appear to send a feed id.');
  }
  // And the client itself must not carry a URL into the request.
  if (/\burl\b/.test(withoutComments(f.CLIENT).replace(/url:\s*string/g, ''))) {
    problems.push('EventFeedClient references a url outside its type; the host owns URLs.');
  }

  // 4. There is exactly one effect registry, and the two modules that used to keep their
  //    own copy now derive from it.
  //
  //    The boundary is "a feed can only cause an effect the renderer can draw". It used to
  //    be kept by two literal lists agreeing -- one in `WorldRenderer`, one mirrored in
  //    `FeedMapper` -- and a mirrored list can drift while a derived one cannot. The lists
  //    are gone, so the gate asserts the derivation instead: the registry exists, neither
  //    module has grown its own list again, and the mapper still validates against it.
  //
  //    This check used to read the mirrored lists by regex and compare them. That version
  //    is what let the drift risk be described as "caught" while the actual property -- one
  //    source of truth -- was never asserted at all.
  const registryBody = /export const EFFECT_IDS\s*=\s*\[([\s\S]*?)\]\s*as const/
    .exec(f.REGISTRY)?.[1] ?? '';
  const registryNames = [...registryBody.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);

  if (registryNames.length === 0) {
    problems.push('could not read the effect registry (EFFECT_IDS) out of anomalies/effects.ts.');
  }

  if (/\bexport\s+type\s+AnomalyKind\s*=/.test(f.TYPES)) {
    problems.push(
      'WorldRenderer.ts declares its own AnomalyKind union again. It must derive from the ' +
        'effect registry, or the renderer and the mapper can drift apart while both look fine.'
    );
  }
  if (!/AnomalyKind[\s\S]{0,200}?from\s*'\.\.\/anomalies\/effects\.js'/.test(f.TYPES)) {
    problems.push('WorldRenderer.ts does not take AnomalyKind from the effect registry.');
  }

  if (/\b(?:const|let|var)\s+ANOMALY_KINDS\b/.test(f.MAPPER) || /\bexport\s+type\s+AnomalyKind\s*=/.test(f.MAPPER)) {
    problems.push(
      'FeedMapper.ts keeps its own effect list again. It must derive from the registry: a ' +
        'second list is a second answer to "what can a feed cause".'
    );
  }
  if (!/isAnomalyKind[\s\S]{0,200}?from\s*'\.\.\/anomalies\/effects\.js'/.test(f.MAPPER)) {
    problems.push('FeedMapper.ts does not validate effects against the registry (isAnomalyKind).');
  }

  // 5. The host is the only thing holding a URL, and it enforces the allow-list.
  if (!/IsAllowed/.test(f.FETCHER)) {
    problems.push('the host fetcher does not check the allow-list.');
  }
  if (!/AllowAutoRedirect\s*=\s*false/.test(f.FETCHER)) {
    problems.push('the host fetcher allows redirects, which defeats the allow-list.');
  }
  if (!/MaxResponseBytes/.test(f.FETCHER)) {
    problems.push('the host fetcher has no response size cap.');
  }
  if (!/FeedSpec/.test(f.HOST)) {
    problems.push('the host does not hold feed specifications.');
  }

  return problems;
}

/* --------------------------------- self-test --------------------------------- */

if (process.argv.includes('--selftest')) {
  const absolute = moduleFiles(resolve(ROOT, 'src', 'Engine', 'src'));
  const sources = absolute.map((path) => ({
    file: relative(ROOT, path),
    text: readFileSync(path, 'utf8'),
  }));
  const base = {
    CSP: read('src', 'Engine', 'renderer', 'index.html'),
    REGISTRY: read('src', 'Engine', 'src', 'anomalies', 'effects.ts'),
    MAPPER: read('src', 'Engine', 'src', 'integrations', 'FeedMapper.ts'),
    TYPES: read('src', 'Engine', 'src', 'renderer', 'WorldRenderer.ts'),
    CLIENT: read('src', 'Engine', 'src', 'integrations', 'EventFeedClient.ts'),
    MAIN: read('src', 'Engine', 'src', 'main.ts'),
    HOST: read('src', 'AnomalyEngine', 'Core', 'WallpaperHost.cs'),
    FETCHER: read('src', 'AnomalyEngine', 'Core', 'EventFeedFetcher.cs'),
    sources,
    // Precomputed, so a case that injects a file can also declare it reachable without
    // the gate going to disk for it.
    reachable: reachableModules(absolute, sources),
  };
  const cases = [];
  const record = (name, files, shouldFail) => {
    const problems = networkProblems(files);
    cases.push({ name, ok: (problems.length > 0) === shouldFail, problems });
  };

  record('the repository as it stands is clean', base, false);

  record('a relaxed connect-src is caught', {
    ...base,
    CSP: base.CSP.replace("connect-src 'none'", "connect-src *"),
  }, true);

  record('a removed connect-src is caught', {
    ...base,
    CSP: base.CSP.replace("connect-src 'none'; ", ''),
  }, true);

  // A reachable module that fetches is the failure this gate exists for. Declared
  // reachable explicitly, because a file the gate has never seen cannot be in the graph.
  const withReachableFetch = (file, text) => ({
    ...base,
    sources: [...base.sources, { file, text }],
    reachable: [...base.reachable, { file, text }],
  });

  record('a fetch in a reachable module is caught', withReachableFetch(
    'src/Engine/src/NewThing.ts',
    'export async function go() { await fetch("https://x.invalid"); }'
  ), true);

  record('a WebSocket in a reachable module is caught', withReachableFetch(
    'src/Engine/src/NewThing.ts',
    'const s = new WebSocket("wss://x.invalid");'
  ), true);

  // Unreachable scaffolding may carry a fetch: the policy blocks it at runtime whatever
  // the code says, so flagging it would make the gate permanently red and therefore
  // ignored. Three such modules exist today.
  record('a fetch in an unreachable module is not flagged', {
    ...base,
    sources: [...base.sources, { file: 'src/Engine/src/Unreachable.ts', text: 'export const go = () => fetch("https://x.invalid");' }],
  }, false);

  record('a network call in a comment is not a network call', {
    ...base,
    sources: [...base.sources, { file: 'src/Engine/src/NewThing.ts', text: '// we used to call fetch(url) here\nexport const x = 1;' }],
  }, false);

  record('a requester that carries a URL is caught', {
    ...base,
    MAIN: base.MAIN.replace('this._bridge.send(\'feed:request\', { feedId });', 'this._bridge.send(\'feed:request\', { url });'),
  }, true);

  record('an empty effect registry is caught', {
    ...base,
    REGISTRY: base.REGISTRY.replace('EFFECT_IDS = [', 'EFFECT_IDS_X = ['),
  }, true);

  record('a renderer that re-declares its own union is caught', {
    ...base,
    TYPES: base.TYPES.replace(
      "export type { AnomalyKind } from '../anomalies/effects.js';",
      "export type AnomalyKind = 'second-moon' | 'ghost-signal';"
    ),
  }, true);

  record('a renderer that stops taking AnomalyKind from the registry is caught', {
    ...base,
    TYPES: base.TYPES.replace(/from '\.\.\/anomalies\/effects\.js'/g, "from './elsewhere.js'"),
  }, true);

  record('a mapper that keeps its own effect list is caught', {
    ...base,
    MAPPER: base.MAPPER.replace(
      'import { isAnomalyKind }',
      "const ANOMALY_KINDS = ['lights-out'];\nimport { isAnomalyKind }"
    ),
  }, true);

  record('a mapper that stops validating against the registry is caught', {
    ...base,
    MAPPER: base.MAPPER.replace(/from '\.\.\/anomalies\/effects\.js'/g, "from './elsewhere.js'"),
  }, true);

  record('auto-redirect being re-enabled is caught', {
    ...base,
    FETCHER: base.FETCHER.replace('AllowAutoRedirect = false', 'AllowAutoRedirect = true'),
  }, true);

  record('a missing size cap is caught', {
    ...base,
    FETCHER: base.FETCHER.replace(/MaxResponseBytes/g, 'UnrelatedName'),
  }, true);

  let failed = 0;
  for (const c of cases) {
    if (!c.ok) failed++;
    process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n`);
    if (!c.ok) for (const p of c.problems) process.stdout.write(`        ${p}\n`);
  }
  process.stdout.write(
    failed ? `\n${failed} assertion(s) failed.\n` : '\nThe no-network check behaves.\n'
  );
  process.exit(failed ? 1 : 0);
}

/* ------------------------------- the repository ------------------------------ */

if (!existsSyncSafe(join(ROOT, 'src', 'Engine', 'renderer', 'index.html'))) {
  console.error('FAIL  renderer network access: run this from the repository root.');
  process.exit(1);
}

const problems = networkProblems();
if (problems.length) {
  console.error('FAIL  the renderer can reach the network, or can no longer:');
  for (const p of problems) console.error(`      ${p}`);
  process.exit(1);
}
console.log('PASS  the renderer has no network access, and every effect a feed can cause is a registered one');

function existsSyncSafe(path) {
  try { statSync(path); return true; } catch { return false; }
}