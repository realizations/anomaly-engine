/**
 * Comprehensive visual showcase.
 *
 * Renders the full matrix of art style x time of day, x weather, and each
 * anomaly, then builds a self-contained HTML gallery that opens from file://.
 *
 * Runs against the DEPLOYED build over file://, which is the exact condition
 * the native host uses. Serving over http would hide module/CORS regressions.
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DEPLOYED = join(ROOT, 'src', 'AnomalyEngine', 'bin', 'Debug', 'net8.0-windows', 'renderer', 'index.html');
const DEV = join(ROOT, 'src', 'Engine', 'renderer', 'index.html');
const OUT = join(ROOT, 'build', 'showcase');
const SHOTS = join(OUT, 'img');
mkdirSync(SHOTS, { recursive: true });

if (!existsSync(DEPLOYED)) {
  process.stdout.write(`ERROR  deployed build missing: ${DEPLOYED}\n  Run the dotnet build first.\n`);
  process.exit(1);
}

const STYLES = [
  { id: 'painterly', label: 'Painterly', blurb: 'Soft atmospheric depth. Gradient sky, haze, grain, vignette.' },
  { id: 'flat', label: 'Flat Vector', blurb: 'Banded sky, solid silhouettes, per-layer value separation.' },
  { id: 'riso', label: 'Riso Print', blurb: 'Hue-safe tonal quantisation, 1px channel misregistration, halftone.' },
];

const TIMES = [
  { hour: 0.5, label: 'Deep Night' },
  { hour: 4.6, label: 'First Light' },
  { hour: 6.8, label: 'Dawn' },
  { hour: 12.0, label: 'Midday' },
  { hour: 16.8, label: 'Golden Hour' },
  { hour: 19.4, label: 'Dusk' },
  { hour: 21.8, label: 'Night' },
];

const WEATHER = [
  { id: 'clear', label: 'Clear' },
  { id: 'cloudy', label: 'Cloudy' },
  { id: 'rain', label: 'Rain' },
  { id: 'storm', label: 'Storm' },
  { id: 'snow', label: 'Snow' },
  { id: 'fog', label: 'Fog' },
];

const ANOMALIES = [
  { id: 'meteor', label: 'Meteor', blurb: 'A shooting star crosses the sky.' },
  { id: 'second-moon', label: 'Second Moon', blurb: 'A second moon appears for 8 seconds.' },
  { id: 'red-moon', label: 'Red Moon', blurb: 'The moon turns red. It does not happen every night.' },
  { id: 'forest-watcher', label: 'Watcher in the Pines', blurb: 'Something moves between the trees.' },
  { id: 'observatory-signal', label: 'Observatory Signal', blurb: 'The dish fires into the void. It is not random.' },
];

const frames = [];
let failures = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// file:// is the deployment path; http would mask module and CORS problems.
await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });
await page.waitForTimeout(1500);

const worlds = await page.evaluate(() => window.__engine.listWorlds());
process.stdout.write(`${worlds.length} worlds: ${worlds.map((w) => w.id).join(', ')}\n`);

// Renders one style x item combination and records it.
async function matrix(group, items, applyFor, settle = 1500) {
  for (const s of STYLES) {
    for (const it of items) {
      await page.evaluate(applyFor, { style: s.id, item: it });
      await page.waitForTimeout(settle);
      const name = `${group}-${s.id}-${it.id}`;
      await page.screenshot({ path: join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 74 });
      if (errors.length) {
        failures++;
        process.stdout.write(`  FAIL ${name}: ${errors.join('; ')}\n`);
        errors.length = 0;
      }
      frames.push({ file: `img/${name}.jpg`, group, style: s, item: it });
      process.stdout.write(`  ${name}\n`);
    }
  }
}

process.stdout.write('Rendering style x time of day...\n');
await matrix('time', TIMES.map((t) => ({ id: String(t.hour).replace('.', '_'), label: t.label })), ({ style, item }) => {
  window.__engine.setStyle(style);
  window.__engine.setSimulatedHour(Number(item.id.replace('_', '.')));
  window.__engine.setSimulatedWeather('clear');
});

process.stdout.write('Rendering style x weather (golden hour)...\n');
await matrix('weather', WEATHER.map((w) => ({ id: w.id, label: w.label })), ({ style, item }) => {
  window.__engine.setStyle(style);
  window.__engine.setSimulatedHour(16.8);
  window.__engine.setSimulatedWeather(item.id);
});

process.stdout.write('Rendering style x anomaly (night)...\n');
await matrix('anomaly', ANOMALIES, ({ style, item }) => {
  window.__engine.setStyle(style);
  window.__engine.setSimulatedHour(22);
  window.__engine.setSimulatedWeather('clear');
  window.__engine.forceAnomaly(item.id);
}, 1800);

// Worlds are rendered with the default style, since the point here is to compare
// places rather than treatments.
process.stdout.write('Rendering worlds...\n');
for (const style of [STYLES[0]]) {
  for (const time of [
    { id: 'night', label: 'Night', hour: 1.5 },
    { id: 'golden', label: 'Golden Hour', hour: 16.8 },
  ]) {
    for (const w of worlds) {
      await page.evaluate(({ id, s, h }) => {
        window.__engine.setStyle(s);
        window.__engine.setSimulatedHour(h);
        window.__engine.setSimulatedWeather('clear');
        // Clear lingering anomalies so a world shot is not tinted by whatever
        // the anomaly section happened to leave running.
        window.__engine.clearAnomalies();
        window.__engine.setWorld(id);
      }, { id: w.id, s: style.id, h: time.hour });
      await page.waitForTimeout(1800);
      const name = `world-${w.id}-${time.id}`;
      await page.screenshot({ path: join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 74 });
      if (errors.length) failures++;
      frames.push({ file: `img/${name}.jpg`, group: 'world', style, item: { ...w, label: `${w.name} â€” ${time.label}` } });
      process.stdout.write(`  ${name}\n`);
    }
  }
}

await browser.close();

/* ----------------------------- gallery ----------------------------- */

