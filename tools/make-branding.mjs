/**
 * Generates the project's icon, tray assets and social preview.
 *
 * Drawn procedurally rather than sourced, for the same reason every other pixel
 * in this project is: there is no licence to inherit, and the mark is built from
 * the product's own visual language rather than imported from a stock set.
 *
 * The mark is the observatory terminal — a phosphor screen glowing in the dark,
 * sitting on a horizon. That is the thing the whole project is about, and it is
 * the one element that is unmistakably this software rather than a generic
 * wallpaper icon.
 *
 * It has to survive being read at sixteen pixels, so it is built from three
 * shapes with hard value separation and no detail: a dark field, a horizon
 * band, and a bright screen. Anything that does not read at tray size was cut.
 *
 *   node tools/make-branding.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const BRANDING = resolve(ROOT, 'assets/branding');
const BIN = resolve(ROOT, 'src/AnomalyEngine/bin/Debug/net8.0-windows');
const DOCS_IMAGES = resolve(ROOT, 'docs/images');

mkdirSync(BRANDING, { recursive: true });
mkdirSync(DOCS_IMAGES, { recursive: true });

/** The palette, taken from the renderer and the settings window. */
const C = {
  ink: '#0D1014',
  inkDeep: '#070A0D',
  ground: '#161D22',
  phosphor: '#7EE2A8',
  phosphorDim: '#3F7D5C',
  warn: '#E0B341',
  paper: '#E4E9F0',
};

/**
 * Draws the mark at an arbitrary size.
 *
 * Everything is expressed as a fraction of the canvas so the same code produces
 * a legible 16px tray icon and a detailed 1024px store icon. Proportions are
 * fixed; only the detail level changes.
 */
function drawMark(page, size, { rounded }) {
  return page.evaluate(({ size, rounded, C }) => {
    const dpr = 1;
    const cv = document.createElement('canvas');
    cv.width = size;
    cv.height = size;
    const g = cv.getContext('2d');
    const S = size;
    /** Small sizes get a simplified drawing: fine detail becomes noise. */
    const simple = S < 48;

    // Field.
    if (rounded) {
      const r = S * 0.22;
      g.beginPath();
      g.moveTo(r, 0);
      g.arcTo(S, 0, S, S, r);
      g.arcTo(S, S, 0, S, r);
      g.arcTo(0, S, 0, 0, r);
      g.arcTo(0, 0, S, 0, r);
      g.closePath();
      g.clip();
    }
    const sky = g.createLinearGradient(0, 0, 0, S);
    sky.addColorStop(0, C.inkDeep);
    sky.addColorStop(0.62, C.ink);
    sky.addColorStop(1, C.ground);
    g.fillStyle = sky;
    g.fillRect(0, 0, S, S);

    // Horizon haze: the sky meeting the ground, which is what places the screen
    // in a landscape rather than in a void.
    const horizon = S * 0.7;
    const haze = g.createLinearGradient(0, horizon - S * 0.2, 0, horizon);
    haze.addColorStop(0, 'rgba(126,226,168,0)');
    haze.addColorStop(1, 'rgba(126,226,168,0.14)');
    g.fillStyle = haze;
    g.fillRect(0, horizon - S * 0.2, S, S * 0.2);

    // Distant ridge, as a single flat silhouette.
    g.fillStyle = '#0A0F13';
    g.beginPath();
    g.moveTo(0, horizon);
    for (let i = 0; i <= 10; i++) {
      const x = (i / 10) * S;
      const n = Math.sin(i * 1.7) * 0.5 + Math.sin(i * 0.6) * 0.5;
      g.lineTo(x, horizon - (n * 0.5 + 0.5) * S * 0.07);
    }
    g.lineTo(S, horizon);
    g.closePath();
    g.fill();

    // The terminal. A screen on a stand, glowing.
    const sw = S * 0.46;
    const sh = sw * 0.74;
    const sx = (S - sw) / 2;
    const sy = horizon - sh - S * 0.1;
    const radius = Math.max(1, S * 0.035);

    // Glow, so the screen reads as a light source rather than a grey box.
    if (!simple) {
      const glow = g.createRadialGradient(S / 2, sy + sh / 2, 0, S / 2, sy + sh / 2, sw * 1.5);
      glow.addColorStop(0, 'rgba(126,226,168,0.32)');
      glow.addColorStop(0.5, 'rgba(126,226,168,0.1)');
      glow.addColorStop(1, 'rgba(126,226,168,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, S, S);
    }

    // Bezel.
    g.fillStyle = '#20272E';
    g.beginPath();
    g.roundRect(sx - S * 0.045, sy - S * 0.045, sw + S * 0.09, sh + S * 0.09, radius);
    g.fill();
    g.strokeStyle = 'rgba(228,233,240,0.16)';
    g.lineWidth = Math.max(0.5, S * 0.008);
    g.stroke();

    // Tube. Not black: a real phosphor never goes fully dark.
    const tube = g.createLinearGradient(0, sy, 0, sy + sh);
    tube.addColorStop(0, '#08170F');
    tube.addColorStop(1, '#04100B');
    g.fillStyle = tube;
    g.beginPath();
    g.roundRect(sx, sy, sw, sh, radius * 0.7);
    g.fill();

    // The readout. Three lines, because three is the most that reads as
    // "text" rather than as "lines" at small sizes.
    const lines = simple ? 2 : 3;
    const lh = sh * 0.11;
    for (let i = 0; i < lines; i++) {
      const ly = sy + sh * 0.28 + i * lh * 1.5;
      // The first line is full width, the rest are shorter, which is what makes
      // it read as a terminal rather than as an equaliser.
      const w = i === 0 ? sw * 0.62 : i === 1 ? sw * 0.44 : sw * 0.3;
      g.fillStyle = `rgba(126,226,168,${0.92 - i * 0.18})`;
      g.fillRect(sx + sw * 0.16, ly, w, Math.max(1, S * 0.018));
    }

    // Stand.
    g.fillStyle = '#20272E';
    g.fillRect(S / 2 - S * 0.018, sy + sh + S * 0.045, S * 0.036, S * 0.055);
    g.fillRect(S / 2 - S * 0.075, sy + sh + S * 0.09, S * 0.15, S * 0.022);

    // Scanlines, only where they will not turn into a grey wash.
    if (S >= 96) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      const step = Math.max(2, S * 0.012);
      for (let y = sy; y < sy + sh; y += step) {
        g.fillRect(sx, y, sw, Math.max(1, step * 0.4));
      }
    }

    return cv.toDataURL('image/png');
  }, { size, rounded, C });
}

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];

