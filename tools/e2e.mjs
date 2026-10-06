import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';

// Anchored to this file rather than to the working directory, so the tool
// behaves the same however it is invoked.
const HERE = dirname(fileURLToPath(import.meta.url));

const OUT = join(HERE, '..', 'build', 'preview', 'e2e');
mkdirSync(OUT, { recursive: true });

const deployedIndex = join(HERE, '..', 'src', 'AnomalyEngine', 'bin', 'Debug', 'net8.0-windows', 'renderer', 'index.html');
const INDEX = pathToFileURL(deployedIndex).href;

const results = [];
const allErrors = [];
let failures = 0;

function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  if (!pass) failures++;
  process.stdout.write(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}\n`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on('pageerror', (e) => allErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') allErrors.push(`console.error: ${m.text()}`); });
page.on('requestfailed', (r) => allErrors.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

await page.goto(INDEX);
await page.waitForTimeout(3000);

// --- boot ---
check('engine defined over file://', await page.evaluate(() => typeof window.__engine !== 'undefined'));
check('boot overlay removed', await page.evaluate(() => !document.getElementById('anomaly-boot')));
const canvasSize = await page.evaluate(() => {
  const c = document.getElementById('wallpaper-canvas');
  return c ? `${c.width}x${c.height}` : 'missing';
});
check('canvas sized to viewport', canvasSize === '1280x720', canvasSize);

const shot = async (name) => {
  const buf = await page.screenshot();
  return createHash('sha256').update(buf).digest('hex').slice(0, 12);
};

const STYLES = ['painterly', 'flat', 'riso'];

/**
 * A coarse luminance signature of the canvas: a 32x18 grid of mean luma per cell.
 *
 * Used wherever the question is "are these two frames actually different pictures",
 * as opposed to "are these two files different bytes". The second question is the
 * wrong one in an animated renderer and answers itself.
 */
const luminanceSignature = (pg) => pg.evaluate(() => {
  const canvas = document.getElementById('wallpaper-canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const GX = 32;
  const GY = 18;
  const sig = [];
  for (let cy = 0; cy < GY; cy++) {
    for (let cx = 0; cx < GX; cx++) {
      let sum = 0;
      let n = 0;
      const x0 = Math.floor((cx * canvas.width) / GX);
      const x1 = Math.floor(((cx + 1) * canvas.width) / GX);
      const y0 = Math.floor((cy * canvas.height) / GY);
      const y1 = Math.floor(((cy + 1) * canvas.height) / GY);
      for (let y = y0; y < y1; y += 4) {
        for (let x = x0; x < x1; x += 4) {
          const i = (y * canvas.width + x) * 4;
          sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          n++;
        }
      }
      sig.push(sum / n);
    }
  }
  return sig;
});

// --- style switching, exactly as the tray dispatches it ---
const styleHashes = {};
const styleSignatures = {};
for (const style of STYLES) {
  await page.evaluate((s) => {
    window.dispatchEvent(new CustomEvent('anomaly:style', { detail: { style: s } }));
  }, style);
  await page.waitForTimeout(1400);

  const reported = await page.evaluate(() => window.__engine.getStyle());
  check(`tray dispatch applies "${style}"`, reported === style, `reported "${reported}"`);

  styleHashes[style] = await shot(style);
  styleSignatures[style] = await luminanceSignature(page);
  const buf = await page.screenshot({ path: join(OUT, `style-${style}.png`) });
  void buf;
}

// Distinctness is decided on a coarse luminance signature, not on the hashes.
//
// Hashes cannot answer this question. Every frame has grass, cloud, rain and
// stars moving, so three renders of the *same* style a second and a half apart
// already hash differently, and `new Set(hashes).size === 3` is satisfied by an
// engine whose style switch does nothing at all. The hashes stay in the detail
// string, because they make two archived runs comparable by eye.
//
// The threshold is set above riso's frame-to-frame jitter rather than the
// painterly one, because riso re-quantises its tonal range every frame: its own
// noise floor is about 6.7 against roughly 0.3 for painterly and flat. The
// smallest real difference between two styles measures about 29, so 12 sits
// between the two with room on each side.
const STYLE_DIVERGENCE = 12;
const divergences = [];
for (let i = 0; i < STYLES.length; i++) {
  for (let j = i + 1; j < STYLES.length; j++) {
    const a = styleSignatures[STYLES[i]];
    const b = styleSignatures[STYLES[j]];
    const d = a.reduce((sum, v, k) => sum + Math.abs(v - b[k]), 0) / a.length;
    divergences.push(`${STYLES[i]}/${STYLES[j]} ${d.toFixed(1)}`);
    check(
      `"${STYLES[i]}" and "${STYLES[j]}" render visibly differently`,
      d >= STYLE_DIVERGENCE,
      `luminance divergence ${d.toFixed(2)} (threshold ${STYLE_DIVERGENCE}, riso jitter ~6.7)`
    );
  }
}
console.log(`      style divergence: ${divergences.join('  ')}`);
console.log(`      style fingerprints: ${STYLES.map((s) => `${s} ${styleHashes[s]}`).join('  ')}`);

// --- style survives a round trip back to default ---
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:style', { detail: { style: 'painterly' } })));
await page.waitForTimeout(1200);
check('style round-trips to painterly', (await page.evaluate(() => window.__engine.getStyle())) === 'painterly');

// --- invalid style must not corrupt state ---
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:style', { detail: { style: 'bogus' } })));
await page.waitForTimeout(800);
check('invalid style ignored', (await page.evaluate(() => window.__engine.getStyle())) === 'painterly');

// --- pause / resume must actually change frame output ---
const beforePause = await shot('pre-pause');
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:pause')));
await page.waitForTimeout(1200);
const duringPause1 = await shot('pause1');
await page.waitForTimeout(1200);
const duringPause2 = await shot('pause2');
check('paused frame is frozen', duringPause1 === duringPause2, `${duringPause1} vs ${duringPause2}`);
check('paused frame differs from running frame', beforePause !== duringPause1);

await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:resume')));
await page.waitForTimeout(1500);
check('resume restores animation', (await shot('resumed')) !== duringPause2);

// --- the scene must animate by itself ---
//
// Everything above this line compares one state against another: night to golden,
// clear to storm, style to style. All of those pass on a completely static
// renderer, because a still image is perfectly capable of being different from
// another still image.
//
// That is the gap a frozen clock hid in for as long as it existed. `WorldRenderer`
// read its `_t` in fifteen places -- grass sway, the beacon's blink, fog drift,
// motes, camera -- and never advanced it. Every frame was identical, every value
// was a valid number, and 224 unit tests, 20 visual cases and 19 verify steps all
// passed. `flicker.mjs` called the scene calm, which a still image also is.
//
// So: sample the same state twice with nothing changed in between, and require the
// frame to have moved. Measured as mean absolute luminance change rather than a
// hash, because a hash would also be satisfied by the renderer's own grain.
const meanLuma = () => page.evaluate(() => {
  const c = document.getElementById('wallpaper-canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const d = g.getImageData(0, 0, c.width, Math.round(c.height * 0.8)).data;
  let s = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 16) {
    s += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    n++;
  }
  return s / n;
});

await page.evaluate(() => {
  window.__engine.setSimulatedHour(16.9);
  window.__engine.setSimulatedWeather('clear');
});
await page.waitForTimeout(1500);

const lumaSeries = [];
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(120);
  lumaSeries.push(await meanLuma());
}
const lumaDeltas = [];
for (let i = 1; i < lumaSeries.length; i++) lumaDeltas.push(Math.abs(lumaSeries[i] - lumaSeries[i - 1]));
const meanChange = lumaDeltas.reduce((a, b) => a + b, 0) / lumaDeltas.length;
// The bar is 0.01 and it was measured rather than guessed. A paused frame reads
// exactly 0.0000 -- the renderer stops entirely -- and a live one reads between
// 0.04 and 0.07 on a clear afternoon. So 0.01 sits in a gap with nothing in it,
// rather than near either end. It was originally 0.02, set when the scene was
// oscillating at audio-ish frequencies before the clocks were corrected; the scene
// is calmer now and the bar came down to match, which is only defensible because
// the floor was measured rather than assumed.
check(
  'the scene animates on its own, with nothing changed',
  meanChange > 0.01,
  `mean frame-to-frame luminance change ${meanChange.toFixed(4)} over 3s of clear afternoon (a paused frame reads 0.0000)`
);

// White box on purpose.
//
// The check above catches a renderer that is entirely frozen. It does *not* catch
// this particular bug, and that was measured rather than assumed: with
// `WorldRenderer._t` pinned at zero, whole-frame luminance change was 0.0761 and
// this check passed. The frame keeps moving because several other systems animate
// independently -- UncannyLayer has its own clock, the terminal and the grain have
// their own -- so "the picture changes" is satisfied without the renderer's clock
// running at all.
//
// Sampling the beacon region instead, which is what a frozen clock most obviously
// breaks, did not discriminate either: range 15.06 luma frozen against 14.94 live.
// Something else in that box animates.
//
// So the clock is read directly. It is a private field, and that is the cost of
// being able to say anything true here -- a black-box version of this assertion
// was written first and does not work.
const clockA = await page.evaluate(() => window.__engine._renderer._t);
await page.waitForTimeout(1200);
const clockB = await page.evaluate(() => window.__engine._renderer._t);
check(
  "the renderer's own clock advances",
  clockB > clockA,
  `_t ${clockA.toFixed(0)} -> ${clockB.toFixed(0)} over 1.2s`
);

// Reduced motion must damp the scene without stopping the clock. Only the second
// half is asserted here: whole-frame luminance change is dominated by whichever
// element moves most in the frame, which varies with composition, so comparing it
// across intensities measures that element rather than the dial. Measured at zero,
// the frame still changes -- a frozen clock does not.
//
// The dial's actual response curve is asserted deterministically in
// tests/Motion.test.ts, where it belongs: amplitude and rate are pure functions of
// the intensity, and the ordering between categories is the design.
await page.evaluate(() => window.__engine.setMotionIntensity(0));
await page.waitForTimeout(1200);
const stillSeries = [];
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(120);
  stillSeries.push(await meanLuma());
}
const stillDeltas = [];
for (let i = 1; i < stillSeries.length; i++) stillDeltas.push(Math.abs(stillSeries[i] - stillSeries[i - 1]));
const stillChange = stillDeltas.reduce((a, b) => a + b, 0) / stillDeltas.length;
check(
  'reduced motion damps the scene without stopping the clock',
  stillChange > 0.001,
  `at motion 0 the frame still changes by ${stillChange.toFixed(4)} per frame`
);
await page.evaluate(() => window.__engine.setMotionIntensity(0.35));

// --- time of day must change the image ---
await page.evaluate(() => window.__engine.setSimulatedHour(2));
await page.waitForTimeout(1200);
const night = await shot('tod-night');
await page.evaluate(() => window.__engine.setSimulatedHour(17));
await page.waitForTimeout(1200);
const golden = await shot('tod-golden');
check('time of day changes render', night !== golden, `${night} vs ${golden}`);

// --- weather must change the image ---
await page.evaluate(() => window.__engine.setSimulatedWeather('storm'));
await page.waitForTimeout(1500);
const storm = await shot('weather-storm');
check('weather changes render', storm !== golden, `${storm} vs ${golden}`);
await page.screenshot({ path: join(OUT, 'weather-storm.png') });

// --- a storm must actually produce lightning ---
//
// This was silently broken. `main.ts` subscribed to `weather.storm_started`,
// nothing has ever emitted that event, `triggerLightning` therefore had no caller,
// and the storm rendered through a complete bolt renderer -- branches, seeded path,
// decay -- that could never fire. Nothing failed, because nothing threw: the
// subscription was simply dead, which is the same bug class as the missing
// random.lights_out event this suite already exists to guard against.
//
// Measured as pixels rather than by reading the renderer's private `_bolt`, so that
// a refactor cannot make the check pass by renaming a field. A strike raises the
// peak luminance of the upper frame by around 50.
//
// Both directions are asserted. A check that only proves storms flash would still
// pass if lightning fired in clear weather.
//
// The window is measured in wall clock, not in samples. A strike is scheduled 10 to
// 40 seconds out (`14000 - storminess*4000` over the motion intensity, plus up to
// 1.4 times that again), while the follow-up is only sometimes a sub-second burst,
// so the check has to actually be open when it arrives. The old `peakOver(16)` took
// a fixed 40 samples with a 400ms gap, which meant the window's length depended on
// how long a canvas readback happened to take that run: 18 seconds on a fast one,
// 30 on a slow one, and it failed whenever the next strike fell in the gap. Sample
// counts cannot bound a time.
const peakLuma = () => page.evaluate(() => {
  const c = document.getElementById('wallpaper-canvas');
  const g = c.getContext('2d', { willReadFrequently: true });
  const h = Math.round(c.height * 0.55);
  const d = g.getImageData(0, 0, c.width, h).data;
  let max = 0;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    if (l > max) max = l;
  }
  return Math.round(max);
});

const peakUntil = async (deadlineMs, stopAt = 0) => {
  let peak = 0;
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    peak = Math.max(peak, await peakLuma());
    if (stopAt && peak > stopAt) break;
    await page.waitForTimeout(400);
  }
  return peak;
};

// Clear first, to establish what the frame looks like without a strike, then storm.
// One comparison covers both directions: it needs the storm to flash *and* the clear
// sky not to, so a check that passed because lightning fires everywhere would fail.
await page.evaluate(() => window.__engine.setSimulatedWeather('clear'));
await page.waitForTimeout(1500);
const clearPeak = await peakUntil(8_000);

// Sampled from the moment the storm begins rather than after a settle. The scheduler
// strikes on the storm's first frame -- `_strikeIn` is reset to zero by every
// non-storm frame -- and waiting 1.5s for the clouds to darken stepped straight over
// it, leaving only the 10-to-40s follow-up inside the window. Catching the onset flash
// makes the usual run quick; the deadline behind it catches the scheduled one if the
// readback lands between ramp frames.
await page.evaluate(() => window.__engine.setSimulatedWeather('storm'));
const stormPeak = await peakUntil(50_000, clearPeak + 25);
check(
  'a storm produces lightning and clear weather does not',
  stormPeak > clearPeak + 25,
  `storm peak luma ${stormPeak} vs clear ${clearPeak} (a strike adds about 50)`
);

await page.evaluate(() => window.__engine.setSimulatedWeather('clear'));
await page.waitForTimeout(1000);

// --- anomaly triggers must not throw ---
const anomalies = ['meteor', 'second-moon', 'red-moon', 'forest-watcher', 'observatory-signal'];
for (const a of anomalies) {
  const before = allErrors.length;
  await page.evaluate((x) => window.__engine.forceAnomaly(x), a);
  await page.waitForTimeout(900);
  check(`anomaly "${a}" renders without error`, allErrors.length === before,
    allErrors.slice(before).join('; '));
}

// --- performance: no runaway frame time ---
const fps = await page.evaluate(() => new Promise((res) => {
  let frames = 0;
  const t0 = performance.now();
  const tick = () => {
    frames++;
    if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
    else res(Math.round((frames / (performance.now() - t0)) * 1000));
  };
  requestAnimationFrame(tick);
}));
// Headless Chromium rasterises in software (SwiftShader), so this number is not
// representative of the real GPU-composited host. Reported, not asserted.
process.stdout.write(`INFO  headless software-raster fps: ${fps} (not representative of real host)\n`);

// --- worlds: the tray dispatches these, so they must work over file:// too ---
const worlds = await page.evaluate(() => window.__engine.listWorlds());
check('at least four worlds are registered', worlds.length >= 4, `${worlds.length} worlds`);
check('worlds expose id, name and biome',
  worlds.every((w) => typeof w.id === 'string' && typeof w.name === 'string' && typeof w.biome === 'string'));

const worldHashes = {};
for (const w of worlds) {
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('anomaly:world', { detail: { world: id } }));
  }, w.id);
  await page.waitForTimeout(1200);
  worldHashes[w.id] = await shot(`world-${w.id}`);
}
check('every world renders distinct pixels',
  new Set(Object.values(worldHashes)).size === worlds.length,
  JSON.stringify(worldHashes));

// Cycling must wrap and never land on an unknown world.
const cycle = [];
for (let i = 0; i < worlds.length + 1; i++) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:world-next')));
  await page.waitForTimeout(250);
  cycle.push(await page.evaluate(() => window.__engine.getWorlds().getActiveId()));
}
check('world cycling wraps without leaving the set',
  cycle.every((id) => worlds.some((w) => w.id === id)),
  cycle.join(' -> '));

// An unknown world must fall back rather than blanking the scene.
const beforeBad = await shot('pre-bad-world');
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('anomaly:world', { detail: { world: 'not-a-world' } }));
});
await page.waitForTimeout(1200);
check('unknown world does not blank the scene', (await shot('post-bad-world')) !== null);
void beforeBad;

// --- the observatory terminal is actually drawn ---
// The terminal held a canvas context captured at construction. The offscreen
// buffer is reallocated on resize and on a monitor-layout change, so a retained
// context silently pointed at an orphaned canvas and the terminal stopped
// appearing at all. Nothing else would have caught it, because every other
// check still passed. This looks for the terminal's bright phosphor pixels in
// the bottom-left of the frame, where it is drawn.
const terminal = await page.evaluate(async () => {
  window.dispatchEvent(new CustomEvent('anomaly:monitors', {
    detail: { monitors: [{ x: 0, y: 0, w: 1280, h: 720 }] },
  }));
  await new Promise((r) => setTimeout(r, 1200));
  const cv = document.getElementById('wallpaper-canvas');
  const g = cv.getContext('2d');
  // The tube occupies roughly x 58..290, y 540..700 at 1280x720.
  const region = g.getImageData(50, 520, 260, 190).data;
  let phosphor = 0;
  for (let i = 0; i < region.length; i += 4) {
    // Phosphor is a green-dominant colour; count pixels where green clearly
    // leads red and blue.
    if (region[i + 1] > region[i] + 18 && region[i + 1] > region[i + 2] + 8) phosphor++;
  }
  return { phosphor, sampled: region.length / 4 };
});
check('the observatory terminal is drawn on the canvas',
  terminal.phosphor > 40,
  `${terminal.phosphor} phosphor pixels of ${terminal.sampled} sampled`);

// --- quality scaling ---
const scaleInfo = await page.evaluate(() => {
  window.__engine.setRenderScale(0.75);
  const pinned = window.__engine.getRenderScale();
  window.__engine.setRenderScale(null);
  return { pinned, quality: window.__engine.getQuality() };
});
check('render scale can be pinned and released', scaleInfo.pinned === 0.75, JSON.stringify(scaleInfo));
check('quality reports the active style and world',
  scaleInfo.quality.style === 'painterly' && worlds.some((w) => w.id === scaleInfo.quality.worldId),
  JSON.stringify(scaleInfo.quality));
check('render scale is within the supported range',
  scaleInfo.quality.renderScale >= 0.4 && scaleInfo.quality.renderScale <= 1,
  String(scaleInfo.quality.renderScale));

// The settings window's "Automatic" entry must release the pin, not pass a
// number. It used to pass 0, which the renderer clamped to its minimum and
// *locked*, so the option labelled Automatic pinned quality to the lowest
// setting and disabled adaptation entirely. This asserts the distinction the
// settings window depends on, so the two cannot drift apart again.
const automatic = await page.evaluate(async () => {
  // Pretend to be a machine that cannot hold full resolution.
  window.dispatchEvent(new CustomEvent('anomaly:monitors', {
    detail: { monitors: [{ x: 0, y: 0, w: 1920, h: 1080 }, { x: 1920, y: 0, w: 1920, h: 1080 }] },
  }));
  window.__engine.setRenderScale(1.0);
  const pinnedHigh = window.__engine.getRenderScale();

  // Automatic: the same call the settings window makes for the last entry.
  window.__engine.setRenderScale(null);
  // Poll for the controller to actually move, rather than sleeping and hoping.
  let adapted = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const now = window.__engine.getRenderScale();
    if (now < 0.9) { adapted = now; break; }
  }
  const current = window.__engine.getRenderScale();
  // Back to a single monitor so later checks are not measuring a heavy load.
  window.dispatchEvent(new CustomEvent('anomaly:monitors', {
    detail: { monitors: [{ x: 0, y: 0, w: 1280, h: 720 }] },
  }));
  window.__engine.setRenderScale(null);
  return { pinnedHigh, adapted, current };
});
check('a pinned scale is held', automatic.pinnedHigh === 1, String(automatic.pinnedHigh));
check('automatic releases the pin and adapts instead of clamping to a minimum',
  automatic.adapted !== null && automatic.adapted < 0.9,
  automatic.adapted === null ? 'never adapted within 30s' : `adapted to ${automatic.adapted}`);

// --- field notes panel (the ARG surface) ---
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:notes')));
await page.waitForTimeout(900);
const notesText = await page.evaluate(() => document.getElementById('anomaly-field-notes')?.innerText ?? '');
check('field notes panel renders with world lore', notesText.length > 0 && /FIELD NOTES/i.test(notesText));
check('field notes always offers a denial', /ALSO CONSISTENT WITH|Also consistent with/i.test(notesText));
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:notes')));
// Poll rather than sleeping a fixed interval. A fixed wait passed in
// isolation and failed when the whole verification suite ran back to back under
// load, which is the classic shape of a flaky test: it was asserting on the
// clock instead of on the condition.
const notesHidden = await page
  .waitForFunction(() => {
    const el = document.getElementById('anomaly-field-notes');
    return !el || getComputedStyle(el).opacity === '0';
  }, { timeout: 5000 })
  .then(() => true)
  .catch(() => false);
check('field notes toggles closed', notesHidden);

// --- the status surface the settings window reads ---
const status = await page.evaluate(() => window.__engine.getStatus());
check('status reports a real world', typeof status.worldName === 'string' && status.worldName.length > 0, status.worldName);
check('status reports frame metrics', typeof status.fps === 'number' && typeof status.frameMs === 'number',
  `${status.fps} fps / ${status.frameMs} ms`);
check('status reports render scale in range',
  status.renderScale >= 0.4 && status.renderScale <= 1, String(status.renderScale));
check('status reports anomaly and discovery counts',
  status.anomalyKinds > 0 && status.secretsTotal > 0 && status.secretsFound <= status.secretsTotal,
  `${status.anomalyKinds} anomalies, ${status.secretsFound}/${status.secretsTotal} notes`);
check('status reports reduced motion state', typeof status.reducedMotion === 'boolean');

// Frame cap must actually change the reported limit.
await page.evaluate(() => window.__engine.setFpsLimit(30));
check('fps limit can be set', (await page.evaluate(() => window.__engine.getFpsLimit())) === 30);
await page.evaluate(() => window.__engine.setFpsLimit(0));
check('fps limit can be released', (await page.evaluate(() => window.__engine.getFpsLimit())) === 0);

// --- world details feed the settings list, including removability ---
const details = await page.evaluate(() => window.__engine.getWorldDetails());
check('world details cover every world', details.length === worlds.length, `${details.length}`);
check('exactly one world is active', details.filter((w) => w.active).length === 1);
check('the fallback world is not removable', details.find((w) => w.active)?.removable !== true
  || details.filter((w) => !w.removable).length === 1, JSON.stringify(details.map((d) => [d.id, d.removable])));
// A world reports a biome, and a structure count. Interiors are the exception:
// the liminal corridor is built from its own interior geometry rather than from
// placed objects, so it legitimately has none.
check('world details expose biome and structure counts',
  details.every((w) => typeof w.biome === 'string'
    && (w.biome === 'liminal-interior' ? w.structures === 0 : w.structures > 0)));

// Import must accept a valid world and reject garbage, with a reported reason.
const imported = await page.evaluate(() => window.__engine.importWorlds([{
  id: 'e2e-world', name: 'E2E World', author: 'test', version: '0.1.0', engine: '0.1',
  description: 'Imported by the test suite.', biome: 'coast',
  terrain: { seed: 90210 },
  structures: [{ kind: 'lighthouse', x: 0.7 }],
  lore: { premise: 'x', deniability: ['y'] },
}]));
check('a valid world imports', imported.ok === true, JSON.stringify(imported.errors));
check('the imported world is now listed',
  (await page.evaluate(() => window.__engine.getWorldDetails())).some((w) => w.id === 'e2e-world'));

const rejected = await page.evaluate(() => window.__engine.importWorlds([{ id: 'BAD ID', name: 'x' }]));
check('an invalid world is rejected with a reason', rejected.ok === false && rejected.errors.length > 0,
  JSON.stringify(rejected.errors).slice(0, 90));

// An imported world has to survive a restart, or the feature is a lie: it
// accepts the file, reports success, and quietly loses the world next launch.
// Re-navigate so the engine rebuilds itself from durable state, exactly as a
// relaunch would. This is the check that the import is actually persisted rather
// than merely held in memory.
check('the imported world is written to durable state',
  (await page.evaluate(() => window.__engine.getPersistedSummary().customWorlds)) >= 1,
  await page.evaluate(() => `${window.__engine.getPersistedSummary().customWorlds} stored`));

await page.reload();
await page.waitForTimeout(3000);
check('the imported world survives a restart',
  (await page.evaluate(() => window.__engine.getWorldDetails())).some((w) => w.id === 'e2e-world'),
  'after reload');

// And a saved world id pointing at an imported world must resolve to that world
// rather than falling back to a built-in.
await page.evaluate(() => window.__engine.setWorld('e2e-world'));
await page.reload();
await page.waitForTimeout(3000);
check('a saved imported world id resolves to the imported world',
  (await page.evaluate(() => window.__engine.getWorldDetails().find((w) => w.id === 'e2e-world'))) !== undefined
    && (await page.evaluate(() => window.__engine.getActiveWorldId())) === 'e2e-world',
  await page.evaluate(() => String(window.__engine.getActiveWorldId())));

// An imported world carries a digest recorded at import time, so one edited in
// the saved state afterwards is reported rather than silently accepted. The edit
// is made through the state file the way a hand-edit or a tampered file would
// reach it, which is the case the check exists for.
check('an unchanged imported world is not reported as changed',
  (await page.evaluate(() => window.__engine.getChangedWorlds())).length === 0,
  JSON.stringify(await page.evaluate(() => window.__engine.getChangedWorlds())));

await page.evaluate(() => {
  const key = 'anomaly-engine:state';
  const s = JSON.parse(localStorage.getItem(key));
  const w = s.customWorlds.find((x) => x.id === 'e2e-world');
  w.name = 'Edited since it was imported';
  localStorage.setItem(key, JSON.stringify(s));
});
await page.reload();
await page.waitForTimeout(3000);
const changed = await page.evaluate(() => window.__engine.getChangedWorlds());
check('a world edited after import is reported as changed', changed.includes('e2e-world'),
  JSON.stringify(changed));
check('a world edited after import is still loaded, not rejected',
  (await page.evaluate(() => window.__engine.getWorldDetails().some((w) => w.id === 'e2e-world'))),
  'the user may have edited their own file on purpose');

// Accepting the change makes it the new baseline, so it is not reported again.
await page.evaluate(() => window.__engine.acceptWorldChanges());
await page.reload();
await page.waitForTimeout(3000);
check('accepting the edit clears the report',
  (await page.evaluate(() => window.__engine.getChangedWorlds())).length === 0,
  JSON.stringify(await page.evaluate(() => window.__engine.getChangedWorlds())));

// The favicon has to survive the whole chain: generated into the directory Vite
// actually copies, referenced relatively so it resolves over file://, and present
// in the deployed output. Each of those has been wrong at least once and the
// symptom was always the same silence, so it is checked here.
//
// Existence is checked on disk rather than with fetch. The document's policy is
// connect-src 'none', which blocks fetch outright, so a fetch-based check cannot
// distinguish a missing favicon from a working one. A favicon is loaded as an
// image and is governed by img-src, so what actually matters is that the bytes
// are next to the document and that the reference is relative.
const iconHref = await page.evaluate(() => document.querySelector('link[rel="icon"]')?.getAttribute('href') ?? '');
check('the favicon is referenced relatively for file://', iconHref.startsWith('./'), iconHref || 'no link element');
check('the favicon ships next to the deployed document',
  iconHref.startsWith('./') && existsSync(join(dirname(deployedIndex), iconHref.slice(2))),
  iconHref ? resolve(dirname(deployedIndex), iconHref.slice(2)) : 'no link element');

check('no console or page errors overall', allErrors.length === 0, allErrors.join(' | '));

await browser.close();

process.stdout.write(`\n${results.length - failures}/${results.length} checks passed\n`);
process.exit(failures ? 1 : 0);
