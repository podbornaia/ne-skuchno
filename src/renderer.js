// WebGL2: один полноэкранный квад и фрагментный шейдер, который композитит
// плакат + кальку (зерно, волокна, полупрозрачность) + кромку прожога по маске.

const VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uPoster;
uniform sampler2D uBurn;
uniform vec2  uSimTexel;
uniform float uAspect;
uniform float uTime;
uniform float uSeed;
uniform float uBlurLod;
uniform float uOpacity;
uniform vec3  uTint;
uniform sampler2D uOverlay;   // рисунок на кальке (premultiplied alpha)
uniform vec2  uOvScale;
uniform float uOvAmt;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x),
             mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.7); a *= 0.5; }
  return s;
}
float dmg(vec2 uv) { return texture(uBurn, uv).r; }

void main() {
  vec2 uv = vUv;
  vec2 q = vec2(uv.x * uAspect, uv.y);
  vec2 sp = q + vec2(uSeed * 0.013, uSeed * 0.007);

  vec4 b = texture(uBurn, uv);
  float d = b.r;

  // Широкое «гало» вокруг прожога — для подпалины
  float r1 = 0.0, r2 = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.7853982 + 0.39;
    vec2 o = vec2(cos(a), sin(a)) * uSimTexel;
    r1 += dmg(uv + o * 2.5);
    r2 += dmg(uv + o * 6.5);
  }
  r1 *= 0.125; r2 *= 0.125;
  float halo = max(d, max(r1 * 0.9, r2 * 0.65));

  // Неровный край: крупные языки + мелкие рваные волокна
  float nA = fbm(sp * 14.0);
  float nB = vnoise(sp * 95.0);
  float nC = vnoise(vec2(sp.x * 420.0, sp.y * 38.0));
  float edgeN = (nA - 0.5) * 0.55 + (nB - 0.5) * 0.24 + (nC - 0.5) * 0.08;
  float dd = d + edgeN * 0.42 * smoothstep(0.02, 0.2, halo);

  float fw = max(fwidth(dd), 0.004);
  float hole = smoothstep(0.82 - fw, 0.82 + fw, dd);

  // Калька: зерно, волокна, неравномерная плотность
  float grain = vnoise(q * 700.0) * 0.55 + hash12(floor(q * 1500.0)) * 0.45;
  float fib = vnoise(vec2(q.x * 900.0, q.y * 55.0)) * 0.5 + vnoise(vec2(q.x * 60.0 + 3.1, q.y * 800.0)) * 0.5;
  float cloud = fbm(q * 3.0 + uSeed * 0.001);

  vec3 sharp = texture(uPoster, uv).rgb;
  vec3 soft = textureLod(uPoster, uv, uBlurLod).rgb;

  float op = clamp(uOpacity + (cloud - 0.5) * 0.14 + (grain - 0.5) * 0.08 + (fib - 0.5) * 0.06, 0.0, 1.0);
  vec3 paperCol = uTint * (0.955 + (grain - 0.5) * 0.09 + (fib - 0.5) * 0.04);
  vec3 paper = mix(soft, paperCol, op);
  // Рисунок на кальке — multiply: белое и прозрачное не меняют ничего, тёмное «печатается».
  // Применяется до подпалины, поэтому рисунок обугливается и сгорает вместе с калькой.
  vec2 ouv = 0.5 + (uv - 0.5) * uOvScale;
  vec4 ov = texture(uOverlay, ouv);
  float inside = step(0.0, ouv.x) * step(ouv.x, 1.0) * step(0.0, ouv.y) * step(ouv.y, 1.0);
  vec3 ink = vec3(1.0) - (vec3(ov.a) - ov.rgb) * uOvAmt * inside;
  paper *= ink;

  paper *= 0.965 + 0.06 * (1.0 - uv.y) * (1.0 - 0.5 * uv.x);   // мягкий свет сверху-слева

  // Подпалина → тлеющий фронт → тёмно-коричневый → чёрный обугленный край → дыра.
  // Зерно кальки сохраняется до самой кромки, кромка темнее и плотнее.
  float dc = max(dd, r1 * 0.97 + edgeN * 0.3);        // обугливание чуть шире дыры
  float ds = max(dc, r2 * 0.85 + edgeN * 0.3);        // коричневая подпалина ещё шире
  float scorch = smoothstep(0.05, 0.6, halo + edgeN * 0.2);
  paper = mix(paper, paper * vec3(0.74, 0.56, 0.38), scorch * 0.85);
  float singe = smoothstep(0.24, 0.55, ds);
  paper = mix(paper, vec3(0.32, 0.17, 0.07) * (0.8 + 0.4 * grain), singe * 0.8);
  float charA = smoothstep(0.55, 0.78, dc);
  paper = mix(paper, vec3(0.045, 0.03, 0.022) * (0.75 + 0.55 * grain), charA);

  // Тлеющая кромка: ярче всего на фронте огня, слабее — по краю дыры
  float heat = b.g;
  float front = smoothstep(0.06, 0.28, dd) * (1.0 - smoothstep(0.55, 0.8, dc));
  float rim = smoothstep(0.62, 0.8, dc) * (1.0 - hole) * 0.55;
  float flick = 0.6 + 0.8 * vnoise(q * 38.0 + vec2(0.0, uTime * 1.9));
  vec3 hot = mix(vec3(0.9, 0.2, 0.02), vec3(1.0, 0.7, 0.25), clamp(b.b * 1.3, 0.0, 1.0));
  paper += hot * (front + rim) * heat * flick * 1.9;
  paper += vec3(0.9, 0.35, 0.08) * heat * 0.08;       // тёплый отсвет на бумаге

  // Под дырой — чёткий плакат с мягкой тенью от края кальки
  vec2 off = vec2(-2.0, -3.0) * uSimTexel;
  float sh = (dmg(uv + off) + dmg(uv + off * 1.9 + vec2(uSimTexel.x, 0.0)) + dmg(uv + off * 1.9 - vec2(0.0, uSimTexel.y))) / 3.0;
  float paperNear = 1.0 - smoothstep(0.7, 0.97, sh);
  vec3 under = sharp * (1.0 - paperNear * 0.4);
  under += hot * heat * 0.22;

  vec3 col = mix(paper, under, hole);
  outColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 недоступен');
    this.gl = gl;
    this.canvas = canvas;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    this.prog = p;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    for (const n of ['uPoster', 'uBurn', 'uSimTexel', 'uAspect', 'uTime', 'uSeed', 'uBlurLod', 'uOpacity', 'uTint', 'uOverlay', 'uOvScale', 'uOvAmt']) {
      this.u[n] = gl.getUniformLocation(p, n);
    }
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.posterTex = null;
    this.burnTex = null;
    this.simW = 1; this.simH = 1;
    this.clearOverlay();
  }

  _tex(source, premultiply) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiply);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  // Рисунок на кальку. fit: 'cover' — заполнить, обрезав лишнее; 'contain' — вписать целиком; 'stretch' — растянуть
  setOverlay(source, w, h) {
    if (this.overlayTex) this.gl.deleteTexture(this.overlayTex);
    this.overlayTex = this._tex(source, true);
    this.ovAspect = w / h;
    this.hasOverlay = true;
  }

  clearOverlay() {
    const gl = this.gl;
    if (this.overlayTex) gl.deleteTexture(this.overlayTex);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.overlayTex = t;
    this.ovAspect = 1;
    this.hasOverlay = false;
  }

  _ovScale(fit) {
    const pa = this.aspect, oa = this.ovAspect;
    if (!this.hasOverlay || fit === 'stretch') return [1, 1];
    const wider = oa > pa;
    if (fit === 'contain') return wider ? [1, oa / pa] : [pa / oa, 1];
    return wider ? [pa / oa, 1] : [1, oa / pa]; // cover
  }

  setPoster(source, w, h) {
    if (this.posterTex) this.gl.deleteTexture(this.posterTex);
    this.posterTex = this._tex(source, false);
    this.aspect = w / h;
  }

  initBurn(w, h) {
    const gl = this.gl;
    if (this.burnTex) gl.deleteTexture(this.burnTex);
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(w * h * 4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.burnTex = t;
    this.simW = w; this.simH = h;
  }

  uploadBurn(x, y, w, h, data) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.burnTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  setSize(w, h) {
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  render({ time, seed, paper, overlay }) {
    const gl = this.gl;
    if (!this.posterTex || !this.burnTex) return;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.posterTex);
    gl.uniform1i(this.u.uPoster, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.burnTex);
    gl.uniform1i(this.u.uBurn, 1);
    gl.uniform2f(this.u.uSimTexel, 1 / this.simW, 1 / this.simH);
    gl.uniform1f(this.u.uAspect, this.aspect);
    gl.uniform1f(this.u.uTime, time);
    gl.uniform1f(this.u.uSeed, seed % 1000);
    gl.uniform1f(this.u.uBlurLod, paper.blur);
    gl.uniform1f(this.u.uOpacity, paper.opacity);
    gl.uniform3fv(this.u.uTint, paper.tint);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.overlayTex);
    gl.uniform1i(this.u.uOverlay, 2);
    gl.uniform2fv(this.u.uOvScale, this._ovScale(overlay.fit));
    gl.uniform1f(this.u.uOvAmt, this.hasOverlay ? overlay.opacity : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
