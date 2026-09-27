import Database from 'better-sqlite3';

export interface SQLiteConfig {
  dbPath: string;
}

export class SQLitePersistence {
  private _db: Database.Database | null = null;
  private _config: SQLiteConfig;

  constructor(config?: Partial<SQLiteConfig>) {
    const dbPath = config?.dbPath ?? './anomaly-engine.db';
    this._config = { dbPath };
  }

  async init(): Promise<void> {
    this._db = new Database(this._config.dbPath);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this._createTables();
  }

  private _createTables(): void {
    if (!this._db) return;

    this._db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS secrets (
        id TEXT PRIMARY KEY,
        discovered_at INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'observed',
        notes TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS event_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        source TEXT NOT NULL,
        payload TEXT,
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS journal (
        id TEXT PRIMARY KEY,
        anomaly_id TEXT NOT NULL,
        anomaly_name TEXT NOT NULL,
        rarity TEXT NOT NULL,
        location TEXT NOT NULL,
        notes TEXT DEFAULT '',
        screenshot TEXT,
        state TEXT NOT NULL DEFAULT 'observed',
        clues TEXT DEFAULT '[]',
        timestamp INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cooldowns (
        event_type TEXT PRIMARY KEY,
        last_fired INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS moments (
        id TEXT PRIMARY KEY,
        discovered_at INTEGER NOT NULL,
        screenshot TEXT,
        notes TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS worlds (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        last_activated INTEGER,
        config TEXT DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_event_history_timestamp ON event_history(timestamp);
      CREATE INDEX IF NOT EXISTS idx_journal_timestamp ON journal(timestamp);
    `);
  }

  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    if (!this._db) return defaultValue;
    const row = this._db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    if (!row) return defaultValue;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return defaultValue;
    }
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    if (!this._db) return;
    const json = JSON.stringify(value);
    const now = Date.now();
    this._db.prepare(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, json, now);
  }

  async unlockSecret(id: string, notes = ''): Promise<boolean> {
    if (!this._db) return false;
    const now = Date.now();
    const result = this._db.prepare(`
      INSERT OR IGNORE INTO secrets (id, discovered_at, state, notes) VALUES (?, ?, 'discovered', ?)
    `).run(id, now, notes);
    return result.changes > 0;
  }

  async getSecrets(): Promise<Array<{ id: string; discovered_at: number; state: string; notes: string }>> {
    if (!this._db) return [];
    return this._db.prepare('SELECT * FROM secrets ORDER BY discovered_at DESC').all() as Array<{ id: string; discovered_at: number; state: string; notes: string }>;
  }

  async addEventToHistory(event: { id: string; type: string; source: string; payload?: unknown; timestamp: number }): Promise<void> {
    if (!this._db) return;
    this._db.prepare(`
      INSERT INTO event_history (event_id, event_type, source, payload, timestamp) VALUES (?, ?, ?, ?, ?)
    `).run(event.id, event.type, event.source, JSON.stringify(event.payload ?? {}), event.timestamp);
  }

  async getEventHistory(limit = 100): Promise<unknown[]> {
    if (!this._db) return [];
    const rows = this._db.prepare('SELECT * FROM event_history ORDER BY timestamp DESC LIMIT ?').all(limit) as Array<{ payload: string }>;
    return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  async addJournalEntry(entry: { id: string; anomalyId: string; anomalyName: string; rarity: string; location: string; notes?: string; screenshot?: string; state?: string; clues?: string[]; timestamp: number }): Promise<void> {
    if (!this._db) return;
    this._db.prepare(`
      INSERT INTO journal (id, anomaly_id, anomaly_name, rarity, location, notes, screenshot, state, clues, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.anomalyId, entry.anomalyName, entry.rarity, entry.location, entry.notes ?? '', entry.screenshot ?? '', entry.state ?? 'observed', JSON.stringify(entry.clues ?? []), entry.timestamp);
  }

  async getJournal(): Promise<unknown[]> {
    if (!this._db) return [];
    const rows = this._db.prepare('SELECT * FROM journal ORDER BY timestamp DESC').all() as Array<{ clues: string }>;
    return rows.map(r => ({ ...r, clues: JSON.parse(r.clues) }));
  }

  async setCooldown(eventType: string, timestamp: number): Promise<void> {
    if (!this._db) return;
    this._db.prepare(`
      INSERT INTO cooldowns (event_type, last_fired) VALUES (?, ?)
      ON CONFLICT(event_type) DO UPDATE SET last_fired = excluded.last_fired
    `).run(eventType, timestamp);
  }

  async getCooldowns(): Promise<Record<string, number>> {
    if (!this._db) return {};
    const rows = this._db.prepare('SELECT event_type, last_fired FROM cooldowns').all() as Array<{ event_type: string; last_fired: number }>;
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.event_type] = row.last_fired;
    }
    return result;
  }

  async discoverMoment(id: string, screenshot?: string, notes = ''): Promise<boolean> {
    if (!this._db) return false;
    const now = Date.now();
    const result = this._db.prepare(`
      INSERT OR IGNORE INTO moments (id, discovered_at, screenshot, notes) VALUES (?, ?, ?, ?)
    `).run(id, now, screenshot ?? '', notes);
    return result.changes > 0;
  }

  async getMoments(): Promise<unknown[]> {
    if (!this._db) return [];
    return this._db.prepare('SELECT * FROM moments ORDER BY discovered_at DESC').all();
  }

  async installWorld(id: string, name: string, version: string): Promise<void> {
    if (!this._db) return;
    const now = Date.now();
    this._db.prepare(`
      INSERT INTO worlds (id, name, version, installed_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, version = excluded.version
    `).run(id, name, version, now);
  }

  async getWorlds(): Promise<unknown[]> {
    if (!this._db) return [];
    return this._db.prepare('SELECT * FROM worlds ORDER BY installed_at DESC').all();
  }

  async setLastActivated(id: string): Promise<void> {
    if (!this._db) return;
    this._db.prepare('UPDATE worlds SET last_activated = ? WHERE id = ?').run(Date.now(), id);
  }

  close(): void {
    this._db?.close();
    this._db = null;
  }
}
