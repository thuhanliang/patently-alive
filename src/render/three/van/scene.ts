import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HalfFloatType,
  HemisphereLight,
  Mesh,
  PCFSoftShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { buildFlora } from '../flora';
import { paperGlobals, paperMaterial } from '../paper';
import { plantMesh, plantUniforms, type PlantSpot } from '../plants';
import { CARD, DEEP, SEA_LEVELS, bakeAo, buildRelief, cropField, levelTop, noise2, type ReliefField } from '../relief';
import { buildVegetation, type IslandInput } from '../vegetation';
import { V3, flat, ink, mesh, card, rng } from '../craft';
import { Van } from './van';

/**
 * 「勾勾」所在的小场景（2026-11-25）：一块剪纸的草地和沙滩，车停在上面；一盏斜阳、天光、车里的灯。
 * 看车页和"家"共用它。家的主视角是"剖开的娃娃屋"：-z 那一侧的墙藏起来，从侧上方看进车里。
 */

export interface ScenePose {
  pos: Vector3;
  target: Vector3;
  fov: number;
}

export type VanView = 'hero' | 'front' | 'side' | 'back' | 'top' | 'inside' | 'camp';

interface Pose {
  pos: Vector3;
  target: Vector3;
  fov: number;
}

const VIEWS: Record<VanView, Pose> = {
  hero: { pos: V3(6.4, 3.0, 5.6), target: V3(0, 1.35, 0), fov: 32 },
  front: { pos: V3(7.5, 1.7, 0), target: V3(0, 1.5, 0), fov: 30 },
  side: { pos: V3(0.1, 1.8, 8.2), target: V3(0.1, 1.45, 0), fov: 30 },
  back: { pos: V3(-7.5, 2.0, 0.6), target: V3(0, 1.4, 0), fov: 30 },
  top: { pos: V3(0.05, 10, 0.05), target: V3(0, 0, 0), fov: 34 },
  inside: { pos: V3(0.0, 3.05, -3.4), target: V3(0.0, 1.32, 0.5), fov: 42 },
  camp: { pos: V3(3.2, 3.6, 7.6), target: V3(-0.6, 1.0, 1.4), fov: 34 },
};