/** Packs PNGs into a Windows .ico. Vista and later read PNG-compressed entries. */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);            // reserved
  header.writeUInt16LE(1, 2);            // type: icon
  header.writeUInt16LE(images.length, 4);

  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach((img, i) => {
    const at = dir.length && i * 16;
    // 256 is encoded as 0 in this field, per the spec.
    dir[at] = img.size >= 256 ? 0 : img.size;
    dir[at + 1] = img.size >= 256 ? 0 : img.size;
    dir[at + 2] = 0;                      // palette size
    dir[at + 3] = 0;                      // reserved
    dir.writeUInt16LE(1, at + 4);         // colour planes
    dir.writeUInt16LE(32, at + 6);        // bits per pixel
    dir.writeUInt32LE(img.data.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += img.data.length;
  });

  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });

const entries = [];
for (const size of SIZES) {
  const url = await drawMark(page, size, { rounded: true });
  const data = Buffer.from(url.split(',')[1], 'base64');
  writeFileSync(resolve(BRANDING, `icon-${size}.png`), data);
  console.log(`  icon-${size}.png  ${(data.length / 1024).toFixed(1)} KB`);
  entries.push({ size, data });
}
await browser.close();

// Tray and app icon: only the sizes Windows actually asks for, to keep it small.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const ico = buildIco(icoSizes.map((s) => entries.find((e) => e.size === s)));
writeFileSync(resolve(BIN, 'anomaly.ico'), ico);
writeFileSync(resolve(BRANDING, 'anomaly.ico'), ico);
console.log(`\nanomaly.ico  ${(ico.length / 1024).toFixed(1)} KB  ${icoSizes.length} sizes`);

// Favicon, small and sharp.
const fav = entries.find((e) => e.size === 32).data;
writeFileSync(resolve(ROOT, 'src/Engine/public/favicon.png'), fav);
console.log('favicon.png 32px');

console.log('\nBranding written to assets/branding and the app output.');

/* ------------------------------------------------------------------ *
 * Social preview
 *
 * Composed over a real render of the engine rather than an abstract
 * graphic. A preview that is a picture of the product is worth several
 * times one that is a picture of a logo, and it cannot drift out of date,
 * because it is generated from the same build everything else is.
 * ------------------------------------------------------------------ */

const DEPLOYED = resolve(BIN, 'renderer/index.html');
const W = 1280;
const H = 640;

const shotBrowser = await chromium.launch();
const shotPage = await shotBrowser.newPage({ viewport: { width: W, height: H } });
await shotPage.goto(pathToFileURL(DEPLOYED).href);
await shotPage.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });

