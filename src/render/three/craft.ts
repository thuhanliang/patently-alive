import {
  BufferAttribute,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  CatmullRomCurve3,
  TubeGeometry,
  Group,
  LatheGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  SphereGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  ShapeUtils,
  Vector2,
  Vector3,
  type Material,
  type Object3D,
} from 'three';
import { paperMaterial } from './paper';

/**
 * 纸模型的工具（2026-11-25，事务所的车「勾勾」）。
 * 一切都是"卡纸片"：一块有厚度的平板（正面、背面、一圈断面），用黄铜条包边、铆钉钉住。
 * 单位是米。
 */

export const V3 = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

/** 卡纸的颜色（和设定图一致）。 */
export const C = {
  cream: 0xe8d9b8,
  creamLight: 0xf0e4c8,
  creamDark: 0xdcc8a2,
  peach: 0xe6c79a,
  blue: 0xb7ccd0,
  blueDark: 0x9fb8bf,
  tire: 0x6a625a,
  tireDark: 0x4f4943,
  chassis: 0x5b544d,
  wood: 0xa4744a,
  woodDark: 0x7d5434,
  woodLight: 0xc49a6c,
  felt: 0x8e8378,
  drawer: 0x9fb2b6,
  canvas: 0xe9e0cc,
  leather: 0x7a4a2e,
  copper: 0xb8693a,
  red: 0xb8452f,
  ink: 0x3a2618,
} as const;

/** 黄铜：只用在真的金属件上（铆钉、铃铛、小把手）；包边、框都是金卡纸（gold）。 */
export const brassMat = new MeshStandardMaterial({ color: 0xc89a48, metalness: 0.82, roughness: 0.42 });
export const brassDark = new MeshStandardMaterial({ color: 0x9c7232, metalness: 0.8, roughness: 0.5 });
export const copperMat = new MeshStandardMaterial({ color: 0xb8693a, metalness: 0.75, roughness: 0.38 });
export const ironMat = new MeshStandardMaterial({ color: 0x55504a, metalness: 0.55, roughness: 0.6 });

/**
 * 纸艺标准件（2026-11-25，docs/research/craft.md）：车、地形、植物、纸偶共用的纸材和做法。
 *
 * 纸材（模型上的毫米）：薄纸 0.2、卡纸 0.6、牛皮纸 0.4、金卡纸 0.5（覆膜，纸芯白）、毛毡 1.2、灰纸板 1.5。
 * 每个场景有自己的比例（一模型毫米 = 多少世界单位），厚度都按纸材换算，不随手写。
 * 做法：平板（slab，可开洞）、纸条（strip，斜切对接）、叠层块（cardBox / block）、叠圈回转体（stackRound）、
 * 卷筒和卷锥（rolled）、切片堆叠（slices）、开口铆钉（Rivets）。曲面都用这些做法"做"出来，不用光滑的曲面。
 */
export const STOCK_MM = { paper: 0.2, card: 0.6, kraft: 0.4, foil: 0.5, felt: 1.2, board: 1.5 } as const;
export type Stock = keyof typeof STOCK_MM;
/** 车的比例：车长 4.25 米 ≈ 模型 30 厘米，一模型毫米 ≈ 0.014 米。 */
export const VAN_MM = 0.014;
/** 车里默认的板厚（灰纸板一层）。 */
export const PLY = STOCK_MM.board * VAN_MM * 0.6;
export const mm = (stock: Stock, perMm = VAN_MM): number => STOCK_MM[stock] * perMm;

/** 一种颜色的卡纸（正面、断面两个材质）。 */
export function card(color: number, scale = 0.6, kind: 'card' | 'kraft' | 'wood' = 'card'): Material[] {
  return [paperMaterial(color, { kind, scale }), paperMaterial(color, { scale: 0.25, edge: true })];
}

/** 平面多边形的法线（Newell）。 */
function newell(pts: Vector3[]): Vector3 {
  const n = new Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    n.x += (a.y - b.y) * (a.z + b.z);
    n.y += (a.z - b.z) * (a.x + b.x);
    n.z += (a.x - b.x) * (a.y + b.y);
  }
  return n.normalize();
}

/**
 * 一块平板：outer 是空间里的一圈点（大致共面），holes 是开在上面的洞。
 * 从这个面往 -法线 方向长 t 厚（"往里"）；正面、背面都画，断面的纹理顺着边走。
 * 几何两组：0 正面和背面，1 断面。
 */
