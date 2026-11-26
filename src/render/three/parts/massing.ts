import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Matrix4, CanvasTexture, RepeatWrapping, SRGBColorSpace, SphereGeometry, Shape, ShapeUtils, Vector2, Vector3 } from 'three';
import { cardify } from './cardify';
import { headlamp } from './nose';
import { buildWheel } from './wheel';
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';

/**
 * 整车体块（2026-11-26，用户建议的建模顺序：先描外轮廓 → 推出实体 → 用三视图定大轮廓 → 再定车轮、窗、门 → 最后细化每个面）。
 * 来源：三视图 art/incoming/lovart/011/3-orthographic.png。
 * - 侧视（比例尺：轮子半径 78 像素 = 0.42 米，地面 y = 610，车头正面 x = 157）：一个转折一个转折放大描出的外轮廓；
 * - 正视（车的中线 x = 1626、地面 y = 613，比例尺按车顶高度和侧视对齐，0.00526 米/像素）：车身截面的半宽随高度变化。
 * 体块 = 侧面轮廓 ∩ 正面截面：先按截面的转折高度把侧面轮廓切成水平条，每条里半宽随高度线性变化，左右两面都是平面。
 * 世界坐标：x 车宽、y 向上、z 向车头，车头正面在 z = 0.05。
 */
export const PROFILE: Array<[number, number]> = [
  // (z, y)：车头底 → 前脸 → 引擎盖顶的小倒角 → 引擎盖往后抬 → 窗台 → 挡风玻璃 → 车顶前檐倒角 → 车顶 → 车尾抬高的一段 → 后端圆角 → 后墙 → 底线（车尾下面看着像台阶的地方是坡道挡住了车身，不是凹口）
  [0.05, 0.307],
  [0.05, 1.427],
  [-0.058, 1.481],
  [-0.585, 1.572],
  [-0.72, 1.658],
  [-0.758, 1.685],
  [-0.989, 2.369],
  [-1.097, 2.531],
  [-4.247, 2.547],
  [-4.285, 2.649],
  [-5.405, 2.649],
  [-5.539, 2.558],
  [-5.604, 2.396],
  [-5.604, 0.307],
];
/** 正面截面：(高度, 半宽)，中间线性插值。 */
export const SECTION: Array<[number, number]> = [
  [0.0, 1.02],
  [1.57, 1.02],
  [1.65, 0.93],
  [2.3, 0.93],
  [2.44, 0.85],
  [2.53, 0.72],
  [2.66, 0.62],
];
export const WHEELS = [
  { z: -1.53, r: 0.42 },
  { z: -4.55, r: 0.42 },
];
export const WHEEL_X = 0.75;
export const WHEEL_W = 0.35;

export function halfWidth(y: number): number {
  for (let i = 0; i < SECTION.length - 1; i++) {
    const [y0, h0] = SECTION[i]!;
    const [y1, h1] = SECTION[i + 1]!;
    if (y <= y1) return h0 + ((h1 - h0) * Math.max(0, y - y0)) / (y1 - y0);
  }
  return SECTION[SECTION.length - 1]![1];
}

/** 多边形（逆时针）裁到 y0 ≤ y ≤ y1 的水平条里。 */
function clipBand(poly: Vector2[], y0: number, y1: number): Vector2[] {
  const clip = (pts: Vector2[], keep: (p: Vector2) => boolean, yc: number): Vector2[] => {
    const out: Vector2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const ka = keep(a);
      const kb = keep(b);
      if (ka) out.push(a);
      if (ka !== kb) {
        const t = (yc - a.y) / (b.y - a.y);
        out.push(new Vector2(a.x + (b.x - a.x) * t, yc));
      }
    }
    return out;
  };
  return clip(clip(poly, (p) => p.y >= y0 - 1e-9, y0), (p) => p.y <= y1 + 1e-9, y1);
}

/** 侧面轮廓 ∩ 正面截面 的实心体。 */
export function bodyGeometry(profile = PROFILE): BufferGeometry {
  // 轮廓放在 (a = z, b = y) 平面；逆时针
  let poly = profile.map(([z, y]) => new Vector2(z, y));
  if (ShapeUtils.isClockWise(poly)) poly = poly.reverse();
  const ys = [...new Set([...SECTION.map((s) => s[0]), ...profile.map((p) => p[1])])].sort((a, b) => a - b);
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]): void => void pos.push(...a, ...b, ...c);
  const P = (v: Vector2, s: number): number[] => [s * halfWidth(v.y), v.y, v.x];
  for (let i = 0; i < ys.length - 1; i++) {
    const band = clipBand(poly, ys[i]!, ys[i + 1]!);
    if (band.length < 3) continue;
    const faces = ShapeUtils.triangulateShape(band, []);
    for (const f of faces) {
      const [a, b, c] = f as [number, number, number];
      // 右侧面（+x）朝外：从 +x 看过去 (z, y) 平面……法线方向由顶点顺序决定，左右两面顺序相反
      tri(P(band[a]!, 1), P(band[c]!, 1), P(band[b]!, 1));
      tri(P(band[a]!, -1), P(band[b]!, -1), P(band[c]!, -1));
    }
  }
  // 轮廓一圈的面（前脸、引擎盖、玻璃、车顶、后墙、底）：把每条轮廓边按 ys 切开，连左右两边
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const cuts = [0, 1];
    for (const y of ys) {
      const t = (y - a.y) / (b.y - a.y);
      if (t > 1e-6 && t < 1 - 1e-6) cuts.push(t);
    }
    cuts.sort((p, q) => p - q);
    for (let k = 0; k < cuts.length - 1; k++) {
      const p = a.clone().lerp(b, cuts[k]!);
      const q = a.clone().lerp(b, cuts[k + 1]!);
      tri(P(p, -1), P(q, -1), P(q, 1));
      tri(P(p, -1), P(q, 1), P(p, 1));
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.computeVertexNormals();
  return g;
}

