/* p3d — the shared 3D layer of the PLAYABLES pack (three.js r180, vendored in ./three).
 *
 * One look for every game: toon-ramp shading with a rim light, inverted-hull outlines on
 * hero objects, a gradient sky dome with matching fog, a soft-shadow sun and a hemisphere
 * fill, ACES tone mapping into sRGB. Graphics Low = pixel ratio 1, no shadows (games also
 * drop props). Models are Kenney CC0 kits run through arcade/tools/blender/optimize_glb.py
 * (see ../LICENSES.md); characters are pre-baked pose frames swapped at run time, so a crowd
 * of runners is a handful of instanced draw calls.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
export { THREE };

const MODELS = new URL('./models/', import.meta.url).href;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ── renderer + scene + camera ───────────────────────────────────────────── */
export function createView(canvas, o = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = o.exposure || 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(o.fov || 50, 1, o.near || 0.1, o.far || 300);
  const view = {
    renderer, scene, camera, low: !!o.low, W: 1, H: 1, dpr: 1,
    setLow(low) { view.low = !!low; view.resize(); if (view.onQuality) view.onQuality(view.low); },
    dyn: 1, ema: 16, lastT: 0, since: 0,
    resize() {
      const W = Math.max(1, innerWidth), H = Math.max(1, innerHeight);
      view.W = W; view.H = H;
      view.dpr = Math.min(devicePixelRatio || 1, view.low ? 1 : 2) * view.dyn;
      renderer.setPixelRatio(view.dpr);
      renderer.setSize(W, H, false);
      camera.aspect = W / H; camera.updateProjectionMatrix();
    },
    render() {
      renderer.render(scene, camera);
      /* adaptive resolution: when frames run long (a weak GPU, software GL), render fewer
         pixels, down to half; climb back when there is headroom again */
      const t = performance.now();
      if (view.lastT) { const d = Math.min(1000, t - view.lastT); view.ema += (d - view.ema) * 0.1; view.since++; }
      view.lastT = t;
      if (view.since > 8 && !view.fixed) {
        const want = view.ema > 45 ? Math.max(0.5, view.dyn - 0.25) : view.ema < 22 ? Math.min(1, view.dyn + 0.25) : view.dyn;
        if (want !== view.dyn) { view.dyn = want; view.since = 0; view.resize(); } else view.since = 4;
      }
    },
    /* draw one frame with every pooled mesh on, so all programs (and shadow programs) compile up front:
       software GL can stall for seconds on a material's first use mid-game */
    warm() { try { const hidden = []; scene.traverse(o => { if (o.isInstancedMesh && o.count === 0) { o.count = 1; hidden.push(o); } });
      renderer.render(scene, camera); for (const o of hidden) o.count = 0; } catch (e) { } },
    /* world -> CSS pixels; s = CSS pixels per world unit at that depth (for 2D overlay FX) */
    project(x, y, z) {
      _v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
      const depth = -_v.z;
      _v.set(x, y, z).project(camera);
      const s = view.H / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(0.05, depth));
      return { x: (_v.x * .5 + .5) * view.W, y: (-_v.y * .5 + .5) * view.H, s, zr: depth };
    },
  };
  /* a software rasteriser (SwiftShader, llvmpipe) starts at half resolution; ?hq pins full
     resolution (used for reference captures, which then show what a real GPU renders) */
  try { const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    view.soft = /swiftshader|llvmpipe|softpipe|software/i.test(String(name)); } catch (e) { view.soft = false; }
  view.fixed = /[?&]hq\b/.test(location.search);
  if (view.soft && !view.fixed) view.dyn = 0.5;
  view.resize();
  window.__p3dView = view;   /* QA handle: frame-time and quality experiments */
  return view;
}
const _v = new THREE.Vector3();

