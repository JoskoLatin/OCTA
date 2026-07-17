/* ═══════════════════════════════════════════════════════════════════════
   OCTA — audio engine
   808-inspired, fully synthesised. No sample files.

   Signal flow:
     voice synth nodes → per-voice GainNode (mixer) → master GainNode → out

   Two rules keep it click-free:
     1. Never hard-stop a gain at a nonzero value — always ramp down to a
        small epsilon first. Web Audio's exponentialRampToValueAtTime can
        never reach exactly 0, hence EPS.
     2. Every trigger builds fresh nodes and schedules them against an
        absolute AudioContext time, so the sequencer can schedule ahead.
   ═══════════════════════════════════════════════════════════════════════ */

/** The 8 voices, in grid/pad order. */
const VOICES = [
  { id: 'BD', name: 'KICK' },
  { id: 'SD', name: 'SNARE' },
  { id: 'CH', name: 'CL HAT' },
  { id: 'OH', name: 'OP HAT' },
  { id: 'CP', name: 'CLAP' },
  { id: 'TM', name: 'TOM' },
  { id: 'RS', name: 'RIM' },
  { id: 'CY', name: 'CRASH' }
];

/** Smallest gain we ramp to. exponentialRamp can't touch zero. */
const EPS = 0.0005;

/** Inharmonic ratios for the 808 metallic stack (hats + crash). */
const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
const METAL_BASE_HZ = 120;

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voiceGains = {};      // id → GainNode
    this.noiseBuffer = null;   // 2s of white noise, rendered once and reused
    /** Per-voice mixer levels, 0..1. Persisted by the UI. */
    this.volumes = { BD: 0.95, SD: 0.8, CH: 0.6, OH: 0.55, CP: 0.75, TM: 0.7, RS: 0.6, CY: 0.45 };
  }

  /**
   * Build the graph. Must be called from a user gesture on Android —
   * a context created outside one starts suspended and stays silent.
   */
  init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);

    for (const v of VOICES) {
      const g = this.ctx.createGain();
      g.gain.value = this.volumes[v.id];
      g.connect(this.master);
      this.voiceGains[v.id] = g;
    }

    this.noiseBuffer = this._renderNoise(2);
  }

  /**
   * Call on every user gesture. Chrome on Android suspends the context
   * when the tab backgrounds, so "first play makes sound" depends on this.
   */
  async unlock() {
    this.init();
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch (e) { /* ignore */ }
    }
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  setVolume(id, value) {
    this.volumes[id] = value;
    if (this.voiceGains[id]) {
      // Short ramp so dragging a fader doesn't zipper.
      const g = this.voiceGains[id].gain;
      g.cancelScheduledValues(this.now);
      g.setTargetAtTime(value, this.now, 0.01);
    }
  }

  /** Fire a voice at an absolute AudioContext time (defaults to now). */
  trigger(id, time) {
    if (!this.ctx) return;
    const t = Math.max(time == null ? this.now : time, this.now);
    switch (id) {
      case 'BD': this._kick(t);   break;
      case 'SD': this._snare(t);  break;
      case 'CH': this._hat(t, 0.06, 0.5, 'CH'); break;
      case 'OH': this._hat(t, 0.4,  0.42, 'OH'); break;
      case 'CP': this._clap(t);   break;
      case 'TM': this._tom(t);    break;
      case 'RS': this._rim(t);    break;
      case 'CY': this._crash(t);  break;
    }
  }

  /* ── helpers ──────────────────────────────────────────────────────── */

  /** Pre-render `seconds` of white noise into a mono buffer (done once). */
  _renderNoise(seconds) {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** A looping noise source starting at a random offset (avoids identical hits). */
  _noise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }

  _gain(value) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  _filter(type, freq, Q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    if (Q != null) f.Q.value = Q;
    return f;
  }

  /**
   * Standard percussive envelope: snap to `peak` at t, decay to silence.
   * Returns the GainNode so callers can chain it.
   */
  _env(t, peak, decay) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(EPS, t + decay);
    // Land exactly on zero after the ramp so nothing lingers.
    g.gain.setValueAtTime(0, t + decay + 0.001);
    return g;
  }

  /* ── voices ───────────────────────────────────────────────────────── */

  /** 1. BD — sine with a 160→44Hz pitch drop over 110ms, ~0.5s gain decay. */
  _kick(t) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, t);
    osc.frequency.exponentialRampToValueAtTime(44, t + 0.11);

    const env = this._env(t, 1.0, 0.5);
    osc.connect(env).connect(this.voiceGains.BD);
    osc.start(t);
    osc.stop(t + 0.56);
  }

  /** 2. SD — triangle body (185→120Hz) + highpassed noise snap, ~0.2s. */
  _snare(t) {
    // Body
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(185, t);
    osc.frequency.exponentialRampToValueAtTime(120, t + 0.1);
    const bodyEnv = this._env(t, 0.7, 0.2);
    osc.connect(bodyEnv).connect(this.voiceGains.SD);
    osc.start(t);
    osc.stop(t + 0.26);

    // Snap
    const noise = this._noise();
    const hp = this._filter('highpass', 1400);
    const noiseEnv = this._env(t, 0.75, 0.2);
    noise.connect(hp).connect(noiseEnv).connect(this.voiceGains.SD);
    noise.start(t, Math.random() * 1.5);
    noise.stop(t + 0.26);
  }

  /**
   * 3/4. CH + OH — 6 square oscillators at inharmonic ratios through a
   * 10kHz bandpass then a 7kHz highpass. Same stack, different decay.
   */
  _hat(t, decay, peak, voiceId) {
    const bp = this._filter('bandpass', 10000, 0.8);
    const hp = this._filter('highpass', 7000);
    const env = this._env(t, peak, decay);
    bp.connect(hp).connect(env).connect(this.voiceGains[voiceId]);

    for (const ratio of METAL_RATIOS) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = METAL_BASE_HZ * ratio;
      osc.connect(bp);
      osc.start(t);
      osc.stop(t + decay + 0.02);
    }
  }

  /**
   * 5. CP — bandpassed noise (1.1kHz, Q1.6) with 3 fast retriggered
   * bursts at 0/12/26ms; the last one decays into a ~300ms tail.
   */
  _clap(t) {
    const noise = this._noise();
    const bp = this._filter('bandpass', 1100, 1.6);
    const env = this.ctx.createGain();

    env.gain.setValueAtTime(EPS, t);
    // Two short slaps...
    for (const offset of [0, 0.012]) {
      env.gain.setValueAtTime(0.9, t + offset);
      env.gain.exponentialRampToValueAtTime(EPS, t + offset + 0.011);
    }
    // ...then the third opens into the tail.
    env.gain.setValueAtTime(0.9, t + 0.026);
    env.gain.exponentialRampToValueAtTime(EPS, t + 0.026 + 0.3);
    env.gain.setValueAtTime(0, t + 0.33);

    noise.connect(bp).connect(env).connect(this.voiceGains.CP);
    noise.start(t, Math.random() * 1.5);
    noise.stop(t + 0.35);
  }

  /** 6. TM — sine, 210→85Hz, ~350ms. */
  _tom(t) {
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(210, t);
    osc.frequency.exponentialRampToValueAtTime(85, t + 0.2);

    const env = this._env(t, 0.9, 0.35);
    osc.connect(env).connect(this.voiceGains.TM);
    osc.start(t);
    osc.stop(t + 0.4);
  }

  /** 7. RS — square 1750Hz through a matching bandpass (Q4), ~55ms. */
  _rim(t) {
    const osc = this.ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 1750;

    const bp = this._filter('bandpass', 1750, 4);
    const env = this._env(t, 0.8, 0.055);
    osc.connect(bp).connect(env).connect(this.voiceGains.RS);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  /** 8. CY — long 5kHz-highpassed noise (1.4s) layered with the metal stack. */
  _crash(t) {
    // Noise layer
    const noise = this._noise();
    const hp = this._filter('highpass', 5000);
    const noiseEnv = this._env(t, 0.5, 1.4);
    noise.connect(hp).connect(noiseEnv).connect(this.voiceGains.CY);
    noise.start(t, Math.random() * 0.5);
    noise.stop(t + 1.45);

    // Metallic layer
    const bp = this._filter('bandpass', 10000, 0.8);
    const mhp = this._filter('highpass', 7000);
    const metalEnv = this._env(t, 0.35, 1.2);
    bp.connect(mhp).connect(metalEnv).connect(this.voiceGains.CY);
    for (const ratio of METAL_RATIOS) {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = METAL_BASE_HZ * ratio;
      osc.connect(bp);
      osc.start(t);
      osc.stop(t + 1.25);
    }
  }
}
