/**
 * Guards the motion model against high-frequency brightness oscillation.
 *
 * The flicker in the original build was not one bug. It was several independently
 * reasonable animations that were individually invisible in review and collectively
 * a strobe on a desktop that stays lit for hours:
 *
 *   - three expanding beacon rings at 0.8 rad/s on a `lighter` composite, which
 *     is three brightness pulses per cycle in the brightest part of the frame
 *   - a scan bar crossing the terminal continuously
 *   - stars twinkling at 1.7 rad/s across the whole sky
 *   - grass and cloud layers swaying between 0.4 and 0.9 rad/s
 *
 * tools/flicker.mjs measures this in the browser, but it cannot resolve small
 * differences reliably in a headless environment where frames are paced by the
 * compositor rather than by a display, and it would be worse to assert something
 * the measurement cannot support than to let a regression through.
 *
 * So this is the deterministic half: it asserts the structural properties that
 * caused the problem are gone and that every remaining oscillator is routed
 * through the motion model rather than sitting in the drawing code as a bare
 * number. That is a lint on the source, which is exact.
 *
 *   node tools/motion-oscillators.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

// Anchored to this file rather than to the working directory.
const HERE = dirname(fileURLToPath(import.meta.url));
const RENDERER = resolve(HERE, '../src/Engine/src/renderer');

let failed = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  -- ${detail}` : ''}`);
  if (!ok) failed++;
};

const sources = readdirSync(RENDERER)
  .filter((f) => f.endsWith('.ts'))
  .map((f) => ({ name: f, text: readFileSync(join(RENDERER, f), 'utf8') }));

const world = sources.find((s) => s.name === 'WorldRenderer.ts');
const crt = sources.find((s) => s.name === 'CrtTerminal.ts');
check(!!world && !!crt, 'the renderer sources were found');

/** Source lines with comments and blanks stripped, for pattern matching. */
function codeLines(text) {
  return text.split(/\r?\n/).map((l) => {
    // Strip line comments so prose about a rate is not mistaken for the rate.
    const c = l.indexOf('//');
    return c >= 0 ? l.slice(0, c) : l;
  });
}

const worldCode = codeLines(world.text);
const crtCode = codeLines(crt.text);

// The old beacon. Three rings in a loop, each with its own phase, expanding
// outward and fading: three brightness pulses per cycle.
check(
  !/for \(let i = 0; i < 3; i\+\+\)[\s\S]{0,160}?pulse \* 5/.test(world.text),
  'the expanding beacon rings are gone'
);
check(
  !/this\._t \* 0\.8/.test(worldCode.join('\n')),
  'no bare 0.8 rad/s beacon oscillator remains'
);

// The scan bar.
check(
  !/if \(SCAN_BAR\.enabled\)[\s\S]{0,40}fillRect/.test(crt.text) ||
    /export const SCAN_BAR = \{[\s\S]*?enabled: false/.test(readFileSync(join(RENDERER, 'motion.ts'), 'utf8')),
  'the terminal scan bar is off by default'
);

// Star twinkle, which was 0.22 of amplitude at 1.7 rad/s.
check(
  !/0\.78 \+ 0\.22 \* Math\.sin\(this\._t \* 1\.7/.test(worldCode.join('\n')),
  'the old 1.7 rad/s star twinkle is gone'
);

/**
 * Every remaining `sin(this._t * X)` or `cos(this._t * X)` that can drive
 * brightness has to go through the motion model, so the dial reaches it.
 *
 * A bare rate here means an animation the dial cannot touch, which is how the
 * original build ended up with motion it could only scale globally.
 */
const RATE_PATTERN = /Math\.(sin|cos)\(\s*this\._t\s*\*\s*([0-9.]+)/g;
const unrouted = [];
for (const [name, lines] of [['WorldRenderer.ts', worldCode], ['CrtTerminal.ts', crtCode]]) {
  lines.forEach((line, i) => {
    for (const m of line.matchAll(RATE_PATTERN)) {
      const rate = Number(m[2]);
      // Very slow rates are effectively static, so leaving them bare is harmless.
      if (rate <= 0.3) continue;
      if (line.includes("_rate(") || line.includes("_amp(")) continue;
      unrouted.push(`${name}:${i + 1}  rate ${rate}  ${line.trim().slice(0, 90)}`);
    }
  });
}
check(unrouted.length === 0,
  'every fast oscillator is routed through the motion model',
  unrouted.length ? `\n        ${unrouted.join('\n        ')}` : 'none found outside _rate/_amp');

// The motion model has to exist and default to something calm.
const motion = readFileSync(join(RENDERER, 'motion.ts'), 'utf8');
check(/DEFAULT_MOTION_INTENSITY = 0\.35/.test(motion),
  'the default motion level is calm (0.35)');
check(/REDUCED_MOTION_INTENSITY = 0\.1/.test(motion),
  'reduced motion is defined and lower than the default');
check(/interface: 0/.test(motion),
  'instrumentation is exempt from motion, so a readout cannot flicker');
check(/glow: 0\.18/.test(motion),
  'glow, the thing peripheral vision picks up, is strongly damped');

console.log(failed ? `\n${failed} motion check(s) failed.` : '\nPASS  the motion model is in place and no fast oscillator bypasses it.');
process.exit(failed ? 1 : 0);