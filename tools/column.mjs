import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const INDEX = pathToFileURL(
  join(process.cwd(), '..', 'src', 'AnomalyEngine', 'bin', 'Debug', 'net8.0-windows', 'renderer', 'index.html')
).href;

const style = process.argv[2] || 'flat';
const hour = Number(process.argv[3] ?? 2);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => process.stdout.write(`pageerror: ${e.message}\n`));
await page.goto(INDEX);
await page.waitForTimeout(2500);

await page.evaluate(({ s, h }) => {
  window.__engine.setSimulatedHour(h);
  window.__engine.setStyle(s);
}, { s: style, h: hour });
await page.waitForTimeout(1500);

const col = await page.evaluate(() => {
  const c = document.getElementById('wallpaper-canvas');
  const g = c.getContext('2d');
  const x = 20; // far left, avoids towers/observatory/cabin
  const out = [];
  for (let f = 0; f <= 100; f += 2) {
    const y = Math.min(c.height - 1, Math.round((f / 100) * c.height));
    const d = g.getImageData(x, y, 1, 1).data;
    out.push({ f, rgb: `${d[0]},${d[1]},${d[2]}` });
  }
  return out;
});

let prev = null;
for (const { f, rgb } of col) {
  const mark = prev !== null && prev !== rgb ? '  <-- change' : '';
  process.stdout.write(`${String(f).padStart(3)}%  ${rgb}${mark}\n`);
  prev = rgb;
}

await browser.close();
