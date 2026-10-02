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

## GPU vs CPU path

On hardware rasterization (ANGLE / OpenGL) the scene runs at full detail up to
the decider, including the uncanny layer. On the CPU fallback path the
adaptive scale collapses to a quarter of the pixel grid for tileable work, and
the uncanny layer is scaled down with it. The performance figures to quote are
`frameMs` measured on the hardware path – those are the ones that have
real-time-budget meaning. The headless browser fast timing is pacing, not
rendering.
