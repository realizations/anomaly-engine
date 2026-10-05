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
 * ## Why this also measures painterly
 *
 * A threshold is only meaningful if the thing it is thresholding can be on
 * either side of it, and this file previously never established that. It sampled
 * riso, compared against numbers chosen from riso, and called that a check --
 * which would also pass if every style in the engine had become heavily
 * textured, or if the sampling had drifted onto a region that is high contrast
 * for reasons unrelated to printing.
 *
 * So it measures painterly with the identical code and requires painterly to
 * fail the same thresholds. The measured separation is wide enough that this
 * costs nothing in flakiness:
 *
 *   style      sky    ridge   forest  forest range
 *   riso        7.8     3.4     34.4           128
 *   painterly   1.1     0.9      2.2            41
 *   flat        0.9     0.7      2.5            46
 *
 * Every threshold sits between the riso value and both of the others.
 *
 *   node tools/riso-halftone.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');

// Held between what riso measures and what the soft styles measure. See the table
// in the header: the tightest of these is the midtone bar, at 3.4 above and 0.9
// below.
const BARS = [
  { region: 'sky', threshold: 3, above: 'sky keeps a light dot screen' },
  { region: 'ridge', threshold: 2, above: 'mid tones are lightly screened' },
  { region: 'forest', threshold: 20, above: 'shadow masses show a real halftone' },
  { region: 'forestRange', threshold: 60, above: 'shadow masses have tonal range' },
];

// Sampled across several frames.
//
// The stars twinkle and the world drifts, so any single 40x40 sample is a moment
// in an animated scene and its contrast depends on which pixels happened to be
// lit when the readback ran. Sampling over frames and taking the strongest
// result measures the screen's actual texture rather than one frame's luck, and
// it is what stops a load-dependent dip from reading as a regression.
async function measure(browser, style) {
  const page = await browser.newPage({ viewport: { width: 900, height: 506 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(DEPLOYED).href);
  await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });
  await page.evaluate((s) => {
    window.__engine.setWorld('the-town-that-wasnt-there');
    window.__engine.setStyle(s);
    window.__engine.setSimulatedHour(16.8);
  }, style);
  // The separation is cached, so let it print rather than sampling a warm-up frame.
  await page.waitForTimeout(2500);

  const raw = await page.evaluate(async () => {
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
    const best = { sky: { step: 0 }, ridge: { step: 0 }, forest: { step: 0, range: 0 } };
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
    return {
      sky: +best.sky.step.toFixed(1),
      ridge: +best.ridge.step.toFixed(1),
      forest: +best.forest.step.toFixed(1),
      forestRange: Math.round(best.forest.range),
    };
  });
  await page.close();
  return raw;
}

const browser = await chromium.launch();
const riso = await measure(browser, 'riso');
const painterly = await measure(browser, 'painterly');
const flat = await measure(browser, 'flat');
await browser.close();

let failed = 0;
const check = (ok, label, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  -- ${detail}`);
  if (!ok) failed++;
};

console.log(`measured  riso ${JSON.stringify(riso)}  painterly ${JSON.stringify(painterly)}  flat ${JSON.stringify(flat)}\n`);

// The positive side: riso is a print.
for (const bar of BARS) {
  check(riso[bar.region] >= bar.threshold, bar.above, `${bar.region} ${riso[bar.region]} (bar ${bar.threshold})`);
}

// The negative side, which is what makes the bars above mean something. A check
// that only asserts riso is textured cannot tell a halftone from a scene that is
// simply noisy, and would keep passing if the soft styles ever picked up the same
// texture.
for (const [style, m] of [['painterly', painterly], ['flat', flat]]) {
  const over = BARS.filter((bar) => m[bar.region] >= bar.threshold);
  check(
    over.length === 0,
    `${style} is not mistaken for a print`,
    over.length
      ? `${over.map((b) => `${b.region} ${m[b.region]}`).join(', ')} cleared a riso bar`
      : `sky ${m.sky}, ridge ${m.ridge}, forest ${m.forest}, range ${m.forestRange} -- all below their bars`
  );
}

console.log(failed ? `\n${failed} halftone check(s) failed.` : '\nPASS  riso renders a halftone screen, and the soft styles do not.');
process.exit(failed ? 1 : 0);