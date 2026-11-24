import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
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
import { paperMaterial } from '../paper';

/**
 * 纸模型的工具（2026-11-25，事务所的车「阿宝」）。
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

/** 黄铜：哑光、偏黄，像设定图里那种旧的铜。 */
export const brassMat = new MeshStandardMaterial({ color: 0xc89a48, metalness: 0.82, roughness: 0.42 });
export const brassDark = new MeshStandardMaterial({ color: 0x9c7232, metalness: 0.8, roughness: 0.5 });
export const copperMat = new MeshStandardMaterial({ color: 0xb8693a, metalness: 0.75, roughness: 0.38 });
export const ironMat = new MeshStandardMaterial({ color: 0x55504a, metalness: 0.55, roughness: 0.6 });

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
export function slab(outer: Vector3[], t: number, holes: Vector3[][] = [], fitUv = false): BufferGeometry {
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
        [b2, arc + len, t],
        [a, arc, 0],
        [b2, arc + len, t],
        [a2, arc, t],
      ] as const) {
        pos.push(p.x, p.y, p.z);
        nor.push(sn.x, sn.y, sn.z);
        uv.push(s, w);
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
export function cardBox(w: number, h: number, d: number, color: number, scale = 0.5, kind: 'card' | 'kraft' | 'wood' = 'card'): Mesh {
  const pts = [V3(-w / 2, -h / 2, d / 2), V3(w / 2, -h / 2, d / 2), V3(w / 2, h / 2, d / 2), V3(-w / 2, h / 2, d / 2)];
  return mesh(slab(pts, d), card(color, scale, kind));
}

/** 黄铜条：沿一条折线走的扁条，宽 w、厚 h，贴在法线 n 那一面上。 */
export function strip(path: Vector3[], n: Vector3, w = 0.035, h = 0.012, closed = false, mat: Material = brassMat): Mesh {
  const geos: BufferGeometry[] = [];
  const segs = closed ? path.length : path.length - 1;
  for (let i = 0; i < segs; i++) {
    const a = path[i]!;
    const b = path[(i + 1) % path.length]!;
    const d = new Vector3().subVectors(b, a);
    const len = d.length() + w * 0.6;
    const side = new Vector3().crossVectors(n, d).normalize().multiplyScalar(w / 2);
    const dd = d.clone().normalize().multiplyScalar(len / 2);
    const mid = a.clone().add(b).multiplyScalar(0.5).addScaledVector(n, h);
    const quad = [mid.clone().sub(dd).sub(side), mid.clone().add(dd).sub(side), mid.clone().add(dd).add(side), mid.clone().sub(dd).add(side)];
    geos.push(slab(quad, h));
  }
  const g = merge(geos);
  const m = new Mesh(g, [mat, mat]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
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
    const g = new CylinderGeometry(0.7, 1, 0.45, 10);
    g.translate(0, 0.22, 0);
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
