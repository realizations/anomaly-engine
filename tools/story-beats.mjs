/**
 * Drives story beats against the real renderer and measures the pixels they change.
 *
 *   node tools/story-beats.mjs --out build/beats
 *
 * `visual-cases` and `look` cover the ambient scene. This covers the parts of the
 * renderer that exist for a few seconds at a time, which is exactly the part that never
 * gets reviewed: a beat that never renders is indistinguishable from a beat that renders
 * wrongly, and neither shows up in a still of an ordinary evening.
 *
 * ## Measuring the right region
 *
 * The first version compared whole-frame mean luminance and every beat "failed", with
 * deltas of +0.03 to +0.32. Three of them were working. Whole-frame mean is the wrong
 * instrument here: the observatory door is a wedge a few dozen pixels across in a
 * 1400x788 frame, and a moon pulse is a disc in the sky. Averaging a real effect over a
 * million pixels it barely touches is a measurement that cannot see the thing it is
 * measuring.
 *
 * So each shot names the region its effect lives in, and the delta is computed there.
 * The regions come from the renderer's own geometry -- `getInteractionSurfaces` -- rather
 * than from numbers written here, so a landmark that moves moves its measurement with it.
 *
 * ## Rendering the simulated hour
 *
 * The first version also called `renderer.render(new Date())` directly, which renders the
 * *real* wall-clock time and silently ignores `setSimulatedHour`. Every shot was
 * therefore a night frame regardless of the hour it claimed, including the noon
 * `lights-on` shot. The engine's own loop passes `_simDate` for exactly this reason, and
 * driving the renderer by hand has to do the same.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');
const OUT = resolve(HERE, '../build/beats');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
}

const W = Number(arg('w', 1400));
const H = Number(arg('h', 788));

if (!existsSync(DEPLOYED)) {
  console.error('Deployed renderer not found. Build first:  dotnet build src\\AnomalyEngine');
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

/**
* `region` selects the measurement window:
 *   all       the whole frame -- right for lights-on, which is a scene-wide change
 *   <kind>    that landmark's own rect, padded
 *   treeline  the forest band plus the ridge above it, where the watcher stands
 *   moon      the moon disc's rect, padded generously, since the pulse is a halo
 *   terminal  the observatory terminal's corner of the frame
 */
