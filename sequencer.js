/* ═══════════════════════════════════════════════════════════════════════
   OCTA — sequencer
   16 steps × 8 voices, 16th notes, 4 pattern slots.

   Timing model (this is the important part — read before editing):

     setInterval is NOT used for note timing. It only wakes us up every
     25ms to ask "are there notes due in the next 120ms?". Each note is
     scheduled against an absolute AudioContext time, which runs on the
     audio hardware clock and does not drift or get blocked by layout,
     GC, or a busy main thread.

     nextNoteTime accumulates by 60/bpm/4 seconds per 16th. Because it is
     derived from the previous note time and never from Date.now(), error
     cannot accumulate — this is what keeps it locked after minutes.

     The UI never reads current16th directly (it would run ~120ms early).
     Instead we push {step, time} into drawQueue and a requestAnimationFrame
     loop pops entries once AudioContext.currentTime catches up.
   ═══════════════════════════════════════════════════════════════════════ */

const STEPS = 16;
const PATTERN_COUNT = 4;

/** How often the scheduler wakes (ms). */
const LOOKAHEAD_MS = 25;
/** How far ahead of the clock we schedule (seconds). */
const SCHEDULE_AHEAD = 0.12;

/** Empty grid: 8 voices × 16 steps of 0/1. */
function emptyPattern() {
  return VOICES.map(() => new Array(STEPS).fill(0));
}

/**
 * Pattern A ships with a basic house groove so PLAY makes music immediately.
 * Steps below are 0-indexed (step "5" in the UI is index 4).
 */
function housePattern() {
  const p = emptyPattern();
  const set = (voiceId, steps) => {
    const row = VOICES.findIndex(v => v.id === voiceId);
    for (const s of steps) p[row][s] = 1;
  };
  set('BD', [0, 4, 8, 12]);                    // four on the floor
  set('SD', [4, 12]);                          // snare on 5 and 13
  set('CH', [0, 2, 4, 6, 8, 10, 12, 14]);      // closed hat on every odd step
  set('OH', [6, 14]);                          // open hat on 7 and 15
  set('CP', [12]);                             // clap on 13
  return p;
}

class Sequencer {
  constructor(engine) {
    this.engine = engine;

    this.bpm = 120;
    this.swing = 0;                 // 0–60 (%)
    this.isPlaying = false;

    this.patterns = [housePattern(), emptyPattern(), emptyPattern(), emptyPattern()];
    this.current = 0;               // active pattern slot
    this.pendingPattern = null;     // switch requested; applied at the next bar
    this.muted = VOICES.map(() => false); // per-voice mute (shared across patterns)

    // Chain mode: when on, playback auto-advances to the next enabled slot at
    // every bar and loops. chainMask marks which slots take part (all by default).
    this.chain = false;
    this.chainMask = [true, true, true, true];

    this.current16th = 0;
    this.nextNoteTime = 0;
    this.timerId = null;

    /** Consumed by the UI's rAF loop: {step, time} for each scheduled step. */
    this.drawQueue = [];

    /** Fired when a queued pattern switch actually lands, so the UI can sync. */
    this.onPatternChange = null;
  }

  get pattern() { return this.patterns[this.current]; }

  /** Seconds per 16th note at the current tempo. */
  get sixteenth() { return 60 / this.bpm / 4; }

  /* ── transport ────────────────────────────────────────────────────── */

