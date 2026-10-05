# Integrations

## Status

Nothing on this page is connected to the engine. The adapters exist, they are real
code, and none of them is wired in: they are not constructed by `main.ts`, they do
not receive an `EventBus`, and they do not put anything on it.

An earlier revision of this document listed events each adapter emits —
`github.commit`, `rss.new_item`, `weather.rain_started`, `media.playing`,
`network.online` and others. **None of them are emitted anywhere.** Each adapter
exposes its own listener list instead, and those callbacks are never called by
anything, because nothing starts the adapters.

The table below is what exists. It is shorter than the one it replaces, and the
missing rows are the point.

| Adapter | File | Real state |
|---|---|---|
| Weather | `systems/WeatherSystem.ts` | A `WeatherProvider` interface and one implementation, `OpenWeatherMapProvider`. Not constructed anywhere. Needs an API key |
| GitHub | `integrations/GitHubSource.ts` | Fetches `/repos/{owner}/{repo}/events` on a timer and parses them. Not constructed anywhere |
| RSS/Atom | `integrations/RSSSource.ts` | Manages a feed list, fetches on per-feed intervals, parses items. Not constructed anywhere |
| Remote events | `integrations/RemoteEventSource.ts` | Fetches a JSON endpoint on an interval. Not constructed anywhere |
| Media | `systems/MediaReactivity.ts` | Exists and is constructed, but samples nothing, so it has no input |
| Network | `events/NetworkSource.ts` | Tracks `navigator.onLine` and fires its own listeners. Does not use the bus |

## What each one needs before it can ship

- **A decision on payload validation.** Everything here parses a third party's JSON
  into typed structures. None of it validates beyond a cast, and an adapter that
  throws inside a timer callback is a wallpaper that stops rendering.
- **Rate limits and backoff.** `GitHubSource` polls on a fixed interval with no
  backoff and no handling for a 403 rate-limit response, which is the response it
  will get.
- **An event mapping.** Each adapter would need to translate its native payload into
  an `AnomalyEvent` on the bus. This is the missing piece, and it is small — the
  event type vocabulary is in [`event-system.md`](event-system.md).
- **Configuration that reaches them.** The shapes below are the adapters' own
  interfaces. There is no settings plumbing, and the engine's content security
  policy sets `connect-src 'none'`, so any adapter that made a request from the
  page would be blocked before it started.

That last point is worth stating plainly, because it is the reason this is scaffold
rather than a bug: the wallpaper is deliberately unable to reach the network. It is
loaded from `file://` behind your desktop icons, and a renderer that could make
requests could report your address with no visible symptom. Wiring any of these up
means making that trade deliberately, in one place, rather than by accident.

## The real interfaces

For reference, since they exist and are typed:

```ts
// GitHub
new GitHubSource({ username, repositories, updateInterval })
  .onEvent(cb)        // cb receives a GitHubEvent with type:
//                      // 'commit' | 'release' | 'issue_opened' | 'issue_closed'
                      // | 'pr_opened' | 'pr_merged' | 'star'

// RSS
new RSSSource()
  .addFeed(url, intervalSeconds = 3600)
  .removeFeed(url)
  .onItem(cb)         // cb receives (item, feedUrl)
  .start()

// Remote events
new RemoteEventSource({ endpoint, interval, timeout })

// Weather
new OpenWeatherMapProvider(apiKey)
  .fetchWeather(lat, lon)
```

Note the GitHub event types are bare — `'commit'`, not `'github.commit'` — so they
would collide with anything else named `commit` the moment they reached the bus.
Prefixing them is part of the work, not a detail.