/* ── sky dome (gradient + soft sun glow), fog matched to the horizon ─────── */
export function makeSky(view, o = {}) {
  const u = {
    top: { value: new THREE.Color(o.top || '#3aa6ff') }, hor: { value: new THREE.Color(o.horizon || '#cdefff') },
    bot: { value: new THREE.Color(o.bottom || o.horizon || '#cdefff') },
    sunDir: { value: new THREE.Vector3(0.3, 0.35, -1).normalize() }, sunCol: { value: new THREE.Color(o.sun || '#fff4c8') },
    sunAmt: { value: o.sunAmt == null ? 1 : o.sunAmt }, stars: { value: o.stars || 0 }, time: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*p; gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 top,hor,bot,sunCol,sunDir; uniform float sunAmt,stars,time; varying vec3 vDir;
      float h(vec3 p){ return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453); }
      void main(){ vec3 d = normalize(vDir); float y = d.y;
        vec3 c = y > 0.0 ? mix(hor, top, pow(clamp(y,0.0,1.0), 0.55)) : mix(hor, bot, clamp(-y*3.0,0.0,1.0));
        float s = max(dot(d, normalize(sunDir)), 0.0);
        c += sunCol * (pow(s, 900.0) * 1.6 + pow(s, 24.0) * 0.28) * sunAmt;
        if (stars > 0.0 && y > 0.0) { vec3 q = floor(d * 220.0); float r = h(q);
          float tw = 0.6 + 0.4 * sin(time * 2.0 + r * 40.0);
          c += vec3(step(0.9965, r) * stars * tw * smoothstep(0.0, 0.25, y)); }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
  mesh.renderOrder = -10; mesh.frustumCulled = false;
  view.scene.add(mesh);
  view.scene.fog = new THREE.Fog(new THREE.Color(o.fog || o.horizon || '#cdefff'), o.fogNear || 40, o.fogFar || 140);
  const sky = {
    mesh, u,
    set(top, horizon, bottom, fog) {
      if (top) u.top.value.set(top); if (horizon) u.hor.value.set(horizon);
      if (bottom) u.bot.value.set(bottom); view.scene.fog.color.set(fog || horizon || u.hor.value);
    },
    update(t) { u.time.value = t || 0; mesh.position.copy(view.camera.position); mesh.scale.setScalar(view.camera.far * 0.9); },
  };
  return sky;
}

/* ── sun (soft shadows, tight camera that follows the action) + hemisphere fill ── */
export function makeLights(view, o = {}) {
  const hemi = new THREE.HemisphereLight(o.sky || '#dff1ff', o.ground || '#8a7a66', o.hemi == null ? 1.25 : o.hemi);
  const sun = new THREE.DirectionalLight(o.sun || '#fff1d6', o.sunI == null ? 2.4 : o.sunI);
  const dir = new THREE.Vector3(...(o.dir || [-0.5, 1, 0.45])).normalize();
  const size = o.shadow || 14;
  sun.castShadow = !view.low;
  sun.shadow.mapSize.set(o.mapSize || 1024, o.mapSize || 1024);
  Object.assign(sun.shadow.camera, { left: -size, right: size, top: size, bottom: -size, near: 1, far: 120 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; sun.shadow.radius = 3;
  view.scene.add(hemi, sun, sun.target);
  const L = {
    sun, hemi, dir,
    follow(x, y, z) { sun.target.position.set(x, y, z); sun.position.set(x + dir.x * 50, y + dir.y * 50, z + dir.z * 50); },
    setLow(low) { sun.castShadow = !low; },
  };
  L.follow(0, 0, 0);
  return L;
}

/* ── toon ramp + rim light ───────────────────────────────────────────────── */
let RAMP = null;
function ramp() {
  if (RAMP) return RAMP;
  const d = new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 235, 235, 235, 255, 255, 255, 255, 255]);
  RAMP = new THREE.DataTexture(d, 4, 1, THREE.RGBAFormat);
  RAMP.minFilter = RAMP.magFilter = THREE.NearestFilter; RAMP.generateMipmaps = false; RAMP.needsUpdate = true;
  return RAMP;
}
/* adds a view-facing rim light to any lit material */
export function rim(mat, color = '#ffffff', strength = 0.32, power = 2.6) {
  const rc = new THREE.Color(color);
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.rimCol = { value: rc }; sh.uniforms.rimK = { value: new THREE.Vector2(strength, power) };
    sh.fragmentShader = 'uniform vec3 rimCol; uniform vec2 rimK;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
      'float rimF = pow(1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0), rimK.y);\n' +
      'outgoingLight += rimCol * rimF * rimK.x;\n#include <opaque_fragment>');
  };
  mat.customProgramCacheKey = () => 'rim';   /* strength and power are uniforms: one program per material type */
  mat.userData.rim = rc;
  return mat;
}
export function toon(o = {}) {
  const { rim: r0, rimStrength, rimPower, ...rest } = o;
  const m = new THREE.MeshToonMaterial(Object.assign({ gradientMap: ramp() }, rest));
  const r = r0 === undefined ? '#ffffff' : r0;
  if (r) rim(m, r, rimStrength || 0.3, rimPower || 2.6);
  return m;
}
const TOON_CACHE = new Map();
function toonFrom(src) {
  const key = src.map ? src.map.uuid : src.color.getHexString();
  if (TOON_CACHE.has(key)) return TOON_CACHE.get(key);
  const m = toon({ map: src.map || null, color: src.map ? 0xffffff : src.color });
  if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
  TOON_CACHE.set(key, m);
  return m;
}

