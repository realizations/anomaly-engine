/**
 * Deterministic frame snapshots, for proving a refactor changed no pixels.
 *
 *   node tools/visual-snapshot.mjs --out build/snapshots/before
 *   node tools/visual-snapshot.mjs --out build/snapshots/after
 *   node tools/visual-snapshot.mjs --compare build/snapshots/before build/snapshots/after
 *
 * ## Why this exists
 *
 * `visual-cases` compares mean luminance and value spread against a recorded
 * baseline with a tolerance, which is the right check for "did the art direction
 * drift". It cannot answer "did this refactor change a single pixel", because a
 * 12% tolerance is much wider than most refactor bugs and much narrower than a
 * legitimate art change.
 *
 * The obvious alternative -- run the capture twice and diff the PNGs -- does not
 * work either, and it is worth being explicit about why, because it looks like it
 * should. Measured on this repository with no code change at all:
 *
 *     identical: 0   differing: 20   of 20
 *
 * Every case differs every run. The renderer animates against a real clock:
 * `WorldRenderer.render` derives `dt` from `performance.now()` deltas and
 * accumulates it into `_t`, which is what every oscillator reads through `_sec`.
 * Grass sway, chimney smoke, tower blink, star twinkle and the cloud deck are all
 * functions of that, so two captures milliseconds apart are two different frames.
 * That is correct behaviour for a wallpaper and fatal for byte comparison.
 *
 * ## What makes it deterministic
 *
 * `performance.now()` is replaced before any page script runs, with a counter that
 * advances by exactly one frame per call. Every `dt` the renderer computes is then
 * identical, so after a fixed number of frames the scene is in an exactly
 * reproducible state. Nothing in the renderer changes; only the clock the page
 * believes in.
 *
 * Frames are counted, not slept on. The page is told to run exactly N renders,
 * which removes the remaining source of variance: how many frames happened to elapse
 * during a `waitForTimeout`.
 *
 * ## What it is not
 *
 * This proves a refactor is inert. It does not prove the art is good, it does not
 * cover multi-display layouts, and it deliberately does not exercise the adaptive
 * quality controller, which keys off wall-clock frame cost and would reintroduce
 * nondeterminism by design. Those are `visual-cases` and `perf-gpu` jobs.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const W = Number(arg('w', 1280));
const H = Number(arg('h', 720));
const FRAMES = Number(arg('frames', 24));
const OUT = resolve(HERE, '..', arg('out', 'build/snapshots/current'));
const COMPARE_A = arg('compare-a', null);
const COMPARE_B = arg('compare-b', null);

/**
 * The set is deliberately small and chosen to cover every code path the asset
 * registry touches, plus the landmark methods that draw at hardcoded positions
 * rather than from the anchor table.
 */
const SHOTS = [
  { id: 'town-afternoon', dir: 'depth', hour: 16.9, weather: 'clear', world: 'the-town-that-wasnt-there' },
  { id: 'town-dusk', dir: 'atmospheric', hour: 20.4, weather: 'fog', world: 'the-town-that-wasnt-there' },
  { id: 'town-storm', dir: 'darker', hour: 3.2, weather: 'storm', world: 'the-town-that-wasnt-there' },
  // Saltwick: lighthouse, reed banks, well, fence line.
  { id: 'saltwick-day', dir: 'depth', hour: 11.5, weather: 'clear', world: 'saltwick' },
  { id: 'saltwick-night', dir: 'darker', hour: 1.1, weather: 'clear', world: 'saltwick' },
  // The Long Fell: dishes, cairns, rock field, snowbank, observatory.
  { id: 'fell-alpine', dir: 'depth', hour: 13.0, weather: 'snow', world: 'the-long-fell' },
  { id: 'fell-flat', dir: 'depth', hour: 13.0, weather: 'snow', world: 'the-long-fell', style: 'flat' },
  // The Dry Mere: buttes, ruin, dishes, rock field.
  { id: 'mere-desert', dir: 'atmospheric', hour: 17.2, weather: 'clear', world: 'the-dry-mere' },
  // The Long Head: lighthouse, ruin, well, rock field, fence line.
  { id: 'head-coast', dir: 'depth', hour: 6.8, weather: 'rain', world: 'the-long-head' },
  // The Long Corridor: the one world with no landscape and no structures at all.
  { id: 'corridor', dir: 'depth', hour: 12.0, weather: 'clear', world: 'the-long-corridor' },
  // Riso takes a different post path entirely, so it gets its own shot.
  { id: 'town-riso', dir: 'depth', hour: 16.9, weather: 'clear', world: 'the-town-that-wasnt-there', style: 'riso' },
];

