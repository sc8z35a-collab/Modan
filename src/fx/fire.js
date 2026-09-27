// Campfire: volumetric-looking flame (layered noise billboards), embers/sparks, smoke, flickering light, heat glow.
import * as THREE from 'three';

const flameVert = /* glsl */`
varying vec2 vUv; varying float vSeed;
attribute float aSeed;
void main(){
  vUv = uv; vSeed = aSeed;
  // cylindrical billboard around Y
  vec3 c = (modelMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
  vec3 toCam = cameraPosition - c; toCam.y = 0.0; toCam = normalize(toCam);
  vec3 right = normalize(cross(vec3(0.0,1.0,0.0), toCam));
  float a = aSeed * 6.2831;
  vec3 off = vec3(cos(a), 0.0, sin(a)) * 0.08 * aSeed;
  vec3 wp = c + off + right * position.x * (0.8 + aSeed*0.4) + vec3(0.0, position.y, 0.0) * (0.85 + fract(aSeed*7.0)*0.4);
  wp += toCam * (aSeed - 0.5) * 0.12;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const flameFrag = /* glsl */`
precision highp float;
varying vec2 vUv; varying float vSeed;
uniform float uTime; uniform float uIntensity;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y); }
float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.1; a*=0.5; } return s; }
void main(){
  vec2 uv = vUv; uv.x = uv.x*2.0-1.0;
  float t = uTime * (1.6 + vSeed*0.6);
  float n = fbm(vec2(uv.x*2.2 + vSeed*10.0, uv.y*2.6 - t*2.2));
  float n2 = fbm(vec2(uv.x*4.0 - vSeed*5.0, uv.y*4.5 - t*3.1));
  float shape = 1.0 - smoothstep(0.0, 1.0, abs(uv.x) / (0.9*(1.0-uv.y*0.85) + 0.05));
  float body = shape * (1.0 - uv.y) ;
  float f = body * 1.7 - (n*0.75 + n2*0.35) * (0.35 + uv.y*1.3);
  f = clamp(f * uIntensity, 0.0, 1.0);
  vec3 c1 = vec3(1.0, 0.95, 0.75) * 7.0; // core
  vec3 c2 = vec3(1.0, 0.45, 0.08) * 4.2;
  vec3 c3 = vec3(0.6, 0.08, 0.01) * 1.4;
  vec3 col = mix(c3, c2, smoothstep(0.05, 0.4, f));
  col = mix(col, c1, smoothstep(0.55, 0.95, f));
  float alpha = smoothstep(0.02, 0.25, f);
  gl_FragColor = vec4(col * alpha, alpha);
}`;

function makeSoftTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); return t;
}
function makeSmokeTexture() {
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  for (let i = 0; i < 60; i++) {
    const x = s / 2 + (Math.random() - 0.5) * s * 0.45, y = s / 2 + (Math.random() - 0.5) * s * 0.45, r = s * (0.08 + Math.random() * 0.2);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.14)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
  }
  return new THREE.CanvasTexture(c);
}

export class Campfire {
  constructor(scene, position) {
    this.scene = scene;
    this.position = position.clone();
    this.group = new THREE.Group();
    this.group.position.copy(position);
    scene.add(this.group);
    this.fuel = 0;       // 0..1 (burn time remaining)
    this.lit = false;
    this.intensity = 0;  // smoothed visual
    this.glintColor = new THREE.Color(0, 0, 0);
    this.time = 0;
    this.smoulder = 0;
    this.prU = { value: Math.min(window.devicePixelRatio || 1, 2) };
    this._wind = new THREE.Vector2(0.6, 0.3);

    // flame billboards
    const N = 7;
    const geo = new THREE.InstancedBufferGeometry();
    const plane = new THREE.PlaneGeometry(0.9, 1.5, 1, 1); plane.translate(0, 0.72, 0);
    geo.index = plane.index; geo.attributes.position = plane.attributes.position; geo.attributes.uv = plane.attributes.uv;
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(Array.from({ length: N }, (_, i) => i / N + Math.random() * 0.1)), 1));
    geo.instanceCount = N;
    this.flameU = { uTime: { value: 0 }, uIntensity: { value: 0 } };
    this.flame = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: flameVert, fragmentShader: flameFrag, uniforms: this.flameU,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.flame.frustumCulled = false; this.flame.position.y = 0.12; this.flame.renderOrder = 20;
    this.group.add(this.flame);

    // lights: main flicker + fill
    this.light = new THREE.PointLight(0xff8a3a, 0, 22, 1.6);
    this.light.position.set(0, 0.9, 0);
    this.light.castShadow = true;
    this.shadowAllowed = true;
    this.light.shadow.mapSize.set(1024, 1024);
    this.light.shadow.bias = -0.002; this.light.shadow.normalBias = 0.05;
    this.light.shadow.camera.near = 0.3; this.light.shadow.camera.far = 24;
    this.group.add(this.light);
    this.fill = new THREE.PointLight(0xff5a20, 0, 8, 2);
    this.fill.position.set(0, 0.3, 0);
    this.group.add(this.fill);

    // sparks
    this.sparkCount = 160;
    this.sparks = new Float32Array(this.sparkCount * 3);
    this.sparkVel = new Float32Array(this.sparkCount * 3);
    this.sparkLife = new Float32Array(this.sparkCount).fill(0);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparks, 3));
    sg.setAttribute('aLife', new THREE.BufferAttribute(this.sparkLife, 1));
    this.sparkMesh = new THREE.Points(sg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTex: { value: makeSoftTexture() }, uPR: this.prU },
      // point size follows the renderer pixel ratio (was baked from devicePixelRatio, wrong on medium/high quality)
      // and is clamped (points at/behind the camera produced negative or huge sizes)
      vertexShader: `attribute float aLife; uniform float uPR; varying float vL; void main(){ vL=aLife; vec4 mv = modelViewMatrix*vec4(position,1.0); gl_PointSize = clamp((6.0 + aLife*8.0) * (6.0 / max(-mv.z, 0.05)) * uPR, 0.0, 128.0); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uTex; varying float vL; void main(){ float a = texture2D(uTex, gl_PointCoord).a * smoothstep(0.0,0.3,vL); if(vL<=0.0) discard; gl_FragColor = vec4(vec3(1.0,0.55,0.15)*6.0*a, a); }`,
    }));
    this.sparkMesh.frustumCulled = false;
    this.group.add(this.sparkMesh);

    // smoke (sprites)
    this.smokeTex = makeSmokeTexture();
    this.smoke = [];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, color: 0x777777, opacity: 0 }));
      m.userData = { life: Math.random() * 6, max: 6 + Math.random() * 3, vx: 0, vz: 0, rot: Math.random() * 6 };
      m.renderOrder = 19;
      this.group.add(m); this.smoke.push(m);
    }

    // ember bed glow (emissive disk)
    this.embers = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.embers.rotation.x = -Math.PI / 2; this.embers.position.y = 0.06;
    this.group.add(this.embers);
  }

  addFuel(v) { this.fuel = Math.min(1.2, Math.max(0, this.fuel + v)); }
  ignite() { if (this.fuel > 0.05) this.lit = true; return this.lit; }
  setPixelRatio(pr) { this.prU.value = pr; }
  // resizing mapSize has no effect once the shadow map exists -> dispose it so it is recreated
  setShadowSize(s) {
    const sh = this.light.shadow;
    if (sh.mapSize.x === s) return;
    sh.mapSize.set(s, s); sh.map?.dispose(); sh.map = null;
  }

  update(dt, wind = this._wind, rain = 0) {
    this.time += dt;
    if (this.lit) {
      this.fuel -= dt * (1 / 600) * (1 + rain * 2); // ~10 min real time per full load
      if (this.fuel <= 0) { this.fuel = 0; this.lit = false; }
    }
    const target = this.lit ? Math.min(1, 0.35 + this.fuel * 0.8) : 0;
    this.intensity += (target - this.intensity) * Math.min(1, dt * 1.2);
    const I = this.intensity;
    const flick = 0.82 + 0.1 * Math.sin(this.time * 17.3) + 0.08 * Math.sin(this.time * 7.1 + 1.3) + 0.06 * Math.sin(this.time * 31.7);
    this.flameU.uTime.value = this.time;
    this.flameU.uIntensity.value = I * (0.9 + 0.1 * flick);
    this.flame.visible = I > 0.02;
    this.light.intensity = I * 32 * flick;
    this.light.position.x = Math.sin(this.time * 9.1) * 0.05;
    this.light.position.z = Math.cos(this.time * 7.7) * 0.05;
    this.fill.intensity = I * 10 * flick;
    // toggling castShadow changes the shadow-light count -> EVERY lit material recompiles (hitch whenever the
    // fire is lit / dies). Keep it constant and just stop re-rendering the cube shadow map while unlit.
    if (this.light.castShadow !== !!this.shadowAllowed) this.light.castShadow = !!this.shadowAllowed;
    this.light.shadow.autoUpdate = I > 0.05;
    this.glintColor.setRGB(1.0, 0.5, 0.15).multiplyScalar(I * flick);
    const emb = Math.max(I, this.lit ? 0 : Math.min(0.25, this.fuel) * 0.5);
    this.embers.material.color.setRGB(1.0 * emb * 2.2, 0.28 * emb * 2.2, 0.04 * emb);

    // sparks
    const sp = this.sparks, v = this.sparkVel, L = this.sparkLife;
    for (let i = 0; i < this.sparkCount; i++) {
      if (L[i] <= 0) {
        if (I > 0.2 && Math.random() < dt * 12 * I / this.sparkCount * 10) {
          L[i] = 0.8 + Math.random() * 1.6;
          sp[i * 3] = (Math.random() - 0.5) * 0.4; sp[i * 3 + 1] = 0.3; sp[i * 3 + 2] = (Math.random() - 0.5) * 0.4;
          v[i * 3] = (Math.random() - 0.5) * 0.6; v[i * 3 + 1] = 1.6 + Math.random() * 2.2; v[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
        } else { sp[i * 3 + 1] = -100; }
        continue;
      }
      L[i] -= dt;
      v[i * 3] += (Math.sin(this.time * 3 + i) * 1.2 + wind.x * 0.6) * dt;
      v[i * 3 + 2] += (Math.cos(this.time * 2.7 + i) * 1.2 + wind.y * 0.6) * dt;
      v[i * 3 + 1] *= 1 - dt * 0.6;
      sp[i * 3] += v[i * 3] * dt; sp[i * 3 + 1] += v[i * 3 + 1] * dt; sp[i * 3 + 2] += v[i * 3 + 2] * dt;
    }
    this.sparkMesh.geometry.attributes.position.needsUpdate = true;
    this.sparkMesh.geometry.attributes.aLife.needsUpdate = true;

    // smoke
    const smokeAmt = Math.max(I * 0.9, (!this.lit && this.fuel > 0 && this.intensity > 0.001) ? 0.6 : 0, this.smoulder || 0);
    for (const s of this.smoke) {
      const u = s.userData;
      u.life += dt;
      if (u.life > u.max) {
        u.life = 0; u.max = 5 + Math.random() * 4;
        s.position.set((Math.random() - 0.5) * 0.3, 1.1, (Math.random() - 0.5) * 0.3);
        u.vx = (Math.random() - 0.5) * 0.2; u.vz = (Math.random() - 0.5) * 0.2; u.a = smokeAmt;
      }
      const t = u.life / u.max;
      s.position.x += (u.vx + wind.x * 0.5 * t) * dt;
      s.position.z += (u.vz + wind.y * 0.5 * t) * dt;
      s.position.y += (0.9 - t * 0.4) * dt;
      const sc = 0.6 + t * 3.8;
      s.scale.set(sc, sc, sc);
      u.rot += dt * 0.2; s.material.rotation = u.rot;
      s.material.opacity = (u.a || 0) * Math.sin(Math.PI * Math.min(1, t * 1.2)) * 0.32;
    }
    this.smoulder = Math.max(0, this.smoulder - dt * 0.05);
  }
}

// ---------- fireflies + ambient dust motes
export class Fireflies {
  constructor(scene, center, count = 220, radius = 60) {
    this.count = count;
    const pos = new Float32Array(count * 3), seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * radius;
      pos[i * 3] = center.x + Math.cos(a) * r; pos[i * 3 + 1] = 0; pos[i * 3 + 2] = center.z + Math.sin(a) * r;
      seed[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.u = { uTime: { value: 0 }, uAmt: { value: 0 }, uTex: { value: makeSoftTexture() }, uPR: { value: Math.min(window.devicePixelRatio || 1, 2) } };
    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aSeed; uniform float uTime; uniform float uPR; varying float vA;
        void main(){ vec3 p = position;
          float t = uTime*0.35 + aSeed*40.0;
          p += vec3(sin(t*1.3)*1.6, 0.9 + sin(t*0.9)*0.6 + aSeed*1.2, cos(t*1.1)*1.6);
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          vA = pow(max(sin(uTime*(1.2+aSeed) + aSeed*30.0),0.0), 3.0);
          gl_PointSize = clamp(18.0 * (4.0 / max(-mv.z, 0.05)) * uPR, 0.0, 128.0);
          gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform sampler2D uTex; uniform float uAmt; varying float vA;
        void main(){ float a = texture2D(uTex, gl_PointCoord).a * vA * uAmt; gl_FragColor = vec4(vec3(0.75,1.0,0.3)*5.0*a, a); }`,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }
  setGround(fn) {
    const p = this.mesh.geometry.attributes.position;
    for (let i = 0; i < this.count; i++) p.setY(i, fn(p.getX(i), p.getZ(i)));
    p.needsUpdate = true;
  }
  setPixelRatio(pr) { this.u.uPR.value = pr; }
  update(dt, night) { this.u.uTime.value += dt; this.u.uAmt.value = night; this.mesh.visible = night > 0.02; }
}