/* inverted-hull outline material (works on plain and instanced meshes) */
const OUT_CACHE = new Map();
export function outlineMat(thick = 0.03, color = '#1c1426') {
  const k = thick + color;
  if (OUT_CACHE.has(k)) return OUT_CACHE.get(k);
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed += normalize(normal) * ' + thick.toFixed(4) + ';');
  };
  m.customProgramCacheKey = () => 'outline' + thick;
  OUT_CACHE.set(k, m);
  return m;
}
/* a mesh plus its outline hull, sharing geometry (and instance matrices when instanced) */
export function withOutline(mesh, thick, color) {
  const g = new THREE.Group();
  g.add(mesh);
  let hull;
  if (mesh.isInstancedMesh) {
    hull = new THREE.InstancedMesh(mesh.geometry, outlineMat(thick, color), mesh.instanceMatrix.count);
    hull.instanceMatrix = mesh.instanceMatrix;
    hull.frustumCulled = false;
  } else hull = new THREE.Mesh(mesh.geometry, outlineMat(thick, color));
  hull.castShadow = false; hull.receiveShadow = false;
  g.add(hull); g.userData.hull = hull; g.userData.mesh = mesh;
  return g;
}

/* ── model loading (optimised single-mesh GLBs) ──────────────────────────── */
const loader = new GLTFLoader();
const GEO_CACHE = new Map();
/* resolves {geometry, material}: the model's merged mesh with a toon + rim material */
export function loadModel(name) {
  if (GEO_CACHE.has(name)) return GEO_CACHE.get(name);
  const p = new Promise((res, rej) => loader.load(MODELS + name + '.glb', gltf => {
    let mesh = null;
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
    const geometry = mesh.geometry.clone();
    geometry.applyMatrix4(mesh.matrixWorld);
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    res({ geometry, material: toonFrom(mesh.material), src: mesh.material });
  }, undefined, rej));
  GEO_CACHE.set(name, p);
  return p;
}
export function loadMany(names) { return Promise.all(names.map(loadModel)); }
/* pose frames baked from a Kenney character: <char>_<clip>_<i>.glb */
export async function loadFrames(char, clip, n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(char + '_' + clip + '_' + i);
  const ms = await loadMany(list);
  return { geos: ms.map(m => m.geometry), material: ms[0].material };
}

