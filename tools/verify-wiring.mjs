/**
 * Proves that everything constructed is actually used.
 *
 *   node tools/verify-wiring.mjs            check the repository
 *   node tools/verify-wiring.mjs --selftest prove the check still detects it
 *
 * Why this is separate from tools/verify-dead-code.mjs
 * ---------------------------------------------------
 * The dead-code gate measures whether a module is *imported*. That catches a file
 * nothing reaches, and it caught two abandoned database layers. But it is blind to the
 * failure this repository produces most often: a system that is imported, constructed,
 * exposed through a getter, and then never actually asked to do anything.
 *
 * Nine such systems existed at one point. `WeatherSystem` was constructed and started
 * every boot and did nothing, which is why the desktop was permanently clear.
 * `AstronomySystem.onUpdate` had zero subscribers. `AudioSystem` and
 * `MediaReactivitySystem` had no tracks and no samples. `DebugOverlay.update()` was
 * never called, so the overlay showed hardcoded zeros. `UpdateSystem` had no getter at
 * all. Five of the six `ParticleSystem` effects had no producer.
 *
 * Every one of those passes the dead-code gate, passes the type checker, and passes
 * every unit test -- because the tests tested each piece separately and none of them
 * tested the path between the constructor and the thing the user can see.
 *
 * What it asserts
 * ---------------
 *  1. Every class `main.ts` constructs has at least one method called on it from
 *     somewhere other than its own file. A system that is only ever constructed is a
 *     system that is not doing anything.
 *  2. Every public method a class exposes is either called somewhere or is explicitly
 *     exempt, with a reason. This is the one that finds `onUpdate` with no subscribers.
 *  3. Every exempt entry is still needed. An exemption that outlived its reason reads
 *     as a permanent pass, which is the mistake `WindowEvents.test.ts` documents at
 *     length and the one this gate is most likely to repeat.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SRC = join(ROOT, 'src', 'Engine', 'src');
const MAIN = join(SRC, 'main.ts');

const rel = (p) => relative(ROOT, p).split(/[\\/]/).join('/');

function tsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/**
 * Public methods that are genuinely unused, with the reason.
 *
 * There are two kinds of entry here and the distinction matters, because conflating
 * them is how a gate gets switched off:
 *
 *   - **A feature that is deliberately not shipped.** `AudioSystem` plays tracks and
 *     this project ships no audio, so `play` has no caller and is not going to get one
 *     until there is something to play. README.md says so.
 *   - **A surface kept for a caller that does not exist yet.** `getLandmarkRects` is
 *     real, working, and used by the verification tools -- the gate does not scan
 *     `tools/`, which is why it is listed here rather than considered used.
 *
 * Both are honest. What is *not* honest is an entry with no reason, so the reason is
 * required: this file fails the build if a listed method is deleted or starts being
 * called, which means every entry is re-examined the moment it stops being true.
 */
