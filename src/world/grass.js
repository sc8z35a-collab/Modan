// GPU grass: hundreds of thousands of instanced blades, toroidally wrapped around the camera,
// height/density from baked world data, wind gusts, player interaction, distance fade, PBR lit + shadows.
import * as THREE from 'three';
import { WORLD_DATA_GLSL } from './terrain.js';

export class Grass {
  constructor(scene, worldData, noiseTex, density = 1) {
    this.scene = scene;
    this.uniforms = {
      uTime: { value: 0 },
      uCam: { value: new THREE.Vector3() },
      uPlayer: { value: new THREE.Vector3() },
      uWorld: { value: worldData.tex }, uWorldRes: { value: worldData.res }, uWorldSize: { value: worldData.size },
      tNoise: { value: noiseTex },
      uWind: { value: new THREE.Vector2(0.8, 0.35) },
      uNight: { value: 0 },
    };
    this.baseDensity = Math.max(1e-3, density);
    this.layers = [];
    // near dense layer + mid layer
    this.layers.push(this.makeLayer(Math.round(260000 * density), 44, 1.0, 5));
    this.layers.push(this.makeLayer(Math.round(140000 * density), 120, 1.25, 3));
  }

  makeLayer(count, size, scale, segs) {
    // blade: tapered strip, segs segments
    const pos = [], uv = [], idx = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, w = 0.5 * (1 - t * t * 0.92);
      pos.push(-w, t, 0, w, t, 0);
      uv.push(0, t, 1, t);
      if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
    geo.setIndex(idx);
    const off = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      off[i * 4] = Math.random() * size; off[i * 4 + 1] = Math.random() * size;
      off[i * 4 + 2] = Math.random(); off[i * 4 + 3] = Math.random();
    }
    geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 4));
    geo.instanceCount = count;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

    const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
    mat.name = 'grass';
    const U = this.uniforms;
    const layerU = { uSize: { value: size }, uScale: { value: scale } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U, layerU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          ${WORLD_DATA_GLSL}
          attribute vec4 aOff; uniform float uSize, uScale, uTime; uniform vec3 uCam, uPlayer; uniform vec2 uWind;
          uniform sampler2D tNoise;
          varying float vT; varying vec3 vTint; varying float vAO; varying vec3 vWP;
          mat2 rot(float a){ float c=cos(a), s=sin(a); return mat2(c,-s,s,c); }
        `)
        .replace('#include <beginnormal_vertex>', `
          // compute world placement first so normal can use it
          vec2 local = aOff.xy;
          vec2 base = local + floor((uCam.xz - local) / uSize + 0.5) * uSize;
          vec4 wd = worldData(base);
          float dist = length(base - uCam.xz);
          float fade = 1.0 - smoothstep(uSize*0.32, uSize*0.5, dist);
          float dens = wd.g;
          float keep = step(aOff.z, dens) * fade;
          float nz = texture2D(tNoise, base*0.02).r;
          // shorter on average with more patch variation (grazed/trampled lawns next to tall tussocks): the old 0.28-1.2m
          // everywhere hid every flower and pebble at eye level
          float tuss = smoothstep(0.35, 0.75, texture2D(tNoise, base*0.045 + 7.0).g);
          float hgt = (0.16 + aOff.w*0.36 + nz*0.3 + tuss*0.35) * uScale * mix(1.0, 0.5, wd.b) * keep;
          float ang = aOff.z * 43.7;
          vec3 objectNormal = vec3(sin(ang), 0.0, cos(ang));
        `)
        .replace('#include <begin_vertex>', `
          float t = position.y; vT = t;
          float width = 0.055 * uScale * (0.7 + aOff.w*0.6) * mix(1.0, 1.6, smoothstep(10.0, 40.0, dist));
          vec3 p = vec3(position.x * width, 0.0, 0.0);
          p.xz = rot(ang) * p.xz;
          // curvature + wind
          float gust = texture2D(tNoise, base*0.012 - uWind*uTime*0.035).r;
          float sway = sin(uTime*2.2 + base.x*0.35 + base.y*0.27 + aOff.w*6.0)*0.12 + (gust-0.35)*1.25;
          vec2 bend = (uWind / max(length(uWind), 1e-4)) * sway + vec2(cos(ang*1.3), sin(ang*1.3)) * 0.25;
          // player push
          vec2 dp = base - uPlayer.xz; float pd = length(dp);
          bend += normalize(dp + 1e-4) * smoothstep(1.1, 0.0, pd) * 1.4;
          float lean = t * t;
          p.xz += bend * lean * hgt;
          p.y = t * hgt * (1.0 - 0.3*length(bend)*lean);
          vec3 transformed = vec3(base.x, wd.r - 0.02, base.y) + p;
          vWP = transformed;
          // colors: dry tips / lush base, patch variation
          vec3 lush = vec3(0.10, 0.20, 0.035), dry = vec3(0.42, 0.40, 0.14), fresh = vec3(0.20, 0.34, 0.06);
          float patchv = texture2D(tNoise, base*0.004).r;
          vTint = mix(mix(lush, fresh, aOff.w), dry, smoothstep(0.45, 0.8, patchv) * 0.8 + wd.b*0.3);
          vTint = mix(vTint, vTint*1.35 + vec3(0.03,0.03,0.0), t*t);
          vAO = mix(0.35, 1.0, t);
        `)
        .replace('#include <defaultnormal_vertex>', `
          vec3 nrm = normalize(mix(objectNormal, vec3(0.0,1.0,0.0), 0.55));
          vec3 transformedNormal = normalMatrix * nrm;
        `)
        .replace('#include <project_vertex>', `
          vec4 mvPosition = viewMatrix * vec4(transformed, 1.0);
          gl_Position = projectionMatrix * mvPosition;
        `)
        .replace('#include <worldpos_vertex>', `vec4 worldPosition = vec4(transformed, 1.0);`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying float vT; varying vec3 vTint; varying float vAO; varying vec3 vWP; uniform float uNight;`)
        .replace('#include <map_fragment>', `diffuseColor.rgb = vTint;`)
        .replace('#include <aomap_fragment>', `
          reflectedLight.indirectDiffuse *= vAO; reflectedLight.directDiffuse *= mix(0.55, 1.0, vAO);
          // translucency toward light
          #if NUM_DIR_LIGHTS > 0
            vec3 Ld = directionalLights[0].direction;
            float tr = pow(max(dot(normalize(vViewPosition), -Ld), 0.0), 3.0);
            reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[0].color * tr * 0.55 * vT;
          #endif
        `);
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    mesh.name = 'grass';
    this.scene.add(mesh);
    return mesh;
  }

  update(dt, camPos, playerPos, night, wind) {
    const u = this.uniforms;
    if (wind) u.uWind.value.copy(wind); // grass used a constant wind and ignored the world's gusts
    u.uTime.value += dt;
    u.uCam.value.copy(camPos);
    u.uPlayer.value.copy(playerPos);
    u.uNight.value = night;
  }

  // d is absolute (same scale as the constructor). Buffers were sized for baseDensity, so scale relative to it
  // (previously switching medium->high gave 0.45*0.7 = 0.315 density, i.e. LESS grass on a higher setting)
  setDensity(d) {
    const k = Math.min(1, d / this.baseDensity);
    for (const l of this.layers) l.geometry.instanceCount = Math.round(l.geometry.attributes.aOff.count * k);
  }
}
