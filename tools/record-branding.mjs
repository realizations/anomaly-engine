/**
 * Records the generated branding in the asset manifest.
 *
 * The branding is drawn procedurally by tools/make-branding.mjs, so it is
 * first-party work like the rest of the pixel generation. It still needs a
 * manifest record: the licence gate exists precisely to make an undeclared
 * file a build failure, and the first time this was skipped the gate caught
 * twelve undeclared assets, which is the behaviour it is for.
 *
 *   node tools/record-branding.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const f = 'assets/manifest.json';
const m = JSON.parse(readFileSync(f, 'utf8'));

const NOTE_ICON =
  'Icon set, drawn procedurally by tools/make-branding.mjs. The mark is the observatory terminal: a phosphor screen glowing on a horizon, sized so it still reads at 16px in the tray.';
const NOTE_ICO = 'Multi-resolution Windows icon packed by tools/make-branding.mjs from the generated PNG sizes.';

// The gate checks per file rather than per directory, so every generated
// artefact needs its own record. Enumerating them here rather than writing them
// by hand means adding a size to the generator does not silently fail the build.
const BRANDING = [];
if (existsSync('assets/branding')) {
  for (const name of readdirSync('assets/branding').sort()) {
    if (!/\.(png|ico|svg|jpg)$/i.test(name)) continue;
    BRANDING.push({
      path: `assets/branding/${name}`,
      note: name.endsWith('.ico') ? NOTE_ICO
        : name === 'social-preview.png' || name === 'hero-raw.png'
          ? 'Social preview and the uncomposited hero render it is built from, drawn by tools/make-branding.mjs over a real render of the engine.'
          : NOTE_ICON,
    });
  }
}
BRANDING.push({
  path: 'docs/images/social-preview.png',
  note: 'Social preview used by the repository and by GitHub. Composed over a real render by tools/make-branding.mjs so it cannot drift out of date.',
});
if (existsSync('src/Engine/public/favicon.png')) {
  BRANDING.push({
    path: 'src/Engine/public/favicon.png',
    note: '32px mark, copied from the generated set at build time.',
  });
}

const existing = new Set(m.assets.map((a) => a.path));
let added = 0;
for (const b of BRANDING) {
  if (existing.has(b.path)) continue;
  m.assets.push({
    path: b.path,
    license: 'PROPRIETARY-ORIGINAL',
    author: 'Anomaly Engine contributors',
    sourceUrl: 'https://github.com/realizations/anomaly-engine',
    notes: b.note,
  });
  added++;
}

if (added) {
  writeFileSync(f, JSON.stringify(m, null, 2) + '\n', 'utf8');
}
console.log(`${added} branding record(s) added; manifest now lists ${m.assets.length} paths.`);
