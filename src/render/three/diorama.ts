import {
  ACESFilmicToneMapping,
  AmbientLight,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PointLight,
  RepeatWrapping,
  Scene,
  Shape,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { brass, paperMaterial, slab } from './paper';

/**
 * 3D 纸剧场（2026-11-22，新渲染架构的第一块）：一座摆在夜里工作台上的手工纸剧场，全部由代码生成——
 * 每一层布景都是真的纸片（有厚度、断面发白、纸纹），按前后摆在不同深度；
 * 一盏台灯从左上方照进来，台口里还有一排暖光，层与层之间是真实的投影；镜头随鼠标移动，景深虚化远处。
 *
 * 形状（远山、海浪、草叶、灌丛的叶子、云）都是程序生成的曲线，所以能动：海浪一层层起伏、草在风里摆、云在飘，
 * 天色和灯光跟着一天的时间变；草的高度、洞里有没有幼崽，由外面按推演的状态给。
 * 单位是米。台面（剧场的地板）在 y = 0，台口正中 x = 0，台口的前沿在 z = 0.6。
 */

/** 可复现的随机数。 */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
}

/** 一维的平滑噪声（几层正弦叠起来，可复现）。 */
function wave1d(seed: number): (x: number) => number {
  const r = rng(seed);
  const parts = Array.from({ length: 5 }, (_, i) => ({ f: (0.6 + r() * 0.8) * 1.9 ** i, p: r() * 6.28, a: 0.55 ** i }));
  const total = parts.reduce((s, p) => s + p.a, 0);
  return (x) => parts.reduce((s, p) => s + Math.sin(x * p.f + p.p) * p.a, 0) / total;
}

/** 上沿是 top(x) 的一条纸（从 x0 到 x1，往下到 bottom）。 */
function bandShape(x0: number, x1: number, bottom: number, top: (x: number) => number, step = 0.03): Shape {
  const s = new Shape();
  s.moveTo(x0, bottom);
  for (let x = x0; x <= x1 + 1e-6; x += step) s.lineTo(x, top(x));
  s.lineTo(x1, bottom);
  s.closePath();
  return s;
}

export interface DioramaState {
  /** 一天里的小时（0–24，可以是小数）。 */
  hour: number;
  /** 草有多高（0–1）。 */
  grass: number;
  /** 洞里有几只幼崽（0–3）。 */
  kits: number;
}

export class Diorama {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(19, 16 / 9, 0.1, 80);
  private readonly composer: EffectComposer;
  private readonly bokeh: BokehPass;
  /** 台上走动的东西放这里（动物）：脚底在 y = 0 的平面上，z 在 LANE_Z 附近。 */
  readonly stage = new Group();
  private readonly lamp: SpotLight;
  private readonly stageLight: SpotLight;
  private readonly fill: HemisphereLight;
  private readonly sunLight: DirectionalLight;
  private readonly glow: PointLight;
  private readonly skyCanvas = document.createElement('canvas');
  private readonly skyTex: CanvasTexture;
  private skyKey = '';
  private readonly sun: Group;
  private readonly moon: Group;
  private readonly clouds: { g: Group; x: number; v: number }[] = [];
  private readonly seas: { g: Group; y: number; amp: number; phase: number; drift: number }[] = [];
  private readonly sway: { uTime: { value: number } }[] = [];
  private readonly grassTall: InstancedMesh[] = [];
  private readonly kitGroup = new Group();
  private readonly mouse = new Vector2();
  private readonly camPos = new Vector3(0, 1.9, 12.4);
  private time = 0;

  /** 动物走的那几条线的 z（台上的草地，从后往前）。 */
  static readonly LANES = [-0.75, -0.55, -0.35];
  /** 台上草地的高度（动物的脚踩在这里）。 */
  static readonly FLOOR = 0.42;
  /** 纸偶在剧场里的比例（真实身长 × 这个数）：玩具剧场里的动物要看得清。 */
  static readonly PUPPET_SCALE = 2.1;
  /** 台口开口的宽和高。 */
  static readonly OPEN = { w: 4.6, h: 2.5 };

