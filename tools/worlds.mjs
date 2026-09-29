import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = join(HERE, '..', 'src', 'AnomalyEngine', 'bin', 'Debug', 'net8.0-windows', 'renderer', 'index.html');
const OUT = join(HERE, '..', 'build', 'worlds');
mkdirSync(OUT, { recursive: true });

const hour = Number(String(process.argv[2] ?? 16.8).replace('_', '.'));
const style = process.argv[3] ?? 'painterly';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.stack || e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });
await page.waitForTimeout(1200);

const worlds = await page.evaluate(() => window.__engine.listWorlds());
process.stdout.write(`worlds: ${worlds.map((w) => w.id).join(', ')}\n`);

for (const w of worlds) {
  await page.evaluate(({ id, s, h }) => {
    window.__engine.setStyle(s);
    window.__engine.setSimulatedHour(h);
    window.__engine.setSimulatedWeather('clear');
    window.__engine.setWorld(id);
  }, { id: w.id, s: style, h: hour });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: join(OUT, `${w.id}-${style}.jpg`), type: 'jpeg', quality: 80 });
  process.stdout.write(`  ${w.id} -> ${w.biome}\n`);
}

process.stdout.write(errors.length ? `errors: ${errors.join('; ')}\n` : 'no render errors\n');
await browser.close();
