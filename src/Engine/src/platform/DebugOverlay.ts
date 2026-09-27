export interface DebugOverlayData {
  fps: number;
  frameTime: number;
  memoryMB: number;
  activeScene: string;
  eventQueueLength: number;
  worldTime: string;
  activeEffects: string[];
  sourceStatus: Record<string, boolean>;
  webviewState: string;
  gpuInfo: string;
  monitorInfo: string;
}

export class DebugOverlay {
  private _container: HTMLElement | null = null;
  private _visible = false;
  private _updateInterval: number | null = null;
  private _data: DebugOverlayData = {
    fps: 0,
    frameTime: 0,
    memoryMB: 0,
    activeScene: 'main',
    eventQueueLength: 0,
    worldTime: '',
    activeEffects: [],
    sourceStatus: {},
    webviewState: 'unknown',
    gpuInfo: 'unknown',
    monitorInfo: 'unknown',
  };

  show(): void {
    if (this._visible) return;
    this._visible = true;
    this._createContainer();
    this._startUpdating();
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this._destroyContainer();
    this._stopUpdating();
  }

  toggle(): void {
    if (this._visible) this.hide();
    else this.show();
  }

  update(data: Partial<DebugOverlayData>): void {
    this._data = { ...this._data, ...data };
    this._render();
  }

  private _createContainer(): void {
    this._container = document.createElement('div');
    this._container.id = 'anomaly-debug-overlay';
    this._container.style.cssText = `
      position: fixed;
      top: 10px;
      left: 10px;
      background: rgba(0, 0, 0, 0.85);
      color: #00ff88;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 12px;
      padding: 12px;
      border-radius: 4px;
      z-index: 999999;
      pointer-events: none;
      min-width: 250px;
      line-height: 1.6;
    `;
    document.body.appendChild(this._container);
  }

  private _destroyContainer(): void {
    this._container?.remove();
    this._container = null;
  }

  private _startUpdating(): void {
    this._updateInterval = window.setInterval(() => this._render(), 100);
  }

  private _stopUpdating(): void {
    if (this._updateInterval !== null) {
      clearInterval(this._updateInterval);
      this._updateInterval = null;
    }
  }

  private _render(): void {
    if (!this._container) return;

    const lines = [
      `=== ANOMALY ENGINE DEBUG ===`,
      `FPS: ${this._data.fps} | Frame: ${this._data.frameTime.toFixed(1)}ms`,
      `Memory: ${this._data.memoryMB.toFixed(1)} MB`,
      `Scene: ${this._data.activeScene}`,
      `World Time: ${this._data.worldTime}`,
      `Event Queue: ${this._data.eventQueueLength}`,
      `Active Effects: ${this._data.activeEffects.join(', ') || 'none'}`,
      `WebView: ${this._data.webviewState}`,
      `GPU: ${this._data.gpuInfo}`,
      `Monitor: ${this._data.monitorInfo}`,
      `--- Sources ---`,
    ];

    for (const [source, active] of Object.entries(this._data.sourceStatus)) {
      lines.push(`  ${source}: ${active ? 'ON' : 'OFF'}`);
    }

    this._container.textContent = lines.join('\n');
  }

  isVisible(): boolean {
    return this._visible;
  }

  dispose(): void {
    this.hide();
  }
}
