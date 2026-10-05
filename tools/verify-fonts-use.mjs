/**
 * Proves the bundled typefaces actually load in the deployed build.
 *
 * Shipping a font file is not the same as the renderer using it. Under file://
 * a font that fails to load falls back silently, and the only way to know is
 * to measure the glyphs: if a family actually applied, its advance widths will
 * differ from the fallback stack's.
 *
 * ## Two different claims, and this checks both
 *
 * The measurement below sets a font on a canvas this script creates, which
 * proves the file is usable: it loads, and its metrics differ from the fallback.
 * That is not the same as the renderer using it, and the difference matters. If
 * someone deleted a `font-family` rule, renamed a family, or repointed a rule at
 * the wrong name, the canvas measurement would carry on passing forever -- it is
 * measuring the font, not the application.
 *
 * So each family is also required to be named somewhere in the deployed
 * application. That is a weaker statement than "the pixels on screen are Plex
 * Mono", and it is the strongest one available cheaply here.
 *
 * "Somewhere" has to mean three places, because the application uses all three
 * and a scan of any one of them alone reports a false failure:
 *
 *   * stylesheet rules -- Space Grotesk on the boot screen
 *   * inline style attributes -- Inter on the field-notes panel, set through
 *     `cssText` when the panel is built rather than by a rule
 *   * canvas `ctx.font` -- Plex Mono on the terminal readout and the overlays,
 *     which are drawn to a canvas and are therefore invisible to the DOM
 *
 * The first version of this scan walked stylesheet rules only, and it confidently
 * reported that Inter was shipped but never applied. Inter is applied, on the
 * one surface that carries prose, and the scan missed it because that surface
 * sets its font inline. A check that has only ever agreed with the product is not
 * evidence that it works.
 *
 *   node tools/verify-fonts-use.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

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

// Where does the application ask for each family? Three sources, all needed -- see
// the header. The DOM is scanned live rather than read off disk, because the
// deployed bundle and its document are what ship.
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);
// Values that appear in font stacks but are not families. Canvas draws are written
// as `ctx.font = \`${h}px 'Plex Mono', monospace\`` and the capture below sees the
// template's interior, so text-alignment keywords turn up in the same sweep.
const NOT_A_FAMILY = new Set([
  'top', 'middle', 'bottom', 'center', 'left', 'right', 'start', 'end', 'baseline',
  'text-top', 'text-bottom', 'alphabetic', 'ideographic', 'hanging', 'central',
  'uppercase', 'lowercase', 'capitalize', 'small-caps', 'underline', 'bolder',
  'lighter', 'italic', 'oblique', 'normal',
]);

/**
 * Pulls family names out of a CSS font declaration value.
 *
 * Two shapes need handling. An explicit list quotes its names -- `'Plex Mono',
 * monospace` -- so those are read straight out of the quotes and never guessed at.
 * The `font` shorthand does not, and leads with a size and usually a line-height:
 * `13px/1.72 'Inter', 'Segoe UI', sans-serif`. Splitting that on commas leaves
 * `13px / 1.72 Inter` in the first piece, which is why the leading size, the
 * optional `/ line-height` and the leading style or weight are all stripped before
 * the remainder is treated as a family.
 *
 * Anything still carrying a template placeholder or a brace is an interpolated
 * size rather than a name -- `${h}px` is a font size in the minified bundle, and
 * reading it as a family would put nonsense in the report.
 *
 * Everything here is done in Node on raw declaration text collected from the page,
 * so there is one implementation of it rather than one per context.
 */
function familyNames(value) {
  const out = [];
  // A minified `ctx.font` assignment is a template literal. Drop its opening
  // backtick -- exactly that one character, because stripping quotes from both
  // ends instead would unquote the first family in an ordinary `'A', 'B', sans-serif`
  // list and lose it -- and then cut at the closing backtick, which is where the
  // declaration ends and unrelated code begins.
  let clean = value.startsWith('`') ? value.slice(1) : value;
  const closing = clean.indexOf('`');
  if (closing >= 0) clean = clean.slice(0, closing);
  for (const m of clean.matchAll(/['"`]([^'"`]+)['"`]/g)) {
    const name = m[1].trim();
    if (name && !GENERIC.has(name) && !NOT_A_FAMILY.has(name) && !/[${}]/.test(name)) out.push(name);
  }
  for (const part of clean.split(',')) {
    let p = part.trim();
    if (/['"`]/.test(p)) continue;
    p = p.replace(/^[\d.]+\s*(?:px|pt|em|rem|%)?\s*(?:\/\s*[\d.]+\s*)?/, '');
    p = p.replace(/^(?:normal|bold|italic|oblique|\d{3})\s+/, '');
    if (p && !GENERIC.has(p) && !NOT_A_FAMILY.has(p) && !/[${}]/.test(p) && !/^\d/.test(p)) out.push(p);
  }
  return out;
}

// The field-notes panel is the surface that carries prose, and it is only in the
// DOM while it is open, so it is opened before the inline styles are read. Without
// this the one surface that applies Inter is invisible to the scan and the check
// quietly degrades into "the face is declared", which is the weaker claim this
// tool exists to avoid.
await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:notes')));
await page.waitForTimeout(1200);
const panelOpen = await page.evaluate(() => !!document.querySelector('[style*="Inter"]'));

