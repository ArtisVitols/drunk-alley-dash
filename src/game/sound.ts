// All audio is synthesized with WebAudio — no downloaded assets, in
// keeping with the fully-procedural art style. The context unlocks on
// the first user gesture (browser autoplay policy).

export type AnimalKind = 'cat' | 'dog' | 'squirrel' | 'raccoon' | 'rat';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  // Engine nodes (live while someone is aboard)
  private engineOsc: OscillatorNode | null = null;
  private engineSub: OscillatorNode | null = null;
  private engineNoise: AudioBufferSourceNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;

  get enabled(): boolean {
    return this.ctx !== null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return; // no audio — game plays silent
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.05);
    }
  }

  private noiseBuffer(seconds = 1): AudioBuffer {
    const ctx = this.ctx!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // One-shot helper: osc with freq/gain envelopes
  private blip(
    type: OscillatorType,
    freqs: [number, number][], // [time offset, frequency]
    peak: number,
    duration: number,
    delay = 0,
  ) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    for (const [at, f] of freqs) {
      if (at === 0) osc.frequency.setValueAtTime(f, t0);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, f), t0 + at);
    }
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  }

  private thump(peak: number, filterHz: number, duration: number, delay = 0) {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(duration + 0.1);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterHz;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(peak, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + duration + 0.1);
  }

  // ——— Engine ————————————————————————————————————————————————

  startEngine() {
    if (!this.ctx || !this.master || this.engineOsc) return;
    const ctx = this.ctx;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineSub = ctx.createOscillator();
    this.engineSub.type = 'square';
    this.engineSub.frequency.value = 27;
    this.engineNoise = ctx.createBufferSource();
    this.engineNoise.buffer = this.noiseBuffer(2);
    this.engineNoise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.15;
    this.engineOsc.connect(this.engineFilter);
    this.engineSub.connect(this.engineFilter);
    this.engineNoise.connect(noiseGain).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    this.engineSub.start();
    this.engineNoise.start();
    // cough to life
    this.thump(0.25, 300, 0.25);
  }

  stopEngine() {
    if (!this.ctx || !this.engineOsc) return;
    const t0 = this.ctx.currentTime;
    this.engineGain?.gain.setTargetAtTime(0, t0, 0.15);
    const nodes = [this.engineOsc, this.engineSub, this.engineNoise];
    for (const node of nodes) node?.stop(t0 + 0.6);
    this.engineOsc = null;
    this.engineSub = null;
    this.engineNoise = null;
    this.engineFilter = null;
    this.engineGain = null;
  }

  get engineRunning(): boolean {
    return this.engineOsc !== null;
  }

  // rpm in 0.8..5 ("×1000"), load 0..1 (throttle)
  setEngine(rpm: number, load: number) {
    if (!this.ctx || !this.engineOsc || !this.engineFilter || !this.engineGain) return;
    const t0 = this.ctx.currentTime;
    this.engineOsc.frequency.setTargetAtTime(30 + rpm * 26, t0, 0.08);
    this.engineSub!.frequency.setTargetAtTime(15 + rpm * 13, t0, 0.08);
    this.engineFilter.frequency.setTargetAtTime(250 + rpm * 220, t0, 0.1);
    this.engineGain.gain.setTargetAtTime(0.10 + load * 0.08 + rpm * 0.012, t0, 0.1);
  }

  // ——— One-shots ————————————————————————————————————————————————

  playPickup(points: number) {
    // clink + a little arpeggio that grows with the bottle's worth
    this.thump(0.12, 5000, 0.05);
    const notes = [880, 1108, 1318, 1760];
    for (let i = 0; i <= Math.min(points, 3); i++) {
      this.blip('triangle', [[0, notes[i]]], 0.14, 0.16, i * 0.07);
    }
  }

  playCrash(intensity: number) {
    const k = Math.min(1, intensity / 12);
    this.thump(0.25 + k * 0.35, 500 + k * 700, 0.28);
    this.blip('sine', [[0, 90], [0.25, 40]], 0.3 * k + 0.1, 0.3);
  }

  playDoor() {
    this.thump(0.22, 900, 0.09);
    this.blip('sine', [[0, 150], [0.08, 90]], 0.12, 0.1);
  }

  workTick() {
    // a knock of honest drunk labor
    this.thump(0.16, 1200, 0.05);
    this.blip('sine', [[0, 180 + Math.random() * 60], [0.05, 90]], 0.1, 0.07);
  }

  playClearDone() {
    const arp = [523, 659, 784, 1047];
    arp.forEach((f, i) => this.blip('triangle', [[0, f]], 0.16, 0.22, i * 0.09));
  }

  playWin() {
    const melody: [number, number][] = [
      [523, 0], [659, 0.14], [784, 0.28], [1047, 0.42], [784, 0.62], [1047, 0.76],
    ];
    for (const [f, at] of melody) this.blip('square', [[0, f]], 0.1, 0.3, at);
    for (const f of [262, 330, 392]) this.blip('triangle', [[0, f]], 0.12, 1.0, 0.76);
  }

  playHiccup() {
    this.blip('square', [[0, 260], [0.05, 520], [0.09, 380]], 0.07, 0.1);
  }

  playBird() {
    const base = 2200 + Math.random() * 1500;
    for (let i = 0; i < 2 + Math.floor(Math.random() * 3); i++) {
      this.blip('sine', [[0, base + Math.random() * 400], [0.05, base * 0.8]], 0.05, 0.07, i * 0.12);
    }
  }

  playCricket() {
    for (let i = 0; i < 5; i++) {
      this.blip('sine', [[0, 4200]], 0.025, 0.03, i * 0.055);
    }
  }

  // Stick cutting the air (played on every swing, hit or miss)
  playWhoosh() {
    if (!this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer(0.2);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(350, t0);
    filter.frequency.exponentialRampToValueAtTime(1600, t0 + 0.1);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.14, t0 + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + 0.2);
  }

  // Stick connects: a thud and a low grunted "oof"
  playBumHit() {
    this.thump(0.3, 900, 0.1);
    this.blip('sawtooth', [[0, 160], [0.14, 70]], 0.16, 0.18, 0.02);
  }

  // Fists on the RV door
  playBang() {
    this.thump(0.22, 600, 0.08);
    this.thump(0.18, 500, 0.08, 0.14);
  }

  // Beaten bum bolting: a warbling two-note shriek, women higher
  playScream(kind: 'man' | 'woman') {
    const base = kind === 'woman' ? 940 : 590;
    this.blip('sawtooth', [[0, base], [0.1, base * 1.3], [0.5, base * 0.45]], 0.14, 0.55);
    this.blip('square', [[0, base * 1.5], [0.12, base * 1.9], [0.4, base * 0.6]], 0.06, 0.45, 0.08);
    this.thump(0.06, 3200, 0.3, 0.05);
  }

  // Something small went under the wheels
  playSquash() {
    this.blip('sine', [[0, 1900], [0.09, 350]], 0.12, 0.13);
    this.thump(0.24, 420, 0.14);
  }

  playAnimal(kind: AnimalKind) {
    if (kind === 'cat') {
      this.blip('sine', [[0, 480], [0.12, 700], [0.32, 380]], 0.09, 0.36);
    } else if (kind === 'dog') {
      this.blip('sawtooth', [[0, 220], [0.1, 130]], 0.14, 0.12);
      this.blip('sawtooth', [[0, 240], [0.1, 140]], 0.14, 0.12, 0.22);
    } else if (kind === 'squirrel') {
      for (let i = 0; i < 5; i++) this.blip('square', [[0, 1900 + (i % 2) * 250]], 0.04, 0.04, i * 0.07);
    } else if (kind === 'raccoon') {
      for (let i = 0; i < 4; i++) this.blip('sine', [[0, 750], [0.05, 950]], 0.05, 0.07, i * 0.09);
    } else {
      // rat
      this.blip('sine', [[0, 3400], [0.05, 2700]], 0.045, 0.06);
      this.blip('sine', [[0, 3600], [0.05, 2900]], 0.045, 0.06, 0.09);
    }
  }
}