const SHOTS = [
  { beat: 'lights-on', trigger: 'konami', region: 'all', hour: 1.2, weather: 'clear', world: 'the-town-that-wasnt-there' },
  { beat: 'lights-on-day', trigger: 'konami', region: 'all', hour: 13, weather: 'clear', world: 'the-town-that-wasnt-there', reuse: true },
  { beat: 'observatory-door', trigger: 'triple-click:observatory', region: 'observatory', hour: 21.5, weather: 'clear', world: 'the-town-that-wasnt-there' },
  { beat: 'moon-pulse', trigger: 'hover:moon@midnight', region: 'moon', hour: 1.5, weather: 'clear', world: 'saltwick' },
  { beat: 'watcher', trigger: 'idle:forest:30s', region: 'treeline', hour: 20.5, weather: 'clear', world: 'the-town-that-wasnt-there' },
  { beat: 'clock-lie', trigger: '3:33 x3', region: 'terminal', hour: 1.5, weather: 'clear', world: 'saltwick' },
  { beat: 'terminal-message', trigger: 'dev-build', region: 'terminal', hour: 16, weather: 'clear', world: 'the-long-head' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.addInitScript(() => {
  // A clock the tool drives rather than a clock that runs. The stub only *reads*
  // `__perfT`; the step is applied once per frame from `settle`, because `render` calls
  // `performance.now()` more than once and a stub that advanced on every read would
  // give each call site a different amount of time.
  window.__perfT0 = 100000;
  window.__perfT = window.__perfT0;
  Object.defineProperty(performance, 'now', {
    configurable: true,
    writable: true,
    value: () => window.__perfT,
  });

  // And a seeded `Math.random`. Stars, snow crystals and smoke are drawn from it, so an
  // unseeded one meant the control and the real run sampled entirely different
  // particles: the terminal region reported 985 "changed pixels" that were just a fresh
  // roll of the dice, and the full-frame control varied between 1,065 and 10,064 across
  // identical runs. `visual-snapshot.mjs` seeds it for the same reason.
  window.__rndState = 0x9e3779b9;
  Math.random = () => {
    let t = (window.__rndState = (window.__rndState + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});
await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 30000 });

/**
 * Pause the engine's own loop and render the *simulated* date by hand.
 *
 * The important part is that before-frame and after-frame land on the same animation
 * phase. `render` derives `dt` from `performance.now()`, so simply rewinding the clock
 * made the two frames diverge by however much real time had passed -- snow, smoke and
 * CRT flicker ended up in different places and swamped the effect being measured. The
 * observatory door, a small wedge of light, read anywhere between -0.54 and -0.23
 * depending on where a snowflake was.
 *
 * So `_last` is seeded with the current clock rather than zero: every frame then
 * advances by exactly one step, and `_t` reaches `frames * step` no matter what the
 * absolute clock says. Same frame count both sides, same phase both sides, and what is
 * left in the delta is the beat.
 */
const STEP = 1000 / 60;
const FRAMES = 48;

async function settle(frames = FRAMES) {
  await page.evaluate(
    async ({ frames: n, step }) => {
      const engine = window.__engine;
      const r = engine._renderer;
      if (!engine.__toolPaused) {
        engine.pause();
        engine.__toolPaused = true;
      }
      // Rewind to the same instant for every settle. The control and the real run then
      // traverse an identical span of clock, so CRT flicker, star twinkle and the
      // typewriter land on the same pixels in both and cancel in the diff. Phase-matching
      // alone was not enough: it equalised the *deltas* but not the absolute time, and
      // anything keyed off the absolute clock still moved between the two frames and
      // contributed roughly a thousand phantom "changed pixels" in the terminal region.
      window.__perfT = window.__perfT0;
      window.__rndState = 0x9e3779b9;
      r._t = 0;
      // Seed with the live clock, not zero: `render` computes `dt` as now minus `_last`,
      // so a zero seed gives every first frame a dt of the entire session's uptime.
      r._last = window.__perfT;
      r._bolt = 0;
      // `_simDate` is what the engine's own loop renders, so using it keeps the hour the
      // shot asked for instead of the real wall clock.
      const date = engine._simDate ?? new Date();
      for (let i = 0; i < n; i++) {
        // One step per frame. `render` reads `performance.now()` more than once, so the
        // clock is advanced here rather than from inside the stub -- otherwise the step
        // lands once per call site and the two frames drift apart again.
        window.__perfT += step;
        r.render(date);
        await new Promise((res) => requestAnimationFrame(res));
      }
    },
    { frames, step: STEP }
  );
}

/**
 * Resolves the pixel box for a shot's region, or an error if it has none.
 *
 * Every measurement goes through this so that before-frame and after-frame are cut from
 * exactly the same rectangle; a region that re-derives differently between the two would
 * put a rectangle shift into the delta and read as an effect.
 */
async function regionBox(region) {
  return page.evaluate((r) => {
    const src = document.getElementById('wallpaper-canvas');
    const engine = window.__engine;
    const surfaces = engine._renderer.getInteractionSurfaces(engine._simDate ?? new Date());

    let box;
    if (r === 'all') box = { x: 0, y: 0, w: src.width, h: src.height };
    else if (r === 'treeline') {
      // The forest band plus the ridge above it.
      //
      // The `watcher` figure is drawn with its feet at `h0(0.688)`, which is above the
      // top of the forest band, so measuring the band alone reported a beat running at
      // full amount and a region whose largest per-pixel delta was 2. The band is where
      // the zone is; this is where the thing that appears in it actually stands.
      const f = surfaces.forest;
      const headroom = 0.1 * src.height;
      box = {
        x: 0,
        y: Math.max(0, f.y * src.height - headroom),
        w: src.width,
        h: Math.max(1, f.height * src.height + headroom),
      };
    } else if (r === 'moon') {
      const m = surfaces.moon;
      if (!m) return { error: 'moon not visible at this hour' };
      // The pad is in pixels. It was first written as a bare `3` in normalised space --
      // three whole viewports of padding -- which clamped the box to the entire frame,
      // and then as a normalised box where every other branch multiplied by the canvas
      // size, which clamped it to a single pixel of sky. Both produced confident numbers
      // about nothing.
      const padX = 90 / src.width;
      const padY = 90 / src.height;
      box = {
        x: (m.x - padX) * src.width,
        y: (m.y - padY) * src.height,
        w: (m.width + padX * 2) * src.width,
        h: (m.height + padY * 2) * src.height,
      };
    } else if (r === 'terminal') {
      box = { x: 0, y: src.height * 0.55, w: src.width * 0.4, h: src.height * 0.45 };
    } else {
      const l = surfaces.landmarks.find((x) => x.kind === r);
      if (!l) return { error: `no ${r} landmark in this world` };
      const pad = 0.02;
      box = {
        x: (l.x - pad) * src.width,
        y: (l.y - pad) * src.height,
        w: (l.width + pad * 2) * src.width,
        h: (l.height + pad * 2) * src.height,
      };
    }

    const x0 = Math.max(0, Math.round(box.x));
    const y0 = Math.max(0, Math.round(box.y));
    const x1 = Math.min(src.width, Math.round(box.x + box.w));
    const y1 = Math.min(src.height, Math.round(box.y + box.h));
    const w = Math.max(1, x1 - x0);
    const h = Math.max(1, y1 - y0);
    // The box is reported back rather than assumed, because a region that silently
    // clamps to the whole frame produces a delta too small to interpret and looks
    // exactly like a beat that did not render.
    return { x0, y0, w, h, label: `${w}x${h}@${x0},${y0}` };
  }, region);
}

function readPixels(box) {
  return page.evaluate((g) => {
    const src = document.getElementById('wallpaper-canvas');
    const gl = src.getContext('2d', { willReadFrequently: true });
    const data = gl.getImageData(g.x0, g.y0, g.w, g.h).data;
    const n = data.length / 4;
    const arr = new Float32Array(n);
    let sum = 0;
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      arr[j] = l;
      sum += l;
    }
    return { arr, luma: sum / n, n, url: src.toDataURL('image/png') };
  }, box);
}

/** Snapshots a region and keeps it on the page for the later diff. */
async function capture(region) {
  const box = await regionBox(region);
  if (box.error) return box;
  const px = await readPixels(box);
  await page.evaluate((a) => {
    // The rolling baseline. Every diff is taken against the frame immediately before
    // it, because the renderer accumulates state between settles and a baseline that is
    // two settles old absorbs all of that accumulation into the measurement.
    window.__prev = a;
  }, px.arr);
  return { luma: px.luma, box: box.label, pixels: px.n, url: px.url };
}

/**
 * Locates the beat's pixels across the whole frame, excluding the control's.
 *
 * Two details make the difference between this working and producing a plausible lie.
 *
 * The current frame is compared against the *control* frame, not against the original
 * baseline. The baseline sits two settles away and the control sits one, so anything
 * that accumulates per frame -- and something in the renderer clearly does -- lands
 * squarely in that difference. The first version diffed against the baseline and
 * reported 2,483 scattered pixels across `x102..980 y304..712` for a beat that draws
 * nothing, which is drift dressed up as a figure.
 *
 * And a pixel only counts if the control left it alone, which is what removes the
 * scene's own steady movement from both sides of the comparison.
 */
async function locateBeat() {
  const box = await regionBox('all');
  const px = await readPixels(box);
  const { base, ctrl } = await page.evaluate(() => ({ base: window.__capAll, ctrl: window.__capAllCtrl }));
  if (!base || !ctrl || base.length !== px.arr.length || ctrl.length !== px.arr.length) return null;

  let count = 0;
  let minX = -1, maxX = -1, minY = -1, maxY = -1;
  for (let i = 0; i < px.arr.length; i++) {
    if (Math.abs(px.arr[i] - ctrl[i]) <= PIXEL_MARGIN) continue;
    if (Math.abs(ctrl[i] - base[i]) > PIXEL_MARGIN) continue;
    count++;
    const col = i % box.w;
    const row = (i / box.w) | 0;
    if (minX < 0 || col < minX) minX = col;
    if (col > maxX) maxX = col;
    if (minY < 0 || row < minY) minY = row;
    if (row > maxY) maxY = row;
  }
  return { count, where: count ? `x${minX}..${maxX} y${minY}..${maxY}` : 'nothing' };
}
async function snapshotAll(key) {
  const box = await regionBox('all');
  const px = await readPixels(box);
  await page.evaluate(({ k, a }) => {
    window[k] = a;
  }, { k: key, a: px.arr });
}

/**
 * Compares the region against the snapshot taken by `capture`.
 *
 * Mean luminance was the first statistic used here and it is the wrong one for most of
 * these effects. Lighting a couple of dozen windows changes perhaps 1,500 pixels in a
 * 1,103,200-pixel frame: +40 luma on 0.14% of the area is +0.06 on the average, which
 * sits below any defensible threshold and reports a working effect as a failure. The
 * same is true in reverse -- a small localised darkening is real change and averages to
 * nothing.
 *
 * So the primary signal is *how many pixels moved*: counting pixels whose luma changed
 * by more than a perceptible margin answers "did anything draw here" for a beat that
 * touches three windows and for one that repaints the sky alike, and it does not care
 * whether the change brightened or darkened. Mean absolute delta is kept alongside as a
 * magnitude sense check.
 */
const PIXEL_MARGIN = 12;

/**
 * @param {'control'|'after'} mode
 *
 * `control` records which pixels moved on their own; `after` judges the beat against
 * pixels that control left alone.
 *
 * The control is necessary because these renders are not perfectly repeatable. Every
 * per-frame input -- the clock, `_t`, the PRNG seed -- is pinned, and the two frames
 * still differ: the full-frame night control moved 2,509 pixels and the terminal
 * control moved 985, identically on every run of the tool. Something inside the
 * renderer keeps state that the resets do not reach, most likely particle arrays that
 * accumulate positions across frames rather than being derived from `_t`.
 *
 * Guessing at that state is a losing game, and inflating the threshold to sit above it
 * is worse: it would have put the floor at 10,036 pixels for `lights-on`, higher than
 * the effect being measured. Instead the control's moved pixels are masked out, since
 * they move with or without a beat, and only the remainder is credited to it.
 */
async function compare(region, mode) {
  const box = await regionBox(region);
  if (box.error) return box;
  const px = await readPixels(box);
  const before = await page.evaluate(() => window.__prev);
  if (!before || before.length !== px.arr.length) {
    return { error: 'no matching before-snapshot for this region' };
  }
  // The control's moved pixels. Only the right length when the box came out the same
  // both times, and silently useless if not -- which is why it is checked rather than
  // assumed, since a length mismatch would corrupt every count past that point.
  let noise = null;
  if (mode === 'after') {
    noise = await page.evaluate(() => window.__noiseMask ?? null);
    if (noise && noise.length !== px.arr.length) noise = null;
  }

  let changed = 0;
  let absSum = 0;
  let maxD = 0;
  // For `after`, the set of pixels credited to the beat; for `control`, the set about
  // to become the mask. `after` is the only one whose result needs a bounding box.
  const fresh = mode === 'after' ? new Uint8Array(px.arr.length) : null;
  const mask = mode === 'control' ? new Uint8Array(px.arr.length) : null;
  let minX = -1, maxX = -1, minY = -1, maxY = -1;
  for (let i = 0; i < px.arr.length; i++) {
    const d = Math.abs(px.arr[i] - before[i]);
    absSum += d;
    if (d > maxD) maxD = d;
    if (d <= PIXEL_MARGIN) continue;
    changed++;
    if (mode === 'after' && (!noise || !noise[i])) {
      fresh[i] = 1;
      const col = i % box.w;
      const row = (i / box.w) | 0;
      if (minX < 0 || col < minX) minX = col;
      if (col > maxX) maxX = col;
      if (minY < 0 || row < minY) minY = row;
      if (row > maxY) maxY = row;
    }
    if (mode === 'control') mask[i] = 1;
  }
  const clean = fresh ? fresh.reduce((a, b) => a + b, 0) : changed;

  if (mask) {
    await page.evaluate((arr) => {
      window.__noiseMask = arr;
    }, mask);
  }

  // Advance the baseline so the next diff -- the control against its predecessor, the
  // beat against the control -- spans the same one interval as this one did.
  await page.evaluate((a) => {
    window.__prev = a;
  }, px.arr);

  return {
    luma: px.luma,
    box: box.label,
    pixels: px.n,
    url: px.url,
    changed,
    clean,
    mad: absSum / px.arr.length,
    maxD,
    // Where the credited change actually landed, in canvas pixels. Needed because a
    // miss and an effect drawn somewhere the region does not cover are the same event
    // as far as a pixel count is concerned, and only this tells them apart.
    where:
      minX >= 0
        ? `x${box.x0 + minX}..${box.x0 + maxX} y${box.y0 + minY}..${box.y0 + maxY}`
        : 'nothing',
  };
}

let failures = 0;
for (const shot of SHOTS) {
await page.evaluate((s) => {
    const engine = window.__engine;
    engine.setWorld(s.world);
    engine.setDirection('depth');
    engine.setStyle('painterly');
    engine.setSimulatedHour(s.hour);
    engine.setSimulatedWeather(s.weather);
    // Motion off. Snow, rain, smoke and waves all scale with intensity and they are pure
    // noise for this measurement -- they move pixels in the control and in the real run
    // and say nothing about whether a beat drew. At 0.35 the night-scene control alone
    // changed 2,505 pixels, which pushed every floor above the effects being judged.
    engine.setMotionIntensity(0);
    // A beat left over from the previous shot must not be live during this one's control
    // sample, or the control absorbs the previous effect and this shot's threshold comes
    // out wrong in both directions.
    engine._renderer._beat = null;
  }, shot);
  await settle();

const before = await capture(shot.region);
  if (before.error) {
    console.log(`FAIL  ${shot.beat}: ${before.error}`);
    failures++;
    continue;
  }
  await snapshotAll('__capAll');

// Measure this scene's own drift before firing anything, with the same region, world
// and hour the beat will be judged against. Without it the threshold is a number chosen
// to make things pass: snow cover, CRT flicker and the typewriter all advance with the
// clock, and that movement has to be counted and subtracted from what the beat is
// credited with rather than quietly absorbed into a fixed guess.
  await settle();
  const ctrl = await compare(shot.region, 'control');
  if (ctrl.error) {
    console.log(`FAIL  ${shot.beat}: ${ctrl.error}`);
    failures++;
    continue;
  }
  // With the control's own pixels masked out of the result, the floor is back to a flat
  // handful rather than a multiple of the noise -- which mattered, because 4x the
  // full-frame control put `lights-on` above its own effect.
  const floor = 30;
  // Full frame as it stands with no beat live, for locating a miss.
  await snapshotAll('__capAllCtrl');

  // Prefer the real discovery path, so the shot exercises the same code a player's
  // click would. Fall back to a direct preview only for a beat that was already found
  // earlier in this run -- which is exactly what `previewStoryBeat` exists for.
  const applied = await page.evaluate((s) => {
    const engine = window.__engine;
    // Start the beat on the same instant the upcoming settle starts, so its age at
    // capture is exactly `FRAMES * STEP` rather than whatever wall time elapsed while
    // the control sample was being taken.
    window.__perfT = window.__perfT0;
    if (engine.discoverEgg(s.trigger)) return { ok: true, via: 'discoverEgg' };
    if (!s.reuse) {
      return { ok: false, reason: 'discoverEgg returned false (already found, or unknown trigger)' };
    }
    engine.previewStoryBeat({
      kind: s.beat.startsWith('lights-on') ? 'lights-on' : s.beat,
      durationMs: 10000,
    });
    return { ok: true, via: 'previewStoryBeat' };
  }, shot);

  if (!applied.ok) {
    console.log(`FAIL  ${shot.beat}: ${applied.reason}`);
    failures++;
    continue;
  }

  // Same frame count as the before-frame. Two reasons: the count *is* the animation
  // phase, so any difference re-introduces the noise this was changed to remove; and at
  // 48 frames the beat is 800ms old, comfortably past the 400ms fade-in but well inside
  // the window before the 900ms fade-out.
await settle();
  const after = await compare(shot.region, 'after');
  if (after.error) {
    console.log(`FAIL  ${shot.beat}: ${after.error}`);
    failures++;
    continue;
  }

  // Is the beat actually on screen at the moment of capture? Without this the tool
  // cannot tell "the beat rendered and was invisible" from "the beat had already
  // expired", and both come out as a small delta.
  const live = await page.evaluate(() => {
    const s = window.__engine._renderer;
    const b = s.getActiveStoryBeat();
    return b ? { kind: b.beat.kind, amount: Number(s._beatAmount(b.beat.kind).toFixed(3)) } : null;
  });

  writeFileSync(resolve(OUT, `${shot.beat}-before.png`), Buffer.from(before.url.split(',')[1], 'base64'));
  writeFileSync(resolve(OUT, `${shot.beat}-after.png`), Buffer.from(after.url.split(',')[1], 'base64'));

// `clean` excludes pixels the control also moved; `changed` is the raw count, kept
  // visible so a pass that rests entirely on the mask would be obvious.
  const moved = after.clean;
  const ok = moved > floor;
  const liveStr = live ? `live=${live.kind}@${live.amount}` : 'live=EXPIRED';
  console.log(
    `${ok ? 'PASS ' : 'FAIL '} ${shot.beat.padEnd(20)} ${String(shot.region).padEnd(12)} ` +
      `clean ${String(moved).padStart(7)} px (raw ${String(after.changed).padStart(7)}, ` +
      `control ${String(ctrl.changed).padStart(5)}, floor ${floor}) ` +
      `mad ${after.mad.toFixed(2)}  max ${after.maxD.toFixed(0)}  box ${after.box} ${liveStr}`
  );

  if (!ok) {
    // A miss in the region could still be a hit somewhere else -- a figure drawn above
    // the band the shot assumed, for instance. `locateBeat` separates "drew outside the
    // box" from "drew nothing", and only the second is a defect in the effect.
    const wide = await locateBeat();
    if (wide) console.log(`       whole frame: ${wide.count} px at ${wide.where}`);
  }
  if (!ok) failures++;
}

// Zone inspection: the point of the M1 registry was to make this possible, so it is
// asserted rather than merely available.
const zones = await page.evaluate(() => {
  const engine = window.__engine;
  const surfaces = engine._renderer.getInteractionSurfaces(new Date(2024, 0, 1, 22, 0));
  return {
    ids: engine.getZoneIds(),
    progress: engine.getDiscoveryProgress(),
    landmarks: surfaces.landmarks.map((l) => ({ kind: l.kind, x: l.x, cx: l.x + l.width / 2 })),
    moon: surfaces.moon,
    forest: surfaces.forest,
  };
});
console.log(`\nregistered zones: ${zones.ids.join(', ') || '(none)'}`);
console.log(`discoveries:      ${zones.progress.discovered} of ${zones.progress.total}`);
console.log(
  `landmarks:        ${zones.landmarks.map((l) => `${l.kind} cx=${l.cx.toFixed(3)}`).join(', ')}`
);
console.log(
  `moon region:      ${zones.moon ? `${zones.moon.x.toFixed(3)},${zones.moon.y.toFixed(3)}` : '(not visible at 22:00)'}`
);
console.log(`forest band:      y ${zones.forest.y.toFixed(3)} h ${zones.forest.height.toFixed(3)}`);

await browser.close();
console.log(
  `\n${failures === 0 ? 'every beat measurably rendered' : `${failures} beat(s) did not change their region`}`
);
process.exit(failures === 0 ? 0 : 1);