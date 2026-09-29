# Naming

The current working name is **Anomaly Engine** (`github.com/realizations/anomaly-engine`).
This document records why we looked for alternatives, what the options are, and how to
execute a rename if you pick one.

## Why change

A collision check on 2026-09-29 found:

| Finding | Detail |
|---|---|
| **Exact commercial product** | Melrose Networks ships a commercial product called *Anomaly Engine* (LTE/5G anomaly detection). Different category, identical name. |
| **Generic technical phrase** | "Anomaly engine" is standard industry vocabulary for ML outlier detection. It reads as infrastructure, not as a piece of art. |
| **Saturated on GitHub** | Dozens of repositories: `cantiz-anomaly-engine`, `rust-edge-anomaly-engine`, `logflow-anomaly-engine`, and many more. Discovery is effectively zero. |
| **Discoverability** | The repo is public with 0 stars. A generic name is the single biggest reason a project like this stays invisible. |

None of this makes the name unusable. It makes it hard to find and hard to protect.

## The naming problem worth solving

The product is not a wallpaper app. It is a **persistent fictional world on your desktop**
that occasionally does something you cannot be certain about. The name should carry that
ambiguity, not describe the mechanism.

Two things a good name here must do:

1. **Survive being ambient.** It will be a GitHub org, a tray tooltip, a folder name, and
   the name of a fictional place. It should feel like a place or a vigil, not a feature.
2. **Not promise the feature set.** Anything containing "wallpaper", "desktop" or
   "engine" boxes us in. The engine is the vehicle; the world is the product.

## Recommendation

> **Watchnight** — the night watch, and the watch worn at night.

- Two readings, both on-thesis: the vigil kept over something while you sleep, and the
  timepiece that measures the wait.
- Collision check: only hit is a 2007 choral work. **LOW** risk.
- Both readings survive being a repo name, a tray tooltip, and an in-world placename.
- It does not describe the mechanism, so it survives us adding platforms.

### Runners-up, if you want a different register

| Name | Meaning | Risk | Note |
|---|---|---|---|
| **Marram** | Dune grass that holds a coastline together | LOW | A world held by slow accretion rather than events. |
| **Scree** | Loose stone shifting on a slope | LOW | A landscape caught mid-transition, never resolving. |
| **Fell** | Northern high bare moor, above the weather | LOW | Four letters, hard to mispronounce. |
| **Mote** | Dust that only exists when light passes through it | LOW | The smallest observable unit of a world. |
| **Saltwick** | Saltmarsh grass at the land/water boundary | LOW | Exactly the day/night boundary. |
| **Sallow** | A willow; also the sickly yellow-green of bad light | LOW | Pretty and faintly wrong. Good for the anomaly layer. |
| **Brineglass** | Salt glass: sea and lens in one word | LOW | A horizon you look at and never see past. |
| **Hollow Hours** | The stretch of night where nothing happens | MEDIUM | Precisely where the anomalies hide. |

### Rejected, with reasons

`Nocturne`, `Vesper`, `Halcyon`, `Lantern`, `Watchtower`, `Watchman`, `Parallax`,
`Fathom`, `Tidewater`, `Stillwater`, `Quiet Hours`, `Livedesktop`, `Ambient OS`,
`Evening Star`, `Sleepwalker` — all HIGH collision risk. Several are famous games or
films (*Nocturne* is a 1999 game and a Final Fantasy spinoff title; *Evening Star* is a
Fripp & Eno record). `containrrr/watchtower` has ~25k GitHub stars. `Nocturne Engine` is
a literal existing game engine.

## Naming system for the ARG layer

The low-risk cluster (Watchnight, Marram, Scree, Fell, Mote, Downland, Saltwick, Sallow)
shares a coastal-upland-English register. If we adopt one of them, the rest make a
consistent world vocabulary for placenames, anomaly names and community events, without
any of them reading as software:

| Word | Use |
|---|---|
| Watchnight | The product. Also the phenomenon of a long unattended night. |
| Fell | The high ground above the treeline. A place name. |
| Marram | The grass that holds things together. The settlement. |
| Saltwick | The tidal boundary. Where the world's rules thin out. |
| Sallow | The sickly-light tree. Where anomalies are seen. |

## If you rename: what actually has to change

The rename is mostly cosmetic, because the engine hardcodes the name in a small number
of places. Verified locations:

| Location | What to change |
|---|---|
| `github.com/realizations/anomaly-engine` | Repo name; keeps redirect + clone URLs working |
| `src/AnomalyEngine/AnomalyEngine.csproj` | `AssemblyName`, `RootNamespace`, `Product` |
| `src/AnomalyEngine/` folder | Project folder path |
| `%APPDATA%\AnomalyEngine\` | User data + WebView2 profile dir (rename would orphan existing user data) |
| `index.html` boot text | `waking the town` copy, if the copy changes |
| `TrayIcon.cs` | Tooltip and About string |
| `EngineApp.cs` | Single-instance mutex name |
| `assets/manifest.json` | `sourceUrl` entries referencing the repo |

**Recommendation: rename the repo and the display strings, but keep the
`AnomalyEngine` assembly name and `%APPDATA%` folder for v0.x.** Renaming the user-data
path is a breaking change for existing installs and buys nothing user-visible. Revisit at
v1.0 when there are no users to strand.

## Before committing to any name

This check was search-engine and DNS based. It did **not** query USPTO/EUIPO registers and
did not run WHOIS. Before a public launch, run a real trademark search on your top two
names, and verify GitHub org, npm and PyPI availability.
