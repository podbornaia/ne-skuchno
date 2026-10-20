import { mulberry32, fbmField } from './noise.js';

// Клеточная симуляция прожога.
//  D — обугливание 0..1 (1 = дыра)
//  F — огонь 0..1 (живёт, расползается к соседям, затухает)
//  H — жар 0..1 (свечение кромки, остывает медленнее огня)
//  S — «волокна» бумаги: местная горючесть 0.35..1.5 (делает каждый край уникальным)
// Считается только в активной области (bbox), в GPU уходят только изменённые клетки.

export class BurnSim {
  constructor(w, h, cfg, seed) {
    this.w = w; this.h = h; this.cfg = cfg;
    const n = w * h;
    this.D = new Float32Array(n);
    this.F = new Float32Array(n);
    this.F2 = new Float32Array(n);
    this.H = new Float32Array(n);
    this.S = new Float32Array(n);
    this.pack = new Uint8Array(n * 4);
    this.events = [];
    this.reset(seed);
  }

  reset(seed) {
    const { w, h } = this;
    this.seed = seed;
    this.rand = mulberry32(seed ^ 0x5bd1e995);
    this.D.fill(0); this.F.fill(0); this.F2.fill(0); this.H.fill(0);
    const blot = fbmField(w, h, seed, 5, 56);
    const fib = fbmField(w, h, seed + 7, 3, 10, 0.35, 2.2);
    const S = this.S;
    for (let i = 0; i < S.length; i++) {
      const v = 0.45 + 0.85 * blot[i] + 0.4 * (fib[i] - 0.5);
      S[i] = v < 0.35 ? 0.35 : v > 1.5 ? 1.5 : v;
    }
    this.bx0 = w; this.by0 = h; this.bx1 = -1; this.by1 = -1;
    this.dirty = { x0: 0, y0: 0, x1: w - 1, y1: h - 1 };
    this.holes = 0;
    this.fireSum = 0;
    this.events.length = 0;
  }

  get active() { return this.bx1 >= 0; }
  get coverage() { return this.holes / (this.w * this.h); }

  _active(x0, y0, x1, y1) {
    if (x0 < this.bx0) this.bx0 = x0; if (y0 < this.by0) this.by0 = y0;
    if (x1 > this.bx1) this.bx1 = x1; if (y1 > this.by1) this.by1 = y1;
  }
  _dirty(x0, y0, x1, y1) {
    const d = this.dirty;
    if (!d) { this.dirty = { x0, y0, x1, y1 }; return; }
    if (x0 < d.x0) d.x0 = x0; if (y0 < d.y0) d.y0 = y0;
    if (x1 > d.x1) d.x1 = x1; if (y1 > d.y1) d.y1 = y1;
  }

