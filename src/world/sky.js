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
  // sun disk
  col += uSunCol * smoothstep(0.9995, 0.99975, sd) * 30.0 * smoothstep(-0.05, 0.02, sunH);

  // night
  float starVis = uNight * smoothstep(-0.05, 0.25, y);
  col += stars(d) * starVis * 1.6;

  // moon
  float md = dot(d, uMoon);
  float disk = smoothstep(0.99955, 0.9997, md);
  if (disk > 0.0) {
    vec3 t = normalize(cross(uMoon, vec3(0,1,0))); vec3 b = cross(t, uMoon);
    vec2 uv = vec2(dot(d,t), dot(d,b)) * 60.0;
    float maria = fbm(uv*1.4+3.0);
    col += vec3(0.95,0.95,1.0) * disk * (2.2 - maria*1.4) * uNight;
  }
  col += vec3(0.35,0.45,0.7) * pow(max(md,0.0), 300.0) * 0.6 * uNight;
  col += vec3(0.25,0.32,0.5) * pow(max(md,0.0), 24.0) * 0.12 * uNight;

  // clouds (planar projection)
  if (y > 0.0) {
    vec2 cp = d.xz / (y + 0.08) * 1.2 + vec2(uTime*0.004, uTime*0.0015);
    float c = fbm(cp*0.9);
    c = smoothstep(0.62 - uCloud*0.25, 0.92, c);
    float shade = fbm(cp*0.9 + uSun.xz*0.05);
    vec3 cDay = mix(vec3(1.0), vec3(0.62,0.66,0.72), smoothstep(0.4,0.9,shade));
    vec3 cDusk = mix(vec3(1.0,0.6,0.35), vec3(0.45,0.28,0.32), shade);
    vec3 cNight = vec3(0.05,0.06,0.09);
    vec3 cc = mix(cDay, cDusk, dusk);
    cc = mix(cc, cNight, uNight);
    cc += uSunCol * pow(sd, 12.0) * 0.8 * (1.0-uNight);
    float fade = smoothstep(0.0, 0.25, y);
    col = mix(col, cc, c * fade * 0.9);
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
    this.info = { night: 0, dusk: 0, sunH: 1 };
  }

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
    this.uniforms.uTime.value += dt;
    const t = (hours / 24) * Math.PI * 2;
    // sun path: rises east (+x), sets west, tilted south
    const el = Math.sin(t - Math.PI / 2); // -1 at 0h, 1 at 12h
    const az = t - Math.PI / 2;
    const sun = new THREE.Vector3(Math.cos(az) * -1, el * 0.92 + 0.02, Math.sin(az) * 0.45 - 0.35).normalize();
    const moon = new THREE.Vector3(-sun.x * 0.9 + 0.2, -sun.y * 0.85 + 0.15, -sun.z + 0.3).normalize();
    this.uniforms.uSun.value.copy(sun);
    this.uniforms.uMoon.value.copy(moon);
    const sunH = sun.y;
    const night = smoothstep(0.05, -0.18, sunH);
    const dusk = smoothstep(0.38, 0.0, Math.abs(sunH + 0.02)) * (1 - night * 0.6);
    this.info.night = night; this.info.dusk = dusk; this.info.sunH = sunH;
    this.uniforms.uNight.value = night;

    const zDay = new THREE.Color(0.18, 0.38, 0.78), hDay = new THREE.Color(0.66, 0.78, 0.92);
    const zDusk = new THREE.Color(0.16, 0.2, 0.42), hDusk = new THREE.Color(1.0, 0.52, 0.28);
    const zNight = new THREE.Color(0.004, 0.008, 0.022), hNight = new THREE.Color(0.02, 0.035, 0.07);
    const Z = this.uniforms.uZenith.value.copy(zDay).lerp(zDusk, dusk).lerp(zNight, night);
    const H = this.uniforms.uHorizon.value.copy(hDay).lerp(hDusk, dusk).lerp(hNight, night);
    this.uniforms.uGround.value.copy(H).multiplyScalar(0.35);
    const sunCol = this.uniforms.uSunCol.value.setRGB(1.0, 0.95, 0.86).lerp(new THREE.Color(1.0, 0.5, 0.2), dusk);

    // lights: sun by day, moon by night
    const useMoon = sunH < -0.04;
    const ldir = useMoon ? moon : sun;
    const f = focus || new THREE.Vector3();
    // snap shadow camera to texel grid to avoid shimmering
    const e = this.shadowExtent, texel = (2 * e) / this.sun.shadow.mapSize.x;
    const fx = Math.round(f.x / texel) * texel, fz = Math.round(f.z / texel) * texel;
    this.sun.target.position.set(fx, f.y, fz);
    this.sun.position.set(fx + ldir.x * 180, f.y + ldir.y * 180, fz + ldir.z * 180);
    this.sunDir.copy(ldir);
    if (useMoon) {
      this.sun.color.setRGB(0.55, 0.66, 1.0);
      this.sun.intensity = 0.32 * smoothstep(-0.02, 0.25, moon.y);
    } else {
      this.sun.color.copy(sunCol);
      this.sun.intensity = 3.6 * smoothstep(-0.04, 0.18, sunH);
    }
    this.hemi.color.copy(Z).lerp(new THREE.Color(0.6, 0.7, 0.85), 0.35);
    this.hemi.groundColor.setRGB(0.16, 0.13, 0.08).lerp(new THREE.Color(0.01, 0.012, 0.02), night);
    this.hemi.intensity = lerp(0.9, 0.18, night) + dusk * 0.15;

    const fogC = this.scene.fog.color.copy(H).lerp(Z, 0.15);
    fogC.lerp(new THREE.Color(0.012, 0.018, 0.03), night * 0.6);
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
