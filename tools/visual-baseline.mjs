/**
 * Proves the three art directions stay distinct from one another.
 *
 * This exists because they previously did not. An earlier direction implementation
 * was three filters over one picture, which produced three tints of the same
 * image: all three rendered, all three looked plausible, and nothing said so. The
 * fix was to make each direction compositional rather than a grade, and this is
 * the check that would catch it happening again.
 *
 *   node tools/visual-baseline.mjs
 *
 * ## How distinctness is measured, and why not a hash
 *
 * The obvious test is to hash each render and require the hashes to differ. It is
 * worthless here, and worse than worthless, because it passes for the wrong
 * reason. Every frame in this engine has grass, cloud, rain and stars moving, so
 * two renders of the *same* direction taken a second apart have different hashes
 * already. The previous version of this file did exactly that, and then printed
 * "directions distinct: yes" without ever using the answer to fail the run. There
 * was no exit path in the file at all: it could report a non-answer and verify.mjs
 * would record a pass.
 *
 * So distinctness is measured on a coarse luminance signature instead -- a 32x18
 * grid of mean luma per cell. Animation perturbs that by about 0.5; two genuinely
 * different directions differ by at least 2.9, and the same direction at two times
 * of day differs by about 47. The threshold sits at 1.5, which is far enough above
 * the animation floor to be safe and far enough below the smallest real difference
 * to be honest about what it can resolve.
 *
 * Hashes are still recorded, in the manifest, because they are what makes two
 * archived baselines comparable by eye and by `diff`. They are simply not what
 * the verdict is made of.
 */
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const D = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');
const OUT = resolve(HERE, '../build/visual-baseline');
mkdirSync(OUT, { recursive: true });

// Above the animation floor (~0.5) and below the smallest real difference between
// two directions (~2.9). See the header.
const DISTINCT = 1.5;
// The same direction at night and at golden hour differs by about 47, so this only
// has to catch the harness forgetting to apply the hour at all.
const TIME_MATTERS = 8;

const GRID_X = 32;
const GRID_Y = 18;

/** Mean absolute difference between two signatures. */
function divergence(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

const b = await chromium.launch();
const results = [];
const dirs = ['depth', 'atmospheric', 'darker'];
const times = [['night', 21.5], ['golden', 17.2]];

for (const d of dirs) {
  for (const [t, h] of times) {
    const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    await p.goto(pathToFileURL(D).href);
    await p.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });
    await p.evaluate(([dir, hour]) => {
      window.__engine.setWorld('the-town-that-wasnt-there');
      window.__engine.setStyle('painterly');
      window.__engine.setDirection(dir);
      window.__engine.setSimulatedHour(hour);
      window.__engine.setSimulatedWeather('clear');
    }, [d, h]);
    await p.waitForTimeout(700);
    const { luma, signature } = await p.evaluate(
      ({ gx, gy }) => {
        const canvas = document.getElementById('wallpaper-canvas');
        const g = canvas.getContext('2d');
        const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < px.length; i += 16) {
          sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
          n++;
        }
        // Every fourth pixel in each direction within a cell: enough to average out
        // the halftone and the grass, cheap enough to be irrelevant.
        const sig = [];
        for (let cy = 0; cy < gy; cy++) {
          for (let cx = 0; cx < gx; cx++) {
            let s = 0;
            let c = 0;
            const x0 = Math.floor((cx * canvas.width) / gx);
            const x1 = Math.floor(((cx + 1) * canvas.width) / gx);
            const y0 = Math.floor((cy * canvas.height) / gy);
            const y1 = Math.floor(((cy + 1) * canvas.height) / gy);
            for (let y = y0; y < y1; y += 4) {
              for (let x = x0; x < x1; x += 4) {
                const i = (y * canvas.width + x) * 4;
                s += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
                c++;
              }
            }
            sig.push(s / c);
          }
        }
        return { luma: sum / n, signature: sig };
      },
      { gx: GRID_X, gy: GRID_Y }
    );
    const url = await p.evaluate(() => document.getElementById('wallpaper-canvas').toDataURL());
    const buf = Buffer.from(url.split(',')[1], 'base64');
    const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    writeFileSync(resolve(OUT, `${d}-${t}.png`), buf);
    results.push({
      direction: d,
      time: t,
      hour: h,
      meanLuma: Math.round(luma * 10) / 10,
      signature,
      sha,
    });
    await p.close();
  }
}
await b.close();

writeFileSync(
  resolve(OUT, 'manifest.json'),
  JSON.stringify(results.map(({ signature, ...rest }) => rest), null, 2)
);

const at = (d, t) => results.find((r) => r.direction === d && r.time === t).signature;

const failures = [];

for (const [t] of times) {
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      const div = divergence(at(dirs[i], t), at(dirs[j], t));
      if (div < DISTINCT) {
        failures.push(
          `directions converged at ${t}: ${dirs[i]} and ${dirs[j]} differ by only ` +
            `${div.toFixed(2)} (threshold ${DISTINCT}, animation floor ~0.5)`
        );
      }
    }
  }
}

for (const d of dirs) {
  const div = divergence(at(d, 'night'), at(d, 'golden'));
  if (div < TIME_MATTERS) {
    failures.push(`${d} looks the same at night and at golden hour (${div.toFixed(2)}) -- the hour is not being applied`);
  }
}

const unique = new Set(results.map((r) => r.sha));
console.log(`captured ${results.length} baselines, ${unique.size} unique fingerprints`);
for (const r of results) {
  console.log(`  ${r.direction.padEnd(12)} ${r.time.padEnd(7)} luma ${String(r.meanLuma).padStart(6)}  ${r.sha}`);
}
for (const [t] of times) {
  const pairs = [];
  for (let i = 0; i < dirs.length; i++) {
    for (let j = i + 1; j < dirs.length; j++) {
      pairs.push(`${dirs[i]}/${dirs[j]} ${divergence(at(dirs[i], t), at(dirs[j], t)).toFixed(2)}`);
    }
  }
  console.log(`  ${t.padEnd(7)} divergence: ${pairs.join('  ')}`);
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL  ${f}`);
  console.error(`\n${failures.length} distinctness check(s) failed.`);
  process.exit(1);
}

console.log(`\nPASS  the three directions stay distinct at both times of day. Images in ${OUT}`);
