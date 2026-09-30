import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, SMAAEffect, SMAAPreset, BrightnessContrastEffect, HueSaturationEffect,
  DepthOfFieldEffect, NoiseEffect, BlendFunction,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { Lens } from './lens.js';

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
    // ultra-wide 0.5x / optical 20x / digital 2x (owns camera.fov; resize() only sets its 1x base FOV)
    this.lens = new Lens(this.camera);
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
    this.dof = new DepthOfFieldEffect(camera, { focusDistance: 8, focusRange: 3, bokehScale: 3.2, resolutionY: 540 });
    this.dof.blendMode.opacity.value = 0;
    const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    grain.blendMode.opacity.value = 0.05;

    // EffectPass calls update() on every effect each frame even at opacity 0: the DOF effect ran its CoC + blur
    // + 4 bokeh passes every frame while only photo mode uses it. It gets its own pass, enabled in photo mode.
    this.dofPass = new EffectPass(camera, this.dof);
    this.dofPass.enabled = this.photoMode;
    composer.addPass(this.dofPass);
    const effects = [this.bloom, this.tone, this.grade, this.bc, this.vignette, grain];
    composer.addPass(new EffectPass(camera, ...effects));
    if (q.smaa) composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    // lens pass LAST (digital crop must upscale the anti-aliased image). It is disabled at exactly 1x; a disabled
    // last pass would leave the previous pass rendering into an off-screen buffer (black screen), so the
    // renderToScreen flag is handed over explicitly in setLensActive().
    this.lensPrev = composer.passes[composer.passes.length - 1];
    this.lensPass = new EffectPass(camera, this.lens.effect);
    composer.addPass(this.lensPass);
    this._lensOn = null;
    this.setLensActive(false);
    this.resize();
  }

  setLensActive(on) {
    if (this._lensOn === on || !this.lensPass) return;
    this._lensOn = on;
    this.lensPass.enabled = on; this.lensPass.renderToScreen = on;
    this.lensPrev.renderToScreen = !on;
  }

  // per-frame: smooth zoom, enable the lens pass only when it does something
  updateLens(dt) {
    this.lens.update(dt);
    const z = this.lens.zoom;
    this.setLensActive(Math.abs(z - 1) > 1e-3);
  }

  setQuality(name) {
    if (!QUALITY[name]) return;
    this.qualityName = name;
    this.q = QUALITY[name];
    this.buildComposer();
    // rebuilding the composer recreates the DOF effect -> restore photo mode state
    if (this.photoMode) this.setPhotoMode(true, this.focusDist);
  }

  // postprocessing 6.3x: focusDistance / focusRange are WORLD units. The old normalised values
  // (focusDistance 0.02 / focalLength 0.05) meant "focus 2cm from the lens, 5cm range" -> photos fully blurred.
  setPhotoMode(on, focusDist = 6) {
    this.photoMode = on; this.focusDist = focusDist;
    this.dof.blendMode.opacity.value = on ? 1 : 0;
    if (this.dofPass) this.dofPass.enabled = on;
    if (on) {
      const coc = this.dof.cocMaterial;
      coc.focusDistance = focusDist;
      coc.focusRange = Math.max(1.2, focusDist * 0.35);
    }
  }

  resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight); // 0 while hidden -> NaN aspect
    const pr = Math.min(window.devicePixelRatio || 1, this.q.pixelRatio);
    this.r.setPixelRatio(pr);
    this.r.setSize(w, h, false);
    this.camera.aspect = w / h;
    // wider FOV in landscape phones feels more natural
    this.lens.setBaseFov(w / h > 1.9 ? 64 : 70);
    this.lens.apply(true);
    this.composer?.setSize(w, h, false);
  }

  // info is reset once per frame by the caller (so the water reflection pass is counted too)
  render(dt) {
    this.composer.render(dt);
  }
}
