# Complete Setup & Release Guide

This guide walks you through everything step by step. No prior experience needed.

---

## Part 1: Run the Engine on Your Desktop

### Step 1: Install Prerequisites

1. **Install .NET 8 SDK**
   - Go to https://dotnet.microsoft.com/download/dotnet/8.0
   - Click "Download .NET SDK" (x64)
   - Run the installer
   - Restart your computer

2. **Install Node.js**
   - Go to https://nodejs.org/
   - Download the LTS version
   - Run the installer (click Next through everything)
   - Restart your computer

3. **Verify WebView2 is installed**
   - Press `Win + R`, type `ms-settings:apps`
   - Search for "WebView2"
   - If not found, download from https://developer.microsoft.com/microsoft-edge/webview2/

### Step 2: Build the Engine

1. **Open PowerShell**
   - Press `Win + X`, select "Windows PowerShell" or "Terminal"

2. **Clone the repository**
   ```powershell
   git clone https://github.com/realizations/anomaly-engine.git
   cd anomaly-engine
   ```

3. **Build the web renderer**
   ```powershell
   cd src/Engine
   npm install
   npm run build
   ```

4. **Build the native host**
   ```powershell
   cd ..\AnomalyEngine
   dotnet build
   ```

### Step 3: Run the Engine

1. **Start the engine**
   ```powershell
   dotnet run
   ```

2. **What you should see**
   - A console window opens with log messages
   - Your desktop wallpaper changes to the world
   - A tray icon appears in your system tray (bottom-right, near the clock)

3. **If it doesn't work**
   - Check the console for error messages
   - Make sure WebView2 is installed
   - Try restarting your computer
   - Open an issue on GitHub with the error message

### Step 4: Interact with the World

1. **Wait for the world to load** (takes a few seconds)
2. **Move your mouse** over the forest — leaves should rustle
3. **Click** the observatory — a signal should begin
4. **Right-click** the tray icon — opens the menu
5. **Click "Open Settings"** — opens the settings window
6. **Try the Konami code**: `↑ ↑ ↓ ↓ ← → ← → B A`

---

## Part 2: Record a Demo GIF

### Step 1: Install OBS Studio

1. Go to https://obsproject.com/
2. Download OBS Studio for Windows
3. Run the installer (click Next through everything)
4. Open OBS Studio

### Step 2: Configure OBS

1. **Add a display capture source**
   - In OBS, click the `+` under "Sources"
   - Select "Display Capture"
   - Select your main monitor
   - Click OK

2. **Set the recording area**
   - Right-click the source → "Transform" → "Fit to screen"
   - Or crop to just the wallpaper area

