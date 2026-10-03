/**
 * Renders the visual mockup laboratory.
 *
 *   node tools/visual-mockups.mjs
 *   node tools/visual-mockups.mjs --only depth --size 2560x1440 --out build/scratch
 *
 * One world, one layout, one clock, three art directions. That is the whole point:
 * if the directions differ only in how the same scene is tinted, the comparison
 * is worthless, so every image below is the same world at the same hour and the
 * only variable is the direction the renderer composes.
 *
 * Writes PNGs and a contact sheet into docs/visual-mockups (or --out), so the
 * images committed to the repository can always be regenerated from source. An
 * image nobody can reproduce is an advertisement, not evidence.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');
const OUT = resolve(HERE, '..', arg('out', 'docs/visual-mockups'));
const [W, H] = arg('size', '1920x1080').split('x').map(Number);
const ONLY = arg('only', null);
const DIRECTIONS = ONLY ? [ONLY] : ['depth', 'atmospheric', 'darker'];

/**
 * Three conditions, not one. A direction that only works at night is not a
 * direction. Golden hour is where a flat palette is most obvious; storm is where
 * a scene that has no air in it falls apart.
 */
const TIMES = [
  { name: 'night', hour: 1.4, weather: 'clear' },
  { name: 'golden', hour: 16.9, weather: 'clear' },
  { name: 'storm', hour: 15.2, weather: 'storm' },
];

const WORLD = 'the-town-that-wasnt-there';

if (!existsSync(DEPLOYED)) {
  console.error(`Deployed renderer not found:\n  ${DEPLOYED}\nBuild first:  dotnet build src\\AnomalyEngine`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
for (const f of ['contact-sheet.jpg', 'contact-sheet.png']) {
  if (existsSync(resolve(OUT, f))) rmSync(resolve(OUT, f));
}

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
});
await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 30000 });

const shots = [];
for (const d of DIRECTIONS) {
  for (const t of TIMES) {
    await page.evaluate(
      ({ world, dir, hour, weather }) => {
        window.__engine.setWorld(world);
        window.__engine.setStyle('painterly');
        window.__engine.setDirection(dir);
        window.__engine.setSimulatedHour(hour);
        window.__engine.setSimulatedWeather(weather);
      },
      { world: WORLD, dir: d, hour: t.hour, weather: t.weather }
    );
    // Long enough for the adaptive scale and the light falloff to settle, short
    // enough that a whole run stays usable while iterating.
    await page.waitForTimeout(1400);

    const stats = await page.evaluate(() => {
      const c = document.getElementById('wallpaper-canvas');
      const g = c.getContext('2d');
      const px = g.getImageData(0, 0, c.width, c.height).data;
      // Mean luminance plus a coarse histogram. Mean alone cannot tell a dark,
      // well-composed frame from a dark, empty one; the spread of the histogram
      // can, and it is the cheapest honest proxy for "is there a value structure".
      const bins = new Array(8).fill(0);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < px.length; i += 16) {
        const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        sum += l;
        n++;
        bins[Math.min(7, Math.floor(l / 32))]++;
      }
      return { luma: sum / n, bins: bins.map((b) => b / n) };
    });

    const url = await page.evaluate(() => document.getElementById('wallpaper-canvas').toDataURL('image/png'));
    const b64 = url.split(',')[1];
    writeFileSync(resolve(OUT, `${d}-${t.name}.png`), Buffer.from(b64, 'base64'));
    shots.push({ dir: d, time: t.name, b64, ...stats });
    console.log(
      `${(d + '-' + t.name).padEnd(22)} luma ${stats.luma.toFixed(1).padStart(5)}   ` +
        `value spread ${stats.bins.map((b) => (b * 100).toFixed(0).padStart(3)).join(' ')}`
    );
  }
}

/* --------------------------- contact sheet --------------------------- */

const sheet = await page.evaluate(
  async ({ shots, rowLabels, colLabels, cols }) => {
    const cellW = 620;
    const cellH = Math.round(cellW * 9 / 16);
    const pad = 10;
    const labelW = 108;
    const headH = 30;
    const cv = document.createElement('canvas');
    cv.width = labelW + cols * (cellW + pad) + pad;
    cv.height = headH + rowLabels.length * (cellH + pad) + pad;
    const g = cv.getContext('2d');
    g.fillStyle = '#0a0c10';
    g.fillRect(0, 0, cv.width, cv.height);
    g.font = '500 15px system-ui, sans-serif';
    g.textBaseline = 'middle';

    colLabels.forEach((l, c) => {
      g.fillStyle = '#7f9c92';
      g.fillText(String(l), labelW + c * (cellW + pad) + 8, headH / 2 + 2);
    });
    for (let r = 0; r < rowLabels.length; r++) {
      const y = headH + r * (cellH + pad);
      g.fillStyle = '#c8dcd4';
      g.fillText(String(rowLabels[r]), 10, y + cellH / 2);
      for (let c = 0; c < cols; c++) {
        const img = new Image();
        img.src = 'data:image/png;base64,' + shots[r * cols + c].b64;
        await img.decode();
        g.drawImage(img, labelW + c * (cellW + pad), y, cellW, cellH);
      }
    }
    return cv.toDataURL('image/png');
  },
  {
    shots,
    rowLabels: DIRECTIONS,
    colLabels: TIMES.map((t) => t.name),
    cols: TIMES.length,
  }
);
writeFileSync(resolve(OUT, 'contact-sheet.png'), Buffer.from(sheet.split(',')[1], 'base64'));

await browser.close();

writeFileSync(
  resolve(OUT, 'render-stats.json'),
  JSON.stringify(
    shots.map(({ b64, ...rest }) => ({
      ...rest,
      // Value spread is the useful number. A frame whose luminance all sits in
      // one or two buckets is a flat frame, however pretty its gradient is.
      valueSpread: Math.max(...rest.bins) - Math.min(...rest.bins),
    })),
    null,
    2
  )
);

console.log(`\nwrote ${shots.length} renders + contact sheet to ${OUT}`);
