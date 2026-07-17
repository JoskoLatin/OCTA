/* ═══════════════════════════════════════════════════════════════════════
   OCTA — UI + persistence

   Everything interactive reacts on `pointerdown`, not `click`: on Android
   that's the difference between a pad feeling like hardware and feeling
   like a web page. pointerdown fires the instant your finger lands.

   The step indicator is driven by a requestAnimationFrame loop that
   consumes sequencer.drawQueue — see the timing notes in sequencer.js.
   ═══════════════════════════════════════════════════════════════════════ */

const STORAGE_KEY = 'octa.state.v1';
const SAVE_DEBOUNCE_MS = 500;

const engine = new AudioEngine();
const seq = new Sequencer(engine);

/* ── element refs ───────────────────────────────────────────────────── */
const el = {
  body:        document.body,
  grid:        document.getElementById('grid'),
  ledStrip:    document.getElementById('ledStrip'),
  pads:        document.getElementById('pads'),
  mixer:       document.getElementById('mixer'),
  mixerRows:   document.getElementById('mixerRows'),
  btnPlay:     document.getElementById('btnPlay'),
  btnClear:    document.getElementById('btnClear'),
  btnMix:      document.getElementById('btnMix'),
  btnTap:      document.getElementById('btnTap'),
  btnExport:   document.getElementById('btnExport'),
  btnImport:   document.getElementById('btnImport'),
  fileInput:   document.getElementById('fileInput'),
  patternBtns: document.getElementById('patternBtns'),
  bpmSlider:   document.getElementById('bpmSlider'),
  bpmReadout:  document.getElementById('bpmReadout'),
  swingSlider: document.getElementById('swingSlider'),
  swingReadout:document.getElementById('swingReadout')
};

/** Cell lookup: cells[row][step] → the DOM node. */
const cells = [];
const rowEls = [];    // one .grid-row per voice
const muteBtns = [];  // the left mute button per voice
let ledNodes = [];
let lastDrawnStep = -1;

/* ── persistence ────────────────────────────────────────────────────── */

let saveTimer = null;

/** Debounced autosave — every edit calls this, we write at most every 500ms. */
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
    } catch (e) {
      console.warn('Autosave failed:', e);
    }
  }, SAVE_DEBOUNCE_MS);
}

/** Full app state: patterns, tempo, swing, mixer, selected slot. */
function snapshot() {
  return Object.assign({ version: 1, volumes: engine.volumes }, seq.toJSON());
}

function load() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    return; // private mode / storage disabled — just run with defaults
  }
  if (!raw) return;
  try {
    applyState(JSON.parse(raw));
  } catch (e) {
    console.warn('Saved state was unreadable, starting fresh:', e);
  }
}

/** Apply a state object (from localStorage or an imported file) to everything. */
function applyState(data) {
  if (!seq.fromJSON(data)) return false;
  if (data.volumes && typeof data.volumes === 'object') {
    for (const v of VOICES) {
      const val = data.volumes[v.id];
      if (typeof val === 'number' && val >= 0 && val <= 1) engine.setVolume(v.id, val);
    }
  }
  syncControls();
  paintGrid();
  paintMutes();
  return true;
}

/**
 * Re-space the tagline so it spans exactly the width of the OCTA wordmark.
 * Done in JS because the natural text isn't that width — we distribute the
 * difference evenly across the characters as letter-spacing.
 */
// Measure the true rendered width of an element's glyphs. A Range bounds the
// text itself, so it ignores flex stretching of the element box and any
// trailing letter-spacing after the last glyph — unlike getBoundingClientRect.
function glyphWidth(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  return r.getBoundingClientRect().width;
}

function fitTagline() {
  const word = document.querySelector('.wordmark');
  const tag = document.querySelector('.tagline');
  if (!word || !tag) return;
  const n = tag.textContent.length;
  if (n < 2) return;
  tag.style.letterSpacing = '0px';
  // Spread the tagline so its first and last glyphs sit under OCTA's O and A.
  // The wordmark carries a trailing letter-spacing unit after the "A" that
  // some browsers fold into the Range width, so subtract one unit to stop the
  // tagline overshooting past the "A". n glyphs have n-1 gaps between them.
  const wls = parseFloat(getComputedStyle(word).letterSpacing) || 0;
  const target = glyphWidth(word) - wls * 0.8;
  const natural = glyphWidth(tag);
  tag.style.letterSpacing = ((target - natural) / (n - 1)) + 'px';
}

