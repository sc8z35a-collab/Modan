// Lake water: planar reflections, depth-based absorption, fresnel, sun glints, shore foam, ripples.
import * as THREE from 'three';
import { WORLD } from './heightfield.js';
import { WORLD_DATA_GLSL } from './terrain.js';

function makeWaterNormals(res = 512) {
  // tileable normal map from sum of integer-frequency waves
  const d = new Uint8Array(res * res * 4);
  const waves = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 48; i++) {
    const kx = Math.round((rnd() - 0.5) * (6 + i * 1.2)), ky = Math.round((rnd() - 0.5) * (6 + i * 1.2));
    if (!kx && !ky) continue;
    waves.push([kx, ky, rnd() * Math.PI * 2, 1 / Math.pow(Math.hypot(kx, ky), 1.25)]);
  }
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const u = (i / res) * Math.PI * 2, v = (j / res) * Math.PI * 2;
    let dx = 0, dy = 0;
    for (const [kx, ky, p, a] of waves) {
      const c = Math.cos(kx * u + ky * v + p) * a;
      dx += c * kx; dy += c * ky;
    }
    const s = 0.09;
    let nx = -dx * s, ny = -dy * s, nz = 1;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const k = (j * res + i) * 4;
    d[k] = (nx * 0.5 + 0.5) * 255; d[k + 1] = (ny * 0.5 + 0.5) * 255; d[k + 2] = (nz * 0.5 + 0.5) * 255; d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, res, res);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export class Water {
  constructor(renderer, scene, camera, worldData, qualityScale = 0.6) {
    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.normals = makeWaterNormals();
    this.normals.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.rtScale = qualityScale;
    this.rt = new THREE.WebGLRenderTarget(512, 512, { type: THREE.HalfFloatType, samples: 4 });
    this.mirrorCam = new THREE.PerspectiveCamera();
    this.ripples = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0));
    this.rippleIdx = 0;
    // scratch objects for renderReflection (avoid per-frame allocations / GC hitches)
    this._t = new THREE.Vector3(); this._look = new THREE.Vector3();
    this._plane = new THREE.Plane(); this._cp = new THREE.Vector4(); this._q = new THREE.Vector4();
    this._up = new THREE.Vector3(0, 1, 0);
    // bounds of the actual lake (lakeDist shape: radius up to ~1.4r in x, /1.25 in z) for reflection culling
    const L0 = WORLD.lake, rx = L0.r * 1.45, rz = rx / 1.25;
    this._lakeBox = new THREE.Box3(new THREE.Vector3(L0.x - rx, WORLD.waterLevel - 0.5, L0.z - rz), new THREE.Vector3(L0.x + rx, WORLD.waterLevel + 0.5, L0.z + rz));
    this._frustum = new THREE.Frustum(); this._pv = new THREE.Matrix4();

    this.uniforms = {
      uTime: { value: 0 },
      tReflect: { value: this.rt.texture },
      tNormal: { value: this.normals },
      uTexMatrix: { value: new THREE.Matrix4() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color(1, 1, 1) },
      uShallow: { value: new THREE.Color(0.11, 0.15, 0.09) },
      uDeep: { value: new THREE.Color(0.008, 0.026, 0.03) },
      uFogCol: { value: new THREE.Color() }, uFogDensity: { value: 0.003 },
      uNight: { value: 0 },
      uWorld: { value: worldData.tex }, uWorldRes: { value: worldData.res }, uWorldSize: { value: worldData.size },
      uRipples: { value: this.ripples },
      uFireCol: { value: new THREE.Color(0, 0, 0) }, uFirePos: { value: new THREE.Vector3() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      vertexShader: /* glsl */`
        uniform mat4 uTexMatrix; varying vec4 vRUV; varying vec3 vW; varying float vFog;
        void main(){
          vec4 w = modelMatrix * vec4(position,1.0);
          vW = w.xyz;
          vRUV = uTexMatrix * w;
          vec4 mv = viewMatrix * w;
          vFog = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        ${WORLD_DATA_GLSL}
        uniform float uTime; uniform sampler2D tReflect, tNormal;
        uniform vec3 uSunDir, uSunCol, uShallow, uDeep, uFogCol, uFirePos; uniform vec3 uFireCol;
        uniform float uFogDensity, uNight; uniform vec4 uRipples[8];
        varying vec4 vRUV; varying vec3 vW; varying float vFog;
        void main(){
          float ground = worldData(vW.xz).r;
          float depth = max(vW.y - ground, 0.0);
          vec2 p = vW.xz;
          vec3 n1 = texture2D(tNormal, p*0.045 + vec2(uTime*0.012, uTime*0.006)).xzy*2.0-1.0;
          vec3 n2 = texture2D(tNormal, p*0.11 + vec2(-uTime*0.018, uTime*0.021)).xzy*2.0-1.0;
          vec3 n3 = texture2D(tNormal, p*0.37 + vec2(uTime*0.03, -uTime*0.025)).xzy*2.0-1.0;
          vec3 n = normalize(n1 + n2*0.7 + n3*0.35 + vec3(0.0, 2.2, 0.0));
          // ripples
          for(int i=0;i<8;i++){
            vec4 r = uRipples[i];
            float age = uTime - r.z;
            if(age < 0.0 || age > 3.5) continue;
            vec2 dv = p - r.xy; float d = length(dv);
            float front = age * 1.6;
            float ring = sin((d - front) * 9.0) * exp(-abs(d-front)*3.0) * exp(-age*1.1) * r.w;
            n.xz += normalize(dv+1e-4) * ring * 0.6;
          }
          n = normalize(n);
          vec3 V = normalize(cameraPosition - vW);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          vec2 ruv = vRUV.xy / vRUV.w + n.xz * 0.045;
          vec3 refl = texture2D(tReflect, ruv).rgb;
          // absorption
          float a = 1.0 - exp(-depth * 0.8);
          vec3 body = mix(uShallow, uDeep, a) * (1.0 - uNight*0.9);
          // subsurface-ish scatter
          body += vec3(0.03,0.045,0.02) * max(uSunDir.y,0.0) * (1.0 - a);
          // pebbly lakebed visible through clear shallows
          body *= mix(0.75, 1.15, texture2D(tNormal, p*0.9 + n.xz*0.05).g) * (1.0 - a) + a;
          // reflections of a forest shore are slightly darker than the sky they mirror
          vec3 col = mix(body, refl * 0.92, clamp(fres * 1.15 + 0.04, 0.0, 1.0));
          // sun specular
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(n, H), 0.0), 720.0) * 60.0 + pow(max(dot(n, H), 0.0), 90.0) * 0.6;
          col += uSunCol * spec * smoothstep(-0.02, 0.1, uSunDir.y + 0.1);
          // fire glints on water at night
          vec3 L2 = normalize(uFirePos - vW); vec3 H2 = normalize(L2 + V);
          col += uFireCol * pow(max(dot(n,H2),0.0), 200.0) * 4.0 / (1.0 + length(uFirePos - vW)*0.05);
          // shore foam
          float foamN = texture2D(tNormal, p*0.6 + uTime*0.02).r;
          float foam = smoothstep(0.35, 0.0, depth) * smoothstep(0.35, 0.75, foamN + 0.25*sin(uTime*1.3 + depth*20.0));
          col = mix(col, vec3(0.85,0.9,0.9)*(1.0-uNight*0.85), foam*0.55);
          float alpha = smoothstep(0.0, 0.22, depth);
          alpha = clamp(max(alpha*0.92, fres) , 0.0, 1.0);
          // fog
          float fogF = 1.0 - exp(-uFogDensity*uFogDensity*vFog*vFog);
          col = mix(col, uFogCol, fogF);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const L = WORLD.lake;
    const geo = new THREE.PlaneGeometry(L.r * 3.4, L.r * 3.4, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.set(L.x, WORLD.waterLevel, L.z);
    this.mesh.renderOrder = 10;
    this.mesh.name = 'water';
    scene.add(this.mesh);
  }

  addRipple(x, z, strength = 1) {
    const r = this.ripples[this.rippleIdx];
    this.rippleIdx = (this.rippleIdx + 1) % this.ripples.length;
    r.set(x, z, this.uniforms.uTime.value, strength);
  }

  resize(w, h) {
    // keep aspect ratio of the screen (clamping each axis separately to 256 distorted reflections on tiny windows)
    const k = Math.max(1, 256 / Math.max(1, Math.min(w, h) * this.rtScale));
    this.rt.setSize(Math.max(1, (w * this.rtScale * k) | 0), Math.max(1, (h * this.rtScale * k) | 0));
  }

  update(dt, sky, fire) {
    const u = this.uniforms;
    u.uTime.value += dt;
    u.uSunDir.value.copy(sky.sunDir);
    u.uSunCol.value.copy(sky.sun.color).multiplyScalar(Math.min(sky.sun.intensity, 3.5) / 3.5 * (sky.info.night > 0.5 ? 0.35 : 1));
    u.uFogCol.value.copy(this.scene.fog.color);
    u.uFogDensity.value = this.scene.fog.density;
    u.uNight.value = sky.info.night;
    if (fire) { u.uFirePos.value.copy(fire.position); u.uFireCol.value.copy(fire.glintColor); }
  }

  // render mirrored scene into reflection RT (call before main render)
  renderReflection(hide = []) {
    const cam = this.camera, m = this.mirrorCam, r = this.renderer;
    const wl = WORLD.waterLevel;
    if (cam.position.y < wl) return;
    // the mirrored scene (trees, terrain, props, shadows off) was rendered every frame even when the lake was
    // completely off-screen (e.g. facing the forest at camp): skip it when the lake is outside the frustum
    cam.updateMatrixWorld();
    this._pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (!this._frustum.setFromProjectionMatrix(this._pv).intersectsBox(this._lakeBox)) return;
    // NOTE: non-recursive copy. Object3D.copy() is recursive by default, which cloned the camera's children
    // (the first-person viewmodel: rod, axe, skewers...) into the mirror camera EVERY frame -> unbounded leak.
    m.copy(cam, false);
    cam.updateMatrixWorld();
    m.position.setFromMatrixPosition(cam.matrixWorld);
    m.position.y = 2 * wl - m.position.y;
    const t = this._t; cam.getWorldDirection(t); t.y *= -1;
    m.up.copy(this._up);
    m.lookAt(this._look.copy(m.position).add(t));
    m.updateMatrixWorld(); m.projectionMatrix.copy(cam.projectionMatrix);
    // oblique clip plane
    const plane = this._plane.set(this._up, -wl + 0.05);
    plane.applyMatrix4(m.matrixWorldInverse);
    const cp = this._cp.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = m.projectionMatrix, q = this._q;
    q.x = (Math.sign(cp.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(cp.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1; q.w = (1 + pm.elements[10]) / pm.elements[14];
    cp.multiplyScalar(2 / cp.dot(q));
    pm.elements[2] = cp.x; pm.elements[6] = cp.y; pm.elements[10] = cp.z + 1; pm.elements[14] = cp.w;
    m.projectionMatrixInverse.copy(pm).invert();
    // texture matrix
    this.uniforms.uTexMatrix.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(pm).multiply(m.matrixWorldInverse);

    this.mesh.visible = false;
    const vis = hide.map((o) => { const v = o.visible; o.visible = false; return v; });
    const shadowAuto = r.shadowMap.autoUpdate; r.shadowMap.autoUpdate = false;
    const prevTM = r.toneMapping; r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(this.scene, m);
    r.setRenderTarget(null);
    r.toneMapping = prevTM;
    r.shadowMap.autoUpdate = shadowAuto;
    hide.forEach((o, i) => (o.visible = vis[i]));
    this.mesh.visible = true;
  }
}
