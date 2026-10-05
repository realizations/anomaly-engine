import { describe, it, expect } from 'vitest';
import { I18n } from '../src/platform/I18n.js';
import { ES_LOCALE } from '../src/platform/locales/es.js';
import { DE_LOCALE } from '../src/platform/locales/de.js';
import { JA_LOCALE } from '../src/platform/locales/ja.js';

/**
 * Locale parity.
 *
 * The translations were complete and correct, and nothing checked that. A key added
 * to English would simply be absent everywhere else, and a key renamed in English
 * would leave its translation orphaned under a name no one asks for any more --
 * neither of which is visible from the running product, because the fallback in `t()`
 * is to English and a fallback that works is indistinguishable from a translation
 * that is present.
 *
 * The settings keys are also pinned to the nine pages the settings window actually
 * has. It had `settings.audio` and `settings.secrets`, neither of which is a page,
 * and no `settings.notes` for the one that is. Same failure as the moment ids: a
 * name that nothing checks.
 */
const LOCALES = { es: ES_LOCALE, de: DE_LOCALE, ja: JA_LOCALE };

const SETTINGS_PAGES = [
  'home',
  'worlds',
  'appearance',
  'performance',
  'events',
  'notes',
  'monitors',
  'integrations',
  'about',
];

describe('I18n', () => {
  const english = new I18n();

  it('defaults to English', () => {
    expect(english.getLocale().code).toBe('en');
  });

  it.each(Object.entries(LOCALES))('%s carries exactly the English key set', (code, locale) => {
    const en = Object.keys(english.getLocale().strings).sort();
    const other = Object.keys(locale.strings).sort();
    const missing = en.filter((k) => !other.includes(k));
    const extra = other.filter((k) => !en.includes(k));
    expect({ code, missing, extra }).toEqual({ code, missing: [], extra: [] });
  });

  it.each(Object.entries(LOCALES))('%s translates every string rather than copying English', (code, locale) => {
    // A handful of strings are legitimately identical across languages -- "FPS" is
    // "FPS" everywhere -- so this only catches wholesale copying of English values.
    const untranslated = Object.entries(locale.strings).filter(
      ([key, value]) => value === english.t(key) && /[a-z]{3,}/.test(english.t(key))
    );
    expect({ code, untranslated: untranslated.map(([k]) => k) }).toEqual({ code, untranslated: [] });
  });

  it('has a settings key for each settings page, and no others', () => {
    const settingsKeys = Object.keys(english.getLocale().strings)
      .filter((k) => k.startsWith('settings.'))
      .map((k) => k.slice('settings.'.length))
      .sort();
    expect(settingsKeys).toEqual([...SETTINGS_PAGES].sort());
  });

  it('switches locale and back', () => {
    const i = new I18n();
    expect(i.setLocale('ja')).toBe(true);
    expect(i.getLocale().code).toBe('ja');
    expect(i.t('settings.home')).not.toBe('Home');
    expect(i.setLocale('en')).toBe(true);
    expect(i.t('settings.home')).toBe('Home');
  });

  it('refuses a locale it does not have rather than half-switching', () => {
    const i = new I18n();
    i.setLocale('de');
    expect(i.setLocale('xx')).toBe(false);
    expect(i.getLocale().code).toBe('de');
  });

  it('falls back to English for a key a locale is missing', () => {
    const i = new I18n();
    i.registerLocale({ code: 'xx', name: 'Test', strings: { 'tray.pause': 'Stop' } });
    i.setLocale('xx');
    expect(i.t('tray.pause')).toBe('Stop');
    // Absent entirely: the key itself comes back, which makes a missing string
    // visible in the interface rather than rendering as nothing.
    expect(i.t('tray.about')).toBe('About');
    expect(i.t('no.such.key')).toBe('no.such.key');
  });

  it('reports the locales it has', () => {
    const codes = new I18n().getAvailableLocales().map((l) => l.code).sort();
    expect(codes).toEqual(['de', 'en', 'es', 'ja']);
  });
});