// First-person held tools (attached to camera) with sway/swing animation.
import * as THREE from 'three';
import { buildRod, buildAxe } from '../world/props.js';

export class ViewModel {
  constructor(camera, textures) {
    this.camera = camera;
    this.root = new THREE.Group();
    camera.add(this.root);
    this.items = {};
    const rod = buildRod(); rod.scale.setScalar(0.55); rod.rotation.set(-0.9, 0.15, -0.2); rod.position.set(0.28, -0.38, -0.5);
    const axe = buildAxe(textures); axe.scale.setScalar(0.9); axe.rotation.set(-0.3, -1.4, 0.35); axe.position.set(0.32, -0.52, -0.55);
    // skewer with fish or mushrooms
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x9a7a52, roughness: 0.9 }));
    stick.rotation.x = Math.PI / 2;
    this.cookMat = new THREE.MeshStandardMaterial({ color: 0x9aa8a0, roughness: 0.35, metalness: 0.1 });
    const fishGeo = new THREE.SphereGeometry(0.05, 16, 10); fishGeo.scale(0.6, 0.9, 3.2);
    const fishM = new THREE.Mesh(fishGeo, this.cookMat); fishM.position.z = -0.3;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 4), this.cookMat); tail.rotation.x = -Math.PI / 2; tail.scale.z = 0.2; tail.position.z = -0.1;
    const skFish = new THREE.Group(); skFish.add(stick, fishM, tail);
    const skMush = new THREE.Group(); skMush.add(stick.clone());
    for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), this.cookMat); m.scale.y = 0.7; m.position.z = -0.25 - i * 0.08; skMush.add(m); }
    for (const s of [skFish, skMush]) { s.position.set(0.1, -0.3, -0.35); s.rotation.set(-0.35, 0.25, 0); }
    Object.assign(this.items, { rod, axe, skewerFish: skFish, skewerMush: skMush });
    for (const k in this.items) { this.items[k].visible = false; this.root.add(this.items[k]); this.items[k].traverse((o) => { if (o.isMesh) { o.castShadow = false; o.renderOrder = 30; } }); }
    this.cur = null; this.swingT = 0; this.bendV = 0; this.t = 0;
    this.tip = new THREE.Object3D(); this.tip.position.set(0, 2.45, 0); rod.add(this.tip);
  }
  set(name) {
    for (const k in this.items) this.items[k].visible = k === name;
    this.cur = name;
    if (name === 'skewerFish' || name === 'skewerMush') this.cookMat.color.set(name === 'skewerFish' ? 0x9aa8a0 : 0xc8b090);
  }
  swing() { this.swingT = 1; }
  bend(v) { this.bendV = v; }
  cookLevel(v) {
    const raw = this.cur === 'skewerFish' ? new THREE.Color(0x9aa8a0) : new THREE.Color(0xc8b090);
    const done = new THREE.Color(0xb0703a), burnt = new THREE.Color(0x1e1410);
    this.cookMat.color.copy(v < 0.65 ? raw.lerp(done, v / 0.65) : done.lerp(burnt, Math.min(1, (v - 0.65) / 0.35)));
  }
  tipWorld() { const v = new THREE.Vector3(); this.tip.getWorldPosition(v); return v; }
  update(dt, speed) {
    this.t += dt;
    const bob = Math.sin(this.t * 7) * 0.008 * Math.min(1, speed / 3);
    this.root.position.set(Math.cos(this.t * 3.5) * 0.004 * Math.min(1, speed / 3), bob, 0);
    if (this.swingT > 0) this.swingT = Math.max(0, this.swingT - dt * 3);
    const s = Math.sin(this.swingT * Math.PI);
    const it = this.items[this.cur];
    if (!it) return;
    if (this.cur === 'axe') { it.rotation.x = -0.3 - s * 1.4; it.position.y = -0.52 + s * 0.1; }
    if (this.cur === 'rod') { it.rotation.x = -0.9 - s * 0.8 + this.bendV * 0.35; it.rotation.z = -0.2 + Math.sin(this.t * 20) * 0.01 * this.bendV; }
    this.bendV *= 0.98;
  }
}
