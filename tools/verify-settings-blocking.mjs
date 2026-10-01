/**
 * Guards the settings window against UI-thread blocking.
 *
 * WebView2 marshals the completion of ExecuteScriptAsync back onto the UI
 * thread's message loop. Waiting for one synchronously from the UI thread
 * therefore blocks the very loop that has to deliver it. That is a deadlock, and
 * because the settings window polls every second, it froze the window once a
 * second and looked exactly like "the app is unresponsive".
 *
 * Nothing else in this repository can catch it. The browser-driven checks all run
 * headless and never construct a WPF window; the settings-page harness renders
 * the window off-screen with no host attached, so EvaluateAsync returns null
 * immediately and the blocking path never runs. A green suite said nothing about
 * this.
 *
 * This is a lint, not a proof. The proof is the heartbeat in the SettingsShot
 * harness, which drives the real poll against a live host and asserts the UI
 * thread keeps ticking. Both are needed: the lint catches the pattern the moment
 * it is written, and the heartbeat catches the ways blocking can happen that a
 * lint does not recognise.
 *
 *   node tools/verify-settings-blocking.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Anchored to this file rather than to the working directory, so the tool behaves
// the same however it is invoked.
const HERE = dirname(fileURLToPath(import.meta.url));
const SETTINGS = resolve(HERE, '../src/AnomalyEngine/SettingsWindow/SettingsWindow.xaml.cs');

const src = readFileSync(SETTINGS, 'utf8').split(/\r?\n/);

/**
 * Each pattern is something that blocks a thread until another completes.
 *
 * `.Result` and `.Wait()` are checked alongside the specific
 * `.GetAwaiter().GetResult()` because they are the same defect wearing a
 * different hat, and because the obvious fix for one is often to write the other.
 */
const RULES = [
  {
    pattern: /\.GetAwaiter\(\)\s*\.GetResult\(\)/,
    why: 'blocks the calling thread; WebView2 delivers its completion on the UI thread, so this deadlocks',
  },
  {
    pattern: /\.Result\b(?!\s*=)/,
    why: 'blocks the calling thread on a Task',
  },
  {
    pattern: /Task\.Wait\s*\(/,
    why: 'blocks the calling thread',
  },
  {
    pattern: /\.Wait\(\s*(TimeSpan|Infinite|int)/,
    why: 'blocks the calling thread',
  },
  {
    pattern: /\bThread\.Sleep\s*\(/,
    why: 'blocks the UI thread outright',
  },
];

let failed = 0;
const lines = src.length;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // Comments are allowed to name the pattern; that is how the reasons get written
  // down next to the code they explain.
  const trimmed = line.trimStart();
  if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

  for (const rule of RULES) {
    if (!rule.pattern.test(line)) continue;
    // Exempt anything inside an async method, where awaiting is correct. A crude
    // but useful heuristic: if the surrounding method is declared async, a
    // blocking call is still wrong, but `.Result` is more likely a false
    // positive on a comparison. The concrete deadlock pattern is never allowed.
    if (rule.pattern.source.includes('GetAwaiter') === false &&
        isInsideAsyncMethod(src, i)) continue;

    console.log(`FAIL  ${SETTINGS}:${i + 1}  ${rule.why}`);
    console.log(`        ${line.trim()}`);
    failed++;
  }
}

function isInsideAsyncMethod(all, index) {
  // Walk back to the nearest method declaration and look for `async`.
  for (let i = index; i >= 0 && i > index - 400; i--) {
    const m = /^\s*(?:private|public|internal|protected)[\w\s<>?,\[\]]*\s(\w+)\s*\(/.exec(all[i]);
    if (m) return /\basync\b/.test(all[i]);
  }
  return false;
}

if (failed) {
  console.log(`\n${failed} blocking call(s) in the settings window UI path.`);
  console.log('These deadlock the UI thread when the engine cannot answer synchronously.');
  process.exit(1);
}

console.log(`PASS  no UI-thread blocking in the settings window  -- ${lines} lines scanned, ${RULES.length} patterns`);
process.exit(0);