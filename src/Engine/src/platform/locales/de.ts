import type { Locale } from '../I18n.js';

/**
 * German.
 *
 * Typed against the English table, so a key added there and not here is a compile
 * error rather than an English string appearing in a German interface at runtime.
 *
 * The umlauts are load-bearing: "Uber", "Qualitat", "Offnen", "Loschen", "Nachste",
 * "verhalt" and "Ereignishaufigkeit" all shipped without them, which in German is not
 * a stylistic choice but a misspelling. Every one is restored here.
 */
export const DE_LOCALE: Locale = {
  code: 'de',
  name: 'Deutsch',
  strings: {
    'app.title': 'Anomalie-Engine',
    'app.tagline': 'Eine Live-Hintergrundbild-Engine, bei der sich der Desktop wie eine lebende Welt verhält.',
    'settings.home': 'Startseite',
    'settings.worlds': 'Welten',
    'settings.appearance': 'Erscheinungsbild',
    'settings.performance': 'Leistung',
    'settings.events': 'Ereignisse',
    'settings.monitors': 'Monitore',
    'settings.integrations': 'Integrationen',
    'settings.notes': 'Feldnotizen',
    'settings.about': 'Über',
    'performance.fps': 'FPS',
    'performance.quality': 'Qualität',
    'performance.fullscreenPause': 'Bei Vollbild pausieren',
    'performance.batteryMode': 'Akkumodus',
    'events.enableSources': 'Quellen aktivieren',
    'events.frequency': 'Ereignishäufigkeit',
    'events.rareEvents': 'Seltene Ereignisse',
    'events.internetEvents': 'Internet-Ereignisse',
    'events.systemEvents': 'Systemereignisse',
    'world.activate': 'Aktivieren',
    'world.preview': 'Vorschau',
    'world.favorite': 'Favorit',
    'world.delete': 'Löschen',
    'world.import': 'Importieren',
    'world.openFolder': 'Ordner öffnen',
    'secrets.discovered': 'Entdeckte Anomalien',
    'secrets.journal': 'Tagebuch',
    'secrets.progress': 'Fortschritt',
    'tray.open': 'Öffnen',
    'tray.pause': 'Pausieren',
    'tray.resume': 'Fortsetzen',
    'tray.nextWorld': 'Nächste Welt',
    'tray.triggerEvent': 'Ereignis auslösen',
    'tray.performanceMode': 'Leistungsmodus',
    'tray.settings': 'Einstellungen',
    'tray.about': 'Über',
    'tray.exit': 'Beenden',

    'creator.title': 'Erstellermodus',
    'creator.triggerEvent': 'Ereignis auslösen',
    'creator.setTime': 'Uhrzeit setzen',
    'creator.setWeather': 'Wetter setzen',
    'creator.reloadWorld': 'Welt neu laden',
    'creator.screenshot': 'Bildschirmfoto',
    'creator.prompt.eventId': 'Ereignis-ID:',
    'creator.prompt.time': 'Uhrzeit (HH:MM):',
    'creator.prompt.weather': 'Wetterbedingung:',

    'notes.title': 'Feldnotizen',
    'notes.alsoConsistentWith': 'Auch vereinbar mit',
    'notes.empty': 'Noch nichts notiert.',
    'notes.observed': 'beobachtet',
    'notes.ofCount': 'von {n} Notizen',
    'notes.seed': 'Startwert',
    'notes.unrecorded': 'Nicht erfasst.',

    'hint.observatory': 'Die Kuppel ist geschlossen. Der Verschluss bewegt sich seit Langem nicht.',
    'hint.radioTower': 'Die Trägerfrequenz läuft weiter. Niemand antwortet.',
    'hint.cabin': 'Rauch, in den meisten Nächten. Niemand ist herausgekommen.',
    'hint.lighthouse': 'Das Licht hält das ihm gegebene Intervall ein.',
    'hint.forest': 'Die Baumgrenze bewegt sich nicht.',
    'hint.moon': 'Die richtige Form, die falsche Entfernung.',
  },
};
