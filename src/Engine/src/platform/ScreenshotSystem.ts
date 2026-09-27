export interface ScreenshotOptions {
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
  includeDebugOverlay: boolean;
}

export interface ScreenshotResult {
  dataUrl: string;
  width: number;
  height: number;
  timestamp: number;
}

export class ScreenshotSystem {
  private _options: ScreenshotOptions = {
    format: 'png',
    quality: 0.92,
    includeDebugOverlay: false,
  };

  private _listeners: ((result: ScreenshotResult) => void)[] = [];

  setOptions(options: Partial<ScreenshotOptions>): void {
    this._options = { ...this._options, ...options };
  }

  getOptions(): ScreenshotOptions {
    return { ...this._options };
  }

  async capture(): Promise<ScreenshotResult> {
    const canvas = document.createElement('canvas');
    canvas.width = window.screen.width;
    canvas.height = window.screen.height;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const format = `image/${this._options.format}`;
    const dataUrl = canvas.toDataURL(format, this._options.quality);

    const result: ScreenshotResult = {
      dataUrl,
      width: canvas.width,
      height: canvas.height,
      timestamp: Date.now(),
    };

    this._listeners.forEach(fn => fn(result));
    return result;
  }

  async saveToFile(filename?: string): Promise<void> {
    const result = await this.capture();
    const name = filename ?? `anomaly-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;

    const link = document.createElement('a');
    link.download = name;
    link.href = result.dataUrl;
    link.click();
  }

  onCapture(listener: (result: ScreenshotResult) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this._listeners = [];
  }
}
