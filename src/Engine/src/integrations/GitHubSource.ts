export interface GitHubEvent {
  type: 'commit' | 'release' | 'issue_opened' | 'issue_closed' | 'pr_opened' | 'pr_merged' | 'star';
  repository: string;
  author: string;
  title: string;
  url: string;
  timestamp: number;
  metadata: Record<string, unknown>;
}

export interface GitHubConfig {
  username: string;
  repositories: string[];
  updateInterval: number;
}

export class GitHubSource {
  private _config: GitHubConfig;
  private _timer: number | null = null;
  private _listeners: ((event: GitHubEvent) => void)[] = [];
  private _lastCheck: Map<string, number> = new Map();
  private _rateLimitRemaining = 60;
  private _rateLimitReset = 0;

  constructor(config: GitHubConfig) {
    this._config = config;
  }

  start(): void {
    this._check();
    this._timer = window.setInterval(() => this._check(), this._config.updateInterval * 1000);
  }

  stop(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  private async _check(): Promise<void> {
    if (this._rateLimitRemaining <= 0 && Date.now() < this._rateLimitReset) {
      return;
    }

    for (const repo of this._config.repositories) {
      await this._checkRepo(repo);
    }
  }

  private async _checkRepo(repo: string): Promise<void> {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github.v3+json',
      };

      const eventsUrl = `https://api.github.com/repos/${this._config.username}/${repo}/events`;
      const response = await fetch(eventsUrl, { headers });

      if (response.status === 403) {
        this._rateLimitRemaining = parseInt(response.headers.get('X-RateLimit-Remaining') ?? '0', 10);
        this._rateLimitReset = parseInt(response.headers.get('X-RateLimit-Reset') ?? '0', 10) * 1000;
        return;
      }

      if (!response.ok) return;

      const events = await response.json() as Array<{
        type: string;
        created_at: string;
        actor: { login: string };
        payload: Record<string, unknown>;
        repo: { name: string };
      }>;

      const lastCheck = this._lastCheck.get(repo) ?? 0;

      for (const event of events) {
        const timestamp = new Date(event.created_at).getTime();
        if (timestamp <= lastCheck) continue;

        const gitHubEvent = this._parseEvent(event, repo, timestamp);
        if (gitHubEvent) {
          this._listeners.forEach(fn => fn(gitHubEvent));
        }
      }

      if (events.length > 0) {
        this._lastCheck.set(repo, new Date(events[0].created_at).getTime());
      }
    } catch (err) {
      // fail silently
    }
  }

  private _parseEvent(
    event: { type: string; created_at: string; actor: { login: string }; payload: Record<string, unknown>; repo: { name: string } },
    repo: string,
    timestamp: number
  ): GitHubEvent | null {
    const base = {
      repository: repo,
      author: event.actor.login,
      url: `https://github.com/${this._config.username}/${repo}`,
      timestamp,
      metadata: event.payload,
    };

    switch (event.type) {
      case 'PushEvent':
        return { ...base, type: 'commit', title: `Commit: ${(event.payload.head as string ?? 'unknown').slice(0, 7)}` };
      case 'ReleaseEvent':
        return { ...base, type: 'release', title: `Release: ${event.payload.release as string ?? 'unknown'}` };
      case 'IssuesEvent':
        return { ...base, type: event.payload.action === 'closed' ? 'issue_closed' : 'issue_opened', title: `Issue: ${event.payload.issue as string ?? 'unknown'}` };
      case 'PullRequestEvent':
        return { ...base, type: event.payload.action === 'closed' ? 'pr_merged' : 'pr_opened', title: `PR: ${event.payload.pull_request as string ?? 'unknown'}` };
      case 'WatchEvent':
        return { ...base, type: 'star', title: `Star: ${repo}` };
      default:
        return null;
    }
  }

  onEvent(listener: (event: GitHubEvent) => void): () => void {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  dispose(): void {
    this.stop();
    this._listeners = [];
    this._lastCheck.clear();
  }
}
