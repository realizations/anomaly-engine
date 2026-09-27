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
    'settings.audio': 'Audio',
    'settings.monitors': 'Monitors',
    'settings.integrations': 'Integrations',
    'settings.secrets': 'Secrets',
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

const locales: Map<string, Locale> = new Map([['en', DEFAULT_LOCALE]]);

export class I18n {
  private _currentLocale: Locale = DEFAULT_LOCALE;

  setLocale(code: string): boolean {
    const locale = locales.get(code);
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
    locales.set(locale.code, locale);
  }

  getAvailableLocales(): Locale[] {
    return Array.from(locales.values());
  }

  dispose(): void {
    this._currentLocale = DEFAULT_LOCALE;
  }
}