/* ── a posed character: swaps baked frames on one mesh ──────────────────── */
export class Actor {
  constructor(clips, o = {}) {           /* clips: {sprint:{geos,material}, jump:{...}, ...} */
    this.clips = clips; this.root = new THREE.Group();
    const first = Object.values(clips)[0];
    this.mesh = new THREE.Mesh(first.geos[0], first.material);
    this.mesh.castShadow = true;
    this.body = new THREE.Group(); this.body.add(this.mesh);
    if (o.outline !== false) {
      this.hull = new THREE.Mesh(first.geos[0], outlineMat(o.outline || 0.012, o.outlineColor));
      this.body.add(this.hull);
    }
    this.root.add(this.body);
    this.scale = o.scale || 1; this.body.scale.setScalar(this.scale);
  }
  pose(clip, t) {                          /* t in cycles (0..1 wraps) */
    const c = this.clips[clip] || Object.values(this.clips)[0];
    const n = c.geos.length, i = ((Math.floor(t * n) % n) + n) % n;
    this.mesh.geometry = c.geos[i]; if (this.hull) this.hull.geometry = c.geos[i];
  }
}

/* ── an instanced crowd of one character: one draw call per pose frame ──── */
export class Crowd {
  constructor(scene, frames, max, o = {}) {
    this.frames = frames; this.max = max; this.meshes = []; this.n = frames.geos.length;
    this.buckets = [];
    for (let i = 0; i < this.n; i++) {
      const m = new THREE.InstancedMesh(frames.geos[i], frames.material, max);
      m.castShadow = !!o.shadow; m.receiveShadow = false; m.count = 0; m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m); this.meshes.push(m); this.buckets.push(0);
    }
  }
  begin() { for (let i = 0; i < this.n; i++) this.buckets[i] = 0; }
  add(matrix, phase) {
    const f = ((Math.floor(phase * this.n) % this.n) + this.n) % this.n;
    const m = this.meshes[f], k = this.buckets[f];
    if (k >= this.max) return; m.setMatrixAt(k, matrix); this.buckets[f] = k + 1;
  }
  end() { for (let i = 0; i < this.n; i++) { const m = this.meshes[i]; m.count = this.buckets[i]; m.instanceMatrix.needsUpdate = true; } }
  setShadow(on) { for (const m of this.meshes) m.castShadow = on; }
}

/* ── pooled instanced props (rungs, planks, bricks...) ───────────────────── */
export class Props {
  constructor(scene, model, max, o = {}) {
    this.mesh = new THREE.InstancedMesh(model.geometry, o.material || model.material, max);
    this.mesh.castShadow = o.shadow !== false; this.mesh.receiveShadow = !!o.receive;
    this.mesh.frustumCulled = false; this.mesh.count = 0; this.max = max; this.k = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.obj = o.outline ? withOutline(this.mesh, o.outline, o.outlineColor) : this.mesh;
    scene.add(this.obj);
  }
  begin() { this.k = 0; }
  add(matrix, color) {
    if (this.k >= this.max) return;
    this.mesh.setMatrixAt(this.k, matrix);
    if (color) this.mesh.setColorAt(this.k, color);
    this.k++;
  }
  end() {
    this.mesh.count = this.k; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const h = this.obj.userData && this.obj.userData.hull; if (h) h.count = this.k;
  }
  set visible(v) { this.obj.visible = v; }
}

