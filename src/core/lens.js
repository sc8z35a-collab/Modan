// Camera lens system: ultra-wide 0.5x, optical zoom up to 20x, plus 2x digital zoom (40x total).
//
// - optical zoom changes the real camera FOV: tan(fov/2) = tan(baseFov/2) / optical
// - digital zoom renders at the 20x optical FOV and crops/upscales the centre of the frame in post (like a phone
//   sensor crop): it gets softer, gets a sharpening halo and more noise instead of new detail
// - ultra-wide (< 1x) uses a Panini projection in post so the 100°+ rectilinear frame doesn't smear objects at the
//   edges, plus lens-realistic corner vignetting and lateral chromatic aberration
// - all transitions are log-space smoothed (zoom feels linear to the eye), tele is stabilised (look speed / bob / roll)
import * as THREE from 'three';
import { Effect, EffectAttribute } from 'postprocessing';

export const ZOOM = { min: 0.5, maxOptical: 20, maxDigital: 2 };
ZOOM.max = ZOOM.maxOptical * ZOOM.maxDigital;
// 35mm-equivalent focal length of the 1x "main camera" (shown in the UI)
export const MAIN_FOCAL_MM = 24;
export const PRESETS = [0.5, 1, 2, 5, 10, 20, 40];

const lensFrag = /* glsl */`
uniform float uDigital;   // >= 1 : centre crop factor
uniform float uPanini;    // Panini d (0 = rectilinear)
uniform float uPaniniS;   // fit scale so the output never samples outside the rendered frame
uniform vec2 uExtent;     // tan(hfov/2), tan(vfov/2) of the rendered frame
uniform float uCA;        // lateral chromatic aberration strength (uv units at the corner)
uniform float uSharpen;   // digital-zoom sharpening
uniform float uCorner;    // extra corner falloff (ultra-wide cos^4 law)

vec2 panini(vec2 vp, float d){
  float viewDist = 1.0 + d;
  float hyp = vp.x * vp.x + viewDist * viewDist;
  float iD = vp.x * d;
  float disc = hyp - iD * iD;
  float cylDmd = (-iD * vp.x + viewDist * sqrt(max(disc, 0.0))) / hyp;
  float cylD = cylDmd + d;
  vec2 cp = vp * (cylD / viewDist);
  return cp / cylDmd;
}

vec2 lensUv(vec2 uv){
  uv = 0.5 + (uv - 0.5) / uDigital;
  if (uPanini > 0.001) {
    vec2 vp = (uv * 2.0 - 1.0) * uExtent * uPaniniS;
    uv = panini(vp, uPanini) / uExtent * 0.5 + 0.5;
  }
  return uv;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor){
  vec2 suv = lensUv(uv);
  vec2 c = uv - 0.5;
  float r2 = dot(c, c) * 2.0; // 0 centre .. 1 corner
  vec2 dir = c * r2 * uCA;
  vec3 col;
  col.r = texture2D(inputBuffer, lensUv(uv + dir)).r;
  col.g = texture2D(inputBuffer, suv).g;
  col.b = texture2D(inputBuffer, lensUv(uv - dir)).b;
  if (uSharpen > 0.001) {
    // unsharp mask in SOURCE texel space (what a phone ISP does after upscaling a sensor crop)
    vec2 t = texelSize;
    vec3 blur = texture2D(inputBuffer, suv + vec2(t.x, 0.0)).rgb + texture2D(inputBuffer, suv - vec2(t.x, 0.0)).rgb
              + texture2D(inputBuffer, suv + vec2(0.0, t.y)).rgb + texture2D(inputBuffer, suv - vec2(0.0, t.y)).rgb;
    col += (col - blur * 0.25) * uSharpen;
    col = max(col, 0.0);
  }
  // natural vignetting of very wide lenses (cos^4 falloff), applied on top of the global artistic vignette
  float cosT = 1.0 / sqrt(1.0 + r2 * uCorner);
  col *= mix(1.0, cosT * cosT * cosT * cosT, step(0.001, uCorner));
  outputColor = vec4(col, inputColor.a);
}`;

export class LensEffect extends Effect {
  constructor() {
    super('LensEffect', lensFrag, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['uDigital', new THREE.Uniform(1)], ['uPanini', new THREE.Uniform(0)], ['uPaniniS', new THREE.Uniform(1)],
        ['uExtent', new THREE.Uniform(new THREE.Vector2(1, 1))], ['uCA', new THREE.Uniform(0)],
        ['uSharpen', new THREE.Uniform(0)], ['uCorner', new THREE.Uniform(0)],
      ]),
    });
  }
}

