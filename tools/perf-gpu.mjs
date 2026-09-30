/**
 * Measures renderer cost on the real GPU, not just on the CPU.
 *
 * The other performance tooling runs headless Chromium with no GPU flags, so it
 * rasterises through SwiftShader on the CPU. That is a useful floor and a
 * reasonable proxy for relative cost, but it badly understates the shipped
 * application, which composites through WebView2 on the GPU. Reporting only the
 * CPU number makes a renderer that is genuinely fast look marginal.
 *
 * This launches with hardware acceleration and reports the engine's own per-frame
 * work, which is the figure that matters. It deliberately does NOT report fps as
 * a performance claim: in headless mode frames are paced by the compositor at
 * roughly 25 Hz regardless of how fast the renderer is, so fps measures the
 * harness. frameMs measures the engine.
 *
 *   node tools/perf-gpu.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');
const HW_ARGS = ['--use-angle=gl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];

async function measure(label, args) {
  const browser = await chromium.launch({ args, headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(pathToFileURL(DEPLOYED).href);
  await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });

  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl');
    if (!gl) return 'no webgl';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  });

  await page.evaluate(() => {
    window.__engine.setWorld('the-town-that-wasnt-there');
    window.__engine.setStyle('painterly');
  });
  // Let adaptive quality settle, since the whole point is to observe what it
  // settles on rather than what the first frame costs.
  await page.waitForTimeout(6000);

  // Sampled over time, not read once.
  //
  // A single reading of a shared machine is whatever else happened to be running.
  // The same scene on this hardware has measured between 3 and 10 ms depending on
  // background load, and a gate that fails on the bad end of that is a gate people
  // learn to ignore. The median of a spread of samples is the number that
  // describes the renderer; a genuine regression moves the whole distribution.
  const samples = [];
  for (let i = 0; i < 7; i++) {
    await page.waitForTimeout(400);
    samples.push(await page.evaluate(() => window.__engine.getStatus().frameMs));
  }
  samples.sort((a, b) => a - b);
  const s = await page.evaluate(() => {
    const st = window.__engine.getStatus();
    return { fps: st.fps, scale: st.renderScale };
  });
  await browser.close();
  return {
    label,
    gpu,
    fps: s.fps,
    scale: s.scale,
    frameMs: samples[Math.floor(samples.length / 2)],
    worstFrameMs: samples[samples.length - 1],
    samples,
  };
}

const hardware = await measure('hardware', HW_ARGS);
const cpu = await measure('swiftshader', []);

console.log(`hardware renderer: ${hardware.gpu}`);
console.log(`  fps (pacing-bound, not a perf claim): ${hardware.fps}`);
console.log(`  engine frame ms (median of ${hardware.samples.length}): ${hardware.frameMs}  [${hardware.samples.join(', ')}]`);
console.log(`  render scale:    ${hardware.scale}`);
console.log(`\ncpu (SwiftShader) renderer: ${cpu.gpu}`);
console.log(`  fps (pacing-bound, not a perf claim): ${cpu.fps}`);
console.log(`  engine frame ms (median of ${cpu.samples.length}): ${cpu.frameMs}  [${cpu.samples.join(', ')}]`);
console.log(`  render scale:    ${cpu.scale}`);

let failed = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  -- ${detail}`);
  if (!ok) failed++;
};

// A real GPU must actually be in use, or these figures say nothing about the
// shipped path and the run should not be reported as a hardware measurement.
check(!/swiftshader/i.test(hardware.gpu), 'hardware rasterisation is in use', hardware.gpu);

// 60 Hz leaves 16.7 ms. The bar is the whole budget rather than half of it, so
// this fails when the renderer stops leaving room for the desktop compositor and
// other applications sharing the same GPU, and does not fail when the machine
// happens to be busy. It would not have caught the 3 ms case on its own; the
// point is to catch a regression, not to certify a benchmark.
check(hardware.frameMs < 16.7, 'engine work fits inside the 60 Hz frame budget',
  `median ${hardware.frameMs} ms of 16.7 ms (worst sample ${hardware.worstFrameMs} ms)`);

// The adaptive controller has to actually respond to load, or a machine without
// a usable GPU gets a slideshow instead of a scaled-down wallpaper.
check(cpu.scale < 1, 'adaptive quality reduces scale when frames overrun budget',
  `scale ${cpu.scale} at ${cpu.frameMs} ms`);

console.log(failed ? `\n${failed} GPU check(s) failed.` : '\nPASS  renderer performance is healthy on this machine.');
process.exit(failed ? 1 : 0);
