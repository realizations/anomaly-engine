/**
 * Proves every accessibility control in the settings window reaches the renderer.
 *
 * Five preferences had no control, no renderer-side effect, no persistence and no
 * mention in the status document: high contrast, mute, keyboard navigation, enlarged
 * interface text, and visible focus outlines. Two of them toggled a class name on the
 * document root, in a project with no stylesheet, which made them look implemented.
 *
 * That is the same failure the host-event gate exists for, one layer up. A control
 * that dispatches an event nobody listens for throws nothing, renders correctly, and
 * is discovered by the person who needed it. So this walks the path end to end:
 *
 *   settings XAML control -> handler -> host call -> event name -> renderer listener
 *                         -> preference name -> config field -> a real effect
 *
 * and requires every link. A renamed event, a renamed key, a checkbox wired to a
 * handler that sends the wrong key, or a preference restored from state that the
 * renderer never applies all show up as a broken link rather than as a dead control.
 *
 * Self-test included, and it is not decorative: the check below is a set of
 * substring tests over text files, which is exactly the kind of thing that passes
 * forever because it is looking for the wrong thing.
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const read = (...parts) => readFileSync(resolve(ROOT, ...parts), 'utf8');

const XAML = read('src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml');
const CS = read('src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml.cs');
const BRIDGE = read('src', 'AnomalyEngine', 'Core', 'IEngineBridge.cs');
const HOST = read('src', 'AnomalyEngine', 'Core', 'WallpaperHost.cs');
const EVENTS = read('src', 'Engine', 'src', 'core', 'windowEvents.ts');
const A11Y = read('src', 'Engine', 'src', 'platform', 'AccessibilitySystem.ts');
const MAIN = read('src', 'Engine', 'src', 'main.ts');
const PERSIST = read('src', 'Engine', 'src', 'platform', 'Persistence.ts');

/**
 * The five preferences, and how each one is described in the interface.
 *
 * `key` is the renderer's own name and is the contract: it is what travels over the
 * host channel, what is stored in the state file, and what `AccessibilitySystem.KEYS`
 * validates against. The friendly name is only ever used in a log line, so it cannot
 * drift into anything functional without this file failing.
 */
const PREFERENCES = [
  {
    key: 'highContrast',
    label: 'Higher contrast',
    control: 'HighContrastBox',
    effect: 'the renderer drops the film grain and flattens the shading',
  },
  {
    key: 'muteAll',
    label: 'Mute everything',
    control: 'MuteAllBox',
    effect: 'the audio system is muted rather than a class being set',
  },
  {
    key: 'keyboardNavigation',
    label: 'Keyboard control of the panels',
    control: 'KeyboardNavBox',
    effect: 'Escape closes a panel and Tab is kept inside it',
  },
  {
    key: 'focusVisible',
    label: 'Always show the focus outline',
    control: 'FocusVisibleBox',
    effect: 'a focus ring is painted rather than left to the browser',
  },
  {
    key: 'scalableUI',
    label: 'Enlarge the interface text',
    control: 'ScalableUiBox',
    effect: 'the panels are scaled by a multiplier',
  },
];

/**
 * Where each preference has to be *read*, as opposed to stored or accepted.
 *
 * A key that is accepted, persisted and never read is the original bug wearing a
 * different hat: the settings box ticks, the state file grows, and nothing changes on
 * the desktop. These are the lines that make each one do something.
 *
 * Built by a function of the file map rather than a constant, because the self-test
 * mutates that map: a table closed over the module-level text would test the real
 * repository no matter what the caller passed in, which is a self-test that passes
 * for the wrong reason.
 */
const EFFECTS = (f) => [
  { key: 'highContrast', must: [[/setHighContrast\(cfg\.highContrast\)/, f.MAIN]] },
  {
    key: 'muteAll',
    must: [[/shouldMuteAll\(\)/, f.MAIN]],
    also: [[/this\._audio\.mute\(\)/, f.MAIN]],
  },
  {
    key: 'keyboardNavigation',
    must: [[/PANEL_EVENTS\.dismiss/, f.A11Y]],
    also: [
      [/keydown/, f.A11Y],
      [/registerPanel/, f.A11Y],
    ],
  },
  {
    key: 'focusVisible',
    must: [[/anomaly-focus-visible/, f.A11Y]],
    also: [[/:focus-visible/, f.A11Y]],
  },
  { key: 'scalableUI', must: [[/--anomaly-ui-scale/, f.A11Y]] },
];

