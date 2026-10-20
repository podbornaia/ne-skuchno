export function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const newSeed = () => (Math.random() * 2 ** 31) | 0;

// Многооктавный value-noise на сетке w×h, нормализован в 0..1.
// cell — размер крупной ячейки в пикселях; sx/sy — анизотропия (волокна).
export function fbmField(w, h, seed, octaves = 4, cell = 32, sx = 1, sy = 1) {
  const out = new Float32Array(w * h);
  const rand = mulberry32(seed);
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    const cx = Math.max(1.5, (cell * sx) / 2 ** o);
    const cy = Math.max(1.5, (cell * sy) / 2 ** o);
    const gw = Math.ceil(w / cx) + 2;
    const gh = Math.ceil(h / cy) + 2;
    const g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = rand();
    const ox = rand() * cx, oy = rand() * cy;
    for (let y = 0; y < h; y++) {
      const fy = (y + oy) / cy;
      const iy = fy | 0;
      let ty = fy - iy;
      ty = ty * ty * (3 - 2 * ty);
      const r0 = iy * gw, r1 = r0 + gw;
      for (let x = 0; x < w; x++) {
        const fx = (x + ox) / cx;
        const ix = fx | 0;
        let tx = fx - ix;
        tx = tx * tx * (3 - 2 * tx);
        const a = g[r0 + ix] + (g[r0 + ix + 1] - g[r0 + ix]) * tx;
        const b = g[r1 + ix] + (g[r1 + ix + 1] - g[r1 + ix]) * tx;
        out[y * w + x] += (a + (b - a) * ty) * amp;
      }
    }
    amp *= 0.5;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < out.length; i++) { const v = out[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const k = mx > mn ? 1 / (mx - mn) : 0;
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * k;
  return out;
}

// Гладкий 1D-шум в -1..1 (для колыхания пламени)
const h1 = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export function noise1(t) {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return (h1(i) + (h1(i + 1) - h1(i)) * u) * 2 - 1;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
