/**
 * The user's accessibility preferences, and the thing that makes them real.
 * This class was six booleans and three class names. `reducedMotion` did something,
 * because `main.ts` asked for it and capped the motion intensity. The other five did
 * not: `highContrast` and `muteAll` each toggled a class on `document.documentElement`
 * in a project with no stylesheet at all, and `keyboardNavigation`, `scalableUI` and
 * `focusVisible` were fields that nothing read, nothing set, nothing persisted, and
 * that no settings control could reach.
 *
 * Two of those classes were not merely inert, they were actively misleading. A
 * `pointer-events: none` field-notes panel with a class called `anomaly-muted` on the
 * root element looks, from the outside, like an accessibility feature. It is not; it is
 * a comment.
 *
 * So the preferences now have a stylesheet to act on -- injected once, here, rather
 * than shipped as a file nobody would think to update -- and the keys that describe
 * behaviour rather than appearance are read by the panels through the same object.
 */

import { PANEL_EVENTS } from '../core/windowEvents.js';

export interface AccessibilityConfig {
  reducedMotion: boolean;
  highContrast: boolean;
  muteAll: boolean;
  keyboardNavigation: boolean;
  scalableUI: boolean;
  focusVisible: boolean;
}

/**
 * What `scalableUI` multiplies the interface by.
 *
 * A multiplier rather than an absolute pixel size: the panels are sized in inline
 * pixels against a browser zoom the user already controls, so a factor composes with
 * their zoom instead of fighting it. 1.25 rather than 1.1 because 10% is not legible
 * from further away than 100% and a setting that can be turned on without visibly
 * doing anything is the same failure as a setting that does nothing at all.
 */
const SCALE_ON = '1.25';

const STYLE_ID = 'anomaly-accessibility';

/**
 * The stylesheet the preferences act through.
 *
 * Written here rather than in a `.css` file because there are no other stylesheets:
 * every panel styles itself from `style.cssText` at construction time, so a file would
 * be the only styling mechanism in the codebase and would lose the ordering fight
 * against inline styles on specificity ties. Appending a sheet means it wins without
 * `!important`, which keeps the rules readable.
 *
 * Scoped to the panel ids so nothing else on the page can be affected.
 */
function buildStylesheet(): string {
return `
:root.anomaly-scalable-ui { --anomaly-ui-scale: ${SCALE_ON}; }

/*
 * Scaling works by growing the panel's own font size. The panels are built from fixed
 * pixel font sizes in their own inline styles, so a font-size set here would lose to
 * them on specificity ties -- which is why this one rule needs the !important that no
 * other rule in this file uses. The alternative is rewriting every panel's typography
 * in ems, which is the better fix and is not this file's business.
 */
#anomaly-field-notes,
#anomaly-creator-panel,
#anomaly-debug-overlay {
  font-size: calc(1em * var(--anomaly-ui-scale, 1)) !important;
}

/*
 * High contrast on a dark panel means two things: the muted greys stop being the
 * primary text colour, and the panel stops being a translucent overlay with a blurred
 * backdrop -- a 0.9-alpha background over arbitrary wallpaper has no guaranteed
 * contrast ratio against whatever is behind it, which is the whole problem.
 */
:root.anomaly-high-contrast #anomaly-field-notes,
:root.anomaly-high-contrast #anomaly-creator-panel,
:root.anomaly-high-contrast #anomaly-debug-overlay {
  background: #000;
  backdrop-filter: none;
  border-color: #fff;
  color: #fff;
}

:root.anomaly-high-contrast #anomaly-field-notes div,
:root.anomaly-high-contrast #anomaly-field-notes p,
:root.anomaly-high-contrast #anomaly-field-notes h1,
:root.anomaly-high-contrast #anomaly-creator-panel div,
:root.anomaly-high-contrast #anomaly-creator-panel button {
  color: #fff;
}

:root.anomaly-high-contrast #anomaly-debug-overlay span {
  color: #fff;
}

/*
 * rather than inherited. The panels sit over a WebGL canvas
 * showing an arbitrary world at an arbitrary brightness, so the browser default ring --
 * which is often drawn in a colour chosen against the page background rather than
 * against what is actually under the cursor -- cannot be relied on to be visible.
 *
 * The :focus-visible pseudo-class rather than :focus, because a mouse press should not
 * leave a ring behind on a panel of read-only text.
 */
:root.anomaly-focus-visible #anomaly-field-notes :focus-visible,
:root.anomaly-focus-visible #anomaly-creator-panel :focus-visible {
  outline: 3px solid #7ee2a8;
  outline-offset: 2px;
  border-radius: 2px;
}

/*
 * Focus is only drawn when the keyboard brought it there, which the pseudo-class above
 * already encodes. This rule is what makes the panels themselves show it at all: they
 * are divs with a tabindex rather than native controls, and a div only matches
 * :focus-visible once it is given one.
 */
#anomaly-field-notes:focus-visible,
#anomaly-creator-panel:focus-visible {
  outline: 3px solid #7ee2a8;
  outline-offset: 2px;
}

/*
 * With keyboard navigation on, the close affordance is always painted. There is no
 * pointer to hover it on a wallpaper, so a control that only appears on hover is a
 * control that does not exist.
 */
:root.anomaly-keyboard-nav #anomaly-panel-close {
  opacity: 1;
}

#anomaly-panel-close {
  opacity: 0;
  transition: opacity 0.2s ease;
}

#anomaly-field-notes:hover #anomaly-panel-close,
#anomaly-creator-panel:hover #anomaly-panel-close {
  opacity: 1;
}

@media (prefers-reduced-motion: reduce) {
  #anomaly-field-notes,
  #anomaly-creator-panel {
    transition-duration: 0.01ms;
  }
}
`.trim();
}

