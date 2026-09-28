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
  const rel = (req.url ?? '/').split('?')[0];
  const file = join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end('nf');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(4321, r));

const browser = await chromium.launch();

const shots = [
  { name: '01-night', hour: 1.5, weather: 'clear' },
  { name: '02-dawn', hour: 6.2, weather: 'clear' },
  { name: '03-sunrise', hour: 6.9, weather: 'cloudy' },
  { name: '04-morning', hour: 9.5, weather: 'clear' },
  { name: '05-midday', hour: 13, weather: 'clear' },
  { name: '06-golden', hour: 16.8, weather: 'clear' },
  { name: '07-sunset', hour: 18.7, weather: 'cloudy' },
  { name: '08-dusk', hour: 20.2, weather: 'clear' },
  { name: '09-rain', hour: 14, weather: 'rain' },
  { name: '10-storm', hour: 15, weather: 'storm' },
  { name: '11-snow', hour: 8, weather: 'snow' },
  { name: '12-fog', hour: 7, weather: 'fog' },
];

for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://localhost:4321/');
  await page.waitForFunction(() => window.__engine !== undefined, { timeout: 15000 });
  await page.evaluate(
    ({ hour, weather }) => {
      const e = window.__engine;
      e.setSimulatedHour(hour);
      e.setSimulatedWeather(weather);
    },
    { hour: s.hour, weather: s.weather }
  );
  await page.waitForTimeout(1400);
  await page.screenshot({ path: join(OUT, `${s.name}.png`) });
  await page.close();
  process.stdout.write(`${s.name}\n`);
}

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto('http://localhost:4321/');
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 15000 });
await page.evaluate(() => {
  const e = window.__engine;
  e.setSimulatedHour(22.5);
  e.setSimulatedWeather('clear');
  e.forceAnomaly('second-moon');
});
await page.waitForTimeout(1600);
await page.screenshot({ path: join(OUT, '13-anomaly-second-moon.png') });
process.stdout.write('13-anomaly-second-moon\n');

await page.evaluate(() => {
  const e = window.__engine;
  e.setSimulatedHour(23);
  e.forceAnomaly('forest-watcher');
});
await page.waitForTimeout(1600);
await page.screenshot({ path: join(OUT, '14-anomaly-watcher.png') });
process.stdout.write('14-anomaly-watcher\n');

await page.evaluate(() => {
  const e = window.__engine;
  e.setSimulatedHour(1);
  e.forceAnomaly('observatory-signal');
});
await page.waitForTimeout(1600);
await page.screenshot({ path: join(OUT, '15-anomaly-signal.png') });
process.stdout.write('15-anomaly-signal\n');

await page.close();
await browser.close();
server.close();
process.stdout.write('done\n');