export function slab(outer: Vector3[], t: number, holes: Vector3[][] = [], fitUv = false, ply = t): BufferGeometry {
  const n = newell(outer);
  const o = outer[0]!;
  const u = new Vector3().subVectors(outer[1]!, o).normalize();
  const v = new Vector3().crossVectors(n, u).normalize();
  const to2 = (p: Vector3): Vector2 => {
    const d = new Vector3().subVectors(p, o);
    return new Vector2(d.dot(u), d.dot(v));
  };
  let o2 = outer.map(to2);
  let o3 = outer;
  if (ShapeUtils.isClockWise(o2)) {
    o2 = o2.reverse();
    o3 = [...outer].reverse();
  }
  const h2: Vector2[][] = [];
  const h3: Vector3[][] = [];
  for (const h of holes) {
    let a = h.map(to2);
    let b = h;
    if (!ShapeUtils.isClockWise(a)) {
      a = a.reverse();
      b = [...h].reverse();
    }
    h2.push(a);
    h3.push(b);
  }
  const all2 = [...o2, ...h2.flat()];
  const all3 = [...o3, ...h3.flat()];
  const tris = ShapeUtils.triangulateShape(o2, h2);
  const off = n.clone().multiplyScalar(-t);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  for (const tr of tris) {
    for (const k of tr) {
      const p = all3[k]!;
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
      uv.push(all2[k]!.x, all2[k]!.y);
    }
    for (const k of [tr[0]!, tr[2]!, tr[1]!]) {
      const p = all3[k]!.clone().add(off);
      pos.push(p.x, p.y, p.z);
      nor.push(-n.x, -n.y, -n.z);
      uv.push(all2[k]!.x, all2[k]!.y);
    }
  }
  const faceCount = pos.length / 3;
  if (fitUv) {
    // 贴图（标签、信、徽章）铺满正面：纹理坐标按正面的外框换算到 0–1。
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of o2) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    for (let i = 0; i < faceCount; i++) {
      uv[i * 2] = (uv[i * 2]! - x0) / (x1 - x0 || 1);
      uv[i * 2 + 1] = (uv[i * 2 + 1]! - y0) / (y1 - y0 || 1);
    }
  }
  const ring = (r: Vector3[]): void => {
    let arc = 0;
    for (let i = 0; i < r.length; i++) {
      const a = r[i]!;
      const b = r[(i + 1) % r.length]!;
      const e = new Vector3().subVectors(b, a);
      const len = e.length();
      const sn = new Vector3().crossVectors(e, n).normalize();
      const a2 = a.clone().add(off);
      const b2 = b.clone().add(off);
      for (const [p, s, w] of [
        [a, arc, 0],
        [b, arc + len, 0],
        [b2, arc + len, 1],
        [a, arc, 0],
        [b2, arc + len, 1],
        [a2, arc, 1],
      ] as const) {
        pos.push(p.x, p.y, p.z);
        nor.push(sn.x, sn.y, sn.z);
        uv.push(s / ply, (w * t) / ply);
      }
      arc += len;
    }
  };
  ring(o3);
  for (const h of h3) ring(h);
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.addGroup(0, faceCount, 0);
  g.addGroup(faceCount, pos.length / 3 - faceCount, 1);
  g.computeBoundingSphere();
  return g;
}

export function mesh(g: BufferGeometry, m: Material | Material[], shadow = true): Mesh {
  const x = new Mesh(g, m);
  x.castShadow = shadow;
  x.receiveShadow = true;
  return x;
}

/** 正多边形（在 xy 平面，r 是外接圆半径），rot 是起始角。 */
export function ngon(n: number, r: number, rot = Math.PI / n): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2;
    out.push(new Vector2(Math.cos(a) * r, Math.sin(a) * r));
  }
  return out;
}

/** 平面上的二维点 → 空间：origin + u·x + v·y。 */
export function lift(pts: Vector2[], origin: Vector3, u: Vector3, v: Vector3): Vector3[] {
  return pts.map((p) => origin.clone().addScaledVector(u, p.x).addScaledVector(v, p.y));
}

