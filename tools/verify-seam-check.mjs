/**
 * Self-test for the seam check in tools/lib/frame-stats.mjs.
 *
 * Run:   node tools/verify-seam-check.mjs
 *
 * The seam check is the only automated guard on a defect this repository produced
 * three separate times, and it is a measurement that can be weakened by an edit
 * that looks like a tidy-up. Widening a span until it covers the terminal, or
 * raising the threshold to quieten a weather frame, both make the gate pass while
 * it no longer catches anything. Nothing about those edits is visible in the
 * renderer, and a green gate that measures less is worse than no gate.
 *
 * So it gets tested against synthetic frames where the right answer is known by
 * construction. No canvas and no browser: analyseFrame only asks the context for
 * pixels, so a plain object that serves a buffer is enough, and the whole check
 * runs in about a millisecond.
 */
import { analyseFrame } from './lib/frame-stats.mjs';

const W = 1280;
const H = 720;

/** A context that serves a fixed RGBA buffer, so `getImageData` can be faked. */
function contextOf(buffer) {
  return {
    getImageData(x, y, w, h) {
      const out = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row++) {
        const from = ((y + row) * W + x) * 4;
        out.set(buffer.subarray(from, from + w * 4), row * w * 4);
      }
      return { data: out, width: w, height: h };
    },
  };
}

/** Builds a frame from a per-pixel luma function. Grey, which is all the check reads. */
function frame(lumaAt) {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.max(0, Math.min(255, Math.round(lumaAt(x, y))));
      const i = (y * W + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
  return contextOf(px);
}

const SPANS = [0.12, 0.32, 0.52, 0.72].map((f) => Math.round(W * f));
const SPAN_W = Math.round(W * 0.16);
const inSpans = (x) => SPANS.some((x0) => x >= x0 && x < x0 + SPAN_W);

const cases = [];
const check = (name, got, want) => cases.push({ name, got, want });

// 1. The defect. A wash rect whose gradient is already at full strength at the top
//    of the rect puts a step across the whole width. This is the case the check
//    exists for, and it must be reported at the row where it happens.
{
  const at = 431;
  const seams = analyseFrame(frame((_x, y) => (y < at ? 60 : 100)), W, H).seams;
  check('full-width step is reported', seams.map((s) => s.y).includes(at), true);
}

// 2. The same magnitude confined to one place. A lightning bolt, a wire, a rain
//    streak or the terminal's own top edge all do this, and at this size the
//    previous version of the check reported them as defects and made the gate
//    unusable. Magnitude alone cannot separate the two, so this must stay silent.
{
  const at = 431;
  const seams = analyseFrame(frame((x, y) => (y < at ? 60 : inSpans(x) && x >= 400 && x < 500 ? 100 : 60)), W, H)
    .seams;
  check('localised step is not reported', seams.length, 0);
}

// 3. A step confined to a single span, which is what made two spans too few: both
//    of the old spans could be covered by one treeline while the rest of the frame
//    did nothing. With four spans this is one voice out of four.
{
  const at = 300;
  const x0 = SPANS[1];
  const seams = analyseFrame(frame((x, y) => (y < at ? 50 : x >= x0 && x < x0 + SPAN_W ? 90 : 50)), W, H).seams;
  check('single-span step is not reported', seams.length, 0);
}

// 4. A smooth ramp has no row transitions at all. Guards against a check that
//    fires on gradients generally rather than on steps.
{
  const seams = analyseFrame(frame((_x, y) => 20 + (y / H) * 60), W, H).seams;
  check('smooth ramp reports nothing', seams.length, 0);
}

// 5. A ramp that fades in over the wash, which is what the fixed version of the
//    defect looks like: the same shape, entering at zero. Only the row where it
//    starts must decide the verdict, and here the neighbour that actually moves is
//    the far side of the wash, not its top edge.
{
  const top = 431;
  const height = 115;
  const seams = analyseFrame(
    frame((_x, y) => {
      if (y < top) return 60;
      const t = (y - top) / height;
      return 60 + 40 * Math.sin(Math.min(1, t) * Math.PI);
    }),
    W,
    H
  ).seams;
  check('wash that starts at zero reports nothing', seams.length, 0);
}

let failed = 0;
for (const c of cases) {
  const ok = c.got === c.want;
  if (!ok) failed++;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${c.name}${ok ? '' : `  (got ${JSON.stringify(c.got)}, want ${JSON.stringify(c.want)})`}\n`);
}
process.stdout.write(failed ? `\n${failed} seam-check assertion(s) failed.\n` : '\nSeam check behaves.\n');
process.exit(failed ? 1 : 0);