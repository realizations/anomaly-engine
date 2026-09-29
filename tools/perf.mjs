/**
 * Measures the renderer's real frame cost against the deployed file:// build.
 *
 * This exists because the performance problem in this engine was invisible to
 * every other check: the suite passed, the build was clean, and the stills
 * looked right while riso ran at seven frames a second. Performance claims in
 * this repository are expected to come from running this, not from estimating.
 *
 * IMPORTANT — how to read the output. Headless Chromium rasterises on the CPU
 * through SwiftShader, so every full-screen composite is roughly two orders of
 * magnitude more expensive here than on the GPU-composited WebView2 the app
 * actually ships in. The useful signal from this tool is therefore cost *per
 * pixel*: it is stable across resolutions precisely when the renderer is
 * fill-rate bound, and it is the number to watch when a change adds a
 * full-screen pass. Raw fps in this environment is a floor, not a forecast.
 *
 *   node tools/perf.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(here, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');

const STYLES = ['painterly', 'flat', 'riso'];
const SIZES = [[1280, 720], [1920, 1080]];
/** Let the adaptive scaler settle before sampling. */
const SETTLE_MS = 3000;

const browser = await chromium.launch();

console.log('CPU-rasterised (SwiftShader). Cost per pixel is the meaningful figure.');
console.log('');

const worst = { nsPerPx: 0, style: '', label: '' };
for (const [WIDTH, HEIGHT] of SIZES) {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT } });
  await page.goto(pathToFileURL(DEPLOYED).href);
  await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });

  console.log(`${WIDTH}x${HEIGHT}`);
  console.log('  style          fps   frame ms   ns/px   render scale');
  console.log('  ------------------------------------------------');

  for (const style of STYLES) {
    const status = await page.evaluate(
      async ([s, settle]) => {
        window.__engine.setStyle(s);
        await new Promise((r) => setTimeout(r, settle));
        return window.__engine.getStatus();
      },
      [style, SETTLE_MS]
    );
    const nsPerPx = (status.frameMs * 1e6) / (WIDTH * HEIGHT);
    console.log(
      `  ${style.padEnd(12)} ${String(Math.round(status.fps)).padStart(4)}`
      + `   ${status.frameMs.toFixed(1).padStart(7)}`
      + `   ${nsPerPx.toFixed(0).padStart(5)}`
      + `   ${String(status.renderScale).padStart(6)}`
    );
    if (nsPerPx > worst.nsPerPx) {
      worst.nsPerPx = nsPerPx;
      worst.style = style;
      worst.label = `${WIDTH}x${HEIGHT}`;
    }
  }
  console.log('');
  await page.close();
}

await browser.close();

console.log(`Worst case: ${worst.style} at ${worst.label}, ${worst.nsPerPx.toFixed(0)} ns/pixel.`);

// The gate is the per-pixel cost, because that is what actually predicts GPU
// performance, plus a check that the adaptive scaler still protects slow
// hardware. A fixed fps threshold here would only measure SwiftShader.
if (worst.nsPerPx > 140) {
  console.error('FAIL  per-pixel cost is above budget; a full-screen pass has probably been added.');
  process.exit(1);
}
console.log('PASS  within the per-pixel budget for software rasterisation.');
