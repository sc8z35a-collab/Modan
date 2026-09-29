import * as THREE from 'three';
import { heightAt, WORLD } from '../world/heightfield.js';
import { clamp, lerp } from '../core/noise.js';

const NO_MOVE = Object.freeze({ x: 0, y: 0, run: false });

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
    this._f = new THREE.Vector3(); this._r = new THREE.Vector3(); this._want = new THREE.Vector3(); this._fw = new THREE.Vector3();
    this._grounded = false;
  }

  onPlatform(x, z) { for (const p of this.platforms) if (p.contains(x, z)) return p; return null; }

  groundAt(x, z) {
    let h = heightAt(x, z);
    for (const p of this.platforms) if (p.contains(x, z)) h = Math.max(h, p.height);
    return h;
  }

  // snap to the ground immediately (teleport / load / new game) instead of lerping up from y=0
  teleport(x, z, yaw) {
    this.pos.set(x, 0, z);
    if (yaw !== undefined && Number.isFinite(yaw)) this.yaw = yaw;
    this.vel.set(0, 0, 0);
    this._grounded = false;
  }

  update(dt, input, lookOnly = false) {
    const look = input.consumeLook();
    if (!this.locked) {
      this.yaw -= look.x; this.pitch = clamp(this.pitch - look.y, -1.35, 1.25);
      // keep yaw bounded so it doesn't lose float precision after hours of looking around
      if (this.yaw > Math.PI * 4 || this.yaw < -Math.PI * 4) this.yaw %= Math.PI * 2;
    }
    const mv = this.locked || lookOnly ? NO_MOVE : input.getMove();
    const crouch = input.crouch;
    // standing on the dock is NOT wading, even though the terrain below it is under water
    const onDock = !!this.onPlatform(this.pos.x, this.pos.z);
    const water = onDock ? 0 : Math.max(0, WORLD.waterLevel - heightAt(this.pos.x, this.pos.z));
    this.inWater = water;
    let speed = (mv.run && !crouch ? 5.6 : 2.6) * (crouch ? 0.55 : 1) * this.speedMul;
    speed *= 1 / (1 + water * 1.8);
    const f = this._f.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const r = this._r.set(-f.z, 0, f.x);
    // build the wish vector without mutating f / r (the old code scaled r in place -> head-bob/roll used a garbage vector)
    const want = this._want.set(f.x * mv.y + r.x * mv.x, 0, f.z * mv.y + r.z * mv.x).multiplyScalar(speed);
    const acc = want.lengthSq() > 0 ? 10 : 12;
    const k = 1 - Math.exp(-acc * dt); // framerate-independent smoothing
    this.vel.x = lerp(this.vel.x, want.x, k);
    this.vel.z = lerp(this.vel.z, want.z, k);

    let nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    // block deep water & steep slopes & world bounds
    const nd = WORLD.waterLevel - heightAt(nx, nz);
    const stepLen = Math.hypot(nx - this.pos.x, nz - this.pos.z);
    const slope = stepLen > 1e-4 ? (this.groundAt(nx, nz) - this.groundAt(this.pos.x, this.pos.z)) / stepLen : 0;
    const nextOnDock = !!this.onPlatform(nx, nz);
    if (nd > 1.05 && !nextOnDock) { nx = this.pos.x; nz = this.pos.z; this.vel.x = this.vel.z = 0; }
    // stepping onto / off the dock is a small step, not a cliff
    else if (slope > 1.4 && !(nextOnDock || onDock)) { nx = this.pos.x; nz = this.pos.z; this.vel.x = this.vel.z = 0; }
    const bd = Math.hypot(nx - WORLD.camp.x, nz - WORLD.camp.z);
    if (bd > WORLD.bound) { const kb = WORLD.bound / bd; nx = WORLD.camp.x + (nx - WORLD.camp.x) * kb; nz = WORLD.camp.z + (nz - WORLD.camp.z) * kb; }
    [nx, nz] = this.colliders.resolve(nx, nz, 0.35);
    // collider push-out may have pushed us into deep water; refuse that
    if (WORLD.waterLevel - heightAt(nx, nz) > 1.05 && !this.onPlatform(nx, nz)) { nx = this.pos.x; nz = this.pos.z; }
    this.pos.x = nx; this.pos.z = nz;
    const g = this.groundAt(nx, nz);
    if (!this._grounded || !Number.isFinite(this.pos.y)) { this.pos.y = g; this._grounded = true; }
    else this.pos.y = lerp(this.pos.y, g, Math.min(1, dt * 14));

    // head bob + footsteps
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const targetEye = crouch ? 1.0 : 1.65;
    this.eyeCur = lerp(this.eyeCur, targetEye, Math.min(1, dt * 8));
    if (sp > 0.3) {
      const prev = this.stepPhase;
      this.stepPhase += dt * sp * 1.9;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.stepPhase / Math.PI)) this.audio.footstep(this.surfaceFn(nx, nz, water), sp > 4);
      if (this.stepPhase > 1e4 * Math.PI) this.stepPhase -= 1e4 * Math.PI;
    }
    const amp = Math.min(sp / 5.6, 1);
    const bobY = Math.abs(Math.sin(this.stepPhase)) * 0.055 * amp;
    const bobX = Math.cos(this.stepPhase) * 0.03 * amp;
    const breathe = Math.sin(performance.now() * 0.0012) * 0.006;

    const cam = this.camera;
    cam.position.set(this.pos.x, this.pos.y + this.eyeCur + bobY + breathe, this.pos.z);
    cam.position.addScaledVector(r, bobX);
    cam.rotation.set(this.pitch, this.yaw, -this.vel.dot(r) * 0.004, 'YXZ');
    // camera shouldn't go below water surface visually
    if (cam.position.y < WORLD.waterLevel + 0.25) cam.position.y = WORLD.waterLevel + 0.25;
  }

  // world-space view direction (reuses a scratch vector unless `out` is given)
  forward(out = this._fw) { this.camera.getWorldDirection(out); return out; }
}
