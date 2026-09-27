export interface DatabaseConfig {
  path: string;
}

export interface QueryResult {
  changes: number;
  lastInsertRowId: number;
}

export class StateManager {
  private _data: Map<string, unknown> = new Map();
  private _initialized = false;

  async init(): Promise<void> {
    this._initialized = true;
  }

  async get<T>(key: string, defaultValue: T): Promise<T> {
    const value = this._data.get(key);
    return (value as T) ?? defaultValue;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this._data.set(key, value);
  }

  async has(key: string): Promise<boolean> {
    return this._data.has(key);
  }

  async remove(key: string): Promise<void> {
    this._data.delete(key);
  }

  async getJSON<T>(key: string): Promise<T | null> {
    const raw = await this.get<string | null>(key, null);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async setJSON<T>(key: string, value: T): Promise<void> {
    await this.set(key, JSON.stringify(value));
  }

  async getSecrets(): Promise<string[]> {
    return (await this.getJSON<string[]>('secrets')) ?? [];
  }

  async unlockSecret(secretId: string): Promise<boolean> {
    const secrets = await this.getSecrets();
    if (secrets.includes(secretId)) return false;
    secrets.push(secretId);
    await this.setJSON('secrets', secrets);
    return true;
  }

  async isSecretUnlocked(secretId: string): Promise<boolean> {
    const secrets = await this.getSecrets();
    return secrets.includes(secretId);
  }

  async getEventHistory(_limit = 100): Promise<unknown[]> {
    return (await this.getJSON<unknown[]>('eventHistory')) ?? [];
  }

  async addEventToHistory(event: unknown): Promise<void> {
    const history = await this.getEventHistory(1000);
    history.push(event);
    if (history.length > 1000) history.shift();
    await this.setJSON('eventHistory', history);
  }

  async getJournal(): Promise<unknown[]> {
    return (await this.getJSON<unknown[]>('journal')) ?? [];
  }

  async addJournalEntry(entry: unknown): Promise<void> {
    const journal = await this.getJournal();
    journal.push(entry);
    await this.setJSON('journal', journal);
  }

  async getCooldowns(): Promise<Record<string, number>> {
    return (await this.getJSON<Record<string, number>>('cooldowns')) ?? {};
  }

  async setCooldown(eventType: string, timestamp: number): Promise<void> {
    const cooldowns = await this.getCooldowns();
    cooldowns[eventType] = timestamp;
    await this.setJSON('cooldowns', cooldowns);
  }

  async getLastWorld(): Promise<string | null> {
    return this.get<string | null>('lastWorld', null);
  }

  async setLastWorld(worldId: string): Promise<void> {
    await this.set('lastWorld', worldId);
  }

  isInitialized(): boolean {
    return this._initialized;
  }

  dispose(): void {
    this._data.clear();
    this._initialized = false;
  }
}
