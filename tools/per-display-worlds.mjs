/**
 * Proves each display can show its own world.
 *
 * Per-monitor composition already existed and was already proven: the renderer
 * draws every display independently rather than stretching one wide image across
 * the desktop. What it did not do was let a display show a different place, so a
 * two-screen setup showed the same world twice, framed differently.
 *
 * This checks the assignment actually reaches the composition. Asserting on the
 * stored mapping would prove nothing: the mapping could be saved perfectly and
 * the renderer could ignore it, and the check would still pass.
 *
 *   node tools/per-display-worlds.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Anchored to this file rather than to the working directory, so the tool
// behaves the same however it is invoked.
const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');

let failures = 0;
function check(name, pass, detail = '') {
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
  if (!pass) failures++;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });

/** Reports a monitor layout, exactly as the native host does. */
const report = (monitors) => page.evaluate((m) => {
  window.dispatchEvent(new CustomEvent('anomaly:monitors', { detail: { monitors: m } }));
}, monitors);

const TWO = [
  { id: '\\.\DISPLAY1', x: 0, y: 0, w: 1280, h: 720, primary: true },
  { id: '\\.\DISPLAY2', x: 1280, y: 0, w: 1280, h: 720, primary: false },
];

await report(TWO);
await page.waitForTimeout(400);

check('the host-reported display ids reach the engine',
  (await page.evaluate(() => window.__engine.getMonitors().map((m) => m.id))).join(',') === '\\.\DISPLAY1,\\.\DISPLAY2',
  (await page.evaluate(() => window.__engine.getMonitors().map((m) => m.id).join(','))));

check('the primary display is identified',
  (await page.evaluate(() => window.__engine.getMonitors().filter((m) => m.primary).length)) === 1);

// Assign the second display a different world, and make sure the two screens
// actually end up showing different places.
const townId = 'the-town-that-wasnt-there';
const desertId = 'the-dry-mere';
await page.evaluate(() => window.__engine.setWorld('the-town-that-wasnt-there'));
const assigned = await page.evaluate(
  ({ id, w }) => window.__engine.setDisplayWorld(id, w),
  { id: '\\.\DISPLAY2', w: desertId }
);
check('a world can be assigned to a display', assigned === true);

await page.waitForTimeout(500);
check('the assignment is remembered',
  (await page.evaluate(() => window.__engine.getDisplayWorlds()['\\.\DISPLAY2'])) === desertId,
  JSON.stringify(await page.evaluate(() => window.__engine.getDisplayWorlds())));

/**
 * Samples a rectangle of the canvas and reports its mean colour.
 *
 * Comparing pixels is the only way to show the two screens are actually drawing
 * different places. Two desert screens and two town screens have different
 * palettes, so a large colour distance between the two regions means the
 * assignment reached the composition rather than sitting in a field.
 */
const regionMean = (fx, fy, fw, fh) => page.evaluate(({ fx, fy, fw, fh }) => {
  const cv = document.getElementById('wallpaper-canvas');
  const g = cv.getContext('2d');
  const x = Math.round(cv.width * fx);
  const y = Math.round(cv.height * fy);
  const w = Math.max(1, Math.round(cv.width * fw));
  const h = Math.max(1, Math.round(cv.height * fh));
  const d = g.getImageData(x, y, w, h).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; n++; }
  return { r: r / n, g: gg / n, b: b / n };
}, { fx, fy, fw, fh });

// Sample the upper band of each half: above the horizon, and clear of the terminal,
// which is drawn in the bottom-left of the primary viewport and would otherwise
// dominate the primary's average.
const left = await regionMean(0.1, 0.2, 0.3, 0.25);
const right = await regionMean(0.6, 0.2, 0.3, 0.25);
const dist = Math.hypot(left.r - right.r, left.g - right.g, left.b - right.b);
check('the two displays render visibly different places', dist > 12,
  `colour distance ${dist.toFixed(1)} (left ${left.r | 0},${left.g | 0},${left.b | 0} / right ${right.r | 0},${right.g | 0},${right.b | 0})`);

// Clearing the assignment must put the second display back on the active world.
const cleared = await page.evaluate(() => window.__engine.setDisplayWorld('\\.\DISPLAY2', null));
check('an assignment can be cleared', cleared === true);
await page.waitForTimeout(400);
const left2 = await regionMean(0.1, 0.2, 0.3, 0.25);
const right2 = await regionMean(0.6, 0.2, 0.3, 0.25);
const dist2 = Math.hypot(left2.r - right2.r, left2.g - right2.g, left2.b - right2.b);
check('clearing it makes both displays show the same world again', dist2 < 12,
  `colour distance ${dist2.toFixed(1)}`);

// An unknown world must be rejected rather than leaving a black rectangle.
check('assigning a world that does not exist is rejected',
  (await page.evaluate(() => window.__engine.setDisplayWorld('\\.\DISPLAY2', 'no-such-world'))) === false);

// A display that is currently unplugged keeps its assignment, because that is a
// normal state and the setting should still be there when the monitor comes back.
await page.evaluate(({ id, w }) => window.__engine.setDisplayWorld(id, w), { id: '\\.\DISPLAY3', w: desertId });
check('an assignment for an unattached display is kept',
  (await page.evaluate(() => window.__engine.getDisplayWorlds()['\\.\DISPLAY3'])) === desertId);

// Keying on the display id, not on its index, is the whole point. Windows
// reorders the monitor list when the primary changes, so an assignment stored
// by index would migrate to the wrong screen. Both displays need an assignment
// first, otherwise a cleared one proves nothing about where it went.
await page.evaluate(({ id, w }) => window.__engine.setDisplayWorld(id, w), { id: '\\.\DISPLAY1', w: desertId });
await page.evaluate(({ id, w }) => window.__engine.setDisplayWorld(id, w), { id: '\\.\DISPLAY2', w: townId });
await report([
  { id: '\\.\DISPLAY2', x: 1280, y: 0, w: 1280, h: 720, primary: true },
  { id: '\\.\DISPLAY1', x: 0, y: 0, w: 1280, h: 720, primary: false },
]);
await page.waitForTimeout(400);
const after = await page.evaluate(() => window.__engine.getDisplayWorlds());
check('assignments follow the display, not its position in the list',
  after['\\.\DISPLAY1'] === desertId && after['\\.\DISPLAY2'] === townId,
  JSON.stringify(after));

// And they have to survive a restart, like everything else the user has chosen.
// The expected values are the ones set immediately above, not the ones from
// earlier in the run.
await page.reload();
await page.waitForTimeout(3000);
await report(TWO);
await page.waitForTimeout(400);
const restored = await page.evaluate(() => window.__engine.getDisplayWorlds());
check('per-display worlds survive a restart',
  restored['\\.\DISPLAY1'] === desertId && restored['\\.\DISPLAY2'] === townId,
  JSON.stringify(restored));

await browser.close();
console.log(failures ? `\n${failures} per-display world check(s) failed.` : '\nPASS  every display can show its own world.');
process.exit(failures ? 1 : 0);
