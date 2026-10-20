// Искры от чирка, пепел и редкие искорки с кромки, дым от погасшей спички.
// k: 0 — искра, 1 — тлеющая искорка, 2 — пепел, 3 — дым

const MAX = 900;

export class Particles {
  constructor() { this.p = []; }

  _add(o) { if (this.p.length < MAX) this.p.push(o); }

  sparks(x, y, dx, dy, count, s) {
    const base = Math.atan2(dy, dx);
    for (let i = 0; i < count; i++) {
      const a = base + (Math.random() - 0.5) * 1.7;
      const sp = (160 + Math.random() * 680) * s;
      this._add({
        k: 0, x, y,
        vx: Math.cos(a) * sp + (Math.random() - 0.5) * 140 * s,
        vy: Math.sin(a) * sp - (60 + Math.random() * 240) * s,
        life: 0, max: 0.16 + Math.random() * 0.45, size: (0.8 + Math.random() * 1.5) * s,
      });
    }
  }

  ember(x, y, s) {
    this._add({ k: 1, x, y, vx: (Math.random() - 0.5) * 40 * s, vy: -(25 + Math.random() * 60) * s,
      life: 0, max: 0.5 + Math.random() * 1.1, size: (0.9 + Math.random() * 1.3) * s, ph: Math.random() * 9 });
  }

  ash(x, y, s) {
    const g = 30 + Math.random() * 70;
    this._add({ k: 2, x, y, vx: (Math.random() - 0.5) * 28 * s, vy: -(14 + Math.random() * 42) * s,
      life: 0, max: 1.6 + Math.random() * 2.2, size: (1.1 + Math.random() * 2.8) * s,
      rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 5, ph: Math.random() * 9,
      col: `${g | 0},${(g * 0.93) | 0},${(g * 0.88) | 0}` });
  }

  smoke(x, y, s) {
    this._add({ k: 3, x, y, vx: (Math.random() - 0.5) * 12 * s, vy: -(28 + Math.random() * 26) * s,
      life: 0, max: 1.4 + Math.random() * 1.4, r: (3 + Math.random() * 5) * s, ph: Math.random() * 9 });
  }

  update(dt, s) {
    const p = this.p;
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      q.life += dt;
      if (q.life >= q.max) { p[i] = p[p.length - 1]; p.pop(); continue; }
      switch (q.k) {
        case 0: q.vy += 1500 * s * dt; q.vx *= Math.exp(-1.5 * dt); break;
        case 1: q.vx += Math.sin(q.life * 7 + q.ph) * 60 * s * dt; q.vy -= 8 * s * dt; break;
        case 2: q.vy += 34 * s * dt; q.vx += Math.sin(q.life * 2.6 + q.ph) * 22 * s * dt; q.vx *= Math.exp(-0.8 * dt); q.rot += q.vr * dt; break;
        case 3: q.r += 16 * s * dt; q.vx += Math.sin(q.life * 2 + q.ph) * 14 * s * dt; q.vy *= Math.exp(-0.4 * dt); break;
      }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
    }
  }

  drawBack(ctx) {
    for (const q of this.p) {
      const r = q.life / q.max;
      if (q.k === 3) {
        const a = 0.13 * Math.sin(Math.PI * r);
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.r);
        g.addColorStop(0, `rgba(70,64,60,${a.toFixed(3)})`);
        g.addColorStop(1, 'rgba(70,64,60,0)');
        ctx.fillStyle = g;
        ctx.fillRect(q.x - q.r, q.y - q.r, q.r * 2, q.r * 2);
      } else if (q.k === 2) {
        const a = Math.min(1, (1 - r) * 1.6) * 0.85;
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(q.rot);
        ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.sin(q.life * 3 + q.ph)));
        ctx.fillStyle = `rgba(${q.col},${a.toFixed(3)})`;
        const z = q.size;
        ctx.beginPath();
        ctx.moveTo(-z, -z * 0.4); ctx.lineTo(z * 0.3, -z * 0.7); ctx.lineTo(z, z * 0.2); ctx.lineTo(-z * 0.2, z * 0.6);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  drawFront(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const q of this.p) {
      const r = q.life / q.max;
      if (q.k === 0) {
        const a = (1 - r);
        ctx.strokeStyle = `rgba(255,${(230 - 120 * r) | 0},${(140 - 120 * r) | 0},${a.toFixed(3)})`;
        ctx.lineWidth = q.size;
        ctx.beginPath();
        ctx.moveTo(q.x, q.y);
        ctx.lineTo(q.x - q.vx * 0.018, q.y - q.vy * 0.018);
        ctx.stroke();
      } else if (q.k === 1) {
        const a = (1 - r) * (0.6 + 0.4 * Math.sin(q.life * 30 + q.ph));
        ctx.fillStyle = `rgba(255,${(150 - 60 * r) | 0},40,${Math.max(0, a).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