export class AccessibilitySystem {
  private _config: AccessibilityConfig = {
    reducedMotion: false,
    highContrast: false,
    muteAll: false,
    keyboardNavigation: true,
    scalableUI: false,
    focusVisible: true,
  };

  private _listeners: ((config: AccessibilityConfig) => void)[] = [];
  private _styleEl: HTMLStyleElement | null = null;
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private _openPanels = new Set<HTMLElement>();

  constructor() {
    this._detectSystemPreferences();
    this._applyConfig();
  }

  private _detectSystemPreferences(): void {
    // `matchMedia` is absent in the test environment and in any non-browser host that
    // constructs this class, and a missing media query is not a preference either way.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this._config.reducedMotion = true;
    }
    if (window.matchMedia('(prefers-contrast: high)').matches) {
      this._config.highContrast = true;
    }
    // `prefers-contrast: more` is the values-in-CSS spelling; Chromium reports
    // `high` and Firefox reports `more`, and only supporting one of them means the
    // preference is detected on half the machines it was written for.
    if (window.matchMedia('(prefers-contrast: more)').matches) {
      this._config.highContrast = true;
    }
  }

  getConfig(): AccessibilityConfig {
    return { ...this._config };
  }

  /**
   * Applies a partial configuration.
   *
   * Keys are validated rather than spread: `setConfig({ reducedMotion: 'yes' })` from
   * a host event would otherwise store a string in a boolean field, where it reads as
   * truthy at every use and never fails anywhere obvious.
   */
  setConfig(config: Partial<AccessibilityConfig>): void {
    const next = { ...this._config };

    for (const key of BOOLEAN_KEYS) {
      const value = (config as Record<string, unknown>)[key];
      if (typeof value === 'boolean') next[key] = value;
    }

    this._config = next;
    this._applyConfig();
    this._listeners.forEach((fn) => fn(this._config));
  }

  /** The string key names, which is what the host channel speaks. */
  static readonly KEYS = [
    'reducedMotion',
    'highContrast',
    'muteAll',
    'keyboardNavigation',
    'scalableUI',
    'focusVisible',
  ] as const;

  /** Whether a name is one this system understands. */
  private isKnownKey(key: string): key is (typeof AccessibilitySystem.KEYS)[number] {
    return (AccessibilitySystem.KEYS as readonly string[]).includes(key);
  }

  /**
   * Applies one key by name.
   *
   * The host sends preferences as a name and a value rather than as a serialised
   * config, so a settings control cannot send a field the renderer does not have and a
   * renamed key cannot silently do nothing. Returns whether the name was understood.
   */
  setByKey(key: string, value: boolean): boolean {
    if (!this.isKnownKey(key)) return false;
    this.setConfig({ [key]: value } as Partial<AccessibilityConfig>);
    return true;
  }

  private _applyConfig(): void {
    const root = typeof document !== 'undefined' ? document.documentElement : null;
    if (!root) return;

    toggle(root, 'anomaly-reduced-motion', this._config.reducedMotion);
    toggle(root, 'anomaly-high-contrast', this._config.highContrast);
    toggle(root, 'anomaly-muted', this._config.muteAll);
    toggle(root, 'anomaly-keyboard-nav', this._config.keyboardNavigation);
    toggle(root, 'anomaly-scalable-ui', this._config.scalableUI);
    toggle(root, 'anomaly-focus-visible', this._config.focusVisible);

    root.style.setProperty(
      '--anomaly-ui-scale',
      this._config.scalableUI ? SCALE_ON : '1'
    );
    this._ensureStylesheet();
    this._syncKeyHandler();
  }

  /**
   * Injects the stylesheet once.
   *
   * Guarded by id rather than appended unconditionally because `setConfig` is called on
   * every preference change, and a wallpaper that has had its preferences changed six
   * times would otherwise carry six copies of the rules -- with the six that are no
   * longer the active ones still applying.
   */
  private _ensureStylesheet(): void {
    if (typeof document === 'undefined') return;
    if (this._styleEl?.isConnected) return;
    if (document.getElementById(STYLE_ID)) {
      this._styleEl = null;
      return;
    }
    const el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = buildStylesheet();
    document.head.appendChild(el);
    this._styleEl = el;
  }

  /**
   * Installs or removes the global key handler.
   *
   * One handler on `window` rather than one per panel: the panels are opened and
   * closed freely, and a handler that is attached on open and detached on close leaks
   * whenever a close path is missed. Escape belongs to whichever panel is open, and
   * "whichever" is decided by asking the set below.
   */
  private _syncKeyHandler(): void {
    if (typeof window === 'undefined') return;

    if (!this._config.keyboardNavigation) {
      if (this._keyHandler) {
        window.removeEventListener('keydown', this._keyHandler, true);
        this._keyHandler = null;
      }
      return;
    }

    if (this._keyHandler) return;

    this._keyHandler = (e: KeyboardEvent) => {
      // Capture phase, because the panels are siblings of whatever the focused
      // element is and a bubble-phase handler on window loses to a handler that calls
      // stopPropagation somewhere in between.
      if (e.key !== 'Escape' && e.key !== 'Tab') return;
      const panel = this._topPanel();
      if (!panel) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        panel.dispatchEvent(new CustomEvent(PANEL_EVENTS.dismiss, { bubbles: false }));
        return;
      }

      // Tab is kept inside an open panel. A wallpaper sits underneath whatever the
      // user is actually doing, so letting Tab walk off the panel means focus lands on
      // the page behind it and the keyboard user is typing into the void.
      const focusable = this._focusables(panel);
      if (!focusable.length) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (e.shiftKey && (active === first || active === panel || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || active === panel || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', this._keyHandler, true);
  }

  /** The most recently opened panel, which is the one on top of the stack. */
  private _topPanel(): HTMLElement | null {
    let top: HTMLElement | null = null;
    for (const panel of this._openPanels) top = panel;
    return top;
  }

  private _focusables(root: HTMLElement): HTMLElement[] {
    return Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
  }

  /**
   * Registers a panel so keyboard navigation can find it.
   *
   * The panel registers rather than being queried out of the document because
   * "which element is the panel" is a question with two answers in this project and
   * adding a third panel later should not mean updating a selector list here.
   */
  registerPanel(panel: HTMLElement): () => void {
    this._openPanels.add(panel);
    panel.setAttribute('tabindex', '-1');
    if (this._config.keyboardNavigation) panel.focus({ preventScroll: true });
    return () => {
      this._openPanels.delete(panel);
    };
  }

  shouldReduceMotion(): boolean {
    return this._config.reducedMotion;
  }

  shouldUseHighContrast(): boolean {
    return this._config.highContrast;
  }

  shouldMuteAll(): boolean {
    return this._config.muteAll;
  }

  /**
 * Whether the panels should be keyboard operable.
 *
 * Not a separate accessor: `getConfig()` carries it, and the settings window reads the
 * whole config through the status document. A single-key form of a six-field object is
 * only worth publishing when something actually asks for that one key.
 */

/** The active text-size multiplier. */
  getUiScale(): number {
    return this._config.scalableUI ? Number(SCALE_ON) : 1;
  }

  onConfigChange(listener: (config: AccessibilityConfig) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this._listeners = [];
    this._openPanels.clear();
    if (this._keyHandler && typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._keyHandler, true);
    }
    this._keyHandler = null;
    this._styleEl?.remove();
    this._styleEl = null;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove(...ALL_CLASSES);
      document.documentElement.style.removeProperty('--anomaly-ui-scale');
    }
  }
}

const BOOLEAN_KEYS = [
  'reducedMotion',
  'highContrast',
  'muteAll',
  'keyboardNavigation',
  'scalableUI',
  'focusVisible',
] as const;

const ALL_CLASSES = [
  'anomaly-reduced-motion',
  'anomaly-high-contrast',
  'anomaly-muted',
  'anomaly-keyboard-nav',
  'anomaly-scalable-ui',
  'anomaly-focus-visible',
];

function toggle(root: HTMLElement, className: string, on: boolean): void {
  if (on) root.classList.add(className);
  else root.classList.remove(className);
}