/* ── build: LED strip ───────────────────────────────────────────────── */

function buildLeds() {
  el.ledStrip.innerHTML = '';
  ledNodes = [];
  for (let s = 0; s < STEPS; s++) {
    const led = document.createElement('div');
    led.className = 'led';
    el.ledStrip.appendChild(led);
    ledNodes.push(led);
  }
}

/* ── build: step grid ───────────────────────────────────────────────── */

function buildGrid() {
  el.grid.innerHTML = '';
  cells.length = 0;
  rowEls.length = 0;
  muteBtns.length = 0;

  VOICES.forEach((voice, row) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'grid-row';

    // Left button — tap to mute/unmute this voice.
    const label = document.createElement('div');
    label.className = 'row-label';
    label.textContent = voice.id;
    label.addEventListener('pointerdown', e => {
      e.preventDefault();
      flash(label);
      const muted = seq.toggleMute(row);
      rowEl.classList.toggle('is-muted', muted);
      label.classList.toggle('is-muted', muted);
      save();
    });
    rowEl.appendChild(label);

    const cellsEl = document.createElement('div');
    cellsEl.className = 'cells';
    const rowCells = [];

    for (let s = 0; s < STEPS; s++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      // Bank 0-3 drives the 808 quad colour: red / orange / yellow / cream.
      cell.dataset.bank = String(Math.floor(s / 4));
      cell.addEventListener('pointerdown', e => {
        e.preventDefault();
        engine.unlock();
        const on = seq.toggleStep(row, s);
        cell.classList.toggle('is-on', !!on);
        // Audible feedback when switching a step on, but not while running
        // (the sequencer will play it a moment later anyway).
        if (on && !seq.isPlaying) engine.trigger(voice.id);
        save();
      });
      cellsEl.appendChild(cell);
      rowCells.push(cell);
    }

    cells.push(rowCells);
    rowEl.appendChild(cellsEl);

    // Right button — fill: toggle every step in this row on/off.
    const fill = document.createElement('div');
    fill.className = 'row-fill';
    fill.textContent = '≡'; // ≡
    fill.setAttribute('aria-label', voice.name + ' fill');
    fill.addEventListener('pointerdown', e => {
      e.preventDefault();
      engine.unlock();
      flash(fill);
      seq.fillRow(row);
      paintGrid();
      save();
    });
    rowEl.appendChild(fill);

    rowEls.push(rowEl);
    muteBtns.push(label);
    el.grid.appendChild(rowEl);
  });
}

/** Reflect the persisted mute state on the row labels (after load/import). */
function paintMutes() {
  for (let row = 0; row < muteBtns.length; row++) {
    const muted = !!seq.muted[row];
    muteBtns[row].classList.toggle('is-muted', muted);
    rowEls[row].classList.toggle('is-muted', muted);
  }
}

/** Repaint every cell from the active pattern (after load / clear / switch). */
function paintGrid() {
  const p = seq.pattern;
  for (let row = 0; row < VOICES.length; row++) {
    for (let s = 0; s < STEPS; s++) {
      cells[row][s].classList.toggle('is-on', !!p[row][s]);
    }
  }
}

/* ── build: pads ────────────────────────────────────────────────────── */

function buildPads() {
  el.pads.innerHTML = '';
  for (const voice of VOICES) {
    const pad = document.createElement('button');
    pad.className = 'pad';
    pad.innerHTML = `<span>${voice.id}</span><span class="pad-sub">${voice.name}</span>`;
    // pointerdown, not click — lowest achievable latency for finger drumming.
    pad.addEventListener('pointerdown', e => {
      e.preventDefault();
      audition(voice.id);
      flash(pad);
    });
    el.pads.appendChild(pad);
  }
}

/* ── build: mixer ───────────────────────────────────────────────────── */

