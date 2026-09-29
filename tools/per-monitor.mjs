/**
 * Verifies per-monitor rendering.
 *
 * The renderer composes the scene once per display and blits each into its own
 * rectangle on a canvas the size of the whole virtual desktop, so every monitor
 * gets its own composition rather than a crop of one very wide panorama.
 *
 * The check that matters is that every monitor rectangle ends up with actual
 * painted content, and that a monitor with a negative origin — one placed to
 * the left of the primary — still lands in the right place after the virtual
 * desktop is re-based onto a zero origin.
 *
 *   node tools/per-monitor.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');

const CASES = [
  {
    name: 'single monitor',
    monitors: [{ x: 0, y: 0, w: 1280, h: 720 }],
    expectCanvas: [1280, 720],
  },
  {
    name: 'two side by side, 16:9',
    monitors: [{ x: 0, y: 0, w: 1920, h: 1080 }, { x: 1920, y: 0, w: 1920, h: 1080 }],
    expectCanvas: [3840, 1080],
  },
  {
    name: 'secondary to the left (negative origin)',
    monitors: [{ x: 0, y: 0, w: 1920, h: 1080 }, { x: -1280, y: 0, w: 1280, h: 1024 }],
    expectCanvas: [3200, 1080],
  },
  {
    name: 'stacked vertically, mixed sizes',
    monitors: [{ x: 0, y: 0, w: 2560, h: 1440 }, { x: 0, y: 1440, w: 1280, h: 720 }],
    expectCanvas: [2560, 2160],
  },
  {
    name: 'three monitors in an L',
    monitors: [
      { x: 0, y: 0, w: 1920, h: 1080 },
      { x: 1920, y: 0, w: 1280, h: 1024 },
      { x: 0, y: 1080, w: 1280, h: 1024 },
    ],
    expectCanvas: [3200, 2104],
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failures++;
};

for (const c of CASES) {
  console.log(c.name);

  const r = await page.evaluate(async (monitors) => {
    // Daylight. A night sky is legitimately dark, so "dark" cannot be used as
    // evidence that a monitor failed to paint. At noon every surface is lit and
    // an unpainted rectangle is unambiguous.
    window.__engine.setSimulatedHour(12.0);
    window.dispatchEvent(new CustomEvent('anomaly:monitors', { detail: { monitors } }));
    // Poll for the viewport count rather than sleeping: a fixed wait is
    // asserting on the clock, and goes flaky when the machine is busy.
    await new Promise((resolve) => {
      const deadline = performance.now() + 8000;
      const tick = () => {
        if (window.__engine.getViewportCount() === monitors.length || performance.now() > deadline) {
          resolve();
        } else {
          requestAnimationFrame(tick);
        }
      };
      tick();
    });
    // Two more frames so the compose has actually landed.
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = document.getElementById('wallpaper-canvas');
    const g = cv.getContext('2d');
    const dpr = cv.width / parseFloat(cv.style.width || String(cv.width));

    // Re-derive the rebased rectangles exactly as the renderer does, so the
    // samples land inside the canvas. Probing pre-rebase coordinates for a
    // negative-origin display would read off the edge and report a false
    // failure, which is what the first version of this check did.
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of monitors) {
      minX = Math.min(minX, m.x); minY = Math.min(minY, m.y);
      maxX = Math.max(maxX, m.x + m.w); maxY = Math.max(maxY, m.y + m.h);
    }
    const rects = monitors.map((m) => ({ x: m.x - minX, y: m.y - minY, w: m.w, h: m.h }));

    // Sample a grid over each rectangle and report its brightest point plus a
    // cheap signature of its content, so two monitors can be compared.
    const sampleRect = (r) => {
      const cols = 6, rows = 4;
      let peak = 0;
      let sum = 0;
      const sig = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const fx = r.x + (r.w * (i + 0.5)) / cols;
          const fy = r.y + (r.h * (j + 0.5)) / rows;
          const px = Math.max(0, Math.min(cv.width - 1, Math.round(fx * dpr)));
          const py = Math.max(0, Math.min(cv.height - 1, Math.round(fy * dpr)));
          const d = g.getImageData(px, py, 1, 1).data;
          const lum = d[0] * 0.299 + d[1] * 0.587 + d[2] * 0.114;
          if (lum > peak) peak = lum;
          sum += lum;
          sig.push(Math.round(lum));
        }
      }
      return { peak, mean: sum / (cols * rows), sig: sig.join(',') };
    };

    return {
      canvasW: cv.width,
      canvasH: cv.height,
      viewportCount: window.__engine.getViewportCount(),
      rects: rects.map(sampleRect),
    };
  }, c.monitors);

  check(
    r.canvasW === c.expectCanvas[0] && r.canvasH === c.expectCanvas[1],
    'canvas covers the virtual desktop',
    `${r.canvasW}x${r.canvasH}, expected ${c.expectCanvas[0]}x${c.expectCanvas[1]}`
  );
  check(
    r.viewportCount === c.monitors.length,
    'one viewport per monitor',
    `${r.viewportCount} of ${c.monitors.length}`
  );
  r.rects.forEach((rect, i) => {
    // The clear colour is #05060f, about 6 in luminance. At noon a painted
    // landscape peaks far above that.
    check(
      rect.peak > 40,
      `monitor ${i + 1} is painted`,
      `peak ${rect.peak.toFixed(0)}, mean ${rect.mean.toFixed(0)}`
    );
  });

  // The decisive check for per-monitor composition.
  //
  // If the renderer stretched one wide composition across the desktop, a second
  // identical monitor would receive a *different* slice of it, so the two would
  // not match. Composing each monitor independently means two monitors of the
  // same size come out identical, and monitors of different sizes come out
  // different. Getting this backwards is what made the first version of this
  // check fail.
  if (r.rects.length > 1) {
    const sizes = c.monitors.map((m) => `${m.w}x${m.h}`);
    const allSameSize = sizes.every((s) => s === sizes[0]);
    const distinct = new Set(r.rects.map((x) => x.sig)).size;

    if (allSameSize) {
      check(
        distinct === 1,
        'identical monitors are composed identically, not cropped from one panorama',
        `${distinct} distinct of ${r.rects.length}`
      );
    } else {
      check(
        distinct > 1,
        'differently shaped monitors are framed independently',
        `${distinct} distinct of ${r.rects.length}`
      );
    }
  }
  console.log('');
}

await browser.close();

if (failures) {
  console.error(`FAIL  ${failures} per-monitor check(s) failed.`);
  process.exit(1);
}
console.log('PASS  every layout composed correctly on every monitor.');