// JS mirror of the shader's panini() (used to fit the crop scale)
function paniniJs(x, y, d) {
  const viewDist = 1 + d, hyp = x * x + viewDist * viewDist, iD = x * d;
  const cylDmd = (-iD * x + viewDist * Math.sqrt(Math.max(hyp - iD * iD, 0))) / hyp;
  const k = (cylDmd + d) / viewDist / cylDmd;
  return [x * k, y * k];
}
// largest s <= 1 such that the output frame edges map inside the rendered frame
function paniniFit(ex, ey, d) {
  if (d < 0.001) return 1;
  const pts = [[1, 1], [1, 0], [0, 1], [1, 0.5], [0.5, 1]];
  const ok = (s) => pts.every(([u, v]) => { const [rx, ry] = paniniJs(ex * s * u, ey * s * v, d); return Math.abs(rx) <= ex * 1.0001 && Math.abs(ry) <= ey * 1.0001; });
  if (ok(1)) return 1;
  let lo = 0.2, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
  return lo;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Lens {
  constructor(camera) {
    this.camera = camera;
    this.zoom = 1; this.target = 1;
    this.baseFov = camera.fov;
    this.effect = new LensEffect();
    this.onChange = null;
    this._lastFov = -1; this._lastAspect = -1; this._fitCache = new Map();
  }

  get optical() { return Math.min(this.zoom, ZOOM.maxOptical); }
  get digital() { return Math.max(1, this.zoom / ZOOM.maxOptical); }
  get targetDigital() { return this.target > ZOOM.maxOptical + 1e-6; }
  // 35mm-equivalent focal length of the current view (digital zoom included, like phone camera UIs)
  get focalMM() { return MAIN_FOCAL_MM * this.zoom; }
  // effective magnification relative to the 1x view (used for look sensitivity, stabilisation, LOD, DOF)
  get mag() { return this.zoom; }

  static clamp(z) { return Math.min(ZOOM.max, Math.max(ZOOM.min, Number.isFinite(z) ? z : 1)); }
  setZoom(z, instant = false) {
    this.target = Lens.clamp(z);
    if (instant) this.zoom = this.target;
    this.onChange?.(this);
  }
  zoomBy(k) { this.setZoom(this.target * k); }
  // step to the next / previous preset (keyboard, buttons)
  step(dir) {
    const t = this.target;
    const next = dir > 0 ? PRESETS.find((p) => p > t * 1.02) : [...PRESETS].reverse().find((p) => p < t / 1.02);
    this.setZoom(next ?? (dir > 0 ? ZOOM.max : ZOOM.min));
  }

  // called by Renderer.resize(): the "1x" FOV depends on aspect ratio (wider phones get a narrower vertical FOV)
  setBaseFov(fov) { this.baseFov = fov; this._lastFov = -1; }

  update(dt) {
    // smooth in log space (~0.25s to settle); snap when close
    const lz = Math.log(this.zoom), lt = Math.log(this.target);
    const k = 1 - Math.exp(-dt * 9);
    let nz = Math.exp(lz + (lt - lz) * k);
    if (Math.abs(lt - Math.log(nz)) < 0.002) nz = this.target;
    const changed = nz !== this.zoom;
    this.zoom = nz;
    this.apply(changed);
    return changed;
  }

  apply(force = false) {
    const cam = this.camera;
    const opt = this.optical;
    const tb = Math.tan(THREE.MathUtils.degToRad(this.baseFov) / 2);
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(tb / opt));
    if (force || Math.abs(fov - this._lastFov) > 1e-5 || cam.aspect !== this._lastAspect) {
      cam.fov = fov; cam.updateProjectionMatrix();
      this._lastFov = fov; this._lastAspect = cam.aspect;
    }
    const U = this.effect.uniforms;
    const ey = Math.tan(THREE.MathUtils.degToRad(fov) / 2), ex = ey * cam.aspect;
    U.get('uExtent').value.set(ex, ey);
    // ultra-wide: Panini strength ramps in below 1x (0 at 1x, 0.55 at 0.5x)
    const d = 0.55 * smooth(1, 0.5, opt);
    U.get('uPanini').value = d;
    const key = `${ex.toFixed(3)}:${d.toFixed(3)}`;
    let s = this._fitCache.get(key);
    if (s === undefined) { s = paniniFit(ex, ey, d); if (this._fitCache.size > 256) this._fitCache.clear(); this._fitCache.set(key, s); }
    U.get('uPaniniS').value = s;
    const dg = this.digital;
    U.get('uDigital').value = dg;
    U.get('uSharpen').value = (dg - 1) * 0.7;
    // lateral CA: strongest on the ultra-wide, a touch on the long tele, clean around 1-5x
    U.get('uCA').value = 0.0035 * smooth(1, 0.5, opt) + 0.0012 * smooth(8, 20, opt) + 0.0015 * (dg - 1);
    U.get('uCorner').value = 1.6 * smooth(0.9, 0.5, opt);
  }

  // look sensitivity multiplier: at 20x a thumb swipe must turn the view 20x less
  lookScale() { return 1 / Math.pow(this.zoom, 0.92); }
  // LOD distance multiplier for scattered vegetation/props (narrower FOV = objects are bigger on screen)
  lodBias() { return Math.min(ZOOM.maxOptical, Math.max(1, this.optical)); }
  // camera-shake / head-bob attenuation (optical image stabilisation feel)
  stabilise() { return 1 / Math.max(1, Math.pow(this.zoom, 0.8)); }
  // viewmodel counter scale so held tools keep a constant on-screen size at every zoom
  viewmodelScale() { return 1 / this.optical; }

  label() {
    const z = this.zoom;
    const t = z < 1 ? z.toFixed(1).replace(/^0/, '') : z < 10 ? z.toFixed(1).replace(/\.0$/, '') : Math.round(z).toString();
    return t + '×';
  }
}
