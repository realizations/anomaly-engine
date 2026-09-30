import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

// Anchored to this file rather than to the working directory, so the tool
// behaves the same however it is invoked.
const HERE = dirname(fileURLToPath(import.meta.url));

const INDEX = pathToFileURL(
  join(HERE, '..', 'src', 'AnomalyEngine', 'bin', 'Debug', 'net8.0-windows', 'renderer', 'index.html')
).href;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(INDEX);
await page.waitForTimeout(4000);

const state = await page.evaluate(() => {
  const c = document.getElementById('wallpaper-canvas');
  const g = c?.getContext('2d');
  const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3);
  return {
    engineDefined: typeof window.__engine !== 'undefined',
    bootStillPresent: !!document.getElementById('anomaly-boot'),
    canvas: c ? `${c.width}x${c.height}` : null,
    topLeft: c ? px(5, 5) : null,
    midSky: c ? px(960, 200) : null,
    bottomGround: c ? px(960, 1050) : null,
  };
});

process.stdout.write(JSON.stringify({ url: INDEX, state, errors }, null, 2) + '\n');
await browser.close();
