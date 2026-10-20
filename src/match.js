import { noise1, clamp } from './noise.js';

const TAU = Math.PI * 2;

// Спичка-курсор: состояние (свежая → горит → догорела → новая) и отрисовка.
export class Match {
  constructor(cfg, flameCfg) {
    this.cfg = cfg;
    this.flameCfg = flameCfg;
    this.used = 0;
    this.alpha = 1;
    this._fresh();
  }

  _fresh() {
    const { strikesMin: a, strikesMax: b, minLife, maxLife } = this.cfg;
    this.state = 'fresh';
    this.strikes = 0;
    this.target = a + Math.floor(Math.random() * (b - a + 1));
    this.life = 0;
    this.maxLife = minLife + Math.random() * (maxLife - minLife);
    this.char = 0;
    this.ember = 0;
    this.flare = 0;
    this.outT = 0;
    this.seed = Math.random() * 100;
  }

  // Резкий чирк. Возвращает 'spark' | 'ignite' | null
  strike() {
    if (this.state !== 'fresh' || this.alpha < 0.6) return null;
    this.strikes++;
    if (this.strikes >= this.target) {
      this.state = 'lit';
      this.flare = 1;
      this.ember = 1;
      this.used++;
      return 'ignite';
    }
    return 'spark';
  }

  update(dt) {
    const ev = [];
    if (this.state === 'lit') {
      this.life += dt;
      this.char = Math.min(1, this.life / this.maxLife);
      this.flare = Math.max(0, this.flare - dt * 1.8);
      if (this.life >= this.maxLife) { this.state = 'out'; this.outT = 0; ev.push('out'); }
    } else if (this.state === 'out') {
      this.outT += dt;
      this.ember = Math.max(0, this.ember - dt * 0.7);
      if (this.outT > 1.5) {
        this.alpha = Math.max(0, 1 - (this.outT - 1.5) / 0.35);
        if (this.alpha <= 0) { this._fresh(); ev.push('new'); }
      }
    } else if (this.alpha < 1) {
      this.alpha = Math.min(1, this.alpha + dt / 0.35);
    }
    return ev;
  }

  get lit() { return this.state === 'lit'; }
  get remaining() { return this.maxLife - this.life; }

  get flameScale() {
    if (!this.lit) return 0;
    let s = 1 + this.flare * this.flare * 0.9;
    const rem = this.remaining;
    if (rem < 2.2) s *= 0.2 + 0.8 * (rem / 2.2);
    return s;
  }

