# Visual testing

## Canonical baseline workflow

`tools/visual-baseline.mjs` renders the canonical world
(`the-town-that-wasnt-there`, painterly) at night and golden hour in each of the
three directions, saves the renders into `build/visual-baseline/`, writes a
`manifest.json`, and fails if the three directions do not produce distinct
renders. It is part of `tools/verify.mjs`, so a change that silently falls back
to the base grade fails the gate.

## How to re-run

```
dotnet build src/AnomalyEngine        # rebuild the embedded renderer bundle
node tools/visual-baseline.mjs
```

Manifest `build/visual-baseline/manifest.json` records, per direction and time:
the mean luminance of the render and a content hash. Distinct hashes per
direction at the same hour are the criterion that the direction switch moved
the image.

## What a visual test will not catch

Canvas state under paced headless compositing paces frames; it does not
distinguish a real regime change from a pacing change, so exact frame diffing is
deliberately not the check. The baseline is allowed to differ on every run
within the same direction (the clock differs); what it must not do is collapse
all directions to the same image.

## Overlap with rendering debug

* `tools/per-monitor.mjs` checks every monitor layout composes the scene
  without seams and that identical monitors agree (tolerating the sub-pixel
  difference between independently-rendered viewports).
* `tools/flicker.mjs` bounds temporal luminance change on a static scene rather
  than asserting a pixel-exact match.
* `tools/perf-gpu.mjs` confirms the adaptive render scale on the real GPU; its
  numbers are the useful one when the scene appears to move on a capable
  machine, because the browser path only uses hardware rasterization while
  ANGLE/OpenGL is available (the sweet path).
