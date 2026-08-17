// Captures Play Store screenshots from the real app via Chrome DevTools
// Protocol. Uses Emulation.setDeviceMetricsOverride rather than Chrome's
// --window-size flag, because headless window sizing does not map 1:1 to the
// layout viewport (a 412px window reported innerWidth 500, silently cropping
// the capture).
//
// Usage: node tools/capture-store-screenshots.mjs [port]
// Expects a static server for the app root on http://localhost:8099.
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'store-assets');
const profileDir = join(outDir, '.chrome-profile-cdp');
const PORT = Number(process.argv[2] ?? 9444);
const APP_URL = 'http://localhost:8099/index.html';

// Play requires phone screenshots between 320px and 3840px per side, 16:9-ish
// portrait reads best. 412x915 @2 dpr = 824x1830, comfortably inside limits.
const PHONE = { width: 412, height: 915, scale: 2 };
const LANDSCAPE = { width: 915, height: 412, scale: 2 };

// Seed the demo song so every shot shows real content — the built-in default
// only fills slot A, which left the chain/landscape shots on an empty grid.
const STORAGE_KEY = 'octa.state.v1';
const DEMO_SONG = readFileSync(join(root, 'octa-song.json'), 'utf8');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

const chromePath = CHROME_CANDIDATES.find(existsSync);
if (!chromePath) {
  console.error(`No Chrome found. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  process.exit(1);
}

rmSync(profileDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--mute-audio',
  // togglePlay() awaits engine.unlock(); without this the AudioContext stays
  // suspended (synthetic pointer events are not a user gesture), the await
  // never settles, and the transport never starts for the capture.
  '--autoplay-policy=no-user-gesture-required',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  'about:blank',
], { stdio: 'ignore' });

/** Minimal CDP client over the page's WebSocket. */
class Cdp {
  constructor(ws) { this.ws = ws; this.nextId = 1; }
  static async attach(port) {
    for (let i = 0; i < 40; i++) {
      try {
        const targets = await (await fetch(`http://localhost:${port}/json`)).json();
        const page = targets.find((t) => t.type === 'page');
        if (page) {
          const ws = new WebSocket(page.webSocketDebuggerUrl);
          await new Promise((res, rej) => {
            ws.addEventListener('open', res, { once: true });
            ws.addEventListener('error', rej, { once: true });
          });
          return new Cdp(ws);
        }
      } catch { /* Chrome still starting */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('Could not attach to Chrome via CDP');
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const onMessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id !== id) return;
        this.ws.removeEventListener('message', onMessage);
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
      };
      this.ws.addEventListener('message', onMessage);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true });
    return r.result?.value;
  }
  async navigate(url, seedState) {
    await this.send('Page.enable');
    // Seed localStorage before the app's own load() runs, so it boots with
    // this state instead of the built-in default pattern.
    if (seedState) {
      await this.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `localStorage.setItem(${JSON.stringify(STORAGE_KEY)}, ${JSON.stringify(seedState)});`,
      });
    }
    await this.send('Page.navigate', { url });
    // Wait for the app's own readiness signal: the pads are built by ui.js.
    for (let i = 0; i < 60; i++) {
      const ready = await this.eval(
        `!!document.querySelector('#pads .pad') && document.readyState === 'complete'`
      );
      if (ready) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 400)); // let transitions settle
  }
  async setViewport({ width, height, scale }) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: scale, mobile: true,
    });
    await this.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  }
  async shot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(outDir, file), Buffer.from(data, 'base64'));
    const buf = Buffer.from(data, 'base64');
    console.log(`${file}  ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`);
  }
}

const cdp = await Cdp.attach(PORT);

try {
  await cdp.setViewport(PHONE);
  await cdp.navigate(APP_URL, DEMO_SONG);

  // 1. Main view, demo song loaded.
  await cdp.shot('screenshot-1-main.png');

  // 2. Playing + CHAIN armed, caught mid-bar so the playhead LED is lit.
  // The demo song already stores chain:true, so only press CHAIN if it is off
  // — a blind toggle would switch it back off.
  await cdp.eval(`
    (() => {
      const tap = (el) => el.dispatchEvent(new PointerEvent('pointerdown', {bubbles:true}));
      tap(document.getElementById('btnPlay'));
      const chain = document.getElementById('btnChain');
      if (chain.getAttribute('aria-pressed') !== 'true') tap(chain);
      return true;
    })()
  `);
  // Confirm the transport actually latched before shooting — the await inside
  // togglePlay() means the class lands a tick after the event.
  for (let i = 0; i < 25; i++) {
    if (await cdp.eval(`document.getElementById('btnPlay').classList.contains('is-on')`)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 700)); // land a few steps into the bar
  await cdp.shot('screenshot-2-playing.png');

  // 3. Mixer open. The mixer panel sits below the fold on a phone viewport,
  // so scroll it fully into frame rather than shipping a clipped panel.
  await cdp.eval(
    `document.getElementById('btnMix').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})), true`
  );
  await new Promise((r) => setTimeout(r, 400));
  await cdp.eval(`window.scrollTo(0, document.body.scrollHeight), true`);
  await new Promise((r) => setTimeout(r, 400));
  await cdp.shot('screenshot-3-mixer.png');

  // 4. Landscape performance layout. Close the mixer and undo the scroll from
  // shot 3, otherwise the capture starts mid-page.
  await cdp.eval(
    `document.getElementById('btnMix').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true})), true`
  );
  await cdp.setViewport(LANDSCAPE);
  await cdp.eval(`window.scrollTo(0, 0), true`);
  await new Promise((r) => setTimeout(r, 500));
  await cdp.shot('screenshot-4-landscape.png');
} finally {
  chrome.kill();
}