/**
 * 雕刻（第 2 步）：在体块上挖掉的部分，全部从三视图的侧视里读（像素 → 米：z = 0.05 − (x − 157)·0.005385，y = (610 − y)·0.005385）。
 * 每一刀是一个"刀具"几何体（世界坐标），从体块里减掉。
 */
export interface Cut {
  name: string;
  geo: BufferGeometry;
}

/** 在 (z, y) 平面里画的轮廓，沿 x 从 x0 挤到 x1 的刀具。 */
function prismX(pts: Array<[number, number]>, x0: number, x1: number): BufferGeometry {
  const sh = new Shape();
  pts.forEach(([z, y], i) => (i === 0 ? sh.moveTo(-z, y) : sh.lineTo(-z, y)));
  const geo = new ExtrudeGeometry(sh, { depth: x1 - x0, bevelEnabled: false });
  geo.rotateY(Math.PI / 2);
  geo.translate(x0, 0, 0);
  return geo;
}
/** 八角形（正），中心 (z, y)，外接半径 r，平边朝上下。 */
function octZY(z: number, y: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    out.push([z + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return out;
}
function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): BufferGeometry {
  const g = new BoxGeometry(x1 - x0, y1 - y0, Math.abs(z1 - z0));
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return g;
}

export const ARCH_R = 0.5; // 轮拱：只比轮子（半径 0.42）大一圈
export const FENDER = { r: 0.64, out: 0.07 }; // 轮眉：凸出车身 7 厘米的八角壳
export const OPENING = { z0: -2.44, z1: -4.97, y0: 0.97, y1: 2.02, split: 1.5 }; // 服务侧开口；split = 上下两扇板的分界
export const INTERIOR = { x: 0.86, y0: 0.75, y1: 2.42, z0: -2.4, z1: -5.5 }; // 货箱里面挖空（地板在后门槛高度 0.75）
/** 后门：双开门，门洞 x ±0.47、高 0.75~2.18（侧视），铰链在两侧外沿。 */
export const REAR_DOOR = { hw: 0.47, y0: 0.75, y1: 2.18 };
/** 挡风玻璃：斜面上 y 1.73~2.17（侧视和正视一致），x ±0.72，中间立柱 6 厘米；往里凹 12 厘米（玻璃后面放卷帘眼皮）。 */
export const WINDSHIELD = { hw: 0.72, mull: 0.03, y0: 1.73, y1: 2.17, depth: 0.12 };
/** 挡风玻璃所在的斜面（侧面轮廓上的两点）。 */
const WS_A: [number, number] = [-0.758, 1.685];
const WS_B: [number, number] = [-0.989, 2.369];
export const PORTHOLE = { z: -1.74, y: 1.86, r: 0.33, depth: 0.04 };
// 前脸（正视图读的；正面在 z = 0.05）
const F = 0.05;
export const LAMP = { x: 0.59, y: 1.02, r: 0.26, depth: 0.14 };
export const GRILLE = { hw: 0.24, y0: 0.92, y1: 1.22, depth: 0.05, bars: 7 };
export const MAILBOX = { hw: 0.25, y0: 0.63, y1: 0.94, depth: 0.17 };
export const BUMPER = { hw: 1.0, y0: 0.3, y1: 0.52, depth: 0.07 };

/** 上半个八角环（轮拱、轮眉用）：外接半径 r，中心 (z, y)，底边落在 y0。 */
function archPts(z: number, y: number, r: number, y0: number): Array<[number, number]> {
  const top = octZY(z, y, r).filter(([, yy]) => yy > y - 1e-6).sort((a, b) => b[0] - a[0]);
  return [[z + r, y0], ...top, [z - r, y0]];
}
function ringPts(z: number, y: number, r0: number, r1: number): Array<[number, number]> {
  const outer = octZY(z, y, r1).filter(([, yy]) => yy > y - 1e-6).sort((a, b) => b[0] - a[0]);
  const inner = octZY(z, y, r0).filter(([, yy]) => yy > y - 1e-6).sort((a, b) => a[0] - b[0]);
  return [[z + r1, y], ...outer, [z - r1, y], [z - r0, y], ...inner, [z + r0, y]];
}
/** 在 (x, y) 平面里画的轮廓，沿 z 从 z0 挤到 z1 的实体。 */
function prismZ(pts: Array<[number, number]>, z0: number, z1: number): BufferGeometry {
  const sh = new Shape();
  pts.forEach(([x, y], i) => (i === 0 ? sh.moveTo(x, y) : sh.lineTo(x, y)));
  const geo = new ExtrudeGeometry(sh, { depth: z1 - z0, bevelEnabled: false });
  geo.translate(0, 0, z0);
  return geo;
}
function octXY(x: number, y: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) {
    const a = Math.PI / 8 + (k * Math.PI) / 4;
    out.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
  }
  return out;
}