  constructor(host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new Color(0x0a0d18);
    this.scene.fog = new Fog(0x0a0d18, 16, 30);

    // ---- 灯 ----
    // 台灯：左上前方，暖，打出主要的投影。
    this.lamp = new SpotLight(0xffc98a, 120, 30, 0.55, 0.65, 1.6);
    this.lamp.position.set(-4.2, 6.2, 6.5);
    this.lamp.target.position.set(0.2, 0.8, -1.2);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(2048, 2048);
    this.lamp.shadow.bias = -0.0004;
    this.lamp.shadow.normalBias = 0.01;
    this.lamp.shadow.radius = 5;
    this.scene.add(this.lamp, this.lamp.target);
    // 台口上沿藏着的一排灯：从上往下照布景，给每一层上沿一道亮边、下面投影。
    this.stageLight = new SpotLight(0xffe2b8, 55, 14, 0.9, 0.8, 1.4);
    this.stageLight.position.set(0.6, 4.2, 1.6);
    this.stageLight.target.position.set(0, 0.5, -1.2);
    this.stageLight.castShadow = true;
    this.stageLight.shadow.mapSize.set(2048, 2048);
    this.stageLight.shadow.bias = -0.0004;
    this.stageLight.shadow.radius = 4;
    this.scene.add(this.stageLight, this.stageLight.target);
    // 天光（白天的太阳 / 夜里的月光），从布景的后上方来，给远景一点逆光。
    this.sunLight = new DirectionalLight(0xffffff, 0.6);
    this.sunLight.position.set(2, 5, -6);
    this.scene.add(this.sunLight);
    this.fill = new HemisphereLight(0x8fa6d8, 0x2a1a10, 0.35);
    this.scene.add(this.fill, new AmbientLight(0x1a2040, 0.25));
    // 洞里的一点暖光。
    this.glow = new PointLight(0xffa24a, 0, 1.2, 2);

    // ---- 天 ----
    this.skyCanvas.width = 64;
    this.skyCanvas.height = 256;
    this.skyTex = new CanvasTexture(this.skyCanvas);
    this.skyTex.colorSpace = SRGBColorSpace;
    const skyMat = new MeshStandardMaterial({ map: this.skyTex, roughness: 1, emissive: 0xffffff, emissiveMap: this.skyTex, emissiveIntensity: 0.55 });
    const sky = new Mesh(new PlaneGeometry(4.75, 3.4), skyMat);
    sky.position.set(0, 1.5, -2.75);
    sky.receiveShadow = true;
    this.scene.add(sky);
    this.sun = this.sunShape();
    this.moon = this.moonShape();
    this.scene.add(this.sun, this.moon);
    const cr = rng(31);
    for (let i = 0; i < 5; i++) {
      const g = this.cloud(cr, 0.45 + cr() * 0.35);
      const x = -2.1 + i * 0.95 + cr() * 0.3;
      g.position.set(x, 1.8 + cr() * 0.45, -2.5 + cr() * 0.15);
      this.scene.add(g);
      this.clouds.push({ g, x, v: 0.04 + cr() * 0.05 });
    }

    // ---- 远山、离岛 ----
    const hills: Array<[number, number, number, number, number]> = [
      // z, 底, 高, 起伏, 颜色
      [-2.4, 0.6, 1.36, 0.2, 0x8292b4],
      [-2.25, 0.6, 1.24, 0.15, 0x6a7ca0],
    ];
    hills.forEach(([z, base, top, amp, color], i) => {
      const n = wave1d(100 + i);
      this.paperLayer(bandShape(-2.36, 2.36, base - 1.5, (x) => top + n(x * 0.8) * amp), 0.012, color, z, false, 1.2);
    });
    this.scene.add(this.islet(-2.05));

    // ---- 海：四层，远的深、近的浅；每层上沿一条白色的浪花纸 ----
    const seaCols = [0x1f3a6e, 0x285394, 0x3778b5, 0x63a5cf];
    seaCols.forEach((c, i) => {
      const z = -1.95 + i * 0.2;
      const top = 1.08 - i * 0.07;
      const amp = 0.025 + i * 0.022;
      const f = 1.6 - i * 0.22;
      const n = wave1d(200 + i);
      const g = new Group();
      const surf = (x: number): number => top + Math.sin(x * f * 2.2 + i) * amp + n(x * 1.3) * amp * 0.8;
      g.add(this.mesh(bandShape(-2.5, 2.5, -0.8, surf, 0.02), 0.012, c, 0.8));
      // 浪花：沿上沿一条撕开的白纸，下沿毛糙。
      const foamN = wave1d(300 + i);
      const fs = new Shape();
      fs.moveTo(-2.5, surf(-2.5) + 0.012);
      for (let x = -2.5; x <= 2.5; x += 0.02) fs.lineTo(x, surf(x) + 0.012 + Math.max(0, foamN(x * 2.5)) * (0.03 + i * 0.012));
      for (let x = 2.5; x >= -2.5; x -= 0.015) fs.lineTo(x, surf(x) - 0.018 - Math.abs(foamN(x * 9 + 4)) * 0.035);
      fs.closePath();
      const foam = this.mesh(fs, 0.004, 0xf4efe4, 0.5);
      foam.position.z = 0.014;
      g.add(foam);
      g.position.z = z;
      this.scene.add(g);
      this.seas.push({ g, y: 0, amp: 0.012 + i * 0.008, phase: i * 1.3, drift: (i % 2 ? 1 : -1) * (0.05 + i * 0.03) });
    });

    // ---- 远岸的灌丛 ----
    const br = rng(41);
    for (const [x, sz] of [[-2.05, 0.3], [-1.55, 0.2], [1.85, 0.34], [2.25, 0.22], [-0.2, 0.16]] as const) {
      const b = this.bush(br, sz, 0x2a4a2a);
      b.position.set(x + (br() - 0.5) * 0.1, 0.6, -1.08 - br() * 0.05);
      this.scene.add(b);
    }

    // ---- 后面一道草坡（动物站在它前面） ----
    const ridgeN = wave1d(51);
    this.paperLayer(bandShape(-2.34, 2.34, 0, (x) => 0.6 + ridgeN(x * 0.9) * 0.05), 0.014, 0x86a046, -1.02, true, 0.8);
    this.grassRow(-0.99, 0.57, 0.12, 0x6f8f33, 0xa9bd55, 61, 120, false, 2.4);
    // 台上的草地：一张平放的纸，动物站在上面（接得住投影）。
    const meadow = new Mesh(new PlaneGeometry(4.66, 1.2), paperMaterial(0x93a94c, { scale: 0.5 }));
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.set(0, Diorama.FLOOR, -0.5);
    meadow.receiveShadow = true;
    this.scene.add(meadow);
    // 草地上零星的几丛矮草。
    this.grassRow(-0.6, Diorama.FLOOR, 0.1, 0x6f8f33, 0xb4c25a, 62, 70, false, 2.2);

    // ---- 台上走动的东西 ----
    this.scene.add(this.stage);

    // ---- 前面一层地：上沿是草，下面是土层的剖面，中间剖出一个洞 ----
    this.scene.add(this.groundFront(-0.08));
    // 前沿的一排草（会被啃短），和两丛橙黄的草。
    this.grassRow(-0.06, Diorama.FLOOR - 0.04, 0.2, 0x5c8a2e, 0xb7c457, 71, 150, true, 2.4);
    this.grassRow(0.12, Diorama.FLOOR - 0.3, 0.42, 0x8a6a24, 0xe0a046, 81, 22, true, 2.3, [-1.9, 1.95]);
    // 剧场是一个盒子：两边、顶上是深色的硬卡纸，布景都收在里面。
    this.scene.add(this.box());

    // ---- 台口 ----
    this.scene.add(this.proscenium());
    // ---- 工作台 ----
    this.scene.add(this.table());

    // ---- 后期：景深 ----
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 12.8, aperture: 0.00045, maxblur: 0.005 });
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new OutputPass());

    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    });
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = this.renderer.domElement.parentElement?.clientWidth ?? window.innerWidth;
    const h = this.renderer.domElement.parentElement?.clientHeight ?? window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    // 窄的屏幕往后退一点，整个台口都放得下。
    this.camPos.z = 12.4 * Math.max(1, (16 / 9 / this.camera.aspect) * 0.92);
    this.camera.updateProjectionMatrix();
  }

  // ---- 构件 ----

  private mesh(shape: Shape, depth: number, color: number, scale = 0.35): Mesh {
    const { geometry, materials } = slab(shape, depth, color, scale);
    const m = new Mesh(geometry, materials);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  private paperLayer(shape: Shape, depth: number, color: number, z: number, cast = true, scale = 0.35): Mesh {
    const m = this.mesh(shape, depth, color, scale);
    m.position.z = z;
    m.castShadow = cast;
    this.scene.add(m);
    return m;
  }

  private sunShape(): Group {
    const g = new Group();
    const rays = new Shape();
    const n = 16;
    for (let i = 0; i <= n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const r = i % 2 === 0 ? 0.36 : 0.24;
      if (i === 0) rays.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else rays.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const r1 = this.mesh(rays, 0.008, 0xf08a2a);
    const disc = new Mesh(new CircleGeometry(0.22, 48), paperMaterial(0xf6b23c, { emissive: 0xffa030 }));
    disc.position.z = 0.012;
    const ring = new Mesh(new CircleGeometry(0.235, 48), paperMaterial(0xc4532a));
    ring.position.z = 0.009;
    g.add(r1, ring, disc);
    g.position.z = -2.6;
    return g;
  }

  private moonShape(): Group {
    const g = new Group();
    const s = new Shape();
    s.absarc(0, 0, 0.22, 0, Math.PI * 2, false);
    const hole = new Shape();
    hole.absarc(0.1, 0.06, 0.2, 0, Math.PI * 2, true);
    s.holes.push(hole);
    const m = this.mesh(s, 0.008, 0xf3ead2);
    (m.material as Material[])[0] = paperMaterial(0xf3ead2, { emissive: 0xfff2c8 });
    g.add(m);
    g.position.z = -2.6;
    return g;
  }

  /** 一朵云：几片圆纸叠起来，后面的颜色深一点。 */
  private cloud(r: () => number, size: number): Group {
    const g = new Group();
    for (let layer = 0; layer < 2; layer++) {
      const s = new Shape();
      const blobs = 4 + Math.floor(r() * 3);
      // 底边平，上面是几个鼓包。
      s.moveTo(-size, 0);
      for (let i = 0; i < blobs; i++) {
        const cx = -size + ((i + 0.5) / blobs) * size * 2;
        const rr = size * (0.28 + r() * 0.22) * (1 - Math.abs(cx / size) * 0.4);
        s.absarc(cx, 0, rr, Math.PI, 0, true);
      }
      s.lineTo(size, 0);
      s.closePath();
      const m = this.mesh(s, 0.006, layer === 0 ? 0xe9c9a6 : 0xf7efe2, 0.5);
      m.position.set(layer === 0 ? 0.03 : 0, layer === 0 ? -0.02 : 0, layer * 0.02);
      m.scale.setScalar(layer === 0 ? 1.04 : 1);
      g.add(m);
    }
    return g;
  }

  private islet(z: number): Group {
    const g = new Group();
    const r = rng(77);
    const rock = (x: number, w: number, h: number, c: number, dz: number): void => {
      const s = new Shape();
      s.moveTo(x - w, 0);
      const k = 5;
      for (let i = 0; i <= k; i++) {
        const t = i / k;
        s.lineTo(x - w + t * w * 2 + (r() - 0.5) * w * 0.2, h * Math.sin(t * Math.PI) * (0.7 + r() * 0.5));
      }
      s.lineTo(x + w, 0);
      s.closePath();
      const m = this.mesh(s, 0.01, c, 0.6);
      m.position.z = dz;
      g.add(m);
    };
    rock(0, 0.7, 0.34, 0x7b7f78, 0);
    rock(-0.35, 0.35, 0.22, 0x8e918a, 0.02);
    rock(0.4, 0.3, 0.18, 0x6b6e68, 0.03);
    const b = this.bush(r, 0.32, 0x3c6136);
    b.position.set(0.05, 0.22, -0.02);
    b.scale.setScalar(0.75);
    g.add(b);
    g.position.set(1.15, 1.04, z);
    g.scale.setScalar(0.8);
    return g;
  }

  /** 一丛灌丛：几十片叶子（每片一小块纸）堆成半圆。 */
  private bush(r: () => number, size: number, base = 0x2f5a2a): Group {
    const g = new Group();
    const leaf = new Shape();
    leaf.moveTo(0, 0);
    leaf.bezierCurveTo(0.035, 0.02, 0.035, 0.065, 0, 0.09);
    leaf.bezierCurveTo(-0.035, 0.065, -0.035, 0.02, 0, 0);
    const geo = new ExtrudeGeometry(leaf, { depth: 0.003, bevelEnabled: false, curveSegments: 6 });
    const count = Math.round(110 * (size / 0.4) ** 2);
    const mesh = new InstancedMesh(geo, paperMaterial(0xffffff, { scale: 0.25 }), count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const o = new Object3D();
    const c = new Color();
    const baseC = new Color(base);
    for (let i = 0; i < count; i++) {
      // 半圆形的轮廓里随机撒叶子，靠后的暗、靠前的亮。
      const a = r() * Math.PI;
      const rad = Math.sqrt(r()) * size;
      const depth = r();
      o.position.set(Math.cos(a) * rad * 1.3, Math.sin(a) * rad * 0.9, depth * 0.12);
      o.rotation.set(0, 0, (r() - 0.5) * 2.6 + (Math.cos(a) * -0.8));
      o.scale.setScalar(0.8 + r() * 0.7);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      c.copy(baseC).offsetHSL((r() - 0.5) * 0.05, (r() - 0.5) * 0.15, -0.08 + depth * 0.16 + (r() - 0.5) * 0.06);
      mesh.setColorAt(i, c);
    }
    g.add(mesh);
    return g;
  }

  /**
   * 一排草：每根草是一条弯的细纸条（实例化），根部在 y0，高度 h 上下浮动；风吹时顶部摆得多、根部不动。
   * bitable：草会被啃短（按外面给的草的高度缩）。
   */
  private grassRow(z: number, y0: number, h: number, c0: number, c1: number, seed: number, count: number, bitable = false, span = 3.5, clumps?: number[]): void {
    const r = rng(seed);
    const blade = new Shape();
    const w = 0.022;
    blade.moveTo(-w, 0);
    blade.quadraticCurveTo(-w * 0.6, 0.55, 0.02, 1);
    blade.quadraticCurveTo(w * 0.4, 0.5, w, 0);
    blade.closePath();
    const geo = new ExtrudeGeometry(blade, { depth: 0.002, bevelEnabled: false, curveSegments: 5 });
    const mat = paperMaterial(0xffffff, { scale: 0.2 });
    const uTime = { value: 0 };
    const m2 = mat.clone();
    m2.onBeforeCompile = (sh) => {
      mat.onBeforeCompile(sh, this.renderer);
      sh.uniforms['uTime'] = uTime;
      sh.vertexShader = sh.vertexShader
        .replace('void main() {', 'uniform float uTime;\nattribute float aPhase;\nvoid main() {')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nfloat sw = position.y * position.y;\ntransformed.x += sw * (sin(uTime * 1.3 + aPhase) * 0.09 + sin(uTime * 2.9 + aPhase * 1.7) * 0.03);');
    };
    m2.customProgramCacheKey = () => 'grass-sway';
    const mesh = new InstancedMesh(geo, m2, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const phase = new Float32Array(count);
    const o = new Object3D();
    const c = new Color();
    const a = new Color(c0);
    const b = new Color(c1);
    for (let i = 0; i < count; i++) {
      // 一丛一丛：先挑一丛的中心，草在它附近。
      const clump = Math.floor(r() * (count / 8));
      const cx = clumps ? clumps[clump % clumps.length]! : -span + ((clump * 0.618) % 1) * span * 2;
      o.position.set(cx + (r() - 0.5) * 0.35, y0, z + (r() - 0.5) * 0.08);
      o.rotation.set(0, (r() - 0.5) * 0.6, (r() - 0.5) * 0.7);
      const hh = h * (0.55 + r() * 0.7);
      o.scale.set(0.7 + r() * 0.8, hh, 1);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      c.copy(a).lerp(b, r() ** 1.5).offsetHSL(0, 0, (r() - 0.5) * 0.08);
      mesh.setColorAt(i, c);
      phase[i] = cx * 1.7 + r() * 0.8;
    }
    geo.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
    this.scene.add(mesh);
    this.sway.push({ uTime });
    if (bitable) this.grassTall.push(mesh);
  }

  /** 前面一层地：上沿一排草尖，下面三层土（颜色由浅到深），中间剖出一个洞，洞里有干草、暖光，可以窝着幼崽。 */
  private groundFront(z: number): Group {
    const g = new Group();
    const W = 2.33;
    const n = wave1d(91);
    const holeX = 0.75;
    const holeY = 0.02;
    const hole = (): Shape => {
      const h = new Shape();
      h.absellipse(holeX, holeY, 0.3, 0.2, 0, Math.PI * 2, true, 0);
      return h;
    };
    const strata: Array<[number, number]> = [
      [Diorama.FLOOR - 0.02, 0x8b5a33],
      [0.18, 0x6e4426],
      [-0.12, 0x5a3820],
      [-0.36, 0x47301c],
    ];
    strata.forEach(([top, color], i) => {
      const s = bandShape(-W, W, -0.62, (x) => top + n(x * 1.6 + i * 3) * 0.035, 0.03);
      if (top > holeY - 0.2 && top - 0.25 < holeY + 0.2) s.holes.push(hole());
      const m = this.mesh(s, 0.01, color, 0.3);
      m.position.z = i * 0.012;
      g.add(m);
    });
    // 根须：几条细的浅色纸条。
    const rr = rng(93);
    for (let i = 0; i < 14; i++) {
      const x0 = -W + 0.2 + rr() * (W * 2 - 0.4);
      if (Math.abs(x0 - holeX) < 0.4) continue;
      const s = new Shape();
      s.moveTo(x0 - 0.006, 0.38);
      let x = x0;
      let y = 0.38;
      const pts: Array<[number, number]> = [];
      for (let k = 0; k < 6; k++) {
        x += (rr() - 0.5) * 0.06;
        y -= 0.04 + rr() * 0.04;
        pts.push([x, y]);
      }
      for (const [px, py] of pts) s.lineTo(px - 0.004, py);
      for (const [px, py] of pts.reverse()) s.lineTo(px + 0.004, py);
      s.lineTo(x0 + 0.006, 0.38);
      const m = this.mesh(s, 0.002, 0xd9b98a, 0.2);
      m.position.z = 0.05;
      g.add(m);
    }
    // 洞的里面：一块暗的后壁、一层干草、一点暖光。
    const back = new Mesh(new CircleGeometry(0.32, 40), paperMaterial(0x2a170c));
    back.scale.set(1, 0.68, 1);
    back.position.set(holeX, holeY, -0.14);
    back.receiveShadow = true;
    g.add(back);
    const straw = new Shape();
    straw.moveTo(holeX - 0.26, holeY - 0.17);
    for (let i = 0; i <= 20; i++) straw.lineTo(holeX - 0.26 + (i / 20) * 0.52, holeY - 0.11 + (i % 2 ? 0.03 : 0) + Math.sin(i) * 0.01);
    straw.lineTo(holeX + 0.26, holeY - 0.17);
    straw.closePath();
    const sm = this.mesh(straw, 0.01, 0xd6a75a, 0.15);
    sm.position.z = -0.06;
    g.add(sm);
    this.kitGroup.position.set(holeX, holeY - 0.12, -0.08);
    g.add(this.kitGroup);
    this.glow.position.set(holeX, holeY + 0.05, 0.05);
    g.add(this.glow);
    g.position.z = z;
    return g;
  }

  /** 台口：深靛蓝的硬卡纸框，四角包黄铜，上沿垂着一排扇形的帷幕，下面一条台座。 */
  private proscenium(): Group {
    const g = new Group();
    const { w, h } = Diorama.OPEN;
    const bw = 0.32;
    const outer = new Shape();
    outer.moveTo(-w / 2 - bw, -0.62);
    outer.lineTo(w / 2 + bw, -0.62);
    outer.lineTo(w / 2 + bw, h + bw);
    outer.lineTo(-w / 2 - bw, h + bw);
    outer.closePath();
    const open = new Shape();
    open.moveTo(-w / 2, -0.05);
    open.lineTo(-w / 2, h);
    open.lineTo(w / 2, h);
    open.lineTo(w / 2, -0.05);
    open.closePath();
    outer.holes.push(open);
    const frame = this.mesh(outer, 0.06, 0x2e4382, 0.4);
    frame.position.z = 0.55;
    g.add(frame);
    // 一道细的金色内框。
    const lip = new Shape();
    const e = 0.04;
    lip.moveTo(-w / 2 - e, -0.05 - e);
    lip.lineTo(w / 2 + e, -0.05 - e);
    lip.lineTo(w / 2 + e, h + e);
    lip.lineTo(-w / 2 - e, h + e);
    lip.closePath();
    const lipHole = new Shape();
    lipHole.moveTo(-w / 2, -0.05);
    lipHole.lineTo(-w / 2, h);
    lipHole.lineTo(w / 2, h);
    lipHole.lineTo(w / 2, -0.05);
    lipHole.closePath();
    lip.holes.push(lipHole);
    const lipM = new Mesh(new ExtrudeGeometry(lip, { depth: 0.01, bevelEnabled: false }), brass);
    lipM.position.z = 0.61;
    lipM.castShadow = true;
    g.add(lipM);
    // 黄铜包角。
    const corner = new Shape();
    corner.moveTo(0, 0);
    corner.lineTo(0.42, 0);
    corner.lineTo(0, 0.42);
    corner.closePath();
    const cGeo = new ExtrudeGeometry(corner, { depth: 0.012, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 2 });
    const cs: Array<[number, number, number]> = [
      [-w / 2 - bw, -0.62, 0],
      [w / 2 + bw, -0.62, Math.PI / 2],
      [w / 2 + bw, h + bw, Math.PI],
      [-w / 2 - bw, h + bw, -Math.PI / 2],
    ];
    for (const [x, y, rot] of cs) {
      const m = new Mesh(cGeo, brass);
      m.position.set(x, y, 0.615);
      m.rotation.z = rot;
      m.castShadow = true;
      g.add(m);
      // 包角上的小铆钉。
      const rv = new Mesh(new CircleGeometry(0.03, 16), brass);
      rv.position.set(x + Math.cos(rot + Math.PI / 4) * 0.13, y + Math.sin(rot + Math.PI / 4) * 0.13, 0.64);
      g.add(rv);
    }
    // 帷幕：一排扇形，靛蓝和柿子橙相间，每片微微前后错开、往下垂成弧。
    const n = 14;
    const sw = w / n;
    for (let i = 0; i < n; i++) {
      const s = new Shape();
      const len = 0.42 + Math.sin((i / (n - 1)) * Math.PI) * -0.06;
      s.moveTo(-sw / 2, 0);
      s.lineTo(sw / 2, 0);
      s.lineTo(sw / 2, -len + sw / 2);
      s.absarc(0, -len + sw / 2, sw / 2, 0, Math.PI, true);
      s.lineTo(-sw / 2, 0);
      const m = this.mesh(s, 0.006, i % 2 ? 0xe2702e : 0x2a3a6c, 0.3);
      m.position.set(-w / 2 + sw * (i + 0.5), h + 0.02, 0.5 + (i % 2) * 0.012);
      m.rotation.x = -0.12;
      g.add(m);
    }
    // 帷幕上沿的一条横楣。
    const bar = new Shape();
    bar.moveTo(-w / 2, 0);
    bar.lineTo(w / 2, 0);
    bar.lineTo(w / 2, 0.08);
    bar.lineTo(-w / 2, 0.08);
    bar.closePath();
    const barM = this.mesh(bar, 0.03, 0x1c2648, 0.3);
    barM.position.set(0, h - 0.04, 0.52);
    g.add(barM);
    return g;
  }

  /** 剧场的盒子：左右两面墙、顶，深靛蓝的卡纸，从台口一直到最后的天幕。 */
  private box(): Group {
    const g = new Group();
    const { w, h } = Diorama.OPEN;
    const depth = 3.35;
    const wall = new PlaneGeometry(depth, h + 0.7);
    const mat = paperMaterial(0x1b2546, { scale: 0.6 });
    for (const side of [-1, 1]) {
      const m = new Mesh(wall, mat);
      m.rotation.y = side * -Math.PI / 2;
      m.position.set(side * (w / 2 + 0.02), (h - 0.6) / 2, 0.5 - depth / 2);
      m.receiveShadow = true;
      g.add(m);
    }
    const top = new Mesh(new PlaneGeometry(w + 0.1, depth), mat);
    top.rotation.x = Math.PI / 2;
    top.position.set(0, h + 0.02, 0.5 - depth / 2);
    g.add(top);
    return g;
  }

  /** 工作台：胡桃木的桌面，木纹是程序画的。 */
  private table(): Mesh {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, '#5a3420');
    grad.addColorStop(1, '#40241a');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 256);
    const r = rng(5);
    for (let i = 0; i < 90; i++) {
      const y = r() * 256;
      g.strokeStyle = `rgba(${20 + r() * 30},${10 + r() * 15},${5},${0.15 + r() * 0.25})`;
      g.lineWidth = 0.5 + r() * 2.5;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= 1024; x += 32) g.lineTo(x, y + Math.sin(x / (60 + r() * 80) + i) * (2 + r() * 4));
      g.stroke();
    }
    const tex = new CanvasTexture(c);
    tex.colorSpace = SRGBColorSpace;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(2, 3);
    const m = new Mesh(new PlaneGeometry(30, 14), new MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05, color: 0xd8b8a0 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(0, -0.62, 3);
    m.receiveShadow = true;
    return m;
  }

  // ---- 每帧 ----

  /** 天色：按小时给天的上、中、下三种颜色（白天、黄昏、夜里插值）。 */
  private skyColors(h: number): { top: Color; mid: Color; low: Color; day: number; dusk: number; night: number } {
    const day = h >= 7.5 && h < 16 ? 1 : h >= 5.5 && h < 7.5 ? (h - 5.5) / 2 : h >= 16 && h < 18 ? 1 - (h - 16) / 2 : 0;
    const night = h >= 20 || h < 4 ? 1 : h >= 18 && h < 20 ? (h - 18) / 2 : h >= 4 && h < 5.5 ? 1 - (h - 4) / 1.5 : 0;
    const dusk = Math.max(0, 1 - day - night);
    const mix = (d: number, k: number, n: number): Color => new Color(d).multiplyScalar(day).add(new Color(k).multiplyScalar(dusk)).add(new Color(n).multiplyScalar(night));
    return { top: mix(0x7fb0dc, 0x2b3a6e, 0x0b1430), mid: mix(0xb8d6ea, 0x8a5a7a, 0x16224a), low: mix(0xf1ead8, 0xf29a4a, 0x22305a), day, dusk, night };
  }

  update(dt: number, s: DioramaState): void {
    this.time += dt;
    const t = this.time;
    const sky = this.skyColors(s.hour);
    const key = `${sky.top.getHexString()}${sky.mid.getHexString()}${sky.low.getHexString()}`;
    if (key !== this.skyKey) {
      this.skyKey = key;
      const g = this.skyCanvas.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, `#${sky.top.getHexString()}`);
      grad.addColorStop(0.55, `#${sky.mid.getHexString()}`);
      grad.addColorStop(1, `#${sky.low.getHexString()}`);
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 256);
      this.skyTex.needsUpdate = true;
    }
    // 太阳从左边升、右边落，月亮反过来。
    const arc = (hh: number, from: number): [number, number] => {
      const k = ((hh - from + 24) % 24) / 15;
      return [-2.0 + k * 4.0, 1.3 + Math.sin(Math.min(1, Math.max(0, k)) * Math.PI) * 0.95];
    };
    const [sx, sy] = arc(s.hour, 5.5);
    this.sun.position.set(sx, sy, -2.6);
    this.sun.visible = sky.night < 0.95;
    this.sun.rotation.z = t * 0.05;
    const [mx, my] = arc(s.hour, 17.5);
    this.moon.position.set(mx, my, -2.6);
    this.moon.visible = sky.night > 0.05;
    // 灯光：白天亮而偏白，黄昏偏暖，夜里只剩台灯和台口里的灯。
    this.sunLight.color.set(sky.day > 0.5 ? 0xfff4e0 : sky.dusk > 0.5 ? 0xff9a5a : 0x7f90d8);
    this.sunLight.intensity = 0.25 + sky.day * 0.7 + sky.dusk * 0.4;
    this.stageLight.intensity = 30 + sky.day * 30 + sky.dusk * 15;
    this.stageLight.color.set(sky.night > 0.5 ? 0xc8d0ff : 0xffe2b8);
    this.fill.intensity = 0.2 + sky.day * 0.35;
    this.glow.intensity = s.kits > 0 ? 0.35 : 0.12;
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > 2.9) c.x = -2.9;
      c.g.position.x = c.x;
    }
    for (const w of this.seas) {
      w.g.position.y = Math.sin(t * 0.55 + w.phase) * w.amp;
      w.g.position.x = Math.sin(t * 0.17 + w.phase) * w.drift;
    }
    for (const sw of this.sway) sw.uTime.value = t;
    // 草被啃短：前景的草整排压矮。
    const g = 0.35 + 0.65 * Math.min(1, s.grass / 0.6);
    for (const m of this.grassTall) m.scale.y += (g - m.scale.y) * Math.min(1, dt * 2);
    // 镜头：跟着鼠标轻轻移，自己也慢慢呼吸。
    const tx = this.mouse.x * 0.9 + Math.sin(t * 0.13) * 0.1;
    const ty = -this.mouse.y * 0.45 + Math.sin(t * 0.11) * 0.05;
    this.camera.position.x += (tx - this.camera.position.x) * Math.min(1, dt * 2.5);
    this.camera.position.y += (this.camPos.y + ty - this.camera.position.y) * Math.min(1, dt * 2.5);
    this.camera.position.z = this.camPos.z;
    this.camera.lookAt(this.camera.position.x * 0.5, 1.05, -0.6);
    (this.bokeh.uniforms as unknown as { focus: { value: number } }).focus.value = this.camera.position.distanceTo(new Vector3(0, 0.6, -0.4));
    this.composer.render(dt);
  }

  /** 洞里窝着的幼崽（外面给一个能放进洞里的对象）。 */
  setKits(objs: Object3D[]): void {
    this.kitGroup.clear();
    objs.forEach((o, i) => {
      o.position.set((i - (objs.length - 1) / 2) * 0.16, 0, 0);
      this.kitGroup.add(o);
    });
  }
}

/** 给外面用：一块平的纸（地面上的东西）。 */
export function flatGeometry(points: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(points, 3));
  return g;
}
