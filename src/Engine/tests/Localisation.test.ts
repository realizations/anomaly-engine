import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { I18n, EN_STRINGS, UI_KEYS } from '../src/platform/I18n.js';
import { ES_LOCALE } from '../src/platform/locales/es.js';
import { DE_LOCALE } from '../src/platform/locales/de.js';
import { JA_LOCALE } from '../src/platform/locales/ja.js';
import { CreatorMode } from '../src/platform/CreatorMode.js';
import { describeZones } from '../src/systems/landmarkZones.js';
import type { InteractionSurfaces, LandmarkRect, ScreenRect } from '../src/renderer/WorldRenderer.js';

/**
 * That the translations are reachable, rather than shipped.
 *
 * Three complete, correct locale files sat in the repository for the length of this
 * project and `getI18n()` returned an object whose `t()` nothing ever called. The
 * README's own status table listed localisation under "Scaffold" for exactly that
 * reason. They are complete; what was missing was a producer, and a producer is easy
 * to add and easy to leave unconnected -- which is the same failure as an egg with no
 * trigger, or a tray item that dispatches nothing.
 *
 * So these tests are about reachability and coverage, not about the translations being
 * good. A native speaker judges those; this file only proves a string a user can see
 * actually goes through `t()`, and that a key nobody renders does not sit in the table
 * pretending to be translated.
 */

const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const ALL_SOURCE = sourceFiles(SRC);

describe('locale selection', () => {
  it('matches a regional tag to the language it belongs to', () => {
    // `de-AT` and `de-CH` are Austrian and Swiss German. Both are German, and a user
    // running either should not be shown English because the tag has a region on it.
    const i = new I18n();
    expect(i.detect(['de-AT', 'en-GB'])).toBe('de');
    expect(i.detect(['ja-JP'])).toBe('ja');
    expect(i.detect(['es-419', 'fr'])).toBe('es');
  });

  it('skips a language we do not ship rather than giving up', () => {
    // `fr-CA` is first in the list and unshipped. Treating it as a match would leave
    // every French-Canadian user on English even when Japanese is their second
    // preference, which is what the ordered list is for.
    const i = new I18n();
    expect(i.detect(['fr-CA', 'ja-JP'])).toBe('ja');
  });

  it('falls back to English when nothing matches', () => {
    expect(new I18n().detect([])).toBe('en');
    expect(new I18n().detect(['fr', 'it-IT'])).toBe('en');
  });

  it('refuses a code we do not have, keeping the current language', () => {
    // Deliberately not falling back to English: a mistyped `anomaly:locale` from the
    // host should not silently reset someone's interface out from under them.
    const i = new I18n();
    i.setLocale('ja');
    expect(i.setLocale('kl')).toBe(false);
    expect(i.getLocale().code).toBe('ja');
  });
});

describe('placeholder substitution', () => {
  it('substitutes a named placeholder', () => {
    const i = new I18n();
    expect(i.t('notes.ofCount', { n: 7 })).toBe('of 7 notes');
    i.setLocale('es');
    // Spanish puts the count before the noun, so the placeholder has to move with the
    // word. This is the reason placeholders are `{name}` rather than a fixed position.
    expect(i.t('notes.ofCount', { n: 7 })).toContain('7');
    expect(i.t('notes.ofCount', { n: 7 })).not.toContain('{n}');
  });

  it('leaves a placeholder alone when no value is supplied', () => {
    // Better a visible `{n}` than a string that reads as if the count were zero.
    expect(new I18n().t('notes.ofCount')).toBe('of {n} notes');
  });

  it('does not treat a stray brace pair as a placeholder', () => {
    expect(new I18n().t('notes.empty', { n: 1 })).toBe(new I18n().t('notes.empty'));
  });
});

