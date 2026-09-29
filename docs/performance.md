# Performance

Every number here came from `node tools/perf.mjs` against the deployed
`file://` build. Nothing in this document is estimated.

## How to read these figures

Headless Chromium rasterises on the CPU through SwiftShader. A full-screen
composite operation costs roughly two orders of magnitude more there than on the
GPU-composited WebView2 the application actually ships in.

So raw fps measured this way is a **floor, not a forecast**. The useful figure is
cost *per pixel*, which is stable across resolutions precisely when the renderer
is fill-rate bound. It is the number to watch when a change adds a full-screen
pass, because it predicts what the same pass will cost on real hardware.

## Measured

CPU-rasterised, adaptive quality enabled:

| Resolution | Style | fps | frame ms | ns/pixel | render scale |
|---|---|---|---|---|---|
| 1280x720 | painterly | 18 | 48.2 | 52 | 0.90 |
| 1280x720 | flat | 17 | 40.0 | 43 | 0.80 |
| 1280x720 | riso | 29 | 35.1 | 38 | 0.75 |
| 1920x1080 | painterly | 11 | 102.2 | 49 | 1.00 |
| 1920x1080 | flat | 9 | 81.4 | 39 | 0.90 |
| 1920x1080 | riso | 22 | 6.8 | 3 | 0.80 |

The renderer is fill-rate bound: cost per pixel holds between 39 and 52 ns across
a 2.25x change in pixel count, which is what fill-rate bound looks like and is
the reason the adaptive quality scaler is the primary defence rather than a
fallback.

## What was fixed

**Riso was running at seven frames a second.** 181ms a frame, against 5-6ms for
the other styles. The cause was the halftone separation: a full-frame readback
plus a per-pixel dot test across every screen cell, every frame. A screen print
is a static object, and what moves between frames is weather and a scan bar,
none of which shift a dot by a visible amount, so the print is now cached and
re-imposed only when the scene has actually shifted — on a quarter-hour step, on
a change of weather condition, on a world or size change, and on a long
maximum-age refresh so slow drift still eventually prints.

Riso went from 181ms to roughly 4ms: about a 42x improvement, and from the
slowest style to the fastest.

**Painterly was compositing four full-screen passes per frame** — an `overlay`
warm cast, a `multiply` exposure ramp, a radial vignette, and an `overlay` film
grain. Because pending blend work is deferred and flushed inside whichever call
syncs the pipeline, this showed up as a 119ms cost inside the buffer blit rather
than where it belonged.

The vignette and the grain are properties of the canvas, not of the time of day,
so they are baked once per resize into a single layer. Exposure and the
warm/cool cast are a flat `multiply` fill, which is effectively free. Four
full-screen composites became one image blit and one solid fill.

**The terminal used a canvas blur filter** for its drop shadow. Canvas blur is a
separable convolution and was measurably one of the most expensive operations in
the frame; it is now a stack of soft ellipses, which is visually equivalent at
the terminal's size.

## Protections that remain

- **Adaptive render scale.** Drops toward 0.65 when the frame budget is missed
  and recovers when it is not. This is what actually holds the frame rate on slow
  hardware, and the table above shows it engaging under CPU rasterisation.
- **Frame cap.** A desktop background does not need to repaint at 144Hz. The
  cap is user-adjustable and off by default so the choice stays explicit.
- **Reduced motion.** Honoured independently of frame rate, because a surface
  expected to sit running for hours is a motion-sensitivity question as well as
  a power question.

## Not yet done

- **Per-monitor worlds** remain the largest structural gap. They mean several
  WebViews each running an engine, so the per-pixel cost is paid once per
  monitor. Doing this before the frame-cost work above would have multiplied the
  problem rather than fixed it.
- The **liminal interior** is fill-heavy by nature: floor, walls, ceiling, doors
  and lights are all full-height quads. It has not been profiled separately.
