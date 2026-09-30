// Physically-inspired sky dome with sun, moon, stars, milky way, and animated clouds.
// Also drives sun/moon/hemisphere lighting, fog and the IBL environment map.
import * as THREE from 'three';
import { clamp, smoothstep, lerp } from '../core/noise.js';

const skyVert = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = normalize((modelMatrix * vec4(position,0.0)).xyz);
  vec4 p = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  gl_Position = p.xyww;
}`;

const skyFrag = /* glsl */`
precision highp float;
varying vec3 vDir;
uniform vec3 uSun; uniform vec3 uMoon;
uniform float uTime; uniform float uDay; uniform float uCloud; uniform float uNight;
uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunCol;
uniform float uMoonPhase; // 0 = new moon, 0.5 = full moon, 1 = new again
uniform float uMeteor;    // 0..1 shooting-star frequency (clear nights)

float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float hash2(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash2(i),hash2(i+vec2(1,0)),f.x),mix(hash2(i+vec2(0,1)),hash2(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<6;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5;} return s; }
float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }

vec3 stars(vec3 d){
  vec3 col = vec3(0.0);
  for(int l=0;l<3;l++){
    float sc = 180.0 + float(l)*170.0;
    vec3 p = d*sc; vec3 id = floor(p); vec3 f = fract(p)-0.5;
    float h = hash(id + float(l)*13.1);
    if(h > 0.985){
      float tw = 0.65 + 0.35*sin(uTime*(2.0+h*6.0) + h*80.0);
      float s = smoothstep(0.22, 0.0, length(f)) * (h-0.985)*66.0 * tw;
      vec3 tint = mix(vec3(0.7,0.8,1.0), vec3(1.0,0.85,0.7), hash(id*1.7));
      col += tint * s;
    }
  }
  // milky way band
  vec3 axis = normalize(vec3(0.3, 0.55, 0.78));
  float band = 1.0 - abs(dot(d, axis));
  band = pow(smoothstep(0.55, 1.0, band), 3.0);
  float neb = n3(d*6.0)*0.6 + n3(d*14.0)*0.3 + n3(d*32.0)*0.1;
  float dust = smoothstep(0.35, 0.75, n3(d*9.0+3.0));
  col += band * (vec3(0.30,0.32,0.45)*neb*0.55 - dust*0.08*band);
  // dense tiny stars in band
  float fine = hash(floor(d*900.0));
  col += band * step(0.992, fine) * vec3(0.9) * 0.8;
  return max(col, 0.0);
}

// one shooting star per time slot: random start on the upper sky, short streak with a fading tail
vec3 meteor(vec3 d, float slot, float period, float seed){
  float id = floor(uTime / period + seed);
  float ph = fract(uTime / period + seed);
  float h = hash(vec3(id, seed*13.7, 3.1));
  if (h > uMeteor * 0.7) return vec3(0.0);                // most slots are empty
  float life = 0.09 + 0.05*hash(vec3(id, 1.3, seed));     // fraction of the slot the meteor is visible
  if (ph > life) return vec3(0.0);
  float t = ph / life;
  float az = hash(vec3(id, 7.7, seed)) * 6.2831, el = 0.35 + 0.5*hash(vec3(id, 2.2, seed));
  vec3 c = normalize(vec3(cos(az)*cos(el), sin(el), sin(az)*cos(el)));
  vec3 up = vec3(0.0,1.0,0.0);
  vec3 tx = normalize(cross(up, c)); vec3 ty = cross(c, tx);
  float ang = hash(vec3(id, 5.5, seed)) * 1.2 - 2.1;     // mostly falling (downwards)
  vec2 dir = vec2(cos(ang), sin(ang));
  float cd = dot(d, c); if (cd < 0.9) return vec3(0.0);
  vec2 q = vec2(dot(d, tx), dot(d, ty)) / cd;
  float len = 0.12 + 0.1*hash(vec3(id, 9.1, seed));
  vec2 head = dir * len * t, tail = head - dir * len * 0.45 * smoothstep(0.0, 0.3, t);
  vec2 pa = q - tail, ba = head - tail;
  float k = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float dist = length(pa - ba * k);
  float core = smoothstep(0.0022, 0.0, dist) * k * k;            // brighter towards the head
  float fade = sin(3.14159 * t);
  return vec3(0.85, 0.92, 1.0) * core * fade * 5.0 + vec3(1.0,0.8,0.5) * smoothstep(0.004,0.0,length(q-head)) * fade * 3.0;
}

