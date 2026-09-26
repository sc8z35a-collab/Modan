import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, SMAAEffect, SMAAPreset, BrightnessContrastEffect, HueSaturationEffect,
  DepthOfFieldEffect, NoiseEffect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export const QUALITY = {
  ultra: { pixelRatio: 2.0, shadow: 4096, ao: true, aoHalf: false, grass: 1.0, trees: 1.0, water: 0.6, bloom: true, smaa: true },
  high: { pixelRatio: 1.6, shadow: 2048, ao: true, aoHalf: true, grass: 0.7, trees: 0.8, water: 0.5, bloom: true, smaa: true },
  // QA-only profile for headless CI in a 1GB sandbox (never used on device)
  qa: { pixelRatio: 1.0, shadow: 1024, ao: true, aoHalf: true, grass: 0.25, trees: 0.35, water: 0.3, bloom: true, smaa: true, texMax: 256 },
  medium: { pixelRatio: 1.25, shadow: 2048, ao: false, aoHalf: true, grass: 0.45, trees: 0.6, water: 0.35, bloom: true, smaa: false },
};

export class Renderer {
  constructor(canvas, qualityName = 'ultra') {
    this.canvas = canvas;
    this.qualityName = qualityName;
    this.q = QUALITY[qualityName];
    const r = new THREE.WebGLRenderer({
      canvas, antialias: false, stencil: false, depth: true, powerPreference: 'high-performance',
      preserveDrawingBuffer: new URLSearchParams(location.search).has('snap'),
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.info.autoReset = false;
    this.r = r;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 2600);
    this.scene.add(this.camera);
    this.maxAniso = r.capabilities.getMaxAnisotropy();
    this.photoMode = false;
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    window.visualViewport?.addEventListener('resize', this._resize);
  }

  buildComposer() {
    const { r, scene, camera, q } = this;
    this.composer?.dispose();
    const composer = new EffectComposer(r, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.composer = composer;
    composer.addPass(new RenderPass(scene, camera));

    if (q.ao) {
      const ao = new N8AOPostPass(scene, camera, 1, 1);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 0.6;
      ao.configuration.intensity = 2.2;
      ao.configuration.aoSamples = q.aoHalf ? 8 : 16;
      ao.configuration.denoiseSamples = 4;
      ao.configuration.denoiseRadius = 8;
      ao.configuration.halfRes = q.aoHalf;
      ao.configuration.gammaCorrection = false;
      ao.configuration.screenSpaceRadius = false;
      this.ao = ao;
      composer.addPass(ao);
    } else this.ao = null;

    this.bloom = new BloomEffect({ intensity: 1.1, luminanceThreshold: 0.82, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.72 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.grade = new HueSaturationEffect({ saturation: 0.12, hue: 0 });
    this.bc = new BrightnessContrastEffect({ contrast: 0.06, brightness: 0.0 });
    this.vignette = new VignetteEffect({ darkness: 0.42, offset: 0.32 });
    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 0.02, focalLength: 0.05, bokehScale: 3.2, height: 540 });
    this.dof.blendMode.opacity.value = 0;
    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    grain.blendMode.opacity.value = 0.05;

    const effects = [this.dof, this.bloom, this.tone, this.grade, this.bc, this.vignette, grain];
    composer.addPass(new EffectPass(camera, ...effects));
    if (q.smaa) composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.resize();
  }

  setQuality(name) {
    this.qualityName = name;
    this.q = QUALITY[name];
    this.buildComposer();
  }

  setPhotoMode(on, focusDist = 6) {
    this.photoMode = on;
    this.dof.blendMode.opacity.value = on ? 1 : 0;
    if (on) this.dof.cocMaterial.worldFocusDistance = focusDist;
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
    this.r.setPixelRatio(pr);
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    // wider FOV in landscape phones feels more natural
    this.camera.fov = w / h > 1.9 ? 64 : 70;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(w, h, false);
  }

  render(dt) {
    this.r.info.reset();
    this.composer.render(dt);
  }
}
