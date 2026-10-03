/**
 * Proves the settings window's one-second poll leaves the UI thread responsive.
 *
 * The settings window used to freeze once a second. Four
 * `EvaluateAsync(...).GetAwaiter().GetResult()` calls on the UI thread each
 * waited for a completion that WebView2 can only deliver *on that same thread*,
 * so it was a deadlock re-armed by a DispatcherTimer, not a slowdown.
 *
 * Nothing else in this repository could see it. The browser checks never
 * construct a WPF window. The off-screen settings harness passed a null host, so
 * every evaluation returned null immediately and the blocking path never ran. A
 * static guard against the pattern is in `verify-settings-blocking.mjs`, and it is
 * necessary but not sufficient: the pattern can be reintroduced in a form the
 * guard does not match, and a guard cannot tell you whether the thread is alive.
 *
 * So this runs the real window against a stub whose evaluations complete the way
 * WebView2's do — queued to the dispatcher, resolved only when the dispatcher
 * runs. A 50 ms DispatcherTimer counts ticks for six seconds while the poll runs
 * against it. If the UI thread is blocked the heartbeat stops, which is the
 * signature of the deadlock, and because the deadlock also stops the message loop
 * returning at all, a watchdog thread reports it instead of the run hanging.
 *
 * The heartbeat was verified against the real defect, not just against the fix:
 * reintroducing one blocking call turns this into a 40-second watchdog failure
 * with exit code 3. A test that has never been seen to fail is not evidence.
 *
 *   node tools/settings-heartbeat.mjs
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const PROJECT = resolve(HERE, 'SettingsShot', 'SettingsShot.csproj');

if (!existsSync(PROJECT)) {
  console.error(`FAIL  settings heartbeat: ${PROJECT} not found`);
  process.exit(1);
}

const run = (args) => spawnSync('dotnet', args, { cwd: ROOT, encoding: 'utf8', shell: true });

const build = run(['build', PROJECT, '-c', 'Release', '--nologo']);
if (build.status !== 0) {
  console.error('FAIL  settings heartbeat: build failed');
  console.error((build.stdout ?? '') + (build.stderr ?? ''));
  process.exit(1);
}

// 3 is the watchdog's own exit code: the UI thread never left its message loop.
const shot = run(['run', '--project', PROJECT, '-c', 'Release', '--no-build', '--', '--heartbeat']);
const output = ((shot.stdout ?? '') + (shot.stderr ?? '')).trim();

if (shot.status !== 0) {
  console.error('FAIL  settings heartbeat: the settings poll blocked the UI thread');
  console.error(output);
  if (shot.status === 3) {
    console.error('      Exit code 3 is the in-process watchdog: the dispatcher never ran again.');
  }
  process.exit(1);
}

const beats = /heartbeat over [\d.]+s: (\d+) beats/.exec(output);
const evals = /engine evaluations during the run: (\d+)/.exec(output);
if (!beats || Number(beats[1]) < 10) {
  console.error('FAIL  settings heartbeat: too few beats to mean anything');
  console.error(output);
  process.exit(1);
}
if (!evals || Number(evals[1]) < 1) {
  // A window that never polled keeps beating while proving nothing at all.
  console.error('FAIL  settings heartbeat: the poll never ran, so this proves nothing');
  console.error(output);
  process.exit(1);
}

console.log(`PASS  the settings poll left the UI thread responsive -- ${beats[1]} beats, ${evals[1]} engine calls`);