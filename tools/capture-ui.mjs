import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = join(HERE, '..', 'src', 'AnomalyEngine', 'bin', 'Debug', 'net8.0-windows', 'renderer', 'index.html');
const OUT = join(HERE, '..', 'build', 'ui');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });
await page.waitForTimeout(1500);

// Golden hour so the panel is legible against a bright scene.
await page.evaluate(() => {
  window.__engine.setSimulatedHour(20.2);
  window.__engine.setStyle('painterly');
});
await page.waitForTimeout(1200);

// Populate some history so the panel is not empty.
for (const a of ['meteor', 'red-moon', 'observatory-signal', 'forest-watcher']) {
  await page.evaluate((x) => window.__engine.forceAnomaly(x), a);
  await page.waitForTimeout(500);
}
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:notes')));
await page.waitForTimeout(1200);

const present = await page.evaluate(() => !!document.getElementById('anomaly-field-notes'));
const text = await page.evaluate(() => document.getElementById('anomaly-field-notes')?.innerText ?? '');
process.stdout.write(`panel present: ${present}\n`);
process.stdout.write(`--- panel content ---\n${text}\n-------------------\n`);
process.stdout.write(errors.length ? `errors: ${errors.join('; ')}\n` : 'no errors\n');

await page.screenshot({ path: join(OUT, 'field-notes.png') });
await browser.close();