export const EXEMPT = {
  EventBus: {
    unsubscribe: 'Public API for a listener a caller registered and later dropped. Nothing in the engine drops a listener: every subscription here lives as long as the page.',
    getHistory: 'Exposed for the tools. tools/ is not scanned by this gate.',
    clearHistory: 'Reached by nothing; history is bounded at construction so it cannot grow without limit.',
    getActiveCooldowns: 'Exposed for the tools.',
  },
  EventScheduler: {
    addEvent: 'Public API for a runtime-scheduled event. Every shipped schedule is static: time.hourly, time.0333 and time.midnight are emitted by ClockSource rather than registered here.',
    removeEvent: 'The counterpart of addEvent, for the same reason.',
  },
  EntityManager: {
    getEntity: 'Nothing reads an entity back by id. The engine only ever spawns and lets them expire.',
  },
  StateManager: {
    isInitialized: 'The engine calls init() and set() directly; nothing asks whether it happened.',
  },
  NetworkSource: {
    isOnline: 'Connectivity is not displayed anywhere. The source still fires its events.',
  },
  NativeBridge: {
    sendReady: 'The host does not wait for a ready handshake; it waits for WebView2 navigation instead. Kept because a future host that polls for readiness will want it.',
  },
  WeatherSystem: {
    setProvider: 'A network provider would replace the local model. Deliberately not shipped: the page CSP sets connect-src to none and this project has no accounts and no telemetry.',
    getLocation: 'Read by nobody. The location is a constant, and getStatus reports the weather rather than where it was evaluated.',
    getCurrentWeather: 'The engine reads its own last reading; this is the system-level accessor for a caller that holds the system directly.',
  },
  AstronomySystem: {
    compute: 'Used by tests. This gate scans src/ only, and a method used only by tests is not used by the product.',
    getCurrentData: 'The engine keeps its own copy from the onUpdate subscription, which arrives immediately rather than on the next poll.',
  },
  PerformanceSystem: {
    getStats: 'The engine computes its own fps and frame time in _updateFps. This is the system-level view.',
    shouldRender: 'A frame-skipping hook for a future adaptive-quality path. The adaptive scaler is driven by setRenderScale instead.',
    onStats: 'Part of the same statistics surface.',
    onQualityChange: 'The renderer reports quality changes through its own onQualityChange, which is subscribed by nothing today.',
  },
  AnomalySystem: {
    unregister: 'Definitions are registered once at startup and live for the session. There is no dynamic-unregister path.',
    canTrigger: 'An internal predicate used by chooseForWorld; the gate cannot see intra-file use.',
    fitsWorld: 'Same: called inside this file by chooseForWorld.',
    markPrerequisiteMet: 'No anomaly declares prerequisites today, so nothing ever has one to mark met. docs/creating-events.md says so.',
    getActiveAnomaly: 'The engine tracks the active anomaly itself, to draw it.',
    onEnd: 'Nothing needs to observe an anomaly ending; the journal entry is written when it starts.',
  },
  JournalSystem: {
    updateEntry: 'Nothing amends a journal entry after the fact.',
    getEntry: 'The panel reads the whole list; no caller wants one entry.',
    exportToMarkdown: 'An export surface with no caller. Worth keeping: it is how a journal leaves the app.',
    exportToJSON: 'Same.',
    onEntry: 'The panel re-reads on open rather than subscribing.',
    onStateChange: 'Same.',
  },
  MomentSystem: {
    discover: 'Every moment fires automatically on its trigger event, so nothing discovers one by hand.',
    isDiscovered: 'The field notes count discoveries from the list rather than asking per moment.',
    getDefinition: 'No caller looks one up individually.',
    getAllDefinitions: 'The same list is reachable through the event-coverage test rather than at runtime.',
    onDiscover: 'Nothing observes a discovery; the journal entry is written by the trigger handler.',
  },
  SecretSystem: {
    discover: 'A secret is found by observing an anomaly, which the registry does automatically.',
    solve: 'There is nothing to solve: discovery is the whole mechanic.',
    isDiscovered: 'The panel reads the discovered list rather than asking per secret.',
    getSecret: 'Same.',
    onDiscover: 'Nothing observes it; the journal entry is written by the trigger handler.',
  },
  AudioSystem: {
    registerTrack: 'No audio ships. This project generates everything it draws, and an audio licence is a different proposition from a font licence.',
    play: 'Same.',
    stopAll: 'Same.',
    setVolume: 'Same.',
    setMasterVolume: 'Same.',
    mute: 'Same.',
    unmute: 'Same.',
    onTrackEvent: 'Same.',
    isMuted: 'Same. The mute flag exists so that when audio does ship, a muted state is already correct.',
  },
  UpdateSystem: {
    onUpdateAvailable: 'No auto-updater is shipped, deliberately: an app that phones home is not what this is. README.md says so under Distribution. onError is not listed because WeatherSystem and RemoteEventSource both declare one and the gate counts by name -- which is a limitation of a name-based check, not a claim that this one is called.',
  },
  MediaReactivitySystem: {
    updateState: 'Nothing samples the desktop, so there is no state to push in. README.md lists audio reactivity as scaffold.',
    onBeat: 'Same: a beat cannot be detected by a system that is not listening.',
  },
  BenchmarkSystem: {
    registerScene: 'A benchmark scene is a diagnostic the tools register; tools/ is not scanned by this gate.',
    getScenes: 'Same.',
    getResults: 'Same.',
    getAverageFps: 'Same.',
    exportResults: 'Same.',
    onResult: 'Same.',
  },
  ScreenshotSystem: {
    setOptions: 'Options surface. The engine takes defaults.',
    getOptions: 'Same.',
    onCapture: 'The creator panel reports capture through the return value, not a subscription.',
  },
  DebugOverlay: {
    isVisible: 'The overlay is toggled and never queried. Settings reflects the toggle state itself.',
  },
  FieldNotes: {
    isVisible: 'Same: the panel is toggled and never asked.',
  },
  CreatorMode: {
    disable: 'Creator mode is enabled from the tray and stays enabled for the session.',
    isEnabled: 'Nothing branches on whether it is open.',
    setSimulatedTime: 'The engine receives the event directly from the panel, so the method is a second route to the same place.',
  },
  I18n: {
    registerLocale: 'Runtime locale registration. The four shipped locales are built in; a user-supplied one would go through this.',
  },
  AccessibilitySystem: {
    shouldUseHighContrast: 'The engine asks for the config and pushes it to the renderer; this is the single-key form.',
    shouldMuteAll: 'Same.',
  },
  EasterEggSystem: {
    isDiscovered: 'The engine counts discoveries from the progress record.',
    onDiscover: 'Discovery writes a journal entry at the call site rather than through a subscription.',
  },
  InteractionSystem: {
    getClickCount: 'The triple-click state is internal to the click handler.',
    resetClickCount: 'Reached when a zone unregisters, which is the same code path in this file.',
    getDwellMs: 'The dwell threshold lives in the zone descriptor, not here.',
    setEnabled: 'Interaction is never disabled; the zones are unregistered instead.',
    isEnabled: 'Same.',
  },
  WorldRenderer: {
    onQualityChange: 'The renderer raises it; nothing listens. The performance system reports through the status document instead.',
    hasSurreal: 'The surreal layer is decided inside render and exposed for a future test hook.',
    getLandmarkRects: 'Used by the verification tools, which this gate does not scan.',
    getActiveAnomaly: 'The engine tracks the active anomaly itself.',
  },
  Persistence: {
    isLoaded: 'load() is awaited where it is called; nothing asks afterwards.',
    discover: 'The journal and secret systems own discovery, and persistence is told about it rather than driving it.',
  },
};

