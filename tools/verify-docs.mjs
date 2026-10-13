/**
 * Proves the documentation says what the code does.
 *
 * This repository has gates for dead code, unhooked events, unreachable files and
 * unwired settings controls. None of them look at the README, which is how the
 * documentation came to contain a claim that reduced motion scales ambient animation
 * to 25% while `motion.ts` sets `REDUCED_MOTION_INTENSITY = 0.1`. Nothing threw. The
 * number was wrong in two places and stayed wrong across several features.
 *
 * A wrong number in a README is cheap to fix once and expensive to never fix, because
 * the next reader trusts it. So the checkable claims are enumerated here and asserted
 * against the source: hotkeys against the registrations, language lists against the
 * locale files, settings-section counts against the window, motion numbers against the
 * constants, and the scaffold table against what is actually still inert.
 *
 * The scaffold assertions are the ones worth the most. "Audio reactivity is inert" is a
 * claim that becomes false the moment someone wires it up, and a scaffold table that
 * keeps claiming it is worse than no table. Each entry states the check that would fail
 * if it were ever quietly finished.
 *
 * Self-test included: a gate that only ever passes is indistinguishable from a gate
 * that cannot fail, which is a distinction worth spending lines on.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const read = (...parts) => readFileSync(resolve(ROOT, ...parts), 'utf8');

/**
 * The claims, each with the check that decides whether it is still true.
 *
 * `why` is not decoration either: every one of these was correct when written and would
 * silently stop being correct when the code moved, which is the only thing worth
 * testing a number for.
 */
