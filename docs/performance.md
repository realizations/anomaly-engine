# Performance

Every number here came from a measurement against the deployed `file://` build.
Nothing in this document is estimated, and the CPU and GPU figures are reported
separately because they answer different questions.

## The short version

On real hardware the renderer is not close to being the bottleneck. On a Radeon
RX 5500M, the engine's own per-frame work at 1920x1080 is **about 4 ms**, against
a 16.7 ms budget for 60 Hz. That is roughly a quarter of the frame, which leaves
the rest for the desktop compositor, other applications, and the host.

The renderer is fill-rate bound, and the adaptive quality scaler is a real
safeguard rather than a fallback: on a machine with no usable GPU it detects the
load and reduces render scale until the frame fits the budget. That path was
observed working, dropping to a scale of 0.59 to bring a 50.8 ms CPU frame inside
budget.

## How to read these figures

There are two very different rasterisation paths and conflating them produces
numbers that are both wrong and misleading in opposite directions.

**CPU rasterisation.** Headless Chromium rasterises through SwiftShader on the
CPU. A full-screen composite costs roughly two orders of magnitude more there
than on the GPU-composited WebView2 the application actually ships in. Measured
this way, fps is a **floor, not a forecast**. The useful figure is cost *per
pixel*, which is stable across resolutions precisely when the renderer is
fill-rate bound. It is the number to watch when a change adds a full-screen pass,
because it predicts what that pass will cost on real hardware.

**GPU rasterisation.** Launched with hardware acceleration, the same scene
reports the engine's real per-frame cost. Note that the fps figure in this mode
is bounded by the headless compositor's own frame pacing, around 25 Hz, and is
*not* a measure of the renderer: the engine's own work finishes in single-digit
milliseconds while frames are still being paced out at that rate. Read
`frameMs`, not `fps`, when hardware is available.

## Measured

CPU-rasterised (SwiftShader), adaptive quality enabled — a floor, not a forecast:

| Resolution | Style | fps | frame ms | ns/pixel | render scale |
|---|---|---|---|---|---|
| 1280x720 | painterly | 18 | 48.2 | 52 | 0.90 |
| 1280x720 | flat | 17 | 40.0 | 43 | 0.80 |
| 1280x720 | riso | 29 | 35.1 | 38 | 0.75 |
| 1920x1080 | painterly | 11 | 102.2 | 49 | 1.00 |
| 1920x1080 | flat | 9 | 81.4 | 39 | 0.90 |
| 1920x1080 | riso | 22 | 6.8 | 3 | 0.80 |

GPU-composited (ANGLE, AMD Radeon 5500M, OpenGL 4.5), 1920x1080, painterly:

| Path | fps (pacing-bound) | engine frame ms | render scale |
|---|---|---|---|
| Hardware | 26 | 4.1 | 1.00 |
| SwiftShader fallback | 11 | 50.8 | 0.59 |

The renderer is fill-rate bound: cost per pixel holds between 39 and 52 ns across
a 2.25x change in pixel count on the CPU path, which is what fill-rate bound
looks like, and it is why the adaptive quality scaler is the primary defence
rather than a fallback. The same scene that costs 50.8 ms to rasterise on the CPU
costs 4.1 ms on the GPU — the 12x ratio is the reason the shipped application,
which composites on the GPU through WebView2, has so much more headroom than the
CPU-rasterised table above suggests.

## Per-monitor

The renderer composes the scene **once per display** and blits each into its own
rectangle on a canvas the size of the whole virtual desktop. That is what makes
a mixed aspect-ratio setup correct: a single wide viewport would put the focal
point in the gap between two monitors, and each screen would get a crop rather
than a framing.

One engine, not one per monitor. A wallpaper does not need interactivity, and a
WebView2 is a separate JavaScript context, so N engines would mean N event loops,
N world clocks and N copies of the same state.

Measured cost, CPU-rasterised, 1920x1080 per monitor:

| Monitors | frame ms | fps | ns/pixel | render scale |
|---|---|---|---|---|
| 1 | 102.6 | 10 | 49 | 1.00 |
| 2 | 193.0 | 5 | 47 | 1.00 |
| 3 | 302.2 | 4 | 49 | 1.00 |

Cost per pixel holds flat at roughly 49ns whatever the monitor count, which is
the definition of fill-rate bound. Total time is therefore linear in the number
of displays, and that is the honest trade.

## The quality controller

Adaptive scale used to be a fixed 0.1 step per 45-frame window, with a floor of
0.5. Against a two-monitor layout running at 3fps that was useless: it took about
twelve seconds to move one step, and the floor was not low enough to recover even
once it arrived.

Two changes fixed it.

The correction is now **proportional**. Because cost is fill, time is roughly
proportional to area, so area has to scale with the budget and the linear
dimension with its square root. One correction therefore lands close to the right
scale in a single step instead of creeping toward it. Climbing back is
deliberately slower than dropping, so the scale cannot oscillate.

The window is also shorter, and a settle counter that was re-arming after every
window — discarding three frames out of every twenty-three, and stretching the
cycle to nearly six seconds — was fixed to apply only after a real change.

Measured on a two-monitor layout, software rasterised: scale reaches 0.5 within
five seconds of the layout being applied, then settles around 0.45. It no longer
sits at full resolution on hardware that cannot sustain it.

The floor is now 0.34 rather than 0.5, so genuinely weak hardware has somewhere
to go.

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

- The **liminal interior** is fill-heavy by nature: floor, walls, ceiling, doors
  and lights are all full-height quads. It has not been profiled separately.
- **No frame rate has been measured on real GPU-composited hardware.** Every
  figure in this document is CPU-rasterised and should be treated as a floor. A
  pass on a real machine is the missing measurement, and it should be recorded
  here when it exists.
