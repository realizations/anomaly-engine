/**
 * Frame statistics, shared by the visual tools.
 *
 * One implementation, because the first version of this check existed twice with
 * two thresholds and they disagreed, which is worse than not having it.
 *
 * ## The seam check
 *
 * This repository produced the same defect three separate times: a wide
 * `fillRect` whose gradient is at non-zero alpha at the *top* of the rect. It
 * puts a hard horizontal step straight across the picture, it is nearly invisible
 * in a thumbnail, and it cost real time to find by eye each time. The rule it
 * violates is simple — a wash must be zero where it starts and zero where it
 * ends.
 *
 * The check has to tell that apart from weather. A single sampled span cannot: a
 * lightning bolt raises the mean of the one row it crosses by as much as a seam
 * does, and the first version of this reported storm frames as broken roughly one
 * run in four.
 *
 * So it is measured over four disjoint horizontal spans and a row transition only
 * counts when *all four* of them step. A wash rect covers the whole width, so it
 * appears in every span; a bolt, a wire, a rain streak or a blade of grass moves
 * one place and shows up in one. That is the discriminator, and it is what makes
 * the check stable enough to put in a gate.
 */

/**
 * @param {CanvasRenderingContext2D} g
 * @param {number} width  canvas width in device pixels
 * @param {number} height canvas height in device pixels
 *
 * Self-contained on purpose: the tools serialise this function into the page with
 * `analyseFrame.toString()`, so it must not close over anything from this module.
 */
export function analyseFrame(g, width, height) {
  /* ------------------------------ histogram ------------------------------ */

  const bins = new Array(8).fill(0);
  let sum = 0;
  let n = 0;
  const px = g.getImageData(0, 0, width, height).data;
  for (let i = 0; i < px.length; i += 16) {
    const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
    sum += l;
    n++;
    bins[Math.min(7, Math.floor(l / 32))]++;
  }
  const luma = sum / n;
  const fractions = bins.map((b) => b / n);
  // How much of the range the frame actually occupies. A frame whose luminance
  // all sits in one bucket is a flat frame however pretty its gradient is.
  const spread = Math.max(...fractions) - Math.min(...fractions);

  /* -------------------------------- seams -------------------------------- */

  // Four narrow spans spread across the width, chosen to sit between the
  // landmarks rather than over them: the terminal is lower-left, the observatory
  // and radio tower are right of centre, and the near treeline occupies the lower
  // band. A wash rect covers all four. A treetop, a tower or the terminal's own
  // edge covers one or two.
  //
  // Two spans were not enough. In this scene a legitimate content edge -- the
  // near treeline meeting the ground, the terminal's top edge -- produces a
  // row-mean step of 6 to 8 luma, which is the same size as the defect, and with
  // two spans the check reported storm frames as broken roughly one run in four.
  // Four spans is the point at which "the whole width moved" and "something moved
  // there" stop being the same measurement.
  const spans = [0.12, 0.32, 0.52, 0.72].map((frac) => {
    const x0 = Math.round(width * frac);
    const w = Math.max(8, Math.round(width * 0.16));
    return { w, data: g.getImageData(x0, 0, w, height).data };
  });

  const seams = [];
  for (let y = 1; y < height; y++) {
    let agree = 0;
    let worst = 0;
    for (const s of spans) {
      const base = y * s.w * 4;
      const prev = base - s.w * 4;
      let delta = 0;
      for (let i = 0; i < s.w; i++) {
        const p = base + i * 4;
        const q = prev + i * 4;
        delta +=
          0.2126 * (s.data[p] - s.data[q]) +
          0.7152 * (s.data[p + 1] - s.data[q + 1]) +
          0.0722 * (s.data[p + 2] - s.data[q + 2]);
      }
      const step = delta / s.w;
      worst = Math.max(worst, Math.abs(step));
      if (Math.abs(step) >= 5) agree++;
    }
    if (agree === spans.length) seams.push({ y, step: +worst.toFixed(2) });
  }

  return {
    luma: +luma.toFixed(2),
    bins: fractions.map((f) => +f.toFixed(3)),
    spread: +spread.toFixed(3),
    seams,
  };
}

/** Formats a seam list the way the tools print it. */
export function formatSeams(seams, height) {
  if (seams.length === 0) return 'PASS  no full-width horizontal seams';
  const lines = seams
    .slice(0, 10)
    .map((s) => `        y=${s.y} (${((s.y / height) * 100).toFixed(1)}% down)  step ${s.step > 0 ? '+' : ''}${s.step}`);
  return `FAIL  ${seams.length} full-width horizontal seam(s):\n${lines.join('\n')}`;
}