/** 一块长方体的卡纸（盒子），两种材质：面和断面。 */
/**
 * 一个盒子。纸模型里的盒子是一张纸折出来的：六个面都是纸面，棱是折痕（墨线画出来），不是一层层的断面。
 * 薄（d 小于两张卡纸厚）的才算一张纸，四边露断面；ply 给了就当成层层粘起来的厚块（少数地方才这么做）。
 */
export function cardBox(w: number, h: number, d: number, color: number, scale = 0.5, kind: 'card' | 'kraft' | 'wood' = 'card', ply?: number): Mesh {
  const pts = [V3(-w / 2, -h / 2, d / 2), V3(w / 2, -h / 2, d / 2), V3(w / 2, h / 2, d / 2), V3(-w / 2, h / 2, d / 2)];
  const m = card(color, scale, kind);
  if (ply !== undefined) return mesh(slab(pts, d, [], false, Math.min(d, ply)), m);
  if (Math.min(w, h, d) <= THIN) return mesh(slab(pts, d, [], false, Math.min(w, h, d)), m);
  // 折出来的盒子：侧面也用纸面的材质。
  return mesh(slab(pts, d, [], false, d), [m[0]!, m[0]!]);
}

/** 一张纸算"薄"的上限（米）：比这个薄的露纸的断面，比这个厚的是折出来的盒子。 */
export const THIN = 0.012;

/** 金卡纸（覆膜的卡纸：正面有一点金属光，断面是白色的纸芯）。 */
export const gold: Material[] = [paperMaterial(0xc99d4e, { kind: 'card', scale: 0.3, metal: 0.55 }), paperMaterial(0xc99d4e, { edge: true, core: 0.75 })];

/** 让一圈点的法线朝 n（slab 往 -法线 长厚度）。 */
export function orient(pts: Vector3[], n: Vector3): Vector3[] {
  return newell(pts).dot(n) >= 0 ? pts : [...pts].reverse();
}

/**
 * 一条纸条：沿折线 path 走、宽 w、厚 h，贴在法线 n 那一面上（path 就是纸条的底面，平平贴住，不悬空）。
 * 拐角斜切对接（不重叠、不穿模）；closed 时是一个框（外圈 + 内圈）。默认是金卡纸。
 */
export function strip(path: Vector3[], n: Vector3, w = 0.035, h = 0.012, closed = false, mat: Material | Material[] = gold): Mesh {
  const N = path.length;
  const half = w / 2;
  const left: Vector3[] = [];
  const right: Vector3[] = [];
  for (let i = 0; i < N; i++) {
    const p = path[i]!;
    const prev = closed ? path[(i + N - 1) % N]! : i > 0 ? path[i - 1]! : null;
    const next = closed ? path[(i + 1) % N]! : i < N - 1 ? path[i + 1]! : null;
    const side = (a: Vector3, b: Vector3): Vector3 => new Vector3().crossVectors(n, new Vector3().subVectors(b, a)).normalize();
    let m: Vector3;
    let k = 1;
    if (prev && next) {
      const s0 = side(prev, p);
      const s1 = side(p, next);
      m = s0.clone().add(s1);
      if (m.lengthSq() < 1e-8) m = s1;
      m.normalize();
      k = 1 / Math.max(0.35, m.dot(s1));
    } else m = prev ? side(prev, p) : side(p, next!);
    const top = p.clone().addScaledVector(n, h);
    left.push(top.clone().addScaledVector(m, half * k));
    right.push(top.clone().addScaledVector(m, -half * k));
  }
  let g: BufferGeometry;
  if (closed) {
    // 哪一圈在外取决于路径的绕向：面积大的那圈是外框。
    const area = (r: Vector3[]): number => {
      let acc = new Vector3();
      for (let i = 0; i < r.length; i++) acc = acc.add(new Vector3().crossVectors(r[i]!, r[(i + 1) % r.length]!));
      return Math.abs(acc.dot(n));
    };
    const [outer, inner] = area(left) >= area(right) ? [left, right] : [right, left];
    g = slab(orient(outer, n), h, [orient(inner, n).reverse()]);
  }
  else g = slab(orient([...left, ...right.reverse()], n), h);
  const mm = new Mesh(g, Array.isArray(mat) ? mat : [mat, mat]);
  mm.castShadow = true;
  mm.receiveShadow = true;
  return mm;
}

