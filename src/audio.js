// Тихий синтезированный звук: чирк, вспышка, потрескивание, шипение пламени.
// Никаких аудиофайлов — всё собирается из шума через фильтры WebAudio.

const KEY = 'neskuchno:sound';

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
    try { this.on = localStorage.getItem(KEY) !== 'off'; } catch { /* приватный режим */ }
  }

  // Браузеры разрешают звук только после жеста пользователя
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.on ? 0.9 : 0;
      this.master.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 520;
      lp.Q.value = 0.4;
      this.bed = ctx.createGain();
      this.bed.gain.value = 0;
      src.connect(lp).connect(this.bed).connect(this.master);
      src.start();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setOn(v) {
    this.on = v;
    try { localStorage.setItem(KEY, v ? 'on' : 'off'); } catch { /* ок */ }
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  _burst({ dur, type, freq, sweep, q = 0.8, gain, attack = 0.002 }) {
    if (!this.ctx || !this.on || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  strike(k) {
    this._burst({ dur: 0.05 + 0.11 * k, type: 'bandpass', freq: 1700 + Math.random() * 1800, q: 0.9, gain: 0.06 + 0.3 * k });
    if (k > 0.6) this._burst({ dur: 0.03, type: 'highpass', freq: 4800, q: 0.5, gain: 0.12 * k });
  }

  ignite() {
    this._burst({ dur: 0.6, type: 'lowpass', freq: 380, sweep: 3200, q: 0.7, gain: 0.42, attack: 0.02 });
    for (let i = 0; i < 4; i++) setTimeout(() => this.crackle(1), 40 + Math.random() * 260);
  }

  extinguish() {
    this._burst({ dur: 0.4, type: 'bandpass', freq: 900, sweep: 260, q: 0.6, gain: 0.1, attack: 0.01 });
  }

  crackle(k) {
    this._burst({ dur: 0.004 + Math.random() * 0.012, type: 'highpass', freq: 1200 + Math.random() * 3600, q: 0.7, gain: (0.03 + Math.random() * 0.13) * k });
  }

  update(dt, lit, flame, fire) {
    if (!this.ctx) return;
    const target = (lit ? 0.035 + 0.035 * Math.min(1.5, flame) : 0) + Math.min(0.04, fire * 0.00012);
    this.bed.gain.setTargetAtTime(target, this.ctx.currentTime, 0.08);
    const rate = (lit ? 2.5 : 0) + Math.min(24, fire * 0.03);
    if (Math.random() < rate * dt) this.crackle(0.7 + Math.random() * 0.5);
  }
}