export interface Carved {
  body: BufferGeometry;
  /** 服务侧的两扇板（合上时正好补上开口），在世界坐标里；铰链轴沿 z。 */
  flapUpper: BufferGeometry;
  flapLower: BufferGeometry;
  hingeUpper: [number, number]; // (x, y)
  hingeLower: [number, number];
  /** 后门两扇，铰链在 x = ∓REAR_DOOR.hw、z = 后墙外面（-5.604）。 */
  doorLeft: BufferGeometry;
  doorRight: BufferGeometry;
}

/** 体块 → 雕刻。每一步都是一个"是什么"的东西（见 docs/research/van-inventory.md）。 */
export function carve(): Carved {
  const ev = new Evaluator();
  ev.attributes = ['position', 'uv', 'normal'];
  const add = (a: Brush, g: BufferGeometry): Brush => ev.evaluate(a, brush(g), ADDITION);
  const sub = (a: Brush, g: BufferGeometry): Brush => ev.evaluate(a, brush(g), SUBTRACTION);
  // 大块：侧面轮廓 ∩ 正面截面
  let body = ev.evaluate(brush(prismX(PROFILE, -1.2, 1.2)), brush(sectionPrism()), INTERSECTION);
  // 轮拱：只挖车身两侧，比轮子大一圈；外面一圈凸出来的八角轮眉壳
  for (const w of WHEELS)
    for (const s of [-1, 1]) {
      body = sub(body, prismX(archPts(w.z, w.r, ARCH_R, -0.1), s > 0 ? 0.55 : -1.3, s > 0 ? 1.3 : -0.55));
      const hw = halfWidth(0.5);
      body = add(body, prismX(ringPts(w.z, w.r, ARCH_R, FENDER.r), s > 0 ? hw - 0.05 : -hw - FENDER.out, s > 0 ? hw + FENDER.out : -hw + 0.05));
    }
  // 舷窗凹槽
  for (const s of [-1, 1]) {
    const hw = halfWidth(PORTHOLE.y);
    body = sub(body, prismX(octZY(PORTHOLE.z, PORTHOLE.y, PORTHOLE.r), s > 0 ? hw - PORTHOLE.depth : -1.3, s > 0 ? 1.3 : -hw + PORTHOLE.depth));
  }
  // 前脸：灯（正八角筒）、格栅（先凹进去，再挤出 7 根竖条）、信箱（凸出的盒子）、保险杠
  // 灯座：一块薄的正八角底板（灯本身是细节件 headlamp，装在底板上）
  for (const s of [-1, 1]) body = add(body, prismZ(octXY(s * LAMP.x, LAMP.y, LAMP.r + 0.03), F - 0.02, F + 0.03));
  body = sub(body, box(-GRILLE.hw, GRILLE.hw, GRILLE.y0, GRILLE.y1, F - GRILLE.depth, F + 0.1));
  const pitch = (2 * GRILLE.hw) / GRILLE.bars;
  for (let i = 0; i < GRILLE.bars; i++) {
    const x = -GRILLE.hw + (i + 0.5) * pitch;
    body = add(body, box(x - pitch * 0.2, x + pitch * 0.2, GRILLE.y0 - 0.005, GRILLE.y1 + 0.005, F - GRILLE.depth - 0.01, F - 0.012));
  }
  body = add(body, box(-MAILBOX.hw, MAILBOX.hw, MAILBOX.y0, MAILBOX.y1, F - 0.02, F + MAILBOX.depth));
  body = add(body, box(-BUMPER.hw, BUMPER.hw, BUMPER.y0, BUMPER.y1, F - 0.1, F + BUMPER.depth));
  // 引擎盖中间的凸起：顺着引擎盖斜面，高 7 厘米，x ±0.38（正视）
  body = add(body, prismX([[-0.06, 1.3], [-0.06, 1.5], [-0.585, 1.64], [-0.7, 1.72], [-0.7, 1.3]], -0.38, 0.38));
  // 挡风玻璃窗洞：沿斜面往里凹（两片，中间留立柱）
  {
    const dz = WS_B[0] - WS_A[0];
    const dy = WS_B[1] - WS_A[1];
    const L = Math.hypot(dz, dy);
    const n: [number, number] = [dy / L, -dz / L]; // 斜面的外法线（朝前上）
    const at = (y: number): [number, number] => [WS_A[0] + (dz * (y - WS_A[1])) / dy, y];
    const W = WINDSHIELD;
    const q = (p: [number, number], k: number): [number, number] => [p[0] + n[0] * k, p[1] + n[1] * k];
    const pts: Array<[number, number]> = [q(at(W.y0), -W.depth), q(at(W.y1), -W.depth), q(at(W.y1), 0.4), q(at(W.y0), 0.4)];
    for (const s of [-1, 1]) body = sub(body, prismX(pts, s > 0 ? W.mull : -W.hw, s > 0 ? W.hw : -W.mull));
  }
  // 货箱：先挖空里面（留墙、地板、车顶）
  const I = INTERIOR;
  body = sub(body, box(-I.x, I.x, I.y0, I.y1, I.z0, I.z1));
  // 服务侧开口：切下来的那块墙 = 两扇能开合的板（上扇向上翻、下扇向下翻成桌面）
  const o = OPENING;
  const wall = (y0: number, y1: number): BufferGeometry => box(I.x - 0.01, 1.3, y0, y1, o.z0, o.z1);
  const full = ev.evaluate(brush(prismX(PROFILE, -1.2, 1.2)), brush(sectionPrism()), INTERSECTION);
  const flapUpper = ev.evaluate(full, brush(wall(o.split + 0.004, o.y1)), INTERSECTION).geometry;
  const flapLower = ev.evaluate(full, brush(wall(o.y0, o.split - 0.004)), INTERSECTION).geometry;
  body = sub(body, wall(o.y0, o.y1));
  // 后门：从后墙上切下来的两扇门板
  const D = REAR_DOOR;
  const leaf = (x0: number, x1: number): BufferGeometry => box(x0, x1, D.y0, D.y1, -5.7, I.z1 - 0.01);
  const doorLeft = ev.evaluate(full, brush(leaf(-D.hw, -0.004)), INTERSECTION).geometry;
  const doorRight = ev.evaluate(full, brush(leaf(0.004, D.hw)), INTERSECTION).geometry;
  body = sub(body, leaf(-D.hw, D.hw));
  return { body: body.geometry, flapUpper, flapLower, hingeUpper: [halfWidth(o.y1), o.y1], hingeLower: [halfWidth(o.y0), o.y0], doorLeft, doorRight };
}