/** 把几个几何合成一个（两组：面、断面）。 */
export function merge(geos: BufferGeometry[]): BufferGeometry {
  const face: number[][] = [[], [], []];
  const edge: number[][] = [[], [], []];
  for (const g of geos) {
    const p = g.getAttribute('position').array;
    const n = g.getAttribute('normal').array;
    const uv = g.getAttribute('uv').array;
    const fc = g.groups[0] ? g.groups[0].count : p.length / 3;
    for (let i = 0; i < p.length / 3; i++) {
      const dst = i < fc ? face : edge;
      dst[0]!.push(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
      dst[1]!.push(n[i * 3]!, n[i * 3 + 1]!, n[i * 3 + 2]!);
      dst[2]!.push(uv[i * 2]!, uv[i * 2 + 1]!);
    }
    g.dispose();
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(new Float32Array([...face[0]!, ...edge[0]!]), 3));
  out.setAttribute('normal', new BufferAttribute(new Float32Array([...face[1]!, ...edge[1]!]), 3));
  out.setAttribute('uv', new BufferAttribute(new Float32Array([...face[2]!, ...edge[2]!]), 2));
  out.addGroup(0, face[0]!.length / 3, 0);
  out.addGroup(face[0]!.length / 3, edge[0]!.length / 3, 1);
  out.computeBoundingSphere();
  return out;
}

/** 铆钉：收集位置和朝向，最后一次画完（实例化）。 */
export class Rivets {
  private readonly list: Array<{ p: Vector3; n: Vector3; r: number }> = [];
  add(p: Vector3, n: Vector3, r = 0.011): void {
    this.list.push({ p: p.clone(), n: n.clone().normalize(), r });
  }
  /** 沿一条线每隔 step 钉一颗。 */
  along(a: Vector3, b: Vector3, n: Vector3, step = 0.16, r = 0.01, inset = 0.04): void {
    const len = a.distanceTo(b);
    const k = Math.max(1, Math.round((len - inset * 2) / step));
    for (let i = 0; i <= k; i++) this.add(new Vector3().lerpVectors(a, b, (inset + ((len - inset * 2) * i) / k) / len), n, r);
  }
  build(mat: Material = brassMat): InstancedMesh {
    // 开口铆钉（纸艺用的那种分脚钉）：一个扁圆的铜帽。
    const g = new SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, 0.45, 1);
    const m = new InstancedMesh(g, mat, Math.max(1, this.list.length));
    m.count = this.list.length;
    const q = new Quaternion();
    const M = new Matrix4();
    this.list.forEach((r, i) => {
      q.setFromUnitVectors(new Vector3(0, 1, 0), r.n);
      M.compose(r.p, q, new Vector3(r.r, r.r, r.r));
      m.setMatrixAt(i, M);
    });
    m.castShadow = true;
    return m;
  }
}

/** 一段铜管 / 细棒（从 a 到 b，半径 r）。 */
export function rod(a: Vector3, b: Vector3, r: number, mat: Material = brassMat, seg = 10): Mesh {
  const len = a.distanceTo(b);
  const m = new Mesh(new CylinderGeometry(r, r, len, seg), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  m.castShadow = true;
  return m;
}

/** 平面图形 → 竖着的一张有厚度的纸（在 xy 平面，朝 +z，厚 t），可带洞。 */
export function flat(pts: Vector2[], t: number, holes: Vector2[][] = [], fitUv = false): BufferGeometry {
  return slab(
    pts.map((p) => V3(p.x, p.y, t / 2)),
    t,
    holes.map((h) => h.map((p) => V3(p.x, p.y, t / 2))),
    fitUv,
  );
}

/** 画一张小图贴在纸上（标签、信、徽章的图案）。 */
export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat = false): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export function hex(c: number): string {
  return `#${new Color(c).getHexString()}`;
}

/** 小狗剪影（风向标、浮雕、徽章用）：一只站着、尾巴翘起的小狗，宽约 1、高约 0.8，脚在 y=0。 */
export function dogOutline(): Vector2[] {
  const p: Array<[number, number]> = [
    [-0.4, 0], [-0.33, 0], [-0.31, 0.24], [-0.22, 0.24], [-0.2, 0], [-0.13, 0], [-0.12, 0.26], [0.14, 0.26], [0.16, 0], [0.23, 0],
    [0.25, 0.28], [0.3, 0.38], [0.36, 0.46], [0.47, 0.5], [0.53, 0.55], [0.48, 0.61], [0.39, 0.64], [0.36, 0.76], [0.31, 0.64],
    [0.26, 0.56], [-0.28, 0.5], [-0.36, 0.56], [-0.48, 0.74], [-0.5, 0.7], [-0.42, 0.5], [-0.4, 0.4],
  ];
  return p.map(([x, y]) => new Vector2(x, y));
}

