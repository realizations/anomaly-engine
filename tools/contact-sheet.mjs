import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), '..', 'build', 'preview');

const COLS = [
  { id: 'a-riso', label: 'A - riso print' },
  { id: 'b-flat', label: 'B - flat vector' },
  { id: 'c-painterly', label: 'C - painterly' },
];

const ROWS = [
  { name: 'night', label: 'NIGHT  1:30am' },
  { name: 'golden', label: 'GOLDEN  4:50pm' },
  { name: 'storm', label: 'STORM  3:00pm' },
];

const img = (id, name) => {
  const p = join(OUT, `style-${id}-${name}.png`);
  if (!existsSync(p)) throw new Error(`missing ${p}`);
  return `data:image/png;base64,${readFileSync(p).toString('base64')}`;
};

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#12131a; color:#e8e6e0; font:13px/1.4 "Segoe UI",system-ui,sans-serif; padding:18px; width:1560px; }
  h1 { font-size:15px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#9aa; margin-bottom:14px; }
  .grid { display:grid; grid-template-columns: 96px repeat(3, 1fr); gap:8px; align-items:center; }
  .col { font-size:12px; font-weight:600; letter-spacing:.04em; color:#c9c6bf; padding-bottom:2px; }
  .row { font-size:11px; font-weight:600; letter-spacing:.05em; color:#8d8a84; text-align:right; padding-right:4px; }
  img { width:100%; display:block; border:1px solid #2a2c36; }
</style></head><body>
<h1>Anomaly Engine &mdash; art direction bake-off</h1>
<div class="grid">
  <div></div>
  ${COLS.map((c) => `<div class="col">${c.label}</div>`).join('')}
  ${ROWS.map(
    (r) =>
      `<div class="row">${r.label}</div>` +
      COLS.map((c) => `<img src="${img(c.id, r.name)}">`).join('')
  ).join('')}
</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
await page.setContent(html);
await page.waitForTimeout(600);
await page.screenshot({ path: join(OUT, 'bakeoff-contact-sheet.png'), fullPage: true });
await browser.close();
process.stdout.write('bakeoff-contact-sheet.png\n');