describe('every key in the table is one the engine actually renders', () => {
  /**
   * A key nothing reads is a translation nobody sees, and it is the failure this whole
   * feature has to avoid repeating: the first version of the locale files was a complete
   * set of keys for surfaces that did not exist.
   *
   * The check is deliberately blunt -- does the key appear in a rendered surface, or in
   * the table that feeds one -- rather than a clever reachability analysis. A key used
   * only by the settings window's own XAML counts, because that window is a shipped
   * surface too.
   */
  it('finds every key somewhere it can be seen', () => {
    const rendered = ALL_SOURCE.map((f) => readFileSync(f, 'utf8')).join('\n');
    const settingsXaml = readFileSync(
      join(process.cwd(), '..', 'AnomalyEngine', 'SettingsWindow', 'SettingsWindow.xaml'),
      'utf8'
    );
    const haystack = rendered + '\n' + settingsXaml;

    // The tray labels and settings-page titles are keyed for the native settings
    // window, whose own strings live in XAML rather than in the renderer.
    const hostOnly = new Set([
      ...Object.keys(ES_LOCALE.strings).filter((k) => k.startsWith('tray.')),
      ...Object.keys(ES_LOCALE.strings).filter((k) => k.startsWith('settings.')),
      'app.title',
      'app.tagline',
    ]);

    const orphans = UI_KEYS.filter((k) => !haystack.includes(k) && !hostOnly.has(k));
    expect(orphans).toEqual([]);
  });
});

describe('the three translated surfaces', () => {
  const i18n = new I18n();

  /**
   * Renders a fresh creator panel and returns its markup.
   *
   * Every existing panel is removed first. `CreatorMode` appends by id and nothing
   * removes it for you, so four calls in one test leave four panels and
   * `getElementById` returns the first -- which is to say the assertion would be
   * reading a panel rendered three calls ago, in a different language. That is a test
   * that passes or fails for reasons that have nothing to do with the code.
   */
  function panelHtml(locale: string): string {
    for (const stale of document.querySelectorAll('#anomaly-creator-panel')) stale.remove();
    i18n.setLocale(locale);
    const creator = new CreatorMode();
    creator.useTranslator(i18n);
    creator.enable();
    return document.querySelector('#anomaly-creator-panel')?.innerHTML ?? '';
  }

  afterEach(() => {
    for (const el of document.querySelectorAll('#anomaly-creator-panel')) el.remove();
    i18n.setLocale('en');
  });

  it('renders the creator panel in the chosen language', () => {
    // The panel is the only surface reachable without a mouse hovering anything, so it
    // is the one a user is guaranteed to be able to see.
    expect(panelHtml('ja')).toContain('クリエイターモード');
    expect(panelHtml('de')).toContain('Erstellermodus');
    expect(panelHtml('es')).toContain('Modo Creador');
    expect(panelHtml('en')).toContain('Creator Mode');
  });

  it('re-renders an open panel when the language changes', () => {
    // Held by reference rather than captured, so this holds. A constructor argument
    // would have frozen the language at construction and this would fail.
    for (const stale of document.querySelectorAll('#anomaly-creator-panel')) stale.remove();
    i18n.setLocale('en');
    const creator = new CreatorMode();
    creator.useTranslator(i18n);
    creator.enable();
    const panel = document.querySelector('#anomaly-creator-panel');
    expect(panel?.innerHTML).toContain('Creator Mode');

    i18n.setLocale('de');
    creator.useTranslator(i18n);
    expect(panel?.innerHTML).toContain('Erstellermodus');
  });

  it('translates the zone hints', () => {
    const FOREST: ScreenRect = { x: 0, y: 0.63, width: 1, height: 0.13 };
    const MOON: ScreenRect = { x: 0.7, y: 0.2, width: 0.06, height: 0.1 };
    const landmark = (kind: LandmarkRect['kind'], x: number): LandmarkRect =>
      ({ id: `${kind}@${x}`, kind, x, y: 0.5, width: 0.06, height: 0.07 });
    const scene = {
      landmarks: [landmark('observatory', 0.44)],
      moon: MOON,
      forest: FOREST,
    } as InteractionSurfaces;

    i18n.setLocale('de');
    const german = describeZones(scene, i18n.translator());
    expect(german.find((z) => z.id === 'observatory')?.hint).toContain('Kuppel');

    // English is the default with no translator at all, which is what keeps
    // `describeZones` callable from a test with no locale machinery in scope.
    expect(describeZones(scene).find((z) => z.id === 'observatory')?.hint).toBe(
      'The dome is shut. The shutter has not moved in a long time.'
    );
  });
});