/** 均匀铺一些位置的随机数。 */
export function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
}

export function addAll(parent: Object3D, ...xs: Object3D[]): void {
  for (const x of xs) parent.add(x);
}

/** 设置位置、材质、转角（Object3D 的 position、rotation 不能直接赋值）。 */
export function put<T extends Object3D>(o: T, props: { position?: Vector3; material?: Material | Material[]; rotation?: { x?: number; y?: number; z?: number } }): T {
  if (props.position) o.position.copy(props.position);
  if (props.material && 'material' in o) (o as unknown as { material: Material | Material[] }).material = props.material;
  if (props.rotation) {
    if (props.rotation.x !== undefined) o.rotation.x = props.rotation.x;
    if (props.rotation.y !== undefined) o.rotation.y = props.rotation.y;
    if (props.rotation.z !== undefined) o.rotation.z = props.rotation.z;
  }
  return o;
}

/**
 * 叠圈回转体：按轮廓 profile（[y, 半径] 从下到上）一层层叠圆片（或圆环，hole 给内半径），每层一张 layer 厚的纸。
 * 水壶、碗、铃铛、瓶子都这么做：远看是圆的，近看是一圈圈纸的台阶。
 */
export function stackRound(profile: Array<[number, number]>, layer: number, color: number, opts: { segs?: number; hole?: (y: number) => number; kind?: 'card' | 'kraft' | 'wood'; mats?: Material[] } = {}): Mesh {
  const segs = opts.segs ?? 28;
  const y0 = profile[0]![0];
  const y1 = profile[profile.length - 1]![0];
  const rAt = (y: number): number => {
    for (let i = 0; i < profile.length - 1; i++) {
      const [ya, ra] = profile[i]!;
      const [yb, rb] = profile[i + 1]!;
      if (y >= ya && y <= yb) return ra + ((rb - ra) * (y - ya)) / (yb - ya || 1);
    }
    return profile[profile.length - 1]![1];
  };
  const geos: BufferGeometry[] = [];
  const rnd = rng(Math.round(color % 9973));
  for (let y = y0; y < y1 - 1e-6; y += layer) {
    const r = rAt(y + layer / 2);
    if (r <= 0.0005) continue;
    const rot = rnd() * 0.3;
    const outer = ngon(segs, r, rot);
    const hr = opts.hole?.(y + layer / 2) ?? 0;
    const g = flat(outer, layer, hr > 0.0005 && hr < r - 0.001 ? [ngon(segs, hr, rot)] : [], false);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y + layer / 2, 0);
    geos.push(g);
  }
  return mesh(merge(geos), opts.mats ?? card(color, 0.2, opts.kind ?? 'card'));
}

/**
 * 卷起来的纸筒 / 纸锥：一张纸卷一圈，看得见壁厚（上沿一圈纸边）和一道接缝。
 * r0 底半径、r1 顶半径、h 高、wall 壁厚。
 */
export function rolled(r0: number, r1: number, h: number, wall: number, color: number, segs = 24, kind: 'card' | 'kraft' | 'wood' = 'card'): Group {
  const g = new Group();
  const prof = [new Vector2(r0 - wall, 0), new Vector2(r0, 0), new Vector2(r1, h), new Vector2(r1 - wall, h), new Vector2(r0 - wall, 0)];
  const body = new Mesh(new LatheGeometry(prof, segs), paperMaterial(color, { kind, scale: 0.2 }));
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  // 接缝：一窄条叠上去的纸边。
  const sx = (r0 + r1) / 2;
  const seam = mesh(slab([V3(sx + 0.0005, 0, -wall * 1.5), V3(sx + 0.0005, h, -wall * 1.5), V3(sx + 0.0005, h, wall * 1.5), V3(sx + 0.0005, 0, wall * 1.5)], wall * 0.6), card(color, 0.2, kind), false);
  seam.rotation.y = 0.2;
  g.add(seam);
  return g;
}