  // Пламя касается кальки: (cx, cy) и r — в клетках сетки
  applyFlame(cx, cy, r, power, dt) {
    const { w, h, D, F, H, S, cfg } = this;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    if (x0 > x1 || y0 > y1) return;
    const r2 = r * r;
    const cr = cfg.contactRate * dt, ir = cfg.igniteRate * dt;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const t = 1 - Math.sqrt(d2) / r;
        const k = t * t * (3 - 2 * t) * power;
        const i = y * w + x;
        let nd = D[i] + k * cr * S[i];
        if (nd >= 1) { if (D[i] < 1) this.holes++; nd = 1; }
        D[i] = nd;
        let nf = F[i] + k * ir;
        if (nf > 1) nf = 1;
        if (F[i] > nf) nf = F[i];
        F[i] = nf;
        if (nf > H[i]) H[i] = nf > 1 ? 1 : nf;
      }
    }
    this._active(x0, y0, x1, y1);
    this._dirty(x0, y0, x1, y1);
  }

  step(dt) {
    if (this.bx1 < 0) { this.fireSum = 0; return; }
    const { w, h, D, F, F2, H, S, cfg } = this;
    const x0 = Math.max(0, this.bx0 - 1), y0 = Math.max(0, this.by0 - 1);
    const x1 = Math.min(w - 1, this.bx1 + 1), y1 = Math.min(h - 1, this.by1 + 1);
    for (let y = y0; y <= y1; y++) F2.fill(0, y * w + x0, y * w + x1 + 1);

    const rand = this.rand;
    const heatK = Math.exp(-cfg.heatDecay * dt);
    const spreadBase = cfg.spreadRate * dt;
    const keep = cfg.spreadKeep, keepD = Math.pow(keep, Math.SQRT2), ign = cfg.igniteAt;
    const br = cfg.burnRate * dt, decay = cfg.fireDecay * dt, holeDecay = cfg.holeDecay * dt;
    const ashP = cfg.ashRate * dt;
    let sum = 0;

    const spread = (j, p, v) => {
      if (D[j] < 1 && F[j] < v && rand() < p * S[j] && v > F2[j]) F2[j] = v;
    };

    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        const f = F[i];
        let hv = H[i];
        if (f > 0) {
          const s = S[i];
          const dm = D[i];
          let nd = dm + f * br * s;
          if (nd >= 1) { if (dm < 1) this.holes++; nd = 1; }
          D[i] = nd;
          let nf = f - decay * (1.25 - 0.4 * s) - (dm >= 1 ? holeDecay : 0);
          if (nf > F2[i]) F2[i] = nf;
          if (dm > ign) {
            const p = spreadBase * f, pd = p * 0.5;
            const v = f * keep - 0.015;
            const vd = f * keepD - 0.021; // диагональ длиннее в √2 раз — теряет больше, иначе прожог квадратный
            if (v > 0) {
              if (x > 0) spread(i - 1, p, v);
              if (x < w - 1) spread(i + 1, p, v);
              if (y > 0) {
                spread(i - w, p, v);
                if (x > 0) spread(i - w - 1, pd, vd);
                if (x < w - 1) spread(i - w + 1, pd, vd);
              }
              if (y < h - 1) {
                spread(i + w, p, v);
                if (x > 0) spread(i + w - 1, pd, vd);
                if (x < w - 1) spread(i + w + 1, pd, vd);
              }
            }
          }
          if (f > hv) hv = f > 1 ? 1 : f;
          sum += f;
          if (dm < 1 && rand() < ashP * f) this.events.push(x, y, f);
        }
        if (hv > 0) {
          hv *= heatK;
          H[i] = hv < 0.004 ? 0 : hv;
        }
      }
    }

    let nx0 = w, ny0 = h, nx1 = -1, ny1 = -1;
    for (let y = y0; y <= y1; y++) {
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        const v = F2[i];
        F[i] = v;
        if (v > 0 || H[i] > 0) {
          if (x < nx0) nx0 = x; if (x > nx1) nx1 = x;
          if (y < ny0) ny0 = y; if (y > ny1) ny1 = y;
        }
      }
    }
    this.bx0 = nx0; this.by0 = ny0; this.bx1 = nx1; this.by1 = ny1;
    this.fireSum = sum;
    this._dirty(x0, y0, x1, y1);
  }

  // Отправить изменённые клетки в текстуру: R = обугливание, G = жар, B = огонь
  flush(renderer) {
    const d = this.dirty;
    if (!d) return false;
    const { w, D, H, F } = this;
    const rw = d.x1 - d.x0 + 1, rh = d.y1 - d.y0 + 1;
    const buf = this.pack.subarray(0, rw * rh * 4);
    let k = 0;
    for (let y = d.y0; y <= d.y1; y++) {
      const row = y * w;
      for (let x = d.x0; x <= d.x1; x++) {
        const i = row + x;
        buf[k++] = (D[i] * 255 + 0.5) | 0;
        buf[k++] = (H[i] * 255 + 0.5) | 0;
        buf[k++] = (Math.min(1, F[i]) * 255 + 0.5) | 0;
        buf[k++] = 255;
      }
    }
    renderer.uploadBurn(d.x0, d.y0, rw, rh, buf);
    this.dirty = null;
    return true;
  }
}
