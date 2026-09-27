export interface WorldManifest {
  id: string;
  name: string;
  author: string;
  version: string;
  engine: string;
  entryScene: string;
  description: string;
  features: {
    weather: boolean;
    astronomy: boolean;
    systemEvents: boolean;
    audioReactive: boolean;
  };
  scenes: Array<{ id: string; file: string; description?: string }>;
}

export interface WorldPackage {
  manifest: WorldManifest;
  rootPath: string;
  assets: Map<string, string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class WorldLoader {
  private _worlds: Map<string, WorldPackage> = new Map();
  private _activeWorld: WorldPackage | null = null;

  async loadFromPath(path: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const manifestPath = `${path}/manifest.json`;
      const manifestResp = await fetch(manifestPath);
      if (!manifestResp.ok) {
        errors.push(`Cannot read manifest.json at ${manifestPath}`);
        return { valid: false, errors, warnings };
      }

      const manifest = await manifestResp.json() as WorldManifest;

      if (!manifest.id) errors.push('Manifest missing required field: id');
      if (!manifest.name) errors.push('Manifest missing required field: name');
      if (!manifest.version) errors.push('Manifest missing required field: version');
      if (!manifest.engine) errors.push('Manifest missing required field: engine');
      if (!manifest.entryScene) errors.push('Manifest missing required field: entryScene');

      if (errors.length > 0) return { valid: false, errors, warnings };

      const engineVersion = manifest.engine.replace('>=', '').trim();
      if (!this._checkEngineVersion(engineVersion)) {
        warnings.push(`Engine version ${engineVersion} may not be compatible`);
      }

      const entryScenePath = `${path}/${manifest.entryScene === 'main' ? 'scenes/main.html' : manifest.entryScene}`;
      const sceneResp = await fetch(entryScenePath);
      if (!sceneResp.ok) {
        errors.push(`Entry scene not found: ${entryScenePath}`);
      }

      if (errors.length > 0) return { valid: false, errors, warnings };

      const world: WorldPackage = {
        manifest,
        rootPath: path,
        assets: new Map(),
      };

      this._worlds.set(manifest.id, world);
      return { valid: true, errors, warnings };
    } catch (err) {
      errors.push(`Failed to load world: ${err instanceof Error ? err.message : String(err)}`);
      return { valid: false, errors, warnings };
    }
  }

  async loadFromBlob(blob: Blob): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      const text = await blob.text();
      const manifest = JSON.parse(text) as WorldManifest;

      if (!manifest.id) errors.push('Manifest missing required field: id');
      if (!manifest.name) errors.push('Manifest missing required field: name');
      if (!manifest.version) errors.push('Manifest missing required field: version');

      if (errors.length > 0) return { valid: false, errors, warnings };

      const world: WorldPackage = {
        manifest,
        rootPath: '',
        assets: new Map(),
      };

      this._worlds.set(manifest.id, world);
      return { valid: true, errors, warnings };
    } catch (err) {
      errors.push(`Failed to parse world package: ${err instanceof Error ? err.message : String(err)}`);
      return { valid: false, errors, warnings };
    }
  }

  activate(id: string): WorldPackage | null {
    const world = this._worlds.get(id);
    if (!world) return null;
    this._activeWorld = world;
    return world;
  }

  getActiveWorld(): WorldPackage | null {
    return this._activeWorld;
  }

  getWorld(id: string): WorldPackage | null {
    return this._worlds.get(id) ?? null;
  }

  getWorlds(): WorldPackage[] {
    return Array.from(this._worlds.values());
  }

  remove(id: string): boolean {
    return this._worlds.delete(id);
  }

  private _checkEngineVersion(version: string): boolean {
    const [major] = version.split('.').map(Number);
    return major >= 0;
  }

  dispose(): void {
    this._worlds.clear();
    this._activeWorld = null;
  }
}