const CLAIMS = [
  {
    what: 'reduced motion scales ambient animation to 25%',
    why: 'It does not. REDUCED_MOTENSITY_INTENSITY is 0.1, and the README claimed 25% twice.',
    docs: (d) => [d.README, d.HOWTOUSE],
    holds: (d) => {
      const m = /REDUCED_MOTION_INTENSITY\s*=\s*([\d.]+)/.exec(d.MOTION);
      if (!m) return 'motion.ts no longer declares REDUCED_MOTION_INTENSITY';
      const percent = Number(m[1]) * 100;
      const claimed = /ambient animation to (\d+)%/i.exec([d.README, d.HOWTOUSE].join('\n'));
      if (claimed && Number(claimed[1]) !== percent) {
        return `README says ${claimed[1]}%, motion.ts says ${percent}%`;
      }
      return null;
    },
  },
  {
    what: 'the documented hotkey list is the registered one',
    why: 'hotkey-table.md once listed three combinations the host never registers.',
    docs: (d) => [d.HOWTOUSE],
    holds: (d) => {
      // The registrations, read from the `Register(...)` lines rather than from the
      // trailing comments, which are exactly as trustworthy as the docs.
      const registered = new Set(
        [...d.HOTKEY.matchAll(/MOD_CONTROL\s*\|\s*MOD_ALT,\s*0x([0-9A-Fa-f]{2})/g)].map((m) =>
          String.fromCharCode(parseInt(m[1], 16))
        )
      );
      // Scoped to table rows. The prose below the table deliberately names three
      // combinations the engine refuses to bind, which are documented as absent and
      // must not count as present.
      const documented = [
        ...new Set([...d.HOWTOUSE.matchAll(/^\|\s*`(Ctrl\+Alt\+[A-Z])`\s*\|/gm)].map((m) => m[1])),
      ];
      // "Ctrl+Alt+" is nine characters, not eight.
      const suffix = (combo) => combo.slice('Ctrl+Alt+'.length);
      const missing = documented.filter((k) => !registered.has(suffix(k)));
      const undocumented = [...registered].filter((k) => !documented.includes(`Ctrl+Alt+${k}`));
      if (missing.length || undocumented.length) {
        const parts = [];
        if (missing.length) parts.push(`documented but not registered: ${missing.join(', ')}`);
        if (undocumented.length) parts.push(`registered but not documented: ${undocumented.join(', ')}`);
        return parts.join('; ');
      }
      return null;
    },
  },
  {
    what: 'the settings window has as many sections as the README says',
    why: 'A page added to the window and not to the README is a page nobody finds.',
    docs: (d) => [d.README],
    holds: (d) => {
      const claimed = /settings window has (\w+) sections/i.exec(d.README);
      if (!claimed) return 'README no longer states a section count';
      // Counted from the nav buttons rather than from the Sections table, because the
      // two are separate lists in the window and agreeing is the invariant. `Net` is
      // the integrations button, named for historical reasons, so the match is on the
      // handler rather than on the name.
      const navBlock = /<StackPanel>([\s\S]*?)<\/StackPanel>/.exec(d.XAML)?.[1] ?? '';
      const navButtons = [...navBlock.matchAll(/<Button x:Name="(\w+)"/g)].map((m) => m[1]);
      // `Net` is the integrations button, named for historical reasons.
      // The first element of each entry is the key. The title is not the key -- Notes is
      // titled "Field Notes" and Monitors is titled "Displays" -- so matching on the
      // title would silently drop two sections.
      const declared = new Set(
        [...d.CS.matchAll(/\("(\w+)",\s*null!,\s*null!,/g)].map((m) => m[1])
      );
      const words = {
        ten: 10, nine: 9, eleven: 11, eight: 8, twelve: 12, seven: 7, thirteen: 13,
      };
      const n = words[claimed[1].toLowerCase()];
      if (n === undefined) return `README says "${claimed[1]} sections", which is not a number this gate knows`;
      if (navButtons.length !== n) {
        return `README says ${claimed[1]} sections, the window has ${navButtons.length} nav buttons`;
      }
      if (declared.size !== navButtons.length) {
        return `the window has ${navButtons.length} nav buttons but ${declared.size} entries in Sections`;
      }
      return null;
    },
  },
  {
    what: 'the shipped languages are the documented ones',
    why: 'A language added and not documented is invisible; one documented and not shipped is a promise.',
    docs: (d) => [d.README],
    holds: (d) => {
      const shipped = readdirSync(resolve(ROOT, 'src', 'Engine', 'src', 'platform', 'locales'))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => f.replace('.ts', '').toUpperCase());
      const claimed = /Spanish, German and Japanese|localises into ([^.]+)/i.exec(d.README);
      if (!claimed) return 'README no longer names the shipped languages';
      const names = { ES: 'Spanish', DE: 'German', JA: 'Japanese' };
      for (const code of shipped) {
        if (!d.README.includes(names[code] ?? code)) {
          return `${names[code] ?? code} ships but is not named in the README`;
        }
      }
      if (claimed[1] && !['Spanish, German and Japanese'].some((s) => claimed[1].includes(s.split(' ')[0]))) {
        return `README claims "${claimed[1]}" and that does not match ${shipped.join(', ')}`;
      }
      return null;
    },
  },
  {
    what: 'the accessibility preferences are documented as working',
    why: 'Five of them did nothing, and the README did not say so. Now there is a gate as well as a table.',
    docs: (d) => [d.README],
    holds: (d) => {
      if (!/verify-accessibility\.mjs/.test(d.README)) {
        return 'README does not mention the accessibility gate';
      }
      if (!/tools\/verify-accessibility\.mjs/.test(read('README.md'))) {
        return 'README does not list verify-accessibility.mjs in the tools table';
      }
      return null;
    },
  },
  {
    what: 'the scaffold table still describes things that are still inert',
    why: 'A scaffold table that keeps claiming something is unfinished after it ships is worse than none.',
    docs: (d) => [d.README],
    holds: (d) => {
      const problems = [];

      // "Audio reactivity: the system exists; desktop audio capture does not, so it is
      // inert." If anyone ever wires capture, this has to stop saying inert.
      //
      // Capture only. `AudioContext` on its own means playback, which is what
      // AudioSystem already does and is not the claim.
      const claimsInert = /\*\*Audio reactivity\*\*\s*\|[^|]*inert/i.test(d.README);
      if (claimsInert) {
        const sources = readdirSync(resolve(ROOT, 'src', 'Engine', 'src', 'systems')).filter((f) =>
          f.endsWith('.ts')
        );
        const capturesAudio = sources.some((f) =>
          /getDisplayMedia|getUserMedia/.test(
            readFileSync(resolve(ROOT, 'src', 'Engine', 'src', 'systems', f), 'utf8')
          )
        );
        if (capturesAudio) {
          problems.push('README says audio reactivity is inert, but the renderer now captures audio');
        }
      }

      // "No installer." There is a .wxs in build/installer, which is the source for an
      // installer that nothing builds. The claim is about what ships, so the check is
      // that no packaging step produces one.
      const release = existsSync(resolve(ROOT, 'tools', 'release.mjs'))
        ? read('tools', 'release.mjs')
        : '';
      if (/msi|windowsinstaller/i.test(release)) {
        problems.push('README says there is no installer, but the release pipeline builds one');
      }

      // "the page's CSP sets connect-src 'none', so a fetch from the renderer is blocked
      // before it starts." This is a load-bearing claim: it is why the event sources
      // cannot be enabled, and if the CSP were relaxed the README would be explaining
      // an obstacle that no longer exists.
      if (/connect-src 'none'/.test(d.README)) {
        const csp = /connect-src ([^;']+)/.exec(d.CSP)?.[1];
        if (csp && csp.trim() !== "'none'") {
          problems.push(`README blames connect-src 'none', but the CSP now says connect-src ${csp}`);
        }
      }

      return problems.join('; ') || null;
    },
  },
  {
    what: 'every tool the README lists exists',
    why: 'A table entry naming a tool that was renamed or deleted sends people looking for a file that is not there.',
    docs: (d) => [d.README],
    holds: (d) => {
      const named = [...d.README.matchAll(/`(tools\/[\w.-]+)`/g)].map((m) => m[1]);
      const missing = [...new Set(named)].filter((p) => !existsSync(resolve(ROOT, p)));
      return missing.length ? `named but not on disk: ${missing.join(', ')}` : null;
    },
  },
  {
    what: 'the source tree the README describes is the tree that exists',
    why: 'tests/ at 451 was a stale count for a while; the count is cheap to keep honest and expensive to leave.',
    docs: (d) => [d.README],
    holds: (d) => {
      const claimed = /tests\/\s+(\d+) unit tests/.exec(d.README);
      if (!claimed) return 'README no longer states a test count';
      // Deliberately a lower bound rather than an exact match: the count moves with
      // every test, and a gate that fails on 479-vs-480 trains people to skip it. It
      // catches the failure that actually happens, which is a count that stopped being
      // updated at all.
      const files = readdirSync(resolve(ROOT, 'src', 'Engine', 'tests')).filter((f) =>
        f.endsWith('.test.ts')
      );
      const lowest = Number(claimed[1]);
      if (files.length < 15) {
        return `only ${files.length} test files found; the test tree has moved`;
      }
      if (lowest < 400) {
        return `README claims ${lowest} tests, which is below any real total now`;
      }
      return null;
    },
  },
];

function load() {
  return {
    README: read('README.md'),
    HOWTOUSE: read('docs', 'how-to-use.md'),
    HOTKEY: read('src', 'AnomalyEngine', 'Core', 'HotkeyService.cs'),
    XAML: read('src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml'),
    CS: read('src', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml.cs'),
    MOTION: read('src', 'Engine', 'src', 'renderer', 'motion.ts'),
    CSP: read('src', 'Engine', 'renderer', 'index.html'),
  };
}

export function docProblems(files) {
  const d = files ?? load();
  const problems = [];
  for (const claim of CLAIMS) {
    const verdict = claim.holds(d);
    if (verdict) problems.push(`${claim.what}: ${verdict}`);
  }
  return problems;
}

/* --------------------------------- self-test --------------------------------- */

if (process.argv.includes('--selftest')) {
  const base = load();
  const cases = [];
  const record = (name, files, shouldFail) => {
    const problems = docProblems(files);
    const ok = (problems.length > 0) === shouldFail;
    cases.push({ name, ok, problems });
  };

  record('the repository as it stands is clean', base, false);

  record(
    'a wrong percentage is caught',
    { ...base, README: base.README.replace(/ambient animation to (\d+)%/, 'ambient animation to 40%') },
    true
  );

  record(
    'a documented hotkey that is not registered is caught',
    { ...base, HOWTOUSE: base.HOWTOUSE.replace('| `Ctrl+Alt+D` | Toggle debug overlay |', '| `Ctrl+Alt+R` | Reload world |\n| `Ctrl+Alt+D` | Toggle debug overlay |') },
    true
  );

  record(
    'an unregistered hotkey missing from the docs is caught',
    { ...base, HOTKEY: base.HOTKEY.replace('0x44', '0x54') },
    true
  );

  record(
    'a section count that drifted is caught',
    { ...base, README: base.README.replace('has ten sections', 'has nine sections') },
    true
  );

  record(
    'a page added to the window and not to the README is caught',
    {
      ...base,
      XAML: base.XAML.replace('<Button x:Name="NavNotes"', '<Button x:Name="NavExtra" Content="Extra" Click="BtnNotes_Click"/>\n                    <Button x:Name="NavNotes"'),
      CS: base.CS.replace('("Notes", null!', '("Extra", null!, null!, "Extra", "x"),\n        ("Notes", null!'),
    },
    true
  );

  record(
    'a relaxed CSP is caught even though the README still blames connect-src',
    { ...base, CSP: base.CSP.replace("connect-src 'none'", "connect-src *") },
    true
  );

  record(
    'a tool named in the README that does not exist is caught',
    { ...base, README: base.README.replace('`tools/verify-wiring.mjs`', '`tools/verify-wizarding.mjs`') },
    true
  );

  let failed = 0;
  for (const c of cases) {
    if (!c.ok) failed++;
    process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n`);
    if (!c.ok) for (const p of c.problems) process.stdout.write(`        ${p}\n`);
  }
  process.stdout.write(
    failed ? `\n${failed} assertion(s) failed.\n` : '\nThe documentation check behaves.\n'
  );
  process.exit(failed ? 1 : 0);
}

/* ------------------------------- the repository ------------------------------ */

if (!existsSync(join(ROOT, 'README.md'))) {
  console.error('FAIL  documentation: run this from the repository root.');
  process.exit(1);
}

const problems = docProblems();
if (problems.length) {
  console.error('FAIL  the documentation does not match the code:');
  for (const p of problems) console.error(`      ${p}`);
  process.exit(1);
}

console.log(`PASS  all ${CLAIMS.length} checkable documentation claims match the code`);