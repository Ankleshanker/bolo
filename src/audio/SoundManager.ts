/**
 * Web Audio API sound manager — all sounds synthesised procedurally, no audio files.
 * AudioContext starts suspended (browser policy); call resume() on the first user gesture.
 */
export class SoundManager {
  private ctx: AudioContext;
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

    this._noise(0.55, 700, 0.2, 0.65, 'lowpass');

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
