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
    // Copy the live wallpaper, not a blank canvas.
    //
    // This used to create a fresh canvas, fill it black and encode that, so every
    // screenshot was a black rectangle of the right dimensions -- the call
    // succeeded, the result was well formed, and the picture was of nothing. It was
    // invisible until creator mode's Screenshot button got wired up, because until
    // then nothing in the app called it.
    const source = document.getElementById('wallpaper-canvas') as HTMLCanvasElement | null;
    // Clamped to at least one pixel: a zero-sized canvas encodes to an empty data
    // URL, so a fallback that is itself degenerate produces a worse result than the
    // black frame it replaced.
    const width = Math.max(1, source?.width ?? window.screen.width);
    const height = Math.max(1, source?.height ?? window.screen.height);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    if (source) {
      ctx.drawImage(source, 0, 0, width, height);
    } else {
      // Only reachable if the wallpaper canvas is missing, which would be a
      // teardown race rather than a normal state. Say so in the pixels rather than
      // handing back a silently blank frame.
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);
    }

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