const raw = await page.evaluate(() => {
  // Rule type 5 is CSSRule.FONT_FACE_RULE. Those declare a family; they do not ask
  // for one, and counting them would make this check pass on a build where the
  // application stopped using the family entirely.
  const declared = [];
  const usage = [];
  const inline = [];
  let unreadable = 0;

  for (const sheet of document.styleSheets) {
    let list;
    try {
      list = [...sheet.cssRules];
    } catch {
      // A stylesheet from another origin under file:// is unreadable by design.
      unreadable++;
      continue;
    }
    for (const rule of list) {
      if (rule.type === 5) {
        const m = /font-family\s*:\s*([^;}]+)/.exec(rule.cssText || '');
        if (m) declared.push(m[1]);
      } else if (rule.style && rule.style.fontFamily) {
        usage.push(rule.style.fontFamily);
      }
    }
  }

  // Inline style attributes, including `cssText`, which is how the field-notes
  // panel sets its type.
  for (const el of document.querySelectorAll('[style]')) {
    const cssText = el.getAttribute('style') || '';
    const m = /font(?:-family)?\s*:\s*([^;}]+)/.exec(cssText);
    if (m) inline.push(m[1]);
  }

  return { declared, usage, inline, unreadable };
});

await page.evaluate(() => window.dispatchEvent(new CustomEvent('anomaly:notes')));

// Canvas text is not in the DOM at all, so the deployed bundle is read off disk
// rather than fetched from the page: the document's own content security policy
// sets `connect-src 'none'`, so a fetch of the bundle returns nothing at all and
// the scan would report no canvas fonts without ever saying so.
const rendererDir = dirname(DEPLOYED);
const documentHtml = readFileSync(DEPLOYED, 'utf8');
const scriptSrc = /<script[^>]+src="\.\/([^"]+)"/.exec(documentHtml);
const bundlePath = scriptSrc ? resolve(rendererDir, scriptSrc[1]) : null;
const bundleText = bundlePath && existsSync(bundlePath) ? readFileSync(bundlePath, 'utf8') : '';

// The capture stops at a semicolon and is bounded, and familyNames cuts it at the
// template's closing backtick. Excluding backticks from the pattern itself does not
// work: the character right after `ctx.font =` *is* the opening backtick, so the
// capture would match nothing at all and report no canvas fonts while looking
// confident about it.
const canvasDecls = [...bundleText.matchAll(/\.font\s*=\s*([^;\n]{0,120})/g)].map((m) => m[1]);

const setsOf = (decls) => [...new Set(decls.flatMap(familyNames))];
const fromRules = new Set(setsOf(raw.usage));
const fromInline = new Set(setsOf(raw.inline));
const fromCanvas = new Set(setsOf(canvasDecls));

const usedBy = (name) => {
  const where = [];
  if (fromRules.has(name)) where.push('css rule');
  if (fromInline.has(name)) where.push('inline style');
  if (fromCanvas.has(name)) where.push('canvas ctx.font');
  return where;
};

console.log(`\nFamilies the deployed application asks for`);
console.log(`  css rule usage   : ${[...fromRules].join(', ') || '(none)'}`);
console.log(`  inline styles    : ${[...fromInline].join(', ') || '(none)'}`);
console.log(`  canvas ctx.font  : ${[...fromCanvas].join(', ') || '(none)'}`);
console.log(`  declared only    : ${setsOf(raw.declared).join(', ') || '(none)'}   (@font-face, not usage)`);
if (raw.unreadable) console.log(`  ${raw.unreadable} stylesheet(s) unreadable under file://`);
if (!bundleText) console.log('  WARNING  the renderer bundle could not be read, so canvas fonts were not observable');
if (!panelOpen) console.log('  WARNING  the field-notes panel did not open, so inline styles were not observable');

console.log('');
console.log('family               used by          loaded   width   fallback width   applied');
console.log('--------------------------------------------------------------------------------------');
for (const { css, fallback, weight } of FAMILIES) {
  const name = css.replace(/'/g, '');
  const where = usedBy(name);
  const inApp = where.length > 0;
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
  // Three things have to hold, and each one alone would miss a real failure: a
  // file can load and still be overridden by a rule that no longer names it, a
  // family can measure differently while silently falling back, and a rule can
  // name a family whose file was never shipped.
  const ok = inApp && r.isLoaded && Math.abs(r.a - r.b) > 0.5;
  if (!ok) failures++;
  const why = [];
  if (!inApp) why.push('not referenced by the application');
  if (!r.isLoaded) why.push('face did not load');
  if (Math.abs(r.a - r.b) <= 0.5) why.push('metrics match the fallback');
  console.log(
    `${css.padEnd(20)} ${(where.join(', ') || 'NONE').padEnd(17)} ${(r.isLoaded ? 'yes' : 'NO ').padStart(6)}`
    + `   ${r.a.toFixed(1).padStart(6)}   ${r.b.toFixed(1).padStart(14)}   ${ok ? 'yes' : `NO  <-- ${why.join('; ')}`}`
  );
}

await browser.close();

if (failures) {
  console.error(`\nFAIL  ${failures} declared family/families are not actually being applied.`);
  process.exit(1);
}
console.log('\nPASS  every declared family is referenced by the application, loads, and is measurably distinct from its fallback.');
