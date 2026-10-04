/**
 * The canonical visual cases.
 *
 *   node tools/visual-cases.mjs
 *   node tools/visual-cases.mjs --compare
 *
 * Renders a fixed set of named states, writes them to build/visual-cases/ along
 * with a manifest of luminance statistics, and fails when a case's statistics
 * move outside a band recorded in the manifest. Running with --compare against
 * a committed manifest is the regression gate.
 *
 * ## What it asserts, and what it does not
 *
 * It does **not** do pixel diffing. Canvas under headless compositing is paced,
 * not real-time: two runs of an identical frame differ in the clock, in the
 * weather system's phase and in which particle is where. A pixel-exact gate on
 * top of that would be either useless (tolerance so wide it catches nothing) or
 * unusable (fails every run), and it would push every future change towards
 * freezing the renderer, which is the opposite of what this repository needs.
 *
 * What it does assert is the thing that actually broke. Every defect found in the
 * visual pass was structural, and structural defects move statistics even when
 * they move almost no pixels:
 *
 *   * mean luminance -- catches a palette that collapsed to black or to white
 *   * value spread -- the histogram's occupied band. A frame whose luminance all
 *     sits in one or two of eight buckets is a flat frame however pretty its
 *     gradient is. The night palette measured 96% in a single bucket.
 *   * seam count -- hard full-width horizontal steps, the defect this repository
 *     produced three separate times
 *   * distinctness -- the three directions must not converge into one image
 *
 * Those four are stable under pacing and sensitive to composition, which is the
 * correct trade. The images are still written every run, so a human can look at
 * them, which is the part a number cannot do.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyseFrame } from './lib/frame-stats.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');
const OUT = resolve(HERE, '../build/visual-cases');
const BASELINE = resolve(HERE, '../docs/visual-baseline.json');

const COMPARE = process.argv.includes('--compare');
const WRITE_BASELINE = process.argv.includes('--write-baseline');

/**
 * The canonical set.
 *
 * Chosen to cover the states that are actually distinct rather than every state
 * that exists: the three times of day the renderer treats differently, each
 * direction, the anomaly and event paths that draw over the scene, and the two
 * settings that change how the frame is built rather than what is in it.
 */
const CASES = [
  { name: 'depth-night', dir: 'depth', hour: 1.4, weather: 'clear' },
  { name: 'depth-sunset', dir: 'depth', hour: 18.7, weather: 'clear' },
  { name: 'depth-storm', dir: 'depth', hour: 15.2, weather: 'storm' },
  { name: 'depth-fog', dir: 'depth', hour: 6.4, weather: 'fog' },
  { name: 'atmospheric-night', dir: 'atmospheric', hour: 1.4, weather: 'clear' },
  { name: 'atmospheric-sunset', dir: 'atmospheric', hour: 18.7, weather: 'clear' },
  { name: 'atmospheric-storm', dir: 'atmospheric', hour: 15.2, weather: 'storm' },
  { name: 'darker-night', dir: 'darker', hour: 1.4, weather: 'clear' },
  { name: 'darker-sunset', dir: 'darker', hour: 18.7, weather: 'clear' },
  { name: 'darker-storm', dir: 'darker', hour: 15.2, weather: 'storm' },

  // An anomaly draws over the composed scene, so it has to be checked as its own
  // case rather than assumed to be covered by the plain ones.
  { name: 'depth-second-moon', dir: 'depth', hour: 22.5, weather: 'clear', anomaly: 'second-moon' },
  { name: 'depth-red-moon', dir: 'depth', hour: 22.5, weather: 'clear', anomaly: 'red-moon' },
  { name: 'darker-meteor', dir: 'darker', hour: 23.5, weather: 'clear', anomaly: 'meteor' },
  { name: 'depth-forest-watcher', dir: 'depth', hour: 23.5, weather: 'clear', anomaly: 'forest-watcher' },
  { name: 'depth-observatory-signal', dir: 'depth', hour: 23.5, weather: 'clear', anomaly: 'observatory-signal' },
  { name: 'darker-lights-out', dir: 'darker', hour: 23.5, weather: 'clear', anomaly: 'lights-out' },

  // Reduced motion and the performance path change how the frame is built, not
  // what is in it, so a change in either can pass every other case here.
  { name: 'depth-reduced-motion', dir: 'depth', hour: 16.9, weather: 'clear', motion: 0 },
  { name: 'depth-low-quality', dir: 'depth', hour: 16.9, weather: 'clear', scale: 0.6 },

  // A non-painterly style, because the post-processing path is entirely separate
  // and nothing else in this list touches it.
  //
  // The seam check is per-style because the styles are built differently, and the
  // answer is not the same for both. Flat is back under the check: measured clean
  // at night, dawn, dusk and golden hour. Riso stays out, and the reason is
  // narrower than it was. The old note here said the check reported 226 of them
  // for both, which was really the two-span check tripping on the frame at large
  // rather than on anything riso does. Measured now, riso reports two rows, at
  // 94% of the height, at golden hour and at midnight but not at dawn or late
  // evening, and the same state in painterly reports none. That is the
  // foreground silhouette's boundary landing on a dot-grid quantisation step: a
  // content edge the medium hardens, not a wash rect with a gradient that starts
  // where it should not. There is nothing in the riso path for the check to catch,
  // and the defect it was written for cannot occur in a path that draws no washes.
  { name: 'depth-flat', dir: 'depth', hour: 16.9, weather: 'clear', style: 'flat' },
  { name: 'depth-flat-riso', dir: 'depth', hour: 16.9, weather: 'clear', style: 'riso', seamCheck: false },
];

