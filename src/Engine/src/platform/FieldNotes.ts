/**
 * Field notes: the observable surface of the ARG layer.
 *
 * A wallpaper must not carry permanent UI on the desktop, so this is opt-in from
 * the tray and auto-dismisses. It surfaces what the engine already knows: the
 * world's premise, what has been observed, and how far the reader has got.
 *
 * The tone is deliberate. Every anomaly is paired with a plausible denial, so
 * the panel never tells you that something happened - only that you wrote
 * something down, and what you might have seen instead.
 */
import type { JournalEntry } from '../systems/JournalSystem.js';
import type { DiscoveredSecret, SecretDefinition } from '../systems/SecretSystem.js';
import type { WorldDefinition } from '../worlds/types.js';

export interface FieldNotesData {
  world: WorldDefinition | null;
  journal: JournalEntry[];
  secrets: DiscoveredSecret[];
  secretDefinitions: SecretDefinition[];
  sessions: number;
  firstRun: string | null;
  anomaliesSeen: number;
}

const AUTO_HIDE_MS = 24000;

export class FieldNotes {
  private _el: HTMLElement | null = null;
  private _visible = false;
  private _timer: number | null = null;
  private _data: FieldNotesData = {
    world: null,
    journal: [],
    secrets: [],
    secretDefinitions: [],
    sessions: 0,
    firstRun: null,
    anomaliesSeen: 0,
  };

  show(data?: Partial<FieldNotesData>): void {
    if (data) this._data = { ...this._data, ...data };
    if (this._visible) {
      this._render();
      this._resetTimer();
      return;
    }
    this._visible = true;
    this._create();
    this._render();
    this._resetTimer();
  }

  hide(): void {
    this._visible = false;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    const el = this._el;
    this._el = null;
    if (!el) return;
    el.style.opacity = '0';
    // Let the fade finish before removing it from the DOM.
    window.setTimeout(() => el.remove(), 500);
  }

  toggle(data?: Partial<FieldNotesData>): void {
    if (this._visible) this.hide();
    else this.show(data);
  }

  isVisible(): boolean {
    return this._visible;
  }

  private _resetTimer(): void {
    if (this._timer !== null) clearTimeout(this._timer);
    this._timer = window.setTimeout(() => this.hide(), AUTO_HIDE_MS);
  }

  private _create(): void {
    const el = document.createElement('div');
    el.id = 'anomaly-field-notes';
    el.style.cssText = `
      position: fixed;
      right: 24px;
      top: 24px;
      bottom: 24px;
      width: 380px;
      max-width: calc(100vw - 48px);
      overflow-y: auto;
      background: rgba(8, 9, 14, 0.9);
      backdrop-filter: blur(10px);
      color: #d8d5cd;
      border: 1px solid rgba(140, 140, 160, 0.18);
      border-radius: 8px;
      padding: 22px 24px;
      z-index: 999998;
      font: 13px/1.7 "Segoe UI", system-ui, sans-serif;
      opacity: 0;
      transition: opacity 0.45s ease;
      pointer-events: none;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
    `;
    document.body.appendChild(el);
    // Force a reflow so the opacity transition actually runs.
    void el.offsetWidth;
    el.style.opacity = '1';
    this._el = el;
  }

  private _esc(s: unknown): string {
    return String(s ?? '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)
    );
  }

  private _when(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  private _render(): void {
    if (!this._el) return;
    const d = this._data;
    const w = d.world;
    const found = new Set(d.secrets.map((s) => s.definition.id));

    const lore = w?.lore
      ? `<p style="color:#9d9a92;font-style:italic;margin:0 0 18px">${this._esc(w.lore.premise)}</p>`
      : '';

    const denial = w?.lore?.deniability?.length
      ? `<div style="margin:18px 0 0;padding:12px 14px;border-left:2px solid rgba(150,150,170,.3);background:rgba(255,255,255,.03)">
           <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7b7a86;margin-bottom:8px">Also consistent with</div>
           ${(w.lore.deniability ?? []).map((line) => `<div style="color:#8e8c85;margin-bottom:4px">${this._esc(line)}</div>`).join('')}
         </div>`
      : '';

    const entries = [...d.journal]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 12)
      .map((e) => {
        const clue = e.clues?.length
          ? `<div style="color:#7e8c96;font-size:12px;margin-top:3px">${this._esc(e.clues.join(' · '))}</div>`
          : '';
        return `<li style="margin-bottom:13px">
          <div style="color:#c9c6be">${this._esc(e.anomalyName)}</div>
          <div style="color:#7b7a86;font-size:12px">${this._esc(e.rarity)} · ${this._when(e.timestamp)}</div>
          ${clue}
        </li>`;
      })
      .join('');

    const journalBlock = d.journal.length
      ? `<ol style="list-style:none;padding:0;margin:0">${entries}</ol>`
      : `<p style="color:#7b7a86">Nothing written down yet.</p>`;

    // Secrets the reader has not found show only their hint, never their name,
    // so the panel can act as a journal prompt rather than a spoiler list.
    const secretBlock = d.secretDefinitions.length
      ? `<ul style="list-style:none;padding:0;margin:0">
          ${d.secretDefinitions.map((s) => {
            const got = found.has(s.id);
            const body = got
              ? `<div style="color:#c9c6be">${this._esc(s.name)}</div>
                 <div style="color:#8e8c85;font-size:12px">${this._esc(s.description)}</div>`
              : `<div style="color:#6d6c78;font-style:italic">${this._esc(s.hints[0] ?? 'Unrecorded.')}</div>`;
            return `<li style="margin-bottom:12px">${body}</li>`;
          }).join('')}
         </ul>`
      : '';

    this._el.innerHTML = `
      <div style="font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#7b7a86">Field notes</div>
      <h1 style="font-size:19px;font-weight:600;margin:4px 0 0;color:#e9e7e1">${this._esc(w?.name ?? 'Unknown world')}</h1>
      <div style="font-size:12px;color:#7b7a86;margin-bottom:16px">${this._esc(w?.biome ?? '')} · seed ${this._esc(w?.terrain?.seed ?? '')}</div>
      ${lore}
      <p style="color:#9d9a92;margin:0 0 6px;font-size:13px">${this._esc(w?.description ?? '')}</p>
      ${denial}

      <div style="display:flex;gap:22px;margin:22px 0;padding:14px 0;border-top:1px solid rgba(140,140,160,.14);border-bottom:1px solid rgba(140,140,160,.14)">
        ${this._stat(d.anomaliesSeen, 'observed')}
        ${this._stat(found.size, `of ${d.secretDefinitions.length} notes`)}
        ${this._stat(d.sessions, 'sessions')}
      </div>

      <div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7b7a86;margin:22px 0 10px">Observations</div>
      ${journalBlock}

      ${secretBlock ? `<div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#7b7a86;margin:22px 0 10px">Open questions</div>${secretBlock}` : ''}

      <div style="font-size:11px;color:#5f5e68;margin-top:24px">
        ${d.firstRun ? `First recorded ${this._esc(new Date(d.firstRun).toLocaleDateString())}.` : ''}
        Dismisses on its own.
      </div>
    `;
  }

  private _stat(value: number, label: string): string {
    return `<div>
      <div style="font-size:22px;font-weight:600;color:#e9e7e1;line-height:1.1">${this._esc(value)}</div>
      <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#7b7a86">${this._esc(label)}</div>
    </div>`;
  }

  dispose(): void {
    this.hide();
  }
}
