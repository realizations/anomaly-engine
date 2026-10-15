/**
 * Drives the feed rule editor through the real WPF window.
 *
 * The other settings checks each prove one end of the path: `settings-shot.mjs` renders
 * the pages, but a window that is never shown never fires `Loaded`, so the feed cards are
 * never built and the rule editor is not on the page it captures. `feed-rules.mjs` proves
 * the edits in Core, but not that the window calls them. Neither touches the part a user
 * actually does -- the registry becoming a picker, a click becoming a push.
 *
 * So this runs the window for real against the stub bridge, waits for the cards, clicks
 * "Add rule", and reads the `setFeeds(...)` the window sent back. It is the one check that
 * would fail if the editor were wired to a button that did nothing, which is the state
 * the integrations page is in before this feature.
 *
 *   node tools/settings-feed-ui.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROJECT = resolve(HERE, 'SettingsShot', 'SettingsShot.csproj');

if (!existsSync(PROJECT)) {
  console.error(`FAIL  settings feed editor: ${PROJECT} not found`);
  process.exit(1);
}

const run = (args) => spawnSync('dotnet', args, { cwd: ROOT, encoding: 'utf8' });

const build = run(['build', PROJECT, '-c', 'Release', '--nologo']);
if (build.status !== 0) {
  console.error('FAIL  settings feed editor: build failed');
  console.error((build.stdout ?? '') + (build.stderr ?? ''));
  process.exit(1);
}

const shot = run(['run', '--project', PROJECT, '-c', 'Release', '--no-build', '--', '--feeds']);
const output = ((shot.stdout ?? '') + (shot.stderr ?? '')).trim();

if (shot.status !== 0) {
  console.error('FAIL  settings feed editor:');
  console.error(output);
  if (shot.status === 3) {
    console.error('      Exit code 3 is the in-process watchdog: the run never finished.');
  }
  process.exit(1);
}

const passed = (output.match(/^PASS /gm) ?? []).length;
if (passed < 3) {
  console.error('FAIL  settings feed editor: expected three checks to pass.');
  console.error(output);
  process.exit(1);
}

console.log(`PASS  the feed editor and the effect archive work through the real window -- ${passed} checks`);
