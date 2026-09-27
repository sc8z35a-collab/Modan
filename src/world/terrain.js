// High-resolution terrain with splat-blended PBR layers, anti-tiling, macro variation and wet shoreline.
// Also bakes a heightmap/data texture used by grass, water and other GPU systems.
import * as THREE from 'three';
import { WORLD, heightAt, lakeDist } from './heightfield.js';
import { createNoise2D, fbm, smoothstep, clamp } from '../core/noise.js';

const nMask = createNoise2D(WORLD.seed + 404);

// ---------- ground coverage (used by terrain splat + grass density + placement)
export function coverageAt(x, z, h, slope) {
  const ld = lakeDist(x, z);
  const C = WORLD.camp;
  const cd = Math.hypot(x - C.x, z - C.z);
  let sand = smoothstep(7, 0.5, ld) * smoothstep(2.6, 0.4, h);
  let rock = smoothstep(0.18, 0.42, slope) + smoothstep(55, 90, h) * 0.8;
  const m = fbm(nMask, x * 0.012, z * 0.012, 4);
  let forest = smoothstep(-0.12, 0.25, m) * (1 - sand);
  let grass = 1 - forest;
  // camp: worn dirt/grass mix around the fire circle + path to lake
  const campDirt = smoothstep(7.5, 2.5, cd);
  const path = pathMask(x, z);
  forest = Math.max(forest, campDirt * 0.9, path * 0.85);
  grass *= 1 - Math.max(campDirt * 0.8, path * 0.8);
  rock = clamp(rock, 0, 1);
  const k = 1 - rock;
  grass *= k * (1 - sand); forest *= k * (1 - sand); sand *= k;
  const s = grass + forest + rock + sand + 1e-5;
  return [grass / s, forest / s, rock / s, sand / s];
}

// winding footpath from camp down to the dock
// last point extends down to the shoreline so the path actually meets the dock
export const PATH_PTS = [[6, 12], [2, 2], [-4, -8], [-6, -14], [-6.6, -19.2]];
export function pathMask(x, z) {
  let d = 1e9;
  for (let i = 0; i < PATH_PTS.length - 1; i++) {
    const [ax, az] = PATH_PTS[i], [bx, bz] = PATH_PTS[i + 1];
    const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
    const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
    d = Math.min(d, Math.hypot(wx - vx * t, wz - vz * t));
  }
  const wob = fbm(nMask, x * 0.3, z * 0.3, 2) * 0.4;
  return smoothstep(1.5 + wob, 0.5, d);
}

// ---------- baked data texture (height + grass density), float, sampled manually (nearest) on GPU
export function bakeWorldData(res = 512) {
  const size = WORLD.size;
  const data = new Float32Array(res * res * 4);
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const x = (i / (res - 1) - 0.5) * size;
      const z = (j / (res - 1) - 0.5) * size;
      const h = heightAt(x, z);
      const e = 0.8;
      const hx = heightAt(x + e, z) - heightAt(x - e, z), hz = heightAt(x, z + e) - heightAt(x, z - e);
      const ny = 2 * e / Math.hypot(hx, 2 * e, hz);
      const slope = 1 - ny;
      const [g, f, r, s] = coverageAt(x, z, h, slope);
      const k = (j * res + i) * 4;
      data[k] = h;
      const C = WORLD.camp, cd = Math.hypot(x - C.x, z - C.z);
      const worn = Math.max(smoothstep(9, 3, cd), pathMask(x, z));
      data[k + 1] = clamp(g + f * 0.25, 0, 1) * smoothstep(0.25, 0.9, h) * (1 - worn * 0.85); // grass density
      data[k + 2] = f;     // forest-floor amount
      data[k + 3] = s;     // sand
    }
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return { tex, res, size, data };
}

// GLSL helper shared by all GPU systems that sample the world data texture
export const WORLD_DATA_GLSL = /* glsl */`
uniform sampler2D uWorld; uniform float uWorldRes; uniform float uWorldSize;
vec4 worldData(vec2 xz){
  vec2 uv = (xz / uWorldSize + 0.5) * (uWorldRes - 1.0);
  vec2 i = floor(uv); vec2 f = uv - i;
  ivec2 ii = ivec2(clamp(i, vec2(0.0), vec2(uWorldRes-2.0)));
  vec4 a = texelFetch(uWorld, ii, 0), b = texelFetch(uWorld, ii+ivec2(1,0), 0);
  vec4 c = texelFetch(uWorld, ii+ivec2(0,1), 0), d = texelFetch(uWorld, ii+ivec2(1,1), 0);
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}`;

