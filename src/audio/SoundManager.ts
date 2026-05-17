/**
 * Sound manager — file-based SFX with Web Audio API distance attenuation.
 * AudioContext starts suspended (browser policy); call resume() on the first user gesture.
 *
 * Every public play* method accepts an optional dist parameter (0 = at player, 1 = far).
 * Distance attenuates gain and rolls off high frequencies, mimicking near/far variants.
 *
 * Sounds without a file (explosion, tank sinking, lay mine) remain procedurally synthesised.
 */
export class SoundManager {
  private ctx:    AudioContext;
  private master: GainNode;
  private readonly enabled: boolean;

  private tankFire:      AudioBuffer | null = null;
  private pillboxFire:   AudioBuffer | null = null;
  private building:      AudioBuffer | null = null;
  private harvestTrees:  AudioBuffer | null = null;
  private mineExp:       AudioBuffer | null = null;
  private bulletHits:    (AudioBuffer | null)[] = Array(7).fill(null);

  constructor() {
    try {
      this.ctx    = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      this.enabled = true;
      this._loadAll();
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
    this._playBuffer(this.tankFire, dist);
  }

  playPillboxFire(dist = 0) {
    this._playBuffer(this.pillboxFire, dist);
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
    this._playBuffer(this.mineExp, dist);
  }

  // ── Bullet impacts ────────────────────────────────────────────────────────

  playHitTank(dist = 0) {
    this._playBuffer(this._randomBulletHit(), dist);
  }

  playHitBuilding(dist = 0) {
    this._playBuffer(this._randomBulletHit(), dist);
  }

  playHitTree(dist = 0) {
    this._playBuffer(this._randomBulletHit(), dist);
  }

  // ── Builder actions ───────────────────────────────────────────────────────

  playChopTree(dist = 0) {
    this._playBuffer(this.harvestTrees, dist);
  }

  playBuildTile(dist = 0) {
    this._playBuffer(this.building, dist);
  }

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

  playTankSinking(dist = 0) {
    if (!this.enabled) return;
    const now = this.ctx.currentTime;
    const out = this._out(dist);

    const osc  = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(190, now);
    osc.frequency.exponentialRampToValueAtTime(28, now + 0.9);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
    osc.connect(gain); gain.connect(out);
    osc.start(now); osc.stop(now + 0.9);

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

  private async _loadAll() {
    const load = async (path: string): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(path);
        const ab  = await res.arrayBuffer();
        return await this.ctx.decodeAudioData(ab);
      } catch {
        return null;
      }
    };

    const [tankFire, pillboxFire, building, harvestTrees, mineExp, ...hits] =
      await Promise.all([
        load('/sfx/tank_fire.ogg'),
        load('/sfx/pillbox_fire.ogg'),
        load('/sfx/building.ogg'),
        load('/sfx/harvest_trees.ogg'),
        load('/sfx/mine.ogg'),
        ...Array.from({ length: 7 }, (_, i) =>
          load(`/sfx/bullet_hit_0${i + 1}.ogg`),
        ),
      ]);

    this.tankFire     = tankFire;
    this.pillboxFire  = pillboxFire;
    this.building     = building;
    this.harvestTrees = harvestTrees;
    this.mineExp      = mineExp;
    this.bulletHits   = hits;
  }

  private _randomBulletHit(): AudioBuffer | null {
    const loaded = this.bulletHits.filter(b => b !== null);
    if (loaded.length === 0) return null;
    return loaded[Math.floor(Math.random() * loaded.length)];
  }

  private _playBuffer(buffer: AudioBuffer | null, dist: number) {
    if (!this.enabled || !buffer) return;
    const out = this._out(dist);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(out);
    src.start();
  }

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
