import { describe, it, expect, vi } from 'vitest';
import { DebugOverlay } from '../src/platform/DebugOverlay.js';

/**
 * That the debug overlay shows measurements rather than defaults.
 *
 * `DebugOverlay.update()` was never called from anywhere in the project. The overlay
 * opened, rendered its own hardcoded initial values, and repainted them ten times a
 * second forever: `FPS: 0 | Frame: 0.0ms`, `WebView: unknown`, `GPU: unknown`. README.md
 * advertised it as reporting frame time, memory and render scale.
 *
 * So the tests here are about the thing the overlay is for. `update` merging correctly is
 * almost trivially true; what matters is that a *measured* value is distinguishable from
 * an absent one on the screen, because a panel that says "0" when it means "I have not
 * been told" is worse than no panel.
 */
function renderOverlay(partial: Parameters<DebugOverlay['update']>[0]): string {
  const overlay = new DebugOverlay();
  overlay.show();
  overlay.update(partial);
  const el = document.getElementById('anomaly-debug-overlay');
  const text = el?.textContent ?? '';
  overlay.dispose();
  return text;
}

describe('DebugOverlay', () => {
  it('shows a dash for anything it has not been told', () => {
    // Before any update, the weather and sky rows have no value. A dash says "not
    // known"; a zero would say "measured, and it is zero", which is a different claim
    // and a wrong one.
    const text = renderOverlay({});
    expect(text).toMatch(/Condition\s+-/);
    expect(text).toMatch(/Moon phase\s+-/);
  });

  it('shows a measured value once given one', () => {
    const text = renderOverlay({
      fps: 60,
      frameTime: 16.7,
      renderScale: 0.85,
      weather: 'rain',
      temperature: 11.4,
      windSpeed: 7.2,
      humidity: 0.83,
      moonPhase: 0.42,
      moonIllumination: 0.77,
    });
    expect(text).toMatch(/FPS\s+60/);
    expect(text).toMatch(/Frame\s+16\.70 ms/);
    expect(text).toMatch(/Render scale\s+85%/);
    expect(text).toMatch(/Condition\s+rain/);
    expect(text).toMatch(/Temperature\s+11\.4 C/);
    expect(text).toMatch(/Humidity\s+83%/);
    expect(text).toMatch(/Moon phase\s+0\.42/);
    expect(text).toMatch(/Moon lit\s+77%/);
  });

  it('groups its lines under headings', () => {
    // The flat ten-line list gave every value the same weight, so the two a person
    // opening this wants were indistinguishable from three saying "unknown".
    const text = renderOverlay({ fps: 60 });
    for (const heading of ['--- Performance ---', '--- Sky ---', '--- Discovery ---', '--- System ---']) {
      expect(text).toContain(heading);
    }
  });

  it('reports discovery progress rather than just a count', () => {
    const text = renderOverlay({
      anomaliesSeen: 6,
      journalCount: 12,
      secretsFound: 3,
      secretsTotal: 7,
      eggsFound: 2,
      eggsTotal: 6,
    });
    expect(text).toMatch(/Anomalies\s+6 seen/);
    expect(text).toMatch(/Journal\s+12/);
    expect(text).toMatch(/Secrets\s+3\/7/);
    expect(text).toMatch(/Eggs\s+2\/6/);
  });

  it('renders nothing at all while hidden', () => {
    const overlay = new DebugOverlay();
    overlay.update({ fps: 120 });
    expect(document.getElementById('anomaly-debug-overlay')).toBeNull();
    overlay.dispose();
  });

  it('is idempotent: showing twice creates one panel, hiding twice removes it', () => {
    // The interval and the DOM node both have to survive a double toggle, or a user
    // clicking the tray item twice ends up with two repaint timers.
    const overlay = new DebugOverlay();
    overlay.show();
    overlay.show();
    expect(document.querySelectorAll('#anomaly-debug-overlay')).toHaveLength(1);

    overlay.hide();
    overlay.hide();
    expect(document.querySelectorAll('#anomaly-debug-overlay')).toHaveLength(0);
    expect(overlay.isVisible()).toBe(false);
    overlay.dispose();
  });

  it('leaves no timer behind after dispose', () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    const clearInterval = vi.spyOn(globalThis, 'clearInterval');

    const overlay = new DebugOverlay();
    overlay.show();
    const started = setInterval.mock.calls.length;
    expect(started).toBeGreaterThan(0);

    overlay.dispose();
    expect(clearInterval.mock.calls.length).toBeGreaterThan(0);
    expect(document.getElementById('anomaly-debug-overlay')).toBeNull();

    setInterval.mockRestore();
    clearInterval.mockRestore();
  });

  it('removes the panel from the document on dispose', () => {
    const overlay = new DebugOverlay();
    overlay.show();
    expect(document.getElementById('anomaly-debug-overlay')).not.toBeNull();
    overlay.dispose();
    expect(document.getElementById('anomaly-debug-overlay')).toBeNull();
  });

  it('escapes nothing it is given into the DOM as markup', () => {
    // It renders with textContent, which cannot produce markup. Asserted because the
    // alternative -- innerHTML -- would make a world name a script injection, and the
    // reason to check is that the safe version has to stay the safe version.
    const overlay = new DebugOverlay();
    overlay.show();
    overlay.update({ activeScene: '<img src=x onerror=alert(1)>' });
    const el = document.getElementById('anomaly-debug-overlay');
    expect(el?.querySelector('img')).toBeNull();
    expect(el?.textContent).toContain('<img src=x onerror=alert(1)>');
    overlay.dispose();
  });
});
