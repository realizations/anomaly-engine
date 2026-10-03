/**
 * Renders one frame and optionally crops a region of it.
 *
 *   node tools/look.mjs --dir darker --hour 1.4 --crop 300,700,1400,420
 *   node tools/look.mjs --dir depth --hour 16.9 --weather storm --anomaly second-moon
 *
 * The mockup tool answers "is the direction working". This one answers "why is
 * that shape wrong", which is a different question and needs a different crop.
 * Judging a 1920x1080 frame at contact-sheet size hides exactly the defects that
 * matter — a row of glossy ellipses is invisible at 300px wide and obvious at
 * 1400px.
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
  console.error(`Deployed renderer not found. Build first:  dotnet build src\\AnomalyEngine`);
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

const url = await page.evaluate((crop) => {
  const src = document.getElementById('wallpaper-canvas');
  if (!crop) return src.toDataURL('image/png');
  const [x, y, w, h] = crop;
  const t = document.createElement('canvas');
  t.width = w;
  t.height = h;
  t.getContext('2d').drawImage(src, x, y, w, h, 0, 0, w, h);
  return t.toDataURL('image/png');
}, CROP ? CROP.split(',').map(Number) : null);

const name = [
  arg('dir', 'depth'),
  arg('weather', 'clear'),
  `h${arg('hour', '16.9')}`,
  CROP ? 'crop' : 'full',
].join('-');
const out = resolve(OUT, `${name}.png`);
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
await browser.close();
console.log(out);