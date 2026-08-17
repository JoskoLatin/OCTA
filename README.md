# OCTA

**8-voice groovebox** — a mobile-first, 808-inspired drum machine that runs
entirely in the browser. No build step, no frameworks, no sample files: all
eight voices are synthesised live with the Web Audio API.

<p align="center">
  <img src="icon-512.png" width="140" alt="OCTA logo — an octagon drum pad">
</p>

## Features

- **8 synth voices** — BD kick, SD snare, CH/OH hats, CP clap, TM tom, RS
  rimshot, CY crash. All 808-style, generated in real time.
- **16-step sequencer** with a sample-accurate lookahead scheduler — no
  timing drift after minutes of playback.
- **BPM 60–200** and **swing 0–60%**, both changeable while playing.
- **4 pattern slots (A/B/C/D)** — switching mid-play takes effect at the
  next bar.
- **Finger-drumming pads** that trigger on `pointerdown` for low latency.
- **Per-voice mixer**, tap tempo, autosave to `localStorage`, and JSON
  export/import.
- Installable **PWA** with offline support.

## Run it on your phone (Windows 11 / PowerShell)

The app is just static files, so any local web server works. Your phone and
PC must be on the **same Wi-Fi network**.

### 1. Start a server from the project folder

```powershell
cd path\to\octa

# Option A — Node (downloads 'serve' on first use):
npx serve -l 8080

# Option B — Python 3:
python -m http.server 8080
```

### 2. Find your PC's local IP address

```powershell
(Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' }
).IPAddress
```

Note the address it prints (e.g. `192.168.1.42`).

### 3. Open it on the phone

In Chrome on Android, browse to:

```
http://<your-ip>:8080
```

for example `http://192.168.1.42:8080`. Press **PLAY** — pattern A is
preloaded with a house groove, so it makes sound immediately.

> **First tap makes the sound:** Android blocks audio until you interact
> with the page, so the audio engine is created/resumed on your first tap.

### 4. (Optional) Install to the home screen

In Chrome's menu choose **Add to Home screen**. OCTA installs as a
standalone, portrait app with its own icon and works offline afterwards.

### If the phone can't reach the server

Windows Firewall usually prompts on first run — allow access on
**Private networks**. To add a rule manually (run PowerShell as
Administrator):

```powershell
New-NetFirewallRule -DisplayName "OCTA dev server" -Direction Inbound `
  -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | Markup + service-worker registration |
| `style.css` | Dark hardware theme, portrait layout |
| `audio.js` | Web Audio synthesis engine (`AudioEngine`) |
| `sequencer.js` | Lookahead scheduler + patterns (`Sequencer`) |
| `ui.js` | DOM wiring, draw loop, persistence |
| `manifest.json`, `sw.js` | PWA manifest + offline service worker |
| `icon.svg`, `favicon.svg`, `icon-192/512.png` | Branding / PWA icons |
| `tools/render-icons.ps1` | Regenerates the PNG icons from the mark |

## Regenerating the icons

If you tweak the logo, re-render the PNGs:

```powershell
.\tools\render-icons.ps1
```

## Extending it later

The code is commented with extension in mind:

- **Velocity per step** — the grid stores `0/1`; widen to `0..1` and pass it
  as a gain multiplier into `engine.trigger(id, time, velocity)`.
- **More sounds** — add an entry to `VOICES` in `audio.js` and a
  matching `_synth` method; the grid, pads, and mixer build themselves from
  that list.
- **APK packaging** — wrap with [Capacitor](https://capacitorjs.com/)
  (`npx cap init`, add the Android platform, copy these files into
  `www/`). The PWA manifest and service worker are already in place.

## Notes on audio quality

- Gains are ramped with `exponentialRampToValueAtTime` and never hard-stopped
  at a nonzero value, so there are no clicks.
- Note timing runs on the AudioContext hardware clock via a 25 ms
  lookahead scheduler (not `setInterval` note-by-note), so it stays locked
  even when the main thread is busy.
