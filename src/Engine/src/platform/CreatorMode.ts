import type { DebugOverlay } from './DebugOverlay.js';
import { WINDOW_EVENTS, PANEL_EVENTS } from '../core/windowEvents.js';
import { EN_STRINGS, type Translate } from './I18n.js';
import type { AccessibilitySystem } from './AccessibilitySystem.js';

export interface CreatorModeConfig {
  enabled: boolean;
  showDebugOverlay: boolean;
  allowEventTrigger: boolean;
  allowTimeSimulation: boolean;
  allowWeatherSimulation: boolean;
}

export class CreatorMode {
  private _config: CreatorModeConfig = {
    enabled: false,
    showDebugOverlay: true,
    allowEventTrigger: true,
    allowTimeSimulation: true,
    allowWeatherSimulation: true,
  };

  private _debugOverlay: DebugOverlay | null = null;
  private _panel: HTMLElement | null = null;

  /**
   * The translator, held by reference rather than captured at construction.
   *
   * A function passed to the constructor freezes the locale at that moment, so a
   * language change would leave the panel in the old language until it was closed and
   * reopened. Holding the object instead and asking it at render time means a locale
   * switch re-renders correctly, which is the whole point of being able to switch.
   */
  private _i18n: { t: Translate } = { t: (key) => EN_STRINGS[key] };

  /** Attaches the engine's translator. Without one, the panel is English. */
  useTranslator(i18n: { t: Translate }): void {
    this._i18n = i18n;
    if (this._panel) this._renderPanel();
  }

  private _t(key: Parameters<Translate>[0]): string {
    return this._i18n.t(key);
  }

  /**
   * Attaches the accessibility preferences.
   *
   * Optional, for the same reason as on the field-notes panel: the panel works without
   * it and loses only the focus ring, the Escape shortcut and the enlarged text.
   */
  useAccessibility(a11y: AccessibilitySystem): void {
    this._unregister?.();
    this._a11y = a11y;
    if (this._panel) this._registerPanel();
  }

  private _a11y: AccessibilitySystem | null = null;
  private _unregister: (() => void) | null = null;

  private _registerPanel(): void {
    if (!this._panel || !this._a11y) return;
    this._unregister = this._a11y.registerPanel(this._panel);
    this._panel.addEventListener(PANEL_EVENTS.dismiss, this._onDismiss);
    // Delegated, because `_renderPanel` replaces the innerHTML and a listener bound to
    // the close button itself would be dropped by the next render.
    this._panel.addEventListener('click', this._onClick);
  }

  private _onDismiss = (): void => {
    this.disable();
  };

  private _onClick = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.('#anomaly-panel-close')) return;
    this.disable();
  };

  enable(): void {
    this._config.enabled = true;
    if (this._config.showDebugOverlay) {
      this._showDebugOverlay();
    }
    this._createPanel();
  }

  disable(): void {
    this._config.enabled = false;
    this._hideDebugOverlay();
    this._destroyPanel();
  }

  isEnabled(): boolean {
    return this._config.enabled;
  }

  getConfig(): CreatorModeConfig {
    return { ...this._config };
  }

  setConfig(config: Partial<CreatorModeConfig>): void {
    this._config = { ...this._config, ...config };
  }

  triggerEvent(eventId: string): void {
    if (!this._config.allowEventTrigger) return;
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.triggerEvent, { detail: { eventId } }));
  }

  setSimulatedTime(hour: number, minute: number): void {
    if (!this._config.allowTimeSimulation) return;
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.setTime, { detail: { hour, minute } }));
  }

  setSimulatedWeather(condition: string): void {
    if (!this._config.allowWeatherSimulation) return;
    window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.setWeather, { detail: { condition } }));
  }

  private _showDebugOverlay(): void {
    // Creator mode does not own a real DebugOverlay; the engine holds the single
    // instance so there is one source of truth for overlay state. This no-op
    // satisfies the interface without creating a second, unowned overlay.
    this._debugOverlay = null;
  }

  private _hideDebugOverlay(): void {
    if (this._debugOverlay) {
      this._debugOverlay.dispose();
      this._debugOverlay = null;
    }
  }

  private _createPanel(): void {
    this._panel = document.createElement('div');
    this._panel.id = 'anomaly-creator-panel';
    this._panel.setAttribute('role', 'dialog');
    this._panel.setAttribute('aria-modal', 'false');
    this._panel.setAttribute('aria-label', this._t('creator.title'));
    this._panel.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(20, 20, 40, 0.95);
      color: #e0e0ff;
      font-family: 'Plex Mono', Consolas, monospace;
      font-size: 12px;
      padding: 16px;
      border-radius: 6px;
      z-index: 999998;
      width: 280px;
      border: 1px solid rgba(100, 100, 200, 0.3);
    `;
    document.body.appendChild(this._panel);
    this._renderPanel();
    this._registerPanel();
  }

  private _destroyPanel(): void {
    this._unregister?.();
    this._unregister = null;
    this._panel?.removeEventListener(PANEL_EVENTS.dismiss, this._onDismiss);
    this._panel?.removeEventListener('click', this._onClick);
    this._panel?.remove();
    this._panel = null;
  }

  private _renderPanel(): void {
    if (!this._panel) return;
    const t = (key: Parameters<Translate>[0]) => this._t(key);
    this._panel.innerHTML = `
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">
        <h3 style="margin:0;color:#8888ff;">${t('creator.title')}</h3>
        <button id="anomaly-panel-close" type="button" aria-label="${t('common.close')}"
          style="margin:-4px -4px 0 0;width:24px;height:24px;flex:0 0 auto;cursor:pointer;
                 background:transparent;border:1px solid rgba(100,100,200,.45);border-radius:5px;
                 color:#c9c6be;font-size:14px;line-height:1;padding:0">&times;</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button id="cm-trigger-event" style="padding:6px;cursor:pointer;">${t('creator.triggerEvent')}</button>
        <button id="cm-set-time" style="padding:6px;cursor:pointer;">${t('creator.setTime')}</button>
        <button id="cm-set-weather" style="padding:6px;cursor:pointer;">${t('creator.setWeather')}</button>
        <button id="cm-reload-world" style="padding:6px;cursor:pointer;">${t('creator.reloadWorld')}</button>
        <button id="cm-screenshot" style="padding:6px;cursor:pointer;">${t('creator.screenshot')}</button>
      </div>
    `;

    this._panel.querySelector('#cm-trigger-event')?.addEventListener('click', () => {
      const id = prompt(t('creator.prompt.eventId'));
      if (id) this.triggerEvent(id);
    });
    this._panel.querySelector('#cm-set-time')?.addEventListener('click', () => {
      const time = prompt(t('creator.prompt.time'));
      if (time) {
        const [h, m] = time.split(':').map(Number);
        this.setSimulatedTime(h, m);
      }
    });
    this._panel.querySelector('#cm-set-weather')?.addEventListener('click', () => {
      const condition = prompt(t('creator.prompt.weather'));
      if (condition) this.setSimulatedWeather(condition);
    });
    this._panel.querySelector('#cm-reload-world')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.reloadWorld));
    });
    this._panel.querySelector('#cm-screenshot')?.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent(WINDOW_EVENTS.screenshot));
    });
  }

  dispose(): void {
    this.disable();
  }
}
