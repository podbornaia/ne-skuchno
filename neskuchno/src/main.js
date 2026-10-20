import { CONFIG as cfg } from './config.js';
import { Renderer } from './renderer.js';
import { BurnSim } from './burnsim.js';
import { Striker } from './striker.js';
import { Match } from './match.js';
import { Particles } from './particles.js';
import { Sound } from './audio.js';
import { newSeed, clamp } from './noise.js';
import { store } from './store.js';

const $ = (s) => document.querySelector(s);
const els = {
  stage: $('#stage'), poster: $('#poster'), striker: $('#striker'), fx: $('#fx'),
  hint: $('#hint'), toast: $('#toast'), num: $('#num'), nogl: $('#nogl'),
  menu: $('#menu'), menuBtn: $('[data-action="menu"]'), drop: $('#drop'),
  filePoster: $('#filePoster'), fileOverlay: $('#fileOverlay'),
};
const touchUI = matchMedia('(hover: none)').matches;

let renderer;
try {
  renderer = new Renderer(els.poster);
} catch (e) {
  console.error(e);
  els.nogl.hidden = false;
  els.stage.hidden = true;
}
if (renderer) boot();

function boot() {
  const fxCtx = els.fx.getContext('2d');
  const striker = new Striker(els.striker, newSeed());
  const match = new Match(cfg.match, cfg.flame);
  const particles = new Particles();
  const sound = new Sound();

  const st = {
    posterIndex: 0, aspect: 0.75, sim: null, seed: newSeed(),
    custom: null,          // свой плакат: { url, persisted }
    customShown: false,
    overlayFrom: null,     // откуда рисунок на кальке: 'upload' | 'url' | 'config' | null
    L: { poster: { x: 0, y: 0, w: 1, h: 1 }, striker: { x: 0, y: 0, w: 1, h: 1 }, size: 100, dpr: 1, s: 1 },
    glDirty: true, time: 0, dwell: 0, lastBurn: null, firstBurn: false, savedHintShown: false, slowStrokes: 0,
  };
  // Указатель. До первого касания спичка лежит у тёрки — подсказка жестом.
  const P = { x: 0, y: 0, visible: true, resting: true, active: false, type: 'mouse', vx: 0, vy: 0, svx: 0, svy: 0, lastT: 0, overUI: false };
  let stroke = null;

  // ---------- Плакат ----------
  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('Не удалось загрузить ' + src));
      im.src = src;
    });
  }

  function fallbackPoster() {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 1600;
    const x = c.getContext('2d');
    x.fillStyle = '#e9e1d2'; x.fillRect(0, 0, 1200, 1600);
    x.fillStyle = '#1b130c';
    x.font = '900 120px system-ui, sans-serif';
    x.fillText('Здесь будет', 80, 700);
    x.fillText('плакат', 80, 830);
    x.font = '500 40px system-ui, sans-serif';
    x.fillText('Положи файл в assets/posters и пропиши в src/config.js', 80, 960);
    return c;
  }

  // Картинка → источник для текстуры (большие уменьшаем до 3200 px по длинной стороне)
  async function decode(src) {
    const img = await loadImage(src);
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('Пустая картинка');
    const max = Math.min(renderer.maxTex, 3200);
    let source = img;
    if (w > max || h > max) {
      const k = max / Math.max(w, h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      source = c; w = c.width; h = c.height;
    }
    return { source, w, h };
  }

  // fallback: если картинка не открылась — показать заглушку (для плакатов серии) или бросить ошибку (для загрузок)
  async function setPoster(src, fallback = true) {
    let r;
    try { r = await decode(src); } catch (e) {
      if (!fallback) throw e;
      console.warn(e);
      const c = fallbackPoster();
      r = { source: c, w: c.width, h: c.height };
    }
    renderer.setPoster(r.source, r.w, r.h);
    st.aspect = r.w / r.h;
    resetPaper();
    layout();
  }

  function resetPaper() {
    st.seed = newSeed();
    const sh = cfg.sim.height;
    const sw = Math.max(32, Math.round(sh * st.aspect));
    if (!st.sim || st.sim.w !== sw || st.sim.h !== sh) {
      st.sim = new BurnSim(sw, sh, cfg.burn, st.seed);
      renderer.initBurn(sw, sh);
    } else {
      st.sim.reset(st.seed);
    }
    st.glDirty = true;
  }

  function showSeries(i) {
    const n = cfg.posters.length;
    st.posterIndex = ((i % n) + n) % n;
    st.customShown = false;
    els.num.textContent = String(st.posterIndex + 1).padStart(2, '0');
    syncUI();
    return setPoster(cfg.posters[st.posterIndex]);
  }

  async function showCustom() {
    await setPoster(st.custom.url, false);
    st.customShown = true;
    els.num.textContent = 'свой';
    syncUI();
  }

  const isImage = (f) => f && (f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|bmp|svg)$/i.test(f.name || ''));
  const BAD_FILE = 'Не получилось открыть файл — попробуй JPG, PNG или WebP';

  async function usePosterFile(file) {
    if (!isImage(file)) { toast(BAD_FILE); return; }
    const url = URL.createObjectURL(file);
    try { await setPoster(url, false); } catch { URL.revokeObjectURL(url); toast(BAD_FILE); return; }
    if (st.custom && st.custom.persisted) URL.revokeObjectURL(st.custom.url);
    st.custom = { url, persisted: true };
    st.customShown = true;
    els.num.textContent = 'свой';
    syncUI();
    store.put('poster', file);
    toast('Твой плакат — под калькой');
  }

  async function clearCustom() {
    if (!st.custom) return;
    if (st.custom.persisted) URL.revokeObjectURL(st.custom.url);
    st.custom = null;
    store.del('poster');
    if (st.customShown) await showSeries(st.posterIndex);
    syncUI();
    toast('Свой плакат убран');
  }

  // Рисунок на кальке. Новый рисунок = новый лист кальки, поэтому прожог сбрасывается.
  async function setOverlay(src, from, reset = true) {
    const r = await decode(src);
    renderer.setOverlay(r.source, r.w, r.h);
    st.overlayFrom = from;
    if (reset) resetPaper();
    st.glDirty = true;
    syncUI();
  }

  async function useOverlayFile(file) {
    if (!isImage(file)) { toast(BAD_FILE); return; }
    const url = URL.createObjectURL(file);
    try { await setOverlay(url, 'upload'); } catch { toast(BAD_FILE); return; } finally { URL.revokeObjectURL(url); }
    store.put('overlay', file);
    toast('Рисунок лёг на кальку');
  }

  function clearOverlay() {
    renderer.clearOverlay();
    st.overlayFrom = null;
    store.del('overlay');
    resetPaper();
    syncUI();
    toast('Калька снова чистая');
  }

  // ---------- Раскладка ----------
  function layout() {
    const vw = innerWidth, vh = innerHeight;
    const mobile = vw < 640;
    const padT = mobile ? 56 : 72, padB = mobile ? 116 : 72, padX = mobile ? 14 : 40;
    const ratio = cfg.striker.widthRatio;
    const availW = vw - padX * 2, availH = vh - padT - padB;
    let ph = Math.floor(Math.min(availH, availW / (st.aspect * (1 + ratio))));
    ph = Math.max(160, ph);
    let pw = Math.round(ph * st.aspect);
    const sw = Math.max(cfg.striker.minWidth, Math.round(pw * ratio));
    if (pw + sw > availW) { pw = availW - sw; ph = Math.round(pw / st.aspect); }
    const left = Math.round((vw - pw - sw) / 2);
    const top = Math.round(padT + (availH - ph) / 2);
    const dpr = Math.min(2, devicePixelRatio || 1);

    Object.assign(els.stage.style, { left: left + 'px', top: top + 'px', width: pw + sw + 'px', height: ph + 'px' });
    els.poster.style.width = pw + 'px';
    els.poster.style.height = ph + 'px';
    renderer.setSize(Math.round(pw * dpr), Math.round(ph * dpr));
    striker.resize(sw, ph, dpr);
    els.fx.width = Math.round(vw * dpr);
    els.fx.height = Math.round(vh * dpr);

    const L = st.L;
    L.poster = { x: left, y: top, w: pw, h: ph };
    L.striker = { x: left + pw, y: top, w: sw, h: ph };
    L.size = clamp(ph * 0.15, 64, 150);
    L.dpr = dpr;
    L.s = ph / 900;
    if (P.resting) { P.x = L.striker.x - L.size * 0.15; P.y = top + ph * 0.78; }
    st.glDirty = true;
  }

  // ---------- Подсказки ----------
  const HINTS = {
    start: touchUI ? 'Проведи спичкой по тёрке — резко →' : 'Чиркни спичкой о тёрку — резко →',
    slow: 'Медленно не загорится. Резче!',
    spark: 'Искры есть! Ещё раз',
    lit: 'Поднеси огонь к кальке',
    out: 'Спичка догорела — возьми новую и чиркни',
    save: touchUI ? 'Нравится? Сохрани постер ↗' : 'Нравится? S — сохранить постер',
  };
  let hintTimer = 0;
  function hint(key, ttl = 0) {
    clearTimeout(hintTimer);
    if (!key) { els.hint.dataset.hidden = ''; return; }
    els.hint.textContent = HINTS[key];
    delete els.hint.dataset.hidden;
    if (ttl) hintTimer = setTimeout(() => (els.hint.dataset.hidden = ''), ttl);
  }
  let toastTimer = 0;
  function toast(text) {
    els.toast.textContent = text;
    delete els.toast.dataset.hidden;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (els.toast.dataset.hidden = ''), 2200);
  }

  // ---------- Чирк ----------
  function strikerUV(x, y) {
    const S = st.L.striker;
    return [clamp((x - S.x) / S.w, 0, 1), clamp((y - S.y) / S.h, 0, 1)];
  }
  function beginStroke(x, y, t) {
    stroke = { len: 0, speed: 0, peak: 0, dir: 0, lastT: t, counted: false };
    striker.begin(...strikerUV(x, y));
  }
  function endStroke() {
    if (!stroke) return;
    if (!stroke.counted && stroke.len > cfg.strike.minStroke && stroke.peak > cfg.strike.slowSpeed) {
      sound.strike(0.2);
      if (!st.firstBurn && match.state === 'fresh' && match.strikes === 0 && ++st.slowStrokes >= 2) hint('slow');
    }
    striker.end();
    stroke = null;
  }

  function strikeSample(px, py, pt, x, y, t) {
    const S = st.L.striker;
    const tol = Math.max(6, S.w * 0.3);
    const inZone = x >= S.x - tol && x <= S.x + S.w + tol && y >= S.y && y <= S.y + S.h;
    const touching = P.type !== 'touch' || P.active;
    if (!inZone || !touching || match.state !== 'fresh' || !pt) { endStroke(); return; }
    const dt = (t - pt) / 1000;
    if (dt <= 0) return;
    const dx = x - px, dy = y - py;
    const dist = Math.hypot(dx, dy);
    const H = st.L.poster.h;
    if (!stroke || t - stroke.lastT > 160) { endStroke(); beginStroke(px, py, t); }
    const dir = Math.abs(dy) > 0.75 ? Math.sign(dy) : 0;
    if (dir && stroke.dir && dir !== stroke.dir) { endStroke(); beginStroke(px, py, t); }
    if (dir) stroke.dir = dir;
    const speed = dist / dt / H;
    stroke.speed = stroke.speed ? stroke.speed * 0.55 + speed * 0.45 : speed;
    stroke.peak = Math.max(stroke.peak, stroke.speed);
    stroke.len += dist / H;
    stroke.lastT = t;
    const k = clamp((stroke.speed - 0.2) / (cfg.strike.fastSpeed * 1.3), 0.06, 1);
    striker.extend(...strikerUV(x, y), k);
    if (!stroke.counted && stroke.len >= cfg.strike.minStroke && stroke.speed >= cfg.strike.fastSpeed) {
      stroke.counted = true;
      onStrike(x, y, dx / (dist || 1), dy / (dist || 1), stroke.speed);
    }
  }

  function onStrike(x, y, dx, dy, speed) {
    const k = Math.min(1, speed / (cfg.strike.fastSpeed * 2.2));
    const res = match.strike();
    if (!res) return;
    const s = st.L.s;
    sound.strike(0.6 + 0.4 * k);
    particles.sparks(x, y, dx, dy, Math.round(10 + 22 * k), s);
    if (res === 'ignite') {
      sound.ignite();
      particles.sparks(x, y, dx, -1, 26, s);
      hint(st.firstBurn ? null : 'lit');
    } else if (!st.firstBurn) {
      hint('spark');
    }
  }

  // ---------- Указатель ----------
  function sample(cx, cy, t) {
    const off = P.type === 'touch' ? cfg.touchOffset : 0;
    const x = cx, y = cy - off;
    const px = P.x, py = P.y, pt = P.lastT;
    if (pt && t > pt && t - pt < 100) {
      const dt = (t - pt) / 1000;
      P.vx = (x - px) / dt;
      P.vy = (y - py) / dt;
    }
    P.x = x; P.y = y; P.lastT = t;
    strikeSample(px, py, pt, x, y, t);
  }

  function onPointerMove(e) {
    P.type = e.pointerType || 'mouse';
    P.overUI = !!(e.target.closest && e.target.closest('button, a, .ui'));
    if (P.type === 'touch' && !P.active) return;
    if (P.resting) { P.resting = false; P.lastT = 0; }
    P.visible = true;
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (list && list.length) for (const c of list) sample(c.clientX, c.clientY, c.timeStamp);
    else sample(e.clientX, e.clientY, e.timeStamp);
  }

  addEventListener('pointermove', onPointerMove, { passive: true });
  addEventListener('pointerdown', (e) => {
    sound.unlock();
    P.type = e.pointerType || 'mouse';
    P.overUI = !!e.target.closest('button, a, .ui');
    if (P.overUI) return;
    P.active = true;
    P.resting = false;
    P.visible = true;
    P.lastT = 0;
    sample(e.clientX, e.clientY, e.timeStamp);
    P.vx = P.vy = 0;
  });
  const release = (e) => {
    P.active = false;
    if (e.pointerType === 'touch') { endStroke(); P.lastT = 0; P.vx = P.vy = 0; }
  };
  addEventListener('pointerup', release);
  addEventListener('pointercancel', release);
  document.addEventListener('pointerout', (e) => {
    if (!e.relatedTarget && e.pointerType === 'mouse') { P.visible = false; endStroke(); P.lastT = 0; }
  });
  addEventListener('blur', () => { endStroke(); P.lastT = 0; });
  els.stage.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('resize', layout);

  // ---------- Кнопки и клавиши ----------
  const posterCount = () => cfg.posters.length + (st.custom ? 1 : 0);
  const actions = {
    save: () => exportPNG(),
    reset: () => { resetPaper(); toast('Новая калька'); },
    next: () => {
      if (posterCount() < 2) return;
      if (st.customShown) return showSeries(0);
      if (st.custom && st.posterIndex === cfg.posters.length - 1) return showCustom().catch(() => showSeries(0));
      return showSeries(st.posterIndex + 1);
    },
    sound: () => { sound.unlock(); sound.setOn(!sound.on); syncSoundBtn(); },
    menu: () => toggleMenu(),
    pickPoster: () => { toggleMenu(false); els.filePoster.click(); },
    pickOverlay: () => { toggleMenu(false); els.fileOverlay.click(); },
    clearPoster: () => { toggleMenu(false); clearCustom(); },
    clearOverlay: () => { toggleMenu(false); clearOverlay(); },
  };

  function toggleMenu(open = els.menu.hidden) {
    els.menu.hidden = !open;
    els.menuBtn.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
  }
  document.addEventListener('pointerdown', (e) => {
    if (!els.menu.hidden && !e.target.closest('.menu-wrap')) toggleMenu(false);
  });
  els.filePoster.addEventListener('change', () => {
    const f = els.filePoster.files[0];
    els.filePoster.value = '';
    if (f) usePosterFile(f);
  });
  els.fileOverlay.addEventListener('change', () => {
    const f = els.fileOverlay.files[0];
    els.fileOverlay.value = '';
    if (f) useOverlayFile(f);
  });

  function syncUI() {
    $('[data-action="next"]').hidden = posterCount() < 2;
    $('[data-action="clearPoster"]').hidden = !st.custom;
    $('[data-action="clearOverlay"]').hidden = !st.overlayFrom;
  }
  const soundBtn = document.querySelector('[data-action="sound"]');
  function syncSoundBtn() {
    soundBtn.setAttribute('aria-pressed', String(sound.on));
    soundBtn.querySelector('.label').textContent = sound.on ? 'Звук' : 'Без звука';
  }
  syncSoundBtn();
  document.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', () => { actions[b.dataset.action](); b.blur(); }));
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    sound.unlock();
    if (e.code === 'Escape') { toggleMenu(false); return; }
    const map = { KeyS: 'save', KeyR: 'reset', KeyN: 'next', KeyM: 'sound', KeyU: 'pickPoster', KeyK: 'pickOverlay' };
    const a = map[e.code];
    if (a) { e.preventDefault(); actions[a](); }
  });

  // Перетаскивание файла в окно: две зоны — «Плакат» и «Рисунок на кальку»
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const zones = [...els.drop.querySelectorAll('.drop__zone')];
  const hideDrop = () => { dragDepth = 0; els.drop.hidden = true; zones.forEach((z) => z.classList.remove('is-over')); };
  addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    els.drop.hidden = false;
    toggleMenu(false);
  });
  addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) hideDrop();
  });
  addEventListener('dragover', (e) => {
    e.preventDefault();
    const z = e.target.closest && e.target.closest('.drop__zone');
    zones.forEach((x) => x.classList.toggle('is-over', x === z));
  });
  addEventListener('drop', (e) => {
    e.preventDefault();
    const z = e.target.closest && e.target.closest('.drop__zone');
    hideDrop();
    const f = [...(e.dataTransfer?.files || [])][0];
    if (!f) return;
    (z && z.dataset.target === 'overlay' ? useOverlayFile : usePosterFile)(f);
  });

  // ---------- Экспорт PNG ----------
  function exportPNG() {
    const gl = renderer.gl;
    const maxDB = Math.min(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), 4096);
    const ph = Math.min(cfg.exportHeight, maxDB, Math.round(maxDB / st.aspect));
    const pw = Math.round(ph * st.aspect);
    const sw = Math.max(cfg.striker.minWidth, Math.round(pw * cfg.striker.widthRatio));
    renderer.setSize(pw, ph);
    renderer.render({ time: st.time, seed: st.seed, paper: cfg.paper, overlay: cfg.overlay });
    const out = document.createElement('canvas');
    out.width = pw + sw;
    out.height = ph;
    const c = out.getContext('2d');
    c.drawImage(els.poster, 0, 0, pw, ph);
    Striker.paint(c, pw, 0, sw, ph, striker.seed, striker.strokes);
    const L = st.L;
    renderer.setSize(Math.round(L.poster.w * L.dpr), Math.round(L.poster.h * L.dpr));
    st.glDirty = true;
    out.toBlob((blob) => {
      if (!blob) { toast('Не получилось сохранить'); return; }
      const d = new Date();
      const p2 = (n) => String(n).padStart(2, '0');
      const name = `neskuchno-${st.customShown ? 'custom' : p2(st.posterIndex + 1)}-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.png`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Сохранено: ' + name);
    }, 'image/png');
  }

  // ---------- Главный цикл ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    st.time += dt;
    const L = st.L, sim = st.sim;

    // сглаженная скорость — для наклона спички и пламени
    const kv = Math.min(1, dt * 12);
    P.svx += (P.vx - P.svx) * kv;
    P.svy += (P.vy - P.svy) * kv;
    const decay = Math.exp(-dt * 10);
    P.vx *= decay; P.vy *= decay;

    for (const ev of match.update(dt)) {
      if (ev === 'out') {
        sound.extinguish();
        for (let i = 0; i < 14; i++) particles.smoke(P.x + (Math.random() - 0.5) * 6, P.y - Math.random() * 10, L.s);
        hint('out', 3200);
      }
    }
    if (match.lit && match.state === 'lit' && Math.random() < dt * 6) particles.smoke(P.x, P.y - L.size * 0.3 * match.flameScale, L.s * 0.7);

    // пламя касается кальки
    const burning = match.lit && P.visible && !P.overUI && !P.resting && (P.type !== 'touch' || P.active);
    if (burning && sim) {
      const fs = match.flameScale;
      const R = L.poster;
      const bx = (P.x - R.x) / R.w * sim.w;
      const by = (P.y - L.size * 0.06 * fs - R.y) / R.h * sim.h;
      // чем дольше держишь пламя на месте, тем шире захватывает жар
      const slow = Math.hypot(P.svx, P.svy) < R.h * 0.25;
      st.dwell = slow ? st.dwell + dt : Math.max(0, st.dwell - dt * 4);
      const grow = 1 + Math.min(cfg.burn.dwellMax - 1, st.dwell * cfg.burn.dwellRate);
      const r = Math.max(2, L.size * cfg.flame.burnRadius * Math.min(1.4, fs) * grow / R.h * sim.h);
      const power = Math.min(1.3, 0.55 + 0.5 * fs);
      // ведём пламя по всему отрезку между кадрами, чтобы быстрый жест не оставлял «пунктир»
      const lb = st.lastBurn || { x: bx, y: by };
      const steps = Math.min(40, Math.max(1, Math.ceil(Math.hypot(bx - lb.x, by - lb.y) / (r * 0.4))));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = lb.x + (bx - lb.x) * t, y = lb.y + (by - lb.y) * t;
        if (x >= -r && x <= sim.w + r && y >= -r && y <= sim.h + r) sim.applyFlame(x, y, r, power, dt / steps);
      }
      st.lastBurn = { x: bx, y: by };
    } else {
      st.lastBurn = null;
      st.dwell = 0;
    }

    if (sim) {
      if (sim.active) {
        const n = dt > 1 / 45 ? 2 : 1;
        for (let i = 0; i < n; i++) sim.step(dt / n);
        st.glDirty = true;
      }
      if (sim.flush(renderer)) st.glDirty = true;
      // пепел и редкие искры с кромки
      const evs = sim.events;
      const R = L.poster;
      for (let i = 0; i < evs.length && particles.p.length < 700; i += 3) {
        const x = R.x + (evs[i] + 0.5) / sim.w * R.w, y = R.y + (evs[i + 1] + 0.5) / sim.h * R.h;
        if (Math.random() < 0.18) particles.ember(x, y, L.s); else particles.ash(x, y, L.s);
      }
      evs.length = 0;

      const cov = sim.coverage;
      if (!st.firstBurn && cov > 0.002) { st.firstBurn = true; hint(null); }
      if (st.firstBurn && !st.savedHintShown && cov > 0.1 && !match.lit) { st.savedHintShown = true; hint('save', 4500); }
    }

    if (st.glDirty) {
      renderer.render({ time: st.time, seed: st.seed, paper: cfg.paper, overlay: cfg.overlay });
      st.glDirty = false;
    }

    particles.update(dt, L.s);
    sound.update(dt, match.lit, match.flameScale, sim ? sim.fireSum : 0);

    // слой эффектов поверх всего
    const ctx = fxCtx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, els.fx.width, els.fx.height);
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    particles.drawBack(ctx);
    if (P.visible && !P.overUI) {
      match.draw(ctx, P.x, P.y, { size: L.size, svx: P.svx, svy: P.svy, t: st.time, dpr: L.dpr });
    }
    particles.drawFront(ctx);
    document.body.classList.toggle('ui-cursor', P.overUI);

    requestAnimationFrame(frame);
  }

  // ---------- Старт ----------
  // Рисунок на кальке: ?overlay=… → загруженный ранее → из config.js
  // Плакат: ?poster=… или ?p=N → загруженный ранее → серия (случайный или первый)
  async function start() {
    const qp = new URLSearchParams(location.search);
    const [savedPoster, savedOverlay] = await Promise.all([store.get('poster'), store.get('overlay')]);

    const ovCandidates = [];
    if (qp.get('overlay')) ovCandidates.push([qp.get('overlay'), 'url']);
    if (savedOverlay) ovCandidates.push([URL.createObjectURL(savedOverlay), 'upload', true]);
    if (cfg.overlay.src) ovCandidates.push([cfg.overlay.src, 'config']);
    for (const [src, from, blob] of ovCandidates) {
      try { await setOverlay(src, from, false); break; } catch (e) { console.warn(e); } finally { if (blob) URL.revokeObjectURL(src); }
    }

    const qIndex = parseInt(qp.get('p'), 10);
    const startIndex = Number.isFinite(qIndex) ? qIndex - 1
      : cfg.startWith === 'random' ? Math.floor(Math.random() * cfg.posters.length) : 0;
    if (savedPoster) st.custom = { url: URL.createObjectURL(savedPoster), persisted: true };
    if (qp.get('poster')) {
      st.custom = { url: qp.get('poster'), persisted: false };
      await showCustom().catch(() => showSeries(startIndex));
    } else if (savedPoster && !Number.isFinite(qIndex)) {
      await showCustom().catch(() => { st.custom = null; store.del('poster'); return showSeries(startIndex); });
    } else {
      await showSeries(startIndex);
    }
  }

  start().then(() => {
    document.body.classList.add('ready');
    hint('start');
    requestAnimationFrame((t) => { last = t; frame(t); });
  });

  // хук для отладки и автотестов
  window.__neskuchno = { st, P, match, striker, particles, sound, exportPNG, usePosterFile, useOverlayFile };
}
