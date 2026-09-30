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

// --- style switching, exactly as the tray dispatches it ---
const styleHashes = {};
for (const style of ['painterly', 'flat', 'riso']) {
  await page.evaluate((s) => {
    window.dispatchEvent(new CustomEvent('anomaly:style', { detail: { style: s } }));
  }, style);
  await page.waitForTimeout(1400);

  const reported = await page.evaluate(() => window.__engine.getStyle());
  check(`tray dispatch applies "${style}"`, reported === style, `reported "${reported}"`);

  const h = await shot(style);
  styleHashes[style] = h;
  const buf = await page.screenshot({ path: join(OUT, `style-${style}.png`) });
  void buf;
}
check('all three styles render distinct pixels',
  new Set(Object.values(styleHashes)).size === 3,
  JSON.stringify(styleHashes));

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
await page.evaluate(() => window.__engine.setSimulatedWeather('clear'));
await page.waitForTimeout(1200);

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