  // x, y — центр головки (горячая точка курсора), o = { size, svx, svy, t, dpr }
  draw(ctx, x, y, o) {
    const L = o.size;
    const w = L * 0.072;
    const hr = L * 0.085, hw = w * 0.86;
    const ang = 1.02 + clamp(o.svx * 0.00022, -0.3, 0.3);
    const dpr = o.dpr;

    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(x, y);

    ctx.save();
    ctx.rotate(ang);
    ctx.shadowColor = 'rgba(22,10,4,0.36)';
    ctx.shadowBlur = L * 0.07 * dpr;
    ctx.shadowOffsetX = L * 0.05 * dpr;
    ctx.shadowOffsetY = L * 0.085 * dpr;

    // Древко
    const x0 = hr * 0.5;
    const charEnd = x0 + this.char * L * 0.52;
    const wood = ctx.createLinearGradient(0, -w / 2, 0, w / 2);
    wood.addColorStop(0, '#c4945a');
    wood.addColorStop(0.35, '#ecd3a4');
    wood.addColorStop(0.68, '#dfbb82');
    wood.addColorStop(1, '#ad7f4a');
    ctx.fillStyle = wood;
    ctx.beginPath();
    ctx.rect(Math.max(x0, charEnd - 0.5), -w / 2, L - Math.max(x0, charEnd - 0.5), w);
    ctx.fill();

    // Обугленная часть — тоньше и чуть скручена
    if (this.char > 0.001) {
      const cw = w * 0.8;
      const bend = this.char * w * 0.7;
      const cg = ctx.createLinearGradient(0, -cw / 2, 0, cw / 2);
      cg.addColorStop(0, '#120d0b');
      cg.addColorStop(0.45, '#3b2d25');
      cg.addColorStop(1, '#0e0a08');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.moveTo(x0 - 1, -cw / 2 - bend * 0.15);
      ctx.quadraticCurveTo((x0 + charEnd) / 2, -cw / 2 - bend, charEnd, -w / 2);
      ctx.lineTo(charEnd, w / 2);
      ctx.quadraticCurveTo((x0 + charEnd) / 2, cw / 2 - bend, x0 - 1, cw / 2 - bend * 0.15);
      ctx.closePath();
      ctx.fill();
    }
    ctx.shadowColor = 'transparent';

    // Волокна дерева
    ctx.strokeStyle = 'rgba(125,82,40,0.22)';
    ctx.lineWidth = Math.max(0.5, w * 0.06);
    for (const k of [-0.24, 0.08, 0.3]) {
      ctx.beginPath();
      ctx.moveTo(charEnd + 2, k * w);
      ctx.lineTo(L - 2, k * w + w * 0.04);
      ctx.stroke();
    }
    // Тлеющая граница обугливания
    if (this.lit && this.char > 0.02) {
      const eg = ctx.createRadialGradient(charEnd, 0, 0, charEnd, 0, w * 1.1);
      eg.addColorStop(0, 'rgba(255,140,50,0.75)');
      eg.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(charEnd - w * 1.1, -w * 1.1, w * 2.2, w * 2.2);
    }

    // Головка
    ctx.shadowColor = 'rgba(22,10,4,0.36)';
    ctx.shadowBlur = L * 0.07 * dpr;
    ctx.shadowOffsetX = L * 0.05 * dpr;
    ctx.shadowOffsetY = L * 0.085 * dpr;
    ctx.beginPath();
    ctx.ellipse(0, 0, hr, hw, 0, 0, TAU);
    if (this.state === 'fresh') {
      const hg = ctx.createRadialGradient(-hr * 0.3, -hw * 0.4, 0, 0, 0, hr * 1.3);
      hg.addColorStop(0, '#d7583c');
      hg.addColorStop(0.5, '#9d2d1c');
      hg.addColorStop(1, '#55150c');
      ctx.fillStyle = hg;
    } else {
      const hg = ctx.createRadialGradient(-hr * 0.3, -hw * 0.4, 0, 0, 0, hr * 1.3);
      hg.addColorStop(0, '#3a2c25');
      hg.addColorStop(1, '#0c0807');
      ctx.fillStyle = hg;
    }
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (this.state === 'fresh') {
      ctx.fillStyle = 'rgba(255,230,210,0.28)';
      ctx.beginPath();
      ctx.ellipse(-hr * 0.35, -hw * 0.4, hr * 0.35, hw * 0.22, -0.2, 0, TAU);
      ctx.fill();
    }
    if (this.ember > 0) {
      const a = this.ember * (0.55 + 0.3 * noise1(o.t * 6 + this.seed));
      const eg = ctx.createRadialGradient(0, 0, 0, 0, 0, hr * 1.1);
      eg.addColorStop(0, `rgba(255,150,60,${a.toFixed(3)})`);
      eg.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.ellipse(0, 0, hr * 1.1, hw * 1.1, 0, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();

    const fs = this.flameScale;
    if (fs > 0) this._flame(ctx, o, fs);
    ctx.restore();
  }

  _flame(ctx, o, fs) {
    const L = o.size, t = o.t, sd = this.seed;
    const lean = this.flameCfg.lean;
    const fh = L * 0.42 * fs;
    const fw = L * 0.16 * Math.sqrt(fs);
    const lx = clamp(o.svx * 0.045 * lean, -fh * 0.85, fh * 0.85);
    const ly = clamp(o.svy * 0.03 * lean, -fh * 0.5, fh * 0.6);
    const wob = noise1(t * 5.3 + sd) * fw * 0.35 + noise1(t * 11.7 + sd * 2) * fw * 0.15;
    const hmod = 1 + noise1(t * 7.1 + sd * 3) * 0.12;
    const tx = lx + wob;
    const ty = Math.min(-fh * hmod + ly, -fh * 0.35);
    const bx = 0, by = -fw * 0.05;
    const len = Math.hypot(tx, ty);
    const ux = tx / len, uy = ty / len, px = -uy, py = ux;
    const curl = noise1(t * 9.3 + sd * 5) * fw * 0.45;
    const rem = this.remaining;
    const cool = rem < 2.2 ? rem / 2.2 : 1;

    const shape = (sw, sl) => {
      const W = fw * sw, Ln = len * sl, c = curl * sl;
      const Tx = bx + ux * Ln, Ty = by + uy * Ln;
      const Bx = bx - ux * W * 0.42, By = by - uy * W * 0.42;
      const Lx = bx + ux * Ln * 0.16 - px * W * 0.5, Ly = by + uy * Ln * 0.16 - py * W * 0.5;
      const Rx = bx + ux * Ln * 0.16 + px * W * 0.5, Ry = by + uy * Ln * 0.16 + py * W * 0.5;
      ctx.beginPath();
      ctx.moveTo(Bx, By);
      ctx.quadraticCurveTo(bx - px * W * 0.56 - ux * W * 0.12, by - py * W * 0.56 - uy * W * 0.12, Lx, Ly);
      ctx.bezierCurveTo(Lx + ux * Ln * 0.32, Ly + uy * Ln * 0.32,
        Tx - ux * Ln * 0.38 - px * W * 0.08 + px * c, Ty - uy * Ln * 0.38 - py * W * 0.08 + py * c, Tx, Ty);
      ctx.bezierCurveTo(Tx - ux * Ln * 0.38 + px * W * 0.1 + px * c, Ty - uy * Ln * 0.38 + py * W * 0.1 + py * c,
        Rx + ux * Ln * 0.32, Ry + uy * Ln * 0.32, Rx, Ry);
      ctx.quadraticCurveTo(bx + px * W * 0.56 - ux * W * 0.12, by + py * W * 0.56 - uy * W * 0.12, Bx, By);
      ctx.closePath();
    };

    // Ореол
    ctx.globalCompositeOperation = 'lighter';
    const gx = bx + ux * len * 0.35, gy = by + uy * len * 0.35;
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, len * 1.5);
    glow.addColorStop(0, `rgba(255,160,70,${(0.22 * Math.min(1.4, fs)).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(gx - len * 1.5, gy - len * 1.5, len * 3, len * 3);
    ctx.globalCompositeOperation = 'source-over';

    // Внешний язык
    const cx = bx + ux * len * 0.12, cy = by + uy * len * 0.12;
    const og = ctx.createRadialGradient(cx, cy, 0, cx, cy, len * 1.05);
    og.addColorStop(0, `rgba(255,${(236 - 40 * (1 - cool)) | 0},170,0.98)`);
    og.addColorStop(0.3, `rgba(255,${(170 - 50 * (1 - cool)) | 0},60,0.95)`);
    og.addColorStop(0.7, 'rgba(238,86,18,0.72)');
    og.addColorStop(1, 'rgba(200,40,8,0)');
    ctx.fillStyle = og;
    shape(1, 1);
    ctx.fill();

    // Синее основание
    const bg = ctx.createRadialGradient(bx, by + fw * 0.08, 0, bx, by + fw * 0.08, fw * 0.42);
    bg.addColorStop(0, `rgba(110,150,255,${(0.55 * cool).toFixed(3)})`);
    bg.addColorStop(1, 'rgba(110,150,255,0)');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(bx, by + fw * 0.08, fw * 0.42, 0, TAU);
    ctx.fill();

    // Сердцевина
    const ig = ctx.createRadialGradient(bx, by, 0, bx, by, len * 0.62);
    ig.addColorStop(0, 'rgba(255,255,244,1)');
    ig.addColorStop(0.5, `rgba(255,242,195,${(0.9 * cool + 0.1).toFixed(3)})`);
    ig.addColorStop(1, 'rgba(255,210,120,0)');
    ctx.fillStyle = ig;
    shape(0.52, 0.56);
    ctx.fill();
  }
}