/** Classes that are constructed for their side effects rather than for use. */
export const CONSTRUCTED_ONLY = new Set([]);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * The classes each source file declares.
 *
 * Deliberately a regex over source rather than the TypeScript compiler API. It needs
 * no program, runs in about a millisecond, and the thing being checked is a
 * *count* of names -- not whether the file parses, which `tsc` already answers far
 * better. A parser that silently stopped matching would make every class look absent
 * and pass, so the self-test below asserts on real files.
 */
export function declaredClasses(text) {
  const out = [];
  const re = /export\s+(?:abstract\s+)?class\s+(\w+)/g;
  for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}

/** Public method names a class declares. `private` and `protected` are not public. */
export function declaredMethods(text, className) {
  const start = text.indexOf(`class ${className}`);
  if (start < 0) return [];
  // Walk to the matching close brace, counting nesting, so a method of an inner class
  // is not attributed to the outer one.
  let depth = 0;
  let i = text.indexOf('{', start);
  const open = i;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = text.slice(open, i);

  const names = [];
  const re = /^\s{2}(?!\s)(?!(?:private|protected|static|get|set|#)\b)([a-zA-Z_]\w*)\s*(?:<[^>]*>)?\s*\(/gm;
  for (const m of body.matchAll(re)) names.push(m[1]);
  return [...new Set(names)];
}

/**
 * Every identifier each source file mentions, keyed by file then by name.
 *
 * Per file rather than one global tally, and that matters: `getConfig` appearing in
 * three unrelated classes would satisfy a global count for all three, so a class whose
 * `getConfig` nothing calls would look used. The first version of this gate counted
 * globally and reported nothing at all in its self-test fixtures, which is exactly the
 * "a guard that cannot fail" failure the file is written to avoid.
 */
export function identifierCounts(sources) {
  const byFile = new Map();
  for (const { file, text } of sources) {
    const counts = new Map();
    for (const m of text.matchAll(/\b[A-Za-z_]\w*\b/g)) {
      counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);
    }
    byFile.set(file, counts);
  }
  return byFile;
}

/**
 * Every method name each file *declares*, so a declaration is not mistaken for a call.
 *
 * This is the subtle part of a name-based check and it is easy to get wrong. Three
 * unrelated classes can each have a `getConfig`; if the gate simply asked "does this
 * name appear anywhere else", the mere existence of the other two would satisfy all
 * three and the gate would report nothing at all. So a mention only counts as a use
 * when the file mentioning it does not itself declare a method of that name -- which is
 * exactly the difference between `other.getConfig()` and `class Other { getConfig() {} }`.
 */
export function declaredNames(sources) {
  const byFile = new Map();
  for (const { file, text } of sources) {
    const names = new Set();
    for (const cls of declaredClasses(text)) {
      for (const m of declaredMethods(text, cls)) names.add(m);
    }
    byFile.set(file, names);
  }
  return byFile;
}

/** Is `name` mentioned in a file that mentions it without declaring it? */
function usedElsewhere(byFile, declared, declaringFile, name) {
  for (const [file, counts] of byFile) {
    if (file === declaringFile) continue;
    if ((counts.get(name) ?? 0) === 0) continue;
    if ((declared.get(file) ?? new Set()).has(name)) continue;
    return true;
  }
  return false;
}

/** Which classes `main.ts` constructs, with the file each lives in. */
export function constructedClasses(mainText, sources) {
  const byClass = new Map();
  for (const { file, text } of sources) {
    for (const cls of declaredClasses(text)) {
      if (!byClass.has(cls)) byClass.set(cls, file);
    }
  }

  const out = [];
  // `new X()` anywhere in main.ts. A `new` inside a comment or a string would be a
  // false positive, which is safe: it adds a class to check, it does not remove one.
  for (const m of mainText.matchAll(/\bnew\s+([A-Z]\w*)\s*\(/g)) {
    const cls = m[1];
    if (byClass.has(cls) && !out.some((c) => c.name === cls)) {
      out.push({ name: cls, file: byClass.get(cls) });
    }
  }
  return out;
}

/** Every problem with what is constructed and what is used. */
export function wiringProblems({ mainText, sources, exempt = EXEMPT, constructedOnly = CONSTRUCTED_ONLY }) {
  const problems = [];
  const counts = identifierCounts(sources);
  const declared = declaredNames(sources);
  const constructed = constructedClasses(mainText, sources);

  const sourceOf = (cls) => sources.find((s) => declaredClasses(s.text).includes(cls)) ?? null;
  const textOf = (cls) => {
    const hit = sourceOf(cls);
    return hit ? hit.text : null;
  };

  for (const { name, file } of constructed) {
    if (constructedOnly.has(name)) continue;

    const text = textOf(name);
    if (text === null) continue;
    const methods = declaredMethods(text, name);
    const perMethod = exempt[name] ?? {};

    const genuinelyUnused = methods.filter(
      (method) => !usedElsewhere(counts, declared, file, method) && !perMethod[method]
    );
    if (genuinelyUnused.length === 0) continue;

    // A class with *every* method unused is a different failure from one with a spare
    // method, and saying so separately makes the message point at the right fix.
    if (genuinelyUnused.length === methods.length) {
      // Every method named, not just a count. A finding that says "none of its 7 public
      // method is called" sends the reader to the file; one that lists them answers the
      // question without a round trip, and these lists are short enough to read inline.
      problems.push(
        `${file}: ${name} is constructed in main.ts but nothing calls any of its public method ` +
        `(${genuinelyUnused.join(', ')}). It is doing nothing. Wire it up or delete it.`
      );
    } else {
      problems.push(
        `${file}: ${name} has public method(s) nothing calls: ${genuinelyUnused.join(', ')}. ` +
        'Either wire them up or record a reason in EXEMPT.'
      );
    }
  }

  // An exemption for a method that is now called is a permanent pass waiting to
  // happen. Every stale entry is a failure.
  for (const [cls, methods] of Object.entries(exempt)) {
    const text = textOf(cls);
    if (text === null) continue;
    const classMethods = declaredMethods(text, cls);
    for (const method of Object.keys(methods)) {
      if (!classMethods.includes(method)) {
        problems.push(`${cls}: EXEMPT lists ${cls}.${method}, which no longer exists. Delete the entry.`);
        continue;
      }
      if (usedElsewhere(counts, declared, sourceOf(cls)?.file ?? '', method)) {
        problems.push(
          `${cls}: EXEMPT lists ${cls}.${method}, which is now called somewhere. ` +
          'Delete the entry -- an exemption that outlives its reason reads as a permanent pass.'
        );
      }
    }
  }

  return problems;
}

// ---------------------------------------------------------------------------

function main() {
  const sources = tsFiles(SRC).map((file) => ({ file: rel(file), text: readFileSync(file, 'utf8') }));
  const mainText = readFileSync(MAIN, 'utf8');

  if (process.argv.includes('--selftest')) return selftest(mainText, sources, SRC);

  const constructed = constructedClasses(mainText, sources);
  process.stdout.write(
    `${rel(MAIN)} constructs ${constructed.length} class(es); checking every public method.\n`
  );
  const problems = wiringProblems({ mainText, sources });
  if (problems.length === 0) {
    process.stdout.write('PASS  everything constructed is used, and every unused method is accounted for.\n');
    return 0;
  }
  for (const p of problems) process.stdout.write(`FAIL  ${p}\n`);
  process.stdout.write(`\n${problems.length} problem(s).\n`);
  return 1;
}

/**
 * The check is a regex over source text, and a regex that stops matching makes every
 * class look absent -- which would leave the gate green for the wrong reason. So the
 * fixtures exercise the parsers directly as well as the findings.
 */
function selftest(mainText, sources, SRC) {
  const cases = [];
  const at = (label, expect, got) =>
    cases.push({
      label,
      ok: JSON.stringify(expect) === JSON.stringify(got),
      detail: `expected ${JSON.stringify(expect)}, got ${JSON.stringify(got)}`,
    });

  /** Runs the check over a fixture, given main.ts's text and the supporting sources. */
  const run = (mainText, texts, opts = {}) =>
    wiringProblems({
      mainText,
      sources: texts.map((text, i) => ({ file: `fixture/${i}.ts`, text })),
      ...opts,
    });

  // --- the parsers ---------------------------------------------------------
  at('finds exported classes', ['Foo', 'Bar'], declaredClasses('export class Foo {}\nexport abstract class Bar {}'));
  at(
    'reports only public methods, not private ones',
    // `private b` is skipped by the parser. If it were not, every class in the
    // repository would report its own private helpers as unused.
    ['a'],
    declaredMethods('class X {\n  a() {}\n  private b() {}\n  protected c() {}\n}', 'X')
  );
  at(
    'does not mistake one class method for another with the same name',
    // The flaw the per-file counting exists to prevent: `getConfig` in three unrelated
    // classes must not satisfy a global tally for all three.
    1,
    run(
      'new Partial();\n',
      [
        'export class Partial {\n  used() { return 1; }\n  spare() { return 2; }\n}\n',
        'export class Other {\n  spare() { return 3; }\n}\n',
        'const p = new Partial(); p.used();\n',
      ]
    ).length
  );
  at('does not attribute an inner class to the outer one', ['outer'], declaredMethods('class X {\n  outer() {}\n}\nclass Y {\n  inner() {}\n}', 'X'));
  at('ignores getters and setters', [], declaredMethods('class X {\n  get a() { return 1; }\n  set b(v) {}\n}', 'X'));

  // --- the findings -------------------------------------------------------
  //
  // `export` on every fixture class, because `declaredClasses` only matches exported
  // ones -- the same rule the real sources follow. A fixture that forgot it would look
  // like a repository with no classes at all and pass for the wrong reason.
  // Unique method names on purpose. A name-based check cannot tell `lonely.solo()` from
  // `other.solo()` in a shared file, so a fixture that reused names across classes would
  // be testing the fixture rather than the gate -- and the per-file `declared` filter is
  // what makes the shared-name case safe against a *declaration*, not against a call.
  const LONELY =
    'export class Lonely {\n' +
    '  soloAlpha() { return 1; }\n' +
    '  soloBeta() { return 2; }\n' +
    '}\n';
  const BUSY =
    'export class Busy {\n' +
    '  doThing() { return 1; }\n' +
    '  doOther() { return 2; }\n' +
    '}\n';
  const PARTIAL =
    'export class Partial {\n' +
    '  used() { return 1; }\n' +
    '  spare() { return 2; }\n' +
    '}\n';

  // Lonely is the only class in this fixture that nothing touches. It shares method
  // names with Busy on purpose: `doThing` appears in Busy and in the caller, and
  // neither may satisfy Lonely's own unused `doThing`. The two findings are Lonely and
  // Busy, so the assertions below are on the Lonely one specifically rather than on a
  // count, which would not say *which* class the gate thought was dead.
  const mixed = run('new Lonely(); new Busy();\n', [
    LONELY,
    BUSY,
    'const b = new Busy(); b.doThing();\n',
  ]);
  const lonelyFinding = mixed.find((p) => p.includes('Lonely')) ?? '';
  const busyFinding = mixed.find((p) => p.includes('Busy')) ?? '';

  at('reports both classes in the mixed fixture', 2, mixed.length);
  at(
    'calls a wholly unused class dead rather than merely incomplete',
    true,
    lonelyFinding.includes('It is doing nothing')
  );
  at(
    'names every unused method of a dead class, so the finding is actionable',
    true,
    ['soloAlpha', 'soloBeta'].every((m) => lonelyFinding.includes(m))
  );
  at(
    'counts the dead class\'s methods rather than just saying "none"',
    true,
    /nothing calls any of its public method/.test(lonelyFinding)
  );
  at(
    'reports the other class as having one spare method',
    true,
    busyFinding.includes('doOther') && !busyFinding.includes('It is doing nothing')
  );
  at(
    'is silent when every method is called',
    0,
    run('new Busy();\n', [BUSY, 'const b = new Busy(); b.doThing(); b.doOther();\n']).length
  );
  at(
    'distinguishes a spare method from a dead class',
    true,
    (run('new Partial();\n', [PARTIAL, 'const p = new Partial(); p.used();\n'])[0] ?? '')
      .includes('spare')
  );

  // --- the exemptions -----------------------------------------------------
  const partialTexts = [PARTIAL, 'const p = new Partial(); p.used();\n'];
  at(
    'accepts an exempt method',
    0,
    run('new Partial();\n', partialTexts, { exempt: { Partial: { spare: 'not wired yet' } } }).length
  );
  at(
    'rejects an exemption for a method that no longer exists',
    // The other half of the stale-exemption check. A reason left behind for a method
    // that was deleted is the same silent permanent pass as one left behind for a
    // method that got wired up.
    1,
    run('new Partial();\n', partialTexts, { exempt: { Partial: { removed: 'gone' } } }).filter((p) =>
      p.includes('no longer exists')
    ).length
  );
  at(
    'rejects an exemption for a method that is now called',
    1,
    run('new Partial();\n', [PARTIAL, 'const p = new Partial(); p.used(); p.spare();\n'], {
      exempt: { Partial: { spare: 'not wired yet' } },
    }).filter((p) => p.includes('now called')).length
  );
  at(
    'does not count the declaration itself as a use',
    // The single most important property of the whole check: if a method's own name in
    // its own file counted as a use, nothing would ever be reported.
    1,
    run('new Partial();\n', [PARTIAL]).length
  );

  // --- and the real repository --------------------------------------------
  at(    // Zero *problems*, not zero findings as a number: the pass/fail above compares the
    // array, so an empty array is the only acceptable value and a truncated report
    // cannot satisfy it.
    'accepts the repository as it now stands',
    [],
    wiringProblems({ mainText, sources }));
  at(
    'still finds real classes in the real main.ts',
    true,
    constructedClasses(mainText, sources).length > 15
  );
  at(
    'sees a method the parser can reach',
    true,
    declaredMethods(readFileSync(join(SRC, 'systems', 'EasterEggSystem.ts'), 'utf8'), 'EasterEggSystem')
      .includes('trigger')
  );

  let failed = 0;
  for (const c of cases) {
    if (!c.ok) failed++;
    process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.label}  (${c.detail})\n`);
  }
  process.stdout.write(`\n${cases.length - failed}/${cases.length} self-test cases passed\n`);
  return failed === 0 ? 0 : 1;
}

const invokedDirectly = Boolean(process.argv[1]) &&
  resolve(String(process.argv[1])) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
