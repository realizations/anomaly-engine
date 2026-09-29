/**
 * Proves the bundled typefaces actually load in the deployed build.
 *
 * Shipping a font file is not the same as the renderer using it. Under file://
 * a font that fails to load falls back silently, and the only way to know is
 * to measure the glyphs: if a family actually applied, its advance widths will
 * differ from the fallback stack's.
 *
 *   node tools/verify-fonts-use.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DEPLOYED = resolve(here, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');

const FAMILIES = [
  { css: "'Plex Mono'", fallback: 'monospace', weight: 400 },
  { css: "'Inter'", fallback: 'sans-serif', weight: 400 },
  { css: "'Space Grotesk'", fallback: 'sans-serif', weight: 700 },
];

/** Measure the width of a distinctive string in two fonts. */
const PROBE = 'HAMBURGEFONTSIV 0123456789';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(pathToFileURL(DEPLOYED).href);
await page.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });

// Wait for the faces themselves, not just document.fonts.
const loaded = await page.evaluate(async () => {
  await document.fonts.ready;
  const names = [];
  document.fonts.forEach((f) => names.push(`${f.family}/${f.weight}/${f.status}`));
  return names;
});

console.log('Declared faces:');
for (const n of loaded) console.log(`  ${n}`);

let failures = 0;
console.log('');
console.log('family               loaded   width   fallback width   distinct');
console.log('-------------------------------------------------------------');
for (const { css, fallback, weight } of FAMILIES) {
  const r = await page.evaluate(
    async ({ css, fallback, probe, weight }) => {
      // Force the face to load before measuring. Without this a family that is
      // declared but only used on a later screen (the field notes overlay) would
      // report as "not applied" when in fact it was simply never requested yet.
      const faces = await document.fonts.load(`${weight} 64px ${css}`);
      const isLoaded = faces.length > 0 && faces.every((f) => f.status === 'loaded');

      const c = document.createElement('canvas');
      const g = c.getContext('2d');
      g.font = `${weight} 64px ${css}, ${fallback}`;
      const a = g.measureText(probe).width;
      g.font = `${weight} 64px ${fallback}`;
      const b = g.measureText(probe).width;
      return { a, b, isLoaded };
    },
    { css, fallback, probe: PROBE, weight }
  );
  // A face is verified only if it both loaded and actually changed the metrics.
  // Either one alone is not enough: a file can load and still be overridden, and
  // a family can measure differently while silently falling back.
  const ok = r.isLoaded && Math.abs(r.a - r.b) > 0.5;
  if (!ok) failures++;
  console.log(
    `${css.padEnd(20)} ${(r.isLoaded ? 'yes' : 'NO ').padStart(7)}   ${r.a.toFixed(1).padStart(6)}`
    + `   ${r.b.toFixed(1).padStart(14)}   ${ok ? 'yes' : 'NO  <-- not applied'}`
  );
}

await browser.close();

if (failures) {
  console.error(`\nFAIL  ${failures} declared family/families are not actually being applied.`);
  process.exit(1);
}
console.log('\nPASS  every declared family is applied and measurably distinct from its fallback.');