function buildMixer() {
  el.mixerRows.innerHTML = '';
  for (const voice of VOICES) {
    const row = document.createElement('div');
    row.className = 'mix-row';

    const label = document.createElement('div');
    label.className = 'mix-label';
    label.textContent = voice.id;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'slider';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.01';
    slider.value = String(engine.volumes[voice.id]);
    slider.setAttribute('aria-label', voice.name + ' volume');

    const val = document.createElement('div');
    val.className = 'mix-val';
    val.textContent = Math.round(engine.volumes[voice.id] * 100);

    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      engine.setVolume(voice.id, v);
      val.textContent = Math.round(v * 100);
      save();
    });
    // Auditioning on release makes the fader immediately useful.
    slider.addEventListener('change', () => audition(voice.id));

    row.append(label, slider, val);
    el.mixerRows.appendChild(row);
    voice._mixSlider = slider;
    voice._mixVal = val;
  }
}

/* ── shared behaviours ──────────────────────────────────────────────── */

/** Unlock the context (Android autoplay policy) and hit the voice now. */
function audition(id) {
  engine.unlock();
  engine.trigger(id);
}

/** Press animation without needing :active (which is unreliable on touch). */
function flash(node) {
  node.classList.add('is-pressed');
  setTimeout(() => node.classList.remove('is-pressed'), 90);
}

/** Wire a button to fire on pointerdown with a press animation. */
function bindButton(node, handler) {
  node.addEventListener('pointerdown', e => {
    e.preventDefault();
    flash(node);
    handler(e);
  });
}

/* ── transport ──────────────────────────────────────────────────────── */

async function togglePlay() {
  // Awaiting the resume matters: on a cold page load the context is
  // suspended, and scheduling against a suspended clock loses the first hits.
  await engine.unlock();
  const playing = seq.toggle();
  el.btnPlay.textContent = playing ? 'STOP' : 'PLAY';
  el.btnPlay.classList.toggle('is-on', playing);
  el.body.classList.toggle('is-playing', playing);
  if (!playing) clearPlayhead();
}

function clearPlayhead() {
  for (const led of ledNodes) led.classList.remove('is-on');
  if (lastDrawnStep >= 0) {
    for (let row = 0; row < cells.length; row++) cells[row][lastDrawnStep].classList.remove('is-cur');
  }
  lastDrawnStep = -1;
}

/* ── tap tempo ──────────────────────────────────────────────────────── */

let tapTimes = [];

function tapTempo() {
  const now = performance.now();
  // A gap longer than 2s means a new count-in, not a continuation.
  if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) tapTimes = [];
  tapTimes.push(now);
  if (tapTimes.length > 5) tapTimes.shift();
  if (tapTimes.length < 2) return;

  // Average the gaps between the last few taps.
  let total = 0;
  for (let i = 1; i < tapTimes.length; i++) total += tapTimes[i] - tapTimes[i - 1];
  const avgMs = total / (tapTimes.length - 1);
  const bpm = 60000 / avgMs;
  if (bpm >= 60 && bpm <= 200) {
    seq.setBpm(bpm);
    syncTempo();
    save();
  }
}

/* ── control sync ───────────────────────────────────────────────────── */

function syncTempo() {
  el.bpmSlider.value = String(seq.bpm);
  el.bpmReadout.textContent = String(seq.bpm);
  // Header LED pulses once per beat: 60/bpm seconds.
  document.documentElement.style.setProperty('--pulse', (60 / seq.bpm) + 's');
}

function syncPatternButtons() {
  for (const btn of el.patternBtns.children) {
    btn.classList.toggle('is-on', Number(btn.dataset.pattern) === seq.current);
    // A queued switch shows as pending until the bar turns over.
    btn.classList.toggle('is-pending', Number(btn.dataset.pattern) === seq.pendingPattern);
  }
}

/** Push all model state out to the controls (after load / import). */
function syncControls() {
  syncTempo();
  el.swingSlider.value = String(seq.swing);
  el.swingReadout.textContent = seq.swing + '%';
  syncPatternButtons();
  for (const voice of VOICES) {
    if (voice._mixSlider) {
      voice._mixSlider.value = String(engine.volumes[voice.id]);
      voice._mixVal.textContent = Math.round(engine.volumes[voice.id] * 100);
    }
  }
}