/** 正面截面沿 z 挤出的长条（比车长一点）。 */
function sectionPrism(): BufferGeometry {
  const sh = new Shape();
  const right = SECTION.map(([y, h]) => [h, y] as [number, number]);
  const left = [...SECTION].reverse().map(([y, h]) => [-h, y] as [number, number]);
  [...right, ...left].forEach(([x, y], i) => (i === 0 ? sh.moveTo(x, y) : sh.lineTo(x, y)));
  const geo = new ExtrudeGeometry(sh, { depth: 7, bevelEnabled: false });
  geo.translate(0, 0, -6.5); // z 从 -6.5 到 0.5
  return geo;
}

function brush(geo: BufferGeometry): Brush {
  if (!geo.getAttribute('uv')) geo.setAttribute('uv', new BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
  const b = new Brush(geo);
  b.updateMatrixWorld();
  return b;
}

/** open：服务侧两扇板打开的程度（0 合上，1 全开：上扇翻到水平、下扇放平成桌面）。 */
export function buildMassing(open = 1, card = false): Group {
  const g = new Group();
  const mat = new MeshStandardMaterial({ color: 0xe6d6b8, roughness: 0.9, flatShading: true });
  const c = carve();
  // 卡纸模式：每个实体的面 → 一块块卡纸 + 凸棱金包边（cardify.ts）；体块本身留在里面当"芯"（深一点的纸板色）
  const solid = (geo: BufferGeometry, color = 0xe6d6b8): Group | Mesh => {
    if (!card) {
      const m = new Mesh(geo, color === 0xe6d6b8 ? mat : new MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
      m.castShadow = m.receiveShadow = true;
      return m;
    }
    const grp = new Group();
    const core = new Mesh(geo, new MeshStandardMaterial({ color: 0x8a7458, roughness: 0.95 }));
    grp.add(core, cardify(geo, { seed: Math.floor(color % 97) }));
    return grp;
  };
  g.add(solid(c.body));
  const hinge = (geo: BufferGeometry, [hx, hy]: [number, number], angle: number): void => {
    const pivot = new Group();
    pivot.position.set(hx, hy, 0);
    const m = solid(geo, 0xd9c49e);
    m.position.set(-hx, -hy, 0);
    pivot.add(m);
    pivot.rotation.z = angle;
    g.add(pivot);
  };
  // 上扇 = 遮阳篷：翻起来后略往下斜（约 15°）；下扇 = 桌面：放平
  const upA = open * ((75 * Math.PI) / 180);
  hinge(c.flapUpper, c.hingeUpper, upA);
  hinge(c.flapLower, c.hingeLower, (-open * Math.PI) / 2);
  const wood = new MeshStandardMaterial({ color: 0xa0703e, roughness: 0.8 });
  const o = OPENING;
  if (open > 0.05) {
    // 遮阳篷的两根斜撑：上端顶在篷板外沿下面，下端顶在桌板高度的车身上（各有座）
    const [hx, hy] = c.hingeUpper;
    const len = o.y1 - o.split;
    const tip: [number, number] = [hx + Math.sin(upA) * len, hy - Math.cos(upA) * len];
    for (const z of [o.z0 - 0.2, o.z1 + 0.2]) {
      const a = new Vector3(tip[0] - 0.02, tip[1] - 0.03, z);
      const b = new Vector3(halfWidth(1.1) + 0.01, 1.1, z);
      const rod = new Mesh(new CylinderGeometry(0.025, 0.025, a.distanceTo(b), 8), wood);
      rod.position.copy(a).add(b).multiplyScalar(0.5);
      rod.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
      rod.castShadow = true;
      g.add(rod);
    }
    // 狗挡板：挂在桌板外沿（铰链），往下撑到地面，当桌腿
    const [lx, ly] = c.hingeLower;
    const tw = o.split - o.y0; // 桌板伸出的宽度
    const ex = lx + tw * Math.sin((open * Math.PI) / 2);
    const ey = ly + tw * Math.cos((open * Math.PI) / 2);
    // 侧视：上宽下窄的梯形，z −2.44 ~ −3.44，从桌沿垂到离地 0.3；米色板上一只狗的剪影（深一点的纸）
    const za = o.z0;
    const zb = o.z0 - 1.0;
    const trap = new Shape();
    trap.moveTo(-za, 0);
    trap.lineTo(-zb, 0);
    trap.lineTo(-zb - 0.08, -(ey - 0.3));
    trap.lineTo(-za + 0.08, -(ey - 0.3));
    trap.lineTo(-za, 0);
    const pm = new Mesh(new ExtrudeGeometry(trap, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 }), new MeshStandardMaterial({ color: 0xdcc79c, roughness: 0.9 }));
    pm.rotation.y = Math.PI / 2; // 局部 x → 世界 -z，局部 z → 世界 x
    pm.position.set(ex - 0.06, ey, 0);
    pm.castShadow = pm.receiveShadow = true;
    g.add(pm);
    const dog = new Shape();
    const dp: Array<[number, number]> = [[-0.15, 0], [-0.15, 0.1], [-0.13, 0.15], [-0.08, 0.17], [-0.06, 0.22], [-0.03, 0.2], [0, 0.22], [0.03, 0.17], [0.1, 0.16], [0.15, 0.19], [0.17, 0.14], [0.12, 0.1], [0.1, 0], [0.06, 0], [0.05, 0.07], [-0.02, 0.07], [-0.04, 0], [-0.08, 0], [-0.09, 0.07], [-0.12, 0]];
    dp.forEach(([a, b], k) => (k === 0 ? dog.moveTo(-a * 1.8, b * 1.8) : dog.lineTo(-a * 1.8, b * 1.8)));
    const dm = new Mesh(new ExtrudeGeometry(dog, { depth: 0.006, bevelEnabled: false }), new MeshStandardMaterial({ color: 0xb98d58, roughness: 0.9 }));
    dm.rotation.y = Math.PI / 2;
    dm.position.set(ex - 0.026, 0.42, (za + zb) / 2);
    g.add(dm);
  }
  // 后门：右扇开（转到车身 +x 那侧，贴着侧墙），左扇关着
  const D = REAR_DOOR;
  const door = (geo: BufferGeometry, hx: number, angle: number): void => {
    const pivot = new Group();
    pivot.position.set(hx, 0, -5.604);
    const m = solid(geo, 0xd9c4a1);
    m.position.set(-hx, 0, 5.604);
    pivot.add(m);
    pivot.rotation.y = angle;
    g.add(pivot);
  };
  door(c.doorLeft, -D.hw, 0);
  door(c.doorRight, D.hw, open * (-Math.PI / 2) * 0.95);
  if (card) addDetails(g, open, c);
  else {
    const tire = new MeshStandardMaterial({ color: 0x4a4440, roughness: 0.9 });
    for (const w of WHEELS)
      for (const s of [-1, 1]) {
        const t = new Mesh(new CylinderGeometry(w.r, w.r, WHEEL_W, 24), tire);
        t.rotation.z = Math.PI / 2;
        t.position.set(s * WHEEL_X, w.r, w.z);
        t.castShadow = true;
        g.add(t);
      }
  }
  return g;
}

/** 细节件（之前做好的部件，按三视图量的位置装到体块上）：车轮、大灯、挡风玻璃的玻璃和卷帘眼皮。 */
function addDetails(g: Group, open: number, c: Carved): void {
  addDetails2(g, open, c);
  // 车轮：轮胎砖块 + 八角轮毂（wheel.ts），装在车轴上
  for (const w of WHEELS)
    for (const s of [-1, 1]) {
      const wh = buildWheel(w.r);
      wh.rotation.y = (s * Math.PI) / 2;
      wh.position.set(s * (WHEEL_X + WHEEL_W / 2 - 0.02), w.r, w.z);
      g.add(wh);
    }
  // 大灯：正八角（nose.ts 的 headlamp），装在灯座上
  for (const s of [-1, 1]) {
    const hw = LAMP.r * Math.cos(Math.PI / 8);
    const l = headlamp(hw, hw, 0.11, s);
    l.position.set(s * LAMP.x, LAMP.y, F + 0.03);
    g.add(l);
  }
  // 挡风玻璃：窗洞里一层淡茶色玻璃（离外面 3 厘米），后面一扇卷帘（眼皮，放下一大半）
  const dz = WS_B[0] - WS_A[0];
  const dy = WS_B[1] - WS_A[1];
  const L = Math.hypot(dz, dy);
  const n = new Vector3(0, -dz / L, dy / L); // 外法线（朝前上），世界 (x, y, z)
  const along = new Vector3(0, dy / L, dz / L);
  const at = (y: number): Vector3 => new Vector3(0, y, WS_A[0] + (dz * (y - WS_A[1])) / dy);
  const W = WINDSHIELD;
  const glass = new MeshStandardMaterial({ color: 0x8a7f70, transparent: true, opacity: 0.25, roughness: 0.08, depthWrite: false });
  const slat = [new MeshStandardMaterial({ color: 0xf0dcbc, roughness: 0.9 }), new MeshStandardMaterial({ color: 0xe0c9a2, roughness: 0.9 })];
  const h = W.y1 - W.y0;
  const len = h / (dy / L);
  for (const s of [-1, 1]) {
    const cx = (s * (W.hw + W.mull)) / 2;
    const w = W.hw - W.mull - 0.01;
    const basis = new Matrix4().makeBasis(new Vector3(1, 0, 0), along, n);
    const c0 = at(W.y0).add(new Vector3(cx, 0, 0));
    const pane = new Mesh(new BoxGeometry(w, len, 0.004), glass);
    pane.matrixAutoUpdate = false;
    pane.matrix.copy(basis).setPosition(c0.clone().addScaledVector(along, len / 2).addScaledVector(n, -0.03));
    pane.renderOrder = 2;
    g.add(pane);
    // 卷帘：帘片从上往下放，放下 70%
    const pitch = 0.046;
    const k = Math.floor((len * 0.7) / pitch);
    for (let i = 0; i < k; i++) {
      const sl = new Mesh(new BoxGeometry(w - 0.02, pitch - 0.004, 0.004), slat[i % 4 === 2 ? 1 : 0]!);
      sl.matrixAutoUpdate = false;
      sl.matrix.copy(basis).setPosition(c0.clone().addScaledVector(along, len - pitch / 2 - i * pitch).addScaledVector(n, -0.09));
      sl.castShadow = true;
      g.add(sl);
    }
  }
}

/** 第二批细节件（位置从三视图侧视 / 正视量的；每一件交代装在哪里）。 */
function addDetails2(g: Group, open: number, c: Carved): void {
  const brassM = new MeshStandardMaterial({ color: 0xd9a050, metalness: 0.35, roughness: 0.42 });
  const woodM = new MeshStandardMaterial({ color: 0xb8864a, roughness: 0.8 });
  const rod = (a: Vector3, b: Vector3, r: number, m: MeshStandardMaterial): void => {
    const x = new Mesh(new CylinderGeometry(r, r, a.distanceTo(b), 8), m);
    x.position.copy(a).add(b).multiplyScalar(0.5);
    x.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
    x.castShadow = true;
    g.add(x);
  };
  const ball = (p: Vector3, r: number, m: MeshStandardMaterial): void => {
    const x = new Mesh(new SphereGeometry(r, 10, 8), m);
    x.position.copy(p);
    x.castShadow = true;
    g.add(x);
  };
  // 胡须：从鼻子正面灯下方伸出，往外、往后掠（侧视里从正面一直延到 z = −0.5，像猫胡须贴着腮帮往后）
  for (const s of [-1, 1])
    for (let i = 0; i < 3; i++) {
      const y = 0.78 + i * 0.07;
      const a = new Vector3(s * 0.36, y, F + 0.02);
      const b = new Vector3(s * (1.08 + i * 0.03), y + 0.02 - i * 0.03, -0.45 + i * 0.05);
      rod(a, b, 0.011, brassM);
      ball(a, 0.02, brassM);
      ball(b, 0.024, brassM);
    }
  // 铃：保险杠正中下面一个吊环，挂一只铜铃
  const bell = new Mesh(new CylinderGeometry(0.04, 0.08, 0.13, 14), brassM);
  bell.position.set(0, BUMPER.y0 - 0.1, F + 0.03);
  g.add(bell);
  rod(new Vector3(0, BUMPER.y0, F + 0.03), new Vector3(0, BUMPER.y0 - 0.035, F + 0.03), 0.008, brassM);
  // 后视镜：A 柱外侧，弯臂根部钉在车身上，镜板竖着（z ≈ −1.0，高 1.51 ~ 1.86）
  for (const s of [-1, 1]) {
    const root = new Vector3(s * halfWidth(1.6), 1.6, -0.95);
    const elbow = new Vector3(s * (halfWidth(1.6) + 0.2), 1.62, -0.95);
    rod(root, elbow, 0.018, brassM);
    rod(elbow, new Vector3(s * (halfWidth(1.6) + 0.2), 1.68, -0.95), 0.018, brassM);
    const m = new Mesh(new BoxGeometry(0.05, 0.36, 0.2), new MeshStandardMaterial({ color: 0xd49a56, roughness: 0.85, flatShading: true }));
    m.position.set(s * (halfWidth(1.6) + 0.2), 1.86, -0.98);
    m.castShadow = true;
    g.add(m);
  }
  // 车顶栏杆：z −1.18 ~ −4.27，x ±0.62，高 0.22；立柱有方座，X 形木条
  const yR = 2.535;
  const xs = [-0.62, 0.62];
  const z0 = -1.18;
  const z1 = -4.27;
  const posts = 7;
  for (const x of xs) {
    for (let i = 0; i < posts; i++) {
      const z = z0 + ((z1 - z0) * i) / (posts - 1);
      const base = new Mesh(new BoxGeometry(0.07, 0.02, 0.07), brassM);
      base.position.set(x, yR + 0.01, z);
      g.add(base);
      rod(new Vector3(x, yR + 0.02, z), new Vector3(x, yR + 0.26, z), 0.014, brassM);
      ball(new Vector3(x, yR + 0.27, z), 0.022, brassM);
      if (i < posts - 1) {
        const zn = z0 + ((z1 - z0) * (i + 1)) / (posts - 1);
        rod(new Vector3(x, yR + 0.05, z), new Vector3(x, yR + 0.23, zn), 0.008, brassM);
        rod(new Vector3(x, yR + 0.23, z), new Vector3(x, yR + 0.05, zn), 0.008, brassM);
      }
    }
    rod(new Vector3(x, yR + 0.24, z0), new Vector3(x, yR + 0.24, z1), 0.011, brassM);
    rod(new Vector3(x, yR + 0.05, z0), new Vector3(x, yR + 0.05, z1), 0.011, brassM);
  }
  for (const z of [z0, z1]) {
    rod(new Vector3(xs[0]!, yR + 0.24, z), new Vector3(xs[1]!, yR + 0.24, z), 0.011, brassM);
    rod(new Vector3(xs[0]!, yR + 0.05, z), new Vector3(xs[1]!, yR + 0.05, z), 0.011, brassM);
  }
  // 风向标：栏杆前段正中一根杆（插在前横杆上的座里），顶上一只狗的剪影
  rod(new Vector3(0, yR + 0.24, -1.82), new Vector3(0, yR + 0.6, -1.82), 0.015, brassM);
  const dog = new Shape();
  const dp: Array<[number, number]> = [[-0.15, 0], [-0.15, 0.1], [-0.13, 0.15], [-0.08, 0.17], [-0.06, 0.22], [-0.03, 0.2], [0, 0.22], [0.03, 0.17], [0.1, 0.16], [0.15, 0.19], [0.17, 0.14], [0.12, 0.1], [0.1, 0], [0.06, 0], [0.05, 0.07], [-0.02, 0.07], [-0.04, 0], [-0.08, 0], [-0.09, 0.07], [-0.12, 0]];
  dp.forEach(([a, b], i) => (i === 0 ? dog.moveTo(a * 1.4, b * 1.4) : dog.lineTo(a * 1.4, b * 1.4)));
  const dg = new Mesh(new ExtrudeGeometry(dog, { depth: 0.02, bevelEnabled: false }), new MeshStandardMaterial({ color: 0xd9b078, roughness: 0.8 }));
  dg.rotation.y = Math.PI / 2;
  dg.position.set(-0.01, yR + 0.6, -1.82);
  dg.castShadow = true;
  g.add(dg);
  // 烟囱：车尾抬高那段车顶上（z −4.43 ~ −4.73），底座 + 方筒 + 帽 + 一根细天线
  const ch = new Mesh(new BoxGeometry(0.26, 0.3, 0.26), new MeshStandardMaterial({ color: 0xb8aa95, roughness: 0.9, flatShading: true }));
  ch.position.set(0.3, 2.65 + 0.15, -4.58);
  ch.castShadow = true;
  g.add(ch);
  const cap = new Mesh(new BoxGeometry(0.34, 0.06, 0.34), brassM);
  cap.position.set(0.3, 2.65 + 0.33, -4.58);
  g.add(cap);
  rod(new Vector3(0.3, 2.65 + 0.36, -4.58), new Vector3(0.3, 2.65 + 0.5, -4.58), 0.006, brassM);
  // 旗帜：驾驶室 + 货箱前段侧面一排小三角旗（z −1.12 ~ −2.4，到开口前为止），挂在一根细绳上，绳两端钉在车身上
  for (const s of [1]) {
    const xw = s * (halfWidth(1.37) + 0.012);
    rod(new Vector3(xw, 1.4, -1.12), new Vector3(xw, 1.4, -2.38), 0.004, brassM);
    for (let z = -1.2; z > -2.38; z -= 0.24) {
      const fl = new Shape();
      fl.moveTo(-0.09, 0);
      fl.lineTo(0.09, 0);
      fl.lineTo(0.09, -0.15);
      fl.lineTo(0, -0.25);
      fl.lineTo(-0.09, -0.15);
      const f = new Mesh(new ExtrudeGeometry(fl, { depth: 0.006, bevelEnabled: false }), new MeshStandardMaterial({ color: 0xf2e6d0, roughness: 0.9 }));
      f.rotation.y = Math.PI / 2;
      f.position.set(xw + 0.004, 1.4, z);
      f.castShadow = true;
      g.add(f);
    }
  }
  // 舷窗：正八角金框 + 里面一扇卷帘（米色帘片）
  for (const s of [-1, 1]) {
    const xw = s * (halfWidth(PORTHOLE.y) - PORTHOLE.depth);
    const frame = new Shape();
    octZY(0, 0, PORTHOLE.r + 0.06).forEach(([a, b], i) => (i === 0 ? frame.moveTo(a, b) : frame.lineTo(a, b)));
    const hole = new Shape();
    octZY(0, 0, PORTHOLE.r - 0.01).reverse().forEach(([a, b], i) => (i === 0 ? hole.moveTo(a, b) : hole.lineTo(a, b)));
    frame.holes.push(hole);
    const fm = new Mesh(new ExtrudeGeometry(frame, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 }), brassM);
    fm.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    fm.position.set(xw + (s > 0 ? 0.0 : 0.0), PORTHOLE.y, PORTHOLE.z);
    fm.castShadow = true;
    g.add(fm);
    for (let i = 0; i < 6; i++) {
      const yy = PORTHOLE.y + 0.26 - i * 0.09;
      const half = PORTHOLE.r * Math.cos(Math.PI / 8) - Math.max(0, Math.abs(yy - PORTHOLE.y) - 0.13);
      const sl = new Mesh(new BoxGeometry(0.01, 0.08, half * 2), new MeshStandardMaterial({ color: i % 3 === 1 ? 0xe0c9a2 : 0xf0dcbc, roughness: 0.9 }));
      sl.position.set(xw - s * 0.005, yy, PORTHOLE.z);
      g.add(sl);
    }
  }
  // 遮阳篷：一块条纹布绷在上扇板上（比板宽：z −2.23 ~ −5.16），外沿一排扇贝边；跟着上扇板一起翻
  const upA = open * ((75 * Math.PI) / 180);
  const [hx, hy] = c.hingeUpper;
  const pivot = new Group();
  pivot.position.set(hx, hy, 0);
  pivot.rotation.z = upA;
  const L = OPENING.y1 - OPENING.split + 0.14;
  const cv = document.createElement('canvas');
  cv.width = 16;
  cv.height = 256;
  const cx = cv.getContext('2d')!;
  ['#f1e6cf', '#c4cbb6', '#e2c28a', '#f1e6cf'].forEach((col, i) => {
    cx.fillStyle = col;
    cx.fillRect(0, i * 64, 16, 64);
  });
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapT = RepeatWrapping;
  const zA = -2.23;
  const zB = -5.16;
  tex.repeat.set(1, (zA - zB) / 0.6);
  // 布在板的卡纸外面（板外表面 + 卡纸厚 ≈ 2 厘米）
  const cloth = new Mesh(new BoxGeometry(0.01, L, zA - zB), new MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  cloth.position.set(0.03, -L / 2 + 0.07, (zA + zB) / 2);
  cloth.castShadow = true;
  pivot.add(cloth);
  // 扇贝边：外沿一排平的半圆布片，接着布往下垂
  const half = new Shape();
  half.absarc(0, 0, 0.06, Math.PI, 2 * Math.PI, false);
  const scM = new MeshStandardMaterial({ map: tex, roughness: 0.95, side: 2 });
  for (let z = zA - 0.06; z > zB + 0.03; z -= 0.12) {
    const sc = new Mesh(new ExtrudeGeometry(half, { depth: 0.008, bevelEnabled: false }), scM);
    sc.rotation.y = Math.PI / 2; // 半圆在 (z, y) 平面里，朝 -y 垂下
    sc.position.set(0.026, -L + 0.07, z);
    sc.castShadow = true;
    pivot.add(sc);
  }
  g.add(pivot);
}