/* ── 3D particles: instanced chips with gravity, spin and fade-by-shrink ──── */
export class Particles {
  constructor(scene, max = 400, o = {}) {
    const geo = o.geometry || new THREE.OctahedronGeometry(0.5, 0);
    this.mat = o.material || new THREE.MeshToonMaterial({ gradientMap: ramp() });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
    this.max = max; this.p = [];
  }
  burst(x, y, z, n, color, o = {}) {
    const c = new THREE.Color(color), sp = o.speed || 4, up = o.up == null ? 3 : o.up;
    for (let i = 0; i < n; i++) {
      if (this.p.length >= this.max) this.p.shift();
      const a = Math.random() * Math.PI * 2, e = (Math.random() * 2 - 1) * (o.flat ? 0.15 : 1);
      const s = sp * (0.35 + Math.random() * 0.65);
      this.p.push({
        x, y, z, vx: Math.cos(a) * s * Math.sqrt(1 - e * e), vy: up * (0.5 + Math.random()) + e * s * 0.4, vz: Math.sin(a) * s * Math.sqrt(1 - e * e) * (o.flatZ || 1),
        g: o.gravity == null ? 14 : o.gravity, t: 0, life: (o.life || 0.8) * (0.6 + Math.random() * 0.6),
        size: (o.size || 0.12) * (0.6 + Math.random() * 0.8), rx: Math.random() * 6, ry: Math.random() * 6, vr: (Math.random() * 2 - 1) * 12,
        c, flat: !!o.confetti,
      });
    }
  }
  update(dt) {
    const m = this.mesh, M = _m, q = _q, e = _e, s = _s;
    let k = 0;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const p = this.p[i]; p.t += dt;
      if (p.t >= p.life) { this.p.splice(i, 1); continue; }
      p.vy -= p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.flat) { p.vx *= 1 - dt * 1.5; p.vz *= 1 - dt * 1.5; p.vy = Math.max(p.vy, -2.2); }
      p.rx += p.vr * dt; p.ry += p.vr * 0.7 * dt;
      const f = 1 - p.t / p.life, sz = p.size * (p.flat ? 1 : Math.min(1, f * 1.6));
      e.set(p.rx, p.ry, 0); q.setFromEuler(e);
      s.set(sz, p.flat ? sz * 0.15 : sz, p.flat ? sz * 0.6 : sz);
      _p.set(p.x, p.y, p.z);
      M.compose(_p, q, s);
      m.setMatrixAt(k, M); m.setColorAt(k, p.c); k++;
    }
    m.count = k; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  clear() { this.p.length = 0; this.mesh.count = 0; }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export const tmp = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), e: new THREE.Euler(), s: new THREE.Vector3(), p: new THREE.Vector3() };
/* compose a matrix from position, yaw/pitch/roll and a scale (number or [x,y,z]) */
export function mat(x, y, z, ry = 0, rx = 0, rz = 0, sc = 1) {
  tmp.e.set(rx, ry, rz, 'YXZ'); tmp.q.setFromEuler(tmp.e);
  if (Array.isArray(sc)) tmp.s.set(sc[0], sc[1], sc[2]); else tmp.s.set(sc, sc, sc);
  tmp.p.set(x, y, z);
  return tmp.m.compose(tmp.p, tmp.q, tmp.s);
}

/* ── canvas text → texture (gate numbers, wall counts, labels) ───────────── */
export function textTexture(txt, o = {}) {
  const w = o.w || 256, h = o.h || 128, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const draw = (t, opt = {}) => {
    const oo = Object.assign({}, o, opt);
    g.clearRect(0, 0, w, h);
    if (oo.bg) { g.fillStyle = oo.bg; g.fillRect(0, 0, w, h); }
    let size = oo.size || Math.round(h * 0.62);
    g.font = '900 ' + size + "px 'Arial Black',Impact,sans-serif";
    while (size > 10 && g.measureText(t).width > w * 0.9) { size -= 2; g.font = '900 ' + size + "px 'Arial Black',Impact,sans-serif"; }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (oo.stroke) { g.lineJoin = 'round'; g.lineWidth = Math.max(4, size * 0.16); g.strokeStyle = oo.stroke; g.strokeText(t, w / 2, h / 2 + size * 0.04); }
    g.fillStyle = oo.color || '#ffffff'; g.fillText(t, w / 2, h / 2 + size * 0.04);
    tex.needsUpdate = true;
  };
  draw(txt);
  return { tex, draw, canvas: c };
}

/* ── frame-time sampler (window.__p3dFrames for the QA scripts) ──────────── */
export function frameMeter() {
  const a = []; let last = 0;
  const m = {
    tick(now) { if (last) { a.push(now - last); if (a.length > 600) a.shift(); } last = now; },
    stats() { const s = a.slice().sort((x, y) => x - y); if (!s.length) return null;
      return { n: s.length, median: +s[s.length >> 1].toFixed(1), p95: +s[Math.floor(s.length * .95)].toFixed(1), worst: +s[s.length - 1].toFixed(1) }; },
    reset() { a.length = 0; last = 0; },
  };
  window.__p3dFrames = m;
  return m;
}

/* dispose everything under an object (restart / quality swaps) */
export function dispose(obj) {
  obj.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  if (obj.parent) obj.parent.remove(obj);
}
export { clamp };
