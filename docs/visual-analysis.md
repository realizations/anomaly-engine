# Visual analysis

## What was wrong

The wallpaper is visually competent but shallow. The root causes, confirmed by
canvas captures and the frame tools:

1. The camera never lays a foreground onto the world. Everything begins at the
   horizon and reads as a row of tree-triangles. A scene needs a layered stack —
   sky, far, mid, near, immediate — for it to have depth at all.
2. The sky is gradients and a moon. Nothing sits in the air between the world
   and the camera: no structured cloud, no atmospheric perspective, no haze.
3. Everything has equal visual weight. The terminal, the radio tower, the
   anomaly light, the cabin and the ground all finish in the same range. When
   everything is rendered as important, nothing is.
4. The terminal was previously a fixed-size bezel that defeated legibility on
   small displays and floated on the screen, so it read as Windows software
   pasted over rather than a piece of equipment in the landscape.
5. Some of the flashiness was independent: the beacon had three expanding
   rings at full opacity, the terminal scan-bar crossed constantly, the grass
   may have swayed too fast for calm, and stars twinkled at a rate that
   peripheral vision was not built for. Individually small, the sum made the
   wallpaper tire the eye even though it did not "flicker" in the diagnostic
   sense.

## What was fixed

* Terminal sizing is now based on both dimensions and clamped so it reads the
  status block at 1920×1080, 2560×1440, 1366×768 and 3440×1440 alike, and
  never grows to dominate the frame on short or wide displays. The bezel is
  still lit by the same sky grade as the world, but now also carries a subtle
  ground plinth so it stands where the real planet touches.
* Motion constants (size of every oscillatory motion, phase rates, which
  assets actually move, and what the motion intensity multiplies) are in
  `src/Engine/src/renderer/motion.ts`. Reduced-motion forces a real intensity
  down the path, and an intensity slider exists in the settings panel.
* The scan-bar is off by default; the beacon renders one slow breath around a
  fixed light, one cycle of roughly forty seconds.
* The scene composition is still graded from a palette keyframe table; the
  directions and the haze layers soften toward that same light rather than
  replacing it.

## What was abstracted

Each direction now has two halves, and the expensive one is not a post-process:

* `ScenePlan.ts` carries the composition — framing, the value ladder, aerial
  perspective, what stands close to the camera, where light lands. It is applied
  while the scene is drawn.
* `VisualDirection.ts` carries only the finish: a small unifying grade so the three
  still look like one product.

This replaced an earlier arrangement where all three directions were full-screen
passes over the finished scene. That produced three images that were recognisably
the same picture in three tints, and it could not fix either of the two things that
actually made the wallpaper look flat: every plane ended in the same value range,
and nothing was drawn between the camera and the near treeline. Neither of those is
a post-process problem.

The finish is deliberately restrained for the same reason. A direction whose
identity lives in a filter collapses into the next one, which is what happened.

See `docs/visual-mockups/README.md` for the three variants and the contact sheet.

## What was left alone

The world definitions, the event and anomaly model, and the palette keyframes are
intentionally untouched. The flat and riso styles are deliberate authorial styles,
not bugs — riso quantises luminance rather than each RGB channel, because
per-channel posterisation destroys hue and a dark blue snaps to magenta.

The canvas-2D renderer ceiling is real: there is no path to better lighting than the
current keyframe approach without changing the medium (GPU shader passes), which is
out of scope. The measured cost is well inside budget regardless — 6.4 ms median
against a 16.7 ms frame on hardware rasterisation.
