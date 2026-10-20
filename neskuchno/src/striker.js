import { mulberry32, fbmField } from './noise.js';

// Тёрка: зернистая коричнево-красная полоса + следы чирков (память касаний).
// Следы хранятся в нормализованных координатах и рисуются детерминированно,
// поэтому при экспорте в PNG они выглядят так же, как на экране, в любом разрешении.

function paintBase(w, h, seed) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  const img = x.createImageData(w, h);
  const d = img.data;
  const low = fbmField(w, h, seed, 4, Math.max(6, h / 70));
  const rand = mulberry32(seed ^ 0x9e3779b9);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const n = low[i] - 0.5;
    let r = 106 + n * 40, g = 41 + n * 17, b = 27 + n * 11;
    const gr = (rand() - 0.5) * 38;
    r += gr; g += gr * 0.55; b += gr * 0.4;
    const q = rand();
    if (q < 0.012) { r = 170 + rand() * 50; g = 118 + rand() * 30; b = 92 + rand() * 20; } // стеклянная крошка
    else if (q < 0.055) { r *= 0.55; g *= 0.5; b *= 0.5; }
    d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  const lg = x.createLinearGradient(0, 0, w, 0);
  lg.addColorStop(0, 'rgba(0,0,0,0.38)');
  lg.addColorStop(0.14, 'rgba(0,0,0,0)');
  lg.addColorStop(0.86, 'rgba(0,0,0,0)');
  lg.addColorStop(1, 'rgba(0,0,0,0.3)');
  x.fillStyle = lg;
  x.fillRect(0, 0, w, h);
  return c;
}

function drawSegment(ctx, ox, oy, w, h, a, b, k, seed) {
  const r = mulberry32(seed);
  const s = h / 900;
  const x0 = ox + a.u * w, y0 = oy + a.v * h, x1 = ox + b.u * w, y1 = oy + b.v * h;
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.lineCap = 'round';
  const lines = 2 + Math.floor(k * 5);
  const spread = w * (0.12 + 0.16 * k);
  for (let i = 0; i < lines; i++) {
    const off = (r() - 0.5) * 2 * spread;
    const al = (0.05 + r() * 0.16) * (0.25 + k);
    ctx.strokeStyle = `rgba(${(18 + r() * 22) | 0},${(9 + r() * 8) | 0},6,${al.toFixed(3)})`;
    ctx.lineWidth = (0.6 + r() * 2.4 * k) * s;
    ctx.beginPath();
    ctx.moveTo(x0 + nx * off, y0 + ny * off);
    ctx.lineTo(x1 + nx * off + (r() - 0.5) * s, y1 + ny * off + (r() - 0.5) * s);
    ctx.stroke();
  }
  if (r() < 0.35 * k) {
    ctx.fillStyle = `rgba(12,6,4,${(0.15 + r() * 0.25).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x1 + (r() - 0.5) * spread, y1, (0.8 + r() * 1.8) * s, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export class Striker {
  constructor(canvas, seed) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.seed = seed;
    this.strokes = [];
    this.cur = null;
  }

  resize(cssW, cssH, dpr) {
    const c = this.canvas;
    c.width = Math.max(1, Math.round(cssW * dpr));
    c.height = Math.max(1, Math.round(cssH * dpr));
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
    Striker.paint(this.ctx, 0, 0, c.width, c.height, this.seed, this.strokes);
  }

  begin(u, v) {
    this.cur = { seed: (Math.random() * 1e9) | 0, pts: [{ u, v, k: 0 }] };
    this.strokes.push(this.cur);
    if (this.strokes.length > 400) this.strokes.shift();
  }

  extend(u, v, k) {
    const s = this.cur;
    if (!s) return;
    const a = s.pts[s.pts.length - 1];
    if (Math.abs(a.u - u) + Math.abs(a.v - v) < 0.002) return;
    const b = { u, v, k };
    s.pts.push(b);
    const c = this.canvas;
    drawSegment(this.ctx, 0, 0, c.width, c.height, a, b, k, s.seed + s.pts.length * 7919);
  }

  end() { this.cur = null; }

  static paint(ctx, ox, oy, w, h, seed, strokes) {
    ctx.drawImage(paintBase(w, h, seed), ox, oy);
    for (const s of strokes) {
      for (let i = 1; i < s.pts.length; i++) {
        drawSegment(ctx, ox, oy, w, h, s.pts[i - 1], s.pts[i], s.pts[i].k, s.seed + (i + 1) * 7919);
      }
    }
  }
}