void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float sunH = uSun.y;
  // gradient
  float hz = pow(1.0 - clamp(y, 0.0, 1.0), 3.5);
  vec3 col = mix(uZenith, uHorizon, hz);
  if (y < 0.0) col = mix(uHorizon, uGround, smoothstep(0.0, -0.25, y));

  // mie/sun glow
  float sd = max(dot(d, uSun), 0.0);
  col += uSunCol * (pow(sd, 6.0)*0.35 + pow(sd, 48.0)*0.6) * (1.0 - uNight*0.9);
  // horizon scatter around sun at dusk
  float dusk = smoothstep(0.35, 0.0, abs(sunH)) ;
  col += vec3(1.0,0.38,0.12) * pow(sd,2.5) * hz * dusk * 0.9;
  // twilight: the Belt of Venus (pink band) sits above the dark-blue shadow of the earth on the side
  // opposite the sun, from just before sunset until civil dusk
  vec3 sunFlat = normalize(vec3(uSun.x, 0.0, uSun.z) + 1e-5);
  float anti = max(dot(normalize(vec3(d.x, 0.0, d.z) + 1e-5), -sunFlat), 0.0);
  float twi = smoothstep(0.12, -0.02, sunH) * smoothstep(-0.2, -0.04, sunH);
  float belt = smoothstep(0.0, 0.08, y) * smoothstep(0.32, 0.1, y);
  float shadowBand = smoothstep(0.1, 0.0, y) * smoothstep(-0.02, 0.02, y);
  col = mix(col, col * vec3(0.55, 0.6, 0.85), shadowBand * anti * twi * 0.6);
  col += vec3(0.55, 0.3, 0.38) * belt * pow(anti, 1.5) * twi * 0.55;
  // after sunset the horizon under the sun keeps a thin orange->teal afterglow
  float after = smoothstep(0.02, -0.06, sunH) * smoothstep(-0.25, -0.08, sunH);
  float sdf = max(dot(normalize(vec3(d.x,0.0,d.z)+1e-5), sunFlat), 0.0);
  col += mix(vec3(0.08,0.12,0.16), vec3(0.75,0.32,0.1), smoothstep(0.1, 0.0, y)) * pow(sdf, 3.0) * smoothstep(0.35, 0.0, y) * smoothstep(-0.03, 0.01, y) * after * 0.8;
  // sun disk
  col += uSunCol * smoothstep(0.9995, 0.99975, sd) * 30.0 * smoothstep(-0.05, 0.02, sunH);

  // night
  float starVis = uNight * smoothstep(-0.05, 0.25, y);
  // a bright moon washes out faint stars (and the milky way) — strongest near full moon
  float moonWash = 1.0 - 0.45 * sin(uMoonPhase * 3.14159) * smoothstep(-0.1, 0.3, uMoon.y);
  col += stars(d) * starVis * 1.6 * moonWash;
  if (uMeteor > 0.0 && starVis > 0.01) col += (meteor(d, 0.0, 9.0, 0.0) + meteor(d, 1.0, 13.0, 0.37) + meteor(d, 2.0, 23.0, 0.71)) * starVis;
  // faint green airglow band low on the horizon on dark nights
  col += vec3(0.02, 0.05, 0.03) * smoothstep(0.0, 0.08, y) * smoothstep(0.35, 0.05, y) * uNight * moonWash * 0.6;

  // moon
  float md = dot(d, uMoon);
  float moonUp = smoothstep(-0.04, 0.03, y); // the moon (and its halo) no longer shine through the ground below the horizon
  float disk = smoothstep(0.99955, 0.9997, md) * moonUp;
  float illum = 0.5 - 0.5 * cos(uMoonPhase * 6.28318); // lit fraction
  if (disk > 0.0) {
    vec3 up = abs(uMoon.y) > 0.99 ? vec3(1.0,0.0,0.0) : vec3(0.0,1.0,0.0);
    vec3 t = normalize(cross(uMoon, up)); vec3 b = cross(t, uMoon);
    vec2 uv = vec2(dot(d,t), dot(d,b));
    vec2 q = uv / 0.0297;                          // disk-local coords, |q| <= 1 (disk radius ~ acos(0.99955))
    float r2 = clamp(dot(q, q), 0.0, 1.0);
    vec3 nrm = vec3(q, sqrt(1.0 - r2));            // sphere normal, z towards the viewer
    float pa = uMoonPhase * 6.28318;               // phase angle: light comes from the side, sweeping to the front
    vec3 L = normalize(vec3(sin(pa), 0.25 * sin(pa), -cos(pa)));
    float lit = smoothstep(-0.06, 0.08, dot(nrm, L));
    // maria: large dark basalt plains (low-frequency, high contrast) + bright ray craters (high-frequency)
    float maria = smoothstep(0.42, 0.68, fbm(q*1.6 + 3.0));
    float crater = smoothstep(0.6, 0.85, fbm(q*7.0 + 11.0));
    float limb = 0.72 + 0.28 * nrm.z;              // limb darkening
    // keep the disk in the tone-mapper's shoulder (was ~2.2 -> clipped to a flat white blob when zoomed)
    vec3 lunar = vec3(0.93,0.93,0.97) * (1.15 - maria*0.55 + crater*0.18) * limb;
    vec3 earthshine = vec3(0.05, 0.065, 0.1) * (1.0 - illum);
    col = mix(col, col * 0.2, disk * (1.0 - lit) * uNight);  // dark side hides the stars behind it
    col += (lunar * lit + earthshine) * disk * uNight;
  }
  col += vec3(0.35,0.45,0.7) * pow(max(md,0.0), 300.0) * 0.6 * uNight * illum * moonUp;
  col += vec3(0.25,0.32,0.5) * pow(max(md,0.0), 24.0) * 0.12 * uNight * illum * moonUp;

  // clouds (planar projection)
  if (y > 0.0) {
    vec2 wind = vec2(uTime*0.004, uTime*0.0015);
    vec2 cp = d.xz / (y + 0.08) * 1.2 + wind;
    float cov = 0.62 - uCloud*0.25;
    float base = fbm(cp*0.9);
    // billowy detail eats into the edges (cauliflower tops instead of smooth blobs)
    float det = vnoise(cp*6.5 - wind*8.0) * 0.5 + vnoise(cp*13.0 + 4.0) * 0.25;
    float dens = base - det * 0.12;
    float c = smoothstep(cov, cov + 0.3, dens);
    // light: density sampled a little towards the light source -> thick parts shade themselves
    vec3 Ld = uNight > 0.5 ? uMoon : uSun;
    vec2 toL = normalize(Ld.xz + 1e-4) * 0.09;
    float occ = smoothstep(cov, cov + 0.35, fbm(cp*0.9 + toL)) * 0.6 + smoothstep(cov, cov + 0.35, fbm(cp*0.9 + toL*2.2)) * 0.4;
    float shade = clamp(occ * 1.1 - c * 0.15, 0.0, 1.0);
    float thick = smoothstep(cov + 0.1, cov + 0.45, dens); // rain clouds: dark, flat bases
    vec3 cDay = mix(vec3(1.0, 0.99, 0.97), vec3(0.58,0.62,0.7), shade) * mix(1.0, 0.62, thick * uCloud);
    vec3 cDusk = mix(vec3(1.0,0.62,0.36), vec3(0.42,0.26,0.32), shade);
    float mLit = illum * smoothstep(-0.1, 0.2, uMoon.y);
    vec3 cNight = mix(vec3(0.03,0.035,0.05), vec3(0.11,0.12,0.16) * (0.3 + mLit), 1.0 - shade);
    vec3 cc = mix(cDay, cDusk, dusk);
    cc = mix(cc, cNight, uNight);
    // silver lining: thin cloud edges near the sun / moon glow
    float edge = c * (1.0 - c) * 4.0;
    cc += uSunCol * (pow(sd, 12.0) * 0.8 + pow(sd, 4.0) * edge * 0.6) * (1.0-uNight);
    cc += vec3(0.5,0.58,0.75) * pow(max(md,0.0), 40.0) * edge * mLit * uNight * 1.5;
    float fade = smoothstep(0.0, 0.25, y);
    col = mix(col, cc, c * fade * 0.93);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

export class Sky {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.uniforms = {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uMoon: { value: new THREE.Vector3(0, -1, 0) },
      uTime: { value: 0 }, uDay: { value: 1 }, uNight: { value: 0 }, uCloud: { value: 0.35 },
      uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
      uGround: { value: new THREE.Color() }, uSunCol: { value: new THREE.Color() },
      uMoonPhase: { value: 0.5 }, uMeteor: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, uniforms: this.uniforms,
      side: THREE.BackSide, depthWrite: false, depthTest: true,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    scene.add(this.mesh);

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.camera.near = 1; s.camera.far = 400;
    s.bias = -0.0004; s.normalBias = 0.04;
    this.shadowExtent = 55;
    this.setShadowExtent(55);
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3a3020, 0.6);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xaabbcc, 0.0035);

    // IBL env from a low-res copy of sky
    this.envScene = new THREE.Scene();
    this.envMesh = new THREE.Mesh(this.mesh.geometry, mat);
    this.envScene.add(this.envMesh);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.envTimer = 999;
    this.sunDir = new THREE.Vector3();
    this.info = { night: 0, dusk: 0, sunH: 1, moonPhase: 0.5, moonIllum: 1 };
    // moon phase: advances by one lunar cycle every LUNAR_DAYS in-game days. The day count is tracked here from
    // the hours wrap-around (so no extra wiring is needed); setDay(day) can pin it to the save's day counter.
    this.LUNAR_DAYS = 8;
    this.dayCount = 0; this._lastHours = null;
  }

  setDay(day) { if (Number.isFinite(day)) this.dayCount = day; }

  setShadowMapSize(size) {
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  setShadowExtent(e) {
    const c = this.sun.shadow.camera;
    c.left = -e; c.right = e; c.top = e; c.bottom = -e;
    c.updateProjectionMatrix();
  }

  // hours: 0..24
  update(hours, dt, focus) {
    const K = this._k || (this._k = {
      sun: new THREE.Vector3(), moon: new THREE.Vector3(), zero: new THREE.Vector3(),
      zDay: new THREE.Color(0.18, 0.38, 0.78), hDay: new THREE.Color(0.66, 0.78, 0.92),
      zDusk: new THREE.Color(0.16, 0.2, 0.42), hDusk: new THREE.Color(1.0, 0.52, 0.28),
      zNight: new THREE.Color(0.006, 0.011, 0.03), hNight: new THREE.Color(0.028, 0.045, 0.085),
      sunDusk: new THREE.Color(1.0, 0.5, 0.2), hemiTint: new THREE.Color(0.6, 0.7, 0.85),
      groundNight: new THREE.Color(0.018, 0.022, 0.035), fogNight: new THREE.Color(0.016, 0.024, 0.04),
    });
    this.uniforms.uTime.value += dt;
    if (this._lastHours !== null && hours < this._lastHours - 12) this.dayCount++;
    else if (this._lastHours !== null && hours > this._lastHours + 12) this.dayCount = Math.max(0, this.dayCount - 1);
    this._lastHours = hours;
    // start (day 1, the first night) near a waxing gibbous moon, reach full moon on the 2nd night
    const phase = (((this.dayCount + hours / 24) / this.LUNAR_DAYS + 0.36) % 1 + 1) % 1;
    const illum = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
    this.uniforms.uMoonPhase.value = phase;
    this.info.moonPhase = phase; this.info.moonIllum = illum;
    const t = (hours / 24) * Math.PI * 2;
    // sun path: rises east (+x), sets west, tilted south
    const el = Math.sin(t - Math.PI / 2); // -1 at 0h, 1 at 12h
    const az = t - Math.PI / 2;
    const sun = K.sun.set(Math.cos(az) * -1, el * 0.92 + 0.02, Math.sin(az) * 0.45 - 0.35).normalize();
    const moon = K.moon.set(-sun.x * 0.9 + 0.2, -sun.y * 0.85 + 0.15, -sun.z + 0.3).normalize();
    this.uniforms.uSun.value.copy(sun);
    this.uniforms.uMoon.value.copy(moon);
    const sunH = sun.y;
    const night = smoothstep(0.05, -0.18, sunH);
    const dusk = smoothstep(0.38, 0.0, Math.abs(sunH + 0.02)) * (1 - night * 0.6);
    this.info.night = night; this.info.dusk = dusk; this.info.sunH = sunH;
    this.uniforms.uNight.value = night;
    // shooting stars on clear nights only (clouds uniform is raised by the rain)
    this.uniforms.uMeteor.value = night * smoothstep(0.6, 0.4, this.uniforms.uCloud.value);

    const { zDay, hDay, zDusk, hDusk, zNight, hNight } = K;
    const Z = this.uniforms.uZenith.value.copy(zDay).lerp(zDusk, dusk).lerp(zNight, night);
    const H = this.uniforms.uHorizon.value.copy(hDay).lerp(hDusk, dusk).lerp(hNight, night);
    this.uniforms.uGround.value.copy(H).multiplyScalar(0.35);
    const sunCol = this.uniforms.uSunCol.value.setRGB(1.0, 0.95, 0.86).lerp(K.sunDusk, dusk);

    // lights: sun by day, moon by night
    const useMoon = sunH < -0.04;
    const ldir = useMoon ? moon : sun;
    const f = focus || K.zero;
    // snap shadow camera to texel grid to avoid shimmering
    const e = this.shadowExtent, texel = (2 * e) / this.sun.shadow.mapSize.x;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.target.position.set(fx, f.y, fz);
    this.sun.position.set(fx + ldir.x * 180, f.y + ldir.y * 180, fz + ldir.z * 180);
    this.sunDir.copy(ldir);
    if (useMoon) {
      this.sun.color.setRGB(0.55, 0.66, 1.0);
      // fade in from 0 right after the switch (it jumped 0.04 -> 0.39 in one frame at dusk / dawn)
      // moonlight follows the lunar phase (a new moon night is really dark: only starlight + hemi)
      this.sun.intensity = 0.42 * (0.12 + 0.88 * illum) * smoothstep(-0.02, 0.25, moon.y) * smoothstep(-0.04, -0.16, sunH);
    } else {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 3.6 * smoothstep(-0.04, 0.18, sunH);
    }
    this.hemi.color.copy(Z).lerp(K.hemiTint, 0.35);
    this.hemi.groundColor.setRGB(0.16, 0.13, 0.08).lerp(K.groundNight, night);
    this.hemi.intensity = lerp(0.9, 0.26, night) + dusk * 0.15;

    const fogC = this.scene.fog.color.copy(H).lerp(Z, 0.15);
    fogC.lerp(K.fogNight, night * 0.6);
    this.scene.fog.density = lerp(0.0026, 0.0048, night) + dusk * 0.001;

    // refresh env map periodically
    this.envTimer += dt;
    if (this.envTimer > 1.5) {
      this.envTimer = 0;
      const old = this.envRT;
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 100);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = lerp(1.0, 0.25, night);
      old?.dispose();
    }
    return { sun, moon, night, dusk, sunH };
  }
}
