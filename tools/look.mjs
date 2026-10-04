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
 * A seam is a full-width jump in row luminance. Weather and landmarks can move a
 * span or two; a real seam moves all four sampled spans.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyseFrame, formatSeams } from './lib/frame-stats.mjs';

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
// Serialised into the page, because it has to run against the live canvas.
// Passed as an argument and eval'd there rather than handed to page.evaluate as a
// string: an expression string containing a multi-line function body with block
// comments is at the mercy of how the driver parses it, and when it did not parse
// the checker silently reported "no seams" on a frame with a 15-luma step in it.
await page.evaluate((src) => {
  window.__frameStats = eval(`(${src})`);
}, analyseFrame.toString());

await page.evaluate(
  ({ dir, hour, weather, world, style, motion, anomaly }) => {
    window.__engine.setWorld(world);
    window.__engine.setStyle(style);
    window.__engine.setDirection(dir);
    window.__engine.setSimulatedHour(hour);
    window.__engine.setSimulatedWeather(weather);
    window.__engine.setMotionIntensity(motion);
    if (anomaly) window.__engine.forceAnomaly(anomaly);
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
  const stats = window.__frameStats(g, src.width, src.height);
  let url = src.toDataURL('image/png');
  if (crop) {
    const [cx, cy, cw, ch] = crop;
    const t = document.createElement('canvas');
    t.width = cw;
    t.height = ch;
    t.getContext('2d').drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch);
    url = t.toDataURL('image/png');
  }
  return { url, ...stats };
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
console.log(`mean luma ${analysis.luma}   value spread ${analysis.spread}   ${analysis.bins.map((b) => (b * 100).toFixed(0).padStart(3)).join('')}`);
console.log(formatSeams(analysis.seams, H));
process.exit(analysis.seams.length === 0 ? 0 : 1);