if (COMPARE_A && COMPARE_B) {
  const a = resolve(HERE, '..', COMPARE_A);
  const b = resolve(HERE, '..', COMPARE_B);
  const files = readdirSync(a).filter((f) => f.endsWith('.png'));
  let same = 0;
  const rows = [];
  for (const f of files) {
    const ha = createHash('sha256').update(readFileSync(join(a, f))).digest('hex');
    const hb = createHash('sha256').update(readFileSync(join(b, f))).digest('hex');
    if (ha === hb) same++;
    else rows.push(`  ${f}  ${ha.slice(0, 12)} != ${hb.slice(0, 12)}`);
  }
  console.log(rows.length ? rows.join('\n') : '  every frame byte-identical');
  console.log(`\nbyte-identical ${same} of ${files.length} frames`);
  process.exit(rows.length === 0 ? 0 : 1);
}

if (!existsSync(DEPLOYED)) {
  console.error('Deployed renderer not found. Build first:  dotnet build src\\AnomalyEngine');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });

// Before any page script runs. A single advancing counter means every call site
// sees a consistent, monotonically increasing clock, which is all the renderer
// needs -- it only ever differences two successive reads.
await page.addInitScript((frameMs) => {
  let t = 1000;
  Object.defineProperty(performance, 'now', {
    configurable: true,
    writable: true,
    value: () => {
      t += frameMs;
      return t;
    },
  });

  // A seeded PRNG, re-seedable from the test. The seeded draw paths in the renderer
  // (`mulberry32`) were always reproducible, but precipitation recycling and lightning
  // scheduling call bare `Math.random()`, so those four frames differed on every run
  // for the same reason the others did: unseeded entropy inside a timed animation.
  //
  // This is a harness stub, not a renderer change. The renderer still uses
  // `Math.random()`; the page simply believes it is a different, repeatable one.
  let state = 0x9e3779b9;
  Math.random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t2 = Math.imul(state ^ (state >>> 15), 1 | state);
    t2 = (t2 + Math.imul(t2 ^ (t2 >>> 7), 61 | t2)) ^ t2;
    return ((t2 ^ (t2 >>> 14)) >>> 0) / 4294967296;
  };
  window.__seedRandom = (seed) => {
    state = seed | 0;
  };
}, 1000 / 60);

await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 30000 });

const results = [];
for (const shot of SHOTS) {
  await page.evaluate((s) => {
    window.__engine.setWorld(s.world);
    window.__engine.setStyle(s.style ?? 'painterly');
    window.__engine.setDirection(s.dir);
    window.__engine.setSimulatedHour(s.hour);
    window.__engine.setSimulatedWeather(s.weather);
    window.__engine.setMotionIntensity(0.35);
    if (s.anomaly) window.__engine.forceAnomaly(s.anomaly);
    else window.__engine.clearAnomalies();
  }, shot);

  // Pause first, then drive renders by hand.
  //
  // The engine runs its own requestAnimationFrame loop. Leaving it running meant
  // two things were racing: the number of renders that happened to elapse during the
  // settle wait, and therefore how many values the shared `Math.random` stream had
  // been consumed for.
  //
  // Pausing alone is not enough, and this is the subtle part. `_t` has been
  // accumulating from `performance.now()` deltas since the first frame after page
  // load, and how many frames the engine's loop got through before `pause()` landed
  // depends on real wall-clock timing. So the scene started each run at a different
  // point in its animation no matter how carefully the forced frames were counted --
  // which is exactly what the first attempt showed: pausing took the run from seven
  // identical frames to none. The clock has to be reset, not merely stopped.
  await page.evaluate(async ({ frames, hour }) => {
    const engine = window.__engine;
    const renderer = engine._renderer;
    engine.pause();

    const hh = Math.floor(hour);
    const mm = Math.round((hour - hh) * 60);
    const date = new Date(2024, 0, 1, hh, mm, 0, 0);

    window.__seedRandom(0x5eed1234);
    // Zero the animation clock and the frame it is differenced against. `_last = 0`
    // makes the next render take the first-frame branch (dt = 16.7) rather than
    // differencing against a stale real timestamp.
    renderer._t = 0;
    renderer._last = 0;
    // Discharge any bolt left over from a previous shot, or the storm case inherits
    // another shot's lightning state.
    renderer._bolt = 0;
    void frames;

    for (let i = 0; i < frames; i++) {
      renderer.render(date);
      await new Promise((r) => requestAnimationFrame(r));
    }
  }, { frames: FRAMES, hour: shot.hour });

  const url = await page.evaluate(() => {
    const src = document.getElementById('wallpaper-canvas');
    return src.toDataURL('image/png');
  });
  const buf = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(resolve(OUT, `${shot.id}.png`), buf);
  results.push(`${shot.id}  ${createHash('sha256').update(buf).digest('hex').slice(0, 16)}`);
}

await browser.close();
console.log(results.join('\n'));
console.log(`\n${results.length} deterministic frames -> ${OUT}`);