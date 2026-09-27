type BridgeMessageHandler = (msg: { type: string; payload?: Record<string, unknown> }) => void;

export class NativeBridge {
  private _handlers: BridgeMessageHandler[] = [];

  constructor() {
    if (this._isWebView2()) {
      const w = window as unknown as { chrome: { webview: { addEventListener: (event: string, handler: (e: { data: unknown }) => void) => void } } };
      w.chrome.webview.addEventListener('message', (e) => {
        this._handlers.forEach(h => h(e.data as { type: string; payload?: Record<string, unknown> }));
      });
    }
  }

  private _isWebView2(): boolean {
    const w = window as unknown as { chrome?: { webview?: unknown } };
    return typeof w.chrome !== 'undefined' && typeof w.chrome.webview !== 'undefined';
  }

  onMessage(handler: BridgeMessageHandler): void {
    this._handlers.push(handler);
  }

  send(type: string, payload?: Record<string, unknown>): void {
    if (this._isWebView2()) {
      const w = window as unknown as { chrome: { webview: { postMessage: (msg: unknown) => void } } };
      w.chrome.webview.postMessage({ type, payload });
    }
  }

  sendLog(eventType: string, payload: Record<string, unknown>): void {
    this.send('log', { eventType, payload, timestamp: Date.now() });
  }

  sendReady(): void {
    this.send('ready', { timestamp: Date.now() });
  }
}