describe('translations that lost their accents', () => {
  /**
   * German and Spanish shipped with every diacritic stripped: "Uber", "Qualitat",
   * "Offnen", "Loschen", "Ereignishaufigkeit", "Espanol", "bateria", "Configuracion".
   *
   * It is not detectable by a spelling check or by a key-parity check, and to a reader
   * it is not a stylistic choice but a misspelling -- which is the whole content of a
   * translation. So the check is on the letters that were lost: a word containing a
   * plain ASCII `a`, `o` or `u` where the language requires an accent is not reliably
   * detectable either, so what is asserted is the specific vocabulary that regressed.
   */
  const LOST_ACCENTS = [
    'Espanol', 'bateria', 'Anomalias', 'Configuracion', 'Descubiertas',
    'Uber', 'Qualitat', 'Offnen', 'Loschen', 'Nachste', 'verhalt',
    'Ereignishaufigkeit', 'Auslosen', 'ordnen',
  ];

  it('are all restored', () => {
    const all = JSON.stringify([ES_LOCALE.strings, DE_LOCALE.strings, JA_LOCALE.strings]);
    const stillBroken = LOST_ACCENTS.filter((word) => all.includes(word));
    expect(stillBroken).toEqual([]);
  });

  it('reads as a translation rather than a transliteration', () => {
    // Spot checks on the strings a user actually sees, so a regression names itself.
    expect(DE_LOCALE.strings['settings.about']).toBe('Über');
    expect(DE_LOCALE.strings['world.delete']).toBe('Löschen');
    expect(ES_LOCALE.strings['settings.notes']).toBe('Notas de campo');
    expect(ES_LOCALE.strings['performance.batteryMode']).toBe('Modo batería');
    expect(ES_LOCALE.name).toBe('Español');
  });
});

describe('the English table is the source of truth for the key set', () => {
  it('has every locale key, and no locale has one English does not', () => {
    const en = new Set<string>(UI_KEYS);
    for (const locale of [ES_LOCALE, DE_LOCALE, JA_LOCALE]) {
      const keys = new Set<string>(Object.keys(locale.strings));
      expect({ code: locale.code, missing: [...en].filter((k) => !keys.has(k)).sort() })
        .toEqual({ code: locale.code, missing: [] });
      expect({ code: locale.code, extra: [...keys].filter((k) => !en.has(k)).sort() })
        .toEqual({ code: locale.code, extra: [] });
    }
  });

  it('leaves no value empty', () => {
    for (const locale of [ES_LOCALE, DE_LOCALE, JA_LOCALE]) {
      const empty = Object.entries(locale.strings)
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k);
      expect({ code: locale.code, empty }).toEqual({ code: locale.code, empty: [] });
    }
    for (const key of UI_KEYS) expect(EN_STRINGS[key].trim()).not.toBe('');
  });

  it('keeps the placeholders a translation must not drop', () => {
    // A translation that loses `{n}` renders "of notes", which reads as a bug in the
    // product rather than a bug in the translation.
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
    for (const locale of [ES_LOCALE, DE_LOCALE, JA_LOCALE]) {
      // `LocaleStrings` is an open index so a runtime-registered locale stays possible,
      // so the value is a plain `string` here rather than narrowed to the key union.
      const value = String(locale.strings['notes.ofCount']);
      expect({ code: locale.code, p: placeholders(value) }).toEqual({
        code: locale.code,
        p: ['{n}'],
      });
    }
  });
});
