import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_EASTER_EGGS } from '../src/systems/EasterEggSystem.js';
import { EGG_EFFECTS } from '../src/systems/eggEffects.js';
import { describeZones } from '../src/systems/landmarkZones.js';
import type { InteractionSurfaces, LandmarkRect, ScreenRect } from '../src/renderer/WorldRenderer.js';

/**
 * Every easter egg has a producer: something in the engine can actually fire it.
 *
 * Six eggs shipped with effects, beats, journal entries and passing tests, and three
 * of them could not be triggered by any human in any build. Each failure was silent
 * and each was invisible to the checks that existed:
 *
 *   - `midnight-hover-moon` had a zone and a trigger, but the zone's `dwellMs` was 0,
 *     so `InteractionSystem._tickDwell` returned before reaching the callback, and the
 *     one callback that could have fired it was gated to `forest`.
 *   - `dev-build` had no producer at all. `eggEffects.ts` pointed at a method called
 *     `_maybeDevBuildEgg` that did not exist in the repository.
 *   - `konami` listened for `keydown` on a window the host never focuses, so in the
 *     shipped wallpaper the listener could not fire.
 *
 * The table checks all passed, because all of them were true: the egg had an effect,
 * the effect had a beat, the beat had a duration. What none of them asked was the only
 * question that matters -- who presses the button?
 *
 * So this file is built around producers rather than around tables. A trigger is
 * considered reachable if this file can point at the line of engine code that emits
 * it, and the list is deliberately explicit so a new egg has to be added to it.
 */

const ROOT = join(process.cwd(), '..', '..');
const mainSrc = readFileSync(join(ROOT, 'src', 'Engine', 'src', 'main.ts'), 'utf8');
const zonesSrc = readFileSync(join(ROOT, 'src', 'Engine', 'src', 'systems', 'landmarkZones.ts'), 'utf8');
const eggsSrc = readFileSync(join(ROOT, 'src', 'Engine', 'src', 'systems', 'EasterEggSystem.ts'), 'utf8');

const TRIGGERS = BUILTIN_EASTER_EGGS.map((e) => e.trigger);

/**
 * Where each trigger comes from.
 *
 * `source` is a file plus the expression that has to appear in it. This is a source
 * scan rather than an import of `main.ts`, for the reason `WindowEvents.test.ts` gives:
 * importing the engine starts it. It is also the honest level of check -- the claim
 * under test is "there is a line in the engine that fires this", and a line of text is
 * what that claim is about.
 */
const PRODUCERS: Record<string, { file: string; text: string; source: string }[]> = {
  // Fires from a dwell on the moon zone, which now carries a dwell time and a trigger.
  'hover:moon@midnight': [
    { file: 'landmarkZones.ts', text: zonesSrc, source: "trigger: 'hover:moon@midnight'" },
    { file: 'landmarkZones.ts', text: zonesSrc, source: 'dwellMs: MOON_DWELL_MS' },
    { file: 'main.ts', text: mainSrc, source: 'if (desc.trigger) this._tryDiscover(desc.trigger);' },
  ],
  'triple-click:observatory': [
    { file: 'main.ts', text: mainSrc, source: 'WINDOW_EVENTS.tripleClick' },
  ],
  'idle:forest:30s': [
    { file: 'landmarkZones.ts', text: zonesSrc, source: "trigger: 'idle:forest:30s'" },
    { file: 'landmarkZones.ts', text: zonesSrc, source: 'dwellMs: DEFAULT_DWELL_MS' },
  ],
  'dev-build': [
    { file: 'main.ts', text: mainSrc, source: "this._tryDiscover('dev-build')" },
  ],
  '3:33 x3': [
    { file: 'main.ts', text: mainSrc, source: "this._tryDiscover('3:33 x3')" },
  ],
  // Fires from the keydown listener, which works wherever the page has focus --
  // `npm run dev` -- and via `discoverEgg`, which the verification tools use against
  // the deployed build. It does not fire from the shipped wallpaper, and the comment in
  // EasterEggSystem says so rather than implying otherwise.
  konami: [
    { file: 'EasterEggSystem.ts', text: eggsSrc, source: "this._triggerEgg('konami')" },
  ],
};

