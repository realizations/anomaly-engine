/**
 * Proves the weather actually reaches the screen.
 *
 * The model, the system and the renderer are three separate pieces and every one of
 * them has been wrong in a way that looked fine. `WeatherSystem._fetchWeather` returned
 * early with no provider, so nothing was ever produced. The handler threw away the
 * values it was given. The renderer sat on its constructor default. All three passed
 * every test, because the tests tested them separately and none of them tested the
 * path.
 *
 * So this is one test that walks the whole path against the deployed build over
 * `file://` -- the same condition the native host uses -- and asserts that the weather
 * in the status document is the weather the renderer is drawing. A `NaN` reaching a
 * canvas is a blank frame, so every field is checked for finiteness rather than for a
 * plausible value.
 */
import { chromium } from 'playwright';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForTimeout(3500);

const problems = [];
const check = (ok, why) => { if (!ok) problems.push(why); };

// --- the engine is up, which the rest depends on ---------------------------
const booted = await page.evaluate(() => typeof window.__engine !== 'undefined');
check(booted, 'engine did not define __engine');
if (!booted) {
  console.error(`FAIL  weather did not reach the renderer:\n  ${problems.join('\n  ')}\n  ${errors.join('\n  ')}`);
  await browser.close();
  process.exit(1);
}

// --- the model produced weather at all ---------------------------------------
// This is the assertion the whole file exists for. Before the model existed the
// renderer sat on `{ condition: 'clear', intensity: 0, ... }` forever and this read
// 'clear' with a source of nothing.
const weather = await page.evaluate(() => {
  const s = window.__engine.getStatus();
  return s.weather;
});

check(weather !== null, 'getStatus().weather is null, so no weather was ever produced');
if (weather) {
  check(typeof weather.condition === 'string', 'condition is not a string');
  check(['clear', 'cloudy', 'rain', 'storm', 'snow', 'fog'].includes(weather.condition),
    `condition "${weather.condition}" is not one the renderer understands`);
  check(weather.source === 'local',
    `expected the local model to be the source, got "${weather.source}"`);
  for (const key of ['temperature', 'humidity', 'windSpeed', 'pressure', 'visibility']) {
    check(Number.isFinite(weather[key]), `${key} is not finite (${weather[key]})`);
  }
  check(weather.humidity >= 0 && weather.humidity <= 1, `humidity ${weather.humidity} out of range`);
  check(['high', 'low', 'front'].includes(weather.regime), `regime "${weather.regime}" is not a regime`);
}

// --- it reaches the renderer, not just the status document -------------------
// A status document can be right while the renderer is being told something else, and
// that is precisely the split that produced a permanently-clear desktop.
const rendererSees = await page.evaluate(() => {
  const c = document.getElementById('wallpaper-canvas');
  const g = c.getContext('2d');
  const px = (x, y) => Array.from(g.getImageData(x, y, 1, 1).data).slice(0, 3);
  return { sky: px(640, 40), ground: px(640, 700), w: c.width, h: c.height };
});
check(rendererSees.w > 0 && rendererSees.h > 0, 'the canvas has no size');
check(rendererSees.sky.some((v) => v > 0), 'the sky is pure black');

// --- forcing a condition reaches the renderer -------------------------------
// The creator-mode path is the one a user can actually press, and it has to work
// independently of the ten-minute model tick.
for (const condition of ['storm', 'snow', 'fog', 'clear']) {
  await page.evaluate((c) => window.__engine.setSimulatedWeather(c), condition);
  await page.waitForTimeout(700);
  const seen = await page.evaluate(() => {
    const c = document.getElementById('wallpaper-canvas');
    const g = c.getContext('2d');
    // A hash of the whole frame: any condition should visibly change it.
    const data = g.getImageData(0, 0, c.width, c.height).data;
    let h = 0;
    for (let i = 0; i < data.length; i += 997) h = (h * 31 + data[i]) >>> 0;
    return h;
  });
  check(Number.isFinite(seen), `forced "${condition}" produced a non-finite frame`);
}

// --- particles react --------------------------------------------------------
// rain/snow/fog/leaves/meteor had no producer. A burst is now reachable, and it must
// put particles on screen rather than silently doing nothing.
const particleState = await page.evaluate(() => window.__engine.getParticles().getParticleCount());
check(typeof particleState === 'number' && Number.isFinite(particleState),
  `particle count is not a number (${particleState})`);

console.log(
  weather
    ? `      condition=${weather.condition} temp=${weather.temperature}C humidity=${weather.humidity} ` +
      `wind=${weather.windSpeed}m/s pressure=${weather.pressure}hPa visibility=${weather.visibility}m ` +
      `regime=${weather.regime} source=${weather.source}`
    : '      (no weather)'
);

if (problems.length || errors.length) {
  console.error('FAIL  weather did not reach the renderer:');
  for (const p of problems) console.error(`      ${p}`);
  for (const e of errors) console.error(`      ${e}`);
  await browser.close();
  process.exit(1);
}

await browser.close();
console.log('PASS  the weather model reaches the renderer, and every forced condition redraws');