3. **Configure output settings**
   - Go to Settings → Output
   - Set "Recording Quality" to "High Quality"
   - Set "Recording Format" to "mp4" (we'll convert to GIF later)

4. **Configure video settings**
   - Go to Settings → Video
   - Set "Base Resolution" to your monitor resolution
   - Set "FPS" to 30

### Step 3: Record the Demo

1. **Start recording**
   - Click "Start Recording" in OBS

2. **Show the following scenes** (record each for 10-15 seconds):
   - **Daytime**: Wait for morning (8-10 AM) or change time in settings
   - **Sunset**: Wait for dusk (5-7 PM) or use "Set Time" in creator mode
   - **Night**: Wait for night (8+ PM) or use "Set Time"
   - **Rain**: Use creator mode to set weather to rain
   - **Anomaly**: Trigger an anomaly via tray → "Trigger Event"
   - **Settings**: Open settings window
   - **Konami code**: Enter the code

3. **Stop recording**
   - Click "Stop Recording" in OBS
   - The video is saved to your Videos folder

### Step 4: Convert to GIF

1. **Install FFmpeg**
   - Go to https://ffmpeg.org/download.html
   - Download Windows build
   - Extract to `C:\ffmpeg`
   - Add to PATH: Search "Environment Variables" → Edit system environment variables → Path → New → `C:\ffmpeg\bin`

2. **Convert video to GIF**
   ```powershell
   ffmpeg -i %USERPROFILE%\Videos\obs-recording.mp4 -vf "fps=15,scale=800:-1:flags=lanczos" -loop 0 demo.gif
   ```

3. **Optimize GIF size** (optional)
   ```powershell
   ffmpeg -i demo.gif -vf "fps=10,scale=600:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse" demo-optimized.gif
   ```

4. **Upload to GitHub**
   - Go to your repo on GitHub
   - Click "Issues" → "New Issue"
   - Drag and drop the GIF into the issue
   - Or use a service like https://imgur.com/ and paste the link

---

## Part 3: Change How the World Looks

### There is no asset pipeline

This project draws everything procedurally. There is no sprite folder, no texture
atlas, no scene file and no importer, because there is nothing to import: a tree is
a function of the world seed, and a ridge is noise. Adding a PNG does nothing,
because nothing looks for one.

That is a deliberate position rather than an unfinished feature, and it is enforced:
`tools/license-gate.mjs` reads `assets/manifest.json` and fails the build on any
undeclared asset or any licence the project rejects. The only assets that ship are
three SIL OFL typefaces.

An earlier version of this section recommended Piskel, Aseprite, GIMP, DALL-E and
Midjourney, and described a `worlds/<id>/assets/sprites/` folder referenced from
HTML with `<img>` and `<audio>` tags. None of that exists, and the generator
recommendations conflict with the licensing policy above: an image model does not
grant you the right to redistribute its output.

### What you can actually change

Four kinds of thing, all of them data:

| To change | Edit |
|---|---|
| A place | `src/Engine/src/worlds/registry.ts` — biome, palette, terrain numbers, structures |
| Something strange | `src/Engine/src/anomalies/builtin.ts` |
| Something to notice | `src/Engine/src/systems/MomentSystem.ts` and `SecretSystem.ts` |
| The look of an existing scene | `src/Engine/src/render/palette.ts` keyframes |

Adding a world is the highest-leverage change available and needs no art at all:
a world is about forty lines of numbers, and six ship today. The format, the biome
rules and the validation are in [`world-format.md`](world-format.md); events and
anomalies are in [`creating-events.md`](creating-events.md).

Every identifier you add is checked against what ships. `tests/ShippedIds.test.ts`
asserts that every id in the data files resolves, because a wrong one produces a
lookup that misses and a fallback that looks fine — which is how four wrong
anomaly names went unnoticed until this session.

### Audio

There is no audio pipeline and no audio ships. `MediaReactivitySystem` exists and
is constructed, but it samples nothing, so it has no input to react to. Desktop
audio capture is listed as a deliberate non-goal for now rather than an oversight.

### Typefaces

The three bundled families are the one place art enters the project, because
typography is the one thing procedural generation cannot fake convincingly. They
are recorded in `assets/manifest.json` with their licence, and two checks make the
claim falsifiable: `verify-fonts.mjs` parses each file's real name table, and
`verify-fonts-use.mjs` proves each family loads *and* that the application still
asks for it.

---

## Part 4: Performance Benchmarks

### Step 1: Install Benchmark Tools

1. **Install MSI Afterburner** (optional, for GPU monitoring)
   - Download from https://www.msi.com/Landing/afterburner
   - Install and run

2. **Use Windows Task Manager**
   - Press `Ctrl + Shift + Esc`
   - Go to "Performance" tab
   - Monitor CPU, GPU, and memory usage

### Step 2: Run the Benchmark Scene

1. **Open the engine**
   ```powershell
   cd src\AnomalyEngine
   dotnet run
   ```

2. **Open the debug overlay**
   - Press `Ctrl + Alt + D`
   - The overlay shows FPS, frame time, memory

3. **Record baseline metrics**
   - Let the engine run for 5 minutes
   - Note the average FPS
   - Note the memory usage
   - Note the CPU usage

### Step 3: Test Different Render Scales

There are no named quality presets. The engine has one dial — a render scale,
which the scene renders at and then blits up — plus an automatic mode that moves it
to hold a frame budget. An earlier version of this step told you to switch between
Low, Medium, High and Ultra, none of which exist.

1. **Open settings** (right-click tray icon → Open Settings)
2. **Performance → Render Quality**, or from the engine directly:
   ```js
   window.__engine.setRenderScale(0.5);   // half resolution
   window.__engine.setRenderScale(null);  // back to automatic
   ```
3. **Record metrics** for 5 minutes at each of `0.5`, `0.75` and `1`
4. **Watch the automatic mode** instead, which is the one users actually run:
   ```bash
   node tools/perf-gpu.mjs
   ```
   It renders on the real GPU, reports the median frame cost, and pins the scale
   back under load to prove the adaptive path responds.

### Step 4: Document Results

Create a table like this:

| Render scale | Frame ms | FPS | Memory (MB) | CPU (%) | GPU (%) |
|---|---|---|---|---|---|
| 1.0 | | | | | |
| 0.75 | | | | | |
| 0.5 | | | | | |

Frame time is the number that matters, not FPS: a wallpaper at 30 fps that costs
6 ms per frame is fine, and one at 60 fps that costs 18 ms is stuttering. Frame
budgets are 16.7 ms at 60 Hz and 8.3 ms at 120 Hz.

### Step 5: Share Results

1. **Update the README** with your results
2. **Open an issue** with your benchmark data
3. **Include your system specs**:
   - CPU model
   - GPU model
   - RAM amount
   - Windows version

---

## Part 5: Final Testing Checklist

### Functional Testing

- [ ] Engine starts without errors
- [ ] Wallpaper renders behind desktop icons
- [ ] Desktop icons are clickable
- [ ] Right-click menu works
- [ ] Tray icon appears
- [ ] Pause/Resume works
- [ ] Settings window opens
- [ ] World changes with time of day
- [ ] Stars appear at night
- [ ] Sun/moon move across sky
- [ ] Clouds move
- [ ] Rain/snow particles work
- [ ] Anomalies trigger
- [ ] Journal records entries
- [ ] Secrets can be discovered
- [ ] Hotkeys work
- [ ] Konami code works
- [ ] CLI commands work

### Performance Testing

- [ ] Stable 60 FPS at High quality
- [ ] Memory usage under 100MB
- [ ] CPU usage under 20%
- [ ] No frame drops during anomalies
- [ ] No memory leaks over 1 hour

### Compatibility Testing

- [ ] Works on Windows 10
- [ ] Works on Windows 11
- [ ] Works with multiple monitors
- [ ] Works with different resolutions
- [ ] Works with different DPI settings

---

## Part 6: Release Checklist

### Before Release

- [ ] All tests pass (`dotnet test` and `npm test`)
- [ ] No console errors
- [ ] README is up to date
- [ ] Documentation is complete
- [ ] Demo GIF is recorded
- [ ] Performance benchmarks are documented
- [ ] License file is present
- [ ] Third-party notices are present

### Create a Release

1. **Update version numbers**
   - `src/AnomalyEngine/AnomalyEngine.csproj` — `<Version>0.1.0</Version>`
   - `src/Engine/package.json` — `"version": "0.1.0"`

2. **Commit the version bump**
   ```powershell
   git add -A
   git commit -m "chore: bump version to 0.1.0"
   git push origin main
   ```

3. **Create a tag**
   ```powershell
   git tag v0.1.0
   git push origin v0.1.0
   ```

4. **GitHub Actions will automatically:**
   - Build the project
   - Run tests
   - Create a release
   - Upload artifacts

5. **Verify the release**
   - Go to https://github.com/realizations/anomaly-engine/releases
   - Check that the release was created
   - Download and test the release

---

## Part 7: Share Your Work

### Social Media

- **Twitter/X**: Post the demo GIF with `#AnomalyEngine #LiveWallpaper`
- **Reddit**: Post to r/wallpaperengine, r/windows, r/programming
- **Discord**: Share in relevant Discord servers
- **YouTube**: Upload a demo video

### GitHub

- **Star the repo** if you like it
- **Watch the repo** for updates
- **Fork the repo** to create your own worlds
- **Open issues** for bugs or feature requests
- **Submit PRs** for improvements

---

## Need Help?

- [Getting Started](getting-started.md) — Quick start guide
- [How to Use](how-to-use.md) — Full usage guide
- [Contributing](../CONTRIBUTING.md) — How to contribute
- [Issues](https://github.com/realizations/anomaly-engine/issues) — Bug reports
- [Discussions](https://github.com/realizations/anomaly-engine/discussions) — General questions

---

<p align="center">
  <sub>Good luck. The desktop is waiting.</sub>
</p>