const GRAIN = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb += (rnd(floor(vUv * uRes) + fract(uTime * 7.13) * 113.0) - 0.5) * 0.022;
      vec2 d = vUv - 0.5;
      c.rgb *= mix(0.8, 1.0, smoothstep(0.95, 0.35, length(d * vec2(1.0, 0.9))));
      gl_FragColor = c;
    }`,
};

export class VanScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.05, 200);
  readonly van: Van;
  readonly controls: OrbitControls | null;
  private readonly composer: EffectComposer;
  private readonly grain: ShaderPass;
  private readonly sun = new DirectionalLight(0xffe4bc, 2.6);
  private readonly hemi = new HemisphereLight(0xdfe8f0, 0x8a7a5a, 0.7);
  private pose: Pose = { ...VIEWS.hero };
  private from: Pose | null = null;
  private goal: Pose = { ...VIEWS.hero };
  private flyT = 1;
  private time = 0;
  view: VanView = 'hero';
  /** 镜头由外面摆（第一人称）。飞行时照样由这里接管。 */
  external = false;
  get groundLevel(): number {
    return this.groundY;
  }
  /** 鼠标在画面里的位置（-1..1），家的视角随它轻轻错开。 */
  readonly mouse = new Vector2();

  constructor(
    private readonly host: HTMLElement,
    opts: { orbit?: boolean; island?: { field: ReliefField; input: IslandInput } } = {},
  ) {
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    const bg = new Color(0xefe6d2);
    this.scene.background = bg;
    this.scene.fog = new Fog(bg, 14, 34);

    this.sun.position.set(6, 9, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -6;
    sc.right = sc.top = 6;
    sc.near = 1;
    sc.far = 30;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target, this.hemi);
    // 环境光照（一间虚拟的亮屋子）：黄铜、搪瓷要有东西可反射，不然发黑。
    const pm = new PMREMGenerator(this.renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.ground(17);
    this.van = new Van();
    this.scene.add(this.van.root);
    if (opts.island) this.fillIslandTray(opts.island);

    this.controls = opts.orbit ? new OrbitControls(this.camera, this.renderer.domElement) : null;
    if (this.controls) {
      this.controls.enableDamping = true;
      this.controls.target.copy(this.pose.target);
      this.controls.maxPolarAngle = Math.PI * 0.49;
      this.controls.minDistance = 1.2;
      this.controls.maxDistance = 16;
    }
    paperGlobals.uCloudAmt.value = 0;

    const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new OutputPass());
    this.grain = new ShaderPass(GRAIN);
    this.composer.addPass(this.grain);
    this.renderer.domElement.addEventListener('pointermove', (e) => {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    });
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** 一块剪纸的地：几层沙色、草色的卡纸叠起来，边缘撕得不齐；上面立着草丛和野花。 */
  private ground(seed: number): void {
    const g = new Group();
    g.name = 'ground';
    const blob = (R: number, k: number, wob: number): Vector2[] => {
      const pts: Vector2[] = [];
      for (let i = 0; i < 80; i++) {
        const a = (i / 80) * Math.PI * 2;
        const r = R * (1 + (noise2(Math.cos(a) * 1.4 + k, Math.sin(a) * 1.4, seed + k) - 0.5) * wob);
        pts.push(new Vector2(Math.cos(a) * r * 1.25, Math.sin(a) * r));
      }
      return pts;
    };
    const layers: Array<[number, number, number]> = [
      [7.2, 0xd9c79c, 0],
      [6.4, 0xe6d6ad, 1],
      [5.6, 0xa9c773, 2],
      [4.6, 0x9bbd66, 3],
      [3.4, 0x8fb35d, 4],
    ];
    for (const [R, c, i] of layers) {
      const m = mesh(flat(blob(R, i * 3, 0.28), 0.04), card(c, 1.2, i < 2 ? 'kraft' : 'card'));
      m.rotation.x = -Math.PI / 2;
      m.position.y = -0.04 + i * 0.04;
      g.add(m);
    }
    ink(g, 40, true);
    this.scene.add(g);
    const top = -0.04 + 4 * 0.04 + 0.04;
    // 车在最上面一层；把车抬到这一层上。
    this.groundY = top;
    // 草和花：用岛上的那套剪纸植物，摆在车周围。
    const flora = buildFlora(seed);
    const rnd = rng(seed);
    const lists = new Map<string, PlantSpot[][]>();
    const put = (id: string, x: number, z: number, y: number, s = 1): void => {
      const k = flora.get(id)!;
      const h = (k.h[0] + rnd() * (k.h[1] - k.h[0])) * 2.4 * s;
      const tone = Math.floor(rnd() * 3);
      let arr = lists.get(id);
      if (!arr) lists.set(id, (arr = k.parts.map(() => [])));
      k.parts.forEach((part, j) => arr![j]!.push({ x, y, z, w: h * k.aspect, h, flip: rnd() < 0.5, color: part.colors[tone % part.colors.length]! }));
    };
    for (let i = 0; i < 420; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 1.6 + Math.sqrt(rnd()) * 3.6;
      const x = Math.cos(a) * r * 1.25;
      const z = Math.sin(a) * r;
      if (Math.abs(z) < 1.4 && x > -2.6 && x < 2.6) continue;
      const ring = r < 3.4 ? 4 : r < 4.6 ? 3 : r < 5.6 ? 2 : 1;
      const y = -0.04 + ring * 0.04 + 0.04;
      const pick = rnd();
      const id = ring <= 1 ? (pick < 0.7 ? 'dunegrass' : 'thrift') : pick < 0.55 ? 'grass' : pick < 0.7 ? 'tallgrass' : pick < 0.8 ? 'daisy' : pick < 0.88 ? 'buttercup' : pick < 0.94 ? 'clover' : 'fern';
      put(id, x, z, y);
    }
    for (const [x, z] of [
      [-4.2, -2.4],
      [4.6, -2.0],
      [-3.6, 2.8],
    ] as const)
      put('shrub', x, z, top, 1.6);
    put('tree', -4.6, 3.6, top, 2.2);
    put('pine', 5.0, 1.2, top, 2.0);
    for (const [id, arr] of lists) {
      const k = flora.get(id)!;
      k.parts.forEach((part, j) => this.scene.add(plantMesh(part.geom, arr[j]!, k.sway * 4, 0.5, 0.012)));
    }
  }

  private groundY = 0;

  /** 工作台上的托盘里放进这座岛的 A4 纸雕（和全屏地图同一套纸，裁一块、缩小）。 */
  private fillIslandTray(island: { field: ReliefField; input: IslandInput }): void {
    const slot = this.van.inside.islandSlot;
    const crop = cropField(island.field, -30, -20.5, 30, 20.5);
    const ao = bakeAo(crop, island.input.seed);
    const relief = buildRelief(crop, ao, island.input.seed, 0.45);
    const inner = new Group();
    inner.name = 'tray-island';
    ink(relief.group, 40, true);
    inner.add(relief.group, buildVegetation(crop, island.input, true));
    // 托盘里的小岛不投影（太小，台灯的影子已经够了），只接收。
    inner.traverse((o) => {
      o.castShadow = false;
    });
    const w = (crop.nx - 1) * crop.step;
    const d = (crop.nz - 1) * crop.step;
    const k = 0.42 / w;
    const bottom = levelTop(-SEA_LEVELS - 1) - CARD;
    const base = mesh(flat([new Vector2(-w / 2, -d / 2), new Vector2(w / 2, -d / 2), new Vector2(w / 2, d / 2), new Vector2(-w / 2, d / 2)], CARD), [paperMaterial(DEEP, { scale: 3 }), paperMaterial(DEEP, { edge: true })]);
    base.rotation.x = -Math.PI / 2;
    base.position.y = bottom + CARD / 2;
    inner.add(base);
    inner.scale.setScalar(k);
    inner.position.set(0, -bottom * k, 0);
    slot.add(inner);
    this.islandInner = inner;
  }

  /** 托盘里那座岛的内层（岛的坐标）：外面用它把岛上的点换算到房间里。 */
  islandInner: Group | null = null;

  setView(v: VanView, instant = false): void {
    this.view = v;
    const target = VIEWS[v];
    this.van.setCutaway(v === 'inside');
    this.van.setCamp(v === 'camp');
    this.van.setDoors(v === 'inside' || v === 'camp');
    this.flyTo(target, instant ? 0 : 1300);
  }

  flyTo(p: Pose, ms: number, done?: () => void): void {
    this.flyDone = done ?? null;
    const ahead = this.camera.position.clone().add(this.camera.getWorldDirection(new Vector3()).multiplyScalar(1.5));
    this.from = { pos: this.camera.position.clone(), target: this.controls ? this.controls.target.clone() : this.external ? ahead : this.pose.target.clone(), fov: this.camera.fov };
    this.goal = { pos: p.pos.clone(), target: p.target.clone(), fov: p.fov };
    this.flyT = ms <= 0 ? 1 : 0;
    this.flyMs = ms;
    if (ms <= 0) this.applyPose(this.goal);
  }

  private flyMs = 1300;
  private flyDone: (() => void) | null = null;
  /** 正在飞（不接受点击）。 */
  get flying(): boolean {
    return this.flyT < 1;
  }
  /** 当前的镜头（给外面换算用）。 */
  currentPose(): Pose {
    return { pos: this.camera.position.clone(), target: this.pose.target.clone(), fov: this.camera.fov };
  }
  static pose(v: VanView): Pose {
    return { pos: VIEWS[v].pos.clone(), target: VIEWS[v].target.clone(), fov: VIEWS[v].fov };
  }

  private applyPose(p: Pose): void {
    this.pose = p;
    this.camera.position.copy(p.pos);
    this.camera.fov = p.fov;
    this.camera.updateProjectionMatrix();
    if (this.controls) this.controls.target.copy(p.target);
    this.camera.lookAt(p.target);
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
    this.van.root.position.y = this.groundY;
    if (this.flyT < 1 && this.from) {
      this.flyT = Math.min(1, this.flyT + (dt * 1000) / this.flyMs);
      const t = this.flyT;
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      this.applyPose({ pos: this.from.pos.clone().lerp(this.goal.pos, e), target: this.from.target.clone().lerp(this.goal.target, e), fov: this.from.fov + (this.goal.fov - this.from.fov) * e });
      if (this.flyT >= 1) {
        const d = this.flyDone;
        this.flyDone = null;
        d?.();
      }
    } else if (this.controls) {
      this.controls.update();
    } else if (this.external) {
      // 第一人称：镜头归外面（Walker）摆。
    } else {
      // 家的视角：随鼠标轻轻错开（像坐着歪一下头）。
      this.camera.position.copy(this.pose.pos).add(V3(this.mouse.x * 0.18, this.mouse.y * 0.08, 0));
      this.camera.lookAt(this.pose.target);
    }
    this.van.update(dt);
    plantUniforms.uCam.value.copy(this.camera.position);
    plantUniforms.uLean.value = 0.15;
    plantUniforms.uTime.value = this.time;
    this.grain.uniforms['uTime']!.value = this.time;
    if (render) this.composer.render(dt);
  }
}

export type { Mesh };
