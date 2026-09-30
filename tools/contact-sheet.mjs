/**
 * Builds contact sheets for visual review.
 *
 * Reviewing one frame at a time hides systematic problems, because a bug that
 * affects everything looks fine in any single sample. Tiling many renders of the
 * same scene at different hours, or the same hour across different worlds,
 * makes a fault that is only visible as a pattern actually visible.
 *
 *   node tools/contact-sheet.mjs world-hour      one row per world, columns are hours
 *   node tools/contact-sheet.mjs world-style     one row per world, columns are styles
 *   node tools/contact-sheet.mjs style-hour      one row per style, columns are hours
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');
const OUT = resolve(HERE, '../build/review');
mkdirSync(OUT, { recursive: true });

const WORLDS = [
  ['the-town-that-wasnt-there', 'town'],
  ['saltwick', 'salt'],
  ['the-long-fell', 'fell'],
  ['the-dry-mere', 'mere'],
  ['the-long-head', 'head'],
  ['the-long-corridor', 'corridor'],
];
const HOURS = [0.5, 6.8, 12, 16.8, 19.4, 21.8];
const STYLES = ['painterly', 'flat', 'riso'];
const CELL_W = 300;

const mode = process.argv[2] ?? 'world-hour';
const rows = mode === 'world-hour' ? WORLDS : mode === 'world-style' ? WORLDS : STYLES;
const cols = mode === 'world-hour' ? HOURS : mode === 'world-style' ? STYLES : HOURS;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: CELL_W, height: Math.round(CELL_W * 9 / 16) } });
await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });

const shots = [];
for (const row of rows) {
  for (const col of cols) {
    await page.evaluate(
      ({ w, s, h }) => {
        if (w) window.__engine.setWorld(w);
        if (s) window.__engine.setStyle(s);
        if (h !== undefined) window.__engine.setSimulatedHour(h);
      },
      {
        w: Array.isArray(row) ? row[0] : undefined,
        s: Array.isArray(row) ? undefined : row,
        h: typeof col === 'number' ? col : undefined,
      }
    );
    await page.waitForTimeout(220);
    const url = await page.evaluate(() => document.getElementById('wallpaper-canvas').toDataURL('image/png'));
    // Base64 strings, because Buffers do not survive the trip into the page.
    shots.push(url.split(',')[1]);
  }
}
await browser.close();

const compose = await chromium.launch();
const cpage = await compose.newPage({ viewport: { width: 10, height: 10 } });
const sheetUrl = await cpage.evaluate(
  async ({ shots, cols, rowLabels, colLabels, cellW }) => {
    const cellH = Math.round(cellW * 9 / 16);
    const pad = 6;
    const labelW = 92;
    const headH = 24;
    const cv = document.createElement('canvas');
    cv.width = labelW + colLabels.length * (cellW + pad) + pad;
    cv.height = headH + rowLabels.length * (cellH + pad) + pad;
    const g = cv.getContext('2d');
    g.fillStyle = '#0b0e12';
    g.fillRect(0, 0, cv.width, cv.height);
    g.font = '500 12px system-ui, sans-serif';
    g.textBaseline = 'middle';

    colLabels.forEach((l, c) => {
      g.fillStyle = '#8fb3a4';
      g.fillText(String(l), labelW + c * (cellW + pad) + 6, headH / 2 + 2);
    });
    for (let r = 0; r < rowLabels.length; r++) {
      const y = headH + r * (cellH + pad);
      g.fillStyle = '#cfe0d8';
      g.fillText(String(rowLabels[r]), 8, y + cellH / 2);
      for (let c = 0; c < colLabels.length; c++) {
        const img = new Image();
        img.src = 'data:image/png;base64,' + shots[r * colLabels.length + c];
        await img.decode();
        g.drawImage(img, labelW + c * (cellW + pad), y, cellW, cellH);
      }
    }
    return cv.toDataURL('image/png');
  },
  { shots, rowLabels: rows.map((r) => (Array.isArray(r) ? r[1] : r)), colLabels: cols, cellW: CELL_W }
);
await compose.close();

const out = resolve(OUT, `sheet-${mode}.png`);
writeFileSync(out, Buffer.from(sheetUrl.split(',')[1], 'base64'));
console.log(`wrote ${out}`);
