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
      c = mix(c, sepia, 0.1 * uWarm);
      // 暗部发暖（不是纯黑），亮部微微发黄。
      c = mix(vec3(0.07, 0.045, 0.025), vec3(1.0, 0.98, 0.94), c);
      // 一点 S 形对比：亮的更亮、暗的更沉（Lovart 整体效果图的光是硬的斜阳）。
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.35);
      c = pow(c, vec3(0.97, 1.0, 1.06));
      // 四周压暗，纸的颗粒。
      vec2 d = vUv - 0.5;
      c *= mix(1.0 - uVignette, 1.0, smoothstep(0.95, 0.3, length(d * vec2(1.0, 0.9))));
      c += (rnd(floor(vUv * uRes)) - 0.5) * 0.022;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/**
 * 插画化（2026-11-26，用户："印刷 / 铅笔画的色彩感"）：在调好色的画面上
 * - 水彩：一点点晕开（和周围平均混一些），颜料在色块交界处沉积变深，纸面颗粒让颜色有深浅；
 * - 铅笔：暗的地方叠斜的排线，更暗的地方交叉排线，线有断续、有抖动；
 * - 印刷：中间调略压、高光不全白，整体偏暖的米色纸。
 * 排线和颗粒按屏幕算（镜头不动时最好看；动的时候像一张一张画出来的）。
 */
export const ILLUSTRATE = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new Vector2(1, 1) },
    uTime: { value: 0 },
    uHatch: { value: 1 },
    uWash: { value: 1 },
    uScale: { value: 1 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime; uniform float uHatch; uniform float uWash; uniform float uScale; varying vec2 vUv;
    float h21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += vn(p) * a; p *= 2.07; a *= 0.5; } return s; }
    float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    // 一组排线：方向 dir，间距 sp（像素），粗 w；线有断续（沿线方向的噪声）和抖动。
    float hatch(vec2 px, vec2 dir, float sp, float w, float seed){
      vec2 n = vec2(-dir.y, dir.x);
      float t = dot(px, n) / sp;
      float along = dot(px, dir);
      t += (vn(vec2(along * 0.02, floor(t) + seed)) - 0.5) * 0.35;
      float d = abs(fract(t) - 0.5) * sp;
      float line = 1.0 - smoothstep(w * 0.5, w * 0.5 + 0.9, d);
      float broken = smoothstep(0.25, 0.55, vn(vec2(along / (sp * 6.0), floor(t) * 7.1 + seed)));
      return line * broken;
    }
    void main(){
      vec2 px = vUv * uRes;
      vec2 o = 1.5 * uScale / uRes;
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      // 水彩：轻轻晕开、交界处颜料沉积。
      vec3 a = (texture2D(tDiffuse, vUv + vec2(o.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(o.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, o.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, o.y)).rgb) * 0.25;
      vec3 b = (texture2D(tDiffuse, vUv + o * 2.5).rgb + texture2D(tDiffuse, vUv - o * 2.5).rgb + texture2D(tDiffuse, vUv + vec2(o.x, -o.y) * 2.5).rgb + texture2D(tDiffuse, vUv + vec2(-o.x, o.y) * 2.5).rgb) * 0.25;
      c = mix(c, a, 0.35 * uWash);
      float edge = clamp(length(c - b) * 3.0, 0.0, 1.0);
      c *= 1.0 - edge * 0.18 * uWash;
      // 纸面颗粒：大块的颜料浓淡 + 细的纸纹。
      float gran = fbm(px / (9.0 * uScale)) ;
      float fiber = vn(px / (1.6 * uScale));
      c *= mix(1.0, 0.86 + 0.24 * gran, 0.6 * uWash);
      c *= 0.96 + 0.06 * fiber;
      // 铅笔排线：越暗越多。
      float L = lum(c);
      float dark = smoothstep(0.62, 0.18, L);
      float sp = 5.0 * uScale;
      float h1 = hatch(px, normalize(vec2(1.0, -0.62)), sp, 0.9 * uScale, 1.0) * smoothstep(0.0, 0.35, dark);
      float h2 = hatch(px, normalize(vec2(1.0, 0.85)), sp * 1.15, 0.8 * uScale, 7.0) * smoothstep(0.45, 0.85, dark);
      float hh = max(h1, h2 * 0.9) * uHatch;
      vec3 graphite = vec3(0.24, 0.18, 0.13);
      c = mix(c, c * graphite * 2.2, hh * 0.24);
      // 印刷的色调：高光不全白、阴影偏暖褐。
      c = mix(vec3(0.1, 0.085, 0.07), vec3(0.985, 0.96, 0.92), c);
      gl_FragColor = vec4(c, 1.0);
    }`,
};