  start() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.current16th = 0;
    this.drawQueue.length = 0;
    // Small cushion so the first note isn't scheduled in the past.
    this.nextNoteTime = this.engine.now + 0.06;
    this.timerId = setInterval(() => this._scheduler(), LOOKAHEAD_MS);
    this._scheduler(); // don't wait a full tick for the first note
  }

  stop() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    clearInterval(this.timerId);
    this.timerId = null;
    this.drawQueue.length = 0;
    this.pendingPattern = null;
  }

  toggle() {
    this.isPlaying ? this.stop() : this.start();
    return this.isPlaying;
  }

  /**
   * Tempo can change mid-playback without a glitch: only future notes are
   * affected, because nextNoteTime advances by the *current* sixteenth each
   * time and already-scheduled notes keep their absolute times.
   */
  setBpm(bpm) { this.bpm = Math.min(200, Math.max(60, Math.round(bpm))); }

  setSwing(pct) { this.swing = Math.min(60, Math.max(0, pct)); }

  /* ── chain mode ───────────────────────────────────────────────────── */

  toggleChain() { this.chain = !this.chain; return this.chain; }

  /** Include/exclude a slot from the chain; returns its new membership. */
  toggleChainSlot(index) {
    this.chainMask[index] = !this.chainMask[index];
    return this.chainMask[index];
  }

  /** Next enabled slot after `from`, cycling; returns `from` if it's the only one. */
  _nextInChain(from) {
    for (let i = 1; i <= PATTERN_COUNT; i++) {
      const idx = (from + i) % PATTERN_COUNT;
      if (this.chainMask[idx]) return idx;
    }
    return from;
  }

  /** The slot the chain will advance to next (for UI preview), or null. */
  nextChainPattern() {
    return this.chain ? this._nextInChain(this.current) : null;
  }

  /** Queue a pattern switch; it lands at the top of the next bar. */
  selectPattern(index) {
    if (index === this.current) { this.pendingPattern = null; return; }
    if (this.isPlaying) {
      this.pendingPattern = index;
    } else {
      this.current = index;
      if (this.onPatternChange) this.onPatternChange(index);
    }
  }

  /* ── grid editing ─────────────────────────────────────────────────── */

  toggleStep(row, step) {
    const p = this.pattern;
    p[row][step] = p[row][step] ? 0 : 1;
    return p[row][step];
  }

  /** Force a step on/off (used by live recording, which only ever adds hits). */
  setStep(row, step, on) {
    this.pattern[row][step] = on ? 1 : 0;
  }

  /**
   * Fill toggle for one voice: if the row is already full, clear it;
   * otherwise switch every step on. Returns the new filled state.
   */
  fillRow(row) {
    const r = this.pattern[row];
    const full = r.every(v => v === 1);
    r.fill(full ? 0 : 1);
    return !full;
  }

  toggleMute(row) {
    this.muted[row] = !this.muted[row];
    return this.muted[row];
  }

  clear() {
    this.patterns[this.current] = emptyPattern();
  }

  /* ── scheduling ───────────────────────────────────────────────────── */

  /** Advance the pointer to the next 16th. Called once per scheduled step. */
  _advance() {
    this.nextNoteTime += this.sixteenth;
    this.current16th = (this.current16th + 1) % STEPS;
    // At the start of each bar: a user-queued switch wins; otherwise, if the
    // chain is on, advance to the next enabled slot.
    if (this.current16th === 0) {
      let next = null;
      if (this.pendingPattern !== null) {
        next = this.pendingPattern;
        this.pendingPattern = null;
      } else if (this.chain) {
        next = this._nextInChain(this.current);
      }
      if (next !== null && next !== this.current) {
        this.current = next;
        if (this.onPatternChange) this.onPatternChange(this.current);
      }
    }
  }

  /**
   * Schedule every voice that's on at `step`.
   *
   * Swing delays every even-numbered 16th (the 2nd, 4th, ... — odd indices)
   * by a fraction of a 16th. The delay is applied only here, never to
   * nextNoteTime, so the underlying grid stays drift-free.
   */
  _scheduleStep(step, time) {
    const swung = (step % 2 === 1)
      ? time + this.sixteenth * (this.swing / 100)
      : time;

    const p = this.pattern;
    for (let row = 0; row < VOICES.length; row++) {
      if (p[row][step] && !this.muted[row]) this.engine.trigger(VOICES[row].id, swung);
    }

    // The LED follows the grid, not the swing, so the playhead stays steady.
    this.drawQueue.push({ step, time });
  }

  /** setInterval tick: drain everything due within the lookahead window. */
  _scheduler() {
    while (this.nextNoteTime < this.engine.now + SCHEDULE_AHEAD) {
      this._scheduleStep(this.current16th, this.nextNoteTime);
      this._advance();
    }
  }

  /* ── serialisation ────────────────────────────────────────────────── */

  toJSON() {
    return {
      bpm: this.bpm,
      swing: this.swing,
      current: this.current,
      muted: this.muted,
      chain: this.chain,
      chainMask: this.chainMask,
      patterns: this.patterns
    };
  }

  /** Load state defensively — imported files may be old, partial, or junk. */
  fromJSON(data) {
    if (!data || typeof data !== 'object') return false;
    if (typeof data.bpm === 'number') this.setBpm(data.bpm);
    if (typeof data.swing === 'number') this.setSwing(data.swing);

    if (Array.isArray(data.patterns)) {
      const next = [];
      for (let i = 0; i < PATTERN_COUNT; i++) {
        const src = data.patterns[i];
        const p = emptyPattern();
        if (Array.isArray(src)) {
          for (let row = 0; row < VOICES.length; row++) {
            const srcRow = src[row];
            if (!Array.isArray(srcRow)) continue;
            for (let s = 0; s < STEPS; s++) p[row][s] = srcRow[s] ? 1 : 0;
          }
        }
        next.push(p);
      }
      this.patterns = next;
    }

    if (Number.isInteger(data.current) && data.current >= 0 && data.current < PATTERN_COUNT) {
      this.current = data.current;
    }
    if (Array.isArray(data.muted)) {
      this.muted = VOICES.map((_, i) => !!data.muted[i]);
    }
    if (typeof data.chain === 'boolean') this.chain = data.chain;
    if (Array.isArray(data.chainMask)) {
      this.chainMask = [0, 1, 2, 3].map(i =>
        data.chainMask[i] === undefined ? true : !!data.chainMask[i]);
    }
    return true;
  }
}
