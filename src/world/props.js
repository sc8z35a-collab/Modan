// Hand-built procedural camp props with PBR materials.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { heightAt } from './heightfield.js';
import { mulberry32 } from '../core/noise.js';

function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

// ripstop nylon fabric
function fabricTextures(base = '#c2572b') {
  const map = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.08; g.strokeStyle = '#000';
    for (let i = 0; i < w; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    g.globalAlpha = 0.05;
    for (let i = 0; i < 4000; i++) { g.fillStyle = Math.random() > 0.5 ? '#fff' : '#000'; g.fillRect(Math.random() * w, Math.random() * h, 1, 1); }
    // dirt at the bottom
    const grd = g.createLinearGradient(0, h, 0, h * 0.7);
    grd.addColorStop(0, 'rgba(60,40,20,0.35)'); grd.addColorStop(1, 'rgba(60,40,20,0)');
    g.globalAlpha = 1; g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const nrm = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 8) { g.fillStyle = 'rgb(150,128,255)'; g.fillRect(i, 0, 1, h); g.fillStyle = 'rgb(128,150,255)'; g.fillRect(0, i, w, 1); }
  }, false);
  return { map, nrm };
}

export function buildTent(U) {
  const { map, nrm } = fabricTextures('#c8612f');
  const fly = fabricTextures('#2f5d4a');
  const mat = new THREE.MeshStandardMaterial({ map, normalMap: nrm, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.72, side: THREE.DoubleSide });
  const flyMat = new THREE.MeshStandardMaterial({ map: fly.map, normalMap: fly.nrm, normalScale: new THREE.Vector2(0.4, 0.4), roughness: 0.6, side: THREE.DoubleSide });
  // translucent glow when lantern is inside
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime; sh.uniforms.uGlow = U.uTentGlow;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float wv = sin(uTime*3.0 + position.x*2.0 + position.z*1.5) * 0.012 * smoothstep(0.1, 1.2, position.y) * (1.0 - smoothstep(1.1,1.35,position.y));
        transformed += normal * wv;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGlow;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0,0.7,0.35) * uGlow * 1.6;`);
  };
  const g = new THREE.Group();
  // dome tent: two crossing arcs -> build shell from a squashed hemisphere
  const shell = new THREE.SphereGeometry(1.35, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
  shell.scale(1.25, 0.95, 1.05);
  const p = shell.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // pinch along pole lines to create panels
    const a = Math.atan2(z, x);
    const pinch = 1 - 0.05 * Math.pow(Math.abs(Math.cos(a * 2)), 8) * (y / 1.3);
    p.setXYZ(i, x * pinch, y, z * pinch);
  }
  shell.computeVertexNormals();
  const body = new THREE.Mesh(shell, mat);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  // rainfly on top
  const flyG = new THREE.SphereGeometry(1.42, 48, 16, 0, Math.PI * 2, 0, Math.PI / 3.1);
  flyG.scale(1.25, 0.95, 1.05);
  const flyM = new THREE.Mesh(flyG, flyMat); flyM.castShadow = true; flyM.position.y = 0.02; g.add(flyM);
  // door (dark zipped opening)
  const door = new THREE.Mesh(new THREE.CircleGeometry(0.62, 32, 0, Math.PI), new THREE.MeshStandardMaterial({ color: 0x1a0f08, roughness: 1 }));
  door.position.set(0, 0.01, 1.14); door.scale.set(1, 1.35, 1); g.add(door);
  // poles
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.9, roughness: 0.3 });
  for (const rot of [Math.PI / 4, -Math.PI / 4]) {
    const curve = new THREE.EllipseCurve(0, 0, 1.72, 1.3, 0, Math.PI);
    const pts = curve.getPoints(40).map((v) => new THREE.Vector3(v.x, v.y, 0));
    const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.012, 6), poleMat);
    tube.rotation.y = rot; g.add(tube);
  }
  // guy lines + stakes
  const lineMat = new THREE.LineBasicMaterial({ color: 0xdddddd });
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4;
    const from = new THREE.Vector3(Math.cos(a) * 1.2, 0.9, Math.sin(a) * 1.0);
    const to = new THREE.Vector3(Math.cos(a) * 2.6, 0, Math.sin(a) * 2.3);
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), lineMat));
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.005, 0.2), poleMat); st.position.copy(to); g.add(st);
  }
  // inner light
  const light = new THREE.PointLight(0xffb060, 0, 5, 2);
  light.position.set(0, 0.6, 0);
  g.add(light);
  g.userData.light = light;
  return g;
}

export function buildFireRing(textures) {
  const g = new THREE.Group();
  const rnd = mulberry32(3);
  const stoneMat = new THREE.MeshStandardMaterial({ map: textures.rocky_terrain_02.diff, normalMap: textures.rocky_terrain_02.nor, roughness: 0.9, color: 0x9a948c });
  const soot = new THREE.MeshStandardMaterial({ color: 0x151210, roughness: 1 });
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2;
    const geo = new THREE.IcosahedronGeometry(0.2 + rnd() * 0.07, 2);
    const p = geo.attributes.position;
    for (let j = 0; j < p.count; j++) {
      const k = 0.8 + rnd() * 0.35;
      p.setXYZ(j, p.getX(j) * k, p.getY(j) * k * 0.7, p.getZ(j) * k);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, stoneMat);
    m.position.set(Math.cos(a) * 0.72, 0.08, Math.sin(a) * 0.72);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  const ash = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24), soot);
  ash.rotation.x = -Math.PI / 2; ash.position.y = 0.02; ash.receiveShadow = true; g.add(ash);
  return g;
}

// firewood logs placed in the fire (visible count depends on fuel)
export function buildFireLogs(textures) {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ map: textures.bark_brown_02.diff, normalMap: textures.bark_brown_02.nor, roughness: 0.95 });
  const charred = new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 1, emissive: 0xff3300, emissiveIntensity: 0 });
  g.userData.charred = charred;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.8, 10), i % 2 ? bark : charred);
    log.position.set(Math.cos(a) * 0.18, 0.28, Math.sin(a) * 0.18);
    log.rotation.set(0, -a, 0); log.rotateZ(0.95);
    log.castShadow = true;
    g.add(log);
  }
  return g;
}

export function buildLogSeat(textures, len = 2.2) {
  const bark = new THREE.MeshStandardMaterial({ map: textures.bark_brown_02.diff, normalMap: textures.bark_brown_02.nor, roughnessMap: textures.bark_brown_02.arm, roughness: 1 });
  const endTex = canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#b08a5a'; g.fillRect(0, 0, w, w);
    for (let r = 120; r > 4; r -= 5 + Math.random() * 4) { g.strokeStyle = `rgba(90,60,30,${0.3 + Math.random() * 0.3})`; g.lineWidth = 1.5; g.beginPath(); g.arc(128, 128, r, 0, 7); g.stroke(); }
    g.strokeStyle = '#3b2a18'; g.lineWidth = 10; g.beginPath(); g.arc(128, 128, 124, 0, 7); g.stroke();
  });
  const endMat = new THREE.MeshStandardMaterial({ map: endTex, roughness: 0.9 });
  const geo = new THREE.CylinderGeometry(0.22, 0.24, len, 20, 1);
  const m = new THREE.Mesh(geo, [bark, endMat, endMat]);
  m.rotation.z = Math.PI / 2; m.position.y = 0.2; m.castShadow = m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m);
  return g;
}

export function buildDock(textures, length = 14) {
  const g = new THREE.Group();
  const planks = textures.brown_planks_05;
  for (const k of ['diff', 'nor', 'arm']) { planks[k].wrapS = planks[k].wrapT = THREE.RepeatWrapping; }
  const mat = new THREE.MeshStandardMaterial({ map: planks.diff, normalMap: planks.nor, roughnessMap: planks.arm, roughness: 1, color: 0xb8a590 });
  const postMat = new THREE.MeshStandardMaterial({ map: textures.bark_brown_02.diff, roughness: 1, color: 0x6a5a4a });
  const rnd = mulberry32(8);
  const w = 2.0, parts = [];
  for (let i = 0; i < length / 0.22; i++) {
    const b = new THREE.BoxGeometry(w + (rnd() - 0.5) * 0.08, 0.05, 0.2);
    // per-plank uv offset
    const uv = b.attributes.uv; const o = rnd();
    for (let j = 0; j < uv.count; j++) uv.setXY(j, uv.getX(j) * 0.5 + o, uv.getY(j) * 0.1 + o * 3);
    b.rotateY((rnd() - 0.5) * 0.02);
    b.translate(0, (rnd() - 0.5) * 0.01, -i * 0.22);
    parts.push(b);
  }
  const deck = new THREE.Mesh(mergeGeometries(parts), mat);
  deck.castShadow = deck.receiveShadow = true;
  g.add(deck);
  for (let i = 0; i <= length / 2.2; i++) for (const s of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 3, 10), postMat);
    p.position.set(s * (w / 2 - 0.05), -1.3, -i * 2.2); p.castShadow = true; g.add(p);
  }
  // side beams
  for (const s of [-1, 1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, length), postMat);
    b.position.set(s * (w / 2 - 0.05), -0.1, -length / 2 + 0.1); g.add(b);
  }
  return g;
}

export function buildLantern() {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b3a2e, metalness: 0.8, roughness: 0.35 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.9, roughness: 0.05, thickness: 0.02, transparent: true, opacity: 0.35 });
  const flame = new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.2, 0.8) });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.05, 20), metal); base.position.y = 0.025;
  const glassM = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 20, 1, true), glass); glassM.position.y = 0.13;
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.06, 20), metal); top.position.y = 0.24;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.004, 6, 24, Math.PI), metal); handle.position.y = 0.27;
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), flame); f.scale.y = 1.8; f.position.y = 0.12;
  for (const m of [base, glassM, top]) m.castShadow = true;
  g.add(base, glassM, top, handle, f);
  const light = new THREE.PointLight(0xffb870, 0, 9, 2); light.position.y = 0.13;
  g.add(light);
  g.userData = { light, flame: f };
  return g;
}

export function buildChair() {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.7, roughness: 0.4 });
  const cloth = new THREE.MeshStandardMaterial({ color: 0x2e4f6e, roughness: 0.8, side: THREE.DoubleSide });
  const leg = (x1, z1, x2, z2) => {
    const a = new THREE.Vector3(x1, 0, z1), b = new THREE.Vector3(x2, 0.45, z2);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, a.distanceTo(b)), frame);
    m.position.copy(a).lerp(b, 0.5); m.lookAt(b); m.rotateX(Math.PI / 2); g.add(m);
  };
  leg(-0.25, -0.25, 0.25, 0.25); leg(0.25, -0.25, -0.25, 0.25); leg(-0.25, 0.25, 0.25, -0.25); leg(0.25, 0.25, -0.25, -0.25);
  const seat = new THREE.PlaneGeometry(0.52, 0.5, 8, 8); seat.rotateX(-Math.PI / 2);
  const p = seat.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, -0.06 * (1 - (p.getX(i) / 0.26) ** 2) * (1 - (p.getZ(i) / 0.25) ** 2));
  seat.computeVertexNormals();
  const s = new THREE.Mesh(seat, cloth); s.position.y = 0.45; s.castShadow = true; g.add(s);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.5, 4, 4), cloth); back.position.set(0, 0.72, 0.28); back.rotation.x = -0.25; back.castShadow = true; g.add(back);
  return g;
}

export function buildKettle() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, metalness: 0.85, roughness: 0.45 });
  const pts = [[0, 0], [0.1, 0], [0.12, 0.02], [0.125, 0.1], [0.1, 0.15], [0.05, 0.17], [0.03, 0.19], [0, 0.19]].map(([x, y]) => new THREE.Vector2(x, y));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, 32), m); body.castShadow = true; g.add(body);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.12, 8), m); spout.position.set(0.14, 0.12, 0); spout.rotation.z = -0.9; g.add(spout);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.006, 6, 24, Math.PI), m); handle.position.y = 0.19; g.add(handle);
  return g;
}

// tripod + grill over fire
export function buildTripod() {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.5 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const base = new THREE.Vector3(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75), top = new THREE.Vector3(0, 1.3, 0);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, base.distanceTo(top)), m);
    leg.position.copy(base).lerp(top, 0.5); leg.lookAt(top); leg.rotateX(Math.PI / 2); leg.castShadow = true; g.add(leg);
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.5), m); chain.position.y = 1.05; g.add(chain);
  const grill = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.008, 6, 32), m); grill.rotation.x = Math.PI / 2; grill.position.y = 0.8; g.add(grill);
  for (let i = -3; i <= 3; i++) { const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.55 * Math.sqrt(1 - (i / 3.5) ** 2)), m); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.8, i * 0.075); g.add(bar); }
  return g;
}

export function buildWoodPile(textures) {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ map: textures.bark_brown_02.diff, normalMap: textures.bark_brown_02.nor, roughness: 1 });
  const cut = new THREE.MeshStandardMaterial({ color: 0xa88458, roughness: 0.9 });
  const rnd = mulberry32(12);
  let n = 0;
  for (let row = 0; row < 4; row++) for (let i = 0; i < 6 - row; i++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.5, 7), [bark, cut, cut]);
    m.rotation.x = Math.PI / 2; m.rotation.y = (rnd() - 0.5) * 0.1;
    m.position.set((i - (5 - row) / 2) * 0.16, 0.08 + row * 0.14, (rnd() - 0.5) * 0.04);
    m.castShadow = true; g.add(m); n++;
  }
  g.userData.logs = g.children.slice();
  return g;
}

// fishing rod held in first-person
export function buildRod() {
  const g = new THREE.Group();
  const cork = new THREE.MeshStandardMaterial({ color: 0x9c7a50, roughness: 0.9 });
  const blank = new THREE.MeshStandardMaterial({ color: 0x1b2430, metalness: 0.3, roughness: 0.35 });
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.35, 10), cork); h.position.y = 0.17; g.add(h);
  const b = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.012, 2.1, 8), blank); b.position.y = 1.4; g.add(b);
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9, roughness: 0.3 }));
  reel.rotation.z = Math.PI / 2; reel.position.set(0.03, 0.3, 0); g.add(reel);
  return g;
}

export function buildAxe(textures) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6238, roughness: 0.6 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x777d82, metalness: 1, roughness: 0.3 });
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.7, 10), wood); handle.position.y = 0.35; g.add(handle);
  const shape = new THREE.Shape(); shape.moveTo(0, 0.03); shape.lineTo(0.14, 0.07); shape.quadraticCurveTo(0.17, 0, 0.14, -0.07); shape.lineTo(0, -0.03); shape.lineTo(-0.04, -0.025); shape.lineTo(-0.04, 0.025);
  const head = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004 }), steel);
  head.position.set(0, 0.66, -0.0125); g.add(head);
  return g;
}

export function placeOnGround(obj, x, z, yOff = 0, alignNormal = false) {
  obj.position.set(x, heightAt(x, z) + yOff, z);
  return obj;
}