// ---------- noise texture for macro variation
function makeNoiseTexture(res = 256) {
  const n = createNoise2D(99);
  const d = new Uint8Array(res * res * 4);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    // tileable via 4D torus trick approximated with blend
    const u = i / res, v = j / res;
    const s = (x, y) => fbm(n, x, y, 4);
    const f = (a, b) => s(a * 6, b * 6);
    const val = f(u, v) * (1 - u) * (1 - v) + f(u - 1, v) * u * (1 - v) + f(u, v - 1) * (1 - u) * v + f(u - 1, v - 1) * u * v;
    const n2 = n(i * 0.21, j * 0.21);
    const k = (j * res + i) * 4;
    d[k] = clamp((val * 0.5 + 0.5) * 255, 0, 255);
    d[k + 1] = clamp((n2 * 0.5 + 0.5) * 255, 0, 255);
    d[k + 2] = (Math.random() * 255) | 0;
    d[k + 3] = 255;
  }
  const t = new THREE.DataTexture(d, res, res);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

function remapGrid(u) { // u in [-1,1] -> denser near center
  return 0.35 * u + 0.65 * Math.sign(u) * u * u;
}

export function buildTerrain(textures, maxAniso) {
  const seg = WORLD.segments, half = WORLD.size / 2;
  const geo = new THREE.PlaneGeometry(2, 2, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const splat = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const x = remapGrid(pos.getX(i)) * half, z = remapGrid(pos.getZ(i)) * half;
    pos.setXYZ(i, x, heightAt(x, z), z);
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
    const c = coverageAt(x, z, h, 1 - nrm.getY(i));
    splat.set(c, i * 4);
  }
  geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  geo.computeBoundingSphere();

  const layerIds = ['aerial_grass_rock', 'forest_ground_04', 'rocky_terrain_02', 'coast_sand_rocks_02'];
  for (const id of layerIds) {
    for (const k of ['diff', 'nor', 'arm']) {
      const t = textures[id][k];
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso;
    }
  }
  const noiseTex = makeNoiseTexture();

  const mat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  mat.name = 'terrain';
  const uniforms = {
    tD0: { value: textures[layerIds[0]].diff }, tN0: { value: textures[layerIds[0]].nor },
    tD1: { value: textures[layerIds[1]].diff }, tN1: { value: textures[layerIds[1]].nor },
    tD2: { value: textures[layerIds[2]].diff }, tN2: { value: textures[layerIds[2]].nor },
    tD3: { value: textures[layerIds[3]].diff }, tN3: { value: textures[layerIds[3]].nor },
    tA0: { value: textures[layerIds[0]].arm }, tA1: { value: textures[layerIds[1]].arm },
    tNoise: { value: noiseTex },
    uWet: { value: 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 splat; varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = splat; vWPos = (modelMatrix * vec4(transformed,1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec4 vSplat; varying vec3 vWPos; varying vec3 vWNrm;
        uniform sampler2D tD0,tD1,tD2,tD3,tN0,tN1,tN2,tN3,tA0,tA1,tNoise; uniform float uWet;
        vec3 gTN; float gRough; float gAO;
        // stochastic-ish anti tiling: blend two rotated/offset samples by noise
        vec4 tsample(sampler2D t, vec2 uv, float k){
          vec2 uv2 = mat2(0.8,-0.6,0.6,0.8) * uv * 0.71 + vec2(0.37, 0.61);
          return mix(texture2D(t, uv), texture2D(t, uv2), k);
        }
        vec3 unpackN(vec4 c){ return c.xyz*2.0-1.0; }
      `)
      .replace('#include <map_fragment>', `
        vec3 macro = texture2D(tNoise, vWPos.xz * 0.0045).rgb;
        float micro = texture2D(tNoise, vWPos.xz * 0.037).r;
        float k = smoothstep(0.35, 0.65, texture2D(tNoise, vWPos.xz*0.011).g);
        float camD = length(vWPos - cameraPosition);
        vec2 uvG = vec2(vWPos.x, -vWPos.z) * 0.22;
        vec2 uvF = vec2(vWPos.x, -vWPos.z) * 0.33;
        vec2 uvS = vec2(vWPos.x, -vWPos.z) * 0.28;
        // rock: biplanar by normal
        vec3 an = abs(vWNrm);
        vec2 uvR = (an.x > an.z ? vWPos.zy : vWPos.xy) * vec2(1.0, -1.0) * 0.16;
        vec2 uvRt = vec2(vWPos.x, -vWPos.z) * 0.16;
        float rt = smoothstep(0.55, 0.85, an.y);

        vec4 d0 = tsample(tD0, uvG, k), d1 = tsample(tD1, uvF, k), d3 = tsample(tD3, uvS, k);
        vec4 d2 = mix(texture2D(tD2, uvR), texture2D(tD2, uvRt), rt);
        // far: add a low-frequency sample to kill repetition
        float far = smoothstep(18.0, 90.0, camD);
        d0.rgb = mix(d0.rgb, texture2D(tD0, uvG*0.19).rgb, far*0.55);
        d1.rgb = mix(d1.rgb, texture2D(tD1, uvF*0.17).rgb, far*0.5);

        // height-based blend (use luminance as height)
        vec4 hgt = vec4(dot(d0.rgb,vec3(.33)), dot(d1.rgb,vec3(.33))+0.05, dot(d2.rgb,vec3(.33))+0.1, dot(d3.rgb,vec3(.33)));
        vec4 w = vSplat + vec4(0.0, (micro-0.5)*0.18, 0.0, 0.0);
        w = max(w, 0.0) * (hgt + 0.35);
        w = pow(w, vec4(3.0));
        w /= (w.x+w.y+w.z+w.w + 1e-5);

        vec3 alb = d0.rgb*w.x + d1.rgb*w.y + d2.rgb*w.z + d3.rgb*w.w;
        // macro color variation: dry/lush patches
        vec3 dry = vec3(1.08, 1.0, 0.82), lush = vec3(0.85, 1.02, 0.86);
        alb *= mix(lush, dry, macro.r) * (0.88 + 0.24*macro.g);
        alb = mix(alb, alb * vec3(0.92,1.02,0.9), w.x * 0.4);

        // wet shoreline
        float wet = smoothstep(0.9, 0.05, vWPos.y) * (1.0 - w.z*0.5);
        wet = max(wet, uWet*0.6);
        alb *= mix(1.0, 0.55, wet);
        diffuseColor.rgb *= alb;

        vec4 a0 = texture2D(tA0, uvG), a1 = texture2D(tA1, uvF);
        gAO = mix(1.0, a0.r, w.x) * mix(1.0, a1.r, w.y);
        gRough = a0.g*w.x + a1.g*w.y + 0.85*w.z + 0.9*w.w;
        gRough = mix(gRough, 0.18, wet*0.85);

        vec3 n0 = unpackN(tsample(tN0, uvG, k)), n1 = unpackN(tsample(tN1, uvF, k));
        vec3 n2 = unpackN(texture2D(tN2, rt > 0.5 ? uvRt : uvR)), n3 = unpackN(tsample(tN3, uvS, k));
        gTN = normalize(n0*w.x + n1*w.y + n2*w.z*1.3 + n3*w.w);
        gTN.xy *= mix(1.1, 0.5, far);
      `)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gRough;`)
      .replace('#include <normal_fragment_maps>', `
        {
          vec3 N = normalize(vWNrm);
          vec3 T = normalize(vec3(1.0,0.0,0.0) - N * N.x);
          vec3 B = cross(N, T); // points toward -z on flat ground
          vec3 nW = normalize(T * gTN.x + B * gTN.y + N * gTN.z);
          normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
        }
      `)
      .replace('#include <aomap_fragment>', `
        reflectedLight.indirectDiffuse *= gAO;
        reflectedLight.indirectSpecular *= gAO;
      `);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = 'terrain';
  return { mesh, uniforms, noiseTex };
}
