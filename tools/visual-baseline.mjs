import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const D = resolve(HERE, '../src/AnomalyEngine/bin/Debug/net8.0-windows/renderer/index.html');
const OUT = resolve(HERE, '../build/visual-baseline');
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch();
const results = [];
const dirs = ['depth', 'atmospheric', 'darker'];
const times = [['night', 21.5], ['golden', 17.2]];
for (const d of dirs) for (const [t, h] of times) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.goto(pathToFileURL(D).href);
  await p.waitForFunction(() => window.__engine !== undefined, { timeout: 20000 });
  await p.evaluate(([d, h]) => {
    window.__engine.setWorld('the-town-that-wasnt-there');
    window.__engine.setStyle('painterly');
    window.__engine.setDirection(d);
    window.__engine.setSimulatedHour(h);
  }, [d, h]);
  await p.waitForTimeout(700);
  const luma = await p.evaluate(() => {
    const g = document.getElementById('wallpaper-canvas').getContext('2d');
    const d = g.getImageData(0, 0, 1280, 720).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += 0.2126*d[i]+0.7152*d[i+1]+0.0722*d[i+2]; n++; }
    return s / n;
  });
  const url = await p.evaluate(() => document.getElementById('wallpaper-canvas').toDataURL());
  const buf = Buffer.from(url.split(',')[1], 'base64');
  const sha = createHash('sha256').update(buf).digest('hex').slice(0, 16);
  writeFileSync(resolve(OUT, `${d}-${t}.png`), buf);
  results.push({ direction: d, time: t, meanLuma: Math.round(luma*10)/10, sha });
  await p.close();
}
await b.close();

writeFileSync(resolve(OUT, 'manifest.json'), JSON.stringify(results, null, 2));
const uniq = new Set(results.map(r => r.sha));
// The three directions must produce distinct renders; identical hashes would mean
// the direction switch did not take.
const sameTimeDistinct = dirs.slice(1).every((d, i) => results.find(r=>r.direction===d && r.time==='night').sha !== results.find(r=>r.direction==='depth' && r.time==='night').sha);
console.log(`captured ${results.length} baselines, ${uniq.size} unique fingerprints`);
console.log(`directions distinct: ${sameTimeDistinct ? 'yes' : 'no'}`);
