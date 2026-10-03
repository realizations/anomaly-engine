export function hash(seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function valueNoise1D(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash(seed + i);
  const b = hash(seed + i + 1);
  return lerp(a, b, fade(f));
}

export function fbm1D(x: number, seed: number, octaves = 5, lacunarity = 2, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise1D(x * freq, seed + o * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

export function ridged1D(x: number, seed: number, octaves = 5): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise1D(x * freq, seed + o * 7919);
    const ridge = 1 - Math.abs(n * 2 - 1);
    sum += ridge * ridge * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  };
}

export function css(c: RGB, alpha = 1): string {
  return alpha >= 1
    ? `rgb(${c.r},${c.g},${c.b})`
    : `rgba(${c.r},${c.g},${c.b},${alpha.toFixed(3)})`;
}

export function mixCss(a: RGB, b: RGB, t: number, alpha = 1): string {
  return css(mixRgb(a, b, t), alpha);
}

export function shade(c: RGB, amount: number): RGB {
  if (amount >= 0) {
    return {
      r: Math.round(lerp(c.r, 255, amount)),
      g: Math.round(lerp(c.g, 255, amount)),
      b: Math.round(lerp(c.b, 255, amount)),
    };
  }
  const k = 1 + amount;
  return {
    r: Math.round(c.r * k),
    g: Math.round(c.g * k),
    b: Math.round(c.b * k),
  };
}

/**
 * Scales a colour's value about its own luminance.
 *
 * This is *not* `shade`. `shade(c, 0.7)` means "move 70% of the way toward white",
 * so it cannot be used to express "this plane should be about 70% as bright as
 * authored" — passing a depth multiplier of 0.7 to it brightened every near
 * plane instead of darkening it, which inverted the scene's main depth cue and
 * left the ground lighter than the sky above it.
 *
 * `k` below 1 darkens toward black, above 1 lightens toward white, and both
 * preserve hue far better than lerping to a fixed grey, which is what a value
 * ladder across nine depth planes needs in order not to turn a forest blue.
 */
export function scaleValue(c: RGB, k: number): RGB {
  if (k === 1) return c;
  const target = k >= 1 ? 255 : 0;
  const t = k >= 1 ? (k - 1) * 0.72 : 1 - k;
  return {
    r: Math.max(0, Math.min(255, Math.round(lerp(c.r, target, t)))),
    g: Math.max(0, Math.min(255, Math.round(lerp(c.g, target, t)))),
    b: Math.max(0, Math.min(255, Math.round(lerp(c.b, target, t)))),
  };
}
