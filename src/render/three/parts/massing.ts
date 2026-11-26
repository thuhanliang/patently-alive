import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape, ShapeUtils, Vector2 } from 'three';
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
export const INTERIOR = { x: 0.86, y0: 0.97, y1: 2.42, z0: -2.4, z1: -5.5 }; // 货箱里面挖空的部分（墙厚约 0.07–0.16）
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
  for (const s of [-1, 1]) body = add(body, prismZ(octXY(s * LAMP.x, LAMP.y, LAMP.r), F - 0.02, F + LAMP.depth));
  body = sub(body, box(-GRILLE.hw, GRILLE.hw, GRILLE.y0, GRILLE.y1, F - GRILLE.depth, F + 0.1));
  const pitch = (2 * GRILLE.hw) / GRILLE.bars;
  for (let i = 0; i < GRILLE.bars; i++) {
    const x = -GRILLE.hw + (i + 0.5) * pitch;
    body = add(body, box(x - pitch * 0.2, x + pitch * 0.2, GRILLE.y0 - 0.005, GRILLE.y1 + 0.005, F - GRILLE.depth - 0.01, F - 0.012));
  }
  body = add(body, box(-MAILBOX.hw, MAILBOX.hw, MAILBOX.y0, MAILBOX.y1, F - 0.02, F + MAILBOX.depth));
  body = add(body, box(-BUMPER.hw, BUMPER.hw, BUMPER.y0, BUMPER.y1, F - 0.1, F + BUMPER.depth));
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
  return { body: body.geometry, flapUpper, flapLower, hingeUpper: [halfWidth(o.y1), o.y1], hingeLower: [halfWidth(o.y0), o.y0] };
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
export function buildMassing(open = 1): Group {
  const g = new Group();
  const mat = new MeshStandardMaterial({ color: 0xe6d6b8, roughness: 0.9, flatShading: true });
  const c = carve();
  const body = new Mesh(c.body, mat);
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const hinge = (geo: BufferGeometry, [hx, hy]: [number, number], angle: number): void => {
    const pivot = new Group();
    pivot.position.set(hx, hy, 0);
    const m = new Mesh(geo, new MeshStandardMaterial({ color: 0xd9c49e, roughness: 0.9, flatShading: true }));
    m.position.set(-hx, -hy, 0);
    m.castShadow = m.receiveShadow = true;
    pivot.add(m);
    pivot.rotation.z = angle;
    g.add(pivot);
  };
  hinge(c.flapUpper, c.hingeUpper, (open * Math.PI) / 2);
  hinge(c.flapLower, c.hingeLower, (-open * Math.PI) / 2);
  const tire = new MeshStandardMaterial({ color: 0x4a4440, roughness: 0.9 });
  for (const w of WHEELS)
    for (const s of [-1, 1]) {
      const t = new Mesh(new CylinderGeometry(w.r, w.r, WHEEL_W, 24), tire);
      t.rotation.z = Math.PI / 2;
      t.position.set(s * WHEEL_X, w.r, w.z);
      t.castShadow = true;
      g.add(t);
    }
  return g;
}
