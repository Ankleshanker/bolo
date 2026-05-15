/**
 * Web Audio API sound manager — all sounds synthesised procedurally, no audio files.
 * AudioContext starts suspended (browser policy); call resume() on the first user gesture.
 */
export class SoundManager {
  private ctx: AudioContext;
  private master: GainNode;
  private engineOsc: OscillatorNode;
  private engineGain: GainNode;
  private readonly enabled: boolean;

  constructor() {
    try {
      this.ctx    = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);

      // Continuous engine oscillator — gain is modulated by tank speed
      this.engineOsc  = this.ctx.createOscillator();
      this.engineGain = this.ctx.createGain();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.value = 60;
      this.engineGain.gain.value = 0;
      this.engineOsc.connect(this.engineGain);
      this.engineGain.connect(this.master);
      this.engineOsc.start();
      this.enabled = true;
    } catch {
      // Audio unavailable (unlikely in modern browsers)
      this.enabled = false;
      this.ctx      = null!;
      this.master   = null!;
      this.engineOsc  = null!;
      this.engineGain = null!;
    }
  }

  resume() {
    if (this.enabled && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Call every frame with current tank speed (px/s). Max normal speed ≈ 160. */
  setEngineSpeed(speed: number) {
    if (!this.enabled) return;
    const t    = Math.min(speed / 160, 1);
    const now  = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(60 + t * 80, now, 0.1);
    this.engineGain.gain.setTargetAtTime(0.008 + t * 0.022, now, 0.08);
  }

  playGunshot() {
    if (!this.enabled) return;
    this._noise(0.09, 2800, 0.5, 0.38);
  }

  playPillboxFire() {
    if (!this.enabled) return;
    this._noise(0.07, 1800, 0.5, 0.18);
  }

  playExplosion() {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;

    // White-noise burst through a low-pass filter
    this._noise(0.55, 700, 0.2, 0.65, 'lowpass');

    // Deep sine "thump" that pitch-bends downward
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(18, now + 0.35);
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.35);
  }

  playBuildTile() {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;
    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.07);
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(now);
    osc.stop(now + 0.07);
  }

  /** Shared helper: noise burst through a biquad filter. */
  private _noise(
    dur: number,
    freq: number,
    Q: number,
    peakGain: number,
    filterType: BiquadFilterType = 'bandpass',
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
    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    src.start(now);
    src.stop(now + dur);
  }
}
