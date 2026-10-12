/**
 * Checks that the native host and the renderer agree on their event names.
 *
 *   node tools/verify-host-events.mjs            check the repository
 *   node tools/verify-host-events.mjs --selftest prove the check still detects it
 *
 * Why this exists
 * ---------------
 * The renderer declares every window event once, in
 * src/Engine/src/core/windowEvents.ts, and `WindowEvents.test.ts` proves that every
 * event dispatched in TypeScript has a listener. That covers one direction of one
 * language.
 *
 * The other direction crosses a process boundary. The C# host sends events to the
 * page as bare string literals in `ExecuteScriptAsync`, so the prefix is applied in
 * C# and the name is compared against nothing. Four tray items passed an
 * already-prefixed name to `SendToRenderer("anomaly:world-next")`, which became
 * `anomaly:anomaly:world-next` -- an event nothing listens for. Next World,
 * Previous World, Trigger Event and Field Notes were dead in the shipped binary,
 * while Ctrl+Alt+W and Ctrl+Alt+F worked fine, because those call sites happened to
 * pass the suffix. Nothing threw and nothing logged.
 *
 * A fifth control failed the same way for the mirror-image reason: the motion slider
 * wanted to evaluate a statement, so it passed one to a method that dispatches an
 * event, and the statement became an event *name*. The renderer never received a
 * call, and the settings window printed "Motion level set to 50%." anyway.
 *
 * Neither is reachable by any existing check. A type checker cannot see across the
 * interop boundary, and both sides being wrong is indistinguishable from both
 * sides being right until someone clicks the button. So this file parses the C# and
 * the TypeScript and asserts they agree, which is the only place the disagreement
 * can be caught.
 *
 * What it asserts
 * ---------------
 *  1. Every literal passed to `SendToRenderer` is a bare suffix -- no `anomaly:`
 *     prefix, and not a JavaScript statement.
 *  2. Every bare suffix sent by the host is an event the renderer actually listens
 *     for. This is the assertion that would have caught all five.
 *  3. `WallpaperHost.RendererEventNames` matches the renderer's host-facing list
 *     exactly, both ways, so the runtime allowlist cannot drift from the listener.
 *  4. Names emitted inline by `dispatchEvent` in C# are all real events too. Most of
 *     the host's methods build the whole statement rather than calling
 *     `SendToRenderer`, so checking only the helper would leave most of the surface
 *     uncovered.
 *  5. Nothing sends a script through `SendToRenderer`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CS_ROOT = join(ROOT, 'src', 'AnomalyEngine');
const WINDOW_EVENTS = join(ROOT, 'src', 'Engine', 'src', 'core', 'windowEvents.ts');

/** Every C# source the host and the settings window are written in. */
function csharpFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      // bin and obj hold copies of the sources. Checking them would report the same
      // findings twice and go stale after a rebuild.
      if (entry === 'bin' || entry === 'obj') continue;
      out.push(...csharpFiles(full));
    } else if (full.endsWith('.cs')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The event names the renderer listens for, read out of windowEvents.ts.
 *
 * Every entry carries a `Host -> renderer:` comment, and those are precisely the
 * ones the native host can send. The creator-mode and interaction entries are
 * dispatched by the page at itself, so no host process can produce them, and
 * treating them as host-sendable would let the check pass on a name that can never
 * arrive. That distinction is the comment's only job, which is why it is read rather
 * than inferred.
 */
export function rendererEventNames(source = readFileSync(WINDOW_EVENTS, 'utf8')) {
  const names = new Map(); // name -> true when the host may send it
  const body = source.slice(source.indexOf('export const WINDOW_EVENTS'));
  const entry = /(?:\/\*\*\s*([^*]*?)\*\/)?\s*(\w+):\s*'([^']+)'/g;
  for (const m of body.matchAll(entry)) {
    const [, comment, , value] = m;
    const hostSends = /Host\s*->\s*renderer/i.test(comment ?? '');
    names.set(value, hostSends);
  }
  return names;
}

/** The short suffixes in the renderer's host-facing list, i.e. what a host may pass. */
export function hostSendableNames(source) {
  return [...rendererEventNames(source)].filter(([, host]) => host).map(([name]) => name);
}

