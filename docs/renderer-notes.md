# Renderer notes

## The renderer is deliberately "postive"

The scene is composed into a buffer and then finished with a small set of
full-screen passes: grade, the active direction finish, vignette, grain, and –
since the meshed 2D analog uncanny lives here too – the smear pass. This is the
most expensive part of the frame, and instrumenting it is the only way to tune
it honestly instead of by guessing.

## Motion model

All ambient oscillators go through `renderer/motion.ts` and are scaled by the
same intensity. The categories divide down so one knob dampens the bright,
peripheral contributions (glow, particles, twinkle) without making the scene
feel slower. Reduced motion forces a low (not zero) intensity, sustained
camera drift still happens, and there is a corresponding intensity slider in
the settings panel. See `docs/visual-analysis.md` for why this is not a per-frame
global multiplier (that reads as sluggish) or a CSS class (the engine has no
stylesheet to act on – it only draws a canvas).

## Dead listeners and missing events

The random-source event that was supposed to spawn the lights-out anomaly was
never emitted; the anomaly was therefore completely unreachable. It has been
added so a `random.lights_out` event now genuinely routes through
`_fireAnomaly`. This class of dead-listener bug is worth grepping after every
new event is added.

## Per-monitor

Each display gets its own viewport (and can now have its own world). The canvas
on the secondaries is just a copy of the same world; the terminal is drawn once
on the primary. Region-sampling checks in `tools/per-monitor.mjs` confirm the
geometry of every supported layout (single, two side-by-side, L, R, stacked).

## Landmarks and the anchor coordinate system

Every landmark's anchor, tone, size and (eventually) 3D model reference lives in
`src/Engine/src/renderer/assetRegistry.ts`. It used to be an anchor table, a tone
table and a hardcoded pixel literal inside each `case` of `_drawStructure`, with
nothing tying them together and no way for anything outside the renderer to ask
where a building was.

The part worth knowing before editing a world file is that a structure's `x` is
**not** where it ends up:

```
finalX = worldX + (nativeX - anchorX)
```

The silhouette is authored at `nativeX`, and the draw transform moves it so that
its *anchor* lands on the position the world declared. The cabin is authored at
0.33 with an anchor of 0.2, so `x: 0.17` renders it at 0.30. The indirection
exists so each silhouette keeps the proportions it was drawn with, instead of
every `x` meaning "left edge" for some shapes and "centre" for others.

`resolveStructureRect()` is the only sanctioned conversion from a world entry to
an on-screen region, and `WorldRenderer.getLandmarkRects()` is the only sanctioned
way to get those regions. Vertical placement is simpler: no built-in world sets
`structures[].y`, so the vertical translate is zero and landmarks sit where their
drawing code puts them, measured down from the horizon.

`tools/visual-snapshot.mjs` proves a change to any of this moved no pixels. Live
captures are not byte-reproducible — the renderer animates against a real clock, so
two captures of unchanged code differ in all twenty cases. The tool stubs
`performance.now()` and `Math.random()`, pauses the engine's own loop and drives a
fixed number of frames, which makes eleven frames across all six worlds exactly
repeatable.

## GPU vs CPU path

On hardware rasterization (ANGLE / OpenGL) the scene runs at full detail up to
the decider, including the uncanny layer. On the CPU fallback path the
adaptive scale collapses to a quarter of the pixel grid for tileable work, and
the uncanny layer is scaled down with it. The performance figures to quote are
`frameMs` measured on the hardware path – those are the ones that have
real-time-budget meaning. The headless browser fast timing is pacing, not
rendering.
