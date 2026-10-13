import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AccessibilitySystem } from '../src/platform/AccessibilitySystem.js';
import { FieldNotes } from '../src/platform/FieldNotes.js';
import { CreatorMode } from '../src/platform/CreatorMode.js';
import { I18n } from '../src/platform/I18n.js';
import { PANEL_EVENTS } from '../src/core/windowEvents.js';

/**
 * That the six accessibility preferences do something.
 *
 * Five of them did nothing at all. `highContrast` and `muteAll` each set a class name
 * on the document root, in a project with no stylesheet; `keyboardNavigation`,
 * `scalableUI` and `focusVisible` were fields no code read and no control could reach.
 * A test that only checked the flags would have passed against all of that, so every
 * assertion here is about an *effect* in the document, the renderer-facing system, or
 * the panel's behaviour.
 */
describe('AccessibilitySystem', () => {
  let a11y: AccessibilitySystem;

  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('style');
    document.getElementById('anomaly-accessibility')?.remove();
    a11y = new AccessibilitySystem();
  });

  afterEach(() => {
    a11y.dispose();
  });

  const root = () => document.documentElement;

  it('injects a stylesheet, because the classes it sets otherwise match nothing', () => {
    // The original state of this feature: classes on the root element, and a project
    // with no CSS at all.
    expect(document.getElementById('anomaly-accessibility')).not.toBeNull();
    expect(document.getElementById('anomaly-accessibility')?.textContent).toContain(
      'anomaly-scalable-ui'
    );
  });

  it('does not inject a second copy when preferences change', () => {
    // A wallpaper whose preferences were changed six times would otherwise carry six
    // sheets, five of which are no longer the active ones.
    a11y.setConfig({ highContrast: true });
    a11y.setConfig({ highContrast: false });
    a11y.setConfig({ muteAll: true });
    expect(document.querySelectorAll('#anomaly-accessibility')).toHaveLength(1);
  });

  it.each([
    ['reducedMotion', 'anomaly-reduced-motion'],
    ['highContrast', 'anomaly-high-contrast'],
    ['muteAll', 'anomaly-muted'],
    ['keyboardNavigation', 'anomaly-keyboard-nav'],
    ['scalableUI', 'anomaly-scalable-ui'],
    ['focusVisible', 'anomaly-focus-visible'],
  ] as const)('%s puts %s on the root element', (key, className) => {
    a11y.setConfig({ [key]: false });
    expect(root().classList.contains(className)).toBe(false);
    a11y.setConfig({ [key]: true });
    expect(root().classList.contains(className)).toBe(true);
  });

  it('sets a scale multiplier rather than a fixed size', () => {
    expect(root().style.getPropertyValue('--anomaly-ui-scale')).toBe('1');
    a11y.setConfig({ scalableUI: true });
    expect(root().style.getPropertyValue('--anomaly-ui-scale')).toBe('1.25');
    expect(a11y.getUiScale()).toBe(1.25);
  });

  it('ignores a value of the wrong type instead of storing it', () => {
    // `setConfig({ reducedMotion: 'yes' })` from a host event would otherwise leave a
    // string in a boolean field, which reads as truthy at every use and never fails
    // anywhere obvious.
    a11y.setConfig({ reducedMotion: true });
    a11y.setConfig({ reducedMotion: 'yes' } as never);
    expect(a11y.shouldReduceMotion()).toBe(true);
  });

  it('routes a named preference through and rejects an unknown name', () => {
    expect(a11y.setByKey('highContrast', true)).toBe(true);
    expect(a11y.shouldUseHighContrast()).toBe(true);
    // Returning false is what lets the caller log it rather than storing a field that
    // reads back as a preference the user never made.
    expect(a11y.setByKey('prefersMoons', true)).toBe(false);
    expect(a11y.getConfig()).not.toHaveProperty('prefersMoons');
  });

  it('advertises exactly the keys it will store', () => {
    // Two arrays in one class, so nothing but this catches a key in one and not the
    // other -- which would be accepted over the host channel and silently discarded.
    expect([...AccessibilitySystem.KEYS].sort()).toEqual(
      Object.keys(a11y.getConfig()).sort()
    );
  });

  it('cleans up after itself on dispose', () => {
    a11y.setConfig({ highContrast: true, scalableUI: true });
    a11y.dispose();
    expect(root().classList.contains('anomaly-high-contrast')).toBe(false);
    expect(root().style.getPropertyValue('--anomaly-ui-scale')).toBe('');
    expect(document.getElementById('anomaly-accessibility')).toBeNull();
  });
});

