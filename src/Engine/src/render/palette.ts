import { RGB, mixRgb } from './noise.js';

export interface SkyGrade {
  name: string;
  skyTop: RGB;
  skyHorizon: RGB;
  lightColor: RGB;
  ambient: number;
  haze: RGB;
  starAlpha: number;
  sunAlpha: number;
  moonAlpha: number;
}

const KEYS: Array<{ hour: number; grade: SkyGrade }> = [
  {
    hour: 0,
    grade: {
      name: 'deep night',
      skyTop: { r: 6, g: 8, b: 26 },
      skyHorizon: { r: 16, g: 18, b: 44 },
      lightColor: { r: 150, g: 165, b: 210 },
      ambient: 0.06,
      haze: { r: 22, g: 26, b: 54 },
      starAlpha: 1,
      sunAlpha: 0,
      moonAlpha: 1,
    },
  },
  {
    hour: 4.5,
    grade: {
      name: 'first light',
      skyTop: { r: 14, g: 18, b: 48 },
      skyHorizon: { r: 58, g: 42, b: 78 },
      lightColor: { r: 170, g: 160, b: 190 },
      ambient: 0.14,
      haze: { r: 62, g: 48, b: 82 },
      starAlpha: 0.7,
      sunAlpha: 0,
      moonAlpha: 0.6,
    },
  },
  {
    hour: 6.5,
    grade: {
      name: 'sunrise',
      skyTop: { r: 62, g: 74, b: 132 },
      skyHorizon: { r: 226, g: 132, b: 96 },
      lightColor: { r: 255, g: 176, b: 110 },
      ambient: 0.42,
      haze: { r: 208, g: 132, b: 118 },
      starAlpha: 0.16,
      sunAlpha: 1,
      moonAlpha: 0,
    },
  },
  {
    hour: 9,
    grade: {
      name: 'morning',
      skyTop: { r: 86, g: 132, b: 198 },
      skyHorizon: { r: 196, g: 206, b: 214 },
      lightColor: { r: 255, g: 240, b: 210 },
      ambient: 0.78,
      haze: { r: 190, g: 202, b: 214 },
      starAlpha: 0,
      sunAlpha: 1,
      moonAlpha: 0,
    },
  },
  {
    hour: 13,
    grade: {
      name: 'midday',
      skyTop: { r: 74, g: 126, b: 202 },
      skyHorizon: { r: 178, g: 200, b: 222 },
      lightColor: { r: 255, g: 250, b: 236 },
      ambient: 1,
      haze: { r: 178, g: 198, b: 218 },
      starAlpha: 0,
      sunAlpha: 1,
      moonAlpha: 0,
    },
  },
  {
    hour: 16.5,
    grade: {
      name: 'golden',
      skyTop: { r: 96, g: 124, b: 182 },
      skyHorizon: { r: 232, g: 178, b: 122 },
      lightColor: { r: 255, g: 206, b: 140 },
      ambient: 0.82,
      haze: { r: 226, g: 176, b: 132 },
      starAlpha: 0,
      sunAlpha: 1,
      moonAlpha: 0,
    },
  },
  {
    hour: 18.6,
    grade: {
      name: 'sunset',
      skyTop: { r: 48, g: 46, b: 96 },
      skyHorizon: { r: 214, g: 96, b: 72 },
      lightColor: { r: 255, g: 138, b: 88 },
      ambient: 0.4,
      haze: { r: 198, g: 96, b: 82 },
      // Still no stars. This grade is an hour before sunset with the sky still
      // bright, and the previous value of 0.2 put visible stars into it: the
      // ramp started during golden hour, so a dusk frame carried a scatter of
      // points against a lit sky, which reads as dirt on the lens rather than as
      // evening. Stars begin with 'dusk', once the sky is actually dark.
      starAlpha: 0,
      sunAlpha: 0.85,
      moonAlpha: 0.15,
    },
  },
  {
    hour: 20.5,
    grade: {
      name: 'dusk',
      skyTop: { r: 20, g: 20, b: 54 },
      skyHorizon: { r: 74, g: 48, b: 82 },
      lightColor: { r: 170, g: 150, b: 190 },
      ambient: 0.18,
      haze: { r: 70, g: 48, b: 80 },
      starAlpha: 0.72,
      sunAlpha: 0,
      moonAlpha: 0.7,
    },
  },
  {
    hour: 24,
    grade: {
      name: 'deep night',
      skyTop: { r: 6, g: 8, b: 26 },
      skyHorizon: { r: 16, g: 18, b: 44 },
      lightColor: { r: 150, g: 165, b: 210 },
      ambient: 0.06,
      haze: { r: 22, g: 26, b: 54 },
      starAlpha: 1,
      sunAlpha: 0,
      moonAlpha: 1,
    },
  },
];

export function gradeForHour(hour: number): SkyGrade {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i];
    const b = KEYS[i + 1];
    if (h >= a.hour && h <= b.hour) {
      const t = (h - a.hour) / (b.hour - a.hour);
      return blend(a.grade, b.grade, t);
    }
  }
  return KEYS[0].grade;
}

function blend(a: SkyGrade, b: SkyGrade, t: number): SkyGrade {
  const smooth = t * t * (3 - 2 * t);
  return {
    name: smooth < 0.5 ? a.name : b.name,
    skyTop: mixRgb(a.skyTop, b.skyTop, smooth),
    skyHorizon: mixRgb(a.skyHorizon, b.skyHorizon, smooth),
    lightColor: mixRgb(a.lightColor, b.lightColor, smooth),
    ambient: a.ambient + (b.ambient - a.ambient) * smooth,
    haze: mixRgb(a.haze, b.haze, smooth),
    starAlpha: a.starAlpha + (b.starAlpha - a.starAlpha) * smooth,
    sunAlpha: a.sunAlpha + (b.sunAlpha - a.sunAlpha) * smooth,
    moonAlpha: a.moonAlpha + (b.moonAlpha - a.moonAlpha) * smooth,
  };
}

export function sunPosition(hour: number, width: number, height: number): { x: number; y: number; visible: boolean } {
  const t = (hour - 6) / 12;
  if (t < 0 || t > 1) return { x: -999, y: -999, visible: false };
  const x = t * width * 1.15 - width * 0.075;
  const arc = Math.sin(t * Math.PI);
  const y = height * (0.86 - arc * 0.66);
  return { x, y, visible: true };
}

export function moonPosition(hour: number, width: number, height: number): { x: number; y: number; visible: boolean } {
  const t = ((hour + 24 - 18) % 24) / 12;
  if (t < 0 || t > 1) return { x: -999, y: -999, visible: false };
  const x = t * width * 1.15 - width * 0.075;
  const arc = Math.sin(t * Math.PI);
  const y = height * (0.82 - arc * 0.6);
  return { x, y, visible: true };
}

export function moonPhase(date: Date): number {
  const synodic = 29.53058867;
  const known = Date.UTC(2000, 0, 6, 18, 14) / 86400000;
  const days = date.getTime() / 86400000 - known;
  return ((days % synodic) + synodic) % synodic / synodic;
}