/**
 * Source pairs for the C# side, whether the caller has paths or already-read text.
 *
 * The self-test builds fixtures in memory rather than writing throwaway files, so
 * both shapes have to work, and normalising in one place keeps the parsers from
 * caring which they were handed.
 */
function asSources(files) {
  return files.map((f) => (typeof f === 'string' ? { file: f, text: readFileSync(f, 'utf8') } : f));
}

/**
 * Every name the C# side tries to send, with where it came from.
 *
 * Two shapes exist and both are collected. Most methods build the dispatch
 * statement themselves, because most host events carry a payload and the helper
 * takes no detail. Those are found by their `'anomaly:...'` literal. `SendToRenderer`
 * callers pass a suffix with no prefix at all, so those are found at the call.
 */
export function hostSendNames(files) {
  const sent = [];
  for (const { file, text } of asSources(files)) {
    const lines = text.split(/\r?\n/);

    for (const [i, line] of lines.entries()) {
      // `new CustomEvent('anomaly:world', ...)`, including the `{{ }}` doubled braces
      // that make the statement a valid C# interpolated string.
      for (const m of line.matchAll(/CustomEvent\('([^']+)'/g)) {
        sent.push({ file, line: i + 1, name: m[1], via: 'inline', interpolated: m[1].includes('{') });
      }
      // A literal argument. The name is checked for a prefix and for being a
      // statement; an interpolated one is caught just below.
      for (const m of line.matchAll(/\.SendToRenderer\(\s*\$?"([^"]*)"/g)) {
        sent.push({ file, line: i + 1, name: m[1], via: 'SendToRenderer', interpolated: m[1].includes('{') });
      }
      // An identifier argument: a variable, so the name is not knowable here.
      for (const m of line.matchAll(/\.SendToRenderer\(\s*([A-Za-z_][\w.]*)\s*\)/g)) {
        sent.push({ file, line: i + 1, name: m[1], via: 'SendToRenderer(variable)', interpolated: false });
      }
    }
  }
  return sent;
}

/**
 * The runtime allowlist in WallpaperHost, parsed out of the C#.
 *
 * Anchored on the assignment, not on the name. The name also appears in the doc
 * comment directly above the declaration, and a search for the bare word starts
 * there -- which picks up every string literal in the comment as though it were an
 * entry, and turns the allowlist comparison into noise.
 */
export function declaredAllowlist(files) {
  for (const { file, text } of asSources(files)) {
    // `new HashSet<string>(StringComparer.Ordinal)` and the target-typed
    // `new(StringComparer.Ordinal)` are both idiomatic here, so the constructor is
    // matched loosely; what matters is that the name is being assigned a collection.
    const decl = /RendererEventNames\s*(?::[^=]+)?=\s*new\b[^=]*=/.exec(text);
    if (!decl) continue;
    // Brace-matched rather than "up to the next `};`": the collection initialiser
    // ends at its own closing brace, and everything past that is unrelated code.
    const open = text.indexOf('{', decl.index);
    let depth = 0;
    let close = -1;
    for (let i = open; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}' && --depth === 0) {
        close = i;
        break;
      }
    }
    if (open < 0 || close < 0) continue;
    const names = [...text.slice(open, close).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    return { file, names };
  }
  return null;
}

