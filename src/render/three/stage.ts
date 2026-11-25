import {
  ACESFilmicToneMapping,
  Color,
  DepthTexture,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  MeshBasicMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type Camera,
} from 'three';
import { N8AOPass } from 'n8ao';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { GRADE, ILLUSTRATE } from './look';

/**
 * 画面管线（2026-11-26，摆脱"SketchUp 感"）：
 * 1. N8AO：接触阴影 / 环境光遮蔽——缝里、叠起来的地方、东西贴地的地方自然暗下去（SketchUp 没有这个，所以显得平）；
 * 2. 墨线：按深度找轮廓和折痕，有粗细；
 * 3. 色调：暖、旧纸、柔和的对比、四角压暗、纸的颗粒。
 * 灯：一盏偏暖的斜阳（软阴影）+ 偏暖的天光 + 一点环境反射（黄铜要有东西可照）。
 */

/** 墨线：自己渲染一遍深度，再叠到上一步的画面上。 */
export class InkPass extends Pass {
  private readonly rt: WebGLRenderTarget;
  private readonly quad: FullScreenQuad;
  private readonly depthOnly = new MeshBasicMaterial({ colorWrite: false });
  readonly mat: ShaderMaterial;
  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    opts: { width?: number; strength?: number; color?: number } = {},
  ) {
    super();
    this.rt = new WebGLRenderTarget(1, 1);
    this.rt.depthTexture = new DepthTexture(1, 1);
    this.mat = new ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uRes: { value: new Vector2(1, 1) },
        uNear: { value: 0.05 },
        uFar: { value: 200 },
        uInk: { value: new Color(opts.color ?? 0x3a2414) },
        uWidth: { value: opts.width ?? 1.4 },
        uStrength: { value: opts.strength ?? 0.9 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar;
        uniform vec3 uInk; uniform float uWidth; uniform float uStrength; varying vec2 vUv;
        float lin(vec2 uv){ float z = texture2D(tDepth, uv).r * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        float edgeAt(vec2 uv, vec2 px, float d0){
          float dl = lin(uv - vec2(px.x, 0.0)), dr = lin(uv + vec2(px.x, 0.0));
          float dd = lin(uv - vec2(0.0, px.y)), du = lin(uv + vec2(0.0, px.y));
          float jump = max(max(abs(dl - d0), abs(dr - d0)), max(abs(dd - d0), abs(du - d0))) / d0;
          float crease = (abs(dl + dr - 2.0 * d0) + abs(dd + du - 2.0 * d0)) / d0;
          return max(smoothstep(0.01, 0.025, jump), smoothstep(0.003, 0.009, crease) * 0.65);
        }
        void main(){
          vec4 c = texture2D(tColor, vUv);
          float d0 = lin(vUv);
          // 笔画：粗细随距离变，沿笔画有一点断续。
          float w = uWidth * clamp(2.5 / sqrt(max(d0, 0.25)), 0.7, 2.2);
          float e = edgeAt(vUv, w / uRes, d0);
          e = max(e, edgeAt(vUv, w * 0.5 / uRes, d0) * 0.8);
          e *= 0.75 + 0.25 * hash(floor(vUv * uRes / 2.0));
          e *= smoothstep(70.0, 15.0, d0);
          c.rgb = mix(c.rgb, uInk * (0.55 + 0.45 * c.rgb), clamp(e * uStrength, 0.0, 1.0));
          gl_FragColor = c;
        }`,
      depthWrite: false,
      depthTest: false,
    });
    this.quad = new FullScreenQuad(this.mat);
  }
  override setSize(w: number, h: number): void {
    this.rt.setSize(w, h);
    (this.mat.uniforms['uRes']!.value as Vector2).set(w, h);
  }
  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget, readBuffer: WebGLRenderTarget): void {
    const bg = this.scene.background;
    const ov = this.scene.overrideMaterial;
    this.scene.background = null;
    this.scene.overrideMaterial = this.depthOnly;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    this.scene.overrideMaterial = ov;
    this.scene.background = bg;
    const cam = this.camera as PerspectiveCamera;
    this.mat.uniforms['tColor']!.value = readBuffer.texture;
    this.mat.uniforms['tDepth']!.value = this.rt.depthTexture;
    this.mat.uniforms['uNear']!.value = cam.near;
    this.mat.uniforms['uFar']!.value = cam.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(30, 1, 0.05, 200);
  readonly sun = new DirectionalLight(0xffcd8a, 3.0);
  readonly sky = new HemisphereLight(0xf4ead6, 0x8f7a5e, 0.9);
  readonly composer: EffectComposer;
  readonly ao: N8AOPass;
  readonly ink: InkPass;
  readonly grade: ShaderPass;
  readonly illus: ShaderPass;
  private time = 0;

  constructor(
    private readonly host: HTMLElement,
    opts: { pixelRatio?: number; shadowSize?: number; extent?: number } = {},
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(opts.pixelRatio ?? Math.min(3, window.devicePixelRatio || 1));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new Color(0xf1eadb);
    // 光：效果图的光从左上方来（影子往右下），偏暖；天光偏暖，暗部不发灰。
    // 效果图的影子朝镜头右下方拉：太阳在后上方偏左，朝镜头的面在背光里，只有天光照着。
    this.sun.position.set(-4, 6.5, -5.5);
    this.sun.castShadow = true;
    const S = opts.shadowSize ?? 4096;
    this.sun.shadow.mapSize.set(S, S);
    const e = opts.extent ?? 3;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -e;
    sc.right = sc.top = e;
    sc.near = 0.5;
    sc.far = 30;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.01;
    this.sun.shadow.radius = 4;
    this.scene.add(this.sun, this.sun.target, this.sky);
    this.scene.environment = new PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.45;

    this.composer = new EffectComposer(this.renderer, new WebGLRenderTarget(1, 1, { type: HalfFloatType }));
    this.ao = new N8AOPass(this.scene, this.camera, 1, 1);
    this.ao.configuration.aoRadius = 0.25;
    this.ao.configuration.distanceFalloff = 0.6;
    this.ao.configuration.intensity = 3.2;
    this.ao.configuration.color = new Color(0x2a1a0e);
    this.ao.configuration.gammaCorrection = false;
    this.ao.configuration.aoSamples = 16;
    this.ao.configuration.denoiseSamples = 8;
    this.composer.addPass(this.ao);
    this.ink = new InkPass(this.scene, this.camera);
    this.composer.addPass(this.ink);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GRADE);
    this.composer.addPass(this.grade);
    this.illus = new ShaderPass(ILLUSTRATE);
    this.composer.addPass(this.illus);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.grade.uniforms['uRes']!.value.set(w * pr, h * pr);
    this.illus.uniforms['uRes']!.value.set(w * pr, h * pr);
    this.illus.uniforms['uScale']!.value = pr;
  }

  render(dt: number): void {
    this.time += dt;
    this.grade.uniforms['uTime']!.value = this.time;
    this.composer.render(dt);
  }
}
