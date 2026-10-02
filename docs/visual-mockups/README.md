# Visual mockup laboratory

Three art directions for the same scene, rendered from one layout so they can be
compared directly. One world (`the-town-that-wasnt-there`), one composition, two
render times: the only thing that changes between the images is the direction the
renderer finishes the scene with. The point is to argue less in words.

## How it is constructed

`src/Engine/src/renderer/VisualDirection.ts` adds a finish pass on top of the
composed scene. Each direction is an honest reinterpretation of the same work,
aimed at a different cause of the same flatness:

| Direction | Working theory | What it does |
| --- | --- | --- |
| **depth** | No foreground anchors the viewer, so the scene reads as a row of items. | Atmospheric perspective on the far ridges, a syncronised light haze, and a close dark foreground band of grasses. |
| **atmospheric** | The sky is a vacant gradient and nothing sits in air. | Structured cloud layers, a heavier horizon band, and cloud-tinted light. |
| **darker** | Every element is equally lit, so nothing is the subject. | A darker top half, a concentration of light low in the frame, and a dimmer frame around it. |

Contact sheet: `contact-sheet.jpg` (rows depth / atmospheric / darker; columns
night / golden / dusk). Full-size renders in this directory.

## Palette and lighting

The engine already grades the scene from a time-of-day keyframe table in
`src/Engine/src/render/palette.ts`; the directions layer on top of that rather than
replacing it. This is deliberate, so every direction still follows the same clock
and the same weather rather than looking like a fixed keyframe of its own.

## Rendering cost

The finish passes are a handful of full-screen gradients plus the foreground
silhouette on the depth direction. They cost a fraction of the heaviest animated
layer (the analog uncanny smear pass) and were not driven to be faster. No
quality change required; `perf-fusion` and the GPU check still report inside
budget on the existing adaptive path.

## Assessment

Honest reading, not marketing: the painterly direction is the strongest of the
three at night, because the fog and star treatment read well; the depth direction
is the most legible improvement at golden hour and add a sense of standing in the
scene; darker lifts the subject but can push too much of the ground and sky into
black at the deepest nights. None of the three is a finished gallery grade. The
one-node scene that the renderer composes from still limits the depth hierarchy —
more authority at that composition seam would improve any direction more than the
directional finish does.

## Next step

The terminal panel was previously a fixed size that defeated legibility on smaller
displays; it now scales to the view, clamped so it never dominates on small
screens or reads too small to read. Integrated into the wallpaper as the single
equipment panel rather than a UI rectangle that floats over a scene.

The direction work is not rendered to a published build. The published build
still ships `direction: depth` by default, until one of these ships as the
chosen look.
