import {
  ACESFilmicToneMapping,
  BackSide,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HalfFloatType,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Raycaster,
  PMREMGenerator,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { HorizontalTiltShiftShader } from 'three/examples/jsm/shaders/HorizontalTiltShiftShader.js';
import { VerticalTiltShiftShader } from 'three/examples/jsm/shaders/VerticalTiltShiftShader.js';
import { TERRAIN } from '../../sim/terrain';
import { MapCamera } from './mapCamera';
import { paperGlobals, paperMaterial, thinPiece } from './paper';
import { buildVegetation, type IslandInput } from './vegetation';
import { plantUniforms } from './plants';
export type { IslandInput };
import { CARD, DEEP, LAND, SEA_LEVELS, SEA_SHALLOW, bakeAo, buildRelief, fbm, levelTop, noise2, reliefField, type ReliefField, type ReliefLayer } from './relief';

/**
 * 纸雕岛（2026-11-22）：一整座岛按等高线切成纸板叠起来，放在桌上的一盏斜阳下。
 * 远看是一件完整的纸雕模型，推近能看见每一层纸的断面、纸纹、立着的剪纸灌丛和草。
 * 推演只给每格的地形和植被（见 IslandInput）；高度、形状、草丛的位置都是画面自己按种子推出来的。
 */


const GRAIN = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float g = rnd(floor(vUv * uRes) + fract(uTime * 7.13) * 113.0) - 0.5;
      c.rgb += g * 0.028;
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.95, 0.3, length(d * vec2(1.0, 0.85)));
      c.rgb *= mix(0.72, 1.0, v);
      gl_FragColor = c;
    }`,
};

export class Island3D {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.1, 2000);
  readonly cam: MapCamera;
  readonly field: ReliefField;
  private readonly composer: EffectComposer;
  private readonly tiltH: ShaderPass;
  private readonly tiltV: ShaderPass;
  private readonly grain: ShaderPass;
  private readonly sun = new DirectionalLight(0xffe0b0, 3.9);
  private readonly water: ReliefLayer[] = [];
  private readonly foam: Mesh;
  private time = 0;
  /** 搭场景花了多久（毫秒），给调试看。 */
  readonly buildMs: number;

  constructor(
    private readonly host: HTMLElement,
    inp: IslandInput,
    field?: ReliefField,
  ) {
    const t0 = performance.now();
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    const horizon = new Color(0xf1dfbd);
    this.scene.fog = new Fog(horizon, 80, 260);
    this.scene.background = horizon;
    this.sky(horizon);

    // 斜阳：从左前方低低地照过来，让每一层纸的边都投下影子。
    this.sun.position.set(-38, 30, 34);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -52;
    sc.right = sc.top = 52;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.intensity = 0.72;
    this.scene.add(this.sun, this.sun.target);
    this.scene.add(new HemisphereLight(0xd3e4ff, 0x7a6644, 1.0));
    // 一点环境反射：岸边那辆车的黄铜才不发黑（纸几乎不受影响）。
    this.scene.environment = new PMREMGenerator(this.renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;

    // 地形。
    this.field = field ?? reliefField(inp);
    const ao = bakeAo(this.field, inp.seed);
    const relief = buildRelief(this.field, ao, inp.seed);
    this.scene.add(relief.group);
    this.foam = relief.foam;
    for (const l of relief.layers) if (l.level < 0) this.water.push(l);
    // 远海：一大张最深的蓝纸，铺到地平线，交给雾。
    const deep = new Mesh(new CircleGeometry(1200, 96), paperMaterial(DEEP, { scale: 6, bump: 0.5 }));
    deep.rotation.x = -Math.PI / 2;
    deep.position.y = levelTop(-SEA_LEVELS) - CARD - 0.002;
    deep.receiveShadow = true;
    this.scene.add(deep);

    this.scene.add(buildVegetation(this.field, inp));
    this.farIslands(inp.seed, Math.max(inp.width, inp.height));
    paperGlobals.uCloudAmt.value = 0.2;

    const r = Math.max(inp.width, inp.height) / 2;
    this.cam = new MapCamera(this.camera, this.renderer.domElement, { r: r * 1.6, minDist: 7, maxDist: r * 4.2 });

    const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.tiltH = new ShaderPass(HorizontalTiltShiftShader);
    this.tiltV = new ShaderPass(VerticalTiltShiftShader);
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.composer.addPass(new OutputPass());
    this.grain = new ShaderPass(GRAIN);
    this.composer.addPass(this.grain);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.buildMs = performance.now() - t0;
  }

  private sky(horizon: Color): void {
    const m = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { uTop: { value: new Color(0x86acd0) }, uMid: { value: new Color(0xc9d9e2) }, uHor: { value: horizon } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor; varying vec3 vP;
        void main(){ float h = clamp(vP.y, 0.0, 1.0); vec3 c = mix(uHor, uMid, smoothstep(0.0, 0.12, h)); c = mix(c, uTop, smoothstep(0.12, 0.6, h)); gl_FragColor = vec4(c, 1.0); }`,
    });
    const s = new Mesh(new SphereGeometry(1500, 32, 16), m);
    s.renderOrder = -1;
    this.scene.add(s);
  }

  /**
   * 远处的小岛：不在推演里，只是让桌上这片海更大——每座是几张同心的纸（浅水、浪花、沙、两三层绿）。
   * 放在岛的两侧和后面，镜头拉远、转过去时看得见，雾把最远的融进天。
   */
  private farIslands(seed: number, size: number): void {
    const g = new Group();
    let s = (seed * 7919 + 17) >>> 0;
    const rnd = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
    const blob = (R: number, k: number): number[] => {
      const pts: number[] = [];
      const N = 90;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const r = R * (1 + 0.22 * (noise2(Math.cos(a) * 1.6 + k, Math.sin(a) * 1.6, seed + k) - 0.5) * 2 + 0.05 * Math.sin(a * 9 + k));
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      return pts;
    };
    const count = 16;
    for (let i = 0; i < count; i++) {
      const ang = Math.PI * 2 * (i / count) + (rnd() - 0.5) * 0.3;
      const dist = size * (0.95 + rnd() * 2.6);
      const cx = Math.cos(ang) * dist;
      const cz = Math.sin(ang) * dist * 0.9 - size * 0.25;
      const R = 2 + rnd() * rnd() * 13;
      const k0 = i * 13;
      // 和主岛一样一层一张卡纸：海从深到浅，一条浪花，沙，再一层层绿。
      const layers: Array<[number, number, number, number]> = [];
      const seaN = 7;
      for (let L = -seaN; L <= -1; L++) layers.push([R * (1.12 + (-L - 1) * 0.16), levelTop(L), SEA_SHALLOW[Math.min(SEA_SHALLOW.length - 1, -L - 1)]!, CARD]);
      layers.push([R * 1.07, levelTop(-1) + 0.025, 0xfbf6ea, 0.025]);
      layers.push([R, levelTop(0), LAND[0]!, CARD]);
      const hills = 2 + Math.floor(rnd() * 5 + R / 2.5);
      for (let h = 1; h <= hills; h++) layers.push([R * (0.92 - (0.8 * h) / (hills + 1)), levelTop(h), LAND[Math.min(LAND.length - 1, h)]!, CARD]);
      layers.forEach(([r, top, color, thick], j) => {
        const geom = thinPiece(blob(r, k0 + j * 0.37), thick);
        geom.rotateX(-Math.PI / 2);
        const m = new Mesh(geom, [paperMaterial(color, { scale: 2.6, kind: j === seaN + 1 ? 'kraft' : 'card' }), paperMaterial(color, { scale: 0.8, edge: true })]);
        m.position.set(cx, top - thick, cz);
        m.castShadow = true;
        m.receiveShadow = true;
        g.add(m);
      });
    }
    this.scene.add(g);
  }

  /** 调试开关（截图脚本用）。 */
  debug(k: string, v: unknown): void {
    if (k === 'shadows') this.sun.castShadow = !!v;
    if (k === 'clouds') paperGlobals.uCloudAmt.value = v ? 0.2 : 0;
  }

  /**
   * 岸边的营地：事务所的车停在岛的南岸（找最南边的一块沙滩），支开着、打盹。
   * 车的尺寸放大到地图上一眼看得见（像地图上的一个标记）。点它回家。
   */
  readonly camp = new Group();
  campPick: (() => void) | null = null;
  placeCamp(obj: Group, scale: number): void {
    const f = this.field;
    let best: [number, number, number] | null = null;
    for (let x = -20; x <= 20; x += 0.5)
      for (let z = 30; z > 0; z -= 0.25) {
        const L = f.levelAt(x, z);
        if (L >= 0) {
          const ok = [-1.2, 1.2].every((dx) => f.levelAt(x + dx, z - 0.4) === L) && L <= 1;
          if (ok && (!best || z > best[1])) best = [x, z, L];
          break;
        }
      }
    const [x, z, L] = best ?? [0, 20, 0];
    obj.scale.setScalar(scale);
    obj.rotation.y = -0.3;
    this.camp.position.set(x, levelTop(L), z - 0.6);
    this.camp.add(obj);
    this.scene.add(this.camp);
    const el = this.renderer.domElement;
    const ray = new Raycaster();
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      if (ray.intersectObject(this.camp, true).length) this.campPick?.();
    });
  }

  resize(): void {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.composer.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.grain.uniforms['uRes']!.value.set(w * pr, h * pr);
  }

  update(dt: number, render = true): void {
    this.time += dt;
    this.cam.apply(dt);
    const t = this.time;
    for (const l of this.water) l.mesh.position.y = Math.sin(t * 0.7 + l.level * 0.9) * 0.008 * (1 + l.level / SEA_LEVELS);
    this.foam.position.y = Math.sin(t * 0.9) * 0.012;
    paperGlobals.uCloudOff.value.set(t * 0.0021, t * 0.0007);
    // 阴影跟着镜头看的地方走（只需要盖住看得见的那块）。
    plantUniforms.uCam.value.copy(this.camera.position);
    plantUniforms.uLean.value = Math.max(0, this.cam.elevation - 0.35) * 0.8;
    plantUniforms.uTime.value = t;
    const fog = this.scene.fog as Fog;
    const d = this.camera.position.length();
    fog.near = d * 1.05;
    fog.far = d * 3.4 + 60;
    const w = this.renderer.domElement.width;
    const h = this.renderer.domElement.height;
    const blur = 1.2 + this.cam.near * 3.4;
    this.tiltH.uniforms['h']!.value = blur / w;
    this.tiltV.uniforms['v']!.value = blur / h;
    this.tiltH.uniforms['r']!.value = this.tiltV.uniforms['r']!.value = 0.5;
    this.grain.uniforms['uTime']!.value = t;
    if (render) this.composer.render(dt);
  }
}
