import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(process.cwd(), '..', 'src', 'Engine', 'renderer');
const OUT = join(process.cwd(), '..', 'build', 'preview');
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json',
  '.png': 'image/png',
};

const server = createServer((req, res) => {
  const rel = (req.url || '/').split('?')[0];
  const file = join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end('nf');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(4321, r));

const browser = await chromium.launch();

const STYLES = [
  { id: 'a-riso', style: 'riso', label: 'A: flat + riso print' },
  { id: 'b-flat', style: 'flat', label: 'B: flat, clean' },
  { id: 'c-painterly', style: 'painterly', label: 'C: painterly (current)' },
];

const TIMES = [
  { name: 'night', hour: 1.5, weather: 'clear' },
  { name: 'golden', hour: 16.8, weather: 'clear' },
  { name: 'storm', hour: 15, weather: 'storm' },
];

for (const s of STYLES) {
  for (const t of TIMES) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.goto('http://localhost:4321/');
    await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });
    await page.evaluate(
      ({ hour, weather, style }) => {
        window.__engine.setSimulatedHour(hour);
        window.__engine.setSimulatedWeather(weather);
        window.__engine.setStyle(style);
      },
      { hour: t.hour, weather: t.weather, style: s.style }
    );
    await page.waitForTimeout(1500);
    await page.screenshot({ path: join(OUT, `style-${s.id}-${t.name}.png`) });
    await page.close();
    process.stdout.write(`${s.id} / ${t.name}\n`);
  }
}

await browser.close();
server.close();
process.stdout.write('done\n');
