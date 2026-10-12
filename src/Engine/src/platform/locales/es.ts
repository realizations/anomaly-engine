import type { Locale } from '../I18n.js';

/**
 * Spanish.
 *
 * Typed against the English table, so a key added there and not here is a compile
 * error rather than an English string appearing in a Spanish interface at runtime.
 *
 * The accents are load-bearing: "Espanol", "bateria", "Anomalias" and "Configuracion"
 * shipped with the diacritics stripped, which to a reader is not a stylistic choice
 * but a broken translation. Every one is restored here.
 */
export const ES_LOCALE: Locale = {
  code: 'es',
  name: 'Español',
  strings: {
    'app.title': 'Motor de Anomalías',
    'app.tagline': 'Un motor de fondo de pantalla vivo donde el escritorio se comporta como un mundo vivo.',
    'settings.home': 'Inicio',
    'settings.worlds': 'Mundos',
    'settings.appearance': 'Apariencia',
    'settings.performance': 'Rendimiento',
    'settings.events': 'Eventos',
    'settings.monitors': 'Monitores',
    'settings.integrations': 'Integraciones',
    'settings.notes': 'Notas de campo',
    'settings.about': 'Acerca de',
    'performance.fps': 'FPS',
    'performance.quality': 'Calidad',
    'performance.fullscreenPause': 'Pausar en pantalla completa',
    'performance.batteryMode': 'Modo batería',
    'events.enableSources': 'Activar fuentes',
    'events.frequency': 'Frecuencia de eventos',
    'events.rareEvents': 'Eventos raros',
    'events.internetEvents': 'Eventos de internet',
    'events.systemEvents': 'Eventos del sistema',
    'world.activate': 'Activar',
    'world.preview': 'Vista previa',
    'world.favorite': 'Favorito',
    'world.delete': 'Eliminar',
    'world.import': 'Importar',
    'world.openFolder': 'Abrir carpeta',
    'secrets.discovered': 'Anomalías descubiertas',
    'secrets.journal': 'Diario',
    'secrets.progress': 'Progreso',
    'tray.open': 'Abrir',
    'tray.pause': 'Pausar',
    'tray.resume': 'Reanudar',
    'tray.nextWorld': 'Siguiente Mundo',
    'tray.triggerEvent': 'Disparar Evento',
    'tray.performanceMode': 'Modo Rendimiento',
    'tray.settings': 'Configuración',
    'tray.about': 'Acerca de',
    'tray.exit': 'Salir',

    'creator.title': 'Modo Creador',
    'creator.triggerEvent': 'Disparar Evento',
    'creator.setTime': 'Fijar Hora',
    'creator.setWeather': 'Fijar Clima',
    'creator.reloadWorld': 'Recargar Mundo',
    'creator.screenshot': 'Captura',
    'creator.prompt.eventId': 'ID del evento:',
    'creator.prompt.time': 'Hora (HH:MM):',
    'creator.prompt.weather': 'Condición meteorológica:',

    'notes.title': 'Notas de campo',
    'notes.alsoConsistentWith': 'También consistente con',
    'notes.empty': 'Todavía no hay nada anotado.',
    'notes.observed': 'observados',
    'notes.ofCount': 'de {n} notas',
    'notes.seed': 'semilla',
    'notes.unrecorded': 'Sin registrar.',

    'hint.observatory': 'La cúpula está cerrada. El obturador no se mueve desde hace mucho tiempo.',
    'hint.radioTower': 'La portadora sigue emitiendo. Nadie contesta.',
    'hint.cabin': 'Humo, casi todas las noches. Nadie ha salido.',
    'hint.lighthouse': 'La luz mantiene el intervalo que le dieron.',
    'hint.forest': 'La línea de árboles no se mueve.',
    'hint.moon': 'Tiene la forma correcta y la distancia equivocada.',
  },
};
