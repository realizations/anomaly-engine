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
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, mkdirSync, statSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const OUT = resolve(ROOT, 'build', 'review');
const PROJECT = resolve(HERE, 'SettingsShot', 'SettingsShot.csproj');

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

// The page count is asserted rather than trusted, because a window that fails to
// switch sections still renders something, and one file on disk is a pass that
// means nothing.
const PAGES = ['home', 'worlds', 'appearance', 'performance', 'events', 'field-notes', 'displays', 'integrations', 'about'];
const missing = PAGES.filter((p) => !existsSync(resolve(OUT, `settings-${p}.png`)));
if (missing.length) {
  console.error(`FAIL  settings window render: no image for ${missing.join(', ')}`);
  process.exit(1);
}

// A blank render is a white PNG of a few hundred bytes, which is what a window
// that never got a layout pass produces. Asserting a minimum size catches that
// silent failure, which is exactly how the first version of this harness failed.
const tiny = PAGES.filter((p) => statSync(resolve(OUT, `settings-${p}.png`)).size < 8 * 1024);
if (tiny.length) {
  console.error(`FAIL  settings window render: suspiciously small image(s): ${tiny.join(', ')}`);
  process.exit(1);
}

console.log(`PASS  settings window renders all ${PAGES.length} pages`);
console.log(`      ${OUT}`);
