import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(process.cwd(), '..', 'src', 'Engine', 'renderer');
const OUT = join(process.cwd(), '..', 'build', 'preview');
mkdirSync(OUT, { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.map': 'application/json', '.png': 'image/png' };
const server = createServer((req, res) => {
  const rel = (req.url || '/').split('?')[0];
  const file = join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4322, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:4322/');
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });

// Same script string WallpaperHost.SetStyle() hands to ExecuteScriptAsync.
for (const style of ['flat', 'riso', 'painterly']) {
  await page.evaluate((s) => {
    window.dispatchEvent(new CustomEvent('anomaly:style', { detail: { style: s } }));
  }, style);
  await page.waitForTimeout(1200);
  const applied = await page.evaluate(() => window.__engine.getStyle());
  process.stdout.write(`tray sent "${style}" -> renderer reports "${applied}" ${applied === style ? 'OK' : 'MISMATCH'}\n`);
}

await browser.close();
server.close();
