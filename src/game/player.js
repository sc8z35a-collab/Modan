import * as THREE from 'three';
import { heightAt, WORLD } from '../world/heightfield.js';
import { clamp, lerp } from '../core/noise.js';

export class Player {
  constructor(camera, colliders, audio, surfaceFn, platforms = []) {
    this.camera = camera; this.colliders = colliders; this.audio = audio; this.surfaceFn = surfaceFn;
    this.platforms = platforms; // [{contains(x,z), height}]
    this.pos = new THREE.Vector3(WORLD.camp.x + 4, 0, WORLD.camp.z + 9);
    this.yaw = Math.PI * 0.9; this.pitch = -0.08;
    this.vel = new THREE.Vector3();
    this.eye = 1.65; this.eyeCur = 1.65;
    this.bob = 0; this.stepPhase = 0;
    this.locked = false; // during minigames/cutscenes
    this.speedMul = 1;
    this.inWater = 0;
  }

  groundAt(x, z) {
    let h = heightAt(x, z);
    for (const p of this.platforms) if (p.contains(x, z)) h = Math.max(h, p.height);
    return h;
  }

  update(dt, input) {
    const look = input.consumeLook();
    if (!this.locked) {
      this.yaw -= look.x; this.pitch = clamp(this.pitch - look.y, -1.35, 1.25);
    }
    const mv = this.locked ? { x: 0, y: 0, run: false } : input.getMove();
    const crouch = input.crouch;
    const water = Math.max(0, WORLD.waterLevel - heightAt(this.pos.x, this.pos.z));
    this.inWater = water;
    let speed = (mv.run && !crouch ? 5.6 : 2.6) * (crouch ? 0.55 : 1) * this.speedMul;
    speed *= 1 / (1 + water * 1.8);
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    const want = f.multiplyScalar(mv.y).add(r.multiplyScalar(mv.x)).multiplyScalar(speed);
    const acc = want.lengthSq() > 0 ? 10 : 12;
    this.vel.x = lerp(this.vel.x, want.x, Math.min(1, acc * dt));
    this.vel.z = lerp(this.vel.z, want.z, Math.min(1, acc * dt));

    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    // block deep water & steep slopes & world bounds
    const nd = WORLD.waterLevel - heightAt(nx, nz);
    const slope = (this.groundAt(nx, nz) - this.groundAt(this.pos.x, this.pos.z)) / Math.max(1e-4, Math.hypot(nx - this.pos.x, nz - this.pos.z));
    if (nd > 1.05 && !this.platforms.some((p) => p.contains(nx, nz))) { nx = this.pos.x; nz = this.pos.z; }
    if (slope > 1.4) { nx = this.pos.x; nz = this.pos.z; }
    const bd = Math.hypot(nx - WORLD.camp.x, nz - WORLD.camp.z);
    if (bd > WORLD.bound) { const k = WORLD.bound / bd; nx = WORLD.camp.x + (nx - WORLD.camp.x) * k; nz = WORLD.camp.z + (nz - WORLD.camp.z) * k; }
    [nx, nz] = this.colliders.resolve(nx, nz, 0.35);
    this.pos.x = nx; this.pos.z = nz;
    const g = this.groundAt(nx, nz);
    this.pos.y = lerp(this.pos.y || g, g, Math.min(1, dt * 14));

    // head bob + footsteps
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const targetEye = crouch ? 1.0 : 1.65;
    this.eyeCur = lerp(this.eyeCur, targetEye, Math.min(1, dt * 8));
    if (sp > 0.3) {
      const prev = this.stepPhase;
      this.stepPhase += dt * sp * 1.9;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.stepPhase / Math.PI)) this.audio.footstep(this.surfaceFn(nx, nz, water), sp > 4);
    }
    const amp = Math.min(sp / 5.6, 1);
    const bobY = Math.abs(Math.sin(this.stepPhase)) * 0.055 * amp;
    const bobX = Math.cos(this.stepPhase) * 0.03 * amp;
    const breathe = Math.sin(performance.now() * 0.0012) * 0.006;

    const cam = this.camera;
    cam.position.set(this.pos.x, this.pos.y + this.eyeCur + bobY + breathe, this.pos.z);
    cam.position.addScaledVector(r.normalize(), bobX);
    cam.rotation.set(0, 0, 0);
    cam.rotation.order = 'YXZ';
    cam.rotation.y = this.yaw; cam.rotation.x = this.pitch;
    cam.rotation.z = -this.vel.dot(r) * 0.004;
    // camera shouldn't go below water surface visually
    if (cam.position.y < WORLD.waterLevel + 0.25) cam.position.y = WORLD.waterLevel + 0.25;
  }

  forward() { const v = new THREE.Vector3(); this.camera.getWorldDirection(v); return v; }
}
