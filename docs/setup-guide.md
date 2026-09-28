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

## Part 3: Create Original Art & Audio Assets

### Step 1: Plan Your Assets

Decide what you want to create:

| Asset Type | Description | Format |
|------------|-------------|--------|
| Sprites | Trees, buildings, creatures | PNG with transparency |
| Textures | Ground, sky, surfaces | PNG or WebP |
| Audio | Ambient sounds, effects | WAV or OGG |
| Animations | Creature movements | WebM or sprite sheets |

### Step 2: Create Sprites

**Option A: Use free tools**
- **Piskel** (https://www.piskelapp.com/) — Free online sprite editor
- **Aseprite** (https://www.aseprite.com/) — Paid, professional pixel art
- **GIMP** (https://www.gimp.org/) — Free image editor

**Option B: Use AI tools**
- **DALL-E** or **Midjourney** — Generate concept art
- **Remove.bg** — Remove backgrounds

**Sprite guidelines:**
- Use PNG with transparent background
- Keep sizes small (64x64 to 256x256 pixels)
- Use consistent art style
- Name files descriptively: `tree-pine-01.png`, `cabin-window.png`

### Step 3: Create Audio

**Option A: Record your own**
- Use a microphone
- Record ambient sounds (rain, wind, birds)
- Edit with **Audacity** (https://www.audacityteam.org/) — Free

**Option B: Use free sound libraries**
- **Freesound** (https://freesound.org/) — Free sound effects
- **Zapsplat** (https://www.zapsplat.com/) — Free sound effects
- **Mixkit** (https://mixkit.co/) — Free music and sounds

**Audio guidelines:**
- Use WAV or OGG format
- Keep file sizes small (under 1MB per sound)
- Loop ambient sounds seamlessly
- Name files descriptively: `rain-light.ogg`, `wind-forest.ogg`

### Step 4: Add Assets to the World

1. **Copy assets to the world folder**
   ```
   worlds/the-town-that-wasnt-there/assets/
     sprites/
     audio/
     textures/
   ```

2. **Reference assets in your scene**
   ```html
   <img src="assets/sprites/tree-pine-01.png" class="tree">
   <audio src="assets/audio/rain-light.ogg" loop></audio>
   ```

3. **Test the assets**
   - Run the engine
   - Verify assets load correctly
   - Check for errors in the console

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

### Step 3: Test Different Quality Presets

1. **Open settings** (right-click tray icon → Open Settings)
2. **Change quality preset** to "Low"
3. **Record metrics** for 5 minutes
4. **Repeat** for Medium, High, Ultra

### Step 4: Document Results

Create a table like this:

| Quality | FPS | Memory (MB) | CPU (%) | GPU (%) |
|---------|-----|-------------|---------|---------|
| Low | 60 | 15 | 2 | 5 |
| Medium | 60 | 25 | 5 | 10 |
| High | 60 | 45 | 10 | 20 |
| Ultra | 45 | 80 | 20 | 40 |

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