if (!existsSync(DEPLOYED)) {
  console.error('Deployed renderer not found. Build first:  dotnet build src\\AnomalyEngine');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 30000 });
// Serialised into the page, because it has to run against the live canvas.
// Passed as an argument and eval'd there rather than handed to page.evaluate as a
// string: an expression string containing a multi-line function body with block
// comments is at the mercy of how the driver parses it, and when it did not parse
// the checker silently reported "no seams" on a frame with a 15-luma step in it.
await page.evaluate((src) => {
  window.__frameStats = eval(`(${src})`);
}, analyseFrame.toString());

const results = [];
for (const c of CASES) {
  await page.evaluate(
    ({ dir, hour, weather, anomaly, motion, scale, style }) => {
      window.__engine.setWorld('the-town-that-wasnt-there');
      window.__engine.setStyle(style ?? 'painterly');
      window.__engine.setDirection(dir);
      window.__engine.setSimulatedHour(hour);
      window.__engine.setSimulatedWeather(weather);
      if (motion !== undefined) window.__engine.setMotionIntensity(motion);
      if (scale !== undefined) window.__engine.setRenderScale(scale);
      if (anomaly) window.__engine.forceAnomaly(anomaly);
    },
    { ...c, style: c.style ?? 'painterly' }
  );
  // Long enough for the anomaly's envelope to be fully open, so an anomaly case
  // is not captured on its fade-in.
  await page.waitForTimeout(2000);

  const stats = await page.evaluate(() => {
    const src = document.getElementById('wallpaper-canvas');
    const g = src.getContext('2d', { willReadFrequently: true });
    const s = window.__frameStats(g, src.width, src.height);
    return { luma: s.luma, bins: s.bins, spread: s.spread, seams: s.seams.length };
  });
  const url = await page.evaluate(() => document.getElementById('wallpaper-canvas').toDataURL('image/png'));
  writeFileSync(resolve(OUT, `${c.name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  results.push({ ...c, ...stats });
  process.stdout.write(
    `${c.name.padEnd(26)} luma ${String(stats.luma).padStart(6)}  spread ${stats.spread.toFixed(2)}  seams ${stats.seams}\n`
  );
}
await browser.close();

/* ------------------------------ the gate ------------------------------ */

// Directions must not converge. This is the specific failure the previous
// direction implementation had: three filters over one picture, which produced
// three tints of the same image.
const byTime = new Map();
for (const r of results) {
  if (!r.anomaly && r.motion === undefined && r.scale === undefined && r.style === undefined) {
    const key = `${r.hour}-${r.weather}`;
    if (!byTime.has(key)) byTime.set(key, []);
    byTime.get(key).push(r);
  }
}
let converged = [];
for (const [key, group] of byTime) {
  const sigs = new Set(group.map((g) => `${g.luma}|${g.spread}`));
  if (sigs.size < group.length) converged.push(key);
}

let failed = 0;

for (const r of results) {
  if (r.seamCheck === false) continue;
  if (r.seams > 0) {
    console.error(`FAIL  ${r.name}: ${r.seams} full-width horizontal seam(s)`);
    failed++;
  }
}
if (converged.length) {
  console.error(`FAIL  directions converge at: ${converged.join(', ')}`);
  failed++;
}

const baseline = existsSync(BASELINE) && !WRITE_BASELINE ? JSON.parse(readFileSync(BASELINE, 'utf8')) : null;
if (WRITE_BASELINE || !baseline) {
  writeFileSync(BASELINE, JSON.stringify({ note: 'Recorded by tools/visual-cases.mjs --write-baseline', cases: results }, null, 2));
  console.log(`\nwrote baseline to ${BASELINE}`);
} else if (COMPARE) {
  const byName = new Map(baseline.cases.map((c) => [c.name, c]));
  for (const r of results) {
    const b = byName.get(r.name);
    if (!b) {
      console.error(`FAIL  ${r.name}: no baseline`);
      failed++;
      continue;
    }
    // Tolerance is deliberately wide on luminance. The clock and the weather
    // phase differ between runs and a structural change moves the mean by far
    // more than that does; 12% catches "the night palette collapsed" without
    // failing on a slightly different minute.
    const lumaDrift = Math.abs(r.luma - b.luma) / Math.max(1, b.luma);
    const spreadDrift = Math.abs(r.spread - b.spread);
    if (lumaDrift > 0.12) {
      console.error(`FAIL  ${r.name}: luma ${b.luma} -> ${r.luma} (${(lumaDrift * 100).toFixed(0)}% drift)`);
      failed++;
    }
    if (spreadDrift > 0.18) {
      console.error(`FAIL  ${r.name}: value spread ${b.spread} -> ${r.spread} -- the frame flattened or gained a new tonal band`);
      failed++;
    }
  }
}

console.log(
  failed
    ? `\n${failed} visual case(s) failed. Images in ${OUT}`
    : `\nPASS  ${results.length} visual cases hold. Images in ${OUT}`
);
process.exit(failed ? 1 : 0);