/**
 * 切片堆叠：一个侧面轮廓（xy 平面）切成 n 片，沿 z 一片挨一片；每片的轮廓按 shrink(i) 缩一点，
 * 两边的片小、中间的大，叠出来就是个有体积的东西（靴子、坐垫、动物的身体）。
 */
export function slices(outline: Vector2[], n: number, t: number, color: number, shrink: (k: number) => number, kind: 'card' | 'kraft' | 'wood' = 'card'): Mesh {
  const geos: BufferGeometry[] = [];
  let cx = 0;
  let cy = 0;
  for (const p of outline) {
    cx += p.x / outline.length;
    cy += p.y / outline.length;
  }
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;
    const s = shrink(k);
    const pts = outline.map((p) => new Vector2(cx + (p.x - cx) * s, Math.min(p.y, cy + (p.y - cy) * s)));
    const g = flat(pts, t);
    g.translate(0, 0, (i - (n - 1) / 2) * t);
    geos.push(g);
  }
  return mesh(merge(geos), card(color, 0.2, kind));
}

/** 叠层块：几层板叠成一个块，最上和最下几层往里收一点（像垫子、圆角的块）。 */
export function block(w: number, h: number, d: number, color: number, layers: number, round = 0, kind: 'card' | 'kraft' | 'wood' = 'card'): Mesh {
  const geos: BufferGeometry[] = [];
  const t = h / layers;
  for (let i = 0; i < layers; i++) {
    const k = Math.abs((i + 0.5) / layers - 0.5) * 2;
    const inset = round * Math.pow(k, 3);
    const ww = w / 2 - inset;
    const dd = d / 2 - inset;
    const c = Math.min(ww, dd) * 0.25 + inset * 0.6;
    const pts = [new Vector2(-ww + c, -dd), new Vector2(ww - c, -dd), new Vector2(ww, -dd + c), new Vector2(ww, dd - c), new Vector2(ww - c, dd), new Vector2(-ww + c, dd), new Vector2(-ww, dd - c), new Vector2(-ww, -dd + c)];
    const g = flat(pts, t);
    g.rotateX(-Math.PI / 2);
    g.translate(0, -h / 2 + (i + 0.5) * t, 0);
    geos.push(g);
  }
  return mesh(merge(geos), card(color, 0.2, kind));
}

// ———— 五金件和胶带（2026-11-25） ————

/**
 * 合页：两片铜片（各带两颗钉）夹着一根卷起来的轴。轴沿 axis（局部 y），长 len；叶片朝 ±x 展开。
 * 门、盖子、翻板的转轴就放在这根轴上，转起来才像真的合页。
 */
export function hinge(len: number, leaf = len * 0.45, t = 0.004): Group {
  const g = new Group();
  const knuckle = new Mesh(new CylinderGeometry(t * 1.6, t * 1.6, len, 10), brassMat);
  knuckle.castShadow = true;
  g.add(knuckle);
  for (const s of [1, -1]) {
    const pts = [new Vector2(0, -len / 2), new Vector2(s * leaf, -len / 2 + len * 0.08), new Vector2(s * leaf, len / 2 - len * 0.08), new Vector2(0, len / 2)];
    const plate = mesh(flat(s > 0 ? pts : [...pts].reverse(), t), [brassMat, brassDark]);
    plate.position.z = -t / 2;
    g.add(plate);
    for (const y of [-len * 0.25, len * 0.25]) {
      const head = new Mesh(new SphereGeometry(t * 1.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), brassDark);
      head.rotation.x = Math.PI / 2;
      head.position.set(s * leaf * 0.6, y, t / 2);
      g.add(head);
    }
  }
  return g;
}

/** 图钉 / 小钉：一个圆头（朝 +z），后面一截看不见的钉身。 */
export function tack(r = 0.008, color: number | null = null): Mesh {
  const head = new Mesh(new SphereGeometry(r, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), color === null ? brassMat : new MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.2 }));
  head.rotation.x = Math.PI / 2;
  head.scale.set(1, 0.4, 1);
  head.castShadow = true;
  return head;
}

