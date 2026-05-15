/**
 * Web Audio API sound manager — all sounds synthesised procedurally, no audio files.
 * AudioContext starts suspended (browser policy); call resume() on the first user gesture.
 *
 * Every public play* method accepts an optional dist parameter (0 = at player, 1 = far).
 * Distance attenuates gain and rolls off high frequencies, mimicking near/far variants.
 */
export class SoundManager {
  private ctx:    AudioContext;
  private master: GainNode;
  private readonly enabled: boolean;

  constructor() {
    try {
      this.ctx    = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      this.enabled = true;
    } catch {
      this.enabled = false;
      this.ctx     = null!;
      this.master  = null!;
    }
  }

  resume() {
    if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // ── Shooting ──────────────────────────────────────────────────────────────

  playGunshot(dist = 0) {
    if (!this.enabled) return;
    const out = this._out(dist);
    this._noiseTo(0.08, 2800, 0.4, 0.55, 'bandpass', out);
    this._noiseTo(0.04, 110,  1.0, 0.40, 'lowpass',  out);
  }

  playPillboxFire(dist = 0) {
    if (!this.enabled) return;
    const out = this._out(dist);
    this._noiseTo(0.07, 2000, 0.45, 0.35, 'bandpass', out);
    this._noiseTo(0.03, 95,   1.0,  0.25, 'lowpass',  out);
  }

  // ── Explosions ────────────────────────────────────────────────────────────

  playExplosion(dist = 0) {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;
    const out = this._out(dist);
    this._noiseTo(0.65, 650, 0.18, 0.75, 'lowpass', out);
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(85, now);
    osc.frequency.exponentialRampToValueAtTime(14, now + 0.45);
    gain.gain.setValueAtTime(0.65, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc.connect(gain); gain.connect(out);
    osc.start(now); osc.stop(now + 0.45);
  }

  playMineExplosion(dist = 0) {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;
    const out = this._out(dist);
    this._noiseTo(0.32, 1300, 0.28, 0.55, 'lowpass', out);
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130, now);
    osc.frequency.exponentialRampToValueAtTime(22, now + 0.28);
    gain.gain.setValueAtTime(0.42, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
    osc.connect(gain); gain.connect(out);
    osc.start(now); osc.stop(now + 0.28);
  }

  // ── Bullet impacts ────────────────────────────────────────────────────────

  /** Bullet hits the player's own tank. */
  playHitTank(dist = 0) {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;
    const out = this._out(dist);
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(540, now);
    osc.frequency.exponentialRampToValueAtTime(160, now + 0.14);
    gain.gain.setValueAtTime(0.45, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(gain); gain.connect(out);
    osc.start(now); osc.stop(now + 0.16);
    this._noiseTo(0.06, 2200, 1.2, 0.18, 'bandpass', out);
  }

  /** Bullet hits a wall or rubble tile. */
  playHitBuilding(dist = 0) {
    if (!this.enabled) return;
    const out = this._out(dist);
    this._noiseTo(0.13, 260, 0.7, 0.50, 'lowpass',  out);
    this._noiseTo(0.05, 950, 1.5, 0.20, 'bandpass', out);
  }

  /** Bullet hits a forest tile. */
  playHitTree(dist = 0) {
    if (!this.enabled) return;
    const out = this._out(dist);
    this._noiseTo(0.10, 1100, 1.2, 0.35, 'bandpass', out);
    this._noiseTo(0.06, 380,  0.8, 0.20, 'lowpass',  out);
  }

  // ── Builder actions ───────────────────────────────────────────────────────

  /** Builder harvests a tree tile (axe chop). */
  playChopTree(dist = 0) {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;
    const out = this._out(dist);
    this._noiseTo(0.07, 1500, 1.0, 0.42, 'bandpass', out);
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(210, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.065);
    gain.gain.setValueAtTime(0.28, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain); gain.connect(out);
    osc.start(now); osc.stop(now + 0.07);
  }

  /** Builder places a road, wall, or pillbox tile. */
  playBuildTile(dist = 0) {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;
    const out = this._out(dist);
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.07);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain); gain.connect(out);
    osc.start(now); osc.stop(now + 0.07);
  }

  /** Builder places a mine (metallic click). */
  playLayMine(dist = 0) {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;
    const out = this._out(dist);
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(820, now);
    osc.frequency.exponentialRampToValueAtTime(290, now + 0.042);
    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    osc.connect(gain); gain.connect(out);
    osc.start(now); osc.stop(now + 0.05);
    this._noiseTo(0.03, 3200, 0.5, 0.10, 'highpass', out);
  }

  // ── Tank sinking ──────────────────────────────────────────────────────────

  /** Plays a ~900ms descending gurgle + bubbling as the tank sinks into sea. */
  playTankSinking(dist = 0) {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;
    const out = this._out(dist);

    // Descending sawtooth — engine dying
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.9);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc.connect(gain); gain.connect(out);
    osc.start(now); osc.stop(now + 0.9);

    // Bubble pops — 5 staggered bandpass noise bursts
    for (let i = 0; i < 5; i++) {
      const t = now + i * 0.15 + Math.random() * 0.04;
      const bGain = this.ctx.createGain();
      bGain.gain.setValueAtTime(0, t);
      bGain.gain.linearRampToValueAtTime(0.16, t + 0.018);
      bGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      bGain.connect(out);

      const samples = Math.ceil(this.ctx.sampleRate * 0.09);
      const buf  = this.ctx.createBuffer(1, samples, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let j = 0; j < samples; j++) data[j] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 380 + Math.random() * 180;
      f.Q.value = 2.2;
      src.connect(f); f.connect(bGain);
      src.start(t); src.stop(t + 0.09);
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Create a gain+filter chain that models distance attenuation.
   * Near (dist≈0): full volume, full bandwidth.
   * Far (dist≈1): quiet, heavily low-pass filtered.
   */
  private _out(dist: number): AudioNode {
    const gain = this.ctx.createGain();
    gain.gain.value = Math.max(0.04, 1 - dist * 0.88);
    if (dist > 0.2) {
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(800, 5000 - dist * 4400);
      gain.connect(lp);
      lp.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    return gain;
  }

  /** White-noise burst routed through a biquad filter to a destination node. */
  private _noiseTo(
    dur:        number,
    freq:       number,
    Q:          number,
    peakGain:   number,
    filterType: BiquadFilterType,
    dest:       AudioNode,
  ) {
    const now     = this.ctx.currentTime;
    const samples = Math.ceil(this.ctx.sampleRate * dur);
    const buf     = this.ctx.createBuffer(1, samples, this.ctx.sampleRate);
    const data    = buf.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
    const src    = this.ctx.createBufferSource();
    src.buffer   = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type            = filterType;
    filter.frequency.value = freq;
    filter.Q.value         = Q;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peakGain, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    src.connect(filter); filter.connect(gain); gain.connect(dest);
    src.start(now); src.stop(now + dur);
  }
}
