/**
 * Checks that the riso style actually renders a halftone.
 *
 * Riso can fail quietly. The separation runs, the frame looks like a print,
 * and every test passes, while the dot screen is so small and so low contrast
 * that it reads as a slightly desaturated photograph. Nothing about that is
 * detectable by looking at whether it rendered.
 *
 * It is detectable by measuring. A halftone alternates ink and paper every few
 * pixels, so the mean absolute luminance step between horizontally adjacent
 * pixels is high. A flat wash has almost none. This checks the shadow areas,
 * where a riso is at its darkest and where the screen has to be unmistakable,
 * and fails if the pattern has collapsed.
 *
 *   node tools/riso-halftone.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 506 } });
await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });
await page.evaluate(() => {
  window.__engine.setWorld('the-town-that-wasnt-there');
  window.__engine.setStyle('riso');
  window.__engine.setSimulatedHour(16.8);
});
// The separation is cached, so let it print rather than sampling a warm-up frame.
await page.waitForTimeout(2500);

// Sampled across several frames.
//
// The stars twinkle and the world drifts, so any single 40x40 sample is a moment
// in an animated scene and its contrast depends on which pixels happened to be
// lit when the readback ran. Sampling over frames and taking the strongest
// result measures the screen's actual texture rather than one frame's luck, and
// it is what stops a load-dependent dip from reading as a regression.
const r = await page.evaluate(async () => {
  const at = (fx, fy) => {
    const cv = document.getElementById('wallpaper-canvas');
    const d = cv.getContext('2d').getImageData(
      Math.round(cv.width * fx), Math.round(cv.height * fy), 40, 40).data;
    let step = 0, cnt = 0, min = 255, max = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      if (l < min) min = l;
      if (l > max) max = l;
    }
    for (let row = 0; row < 40; row++) {
      for (let col = 0; col < 39; col++) {
        const a = (row * 40 + col) * 4;
        step += Math.abs(d[a] - d[a + 4]);
        cnt++;
      }
    }
    return { step: step / cnt, range: max - min };
  };
  const best = { sky: { step: 0, range: 0 }, ridge: { step: 0, range: 0 }, forest: { step: 0, range: 0 } };
  for (let k = 0; k < 6; k++) {
    const s = at(0.55, 0.1);
    const g = at(0.55, 0.32);
    const f = at(0.55, 0.7);
    best.sky.step = Math.max(best.sky.step, s.step);
    best.ridge.step = Math.max(best.ridge.step, g.step);
    best.forest.step = Math.max(best.forest.step, f.step);
    best.forest.range = Math.max(best.forest.range, f.range);
    await new Promise((res) => requestAnimationFrame(() => res()));
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) =>
    [k, { step: +v.step.toFixed(1), range: Math.round(v.range) }]));
  return round(best);
});
await browser.close();

let failed = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  -- ${detail}`);
  if (!ok) failed++;
};

// The sky is mostly bare paper by design, so it is held to a low bar: some
// texture must survive, but it is not meant to be a dense screen.
check(r.sky.step >= 3, 'sky keeps a light dot screen', `step ${r.sky.step}`);
// The shadow masses are where riso has to be unmistakably a print.
check(r.forest.step >= 20, 'shadow masses show a real halftone', `step ${r.forest.step}`);
check(r.forest.range >= 60, 'shadow masses have tonal range', `range ${r.forest.range}`);
// Midtones are meant to sit lightly. A heavy midtone is the print reading as a
// tinted photograph, which is the failure this whole check exists to catch.
check(r.ridge.step >= 2, 'mid tones are lightly screened', `step ${r.ridge.step}`);

console.log(failed ? `\n${failed} halftone check(s) failed.` : '\nPASS  riso renders a halftone screen.');
process.exit(failed ? 1 : 0);
