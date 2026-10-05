/**
 * Builds and runs the settings-window renderer, so every settings page is
 * captured to a PNG and can be reviewed.
 *
 * The settings window is the one surface in the product that the browser-driven
 * tooling cannot reach. It is WPF, and it already had a layout bug that no
 * end-to-end test could see: every navigation label was clipped to a few
 * characters. It also had two dropdowns that rendered as default grey Windows
 * controls against a dark phosphor interface, because a ComboBox paints itself
 * from a ControlTemplate and setting Background on the style does nothing without
 * one. Both were found by looking at the rendered window, and both would have
 * stayed invisible to every other check in this repository.
 *
 * WPF can lay out and render a window that is never displayed, so this does not
 * put a wallpaper on the desktop of the machine running it.
 *
 *   node tools/settings-shot.mjs
 *   node tools/settings-shot.mjs --selftest
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'build', 'review');
const PROJECT = resolve(HERE, 'SettingsShot', 'SettingsShot.csproj');
const SELFTEST = process.argv.includes('--selftest');

const PAGES = ['home', 'worlds', 'appearance', 'performance', 'events', 'field-notes', 'displays', 'integrations', 'about'];

/**
 * Checks a directory of page renders and returns the problems it finds.
 *
 * Returning rather than exiting is what makes the checks testable. The obvious way
 * to test "does this harness catch a window that never switched pages" is to wire
 * the navigation to the wrong panel and run it, which is expensive and leaves the
 * product broken while you do. Seeding the directory instead means the harness can
 * be asked whether it would notice.
 */
export function auditPageRenders(dir, pages = PAGES) {
  const problems = [];

  const missing = pages.filter((p) => !existsSync(resolve(dir, `settings-${p}.png`)));
  if (missing.length) problems.push(`no image for ${missing.join(', ')}`);

  const present = pages.filter((p) => existsSync(resolve(dir, `settings-${p}.png`)));
  if (present.length === pages.length) {
    // A blank render is a white PNG of a few hundred bytes, which is what a window
    // that never got a layout pass produces. A minimum size catches that silent
    // failure, which is how the first version of this harness failed.
    const tiny = present.filter((p) => statSync(resolve(dir, `settings-${p}.png`)).size < 8 * 1024);
    if (tiny.length) problems.push(`suspiciously small image(s): ${tiny.join(', ')}`);

    // The size check does not prove the window switched pages, and that failure is
    // not hypothetical: ShowSection falls back to `Sections[0]` when handed a name
    // it does not recognise, which is Home. A window whose navigation is wired to the
    // wrong panel therefore renders Home nine times, every file comfortably over
    // 8KB, and a presence-and-size check alone reports all nine pages rendering.
    //
    // Byte equality is the right test. Two renders of the same panel are the same
    // pixels through the same encoder, so identical digests mean a duplicate file;
    // two different panels cannot collide. Hashing also costs one pass per file.
    const byDigest = new Map();
    for (const p of present) {
      const digest = createHash('sha256').update(readFileSync(resolve(dir, `settings-${p}.png`))).digest('hex');
      if (!byDigest.has(digest)) byDigest.set(digest, []);
      byDigest.get(digest).push(p);
    }
    const duplicates = [...byDigest.values()].filter((group) => group.length > 1);
    for (const group of duplicates) {
      problems.push(
        `these pages rendered identical images: ${group.join(' == ')}\n` +
          '      ShowSection falls back to the first section on an unknown name, so this is\n' +
          '      what a navigation wired to the wrong panel looks like.'
      );
    }
  }

  return problems;
}

function selftest() {
  const dir = mkdtempSync(resolve(tmpdir(), 'settings-shot-'));
  const file = (p) => resolve(dir, `settings-${p}.png`);
  // Distinct filler of a plausible size, so only the property under test varies.
  const body = (salt, bytes = 9 * 1024) => Buffer.concat([Buffer.from(salt), Buffer.alloc(bytes, salt.charCodeAt(0))]);

  const cases = [];
  const record = (name, problems, shouldBeRejected) =>
    cases.push({ name, problems, shouldBeRejected, ok: problems.length > 0 === shouldBeRejected });

  for (const p of PAGES) writeFileSync(file(p), body(p));
  record('nine distinct renders are accepted', auditPageRenders(dir), false);

  rmSync(file('events'));
  record('a missing page is rejected', auditPageRenders(dir), true);
  writeFileSync(file('events'), body('events'));

  writeFileSync(file('about'), Buffer.alloc(512));
  record('a blank render is rejected', auditPageRenders(dir), true);
  writeFileSync(file('about'), body('about'));

  writeFileSync(file('displays'), readFileSync(file('home')));
  record('two pages rendering the same image is rejected', auditPageRenders(dir), true);

  rmSync(dir, { recursive: true, force: true });

  let failed = 0;
  for (const c of cases) {
    if (!c.ok) failed++;
    process.stdout.write(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}\n`);
    if (!c.ok) {
      for (const p of c.problems) process.stdout.write(`        ${p}\n`);
      if (!c.problems.length) process.stdout.write('        (accepted, but should have been rejected)\n');
    }
  }
  process.stdout.write(failed ? `\n${failed} assertion(s) failed.\n` : '\nThe page-render audit behaves.\n');
  process.exit(failed ? 1 : 0);
}

if (SELFTEST) selftest();

if (!existsSync(PROJECT)) {
  console.error(`FAIL  settings window render: ${PROJECT} not found`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const run = (args) => spawnSync('dotnet', args, { cwd: ROOT, encoding: 'utf8', shell: true });

const build = run(['build', PROJECT, '-c', 'Release', '--nologo']);
if (build.status !== 0) {
  console.error('FAIL  settings window render: build failed');
  console.error((build.stdout ?? '') + (build.stderr ?? ''));
  process.exit(1);
}

const shot = run(['run', '--project', PROJECT, '-c', 'Release', '--no-build', '--', OUT]);
if (shot.status !== 0) {
  console.error('FAIL  settings window render: run failed');
  console.error((shot.stdout ?? '') + (shot.stderr ?? ''));
  process.exit(1);
}

const problems = auditPageRenders(OUT);
if (problems.length) {
  console.error('FAIL  settings window render:');
  for (const p of problems) console.error(`      ${p}`);
  process.exit(1);
}

console.log(`PASS  settings window renders all ${PAGES.length} pages, and no two are the same image`);
console.log(`      ${OUT}`);
