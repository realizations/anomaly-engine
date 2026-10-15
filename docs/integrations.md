# Integrations

What is connected to the engine, what it does, and what is deliberately not.

This document is short because most of it is now *working* rather than planned. It
previously described three adapters — `GitHubSource.ts`, `RSSSource.ts` and
`RemoteEventSource.ts` — as "real code, not wired in". They have since been **deleted**,
not parked: each held its own `fetch`, its own timer and its own parser, so each was
untestable, and the page's content security policy blocks `fetch` anyway. Reviving any of
them would reintroduce dead code and a third way to reach the network. Do not.

| Surface | Where | State |
|---|---|---|
| Event feeds | host `Core/EventFeedFetcher.cs` + `integrations/` | Live. The host fetches, the renderer matches, a rule selects the effect |
| Weather | `systems/LocalWeather.ts`, `systems/WeatherSystem.ts` | Live, and local. A model seeded by latitude and longitude, no API key, no request |
| Audio reactivity | `systems/MediaReactivity.ts`, `systems/OnsetDetector.ts` | Live, from a file you choose. Never captures what is playing on the system |
| Network state | `events/NetworkSource.ts` | Live. Reads `navigator.onLine`; makes no request |

## Event feeds

The pipeline is split so the security property is checkable rather than asserted:

```
Settings → Integrations        the rule editor: feeds, rules, tests
        │
   renderer (page)             EventFeedClient schedules a poll BY FEED ID
        │  feed:request {feedId}
   native host                 EventFeedFetcher: https only, host allow-list,
        │                      no redirects, 256KB while reading, 60s floor
        │  feed:result {body}
   renderer (page)             FeedMapper.mapFeed applies YOUR rules
        │
   Anomaly registry            one of the six registered effects, or nothing
```

**The renderer cannot fetch anything.** The page is served from `file://` and its
content security policy sets `connect-src 'none'`. It asks the host for a feed *by id*
and never learns the URL, so the host's allow-list is the only thing that decides what
is reachable. `tools/verify-no-network.mjs` fails the build if any reachable module
grows a network call or if a second effect list appears.

**A feed does nothing until a rule matches.** There is no default mapping. A newly added
feed is silent until you map words in a headline onto one of the six registered effects,
because a feed that fired something the moment it was added would be one nobody could
predict. The effect always comes from the rule, never from the document: a headline
reading `lights-out` causes whatever you mapped `lights-out` to, which may be nothing.

**A feed can only select one of six effects.** It cannot supply a duration, a colour, a
command or a payload, because those are not in the type its headlines are matched
against.

### The rule editor

Settings → Integrations is where the rules live, and each feed is a card showing its
type, how often it is checked, how many hosts it may reach, and whether it is polling.

- **Poll this feed** starts and stops the feed. It writes through the engine, so the
  engine and the checkbox cannot disagree.
- **Add rule** is the words to match plus an effect. The dropdown is read from the
  engine's own registry (`window.__engine.getEffects()`), so the picker cannot offer an
  effect the renderer cannot draw — it has no list of its own to offer from.
- **Try a headline** asks the engine's own matcher which rule a sample headline would
  select. It triggers nothing, saves nothing and does not change the feed's enabled
  flag.
- **Try a document…** parses an XML or JSON file on this machine against every rule you
  have configured and reports what would fire. This is the offline path — no feed, no
  server, no request — and it is why the control is a tester rather than "add a file":
  only the host fetches, and only over https, so a local path can never become a
  configured feed.

Each card also shows a health line built from what the engine observed — last check, items
read, how many matched and how many caused an effect, or the last failure with the last
success beside it. It is updated by the status poll, which is why it does not rebuild the
card: a card that rebuilt once a second would discard a half-typed rule every second.

### The effect archive

Settings → Events lists every registered effect from the engine's own registry — name,
description, duration and where it can fire — so the reference cannot describe an effect
that does not ship. Each entry has a **Show in the world** button. It plays the effect once
in the live world, skips the journal and all persistence, and is refused (with the reason)
when the effect does not fit the current world rather than substituting another. That is the
one control on this page that reaches the world, and it only runs because it was pressed;
the non-firing tester above is the safe half.

The edits themselves are pure functions in `Core/FeedRules.cs` and are tested by
`tools/feed-rules.mjs`; the window is driven end to end by
`tools/settings-feed-ui.mjs`, which clicks **Add rule** and reads back the request the
window sent.

### What the host enforces

| Rule | Why |
|---|---|
| https only, except plain http on loopback | A feed URL pasted from a page is the easiest way to end up on `http://` |
| An explicit host allow-list, exact match | A substring test would pass `evil-github.com` and `github.com.attacker.net` |
| No redirects followed | The one thing that turns an allow-listed host into an arbitrary one |
| 256KB cap, applied while reading | A server that streams without end cannot make the host allocate whatever it likes |
| 15s timeout, and 60s between polls | The floor is also enforced in the renderer, because a renderer bug asking a thousand times a second is a denial of service pointed at somebody else's server |

`tools/event-feed.mjs` points the real fetcher at a loopback listener that redirects,
lies about its length and streams without end, and proves each rule holds.

## Weather

The sky is a function of where you are and when it is, not a random draw. It is seeded
by latitude and longitude, temperature follows the real latitude gradient and season,
and precipitation is decided by a freezing level rather than a coin flip. There is no
provider, no API key and no request, so it behaves identically offline and discloses
nothing about your location.

## Audio reactivity

The engine reacts to a file you choose, and never to what is playing on the system.
Capturing desktop audio needs a loopback device and a permission granted through a
picker, and a wallpaper is the last thing that should be asking for either.
`MediaReactivitySystem` has no capture path at all. The file is decoded locally, its
transients are found offline, and nothing is transmitted.

## Adding something new

Before adding an integration, decide where the request happens. If it is in the renderer,
it is blocked — and should be. A network integration belongs on the host side, behind the
same kind of explicit allow-list, and the renderer should learn only what it needs by a
name it did not choose. Add a check to `tools/verify-no-network.mjs` at the same time, so
the new surface is covered by the property rather than exempt from it.
