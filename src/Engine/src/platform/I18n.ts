export interface LocaleStrings {
  [key: string]: string;
}

export interface Locale {
  code: string;
  name: string;
  strings: LocaleStrings;
}

/**
 * Every string the engine puts in front of a user, in English.
 *
 * This table is the source of truth for the key *set*: the locale files are typed
 * against it, so adding a key here without adding it to es/de/ja is a compile error
 * rather than a fallback to English at runtime that nobody notices until a German user
 * reports it. `tools/i18n-audit.mjs` walks the other direction -- every key here is
 * actually used by a surface -- because a key nothing reads is a translation nobody
 * sees.
 */
export const EN_STRINGS = {
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

  // --- creator mode ---------------------------------------------------------
  'creator.title': 'Creator Mode',
  'creator.triggerEvent': 'Trigger Event',
  'creator.setTime': 'Set Time',
  'creator.setWeather': 'Set Weather',
  'creator.reloadWorld': 'Reload World',
  'creator.screenshot': 'Screenshot',
  'creator.prompt.eventId': 'Event ID:',
  'creator.prompt.time': 'Time (HH:MM):',
  'creator.prompt.weather': 'Weather condition:',

  // --- field notes ----------------------------------------------------------
  'notes.title': 'Field notes',
  'notes.alsoConsistentWith': 'Also consistent with',
  'notes.empty': 'Nothing written down yet.',
  'notes.observed': 'observed',
  'notes.ofCount': 'of {n} notes',
  'notes.seed': 'seed',
  'notes.unrecorded': 'Unrecorded.',
  // These five were written into the panel as literal English while the rest of it
  // went through the translator, so the field-notes page was the one surface that
  // stayed English for a German or Japanese reader. `tools/i18n-audit.mjs` cannot see
  // a hardcoded string, which is why they survived it.
  'notes.observations': 'Observations',
  'notes.openQuestions': 'Open questions',
  'notes.sessions': 'sessions',
  'notes.firstRecorded': 'First recorded {date}.',
  'notes.dismisses': 'Dismisses on its own, or press Escape.',

  // --- panels ---------------------------------------------------------------
  // Shared by every dismissible overlay, because the close button and the Escape
  // shortcut are both new and neither can be announced without a label.
  'common.close': 'Close',

  // --- zone hints -----------------------------------------------------------
  // Shown on hover, before anything has been clicked. Each one describes the thing it
  // is attached to and promises nothing about what clicking will do.
  'hint.observatory': 'The dome is shut. The shutter has not moved in a long time.',
  'hint.radioTower': 'The carrier is still going. Nobody answers it.',
  'hint.cabin': 'Smoke, most nights. No one has come out of it.',
  'hint.lighthouse': 'The light keeps the interval it was given.',
  'hint.forest': 'The treeline is not moving.',
  'hint.moon': 'It is the right shape and the wrong distance.',
} as const satisfies Record<string, string>;

export type UiKey = keyof typeof EN_STRINGS;

/** The complete key set, for the audit and for tests. */
export const UI_KEYS = Object.keys(EN_STRINGS) as UiKey[];

const DEFAULT_LOCALE: Locale = {
  code: 'en',
  name: 'English',
  strings: { ...EN_STRINGS },
};

import { ES_LOCALE } from './locales/es.js';
import { DE_LOCALE } from './locales/de.js';
import { JA_LOCALE } from './locales/ja.js';

/** Values for `{name}` placeholders in a translated string. */
export type TranslateValues = Record<string, string | number>;

/** Anything that can turn a key into a display string. */
export type Translate = (key: UiKey, values?: TranslateValues) => string;

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

  /**
   * Looks up a key and substitutes `{name}` placeholders.
   *
   * An unknown key returns the key itself rather than an empty string. That is the
   * behaviour worth having: a missing translation should be visible in the interface
   * as `notes.empty`, where someone reading the screen can report it, rather than as a
   * gap that looks deliberate.
   *
   * Placeholders are `{name}` and not `%s` or `$1` because the translations are read
   * and edited by people who are not reading this file, and `{n}` is the only notation
   * that shows up in a spreadsheet cell as what it is.
   */
  t(key: UiKey, values?: TranslateValues): string {
    const template = this._currentLocale.strings[key] ?? EN_STRINGS[key] ?? key;
    if (!values) return template;
    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      name in values ? String(values[name]) : whole
    );
  }

  /** A standalone translator bound to the current locale. */
  translator(): Translate {
    return (key, values) => this.t(key, values);
  }

  /**
   * Picks the best available locale for a list of language tags.
   *
   * `navigator.languages` is an ordered preference list, so the first tag we can
   * satisfy wins. A tag is matched by its primary subtag: `de-AT`, `de-CH` and `de` all
   * resolve to German, and `en-GB` resolves to English. A tag whose primary subtag we
   * do not ship -- `fr-CA` -- is skipped rather than treated as a failed match, because
   * the next tag in the list may well be one we have.
   *
   * With nothing to match, English is returned, which is the same answer as an empty
   * list rather than a special case at every call site.
   */
  detect(preferred: readonly string[] = []): string {
    for (const tag of preferred) {
      const primary = String(tag).toLowerCase().split(/[-_]/)[0];
      if (this._locales.has(primary)) return primary;
    }
    return 'en';
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