const FEATURES = [
  { name: 'Procedural world', state: 'live', text: 'Every ridge, conifer, power line, road and star is generated from seeded noise at runtime. The project ships zero third-party art, so there is no asset licence to inherit and no resolution ceiling.' },
  { name: 'Worlds as data', state: 'live', text: 'A world is a ~40 line data object: biome, palette, terrain profile and structures. Six shipped worlds. Adding one needs no art pipeline and no code change to the renderer.' },
  { name: 'Biome-aware ground', state: 'live', text: 'Grass belongs to a forest, snow drifts to a fell, desiccation cracks to a dry lake bed, tide pools to a salt flat. Choosing the wrong one is what makes a world look wrong.' },
  { name: 'Real local time', state: 'live', text: 'Sky, sun, moon phase and colour grading are driven by the system clock and a real latitude/longitude, so the scene matches the sky outside your window.' },
  { name: 'Weather', state: 'live', text: 'Six conditions with wind-driven precipitation, lightning, fog density and cloud cover. The weather loop was previously never started; that is fixed.' },
  { name: 'Anomaly layer', state: 'live', text: 'Five anomalies with rarity, cooldowns and durations, fired by the event bus and written to the journal. Deliberately ambiguous: a red moon is deniable.' },
  { name: 'Field notes', state: 'live', text: 'The ARG surface. World premise, what you have observed, and how far you have got. Every anomaly is paired with a plausible denial, so the panel never confirms anything.' },
  { name: 'Durable state', state: 'live', text: 'World, style, reduced motion, journal and discovered secrets persist to a JSON document in %APPDATA% via the native host. A corrupt save cannot stop the engine from starting.' },
  { name: 'Dynamic quality', state: 'live', text: 'The scene renders to an offscreen buffer and is blitted up. Render scale adapts to hold a frame budget, because a wallpaper that stutters is worse than one that is slightly soft.' },
  { name: 'Event bus + scheduler', state: 'live', text: 'Typed events with priority, rarity and cooldown, driven by clock, random and network sources. Cron-style scheduling included.' },
  { name: 'Art style switching', state: 'live', text: 'Three full renderer treatments switchable from the tray or Ctrl+Alt+S, with an active-style checkmark. Verified by automated pixel-diff tests.' },
  { name: 'Global hotkeys', state: 'live', text: 'Ctrl+Alt+W/S/P/F/D. The wallpaper never holds keyboard focus, so these are registered with Windows rather than handled in the page.' },
  { name: 'Reduced motion', state: 'live', text: 'Honours the OS reduced-motion preference by scaling all ambient animation to 25%. This surface runs for hours, so constant drift is a genuine accessibility problem.' },
  { name: 'Fullscreen passthrough', state: 'live', text: 'Detects fullscreen foreground windows and yields. Shell and WorkerW windows are excluded so the engine never pauses itself, and a manual pause survives a fullscreen app closing.' },
  { name: 'Diagnostics', state: 'live', text: '--diagnose, --capture, window enumeration, WorkerW probing, structured JSON logging.' },
  { name: 'World clock drift', state: 'live', text: 'The clock can drift, freeze, glitch and run backward, and is bound to the date handed to the renderer, so it is visible rather than bookkeeping nobody sees.' },
  { name: 'Secrets + moments', state: 'live', text: 'Discovery with hints and clues, surfaced in the field-notes panel and persisted. Unknown ids from older saves are ignored rather than breaking the panel.' },
  { name: 'ARG event sources', state: 'scaffold', text: 'GitHub, RSS and remote event source adapters are implemented but intentionally unconfigured and off by default. They need endpoint URLs, payload validation and rate limits before shipping.' },
  { name: 'Multi-monitor', state: 'scaffold', text: 'Monitors are enumerated and the host is sized correctly, but one wallpaper is hosted on the primary monitor only.' },
  { name: 'Audio reactivity', state: 'scaffold', text: 'A media-reactivity system and audio system exist. Desktop audio capture is not implemented, so this is inert.' },
  { name: 'Paid tiers', state: 'planned', text: 'The licence gate exists specifically so a paid tier can never ship a non-commercial asset. The engine is MIT and any paid layer must live outside the repo.' },
];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const section = (id, title, intro, items) => `
  <section id="${id}">
    <h2>${esc(title)}</h2>
    <p class="intro">${esc(intro)}</p>
    ${STYLES.map((s) => {
      const row = items.filter((i) => i.style.id === s.id);
      if (!row.length) return '';
      return `<h3><span class="dot dot-${s.id}"></span>${esc(s.label)}</h3>
      <p class="blurb">${esc(s.blurb)}</p>
      <div class="row">${row.map((i) => `
        <figure>
          <a href="${i.file}"><img loading="lazy" src="${i.file}" alt="${esc(s.label)} - ${esc(i.item.label)}"></a>
          <figcaption>${esc(i.item.label)}</figcaption>
        </figure>`).join('')}</div>`;
    }).join('')}
  </section>`;