const tapeMat = new MeshStandardMaterial({ color: 0xe8d9a8, roughness: 0.75, transparent: true, opacity: 0.72, depthWrite: false });
/**
 * 一段纸胶带：从 a 贴到 b（贴在法线 n 那一面上），宽 w，两头是撕开的锯齿边。
 * 半透明，看得见底下的纸。
 */
export function tape(a: Vector3, b: Vector3, n: Vector3, w = 0.05, seed = 1): Mesh {
  const d = new Vector3().subVectors(b, a);
  const len = d.length();
  const u = d.clone().normalize();
  const v = new Vector3().crossVectors(n, u).normalize();
  const rnd = rng(seed);
  const pts: Vector3[] = [];
  const at2 = (x: number, y: number): Vector3 => a.clone().addScaledVector(u, x).addScaledVector(v, y).addScaledVector(n, 0.0015);
  pts.push(at2(0, -w / 2), at2(len, -w / 2));
  for (let i = 1; i < 7; i++) pts.push(at2(len + (i % 2 ? 0.006 : -0.002) + rnd() * 0.004, -w / 2 + (w * i) / 7));
  pts.push(at2(len, w / 2), at2(0, w / 2));
  for (let i = 6; i > 0; i--) pts.push(at2((i % 2 ? -0.006 : 0.002) - rnd() * 0.004, -w / 2 + (w * i) / 7));
  const m = new Mesh(slab(orient(pts, n), 0.001), [tapeMat, tapeMat]);
  m.receiveShadow = true;
  return m;
}

/** 一只铜丝弯的小挂钩（钉在墙上，钩口朝上）：base 在墙面上，朝 out 伸出。 */
export function hook(out: Vector3, r = 0.006): Group {
  const g = new Group();
  const curve = new CatmullRomCurve3([V3(0, 0, 0), out.clone().multiplyScalar(0.7), out.clone().add(V3(0, -0.01, 0)), out.clone().add(V3(0, 0.03, 0)).addScaledVector(out, -0.2)]);
  const m = new Mesh(new TubeGeometry(curve, 16, r, 6), brassMat);
  m.castShadow = true;
  g.add(m);
  const plate = new Mesh(new CylinderGeometry(r * 2.4, r * 2.4, r * 0.8, 12), brassDark);
  plate.quaternion.setFromUnitVectors(V3(0, 1, 0), out.clone().normalize());
  g.add(plate);
  return g;
}

/**
 * 物理一点的动：一个带阻尼的弹簧（门、抽屉、盖子朝目标走，到位时有一点点回弹，像真的东西有分量）。
 * k 刚度、c 阻尼；step 用半隐式欧拉，固定小步，帧率变了结果也稳。
 */
export class Spring {
  v = 0;
  constructor(
    public x: number,
    public target = x,
    public k = 90,
    public c = 14,
  ) {}
  step(dt: number): number {
    let t = Math.min(dt, 0.1);
    while (t > 0) {
      const h = Math.min(t, 1 / 120);
      this.v += (this.k * (this.target - this.x) - this.c * this.v) * h;
      this.x += this.v * h;
      t -= h;
    }
    return this.x;
  }
  /** 撞到头（抽屉拉到底、门开到合页的极限）：速度反向打掉大半。 */
  clamp(lo: number, hi: number): number {
    if (this.x < lo) {
      this.x = lo;
      this.v = -this.v * 0.25;
    } else if (this.x > hi) {
      this.x = hi;
      this.v = -this.v * 0.25;
    }
    return this.x;
  }
}

/**
 * 挂着的东西（铃铛、晾绳上的卡、流苏）：单摆。重力把它拉回竖直，阻尼让它慢慢停下；
 * kick 给它一下（被碰、车在动），它就按自己的摆长晃起来。
 */
export class Pendulum {
  a = 0;
  w = 0;
  constructor(
    public len = 0.15,
    public damp = 1.2,
  ) {}
  kick(v: number): void {
    this.w += v;
  }
  step(dt: number, accel = 0): number {
    let t = Math.min(dt, 0.1);
    while (t > 0) {
      const h = Math.min(t, 1 / 120);
      this.w += (-(9.8 / this.len) * Math.sin(this.a) - this.damp * this.w - accel / this.len) * h;
      this.a += this.w * h;
      t -= h;
    }
    return this.a;
  }
}

