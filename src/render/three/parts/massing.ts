import { BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh, MeshStandardMaterial, Shape, ShapeUtils, Vector2 } from 'three';
import { Brush, Evaluator, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';

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

export const ARCH_R = 0.6; // 轮拱八角的外接半径（侧视：拱宽约 0.57·2，顶在 0.97 米）
export const OPENING = { z0: -2.44, z1: -4.97, y0: 0.97, y1: 2.02 }; // 服务侧开口：x 从 +1.2 挖到 -0.9（留 12 厘米的远侧墙）
export const PORTHOLE = { z: -1.74, y: 1.86, r: 0.33, depth: 0.04 };

export function cuts(): Cut[] {
  const out: Cut[] = [];
  // 轮拱：八角，只挖掉两侧（轮子之间的车底保留，中间是底盘）
  for (const w of WHEELS) {
    const oct = octZY(w.z, w.r, ARCH_R).filter(([, y]) => y > w.r - 0.01); // 上半个八角
    const pts: Array<[number, number]> = [[w.z + ARCH_R, -0.1], ...oct.sort((a, b) => b[0] - a[0]), [w.z - ARCH_R, -0.1]];
    for (const s of [-1, 1]) out.push({ name: 'arch', geo: prismX(pts, s > 0 ? 0.52 : -1.2, s > 0 ? 1.2 : -0.52) });
  }
  // 服务侧开口（+x）
  const o = OPENING;
  out.push({ name: 'opening', geo: box(-0.9, 1.2, o.y0, o.y1, o.z0, o.z1) });
  // 舷窗凹槽（两侧）
  for (const s of [-1, 1]) {
    const hw = 0.93;
    out.push({ name: 'porthole', geo: prismX(octZY(PORTHOLE.z, PORTHOLE.y, PORTHOLE.r), s > 0 ? hw - PORTHOLE.depth : -1.2, s > 0 ? 1.2 : -hw + PORTHOLE.depth) });
  }
  return out;
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

/** 体块 = 侧面轮廓挤出 ∩ 正面截面挤出；再减掉每一刀。 */
export function carvedBody(withCuts = true): BufferGeometry {
  const ev = new Evaluator();
  ev.attributes = ['position', 'uv', 'normal'];
  let cur = ev.evaluate(brush(prismX(PROFILE, -1.2, 1.2)), brush(sectionPrism()), INTERSECTION);
  if (withCuts) for (const c of cuts()) cur = ev.evaluate(cur, brush(c.geo), SUBTRACTION);
  return cur.geometry;
}

export function buildMassing(): Group {
  const g = new Group();
  const body = new Mesh(carvedBody(), new MeshStandardMaterial({ color: 0xe6d6b8, roughness: 0.9, flatShading: true }));
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const tire = new MeshStandardMaterial({ color: 0x4a4440, roughness: 0.9 });
  for (const w of WHEELS)
    for (const s of [-1, 1]) {
      const c = new Mesh(new CylinderGeometry(w.r, w.r, WHEEL_W, 24), tire);
      c.rotation.z = Math.PI / 2;
      c.position.set(s * WHEEL_X, w.r, w.z);
      c.castShadow = true;
      g.add(c);
    }
  return g;
}
