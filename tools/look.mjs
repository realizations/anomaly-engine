/**
 * Renders one frame, optionally crops it, and reports horizontal seams.
 *
 *   node tools/look.mjs --dir darker --hour 1.4
 *   node tools/look.mjs --dir depth --hour 16.9 --crop 300,700,1400,420
 *   node tools/look.mjs --dir depth --anomaly second-moon --motion 0
 *
 * The mockup tool answers "is the direction working". This one answers "why is
 * that shape wrong". Judging a 1920x1080 frame at contact-sheet size hides the
 * defects that matter — a row of glossy ellipses is invisible at 300px wide and
 * obvious at 1400px — and it also hides the ones a screenshot alone will not
 * show you at all, which is why it also measures.
 *
 * ## The seam check
 *
 * This repository has produced the same defect three separate times: a wide
 * `fillRect` whose gradient is at non-zero alpha at the *top* of the rect. It
 * puts a hard horizontal step straight across the picture, it is nearly
 * invisible in a thumbnail, and it cost real time to find by eye each time. The
 * rule it violates is simple — a wash must be zero where it starts and zero
 * where it ends — and this checks it rather than trusting it.
 *
 * A seam is a single large jump in row luminance. Grass blades and tree edges
 * produce many small jumps; a real seam produces one big one.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');
const OUT = resolve(HERE, '../build/look');
const W = Number(arg('w', 1920));
const H = Number(arg('h', 1080));
const CROP = arg('crop', null);

if (!existsSync(DEPLOYED)) {
  console.error('Deployed renderer not found. Build first:  dotnet build src\\AnomalyEngine');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 30000 });

await page.evaluate(
  ({ dir, hour, weather, world, style, motion, anomaly }) => {
    window.__engine.setWorld(world);
    window.__engine.setStyle(style);
    window.__engine.setDirection(dir);
    window.__engine.setSimulatedHour(hour);
    window.__engine.setSimulatedWeather(weather);
    window.__engine.setMotionIntensity(motion);
    if (anomaly) window.__engine.fireAnomaly(anomaly);
  },
  {
    dir: arg('dir', 'depth'),
    hour: Number(arg('hour', 16.9)),
    weather: arg('weather', 'clear'),
    world: arg('world', 'the-town-that-wasnt-there'),
    style: arg('style', 'painterly'),
    motion: Number(arg('motion', 0.35)),
    anomaly: arg('anomaly', null),
  }
);
await page.waitForTimeout(Number(arg('wait', 1400)));

const analysis = await page.evaluate((crop) => {
  const src = document.getElementById('wallpaper-canvas');
  const g = src.getContext('2d', { willReadFrequently: true });

  // Row luminance over a span that avoids the terminal, whose own hard edges
  // would otherwise dominate the measurement.
  const x0 = Math.round(src.width * 0.55);
  const span = Math.round(src.width * 0.4);
  const rows = new Float64Array(src.height);
  for (let y = 0; y < src.height; y++) {
    const d = g.getImageData(x0, y, span, 1).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    rows[y] = s / span;
  }

  // Median absolute step, as the noise floor a real seam has to clear.
  const steps = [];
  for (let y = 1; y < rows.length; y++) steps.push(Math.abs(rows[y] - rows[y - 1]));
  const sorted = Array.from(steps).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 0;

  const seams = [];
  for (let y = 1; y < rows.length; y++) {
    const step = rows[y] - rows[y - 1];
    // A wash-rect seam measures 9-13 luma; the strongest legitimate content edge
    // in these scenes — a treeline meeting the ground, the near-forest band — is
    // around 4. The threshold sits between the two on purpose: low enough to
    // catch the defect, high enough not to report the landscape.
    if (Math.abs(step) > Math.max(6, median * 12)) seams.push({ y, step: +step.toFixed(2) });
  }

  let url = src.toDataURL('image/png');
  if (crop) {
    const [cx, cy, cw, ch] = crop;
    const t = document.createElement('canvas');
    t.width = cw;
    t.height = ch;
    t.getContext('2d').drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch);
    url = t.toDataURL('image/png');
  }
  return { url, seams, median: +median.toFixed(3) };
}, CROP ? CROP.split(',').map(Number) : null);

const name = [
  arg('dir', 'depth'),
  arg('weather', 'clear'),
  `h${arg('hour', '16.9')}`,
  CROP ? 'crop' : 'full',
].join('-');
const out = resolve(OUT, `${name}.png`);
writeFileSync(out, Buffer.from(analysis.url.split(',')[1], 'base64'));
await browser.close();

console.log(out);
console.log(`typical row-to-row change: ${analysis.median}`);
if (analysis.seams.length === 0) {
  console.log('PASS  no full-width horizontal seams');
} else {
  console.log(`FAIL  ${analysis.seams.length} full-width horizontal seam(s):`);
  for (const s of analysis.seams.slice(0, 10)) console.log(`        y=${s.y} (${((s.y / H) * 100).toFixed(1)}% down)  step ${s.step > 0 ? '+' : ''}${s.step}`);
}
process.exit(analysis.seams.length === 0 ? 0 : 1);