const usedFrames = {
  time: frames.filter((f) => f.group === 'time'),
  weather: frames.filter((f) => f.group === 'weather'),
  anomaly: frames.filter((f) => f.group === 'anomaly'),
  world: frames.filter((f) => f.group === 'world'),
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anomaly Engine - visual showcase</title>
<style>
  :root {
    --bg:#0c0d13; --panel:#14161f; --line:#242735; --ink:#e9e7e1; --dim:#8f8d86;
    --live:#6ee7a8; --scaffold:#e0b341; --planned:#7aa2f7;
  }
  * { box-sizing:border-box; margin:0; padding:0; }
  body { background:var(--bg); color:var(--ink); font:14px/1.65 "Segoe UI",system-ui,-apple-system,sans-serif; padding:0 0 80px; }
  header { padding:56px 40px 32px; border-bottom:1px solid var(--line); max-width:1400px; margin:0 auto; }
  h1 { font-size:30px; font-weight:650; letter-spacing:-.01em; }
  .tag { color:var(--dim); margin-top:8px; font-size:15px; max-width:760px; }
  .meta { margin-top:20px; display:flex; gap:10px; flex-wrap:wrap; }
  .chip { border:1px solid var(--line); border-radius:999px; padding:4px 12px; font-size:12px; color:var(--dim); }
  nav { position:sticky; top:0; background:rgba(12,13,19,.94); backdrop-filter:blur(8px);
        border-bottom:1px solid var(--line); z-index:5; }
  nav div { max-width:1400px; margin:0 auto; padding:12px 40px; display:flex; gap:20px; flex-wrap:wrap; }
  nav a { color:var(--dim); text-decoration:none; font-size:13px; }
  nav a:hover { color:var(--ink); }
  section { max-width:1400px; margin:0 auto; padding:44px 40px 8px; }
  h2 { font-size:21px; font-weight:620; margin-bottom:6px; }
  .intro { color:var(--dim); margin-bottom:26px; max-width:820px; }
  h3 { font-size:14px; font-weight:600; margin:26px 0 2px; display:flex; align-items:center; gap:9px; }
  .dot { width:9px; height:9px; border-radius:50%; display:inline-block; }
  .dot-painterly { background:#7aa2f7; } .dot-flat { background:#6ee7a8; } .dot-riso { background:#e0b341; }
  .blurb { color:var(--dim); font-size:13px; margin-bottom:12px; padding-left:18px; }
  .row { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; padding-left:18px; }
  figure { background:var(--panel); border:1px solid var(--line); border-radius:8px; overflow:hidden; }
  figure img { width:100%; display:block; aspect-ratio:16/9; object-fit:cover; }
  figcaption { padding:9px 12px; font-size:12px; color:var(--dim); }
  .feat { display:grid; grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); gap:12px; }
  .card { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--dim); border-radius:8px; padding:16px 18px; }
  .card.live { border-left-color:var(--live); } .card.scaffold { border-left-color:var(--scaffold); } .card.planned { border-left-color:var(--planned); }
  .card h4 { font-size:14px; font-weight:600; display:flex; justify-content:space-between; gap:10px; align-items:baseline; }
  .state { font-size:10px; text-transform:uppercase; letter-spacing:.08em; padding:2px 7px; border-radius:4px; border:1px solid currentColor; }
  .card.live .state { color:var(--live); } .card.scaffold .state { color:var(--scaffold); } .card.planned .state { color:var(--planned); }
  .card p { color:var(--dim); font-size:13px; margin-top:8px; }
  footer { max-width:1400px; margin:44px auto 0; padding:28px 40px 0; border-top:1px solid var(--line); color:var(--dim); font-size:12px; }
  code { background:#1b1e29; padding:1px 5px; border-radius:4px; font-size:12px; }
</style></head><body>
<header>
  <h1>Anomaly Engine &mdash; visual showcase</h1>
  <p class="tag">A Windows live-wallpaper engine where the desktop behaves like a persistent, slowly changing world.
  Every frame below is rendered live by the engine from seeded procedural geometry.</p>
  <div class="meta">
    <span class="chip">${frames.length} frames</span>
    <span class="chip">3 art styles</span>
    <span class="chip">${worlds.length} worlds</span>
    <span class="chip">7 times of day</span>
    <span class="chip">6 weather states</span>
    <span class="chip">5 anomalies</span>
    <span class="chip">rendered over file:// like the real host</span>
  </div>
</header>
<nav><div>
  <a href="#worlds">Worlds</a>
  <a href="#time">Time of day</a>
  <a href="#weather">Weather</a>
  <a href="#anomaly">Anomalies</a>
  <a href="#features">Features</a>
  <a href="#licensing">Licensing</a>
</div></nav>
${section('worlds', 'Worlds', 'Six worlds, each a data object rather than an art artefact. Five share the landscape renderer; the corridor is a different scene constructor entirely, because an interior has no sky and no ridgeline. Nights on the left, golden hour on the right.', usedFrames.world)}
${section('time', 'Time of day', 'The same world across a full 24 hours. Sky, sun position, moon phase and colour grading all follow the clock.', usedFrames.time)}
${section('weather', 'Weather', 'Golden hour under six conditions. Wind drives precipitation direction, lightning and fog density.', usedFrames.weather)}
${section('anomaly', 'Anomalies', 'Rare, ambiguous events. Each is fired through the real event bus at night, where they are hardest to distinguish from coincidence.', usedFrames.anomaly)}
<section id="features">
  <h2>What actually works</h2>
  <p class="intro">Green is verified working. Amber is real code that is not yet connected to anything visible. Blue is intentional future work. Nothing here is claimed as finished when it is not.</p>
  <div class="feat">${FEATURES.map((f) => `
    <div class="card ${f.state}">
      <h4>${esc(f.name)}<span class="state">${esc(f.state)}</span></h4>
      <p>${esc(f.text)}</p>
    </div>`).join('')}</div>
</section>
<section id="licensing">
  <h2>Asset licensing</h2>
  <p class="intro">The project currently ships <strong>zero third-party art</strong>. All geometry is generated at runtime, so there is no asset licence to inherit, no attribution burden and no resolution ceiling.</p>
  <p class="intro">A machine-checked licence gate (<code>tools/license-gate.mjs</code>) enforces the policy for anything added later, and is proven by 19 adversarial self-test cases. It rejects non-commercial, no-derivatives, share-alike and copyleft terms outright, because a paid tier must never be able to ship a restricted asset.</p>
  <p class="intro">Verified-safe sources if third-party assets are ever needed: Poly Haven, ambientCG, Kenney and Quaternius (all CC0), Freesound filtered to CC0, Sonniss (embed only), USGS/LROC (public domain), ESA/Hubble (CC BY 4.0). Deliberately rejected for this product category: Pexels, Pixabay, Unsplash and Coverr, whose terms specifically prohibit wallpaper apps or competing collections; ShaderToy's default pool (CC BY-NC-SA); HYG (share-alike); Stellarium sky cultures (mostly NC/ND).</p>
</section>
<footer>Generated by <code>tools/showcase.mjs</code> against the deployed build. ${failures} render error(s).</footer>
</body></html>`;

writeFileSync(join(OUT, 'index.html'), html, 'utf8');
process.stdout.write(`\nWrote ${join(OUT, 'index.html')} with ${frames.length} frames, ${failures} render error(s).\n`);
process.exit(failures ? 1 : 0);
