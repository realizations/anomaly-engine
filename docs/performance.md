# Performance

## Targets

At 1080p on a modern machine:

- Stable frame pacing
- Low idle CPU
- Bounded memory
- No desktop input lag

## Quality Presets

| Preset | FPS Cap | Particles | Effects |
|--------|---------|-----------|---------|
| Low | 30 | Reduced | Minimal |
| Medium | 60 | Standard | Standard |
| High | 60 | Full | Full |
| Ultra | Unlimited | Full | Full + extras |

## Dynamic Quality

The engine monitors frame times and automatically reduces quality if
performance drops:

- Reduced particle count
- Simplified effects
- Lower resolution rendering

## Pause Conditions

- Fullscreen application detected
- System sleep
- Battery mode (configurable)
- User paused

## Memory Monitoring

The engine tracks memory usage and will:

- Reduce texture quality
- Unload unused assets
- Limit particle pools

## GPU Options

- Prefer hardware rendering
- Fallback to software if needed
- Configurable GPU memory limit
