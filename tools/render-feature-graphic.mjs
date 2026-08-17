// Renders the Play Store feature graphic (1024x500, required) by shooting an
// HTML page through headless Chrome — same approach as the screenshot capture,
// so the mark, palette, and type match the app exactly.
//
// Usage: node tools/render-feature-graphic.mjs
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'store-assets');
const profileDir = join(outDir, '.chrome-profile-feature');
const PORT = 9455;

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

mkdirSync(outDir, { recursive: true });
rmSync(profileDir, { recursive: true, force: true });

// The octagon mark, inlined from icon.svg so the graphic can't drift from it.
const MARK = readFileSync(join(root, 'icon.svg'), 'utf8')
  .replace(/width="512" height="512"/, 'width="150" height="150"')
  .replace(/<rect[^>]*fill="#16181c"\/>/, ''); // transparent — page paints the bg

// A 16-step strip echoing the app's quad-colour banks, drawn as a rhythm.
const BANK_COLORS = ['#e0453a', '#f08a24', '#f2c94c', '#f5f0e6'];
const ROWS = [
  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,1,0],
  [1,0,1,0, 1,0,1,0, 1,0,1,0, 1,0,1,1],
  [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,1,0,0],
];
const grid = ROWS.map((row, r) => {
  const cells = row.map((on) => {
    const c = BANK_COLORS[r];
    return on
      ? `<i style="background:${c};border-color:${c};box-shadow:0 0 10px ${c}88"></i>`
      : `<i></i>`;
  }).join('');
  return `<div class="row">${cells}</div>`;
}).join('');

const html = `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: "Roboto Mono"; src: local("Roboto Mono"); }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 1024px; height: 500px; overflow: hidden; }
  body {
    background:
      radial-gradient(120% 140% at 78% 18%, #24282f 0%, #16181c 58%),
      #16181c;
    color: #d9d6cd;
    font-family: "Roboto Mono", ui-monospace, Consolas, monospace;
    display: grid;
    grid-template-columns: auto auto;
    justify-content: center;
    align-items: center;
    gap: 48px;
    padding: 0 56px;
  }
  .lockup { display: flex; align-items: center; gap: 24px; }
  .words { display: flex; flex-direction: column; gap: 10px; }
  .wordmark {
    font-size: 74px; font-weight: 700; letter-spacing: 0.18em;
    color: #f5f0e6; line-height: 1;
    text-shadow: 0 0 34px rgba(255, 184, 77, 0.28);
  }
  .tagline {
    font-size: 21px; letter-spacing: 0.3em; color: #ffb84d;
    text-transform: uppercase;
  }
  .sub {
    margin-top: 14px; font-size: 17px; letter-spacing: 0.08em; color: #8b8880;
    line-height: 1.7; white-space: nowrap;
  }
  .grid { display: flex; flex-direction: column; gap: 7px; }
  .row { display: flex; gap: 7px; }
  .row i {
    width: 21px; height: 21px; border-radius: 5px;
    background: #1b1e23; border: 1px solid #3a3f47;
  }
</style>
<div>
  <div class="lockup">
    ${MARK}
    <div class="words">
      <div class="wordmark">OCTA</div>
      <div class="tagline">drum machine</div>
    </div>
  </div>
  <div class="sub">8 synth voices · 16-step sequencer<br>swing · pattern chaining · offline</div>
</div>
<div class="grid">${grid}</div>
`;

const htmlPath = join(outDir, '.feature-graphic.html');
writeFileSync(htmlPath, html);

const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profileDir}`, 'about:blank',
], { stdio: 'ignore' });

try {
  let ws;
  for (let i = 0; i < 40 && !ws; i++) {
    try {
      const targets = await (await fetch(`http://localhost:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
          ws.addEventListener('open', res, { once: true });
          ws.addEventListener('error', rej, { once: true });
        });
      }
    } catch { /* still starting */ }
    if (!ws) await new Promise((r) => setTimeout(r, 250));
  }
  if (!ws) throw new Error('Could not attach to Chrome');

  let nextId = 1;
  const send = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const onMessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id !== id) return;
        ws.removeEventListener('message', onMessage);
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  await send('Emulation.setDeviceMetricsOverride', {
    width: 1024, height: 500, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.enable');
  await send('Page.navigate', { url: `file:///${htmlPath.replace(/\\/g, '/')}` });
  await new Promise((r) => setTimeout(r, 1200));

  // Guard against silent clipping: the 16-step strip overflowed 1024px on the
  // first pass and the right edge was cut off in the exported PNG.
  const fit = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      scrollW: document.documentElement.scrollWidth,
      scrollH: document.documentElement.scrollHeight,
    })`,
  });
  const { scrollW, scrollH } = JSON.parse(fit.result.value);
  if (scrollW > 1024 || scrollH > 500) {
    throw new Error(
      `Feature graphic content overflows 1024x500 (is ${scrollW}x${scrollH}) — ` +
      `the export would be clipped. Shrink the type or the step strip.`
    );
  }

  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  const buf = Buffer.from(data, 'base64');
  const out = join(outDir, 'feature-graphic.png');
  writeFileSync(out, buf);
  console.log(`feature-graphic.png  ${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`);
} finally {
  chrome.kill();
}