describe('FieldNotes panel', () => {
  let a11y: AccessibilitySystem;
  let notes: FieldNotes;

  beforeEach(() => {
    document.documentElement.className = '';
    document.body.innerHTML = '';
    a11y = new AccessibilitySystem();
    notes = new FieldNotes();
    notes.useAccessibility(a11y);
  });

  afterEach(() => {
    notes.dispose();
    a11y.dispose();
    vi.useRealTimers();
  });

  const panel = () => document.getElementById('anomaly-field-notes') as HTMLElement;
  const press = (key: string, opts: KeyboardEventInit = {}) =>
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));

  it('can be scrolled with a pointer', () => {
    // It declared `overflow-y: auto` and `pointer-events: none`: a scrollbar that
    // cannot be scrolled, so on a short display the bottom of the journal was
    // unreachable and could not be selected.
    notes.show({ world: null, journal: [], secrets: [], secretDefinitions: [], sessions: 0, firstRun: null, anomaliesSeen: 0 });
    expect(panel().style.pointerEvents).toBe('auto');
  });

  it('is a labelled dialog', () => {
    notes.show({ world: null, journal: [], secrets: [], secretDefinitions: [], sessions: 0, firstRun: null, anomaliesSeen: 0 });
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-label')).toBeTruthy();
    expect(panel().getAttribute('tabindex')).toBe('-1');
  });

  it('takes focus when it opens, so the keyboard is not left on the desktop behind it', () => {
    notes.show({ world: null, journal: [], secrets: [], secretDefinitions: [], sessions: 0, firstRun: null, anomaliesSeen: 0 });
    expect(document.activeElement).toBe(panel());
  });

  it('closes on Escape', () => {
    notes.show({ world: null, journal: [], secrets: [], secretDefinitions: [], sessions: 0, firstRun: null, anomaliesSeen: 0 });
    press('Escape');
    expect(notes.isVisible()).toBe(false);
  });

  it('does not steal Escape when no panel is open', () => {
    // The wallpaper sits under whatever the user is actually doing.
    let prevented = false;
    window.addEventListener('keydown', (e) => { if (e.defaultPrevented) prevented = true; });
    press('Escape');
    expect(prevented).toBe(false);
  });

  it('closes when the close button is clicked', () => {
    notes.show({ world: null, journal: [], secrets: [], secretDefinitions: [], sessions: 0, firstRun: null, anomaliesSeen: 0 });
    const close = panel().querySelector('#anomaly-panel-close') as HTMLButtonElement;
    expect(close).not.toBeNull();
    expect(close.getAttribute('aria-label')).toBe('Close');
    close.click();
    expect(notes.isVisible()).toBe(false);
  });

  it('keeps the close button working after a refresh replaces the panel contents', () => {
    // `_render` replaces the innerHTML. A listener bound to the button itself is
    // dropped by the next render and the control stops working after one update --
    // which is the failure mode that delegation exists to prevent.
    notes.show({ world: null, journal: [], secrets: [], secretDefinitions: [], sessions: 0, firstRun: null, anomaliesSeen: 0 });
    notes.show({ anomaliesSeen: 4 });
    const close = panel().querySelector('#anomaly-panel-close') as HTMLButtonElement;
    close.click();
    expect(notes.isVisible()).toBe(false);
  });

  it('keeps Tab inside the panel', () => {
    notes.show({ world: null, journal: [], secrets: [], secretDefinitions: [], sessions: 0, firstRun: null, anomaliesSeen: 0 });
    const close = panel().querySelector('#anomaly-panel-close') as HTMLButtonElement;
    close.focus();

    // Forward from the last focusable wraps to the first; there is only one, so this
    // is the assertion that focus did not leave.
    press('Tab');
    expect(document.activeElement).toBe(close);

    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(close);
  });

  it('ignores keyboard handling entirely when the preference is off', () => {
    a11y.setConfig({ keyboardNavigation: false });
    notes.show({ world: null, journal: [], secrets: [], secretDefinitions: [], sessions: 0, firstRun: null, anomaliesSeen: 0 });
    press('Escape');
    expect(notes.isVisible()).toBe(true);
  });

  it('stops listening after hide', () => {
    notes.show({ world: null, journal: [], secrets: [], secretDefinitions: [], sessions: 0, firstRun: null, anomaliesSeen: 0 });
    notes.hide();
    a11y.dispose();
    expect(() => press('Escape')).not.toThrow();
  });

  it('translates the strings that were hardcoded in English', () => {
    const i18n = new I18n();
    i18n.setLocale('de');
    notes.useTranslator(i18n);
    notes.show({
      world: null,
      journal: [],
      secrets: [],
      secretDefinitions: [],
      sessions: 2,
      firstRun: '2024-01-01',
      anomaliesSeen: 0,
    });
    const text = panel().textContent ?? '';
    expect(text).toContain('Beobachtungen');
    expect(text).toContain('Sitzungen');
    expect(text).toContain('Erstmals erfasst');
    expect(text).not.toContain('Observations');
    expect(text).not.toContain('sessions');
  });
});

describe('CreatorMode panel', () => {
  let a11y: AccessibilitySystem;
  let creator: CreatorMode;

  beforeEach(() => {
    document.documentElement.className = '';
    document.body.innerHTML = '';
    a11y = new AccessibilitySystem();
    creator = new CreatorMode();
    creator.useAccessibility(a11y);
  });

  afterEach(() => {
    creator.dispose();
    a11y.dispose();
  });

  const panel = () => document.getElementById('anomaly-creator-panel') as HTMLElement;

  it('opens as a labelled dialog', () => {
    creator.enable();
    expect(panel().getAttribute('role')).toBe('dialog');
    expect(panel().getAttribute('aria-label')).toBe('Creator Mode');
    expect(panel().getAttribute('tabindex')).toBe('-1');
  });

  it('closes on Escape', () => {
    creator.enable();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(creator.isEnabled()).toBe(false);
    expect(document.getElementById('anomaly-creator-panel')).toBeNull();
  });

  it('closes on its close button', () => {
    creator.enable();
    (panel().querySelector('#anomaly-panel-close') as HTMLButtonElement).click();
    expect(creator.isEnabled()).toBe(false);
  });

  it('dismisses through the shared panel event, not a private one', () => {
    // The name lives in PANEL_EVENTS so the accessibility system and the panels cannot
    // disagree about it, which is the whole reason the constant exists.
    creator.enable();
    panel().dispatchEvent(new CustomEvent(PANEL_EVENTS.dismiss));
    expect(creator.isEnabled()).toBe(false);
  });

  it('leaves no panel behind after dispose', () => {
    creator.enable();
    creator.dispose();
    expect(document.getElementById('anomaly-creator-panel')).toBeNull();
  });
});