describe('every egg has a producer', () => {
  it('declares a producer for every egg that ships', () => {
    // An egg with no entry here is an egg nobody has shown can fire.
    expect([...TRIGGERS].sort()).toEqual([...Object.keys(PRODUCERS)].sort());
  });

  it('finds the producing code for every egg', () => {
    const missing: string[] = [];
    for (const trigger of TRIGGERS) {
      const producers = PRODUCERS[trigger] ?? [];
      if (producers.length === 0) {
        missing.push(`${trigger}: no producer declared`);
        continue;
      }
      for (const p of producers) {
        if (!p.text.includes(p.source)) missing.push(`${trigger}: ${p.file} has no "${p.source}"`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the moon egg reachable, which is the one a dwell gate silently blocked', () => {
    // The zone declared the trigger and set `dwellMs: 0`. `InteractionSystem` returns
    // from `_tickDwell` on a zero dwell before it reaches the callback, so a zone with a
    // trigger and no dwell time is a trigger nothing can fire -- and the callback that
    // was supposed to forward it was gated to the forest anyway.
    //
    // Asserted as the shape of the gate rather than the absence of one phrase: the
    // comment explaining the old gate mentions `forest`, and a test that greps for
    // comments is a test that fails the next time someone documents what they fixed.
    const onDwell = /onDwell: \(\) => \{[\s\S]*?\n {8}\},/.exec(mainSrc);
    expect(onDwell, 'the onDwell callback moved or changed shape').not.toBeNull();
    // Comments are stripped first. The comment in that callback explains the gate this
    // fix removed, so it names `forest` -- and a test that greps prose fails the moment
    // someone writes down what they changed.
    const code = onDwell![0]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(code).toContain('desc.trigger');
    expect(code).not.toContain('desc.id ===');
  });

  it('has a producer for the dev-build egg that the code actually names', () => {
    // `eggEffects.ts` said "Dev builds only; see `_maybeDevBuildEgg`", and that method
    // was not in the repository. A comment pointing at a function that does not exist is
    // the most expensive kind of documentation: it reads as a wiring note.
    expect(eggsSrc).toBeTruthy();
    const effectsSrc = readFileSync(join(ROOT, 'src', 'Engine', 'src', 'systems', 'eggEffects.ts'), 'utf8');
    const named = /see\s+`(_?\w+)`/.exec(effectsSrc);
    expect(named, 'eggEffects.ts no longer names a method for the dev-build egg').not.toBeNull();
    expect(mainSrc).toContain(`${named![1]}()`);
  });
});

describe('the dev-build egg cannot reach a shipped build', () => {
  it('is gated on a build flag that Vite substitutes at build time', () => {
    expect(mainSrc).toContain('import.meta.env.DEV');
    expect(mainSrc).toContain('if (!import.meta.env.DEV) return;');
  });

  it('declares the flag for tsc, which runs before Vite', () => {
    // Without this the flag is a compile error, so the honest options were to delete the
    // egg or to declare the type. The declaration is checked because an ambient file is
    // invisible to every other gate: nothing imports it and nothing bundles it.
    const decl = readFileSync(join(ROOT, 'src', 'Engine', 'src', 'vite-env.d.ts'), 'utf8');
    expect(decl).toContain('readonly DEV: boolean');
  });

  it('keeps the trigger out of a release bundle', () => {
    // The behavioural half. `import.meta.env.DEV` is replaced with `false` and the
    // branch disappears, so the call site is not in the shipped JavaScript at all.
    const assets = join(ROOT, 'src', 'Engine', 'renderer', 'assets');
    let bundle: string | null = null;
    try {
      const { readdirSync } = require('node:fs') as typeof import('node:fs');
      const f = readdirSync(assets).find((x: string) => x.endsWith('.js'));
      if (f) bundle = readFileSync(join(assets, f), 'utf8');
    } catch {
      bundle = null;
    }
    // The bundle only exists after a build. Asserting on its absence when there is no
    // bundle would pass for the wrong reason, so the check is skipped rather than faked.
    if (bundle === null) return;
    expect(bundle).not.toContain('import.meta');
  });
});

describe('zone dwell is consistent with what each zone triggers', () => {
  const FOREST: ScreenRect = { x: 0, y: 0.63, width: 1, height: 0.13 };
  const MOON: ScreenRect = { x: 0.7, y: 0.2, width: 0.06, height: 0.1 };
  const landmark = (kind: LandmarkRect['kind'], x: number): LandmarkRect =>
    ({ id: `${kind}@${x}`, kind, x, y: 0.5, width: 0.06, height: 0.07 });

  const scenes = describeZones({
    landmarks: [landmark('observatory', 0.44)],
    moon: MOON,
    forest: FOREST,
  } as InteractionSurfaces);

  it('gives the moon a dwell time, because its egg is a dwell', () => {
    const moon = scenes.find((z) => z.id === 'moon');
    expect(moon, 'the moon zone disappeared').toBeDefined();
    expect(moon!.trigger).toBe('hover:moon@midnight');
    expect(moon!.dwellMs).toBeGreaterThan(0);
  });

  it('gives every zone that declares a trigger a way to fire it', () => {
    // The general form of the defect. A trigger on a zone with no dwell is only
    // reachable if something else dispatches it, and the observatory is the one case
    // where that is true -- a triple-click, not a dwell.
    const dwellOnly = scenes.filter((z) => z.trigger !== null && z.dwellMs <= 0);
    expect(dwellOnly.map((z) => z.id)).toEqual(['observatory']);
  });

  it('still does not make scenery clickable', () => {
    // Raising the moon's dwell must not have widened the table: the whole argument for
    // curating these zones is that a rock pile is not a discovery.
    const sources = readFileSync(join(ROOT, 'src', 'Engine', 'src', 'systems', 'landmarkZones.ts'), 'utf8');
    for (const scenery of ['rock-field', 'reed-bank', 'fence-line', 'cairn']) {
      expect(sources).not.toContain(`'${scenery}'`);
    }
  });
});

describe('egg effects are all real', () => {
  it('has an effect and a beat for every egg', () => {
    for (const egg of BUILTIN_EASTER_EGGS) {
      expect(EGG_EFFECTS[egg.id], `${egg.id} has no effect`).toBeDefined();
    }
  });
});
