/**
 * Proves the debug overlay reports the running engine, not its own defaults.
 *
 * The overlay opened and showed `FPS: 0 | Frame: 0.0ms`, `WebView: unknown` and three
 * empty discovery rows for the entire life of this project, because nothing ever called
 * `DebugOverlay.update`. README.md described it as reporting frame time, memory and
 * render scale.
 *
 * Unit tests cover the rendering; this covers the wiring, which is the half that was
 * broken. It toggles the overlay exactly the way the host does -- by dispatching the
 * `anomaly:debug` event -- and then reads the panel off the live engine.
 */
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForTimeout(4000);

// The host's own route: tray item or Ctrl+Alt+D dispatches this.
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:debug')));
// The overlay is fed once a second, so wait past one tick rather than for the panel.
await page.waitForTimeout(1600);

const text = await page.evaluate(
  () => document.getElementById('anomaly-debug-overlay')?.textContent ?? ''
);

const problems = [];
const check = (ok, why) => { if (!ok) problems.push(why); };

check(text.length > 0, 'the overlay element does not exist after anomaly:debug');

if (text) {
  // The three lines the old defaults could never produce. Each is a value the engine
  // computes and the overlay was never given.
  const fps = /FPS\s+(\d+)/.exec(text);
  check(fps !== null, 'no FPS line');
  check(Number(fps?.[1] ?? 0) > 0, `FPS reads ${fps?.[1]}, which is the untouched default`);

  const frame = /Frame\s+([\d.]+) ms/.exec(text);
  check(frame !== null, 'no frame-time line');
  check(Number(frame?.[1] ?? 0) > 0, `frame time reads ${frame?.[1]}ms, which is the untouched default`);

  check(/Condition\s+(clear|cloudy|rain|storm|snow|fog)/.test(text),
    `no real weather condition: ${/Condition\s+(\S+)/.exec(text)?.[1] ?? '(absent)'}`);
  check(/Moon phase\s+[\d.]/.test(text), `moon phase is not a number: ${/Moon phase\s+(\S+)/.exec(text)?.[1] ?? '(absent)'}`);
  check(!/Condition\s+-/.test(text), 'the weather row is still a dash, so update() is not reaching the overlay');
  check(/Secrets\s+\d+\/\d+/.test(text), 'no secrets progress');
}

// Toggling twice must leave nothing behind: a second repaint timer would double the
// work for the rest of the session.
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:debug')));
await page.waitForTimeout(200);
const afterSecondToggle = await page.evaluate(
  () => document.querySelectorAll('#anomaly-debug-overlay').length
);
check(afterSecondToggle === 0, `${afterSecondToggle} overlays remain after toggling off`);

if (text) {
  const lines = text.split('\n').filter((l) => l.trim());
  process.stdout.write(`      ${lines.length} lines\n`);
  process.stdout.write(
    `      ${/FPS\s+\S+/.exec(text)?.[0]} | ${/Frame\s+\S+/.exec(text)?.[0]} | ` +
    `${/Condition\s+\S+/.exec(text)?.[0]} | ${/Moon phase\s+\S+/.exec(text)?.[0]}\n`
  );
}

await browser.close();

if (problems.length || errors.length) {
  console.error('FAIL  the debug overlay is not reporting the running engine:');
  for (const p of problems) console.error(`      ${p}`);
  for (const e of errors) console.error(`      ${e}`);
  process.exit(1);
}
console.log('PASS  the debug overlay reports live fps, frame time, weather, moon and discovery');