const twineMat = new MeshStandardMaterial({ color: 0xc8ad7a, roughness: 1 });
const twineDark = new MeshStandardMaterial({ color: 0xa88c5c, roughness: 1 });
/**
 * 麻绳：两股细绳拧在一起（螺旋绕着一条中线），沿 curve 走；r 是整根绳的半径。
 * 粗看是一根绳，近看是一股一股拧出来的。
 */
export function twine(curve: CatmullRomCurve3, r = 0.006, turnsPerM = 90): Group {
  const g = new Group();
  const len = curve.getLength();
  const n = Math.max(24, Math.round(len * turnsPerM * 6));
  const frames = curve.computeFrenetFrames(n, false);
  for (let s = 0; s < 2; s++) {
    const pts: Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = curve.getPointAt(t);
      const a = t * len * turnsPerM * Math.PI * 2 + s * Math.PI;
      pts.push(p.addScaledVector(frames.normals[i]!, Math.cos(a) * r * 0.5).addScaledVector(frames.binormals[i]!, Math.sin(a) * r * 0.5));
    }
    const m = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), n, r * 0.55, 5), s ? twineDark : twineMat);
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** 两点之间挂一根绳（悬链线，近似成抛物线）：sag 是中间往下垂多少。 */
export function hang(a: Vector3, b: Vector3, sag: number, seg = 16): CatmullRomCurve3 {
  const pts: Vector3[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    pts.push(new Vector3().lerpVectors(a, b, t).add(V3(0, -4 * sag * t * (1 - t), 0)));
  }
  return new CatmullRomCurve3(pts);
}

// ———— 墨线和压边（2026-11-26） ————

const inkMat = new LineBasicMaterial({ color: 0x3e2a1c, transparent: true, opacity: 0.78 });
const inkSoft = new LineBasicMaterial({ color: 0x5a4430, transparent: true, opacity: 0.4 });

/**
 * 给一组里的每个网格勾一圈墨线（折痕、纸边、轮廓）：纸模型印刷时沿边描的那条深色细线。
 * angle：面和面夹角大于这个（度）才画线；会动的零件也能勾，线跟着网格走。
 */
export function ink(group: Object3D, angle = 28, soft = false): void {
  // 线按"会一起动的一组"合并：一组只画一次。组的边界是 group 本身和标了 noBake / inkRoot 的子树（门、抽屉、盖子……）。
  group.updateWorldMatrix(true, true);
  const buckets = new Map<Object3D, number[]>();
  const rootOf = (o: Object3D): Object3D => {
    let p: Object3D | null = o.parent;
    while (p && p !== group && !p.userData['noBake'] && !p.userData['inkRoot']) p = p.parent;
    return p ?? group;
  };
  const inv = new Matrix4();
  const M = new Matrix4();
  const v = new Vector3();
  group.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || (o as { isInstancedMesh?: boolean }).isInstancedMesh || o.userData['noInk']) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    if (mats.some((x) => x.transparent)) return;
    const e = new EdgesGeometry(m.geometry, angle);
    const pos = e.getAttribute('position');
    if (pos.count === 0) return;
    const r = rootOf(m);
    inv.copy(r.matrixWorld).invert();
    M.multiplyMatrices(inv, m.matrixWorld);
    let arr = buckets.get(r);
    if (!arr) buckets.set(r, (arr = []));
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(M);
      arr.push(v.x, v.y, v.z);
    }
    e.dispose();
  });
  for (const [r, arr] of buckets) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(arr), 3));
    const l = new LineSegments(g, soft ? inkSoft : inkMat);
    l.userData['noInk'] = true;
    l.raycast = () => {};
    r.add(l);
  }
}

/**
 * 压边：沿一圈轮廓往里缩 inset，贴一条细细的凸棱（一窄条纸，比底下高一张纸）。
 * 一块平板四周有了这一圈，立刻就有"做出来的"细节感。轮廓点在平板正面上，n 是正面的法线。
 */
export function bead(outline: Vector3[], n: Vector3, inset = 0.03, w = 0.012, h = 0.004, color = 0xe2d2b0): Mesh {
  const c = outline.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / outline.length);
  const pts = outline.map((p) => {
    const d = new Vector3().subVectors(c, p);
    const len = d.length();
    return p.clone().addScaledVector(d.normalize(), Math.min(inset * 1.15, len * 0.4));
  });
  return strip(pts, n, w, h, true, card(color, 0.3));
}
