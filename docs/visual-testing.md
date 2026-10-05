# Visual testing

Nothing here does pixel diffing, and that is a decision rather than a limitation.
Canvas under headless compositing is *paced*, not real-time: two runs of an
identical frame differ in the clock, in the weather system's phase and in which
particle is where. A pixel-exact gate on top of that is either useless (a tolerance
wide enough to be stable catches nothing) or unusable (fails every run), and it
pushes every future change towards freezing the renderer.

What is checked instead is the class of defect that actually broke: structural
changes that move statistics while moving almost no pixels.

## The gates

### `tools/visual-cases.mjs` — the regression gate

Renders twenty named states, writes them to `build/visual-cases/`, and compares
against `docs/visual-baseline.json`:

```bash
node tools/visual-cases.mjs             # render and report
node tools/visual-cases.mjs --compare   # fail on drift   (the gate)
node tools/visual-cases.mjs --write-baseline
```

It asserts four things:

| Assertion | Catches |
|---|---|
| mean luminance within 12% of baseline | a palette that collapsed to black or to white |
| tonal spread within 0.18 | a frame that flattened, or gained a tonal band |
| horizontal seam count is zero | the wash-rect defect, three times over |
| the three directions stay distinct | three filters over one picture |

The distinctness row here compares a `luma|spread` signature across directions at
the same hour, which is enough to catch a collapse. The stronger measure — a
pixel-level comparison against a convergence floor — is the next tool's job.

The states cover three times of day, each direction, each weather state that
changes the frame, every anomaly, reduced motion, the low-quality path, and both
non-painterly styles.

### `tools/visual-baseline.mjs` — direction distinctness

Renders the canonical world at night and golden hour in each direction, and
measures how far apart they are.

This check used to be decorative. It computed whether the directions were distinct,
printed the answer, and returned 0 either way — there was no exit path in the file,
so `verify.mjs` recorded a pass whether or not the directions had converged. Worse,
it decided distinctness by SHA-256 hash, and every frame has grass, cloud, rain and
stars moving, so three renders of the *same* direction already hash differently. It
would have passed a fully converged engine.

It now measures the mean absolute difference between a coarse luminance signature
(a 32×18 grid of mean luma per cell) for all three pairs at both times, with the
numbers chosen from measurement rather than taste:

| | value |
|---|---|
| animation floor, same state twice | 0.44 – 0.53 |
| threshold | 1.5 |
| smallest real difference (depth vs atmospheric, night) | 2.94 |
| largest real difference | 33.76 |
| same direction, night vs golden hour | 46.73 |

It also asserts that the hour is doing something, since if that stops being true
every other number in it is suspect. Verified by collapsing all three directions
onto one: six comparisons fail with divergences of 0.09–0.21, and the run exits 1.

### `tools/verify-seam-check.mjs` — the seam detector's own teeth

The horizontal-seam check is the only automated guard on a defect this repository
produced three separate times, and it is a measurement that can be weakened by an
edit that looks like a tidy-up. Widening a span or raising a threshold makes the
gate pass while it no longer catches anything, and neither edit is visible anywhere
but the green light.

This asserts against synthetic frames where the answer is known by construction:
a full-width step is reported, a localised one is not, a single-span one is not, a
smooth ramp reports nothing, and a wash that starts at zero reports nothing.
Checked by weakening the detector on purpose — one span fails two assertions, a
threshold of 40 fails to report the defect at all.

### `tools/look.mjs` — one frame, on demand

```bash
node tools/look.mjs --dir depth --hour 16.9
node tools/look.mjs --dir depth --hour 16.9 --crop 300,700,1400,420
```

Renders a single frame, optionally cropped, and reports seams, mean luma and tonal
spread. Answers "why is that shape wrong" rather than "is the direction working".

## Other checks that touch the picture

- `tools/per-monitor.mjs` — every monitor layout composes independently, with
  pixel sampling per viewport rather than one stretch across the desktop.
- `tools/per-display-worlds.mjs` — each display can show its own world. Has the
  negative control the others lack: clearing the assignment must make the two
  screens match again (colour distance reads exactly 0.0), so a check that cannot
  detect sameness would fail here.
- `tools/flicker.mjs` — bounds frame-to-frame luminance change at several motion
  levels. Honest about its own limits in its output: in a headless environment the
  figures for the same level vary as much as they do between levels, so it bounds
  flicker rather than resolving the dial.
- `tools/riso-halftone.mjs` — proves riso prints a dot screen by measuring
  adjacent-pixel luminance, and that painterly and flat do *not*, so the bars mean
  something.
- `tools/perf-gpu.mjs` — real per-frame cost on the GPU, and that the adaptive
  render scale responds to load.

## What these will not catch

A change that alters the picture without moving luminance, spread, seams or
direction distance. A palette swap between two similar values, or a silhouette that
moves a few pixels, is invisible to all of it. The images are written on every run
precisely because of that: a number cannot tell you a composition got worse, and
somebody has to look.