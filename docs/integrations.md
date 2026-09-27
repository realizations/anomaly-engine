# Integrations

## Overview

Anomaly Engine supports external data sources through adapters. Each adapter
is independently enabled/disabled.

## Weather

### Providers

- OpenWeatherMap
- WeatherAPI
- Custom (user-defined endpoint)

### Configuration

```json
{
  "weather": {
    "provider": "openweathermap",
    "apiKey": "your-key",
    "location": "auto",
    "updateInterval": 600
  }
}
```

### Events Emitted

- `weather.updated` — new weather data
- `weather.rain_started` / `weather.rain_stopped`
- `weather.storm_started` / `weather.storm_stopped`
- `weather.fog_started` / `weather.fog_stopped`

## GitHub

### Configuration

```json
{
  "github": {
    "username": "your-username",
    "repositories": ["your-repo"],
    "updateInterval": 300
  }
}
```

### Events Emitted

- `github.commit` — new commit
- `github.release` — new release
- `github.issue_opened` / `github.issue_closed`
- `github.pr_opened` / `github.pr_merged`

## RSS/Atom

### Configuration

```json
{
  "rss": {
    "feeds": [
      { "url": "https://example.com/feed.xml", "interval": 3600 }
    ]
  }
}
```

### Events Emitted

- `rss.new_item` — new feed item

## Media

### Events Emitted

- `media.playing` — media started
- `media.paused` — media paused
- `media.stopped` — media stopped
- `media.track_changed` — new track

## Network

### Events Emitted

- `network.online` — internet connected
- `network.offline` — internet disconnected

## Remote Event Feed

### Configuration

```json
{
  "remoteEvents": {
    "endpoint": "https://example.com/events.json",
    "interval": 300,
    "timeout": 10
  }
}
```

### Format

```json
{
  "events": [
    {
      "event": "rare_signal",
      "start": "2026-09-27T03:33:00Z",
      "duration": 900,
      "payload": { "frequency": 73.4 }
    }
  ]
}
```