export function accessibilityProblems(files) {
  const f = files ?? {
    XAML,
    CS,
    BRIDGE,
    HOST,
    EVENTS,
    A11Y,
    MAIN,
    PERSIST,
  };
  const problems = [];

  // 1. The event exists, is named once, and both sides agree on that name.
  const eventName = /accessibility:\s*'(anomaly:[a-z-]+)'/.exec(f.EVENTS)?.[1];
  if (!eventName) {
    problems.push('WINDOW_EVENTS has no accessibility event.');
  } else if (!f.HOST.includes(eventName)) {
    problems.push(`the host never dispatches ${eventName}.`);
  } else if (!f.MAIN.includes(`WINDOW_EVENTS.accessibility`)) {
    problems.push(`${eventName} is dispatched but main.ts does not listen for it.`);
  }

  // 2. The bridge method exists and the host implements it, because a settings window
  //    calling a method the host does not have is a build error and one that does is
  //    a control that quietly goes nowhere at run time only if the interface lies.
  if (!/void SetAccessibility\(string key, bool enabled\)/.test(f.BRIDGE)) {
    problems.push('IEngineBridge has no SetAccessibility(key, enabled).');
  }
  if (!/public void SetAccessibility\(string key, bool enabled\)/.test(f.HOST)) {
    problems.push('WallpaperHost does not implement SetAccessibility.');
  }
  if (!/public async Task<bool> GetAccessibilityAsync/.test(f.HOST)) {
    problems.push('WallpaperHost cannot read a preference back, so the boxes would only ever guess.');
  }

  // 3. Each preference, end to end.
  for (const p of PREFERENCES) {
    const where = `accessibility preference ${p.key}`;

    if (!f.XAML.includes(`x:Name="${p.control}"`)) {
      problems.push(`${where}: no checkbox named ${p.control} in the settings window.`);
    }
    if (!f.XAML.includes(p.label)) {
      problems.push(`${where}: the checkbox does not say "${p.label}".`);
    }
    // Both handlers. A checkbox with Checked but no Unchecked cannot be turned off,
    // which is a control that only works in one direction.
    if (!new RegExp(`${p.control}`).test(f.XAML)) {
      problems.push(`${where}: ${p.control} is not referenced at all.`);
    }
    if (!f.CS.includes(`SetAccessibility("${p.key}", true)`)) {
      problems.push(`${where}: no checked handler sends "${p.key}".`);
    }
    if (!f.CS.includes(`SetAccessibility("${p.key}", false)`)) {
      problems.push(`${where}: no unchecked handler sends "${p.key}".`);
    }
    if (!f.MAIN.includes(`setByKey(d.key`)) {
      problems.push('main.ts does not route the accessibility event through a validated key.');
    }
    if (!f.A11Y.includes(`'${p.key}'`)) {
      problems.push(`${where}: not in AccessibilitySystem's key list.`);
    }
    if (!f.PERSIST.includes(`${p.key}: boolean | null`)) {
      problems.push(`${where}: not in the persisted state, so it is forgotten on the next launch.`);
    }
    if (!f.CS.includes(`NB("accessibility", "${p.key}")`)) {
      problems.push(`${where}: not read back into the checkbox when the window opens.`);
    }

    for (const link of EFFECTS(f).filter((e) => e.key === p.key)) {
      for (const [re, src] of link.must) {
        if (!re.test(src)) {
          problems.push(`${where}: stored and accepted but nothing reads it -- expected ${p.effect}.`);
        }
      }
      for (const [re, src] of link.also ?? []) {
        if (!re.test(src)) problems.push(`${where}: incomplete wiring for ${p.effect}.`);
      }
    }
  }

  // 4. The five must not be silently reset on a fresh install. A null in the state
  //    file means "never chosen" and has to survive the restore path.
  for (const p of PREFERENCES) {
    if (!f.MAIN.includes(`if (s.${p.key} !== null)`)) {
      problems.push(
        `accessibility preference ${p.key}: never restored, so it is forgotten every launch ` +
          'or -- worse -- an unset state silently overrides the operating system.'
      );
    }
  }

  // 5. The stylesheet the classes act through has to exist. Three of the five are
  //    class names on the document root, and this project has no other stylesheet, so
  //    "add a class" without "inject a rule" is precisely the original bug.
  if (!f.A11Y.includes('anomaly-accessibility')) {
    problems.push('AccessibilitySystem injects no stylesheet, so its root classes match nothing.');
  }

  // 6. The advertised key list and the list of keys `setConfig` will actually store
  //    have to be the same set.
  //
  //    They are two arrays in one class, which is duplication with no compiler to catch
  //    it: `setByKey` checks the first and `setConfig` consults the second, so a key
  //    present in only one is accepted over the host channel and then silently dropped.
  //    A preference that arrives, is reported as accepted, and changes nothing is the
  //    original bug with a new name.
  const listBlock = (start) => {
    const from = f.A11Y.indexOf(start);
    if (from < 0) return [];
    const open = f.A11Y.indexOf('[', from);
    const close = f.A11Y.indexOf(']', open);
    if (open < 0 || close < 0) return [];
    return [...f.A11Y.slice(open + 1, close).matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  };
  const advertised = listBlock('static readonly KEYS');
  const stored = listBlock('const BOOLEAN_KEYS');
  if (!advertised.length) problems.push('AccessibilitySystem advertises no preference keys.');
  if (!stored.length) problems.push('AccessibilitySystem validates no preference keys.');
  for (const key of advertised) {
    if (!stored.includes(key)) {
      problems.push(
        `${key} is advertised as a preference but setConfig would discard it, ` +
          'so it arrives and does nothing.'
      );
    }
  }
  for (const key of stored) {
    if (!advertised.includes(key)) {
      problems.push(`${key} is stored but not advertised, so the host cannot set it by name.`);
    }
  }

  return problems;
}

/* --------------------------------- self-test --------------------------------- */

if (process.argv.includes('--selftest')) {
  const cases = [];
  const record = (name, problems, shouldFail) => {
    const ok = (problems.length > 0) === shouldFail;
    cases.push({ name, ok, problems });
  };

  record('the repository as it stands is clean', accessibilityProblems(), false);

  const good = {
    XAML: XAML.replace('x:Name="HighContrastBox"', 'x:Name="HighContrastBox" '),
    CS,
    BRIDGE,
    HOST,
    EVENTS,
    A11Y,
    MAIN,
    PERSIST,
  };

  record('a checkbox wired to no handler is caught', accessibilityProblems({ ...good, CS: CS.replace(/SetAccessibility\("highContrast", true\)/, 'Nothing()') }), true);
  record('a handler sending the wrong key is caught', accessibilityProblems({ ...good, CS: CS.replace('SetAccessibility("highContrast", true)', 'SetAccessibility("highContrasst", true)') }), true);
  record('a key removed from the renderer is caught', accessibilityProblems({ ...good, A11Y: A11Y.replace(/'highContrast',/g, '') }), true);
  record('a key removed from the state file is caught', accessibilityProblems({ ...good, PERSIST: PERSIST.replace('highContrast: boolean | null', 'highContrast: unknown') }), true);
  record('a preference that is stored but never read is caught', accessibilityProblems({ ...good, MAIN: MAIN.replaceAll('setHighContrast(cfg.highContrast)', '/* removed */') }), true);
  record('a key in only one of the two renderer key lists is caught', accessibilityProblems({ ...good, A11Y: A11Y.replace(/(static readonly KEYS = \[\n)/, '$1  \'focusVisibleOnlyThere\',\n') }), true);
  record('a renamed event is caught', accessibilityProblems({ ...good, HOST: HOST.replace(/anomaly:accessibility/g, 'anomaly:a11y') }), true);
  record('a bridge method the host does not implement is caught', accessibilityProblems({ ...good, HOST: HOST.replace(/public void SetAccessibility\(string key, bool enabled\)/, 'public void SomethingElse()') }), true);
  record('a missing checkbox is caught', accessibilityProblems({ ...good, XAML: XAML.replace('x:Name="MuteAllBox"', 'x:Name="MuteAllBoxTypo"') }), true);
  record('a preference that is never restored is caught', accessibilityProblems({ ...good, MAIN: MAIN.replace('if (s.scalableUI !== null)', 'if (false)') }), true);
  record('an injected stylesheet being dropped is caught', accessibilityProblems({ ...good, A11Y: A11Y.replace("'anomaly-accessibility'", "'something-else'") }), true);

  let failed = 0;
  for (const c of cases) {
    if (!c.ok) failed++;
    process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n`);
    if (!c.ok) for (const p of c.problems) process.stdout.write(`        ${p}\n`);
  }
  process.stdout.write(
    failed ? `\n${failed} assertion(s) failed.\n` : '\nThe accessibility wiring check behaves.\n'
  );
  process.exit(failed ? 1 : 0);
}

/* ------------------------------- the repository ------------------------------ */

if (!existsSync(join(ROOT, 'src', 'Engine', 'src', 'main.ts'))) {
  console.error('FAIL  accessibility wiring: run this from the repository root.');
  process.exit(1);
}

const problems = accessibilityProblems();
if (problems.length) {
  console.error('FAIL  accessibility wiring:');
  for (const p of problems) console.error(`      ${p}`);
  process.exit(1);
}

console.log(
  `PASS  all ${PREFERENCES.length} accessibility preferences are reachable, applied, ` +
    'restored, and reach a real effect'
);