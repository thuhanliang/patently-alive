import { type Material, BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Matrix4, CanvasTexture, RepeatWrapping, SRGBColorSpace, SphereGeometry, Shape, ShapeUtils, Vector2, Vector3 } from 'three';
import { cardify } from './cardify';
import { pb } from './common';
import { paperMaterial } from '../paper';
import { L0, LT, frontGold, frontRivet, frontSheet, octZY as oct8, rectXY, rectZY, sideGold, sideRivet, sideSheet } from './skin';
import { gold, goldDark, headlamp } from './nose';
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
  // 腰线（车身侧面往里收的肩）：侧视里旗帜上方那道水平饰条，约 1.43 米。正视图里的台阶在 1.57 附近，
  // 但那样会穿过舷窗（舷窗底边约 1.51），判断正视图那里是引擎盖两侧伸出的部分，腰线按侧视放在 1.40 ~ 1.48。
  [1.4, 1.02],
  [1.48, 0.93],
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
export const PORTHOLE = { z: -1.74, y: 1.88, r: 0.32, depth: 0.04 }; // 底边约 1.58，整个落在腰线以上的墙上
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
    grp.add(core, cardify(geo, color === 0xe6d6b8 ? { paint: paintBody } : { color }));
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
  for (const s of [-1, 1]) {
    noseSideSkin(g, s);
    cabSideSkin(g, s);
    fenderSkin(g, s);
  }
  frontSkin(g);
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
  const glass = new MeshStandardMaterial({ color: 0x6a6258, transparent: true, opacity: 0.35, roughness: 0.08, depthWrite: false });
  const dark = new MeshStandardMaterial({ color: 0x4e463e, roughness: 0.95 });
  // 斜面上贴纸：局部 (x, d)，d = 沿斜面从 WS_A 往上的距离；k = 离斜面的高度（正 = 往外）
  const basisW = new Matrix4().makeBasis(new Vector3(1, 0, 0), along, n);
  const dOf = (y: number): number => ((y - WS_A[1]) / dy) * L;
  const slopeSheet = (x0: number, x1: number, y0: number, y1: number, k: number, t: number, m: Material | Material[]): void => {
    const geo = pb([new Vector2(x0, dOf(y0)), new Vector2(x1, dOf(y0)), new Vector2(x1, dOf(y1)), new Vector2(x0, dOf(y1))], t, Math.min(0.0015, t * 0.3));
    const mesh = new Mesh(geo, m);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(basisW).setPosition(new Vector3(0, WS_A[1], WS_A[0]).addScaledVector(n, k));
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  };
  const goldM = [gold, goldDark];
  const cream = [paperMaterial(0xf2e5cc, { scale: 0.2 }), paperMaterial(0xf6eee0, { scale: 0.2 })];
  // 窗下沿、窗上沿（顶梁）金条，上面一条奶油板（车顶前沿），两侧和中间立柱金条
  slopeSheet(-W.hw - 0.04, W.hw + 0.04, W.y0 - 0.04, W.y0 + 0.005, L0, 0.008, goldM);
  slopeSheet(-W.hw - 0.04, W.hw + 0.04, W.y1 - 0.005, W.y1 + 0.045, L0, 0.008, goldM);
  slopeSheet(-W.hw - 0.04, W.hw + 0.04, W.y1 + 0.045, 2.36, L0, 0.008, cream);
  for (const x of [-W.hw - 0.04, W.hw]) slopeSheet(x, x + 0.04, W.y0 - 0.04, W.y1 + 0.045, L0, 0.008, goldM);
  slopeSheet(-W.mull - 0.005, W.mull + 0.005, W.y0, W.y1, L0, 0.008, goldM);
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
    // 窗洞底：深色（驾驶室里面是暗的）；两侧各一幅奶油色窗帘
    const back = new Mesh(new BoxGeometry(w + 0.01, len, 0.004), dark);
    back.matrixAutoUpdate = false;
    back.matrix.copy(basis).setPosition(c0.clone().addScaledVector(along, len / 2).addScaledVector(n, -0.1));
    g.add(back);
    const curtain = new Mesh(new BoxGeometry(0.11, len * 0.85, 0.006), slat[0]!);
    curtain.matrixAutoUpdate = false;
    curtain.matrix.copy(basis).setPosition(c0.clone().add(new Vector3(s * (w / 2 - 0.06), 0, 0)).addScaledVector(along, len * 0.45).addScaledVector(n, -0.085));
    g.add(curtain);
    // 卷帘（眼皮）：帘片从上往下放，放下 30%
    const pitch = 0.046;
    const k = Math.floor((len * 0.3) / pitch);
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
  // 胡须（换掉金属杆，用户：金属杆的感觉不好）：剪纸的猫胡须——每侧一颗金色圆"腮扣"钉在信箱两边，
  // 扣下面压着三根细长的奶油色卡纸条，根部宽、尖部细，略弯，水平往外伸出车身；离正面 2 厘米，在灯的下面（灯底约 0.75）。
  const whiskerMat = [paperMaterial(0xf6ead4, { scale: 0.15 }), paperMaterial(0xc9a66a, { scale: 0.15 })];
  for (const s of [-1, 1]) {
    // 根部插在信箱侧面（x ±0.25，信箱从正面伸出 0.17），纸条在灯的下面（灯框底约 0.72）、在正面外 0.1，整根都露在外面
    const root = new Vector2(s * 0.25, 0.67);
    for (let i = 0; i < 3; i++) {
      const tipY = 0.67 + (i - 1) * 0.05;
      const tip = new Vector2(s * (1.16 - Math.abs(i - 1) * 0.06), tipY + (i - 1) * 0.03);
      const mid = new Vector2(s * 0.7, (root.y + tipY) / 2 - 0.02);
      const pts: Vector2[] = [];
      const N = 12;
      const curve = (t: number): Vector2 => new Vector2((1 - t) * (1 - t) * root.x + 2 * (1 - t) * t * mid.x + t * t * tip.x, (1 - t) * (1 - t) * root.y + 2 * (1 - t) * t * mid.y + t * t * tip.y);
      const halfW = (t: number): number => 0.018 * (1 - t) + 0.003;
      const top: Vector2[] = [];
      const bot: Vector2[] = [];
      for (let k = 0; k <= N; k++) {
        const t = k / N;
        const p = curve(t);
        const q = curve(Math.min(1, t + 0.01)).sub(curve(Math.max(0, t - 0.01))).normalize();
        const nrm = new Vector2(-q.y, q.x);
        top.push(p.clone().addScaledVector(nrm, halfW(t)));
        bot.push(p.clone().addScaledVector(nrm, -halfW(t)));
      }
      pts.push(...top, ...bot.reverse());
      let area = 0;
      for (let k = 0; k < pts.length; k++) area += pts[k]!.x * pts[(k + 1) % pts.length]!.y - pts[(k + 1) % pts.length]!.x * pts[k]!.y;
      if (area < 0) pts.reverse();
      const wm = new Mesh(pb(pts, 0.005, 0.001), whiskerMat);
      wm.position.z = F + 0.1 + i * 0.006;
      wm.castShadow = true;
      g.add(wm);
    }
    // 腮扣：金色圆扣压住三根纸条的根部
    const btn = new Mesh(new CylinderGeometry(0.045, 0.05, 0.03, 16), brassM);
    btn.rotation.x = Math.PI / 2;
    btn.rotation.set(0, 0, Math.PI / 2); // 圆扣贴在信箱侧面（朝 ±x）
    btn.position.set(root.x + s * 0.015, root.y, F + 0.11);
    btn.castShadow = true;
    g.add(btn);
  }
  // 铃：保险杠正中下面一个吊环，挂一只铜铃
  const bell = new Mesh(new CylinderGeometry(0.04, 0.08, 0.13, 14), brassM);
  bell.position.set(0, BUMPER.y0 - 0.1, F + 0.03);
  g.add(bell);
  rod(new Vector3(0, BUMPER.y0, F + 0.03), new Vector3(0, BUMPER.y0 - 0.035, F + 0.03), 0.008, brassM);
  // 后视镜：A 柱外侧，弯臂根部钉在车身上，镜板竖着（z ≈ −1.0，高 1.51 ~ 1.86）
  for (const s of [-1, 1]) {
    // 后视镜装在 A 柱根部（挡风玻璃下角外侧），在司机看得见的位置：镜子在侧窗前面、车身外面
    const root = new Vector3(s * (halfWidth(1.6) - 0.02), 1.62, -0.74);
    // 正视：镜子在车身外 0.35，镜板高 0.42、宽 0.22，斜着装；弯臂从 A 柱根部出来
    const elbow = new Vector3(s * (halfWidth(1.6) + 0.3), 1.66, -0.74);
    rod(root, elbow, 0.02, brassM);
    rod(elbow, new Vector3(s * (halfWidth(1.6) + 0.33), 1.76, -0.74), 0.02, brassM);
    // 镜面朝后（司机从侧窗往后看得见）：镜板在 x–y 平面里，宽 0.24、高 0.42、厚 0.05；从侧面看只是一条窄边，从正面看是一整块
    const m = new Mesh(new BoxGeometry(0.24, 0.42, 0.05), new MeshStandardMaterial({ color: 0xd49a56, roughness: 0.85, flatShading: true }));
    m.position.set(s * (halfWidth(1.6) + 0.35), 1.96, -0.74);
    m.rotation.z = -s * 0.12;
    m.rotation.y = -s * 0.25;
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
  for (const s of [-1, 1]) {
    const xw = s * (halfWidth(1.2) + L0 + 2 * LT + 0.006); // 挂在腰带外面的金条上
    rod(new Vector3(xw + 0.006, 1.34, -1.12), new Vector3(xw + 0.006, 1.34, -2.38), 0.004, brassM);
    for (let z = -1.2; z > -2.38; z -= 0.24) {
      const fl = new Shape();
      fl.moveTo(-0.09, 0);
      fl.lineTo(0.09, 0);
      fl.lineTo(0.09, -0.15);
      fl.lineTo(0, -0.25);
      fl.lineTo(-0.09, -0.15);
      const f = new Mesh(new ExtrudeGeometry(fl, { depth: 0.006, bevelEnabled: false }), new MeshStandardMaterial({ color: 0xf2e6d0, roughness: 0.9 }));
      f.rotation.y = Math.PI / 2;
      f.position.set(xw + 0.01, 1.34, z);
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
    const fm = new Mesh(new ExtrudeGeometry(frame, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 1 }), brassM);
    fm.rotation.y = s > 0 ? Math.PI / 2 : -Math.PI / 2;
    // 金框压在外皮最外一层上（凹槽外沿），框的里沿伸进凹槽
    fm.position.set(s * (halfWidth(PORTHOLE.y) + L0 + LT), PORTHOLE.y, PORTHOLE.z);
    fm.castShadow = true;
    g.add(fm);
    for (let i = 0; i < 6; i++) {
      const yy = PORTHOLE.y + 0.26 - i * 0.09;
      const half = PORTHOLE.r * Math.cos(Math.PI / 8) - Math.max(0, Math.abs(yy - PORTHOLE.y) - 0.13);
      const sl = new Mesh(new BoxGeometry(0.01, 0.08, half * 2), new MeshStandardMaterial({ color: i % 3 === 1 ? 0xe0c9a2 : 0xf0dcbc, roughness: 0.9 }));
      sl.position.set(xw + s * (L0 + 0.008), yy, PORTHOLE.z); // 凹槽底的整纸外面
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

/**
 * 车身每张纸的颜色（按部位，不随机）：顶面最浅；侧墙奶油；腰线以下略深的米色；轮眉、保险杠沙色；
 * 前脸奶油；格栅凹槽里深褐。拼板（灰绿腰带）是单独贴上去的部件，见 addDetails2。
 */
function paintBody(c: Vector3, n: Vector3): number {
  if (c.z < F - 0.03 && c.z > F - GRILLE.depth - 0.02 && Math.abs(c.x) < GRILLE.hw && c.y > GRILLE.y0 && c.y < GRILLE.y1) return 0x3a2a1c; // 格栅里面
  if (c.y < BUMPER.y1 + 0.01 && c.z > F - 0.12) return 0xdcc49a; // 保险杠
  if (Math.abs(c.x) > halfWidth(0.5) + 0.01 && c.y < 1.2) return 0xdcc49a; // 轮眉
  if (n.y > 0.5) return 0xf6ecd9; // 顶面、引擎盖
  if (n.z > 0.7) return 0xf0e2c6; // 前脸
  if (Math.abs(n.x) > 0.7 && c.y < 1.4) return 0xe8d6b4; // 腰线以下的侧墙
  if (Math.abs(n.x) > 0.7) return 0xf2e5cc; // 腰线以上的侧墙
  return 0xece0c6; // 其它（斜面、后墙、内壁）
}

/**
 * 车鼻子侧面（z 0.05 ~ −0.9，腰线以下 x = 1.02）：设计图侧视里是三列竖向的板，列与列之间压金条加铆钉；
 * 第一列是灰绿的大板（外围一圈桃色底），第二列是一摞横的小板，第三列是一块整奶油板；下面一条桃色保险杠带。
 */
const C_CREAM = 0xf2e5cc;
const C_CREAM2 = 0xeedcbc;
const C_PEACH = 0xe6bf8e;
const C_GREEN = 0xbcc6b0;
const C_SAND = 0xdcc49a;
function noseSideSkin(g: Group, s: number): void {
  const x1 = halfWidth(1.0) + L0; // 第 1 层贴在这里
  const x2 = x1 + LT;
  // 保险杠带（底下）
  sideSheet(g, s, x1, rectZY(0.04, -0.86, 0.34, 0.6), C_PEACH);
  sideGold(g, s, x2, 0.04, -0.86, 0.58, 0.615, 0.28);
  // 第一列：桃色底 + 灰绿大板
  sideSheet(g, s, x1, rectZY(0.0, -0.44, 0.63, 1.36), C_PEACH);
  sideSheet(g, s, x2, rectZY(-0.06, -0.38, 0.68, 1.31), C_GREEN);
  // 金条（列之间）+ 前角金条
  sideGold(g, s, x1, 0.045, 0.0, 0.34, 1.42, 0.3);
  sideGold(g, s, x1, -0.44, -0.49, 0.62, 1.38, 0.26);
  // 第二列：一摞横的小板
  const rows = [0.63, 0.82, 1.0, 1.19, 1.37];
  for (let i = 0; i < rows.length - 1; i++) sideSheet(g, s, x1, rectZY(-0.5, -0.74, rows[i]! + 0.004, rows[i + 1]! - 0.004), i % 2 ? C_CREAM2 : C_PEACH);
  sideGold(g, s, x1, -0.745, -0.77, 0.62, 1.38, 0.0);
  // 第三列：整块奶油板（避开轮眉）+ 内框
  sideSheet(g, s, x1, [[-0.775, 0.63], [-0.86, 0.63], [-0.86, 1.37], [-0.775, 1.37]], C_CREAM);
  // 顶上沿：引擎盖下沿一根金条
  sideGold(g, s, x1, 0.04, -0.9, 1.38, 1.42, 0.0);
}

/**
 * 驾驶室侧面（z −0.9 ~ −2.44）：
 * - 腰线以下（x 1.02）：一条灰绿腰带（y 1.09 ~ 1.38），上沿金条带一排铆钉，小旗挂在金条上；腰带下一条窄金条压在轮眉上方。
 * - 腰线以上（x 0.93）：灰绿底板上一个奶油色的方框（四条厚纸板条），框里是舷窗：奶油色八角圈 + 金框；顶上一条奶油横板 + 金条（顶梁）；
 *   前面靠挡风玻璃一条竖金条（A 柱后沿）。
 */
function cabSideSkin(g: Group, s: number): void {
  const xl = halfWidth(1.2) + L0;
  const xu = halfWidth(1.9) + L0;
  // 腰线以下
  sideSheet(g, s, xl, rectZY(-0.88, -2.42, 1.09, 1.38), C_GREEN);
  sideGold(g, s, xl + LT, -0.88, -2.42, 1.35, 1.395, 0.24);
  sideGold(g, s, xl, -0.88, -2.42, 1.065, 1.09, 0.0);
  // 引擎盖侧面上沿（腰线以上、挡风玻璃前面那一小块三角）：奶油板 + 顺着引擎盖斜边一条金条
  const hood = (z: number): number => (z > -0.058 ? 1.481 : z > -0.585 ? 1.481 + ((1.572 - 1.481) * (z + 0.058)) / (-0.585 + 0.058) : 1.572 + ((1.658 - 1.572) * (z + 0.585)) / (-0.72 + 0.585));
  sideSheet(g, s, xu, [[-0.3, 1.49], [-0.86, 1.49], [-0.86, 1.67], [-0.72, hood(-0.72) - 0.012], [-0.585, hood(-0.585) - 0.012], [-0.3, hood(-0.3) - 0.012]], C_CREAM);
  // （顺着引擎盖斜边的金条去掉了：它跨过腰线的倒角，会悬在车身外面）
  // 腰线以上：灰绿底板
  const winHole: Array<[number, number]> = rectZY(-0.96, -1.2, 1.7, 2.16);
  // 车身侧面的前沿：挡风玻璃斜边（侧面轮廓上 (−0.758, 1.685) → (−0.989, 2.369)）；贴纸都要退到这条线后面 2 厘米
  const zs = (y: number): number => -0.758 + ((y - 1.685) * (-0.989 + 0.758)) / (2.369 - 1.685) - 0.02;
  sideSheet(g, s, xu, [[-0.86, 1.5], [-2.42, 1.5], [-2.42, 2.26], [zs(2.26), 2.26], [zs(1.69), 1.69], [-0.86, 1.69]], C_GREEN, LT, [oct8(PORTHOLE.z, PORTHOLE.y, PORTHOLE.r + 0.04), winHole]);
  // 侧窗：A 柱和舷窗框之间一扇竖窗——深色玻璃（缩在底板后面）+ 金框
  sideSheet(g, s, xu - 0.01, winHole, 0x4a4036, 0.004);
  sideSheet(g, s, xu + LT, rectZY(-0.94, -1.22, 1.68, 2.18), [gold, goldDark], 0.006, [rectZY(-0.965, -1.195, 1.705, 2.155)]);
  // 奶油方框（四条板）
  const fz0 = -1.24;
  const fz1 = -2.3;
  const fy0 = 1.5;
  const fy1 = 2.26;
  const bw = 0.08;
  sideSheet(g, s, xu + LT, rectZY(fz0, fz0 - bw, fy0, fy1), C_CREAM);
  sideSheet(g, s, xu + LT, rectZY(fz1 + bw, fz1, fy0, fy1), C_CREAM);
  sideSheet(g, s, xu + LT, rectZY(fz0 - bw, fz1 + bw, fy0, fy0 + 0.07), C_CREAM);
  sideSheet(g, s, xu + LT, rectZY(fz0 - bw, fz1 + bw, fy1 - 0.07, fy1), C_CREAM);
  for (const [z, y] of [
    [fz0 - bw / 2, fy0 + 0.04],
    [fz0 - bw / 2, fy1 - 0.04],
    [fz1 + bw / 2, fy0 + 0.04],
    [fz1 + bw / 2, fy1 - 0.04],
  ] as const)
    sideRivet(g, s, xu + 2 * LT, z, y, 0.012);
  // 舷窗外圈：奶油色八角圈（挖掉中间）
  sideSheet(g, s, xu + LT, oct8(PORTHOLE.z, PORTHOLE.y, PORTHOLE.r + 0.12), C_CREAM2, LT, [oct8(PORTHOLE.z, PORTHOLE.y, PORTHOLE.r + 0.05)]);
  for (let k = 0; k < 8; k++) {
    const ang = (k * Math.PI) / 4;
    sideRivet(g, s, xu + 2 * LT, PORTHOLE.z + Math.cos(ang) * (PORTHOLE.r + 0.09), PORTHOLE.y + Math.sin(ang) * (PORTHOLE.r + 0.09), 0.009);
  }
  // A 柱后沿：竖金条
  // A 柱后沿：顺着挡风玻璃斜边的一条金条
  sideSheet(g, s, xu + LT, [[zs(1.69), 1.69], [zs(2.26), 2.26], [zs(2.26) - 0.045, 2.26], [zs(1.69) - 0.045, 1.69]], [gold, goldDark], 0.006);
  // 顶梁：奶油横板 + 金条
  sideSheet(g, s, xu, rectZY(zs(2.3), -2.42, 2.26, 2.33), C_CREAM);
  sideGold(g, s, xu + LT, zs(2.3), -2.42, 2.29, 2.33, 0.3);
}

/** 轮眉外面的纸：一圈奶油色厚纸板（八角环），外沿一道金边、几颗铆钉。轮眉外表面在 x = 1.02 + 0.07 + 整纸。 */
function fenderSkin(g: Group, s: number): void {
  const xf = halfWidth(0.5) + FENDER.out + L0;
  for (const w of WHEELS) {
    const ring = (r0: number, r1: number): Array<Array<[number, number]>> => {
      const top = (r: number): Array<[number, number]> => oct8(w.z, w.r, r).filter(([, y]) => y > w.r - 1e-6);
      const o = top(r1).sort((a, b) => b[0] - a[0]);
      const i = top(r0).sort((a, b) => a[0] - b[0]);
      return [[[w.z + r1, w.r - 0.02], ...o, [w.z - r1, w.r - 0.02], [w.z - r0, w.r - 0.02], ...i, [w.z + r0, w.r - 0.02]]];
    };
    sideSheet(g, s, xf, ring(ARCH_R + 0.02, FENDER.r - 0.03)[0]!, C_CREAM);
    sideSheet(g, s, xf, ring(FENDER.r - 0.028, FENDER.r)[0]!, [gold, goldDark], 0.006);
    for (let k = 0; k < 4; k++) {
      const ang = Math.PI / 8 + (k * Math.PI) / 4;
      sideRivet(g, s, xf + LT, w.z + Math.cos(ang) * (FENDER.r - 0.07), w.r + Math.sin(ang) * (FENDER.r - 0.07), 0.012);
    }
  }
}

/**
 * 车头正面（正视图读的，z = 0.05 + 整纸）：两侧灯后面各一块灰绿竖板，格栅两边各一条竖金条，
 * 鼻子顶上一条横金条（引擎盖下沿）；保险杠上四个金卡扣（带两颗铆钉）、两端金包角；信箱正面一块方金搭扣。
 */
function frontSkin(g: Group): void {
  const z1 = F + L0;
  for (const s of [-1, 1]) {
    frontSheet(g, z1, rectXY(s * 0.98, s * 0.74, 0.62, 1.33), C_GREEN);
    frontGold(g, z1 + LT, s * 0.995, s * 0.965, 0.6, 1.36, 0.22);
    frontGold(g, z1, s * 0.26, s * 0.3, GRILLE.y1 + 0.02, 1.36, 0.0);
  }
  frontGold(g, z1, -1.0, 1.0, 1.36, 1.4, 0.32);
  // 灯下面一条横的奶油板（灯和保险杠之间）
  frontSheet(g, z1, rectXY(-0.72, -0.27, 0.6, 0.72), C_CREAM2);
  frontSheet(g, z1, rectXY(0.27, 0.72, 0.6, 0.72), C_CREAM2);
  // 保险杠（正面在 z = F + BUMPER.depth + 整纸）
  const zb = F + BUMPER.depth + L0;
  for (const x of [-0.74, -0.37, 0.37, 0.74]) {
    frontSheet(g, zb, rectXY(x - 0.045, x + 0.045, BUMPER.y0 + 0.01, BUMPER.y1 - 0.01), [gold, goldDark], 0.008);
    frontRivet(g, zb + 0.008, x, BUMPER.y1 - 0.06, 0.012);
    frontRivet(g, zb + 0.008, x, BUMPER.y0 + 0.06, 0.012);
  }
  for (const s of [-1, 1]) frontSheet(g, zb, rectXY(s * BUMPER.hw, s * (BUMPER.hw - 0.08), BUMPER.y0, BUMPER.y1), [gold, goldDark], 0.01);
  // 格栅一圈金框（压在正面整纸上）
  frontSheet(g, z1, rectXY(-GRILLE.hw - 0.05, GRILLE.hw + 0.05, GRILLE.y0 - 0.05, GRILLE.y1 + 0.05), [gold, goldDark], 0.01, [rectXY(-GRILLE.hw, GRILLE.hw, GRILLE.y0, GRILLE.y1)]);
  // 信箱正面的金搭扣
  const zm = F + MAILBOX.depth + L0;
  frontSheet(g, zm, rectXY(-0.06, 0.06, 0.74, 0.86), [gold, goldDark], 0.012, [rectXY(-0.035, 0.035, 0.765, 0.835)]);
  frontSheet(g, zm, rectXY(-0.035, 0.035, 0.765, 0.835), 0x6a5040, 0.004);
}
