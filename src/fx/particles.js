// Wood chips burst, rain streaks + ground mist.
import * as THREE from 'three';

export class Particles {
  constructor(scene) {
    this.scene = scene;
    this.chipsList = [];
    this.chipGeo = new THREE.BoxGeometry(0.04, 0.01, 0.07);
    this.chipMat = new THREE.MeshStandardMaterial({ color: 0xc09a68, roughness: 0.9 });

    // rain
    const N = 9000;
    const pos = new Float32Array(N * 3), seeds = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 40; pos[i * 3 + 1] = Math.random() * 20; pos[i * 3 + 2] = (Math.random() - 0.5) * 40; seeds[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uAmt: { value: 0 } };
    this.rain = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false,
      vertexShader: `attribute float aSeed; uniform float uTime; uniform vec3 uCam; varying float vA;
        void main(){ vec3 p = position; p.y = mod(p.y - uTime*(14.0+aSeed*4.0), 20.0) - 6.0;
          p.xz = mod(p.xz - uCam.xz + 20.0, 40.0) - 20.0; p += vec3(uCam.x, uCam.y, uCam.z);
          vec4 mv = viewMatrix*vec4(p,1.0); vA = step(aSeed, 1.0);
          gl_PointSize = 3.0 * (6.0 / -mv.z) * 2.0; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform float uAmt; void main(){ vec2 c = gl_PointCoord-0.5; float a = smoothstep(0.08,0.0,abs(c.x)) * (1.0-abs(c.y)*2.0) * uAmt * 0.45; gl_FragColor = vec4(vec3(0.75,0.8,0.9)*a, a); }`,
    }));
    this.rain.frustumCulled = false; this.rain.visible = false;
    scene.add(this.rain);
  }

  chips(pos) {
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(this.chipGeo, this.chipMat);
      m.position.set(pos.x, pos.y + 0.5, pos.z);
      m.userData.v = new THREE.Vector3((Math.random() - 0.5) * 3, 2 + Math.random() * 2, (Math.random() - 0.5) * 3);
      m.userData.life = 1.5; m.castShadow = true;
      this.scene.add(m); this.chipsList.push(m);
    }
  }

  update(dt, cam, rain) {
    for (let i = this.chipsList.length - 1; i >= 0; i--) {
      const m = this.chipsList[i], u = m.userData;
      u.life -= dt; u.v.y -= 9.8 * dt;
      m.position.addScaledVector(u.v, dt); m.rotation.x += dt * 10; m.rotation.z += dt * 7;
      if (u.life <= 0) { this.scene.remove(m); this.chipsList.splice(i, 1); }
    }
    this.rainU.uTime.value += dt; this.rainU.uCam.value.copy(cam.position); this.rainU.uAmt.value = rain;
    this.rain.visible = rain > 0.01;
  }
}