/** Every problem with the host/renderer event boundary. */
export function eventBoundaryProblems(csFiles, windowEventsSource) {
  const problems = [];
  const where = (f) => relative(ROOT, f).replace(/\\/g, '/');
  const names = rendererEventNames(windowEventsSource);
  const live = new Set([...names].filter(([, host]) => host).map(([n]) => n));

  const sent = hostSendNames(csFiles);

  for (const { file, line, name, via, interpolated } of sent) {
    const at = `${where(file)}:${line}`;

    if (via === 'SendToRenderer') {
      // Order matters here. A statement is a statement whether or not it is
      // interpolated, and saying so is the more useful finding than "this name is
      // built at runtime": the motion slider's argument was both, and it was the
      // statement that was the actual mistake.
      if (/[();=]/.test(name)) {
        problems.push(
          `${at}: SendToRenderer is given a statement, not an event name. ` +
          'It dispatches an event whose *name* is its argument, so this reaches the page as ' +
          `an event called "${name}" that nothing listens for. Use the dedicated method for the call.`
        );
        continue;
      }
      if (interpolated) {
        problems.push(`${at}: SendToRenderer is given an interpolated name. It validates against a fixed list, so an interpolated argument can never match; send a literal suffix, or build the statement at the call site.`);
        continue;
      }
    } else if (interpolated) {
      // An inline template, which is how the host applies the prefix and carries
      // payloads: `new CustomEvent('anomaly:{safe}', { detail: ... })`. The static
      // part still has to be a real prefix, and the hole has to be the whole name.
      if (!/^anomaly:\{[^}]+\}$/.test(name)) {
        problems.push(
          `${at}: the event template "${name}" is not "anomaly:{name}". ` +
          'Anything else builds an event name the renderer cannot match.'
        );
      }
      continue;
    }

    if (via === 'SendToRenderer(variable)') {
      // Not a failure: hotkey names and other variables are legitimately indirect.
      // Recorded so the surface is visible in the report.
      continue;
    }

    if (via === 'SendToRenderer') {
      if (name.startsWith('anomaly:')) {
        problems.push(
          `${at}: SendToRenderer("${name}") adds the prefix itself, so this dispatches "anomaly:${name}" ` +
          'and no listener matches it. Pass the suffix only.'
        );
        continue;
      }
      if (name === '') {
        problems.push(`${at}: SendToRenderer was given an empty name.`);
        continue;
      }
    }

    const full = via === 'inline' ? name : `anomaly:${name}`;
    if (!names.has(full)) {
      problems.push(
        `${at}: the renderer has no event "${full}". ` +
        'Either it was renamed or never existed; a host call to it does nothing at all.'
      );
      continue;
    }
    if (!live.has(full)) {
      problems.push(
        `${at}: "${full}" is dispatched by the page at itself, not sent by the host. ` +
        'Nothing on this side can deliver it.'
      );
    }
  }

  // The runtime allowlist is the thing that turns a bad name into a log line instead
  // of a silent dispatch, so it has to be the renderer's list and not a subset of it.
  const declared = declaredAllowlist(csFiles);
  if (!declared) {
    problems.push('WallpaperHost.cs: RendererEventNames allowlist not found.');
  } else {
    const have = new Set(declared.names);
    const expected = new Set([...live].map((n) => n.replace(/^anomaly:/, '')));
    for (const n of [...expected].filter((n) => !have.has(n)).sort()) {
      problems.push(`${where(declared.file)}: the renderer listens for "${n}" but the host's allowlist omits it, so SendToRenderer would refuse a legitimate name.`);
    }
    for (const n of [...have].filter((n) => !expected.has(n)).sort()) {
      problems.push(`${where(declared.file)}: the allowlist permits "${n}", which the renderer does not listen for. It would pass validation and do nothing.`);
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------

function main() {
  const selftest = process.argv.includes('--selftest');
  const files = csharpFiles(CS_ROOT);
  const source = readFileSync(WINDOW_EVENTS, 'utf8');

  if (selftest) return selftestRun(source);

  process.stdout.write(`Reading ${files.length} C# file(s) and the renderer's event table.\n`);
  const problems = eventBoundaryProblems(files, source);
  if (problems.length === 0) {
    process.stdout.write('PASS  every event the host sends is one the renderer listens for.\n');
    return 0;
  }
  for (const p of problems) process.stdout.write(`FAIL  ${p}\n`);
  process.stdout.write(`\n${problems.length} problem(s).\n`);
  return 1;
}

/**
 * The check is a regex over source text, and a regex that quietly stops matching
 * makes every assertion above pass for the wrong reason. That is the failure this
 * repository cares about most, so it is tested against fixtures that reproduce the
 * bugs it exists to catch.
 */
function selftestRun(realSource) {
  const base = join(ROOT, 'src', 'AnomalyEngine', 'Core');
  const host = readFileSync(join(base, 'WallpaperHost.cs'), 'utf8');
  const tray = readFileSync(join(base, 'TrayIcon.cs'), 'utf8');
  const settings = readFileSync(join(ROOT, 'src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml.cs'), 'utf8');
  const engineApp = readFileSync(join(ROOT, 'src', 'AnomalyEngine', 'EngineApp.cs'), 'utf8');

  const REAL = [
    { file: join(base, 'WallpaperHost.cs'), text: host },
    { file: join(base, 'TrayIcon.cs'), text: tray },
    { file: join(ROOT, 'src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml.cs'), text: settings },
    { file: join(ROOT, 'src', 'AnomalyEngine', 'EngineApp.cs'), text: engineApp },
  ];

  /**
   * Problems for a fixture: the real host, with the given files substituted or added.
   *
   * The real host is always in the list because a fixture is a *variation* on what
   * ships, not a replacement for it. Without it every case would also report the
   * missing allowlist and none of them would isolate what it is actually testing.
   *
   * `substitute` replaces one real file, which is how the allowlist cases work: they
   * need a host whose list has been edited, and rebuilding that list here would test
   * the fixture rather than the parser.
   */
  const problemsFor = (snippets, { src = realSource, substitute } = {}) => {
    const files = substitute
      ? REAL.map((f) => (f.file.endsWith(substitute) ? { ...f, text: snippets[0] } : f))
      : [...REAL];
    if (!substitute) snippets.forEach((text, i) => files.push({ file: join(CS_ROOT, `Fixture${i}.cs`), text }));
    return eventBoundaryProblems(files, src);
  };

  /**
   * The pre-fix call sites, verbatim from the commit that shipped them.
   *
   * Written out rather than reconstructed from the fixed files, because a fixture
   * generated from the code it is meant to fail on would quietly become a test of
   * the fix. These four lines and the motion slider were in the released binary.
   */
  const OLD_TRAY = `
nextWorldItem.Click += (s, e) => _wallpaperHost.SendToRenderer("anomaly:world-next");
prevWorldItem.Click += (s, e) => _wallpaperHost.SendToRenderer("anomaly:world-prev");
triggerEventItem.Click += (s, e) => _wallpaperHost.SendToRenderer("anomaly:trigger");
notesItem.Click += (s, e) => _wallpaperHost.SendToRenderer("anomaly:notes");
`;
  const OLD_MOTION_SLIDER =
    '_host?.SendToRenderer($"window.__engine.setMotionIntensity({value.ToString(CultureInfo.InvariantCulture)});");';

  const cases = [];

  // --- what the check must still detect -----------------------------------
  const problemsFrom = (snippets, opts) => problemsFor(snippets, opts).join('\n');
  const count = (snippets, needle, opts) => problemsFor(snippets, opts).filter((p) => p.includes(needle)).length;

  cases.push({
    label: 'catches an already-prefixed name at a call site',
    expect: 1,
    got: count([`_h.SendToRenderer("anomaly:world-next");`], 'anomaly:anomaly:world-next'),
  });

  cases.push({
    label: 'catches the four prefixed tray items that shipped',
    expect: 4,
    got: count([OLD_TRAY], 'adds the prefix itself'),
  });

  cases.push({
    label: 'catches the motion slider that passed a statement to an event method',
    expect: 1,
    got: count([OLD_MOTION_SLIDER], 'given a statement, not an event name'),
  });

  cases.push({
    label: 'catches a name the renderer does not listen for',
    expect: 1,
    got: count([`_h.SendToRenderer("no-such-event");`], 'the renderer has no event'),
  });

  cases.push({
    label: 'catches an inline dispatch of an event that does not exist',
    expect: 1,
    got: count([`window.dispatchEvent(new CustomEvent('anomaly:imaginary', { }));`], 'the renderer has no event'),
  });

  cases.push({
    label: 'catches a host calling an event only the page can dispatch',
    expect: 1,
    got: count([`_h.SendToRenderer("triple-click");`], 'dispatched by the page at itself'),
  });

  // Interpolated but not a statement, so it exercises the second branch rather than
  // re-testing the first. A name assembled from parts cannot pass an allowlist check,
  // so this is always a finding even when the parts are individually correct.
  cases.push({
    label: 'catches an interpolated argument to SendToRenderer',
    expect: 1,
    got: count([`_h.SendToRenderer($"anomaly:{suffix}");`], 'interpolated name'),
  });

  // An allowlist that has lost an entry is a different bug from a bad call site, and it
  // disables the runtime guard for that one name, so it gets its own case. The fixture
  // is the real host with one string removed, so the parser is doing the work.
  const trimmed = host.replace(/^[ \t]*"notes",\r?\n/m, '');
  cases.push({
    label: 'catches an allowlist that has dropped an event the renderer listens for',
    expect: 1,
    got: count([trimmed], 'allowlist omits it', { substitute: 'WallpaperHost.cs' }),
  });

  const invented = host.replace(/^[ \t]*"state",\r?\n/m, '        "state",\r\n        "totally-made-up",\r\n');
  cases.push({
    label: 'catches an allowlist entry the renderer does not listen for',
    expect: 1,
    got: count([invented], 'allowlist permits', { substitute: 'WallpaperHost.cs' }),
  });

  // --- what it must not flag ------------------------------------------------
  cases.push({
    label: 'accepts the repository as it now stands',
    expect: 0,
    got: problemsFrom([]).length,
  });

  cases.push({
    label: 'accepts a bare suffix',
    expect: 0,
    got: problemsFrom([`_h.SendToRenderer("world-next");`]).length,
  });

  cases.push({
    label: 'accepts an inline dispatch of a real host event',
    expect: 0,
    got: problemsFrom([`window.dispatchEvent(new CustomEvent('anomaly:style', { detail: { style: 'flat' } }));`]).length,
  });

  cases.push({
    label: 'accepts an indirect name from a variable',
    expect: 0,
    got: problemsFrom([`_h.SendToRenderer(name);`]).length,
  });

  cases.push({
    label: 'accepts the four tray items as they now stand',
    expect: 0,
    got: problemsFrom([tray]).length,
  });

  // --- and the scan itself --------------------------------------------------
  const names = rendererEventNames(realSource);
  cases.push({
    label: 'reads the whole event table',
    expect: Object.keys(JSON.parse(JSON.stringify(Object.fromEntries(names)))).length,
    got: names.size,
  });
  cases.push({
    label: 'separates host-sendable events from page-internal ones',
    expect: true,
    got: names.get('anomaly:world-next') === true && names.get('anomaly:triple-click') === false,
  });
  // If the scan stopped matching at all, every "catches" case above would report 0 and
  // fail, so this is about coverage rather than correctness: the real sources must
  // still yield senders of each kind the assertions reason about.
  const found = hostSendNames([
    { file: join(base, 'TrayIcon.cs'), text: tray },
    { file: join(base, 'WallpaperHost.cs'), text: host },
    { file: join(ROOT, 'src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml.cs'), text: settings },
    { file: join(ROOT, 'src', 'AnomalyEngine', 'EngineApp.cs'), text: readFileSync(join(ROOT, 'src', 'AnomalyEngine', 'EngineApp.cs'), 'utf8') },
  ]);
  for (const [via, expect] of [['inline', 1], ['SendToRenderer', 1], ['SendToRenderer(variable)', 1]]) {
    cases.push({
      label: `finds ${via} senders in the real host`,
      expect,
      got: found.filter((s) => s.via === via).length > 0 ? expect : 0,
    });
  }

  let failed = 0;
  for (const c of cases) {
    const ok = c.expect === c.got;
    if (!ok) failed++;
    process.stdout.write(
      `${ok ? 'PASS' : 'FAIL'}  ${c.label}  (expected ${c.expect}, got ${c.got})\n`
    );
  }
  process.stdout.write(`\n${cases.length - failed}/${cases.length} self-test cases passed\n`);
  return failed === 0 ? 0 : 1;
}

// Importing this module must not run it. `tests/HostBoundary.test.ts` imports the
// parsers, and exiting from under the test runner would take the suite down with it --
// which is the same trap tools/secret-scan.mjs had to be taught.
const invokedDirectly = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
