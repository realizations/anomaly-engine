export interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate: Date;
  guid: string;
  categories: string[];
}

export interface RSSFeed {
  url: string;
  interval: number;
  lastChecked: number;
}

export class RSSSource {
  private _feeds: RSSFeed[] = [];
  private _timers: Map<string, number> = new Map();
  private _listeners: ((item: RSSItem, feedUrl: string) => void)[] = [];
  private _seenGuids: Set<string> = new Set();

  addFeed(url: string, intervalSeconds = 3600): void {
    this._feeds.push({ url, interval: intervalSeconds, lastChecked: 0 });
    this._timers.set(url, window.setInterval(() => this._checkFeed(url), intervalSeconds * 1000));
  }

  removeFeed(url: string): void {
    this._feeds = this._feeds.filter(f => f.url !== url);
    const timer = this._timers.get(url);
    if (timer !== undefined) {
      clearInterval(timer);
      this._timers.delete(url);
    }
  }

  start(): void {
    for (const feed of this._feeds) {
      this._checkFeed(feed.url);
    }
  }

  stop(): void {
    for (const timer of this._timers.values()) {
      clearInterval(timer);
    }
    this._timers.clear();
  }

  private async _checkFeed(url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) return;

      const text = await response.text();
      const items = this._parseFeed(text);

      for (const item of items) {
        if (this._seenGuids.has(item.guid)) continue;
        this._seenGuids.add(item.guid);
        this._listeners.forEach(fn => fn(item, url));
      }
    } catch (err) {
      // fail silently
    }
  }

  private _parseFeed(xml: string): RSSItem[] {
    const items: RSSItem[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    const titleRegex = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
    const linkRegex = /<link>([\s\S]*?)<\/link>/;
    const descRegex = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/;
    const dateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
    const guidRegex = /<guid>([\s\S]*?)<\/guid>/;
    const catRegex = /<category>([\s\S]*?)<\/category>/g;

    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemXml = match[1];
      const title = itemXml.match(titleRegex)?.[1] ?? '';
      const link = itemXml.match(linkRegex)?.[1] ?? '';
      const description = itemXml.match(descRegex)?.[1] ?? '';
      const pubDate = itemXml.match(dateRegex)?.[1] ?? '';
      const guid = itemXml.match(guidRegex)?.[1] ?? link;

      const categories: string[] = [];
      let catMatch;
      while ((catMatch = catRegex.exec(itemXml)) !== null) {
        categories.push(catMatch[1]);
      }

      items.push({
        title,
        link,
        description,
        pubDate: new Date(pubDate),
        guid,
        categories,
      });
    }

    return items;
  }

  onItem(listener: (item: RSSItem, feedUrl: string) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this.stop();
    this._listeners = [];
    this._feeds = [];
    this._seenGuids.clear();
  }
}