/* ── export / import ────────────────────────────────────────────────── */

function exportState() {
  const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `octa-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importState(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (applyState(data)) save();
      else alert('That file did not look like an OCTA pattern.');
    } catch (e) {
      alert('Could not read that file: ' + e.message);
    }
  };
  reader.readAsText(file);
}

/* ── draw loop ──────────────────────────────────────────────────────── */

/**
 * Move the playhead when the audio clock reaches each scheduled step.
 * Notes are scheduled up to 120ms early, so we must NOT read current16th —
 * we wait for currentTime to catch up to each queued event instead.
 */
function drawLoop() {
  const now = engine.now;
  let step = lastDrawnStep;

  while (seq.drawQueue.length && seq.drawQueue[0].time <= now) {
    step = seq.drawQueue.shift().step;
  }

  if (step !== lastDrawnStep && step >= 0) {
    if (lastDrawnStep >= 0) {
      ledNodes[lastDrawnStep].classList.remove('is-on');
      for (let row = 0; row < cells.length; row++) cells[row][lastDrawnStep].classList.remove('is-cur');
    }
    ledNodes[step].classList.add('is-on');
    for (let row = 0; row < cells.length; row++) cells[row][step].classList.add('is-cur');
    lastDrawnStep = step;
  }

  requestAnimationFrame(drawLoop);
}

/* ── wiring ─────────────────────────────────────────────────────────── */

function bindControls() {
  bindButton(el.btnPlay, togglePlay);

  bindButton(el.btnClear, () => {
    seq.clear();
    paintGrid();
    save();
  });

  bindButton(el.btnMix, () => {
    const showing = el.mixer.hasAttribute('hidden');
    el.mixer.toggleAttribute('hidden', !showing);
    el.btnMix.classList.toggle('is-on', showing);
  });

  bindButton(el.btnTap, () => {
    engine.unlock();
    tapTempo();
  });

  bindButton(el.btnExport, exportState);
  bindButton(el.btnImport, () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => {
    if (el.fileInput.files[0]) importState(el.fileInput.files[0]);
    el.fileInput.value = ''; // let the same file be picked twice
  });

  // Pattern slots — switching while playing lands at the next bar.
  el.patternBtns.addEventListener('pointerdown', e => {
    const btn = e.target.closest('.btn-pat');
    if (!btn) return;
    e.preventDefault();
    engine.unlock();
    flash(btn);
    seq.selectPattern(Number(btn.dataset.pattern));
    syncPatternButtons();
    if (!seq.isPlaying) paintGrid();
    save();
  });

  // Repaint the grid when a queued switch actually lands mid-playback.
  seq.onPatternChange = () => {
    paintGrid();
    syncPatternButtons();
    save();
  };

  el.bpmSlider.addEventListener('input', () => {
    seq.setBpm(Number(el.bpmSlider.value));
    syncTempo();
    save();
  });

  el.swingSlider.addEventListener('input', () => {
    seq.setSwing(Number(el.swingSlider.value));
    el.swingReadout.textContent = seq.swing + '%';
    save();
  });

  // Any first touch anywhere is a valid gesture to create the context.
  document.addEventListener('pointerdown', () => engine.unlock(), { once: true });

  // Chrome suspends the context when the tab backgrounds; recover on return.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && seq.isPlaying) engine.unlock();
  });

  // Belt and braces: flush the save immediately if we're being closed.
  window.addEventListener('pagehide', () => {
    clearTimeout(saveTimer);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); } catch (e) { /* ignore */ }
  });
}

/* ── boot ───────────────────────────────────────────────────────────── */

function init() {
  buildLeds();
  buildGrid();
  buildPads();
  buildMixer();
  bindControls();
  load();          // overwrites defaults if a saved state exists
  syncControls();
  paintGrid();
  paintMutes();

  // Fit the tagline now, again once the font metrics settle, and on resize.
  fitTagline();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTagline);
  window.addEventListener('resize', fitTagline);

  requestAnimationFrame(drawLoop);
}

init();