// Seed a last-seen time before reloading, so the engine reports an absence and
// the terminal is showing the "while you were away" readout. That is the most
// distinctive thing the product does, so it is worth having in the preview
// rather than a stock idle screen.
await shotPage.evaluate(() => {
  const key = 'anomaly-engine:state';
  const s = JSON.parse(localStorage.getItem(key) || '{}');
  s.lastSeen = new Date(Date.now() - 14 * 3600e3).toISOString();
  s.totalSessions = 12;
  localStorage.setItem(key, JSON.stringify(s));
});
await shotPage.reload();
await shotPage.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });
await shotPage.evaluate(async (size) => {
  // Pin the composition to exactly the preview's dimensions. The canvas backing
  // store otherwise follows the host's screen size, so the scene is composed
  // for a different aspect and the crop lands on empty sky.
  window.dispatchEvent(new CustomEvent('anomaly:monitors', {
    detail: { monitors: [{ x: 0, y: 0, w: size.W, h: size.H }] },
  }));
  window.__engine.setStyle('painterly');
  // Golden hour, not night. A night scene is atmospheric in motion and almost
  // black in a still, which is the wrong trade for a preview that has to sell
  // the project in a glance.
  window.__engine.setSimulatedHour(17.1);
  window.__engine.setSimulatedWeather('clear');
  window.__engine.setWorld('the-town-that-wasnt-there');
  // The arrival summary holds the terminal for a few seconds, so capturing
  // early shows the readout rather than an idle screen.
  await new Promise((r) => setTimeout(r, 2600));
}, { W, H });

const heroUrl = await shotPage.evaluate(() =>
  document.getElementById('wallpaper-canvas').toDataURL('image/png')
);
const hero = Buffer.from(heroUrl.split(',')[1], 'base64');
writeFileSync(resolve(BRANDING, 'hero-raw.png'), hero);
await shotBrowser.close();

const compBrowser = await chromium.launch();
const compPage = await compBrowser.newPage({ viewport: { width: W, height: H } });
const finalUrl = await compPage.evaluate(async ({ heroUrl, W, H, C }) => {
  const img = new Image();
  img.src = heroUrl;
  await img.decode();

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0, W, H);

  // The scrim is weighted to the RIGHT, where the type sits. The observatory
  // terminal stands in the bottom-left of every world, so darkening the left
  // would hide the single most distinctive thing the product does.
  const scrim = g.createLinearGradient(W * 0.14, 0, W, 0);
  scrim.addColorStop(0, 'rgba(7,10,13,0)');
  scrim.addColorStop(0.42, 'rgba(7,10,13,0.58)');
  scrim.addColorStop(1, 'rgba(7,10,13,0.9)');
  g.fillStyle = scrim;
  g.fillRect(0, 0, W, H);

  // A second, softer scrim along the bottom for the feature strip.
  const foot = g.createLinearGradient(0, H - 150, 0, H);
  foot.addColorStop(0, 'rgba(7,10,13,0)');
  foot.addColorStop(1, 'rgba(7,10,13,0.82)');
  g.fillStyle = foot;
  g.fillRect(0, H - 150, W, 150);

  const right = W - 64;
  const alignRight = (text, y) => {
    g.textAlign = 'right';
    g.fillText(text, right, y);
    g.textAlign = 'left';
  };

  // Eyebrow.
  g.font = '500 15px "Space Grotesk", system-ui, sans-serif';
  g.fillStyle = C.phosphor;
  g.textAlign = 'right';
  g.fillText('ANOMALY ENGINE', right, 92);
  g.textAlign = 'left';

  // Wordmark. Sized to sit on three lines so it does not crowd the render.
  g.font = '700 62px "Space Grotesk", system-ui, sans-serif';
  g.fillStyle = C.paper;
  g.textAlign = 'right';
  g.fillText('A desktop', right, 288);
  g.fillText('that behaves', right, 358);
  g.fillText('like a place.', right, 428);
  g.textAlign = 'left';

  // Rule, in the phosphor accent, tying the type to the terminal.
  g.fillStyle = C.phosphor;
  g.fillRect(right - 72, 456, 72, 3);

  // Subline.
  g.font = '400 19px Inter, system-ui, sans-serif';
  g.fillStyle = 'rgba(228,233,240,0.74)';
  g.textAlign = 'right';
  g.fillText('Open-source live wallpaper with a quiet observatory', right, 494);
  g.fillText('terminal, and rare things you can explain away.', right, 520);
  g.textAlign = 'left';

  // Feature strip along the bottom, over the render.
  g.font = '500 14px Inter, system-ui, sans-serif';
  const facts = ['6 worlds', '3 art styles', 'per-monitor', 'no third-party art', 'no telemetry'];
  let x = 64;
  for (const f of facts) {
    g.fillStyle = C.phosphorDim;
    g.fillRect(x, H - 52, 6, 6);
    g.fillStyle = 'rgba(228,233,240,0.7)';
    g.fillText(f, x + 14, H - 45);
    x += g.measureText(f).width + 40;
  }

  // Licence, bottom right, small.
  g.font = '400 13px Inter, system-ui, sans-serif';
  g.fillStyle = 'rgba(228,233,240,0.42)';
  g.textAlign = 'right';
  g.fillText('Windows · MIT', right, H - 45);
  g.textAlign = 'left';

  return cv.toDataURL('image/png');
}, { heroUrl, W, H, C });

const preview = Buffer.from(finalUrl.split(',')[1], 'base64');
writeFileSync(resolve(DOCS_IMAGES, 'social-preview.png'), preview);
writeFileSync(resolve(BRANDING, 'social-preview.png'), preview);
console.log(`social-preview.png  ${W}x${H}  ${(preview.length / 1024).toFixed(0)} KB`);
