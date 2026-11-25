import { Color, DepthTexture, HalfFloatType, ShaderMaterial, Vector2, WebGLRenderTarget, type Camera, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * 纸模型的"画法"（2026-11-26，照 Lovart 细节表 art/incoming/lovart/010/5-details/6-overall.jpg）：
 * 1. 墨线：画面里的轮廓和折痕按深度找出来，描一条深褐色、有粗细的线（近处粗、远处细，带一点手描的抖动）；
 * 2. 调色：暖、偏旧纸的颜色，饱和度压低一点，暗部发暖，四周压暗，一层纸的颗粒。
 * 场景的第一步用 SceneInkPass 代替 RenderPass；调色放在 OutputPass 之后（显示空间里调）。
 */

export class SceneInkPass extends Pass {
  private readonly rt: WebGLRenderTarget;
  private readonly quad: FullScreenQuad;
  readonly mat: ShaderMaterial;

  constructor(
    private readonly scene: Scene,
    private readonly camera: Camera,
    opts: { color?: number; width?: number; strength?: number } = {},
  ) {
    super();
    this.rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.rt.depthTexture = new DepthTexture(1, 1);
    this.mat = new ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uRes: { value: new Vector2(1, 1) },
        uNear: { value: 0.05 },
        uFar: { value: 200 },
        uInk: { value: new Color(opts.color ?? 0x3a2618) },
        uWidth: { value: opts.width ?? 1.6 },
        uStrength: { value: opts.strength ?? 0.85 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar;
        uniform vec3 uInk; uniform float uWidth; uniform float uStrength; varying vec2 vUv;
        float lin(vec2 uv){ float z = texture2D(tDepth, uv).r * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
        void main(){
          vec4 c = texture2D(tColor, vUv);
          float d0 = lin(vUv);
          // 线宽：近处粗一点（按深度缩），加一点抖动，像笔画。
          float w = uWidth * clamp(2.2 / sqrt(max(d0, 0.3)), 0.6, 1.6) * (0.85 + 0.3 * hash(floor(vUv * uRes / 3.0)));
          vec2 px = w / uRes;
          float e = 0.0;
          // 轮廓：周围有比自己近很多的点（相对深度差）。
          float dl = lin(vUv - vec2(px.x, 0.0)), dr = lin(vUv + vec2(px.x, 0.0));
          float dd = lin(vUv - vec2(0.0, px.y)), du = lin(vUv + vec2(0.0, px.y));
          float jump = max(max(abs(dl - d0), abs(dr - d0)), max(abs(dd - d0), abs(du - d0))) / d0;
          e = max(e, smoothstep(0.012, 0.03, jump));
          // 折痕：深度的二阶差分（平面上为零，在折的地方跳一下）。
          float crease = abs(dl + dr - 2.0 * d0) + abs(dd + du - 2.0 * d0);
          e = max(e, smoothstep(0.004, 0.012, crease / d0) * 0.7);
          // 很远的地方（天、远景）线淡掉。
          e *= smoothstep(60.0, 12.0, d0);
          c.rgb = mix(c.rgb, uInk * (0.6 + 0.4 * c.rgb), e * uStrength);
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

  override render(renderer: WebGLRenderer, writeBuffer: WebGLRenderTarget): void {
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(this.scene, this.camera);
    const cam = this.camera as PerspectiveCamera;
    this.mat.uniforms['tColor']!.value = this.rt.texture;
    this.mat.uniforms['tDepth']!.value = this.rt.depthTexture;
    this.mat.uniforms['uNear']!.value = cam.near;
    this.mat.uniforms['uFar']!.value = cam.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.rt.dispose();
    this.quad.dispose();
  }
}

/** 调色（显示空间）：暖、旧纸、压一点饱和度、暗部发暖、四周压暗、纸的颗粒。 */
export const GRADE = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new Vector2(1, 1) },
    uWarm: { value: 1 },
    uVignette: { value: 0.22 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; uniform float uWarm; uniform float uVignette; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      // 饱和度压低一些，往旧纸的暖色里拉。
      vec3 sepia = vec3(l) * vec3(1.07, 0.98, 0.84);
      c = mix(c, sepia, 0.22 * uWarm);
      // 暗部发暖（不是纯黑），亮部微微发黄。
      c = mix(vec3(0.07, 0.045, 0.025), vec3(1.0, 0.98, 0.94), c);
      // 一点 S 形对比：亮的更亮、暗的更沉（Lovart 整体效果图的光是硬的斜阳）。
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
      c = pow(c, vec3(0.97, 1.0, 1.06));
      // 四周压暗，纸的颗粒。
      vec2 d = vUv - 0.5;
      c *= mix(1.0 - uVignette, 1.0, smoothstep(0.95, 0.3, length(d * vec2(1.0, 0.9))));
      c += (rnd(floor(vUv * uRes) + fract(uTime * 7.13) * 113.0) - 0.5) * 0.022;
      gl_FragColor = vec4(c, 1.0);
    }`,
};
