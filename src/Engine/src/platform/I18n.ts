export interface LocaleStrings {
  [key: string]: string;
}

export interface Locale {
  code: string;
  name: string;
  strings: LocaleStrings;
}

const DEFAULT_LOCALE: Locale = {
  code: 'en',
  name: 'English',
  strings: {
    'app.title': 'Anomaly Engine',
    'app.tagline': 'A live wallpaper engine where the desktop behaves like a living world.',
    'settings.home': 'Home',
    'settings.worlds': 'Worlds',
    'settings.appearance': 'Appearance',
    'settings.performance': 'Performance',
    'settings.events': 'Events',
    'settings.monitors': 'Displays',
    'settings.notes': 'Field Notes',
    'settings.integrations': 'Integrations',
    'settings.about': 'About',
    'performance.fps': 'FPS',
    'performance.quality': 'Quality',
    'performance.fullscreenPause': 'Pause on fullscreen',
    'performance.batteryMode': 'Battery mode',
    'events.enableSources': 'Enable sources',
    'events.frequency': 'Event frequency',
    'events.rareEvents': 'Rare events',
    'events.internetEvents': 'Internet events',
    'events.systemEvents': 'System events',
    'world.activate': 'Activate',
    'world.preview': 'Preview',
    'world.favorite': 'Favorite',
    'world.delete': 'Delete',
    'world.import': 'Import',
    'world.openFolder': 'Open folder',
    'secrets.discovered': 'Discovered anomalies',
    'secrets.journal': 'Journal',
    'secrets.progress': 'Progress',
    'tray.open': 'Open',
    'tray.pause': 'Pause',
    'tray.resume': 'Resume',
    'tray.nextWorld': 'Next World',
    'tray.triggerEvent': 'Trigger Event',
    'tray.performanceMode': 'Performance Mode',
    'tray.settings': 'Settings',
    'tray.about': 'About',
    'tray.exit': 'Exit',
  },
};

import { ES_LOCALE } from './locales/es.js';
import { DE_LOCALE } from './locales/de.js';
import { JA_LOCALE } from './locales/ja.js';

/**
 * The built-in locales, as a factory rather than a shared map.
 *
 * This was a module-level `Map`, which meant every I18n instance shared one set of
 * locales and `registerLocale` was global: a locale added to one instance turned up
 * in every other, with no way to remove it. The engine only ever builds one I18n, so
 * it never showed. It did show immediately in a test, where a locale registered to
 * exercise the fallback path appeared in the next test's list of available locales.
 */
function builtInLocales(): Map<string, Locale> {
  return new Map<string, Locale>([
    ['en', DEFAULT_LOCALE],
    ['es', ES_LOCALE],
    ['de', DE_LOCALE],
    ['ja', JA_LOCALE],
  ]);
}

export class I18n {
  private _locales: Map<string, Locale> = builtInLocales();
  private _currentLocale: Locale = DEFAULT_LOCALE;

  setLocale(code: string): boolean {
    const locale = this._locales.get(code);
    if (!locale) return false;
    this._currentLocale = locale;
    return true;
  }

  getLocale(): Locale {
    return this._currentLocale;
  }

  t(key: string): string {
    return this._currentLocale.strings[key] ?? DEFAULT_LOCALE.strings[key] ?? key;
  }

  registerLocale(locale: Locale): void {
    this._locales.set(locale.code, locale);
  }

  getAvailableLocales(): Locale[] {
    return Array.from(this._locales.values());
  }

  dispose(): void {
    this._currentLocale = DEFAULT_LOCALE;
  }
}
