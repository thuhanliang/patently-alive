import {
  ACESFilmicToneMapping,
  BoxGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HalfFloatType,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SpotLight,
  SRGBColorSpace,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { brass, paperGlobals, paperMaterial, sheetGeometry } from './paper';
import { plantUniforms } from './plants';
import { CARD, DEEP, SEA_LEVELS, bakeAo, buildRelief, cropField, levelTop, type ReliefField } from './relief';
import { buildVegetation, type IslandInput } from './vegetation';

/**
 * 工作室（2026-11-22，用户：工作台是一个可以交互的小场景，桌上的纸雕是地图的入口）。
 *
 * 一张胡桃木的书桌靠着墙角，一盏台灯，桌上和墙上是一件件小东西——每一件以后都是一扇门：
 * 卡片抽屉是现有技术库，来信是委托，天平是体重分配，种子罐是植物图鉴，云的标本是天气，切割垫是设计台。
 * 正中间是这座岛的 A4 纸雕摆件（和全屏地图是同一套纸，只是裁成一块、按 A4 缩小），点它，镜头扎进去。
 *
 * 单位是米。桌面高 0.74。
 */

export interface StudioProp {
  id: string;
  name: string;
  hint: string;
  root: Object3D;
  /** 鼠标停上去时抬起多少（米）。 */
  lift: number;
  hover: number;
  baseY: number;
  onClick?: () => void;
}

export interface Pose {
  pos: Vector3;
  target: Vector3;
  fov: number;
}

const DESK_Y = 0.74;

const GRAIN = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      c.rgb += (rnd(floor(vUv * uRes) + fract(uTime * 7.13) * 113.0) - 0.5) * 0.03;
      vec2 d = vUv - 0.5;
      c.rgb *= mix(0.62, 1.0, smoothstep(0.95, 0.25, length(d * vec2(1.0, 0.9))));
      gl_FragColor = c;
    }`,
};

function wood(color: number, scale = 1): Material {
  return paperMaterial(color, { kind: 'wood', scale });
}

function rbox(w: number, h: number, d: number, r: number, mat: Material | Material[]): Mesh {
  const m = new Mesh(new RoundedBoxGeometry(w, h, d, 3, r), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function box(w: number, h: number, d: number, mat: Material | Material[]): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** 青海波的墙纸（照片里那种）：米色底上一圈圈浅灰的弧。 */
function wallpaper(): CanvasTexture {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  g.fillStyle = '#e9e2d4';
  g.fillRect(0, 0, N, N);
  g.strokeStyle = 'rgba(150, 140, 122, 0.55)';
  g.lineWidth = 2;
  const R = 32;
  for (let row = -1; row < N / (R / 2) + 2; row++)
    for (let col = -1; col < N / R + 2; col++) {
      const cx = col * R * 2 + (row % 2 ? R : 0);
      const cy = row * (R / 2);
      for (let k = 4; k >= 1; k--) {
        g.beginPath();
        g.fillStyle = '#e9e2d4';
        g.arc(cx, cy, (R * k) / 4, Math.PI, 0);
        if (k === 4) g.fill();
        g.stroke();
      }
    }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** 航空信封：米白的纸，一圈红蓝斜条。 */
function airmail(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 176;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f3ecdc';
  g.fillRect(0, 0, 256, 176);
  g.save();
  g.beginPath();
  g.rect(0, 0, 256, 176);
  g.rect(12, 12, 232, 152);
  g.clip('evenodd');
  for (let i = -20; i < 30; i++) {
    g.fillStyle = i % 2 ? '#c8423b' : '#2f5aa0';
    g.beginPath();
    g.moveTo(i * 16, 0);
    g.lineTo(i * 16 + 10, 0);
    g.lineTo(i * 16 + 10 - 176, 176);
    g.lineTo(i * 16 - 176, 176);
    g.fill();
  }
  g.restore();
  g.fillStyle = '#d9cdb3';
  g.fillRect(196, 24, 36, 44);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function label(text: string, w = 256, h = 64, bg = '#efe4c8', ink = '#3a2618'): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = ink;
  g.font = `${Math.round(h * 0.52)}px "LXGW WenKai Screen", "Kaiti SC", serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 2);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class Studio {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(38, 1, 0.01, 30);
  readonly props: StudioProp[] = [];
  /** 摆件：inner 是岛的坐标（1 = 一格），按 k 缩到米。 */
  readonly ornament = { root: new Group(), inner: new Group(), k: 0.297 / 64 };
  private readonly composer: EffectComposer;
  private readonly bokeh: BokehPass;
  private readonly grain: ShaderPass;
  private readonly lamp = new SpotLight(0xffc98a, 1.6, 0, 1.15, 1, 2);
  private bulb!: Mesh;
  private lampOn = true;
  private lampK = 1;
  private readonly hemi = new HemisphereLight(0xc4cfe8, 0x4a3828, 0.95);
  private readonly moon = new DirectionalLight(0x9fb4e0, 0.35);
  private readonly ray = new Raycaster();
  private readonly mouse = new Vector2(0, 0);
  private hovered: StudioProp | null = null;
  readonly home: Pose = { pos: new Vector3(0, 1.18, 0.9), target: new Vector3(0, 0.88, -0.2), fov: 36 };
  private pose: Pose = { pos: this.home.pos.clone(), target: this.home.target.clone(), fov: 36 };
  private flight: { from: Pose; to: Pose; t: number; ms: number; done?: (() => void) | undefined } | null = null;
  private time = 0;
  private drawer: Object3D | null = null;
  private drawerOpen = 0;
  private drawerGoal = 0;
  onHover: ((p: StudioProp | null, x: number, y: number) => void) | null = null;
  /** 镜头在飞时不接受点击。 */
  flying = false;

  constructor(
    private readonly host: HTMLElement,
    island: { field: ReliefField; input: IslandInput; name: string },
  ) {
    this.renderer = new WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new Color(0x15161c);

    this.room();
    this.desk();
    this.lights();
    this.buildOrnament(island);
    this.catalog();
    this.cabinet();
    this.letters();
    this.balance();
    this.shelf();
    this.cloudFrame();
    this.mat();

    const rt = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bokeh = new BokehPass(this.scene, this.camera, { focus: 0.75, aperture: 0.004, maxblur: 0.006 });
    this.composer.addPass(this.bokeh);
    this.composer.addPass(new OutputPass());
    this.grain = new ShaderPass(GRAIN);
    this.composer.addPass(this.grain);

    const el = this.renderer.domElement;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      this.mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.pick(e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', () => this.setHover(null, 0, 0));
    el.addEventListener('click', (e) => {
      if (this.flying) return;
      this.pick(e.clientX, e.clientY);
      this.hovered?.onClick?.();
    });
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ———— 房间 ————

  private room(): void {
    const paper = wallpaper();
    paper.repeat.set(9, 6);
    const wallMat = new MeshStandardMaterial({ map: paper, roughness: 1, color: 0xffffff });
    const back = new Mesh(new PlaneGeometry(1.7, 1.6), wallMat);
    back.position.set(0, DESK_Y + 0.8, -0.52);
    back.receiveShadow = true;
    const lp = paper.clone();
    lp.repeat.set(5, 6);
    const left = new Mesh(new PlaneGeometry(1.0, 1.6), new MeshStandardMaterial({ map: lp, roughness: 1 }));
    left.rotation.y = Math.PI / 2;
    left.position.set(-0.68, DESK_Y + 0.8, -0.02);
    left.receiveShadow = true;
    // 右边一幅亚麻的帘子：竖着的褶。
    const cg = new PlaneGeometry(0.9, 1.7, 60, 1);
    const p = cg.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      p.setZ(i, Math.sin(x * 38) * 0.018 + Math.sin(x * 11) * 0.01);
    }
    cg.computeVertexNormals();
    const curtain = new Mesh(cg, paperMaterial(0xd9d0bf, { kind: 'kraft', scale: 0.4 }));
    curtain.rotation.y = -Math.PI / 2;
    curtain.position.set(0.7, DESK_Y + 0.8, 0.0);
    curtain.receiveShadow = true;
    curtain.castShadow = true;
    this.scene.add(back, left, curtain);
  }

  private desk(): void {
    const top = rbox(1.36, 0.032, 0.74, 0.01, wood(0x5e3a22, 0.12));
    top.position.set(0, DESK_Y - 0.016, -0.15);
    this.scene.add(top);
  }

  private lights(): void {
    // 台灯：放在左后角，黄铜底座、竖杆、一根往前伸的臂，臂头一顶深色的灯罩，罩里一盏聚光灯照着摆件。
    const g = new Group();
    const foot = new Vector3(-0.56, 0, -0.42);
    const top = new Vector3(-0.56, 0.5, -0.42);
    const head = new Vector3(-0.2, 0.44, -0.24);
    const rod = (a: Vector3, b: Vector3, r: number): Mesh => {
      const len = a.distanceTo(b);
      const m = new Mesh(new CylinderGeometry(r, r, len, 16), brass);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
      return m;
    };
    const base = new Mesh(new CylinderGeometry(0.07, 0.08, 0.02, 40), brass);
    base.position.set(foot.x, 0.01, foot.z);
    const stem = rod(foot, top, 0.008);
    const knuckle = new Mesh(new SphereGeometry(0.014, 16, 10), brass);
    knuckle.position.copy(top);
    const arm = rod(top, head, 0.006);
    const shadeMat = new MeshStandardMaterial({ color: 0x2f3b36, metalness: 0.55, roughness: 0.42, side: 2 });
    const shade = new Mesh(new CylinderGeometry(0.03, 0.085, 0.1, 40, 1, true), shadeMat);
    shade.position.copy(head).add(new Vector3(0, -0.04, 0));
    shade.rotation.z = -0.25;
    this.bulb = new Mesh(new SphereGeometry(0.022, 20, 12), new MeshStandardMaterial({ color: 0xfff1d6, emissive: 0xffd9a0, emissiveIntensity: 2.2 }));
    this.bulb.position.copy(head).add(new Vector3(0, -0.07, 0));
    for (const m of [base, stem, arm, shade, knuckle]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    g.add(base, stem, knuckle, arm, shade, this.bulb);
    g.position.y = DESK_Y;
    this.scene.add(g);
    this.lamp.position.copy(head).add(new Vector3(0, DESK_Y - 0.08, 0));
    this.lamp.target.position.set(0.02, DESK_Y, -0.14);
    this.lamp.castShadow = true;
    this.lamp.shadow.mapSize.set(2048, 2048);
    this.lamp.shadow.bias = -0.0004;
    this.lamp.shadow.normalBias = 0.0015;
    this.lamp.shadow.camera.near = 0.05;
    this.lamp.shadow.camera.far = 2;
    this.scene.add(this.lamp, this.lamp.target, this.hemi, this.moon);
    this.moon.position.set(1.5, 2.5, 1.2);
    this.addProp({ id: 'lamp', name: '台灯', hint: '点一下开、关', root: g, lift: 0, onClick: () => (this.lampOn = !this.lampOn) });
  }

  // ———— 摆件：岛的 A4 纸雕 ————

  private buildOrnament(island: { field: ReliefField; input: IslandInput; name: string }): void {
    const { root, inner, k } = this.ornament;
    const crop = cropField(island.field, -32, -22.5, 32, 22.5);
    const ao = bakeAo(crop, island.input.seed);
    const relief = buildRelief(crop, ao, island.input.seed);
    inner.add(relief.group);
    inner.add(buildVegetation(crop, island.input));
    // 最底下一张整块的深海卡纸、一块木底板。
    const w = (crop.nx - 1) * crop.step;
    const d = (crop.nz - 1) * crop.step;
    const cx = crop.x0 + w / 2;
    const cz = crop.z0 + d / 2;
    const rect = [cx - w / 2, -(cz - d / 2), cx + w / 2, -(cz - d / 2), cx + w / 2, -(cz + d / 2), cx - w / 2, -(cz + d / 2)];
    const baseSheet = new Mesh(sheetGeometry([{ outer: rect }], CARD), [paperMaterial(DEEP, { scale: 3.2 }), paperMaterial(DEEP, { scale: 0.8, edge: true })]);
    baseSheet.geometry.rotateX(-Math.PI / 2);
    const bottom = levelTop(-SEA_LEVELS - 1) - CARD;
    baseSheet.position.y = bottom;
    baseSheet.receiveShadow = true;
    inner.add(baseSheet);
    inner.scale.setScalar(k);
    const plinthH = 0.014;
    inner.position.set(-cx * k, plinthH - bottom * k, -cz * k);
    const plinth = rbox(w * k + 0.022, plinthH, d * k + 0.022, 0.003, wood(0x4a2c1a, 0.25));
    plinth.position.y = plinthH / 2;
    // 底板前面一块黄铜铭牌。
    const plate = new Mesh(new PlaneGeometry(0.07, 0.011), new MeshStandardMaterial({ map: label(island.name, 256, 40, '#c9973f', '#3a2410'), metalness: 0.7, roughness: 0.35 }));
    plate.position.set(0, plinthH / 2, (d * k + 0.022) / 2 + 0.0004);
    root.add(plinth, plate, inner);
    root.position.set(-0.02, DESK_Y, -0.14);
    this.scene.add(root);
    this.addProp({ id: 'island', name: island.name, hint: '点一下，走进这座岛', root, lift: 0.006 });
  }

  // ———— 桌上的小东西 ————

  /** 卡片抽屉（现有技术库）：两只抽屉，黄铜的标签框和拉手；点一下抽屉拉出来。 */
  private catalog(): void {
    const g = new Group();
    const body = rbox(0.3, 0.13, 0.2, 0.004, wood(0x8b5a33, 0.2));
    body.position.y = 0.065;
    g.add(body);
    const names = ['现有技术', '物种档案'];
    names.forEach((n, i) => {
      const dr = new Group();
      const front = rbox(0.13, 0.1, 0.012, 0.003, wood(0x9c6a3e, 0.25));
      dr.add(front);
      const frame = new Mesh(new BoxGeometry(0.06, 0.026, 0.002), brass);
      frame.position.set(0, 0.022, 0.007);
      const tag = new Mesh(new PlaneGeometry(0.052, 0.019), new MeshStandardMaterial({ map: label(n, 256, 92), roughness: 1 }));
      tag.position.set(0, 0.022, 0.0082);
      const knob = new Mesh(new SphereGeometry(0.009, 16, 10), brass);
      knob.position.set(0, -0.018, 0.012);
      dr.add(frame, tag, knob);
      // 抽屉里的卡片（拉出来才看得见）。
      for (let c = 0; c < 9; c++) {
        const card = box(0.11, 0.075, 0.0015, paperMaterial(c % 3 ? 0xf2ead8 : 0xe6dcc4, { scale: 0.2 }));
        card.position.set(0, 0.005 + (c % 2) * 0.004, -0.02 - c * 0.016);
        card.rotation.x = -0.12;
        dr.add(card);
      }
      dr.position.set(-0.072 + i * 0.144, 0.065, 0.1);
      g.add(dr);
      if (i === 0) this.drawer = dr;
    });
    g.position.set(-0.32, DESK_Y, -0.4);
    this.scene.add(g);
    this.addProp({ id: 'catalog', name: '卡片抽屉', hint: '现有技术：前人设计过的动物（点一下拉开）', root: g, lift: 0, onClick: () => (this.drawerGoal = this.drawerGoal ? 0 : 1) });
  }

  /** 标本格：一个格子柜，每格一件小东西（纸做的晶簇、菊石、小罐）。以后放你拿到专利的动物。 */
  private cabinet(): void {
    const g = new Group();
    const W = 0.4;
    const H = 0.34;
    const D = 0.13;
    const t = 0.008;
    const mat = wood(0x7a4a2a, 0.2);
    const back = box(W, H, t, mat);
    back.position.set(0, H / 2, -D / 2 + t / 2);
    g.add(back);
    for (const x of [-W / 2 + t / 2, W / 2 - t / 2]) {
      const s = box(t, H, D, mat);
      s.position.set(x, H / 2, 0);
      g.add(s);
    }
    for (let r = 0; r <= 3; r++) {
      const s = box(W, t, D, mat);
      s.position.set(0, (r * (H - t)) / 3 + t / 2, 0);
      g.add(s);
    }
    for (let c = 1; c < 4; c++) {
      const s = box(t, H, D * 0.98, mat);
      s.position.set(-W / 2 + (c * W) / 4, H / 2, 0);
      g.add(s);
    }
    // 每格的东西。
    const crystal = (color: number, h: number): Mesh => {
      const m = new Mesh(new OctahedronGeometry(0.02, 0), new MeshStandardMaterial({ color, roughness: 0.3, flatShading: true }));
      m.scale.set(1, h, 1);
      m.castShadow = true;
      return m;
    };
    const ammonite = (): Mesh => {
      const pts: Vector3[] = [];
      for (let i = 0; i < 120; i++) {
        const a = i * 0.16;
        const r = 0.003 + a * 0.0016;
        pts.push(new Vector3(Math.cos(a) * r, Math.sin(a) * r, 0));
      }
      const m = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 200, 0.0028, 6), paperMaterial(0xd9b98a, { kind: 'kraft', scale: 0.05 }));
      m.castShadow = true;
      return m;
    };
    const jar = (color: number): Group => {
      const j = new Group();
      const glass = new Mesh(new CylinderGeometry(0.018, 0.018, 0.05, 24, 1, true), new MeshStandardMaterial({ color: 0xdfeeea, roughness: 0.08, transparent: true, opacity: 0.28, depthWrite: false }));
      glass.position.y = 0.025;
      const fill = new Mesh(new CylinderGeometry(0.016, 0.016, 0.026, 20), paperMaterial(color, { kind: 'kraft', scale: 0.03 }));
      fill.position.y = 0.013;
      const cork = new Mesh(new CylinderGeometry(0.015, 0.013, 0.012, 20), paperMaterial(0xb48a5a, { kind: 'kraft', scale: 0.03 }));
      cork.position.y = 0.054;
      fill.castShadow = cork.castShadow = true;
      j.add(glass, fill, cork);
      return j;
    };
    const items: Array<() => Object3D> = [
      () => crystal(0xe9e4f2, 1.8),
      () => ammonite(),
      () => jar(0x8e6b4a),
      () => {
        const c = new Group();
        const a = crystal(0xc9b6e4, 1.6);
        const b = crystal(0xe8def5, 1.2);
        b.position.set(0.016, -0.004, 0.004);
        b.rotation.z = -0.4;
        c.add(a, b);
        return c;
      },
      () => jar(0xc9a34a),
      () => crystal(0xf2efe9, 2.2),
      () => ammonite(),
      () => jar(0x6e8a56),
      () => crystal(0xb7d3d0, 1.5),
      () => jar(0xa3483a),
      () => {
        const m = new Mesh(new IcosahedronGeometry(0.022, 0), new MeshStandardMaterial({ color: 0xd8c2a0, roughness: 0.8, flatShading: true }));
        m.castShadow = true;
        return m;
      },
      () => crystal(0xd7ecf2, 1.9),
    ];
    let i = 0;
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 4; c++) {
        const o = items[i++ % items.length]!();
        const cellH = (H - t) / 3;
        o.position.set(-W / 2 + (c + 0.5) * (W / 4), t + r * cellH + (o instanceof Mesh && o.geometry instanceof OctahedronGeometry ? 0.02 * o.scale.y : 0.004), 0.005);
        if (o instanceof Mesh && o.geometry instanceof TubeGeometry) {
          o.position.y += 0.035;
        }
        g.add(o);
      }
    g.position.set(0.36, DESK_Y, -0.42);
    this.scene.add(g);
    this.addProp({ id: 'cabinet', name: '标本格', hint: '以后：你拿到专利的动物，一格一只', root: g, lift: 0 });
  }

  /** 木托盘里的几封来信（委托）。 */
  private letters(): void {
    const g = new Group();
    const tray = new Group();
    const mat = wood(0xa0703f, 0.2);
    const bottom = box(0.22, 0.006, 0.15, mat);
    bottom.position.y = 0.003;
    tray.add(bottom);
    for (const [x, z, w, d] of [
      [0, 0.072, 0.22, 0.006],
      [0, -0.072, 0.22, 0.006],
      [0.107, 0, 0.006, 0.15],
      [-0.107, 0, 0.006, 0.15],
    ] as const) {
      const s = box(w, 0.022, d, mat);
      s.position.set(x, 0.011, z);
      tray.add(s);
    }
    g.add(tray);
    const tex = airmail();
    for (let i = 0; i < 4; i++) {
      const e = box(0.18, 0.0025, 0.12, [paperMaterial(0xf3ecdc, { scale: 0.2 }), paperMaterial(0xf3ecdc, { scale: 0.2 }), new MeshStandardMaterial({ map: tex, roughness: 1 }), paperMaterial(0xf3ecdc, { scale: 0.2 }), paperMaterial(0xf3ecdc, { scale: 0.2 }), paperMaterial(0xf3ecdc, { scale: 0.2 })]);
      e.position.set((i - 1.5) * 0.004, 0.008 + i * 0.003, (i % 2 ? 1 : -1) * 0.004);
      e.rotation.y = (i - 1.5) * 0.06;
      g.add(e);
    }
    g.position.set(-0.47, DESK_Y, 0.0);
    g.rotation.y = 0.18;
    this.scene.add(g);
    this.addProp({ id: 'letters', name: '来信', hint: '委托：有人遇到了生态的麻烦', root: g, lift: 0.01 });
  }

  /** 黄铜天平（体重分配）。 */
  private balance(): void {
    const g = new Group();
    const base = new Mesh(new CylinderGeometry(0.04, 0.05, 0.012, 32), brass);
    base.position.y = 0.006;
    const post = new Mesh(new CylinderGeometry(0.005, 0.007, 0.2, 16), brass);
    post.position.y = 0.11;
    const finial = new Mesh(new SphereGeometry(0.01, 16, 10), brass);
    finial.position.y = 0.215;
    const beam = new Group();
    const bar = new Mesh(new CylinderGeometry(0.0035, 0.0035, 0.2, 12), brass);
    bar.rotation.z = Math.PI / 2;
    beam.add(bar);
    for (const s of [-1, 1]) {
      const chain = new Mesh(new CylinderGeometry(0.0008, 0.0008, 0.11, 6), brass);
      chain.position.set(s * 0.095, -0.055, 0);
      const pan = new Mesh(new CylinderGeometry(0.035, 0.022, 0.008, 28), brass);
      pan.position.set(s * 0.095, -0.112, 0);
      beam.add(chain, pan);
    }
    beam.position.y = 0.2;
    beam.rotation.z = 0.05;
    for (const m of [base, post, finial, bar]) m.castShadow = true;
    g.add(base, post, finial, beam);
    g.position.set(0.6, DESK_Y, -0.24);
    this.scene.add(g);
    this.addProp({ id: 'balance', name: '黄铜天平', hint: '体重分配：骨骼、肌肉、消化……一共就这么多', root: g, lift: 0 });
  }

  /** 墙上的搁板：一排种子罐，一枝结橙色小果的干枝。 */
  private shelf(): void {
    const g = new Group();
    const plank = box(0.62, 0.016, 0.13, wood(0xe9e2d6, 0.2));
    g.add(plank);
    for (const x of [-0.24, 0.24]) {
      const br = box(0.014, 0.09, 0.09, new MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.6 }));
      br.position.set(x, -0.05, -0.015);
      g.add(br);
    }
    const colors = [0x9b7a4e, 0x6f8a4a, 0xc79a3c, 0x7d5a3c, 0xa8a06a, 0x5f6b45];
    colors.forEach((c, i) => {
      const j = new Group();
      const h = 0.07 + (i % 3) * 0.012;
      const glass = new Mesh(new CylinderGeometry(0.02, 0.02, h, 24, 1, true), new MeshStandardMaterial({ color: 0xe6f1ee, roughness: 0.06, transparent: true, opacity: 0.25, depthWrite: false }));
      glass.position.y = h / 2;
      const fill = new Mesh(new CylinderGeometry(0.018, 0.018, h * 0.7, 20), paperMaterial(c, { kind: 'kraft', scale: 0.025 }));
      fill.position.y = h * 0.35;
      const cork = new Mesh(new CylinderGeometry(0.017, 0.015, 0.014, 20), paperMaterial(0xb48a5a, { kind: 'kraft', scale: 0.03 }));
      cork.position.y = h + 0.006;
      const tag = new Mesh(new PlaneGeometry(0.026, 0.014), paperMaterial(0xf2ead8, { scale: 0.05 }));
      tag.position.set(0, h * 0.45, 0.0205);
      fill.castShadow = cork.castShadow = true;
      j.add(glass, fill, cork, tag);
      j.position.set(-0.08 + i * 0.048, 0.008, 0.01);
      g.add(j);
    });
    // 干枝：几根弯的细枝，枝头挂橙色的小果。
    const vase = new Mesh(new CylinderGeometry(0.022, 0.018, 0.09, 24), new MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.4 }));
    vase.position.set(-0.22, 0.053, 0.0);
    vase.castShadow = true;
    g.add(vase);
    let s = 7;
    const rnd = (): number => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
    const twig = new MeshStandardMaterial({ color: 0x5a4030, roughness: 0.9 });
    const berry = new MeshStandardMaterial({ color: 0xd9692a, roughness: 0.6 });
    const grow = (from: Vector3, dir: Vector3, len: number, depth: number): void => {
      const pts = [from.clone()];
      let p = from.clone();
      const d = dir.clone();
      for (let i = 0; i < 4; i++) {
        d.x += (rnd() - 0.5) * 0.25;
        d.z += (rnd() - 0.5) * 0.15;
        d.normalize();
        p = p.clone().addScaledVector(d, len / 4);
        pts.push(p);
      }
      const m = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 12, 0.0018 * (depth + 1), 5), twig);
      m.castShadow = true;
      g.add(m);
      if (depth > 0) for (let k = 0; k < 2; k++) grow(pts[2 + k]!, new Vector3(d.x + (k ? 0.6 : -0.6), d.y, d.z).normalize(), len * 0.55, depth - 1);
      else
        for (let k = 0; k < 3; k++) {
          const b = new Mesh(new SphereGeometry(0.004, 10, 6), berry);
          b.position.copy(pts[4 - k]!).add(new Vector3((rnd() - 0.5) * 0.01, -0.004, (rnd() - 0.5) * 0.01));
          b.castShadow = true;
          g.add(b);
        }
    };
    for (let i = 0; i < 4; i++) grow(new Vector3(-0.22, 0.09, 0), new Vector3((i - 1.5) * 0.35, 1, 0.1).normalize(), 0.24, 2);
    g.position.set(0.36, DESK_Y + 0.44, -0.44);
    this.scene.add(g);
    this.addProp({ id: 'seeds', name: '种子罐', hint: '植物图鉴：岛上长什么、动物吃什么', root: g, lift: 0 });
  }

  /** 墙上一只小框：里面一朵棉花似的白云，下面挂着几滴水晶的雨（天气）。 */
  private cloudFrame(): void {
    const g = new Group();
    const mat = wood(0x6e4426, 0.2);
    const W = 0.2;
    const H = 0.24;
    const D = 0.06;
    const t = 0.014;
    const back = box(W, H, 0.004, paperMaterial(0xece6da, { scale: 0.2 }));
    back.position.z = -D / 2;
    g.add(back);
    for (const [x, y, w, h] of [
      [0, H / 2 - t / 2, W, t],
      [0, -H / 2 + t / 2, W, t],
      [W / 2 - t / 2, 0, t, H],
      [-W / 2 + t / 2, 0, t, H],
    ] as const) {
      const s = box(w, h, D, mat);
      s.position.set(x, y, 0);
      g.add(s);
    }
    const puff = paperMaterial(0xfbfaf6, { kind: 'kraft', scale: 0.04 });
    for (const [x, y, r] of [
      [-0.035, 0.05, 0.026],
      [0, 0.06, 0.034],
      [0.04, 0.048, 0.024],
      [0.018, 0.04, 0.024],
      [-0.015, 0.038, 0.022],
    ] as const) {
      const m = new Mesh(new SphereGeometry(r, 20, 14), puff);
      m.position.set(x, y, -0.01);
      m.scale.z = 0.6;
      m.castShadow = true;
      g.add(m);
    }
    const drop = new MeshStandardMaterial({ color: 0xdff1ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 7; i++) {
      const x = -0.045 + i * 0.015;
      const len = 0.03 + ((i * 37) % 5) * 0.012;
      const thread = new Mesh(new CylinderGeometry(0.0004, 0.0004, len, 4), new MeshStandardMaterial({ color: 0xcfd6da }));
      thread.position.set(x, 0.03 - len / 2, -0.01);
      const d = new Mesh(new OctahedronGeometry(0.004, 0), drop);
      d.position.set(x, 0.03 - len - 0.004, -0.01);
      d.scale.y = 1.6;
      g.add(thread, d);
    }
    g.position.set(0.06, DESK_Y + 0.36, -0.49);
    this.scene.add(g);
    this.addProp({ id: 'weather', name: '云的标本', hint: '天气：雨多雨少，草就长得不一样', root: g, lift: 0 });
  }

  /** 切割垫（设计台）：深绿的垫板，印着格子。 */
  private mat(): void {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 384;
    const x = c.getContext('2d')!;
    x.fillStyle = '#2f4a3e';
    x.fillRect(0, 0, 512, 384);
    x.strokeStyle = 'rgba(220, 230, 210, 0.35)';
    x.lineWidth = 1;
    for (let i = 0; i <= 512; i += 16) {
      x.beginPath();
      x.moveTo(i, 0);
      x.lineTo(i, 384);
      x.stroke();
    }
    for (let i = 0; i <= 384; i += 16) {
      x.beginPath();
      x.moveTo(0, i);
      x.lineTo(512, i);
      x.stroke();
    }
    x.strokeStyle = 'rgba(230, 240, 220, 0.6)';
    x.lineWidth = 2;
    x.strokeRect(16, 16, 480, 352);
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    const m = box(0.3, 0.003, 0.22, [paperMaterial(0x2f4a3e), paperMaterial(0x2f4a3e), new MeshStandardMaterial({ map: t, roughness: 0.85 }), paperMaterial(0x2f4a3e), paperMaterial(0x2f4a3e), paperMaterial(0x2f4a3e)]);
    const g = new Group();
    m.position.y = 0.0015;
    g.add(m);
    g.position.set(0.37, DESK_Y, 0.06);
    g.rotation.y = -0.12;
    this.scene.add(g);
    this.matGroup = g;
    this.addProp({ id: 'mat', name: '切割垫', hint: '设计台：用纸片和铆钉拼一只动物', root: g, lift: 0 });
  }

  /** 切割垫那一组（外面往上放纸偶）。 */
  matGroup: Group | null = null;

  private addProp(p: Omit<StudioProp, 'hover' | 'baseY'>): void {
    this.props.push({ ...p, hover: 0, baseY: p.root.position.y });
  }

  // ———— 交互 ————

  private pick(x: number, y: number): void {
    if (this.flying) return;
    this.ray.setFromCamera(this.mouse, this.camera);
    const hits = this.ray.intersectObjects(
      this.props.map((p) => p.root),
      true,
    );
    let found: StudioProp | null = null;
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && !found) {
        found = this.props.find((p) => p.root === o) ?? null;
        o = o.parent;
      }
      if (found) break;
    }
    this.setHover(found, x, y);
  }

  private setHover(p: StudioProp | null, x: number, y: number): void {
    this.hovered = p;
    this.renderer.domElement.style.cursor = p ? 'pointer' : 'default';
    this.onHover?.(p, x, y);
  }

  /** 摆件里一个点（岛的坐标）在房间里的位置。 */
  islandToWorld(p: Vector3): Vector3 {
    this.ornament.inner.updateWorldMatrix(true, false);
    return this.ornament.inner.localToWorld(p.clone());
  }

  flyTo(to: Pose, ms: number, done?: () => void): void {
    this.flight = { from: { pos: this.pose.pos.clone(), target: this.pose.target.clone(), fov: this.pose.fov }, to, t: 0, ms, done };
    this.flying = true;
    this.setHover(null, 0, 0);
  }

  setPose(p: Pose): void {
    this.pose = { pos: p.pos.clone(), target: p.target.clone(), fov: p.fov };
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
    // 镜头：飞行中按缓动插值；平时随鼠标轻轻错开一点（坐在桌前歪一下头）。
    let pos = this.pose.pos;
    let target = this.pose.target;
    let fov = this.pose.fov;
    if (this.flight) {
      const f = this.flight;
      f.t = Math.min(1, f.t + (dt * 1000) / f.ms);
      const e = f.t < 0.5 ? 4 * f.t * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 3) / 2;
      pos = f.from.pos.clone().lerp(f.to.pos, e);
      target = f.from.target.clone().lerp(f.to.target, e);
      fov = f.from.fov + (f.to.fov - f.from.fov) * e;
      if (f.t >= 1) {
        this.setPose(f.to);
        this.flight = null;
        this.flying = false;
        f.done?.();
      }
    }
    const par = this.flight ? 0 : 1;
    this.camera.position.set(pos.x + this.mouse.x * 0.025 * par, pos.y + this.mouse.y * 0.012 * par, pos.z);
    this.camera.lookAt(target);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // 抬起鼠标停住的那一件。
    for (const p of this.props) {
      p.hover += ((p === this.hovered ? 1 : 0) - p.hover) * Math.min(1, dt * 12);
      p.root.position.y = p.baseY + p.hover * p.lift;
    }
    this.drawerOpen += (this.drawerGoal - this.drawerOpen) * Math.min(1, dt * 7);
    if (this.drawer) this.drawer.position.z = 0.1 + this.drawerOpen * 0.11;
    this.lampK += ((this.lampOn ? 1 : 0) - this.lampK) * Math.min(1, dt * 10);
    this.lamp.intensity = 1.6 * this.lampK;
    (this.bulb.material as MeshStandardMaterial).emissiveIntensity = 0.1 + 2.1 * this.lampK;
    this.hemi.intensity = 0.95 - 0.2 * this.lampK;
    this.moon.intensity = 0.35 + 0.25 * (1 - this.lampK);
    // 纸的共享参数：这里没有云影；立着的纸片朝这台镜头。
    paperGlobals.uCloudAmt.value = 0;
    plantUniforms.uCam.value.copy(this.camera.position);
    const dir = new Vector3().subVectors(this.camera.position, target).normalize();
    plantUniforms.uLean.value = Math.max(0, Math.asin(dir.y) - 0.35) * 0.8;
    plantUniforms.uTime.value = this.time;
    (this.bokeh.uniforms as unknown as Record<string, { value: number }>)['focus']!.value = this.camera.position.distanceTo(target);
    this.grain.uniforms['uTime']!.value = this.time;
    if (render) this.composer.render(dt);
  }
}
