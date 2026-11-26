import { BufferGeometry, Color, Float32BufferAttribute, Group, Matrix4, Mesh, MeshStandardMaterial, Shape, ShapeUtils, Vector2, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bev, rng } from '../craft';
import { paperMaterial } from '../paper';
import { gold, goldDark } from './nose';

/**
 * 第 3 步（2026-11-26，用户：先做大块，再雕刻细节，最后拿到几何体的面的坐标变成"卡纸"部件）：
 * 1. 把雕好的实体的三角形按"同一个平面 + 连在一起"合成一个个面；
 * 2. 每个面求出轮廓（外圈 + 洞）；
 * 3. 在面上按网格切成一块块卡纸（被轮廓裁剪），每块是有厚度的纸板，正面贴在原来的面上往外长一个纸厚；
 * 4. 每条向外凸的棱（两个面夹角明显）压一条金卡纸包边。
 * 所以卡纸天然贴合大轮廓，接缝处有包边，不会出现零件之间对不上的情况。
 */

export interface CardOpts {
  seed?: number;
  tones?: number[];
  /** 卡纸块的平均尺寸（米） */
  tile?: number;
  thick?: number;
  gap?: number;
  /** 包边的宽度；0 表示不包边 */
  trim?: number;
  /** 只包夹角大于这个角度的棱（度） */
  trimAngle?: number;
  /** 不切块（整面一张）：小零件用 */
  whole?: boolean;
  /** 单一颜色（不随机） */
  color?: number;
  /** 侧面（纸芯）颜色 */
  core?: number;
}

interface Face {
  n: Vector3;
  d: number;
  tris: number[]; // 三角形序号
}

const key = (v: Vector3): string => `${Math.round(v.x * 2000)},${Math.round(v.y * 2000)},${Math.round(v.z * 2000)}`;

/** 实体 → 卡纸。 */
export function cardify(geo: BufferGeometry, opts: CardOpts = {}): Group {
  // 配色按设计图：奶油色为主，少量灰绿，偶尔一块土黄
  const tones = opts.tones ?? [0xf2e4ca, 0xf2e4ca, 0xeddcbd, 0xeddcbd, 0xe6d3b1, 0xf6ecd9, 0xcdd2c0, 0xc2cab8, 0xdcc196];
  const tile = opts.tile ?? 0.42;
  const thick = opts.thick ?? 0.014;
  const gap = opts.gap ?? 0.006;
  const trim = opts.trim ?? 0; // 默认不包边：金边只加在设计图里真有的地方（用户：不要做成套路）
  const trimAngle = ((opts.trimAngle ?? 25) * Math.PI) / 180;
  const r = rng(opts.seed ?? 7);

  // 1. 合并顶点
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.getAttribute('position');
  const verts: Vector3[] = [];
  const vmap = new Map<string, number>();
  const tri: Array<[number, number, number]> = [];
  for (let i = 0; i < pos.count; i += 3) {
    const ids: number[] = [];
    for (let k = 0; k < 3; k++) {
      const v = new Vector3().fromBufferAttribute(pos, i + k);
      const kk = key(v);
      let id = vmap.get(kk);
      if (id === undefined) {
        id = verts.length;
        verts.push(v);
        vmap.set(kk, id);
      }
      ids.push(id);
    }
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) continue;
    tri.push(ids as [number, number, number]);
  }
  const normals = tri.map(([a, b, c]) => new Vector3().subVectors(verts[b]!, verts[a]!).cross(new Vector3().subVectors(verts[c]!, verts[a]!)));
  const areas = normals.map((n) => n.length() / 2);
  normals.forEach((n) => n.normalize());

  // 2. 按边相邻 + 共面合成面
  const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);
  const edgeTris = new Map<string, number[]>();
  tri.forEach(([a, b, c], t) => {
    if (areas[t]! < 1e-9) return;
    for (const [p, q] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = edgeKey(p, q);
      const l = edgeTris.get(k);
      if (l) l.push(t);
      else edgeTris.set(k, [t]);
    }
  });
  // 按"同一个平面"归组（不要求三角形相连：布尔运算后的 T 形接头会把一个平面断成几块，各自配色就会出现斜三角色块）
  const faceOf = new Array<number>(tri.length).fill(-1);
  const faces: Face[] = [];
  for (let t = 0; t < tri.length; t++) {
    if (areas[t]! < 1e-9) continue;
    const n = normals[t]!;
    const d = n.dot(verts[tri[t]![0]]!);
    let fi = faces.findIndex((f) => f.n.dot(n) > 0.999 && Math.abs(f.d - d) < 4e-3);
    if (fi < 0) {
      fi = faces.length;
      faces.push({ n: n.clone(), d, tris: [] });
    }
    faces[fi]!.tris.push(t);
    faceOf[t] = fi;
  }

  const out = new Group();
  // 每块卡纸拆成"正反面"和"侧面（纸芯）"两部分：正反面按颜色合并，侧面全部合成一个（浅色纸芯）
  const byTone = new Map<number, BufferGeometry[]>();
  const cores: BufferGeometry[] = [];
  const pushGeo = (tone: number, geo2: BufferGeometry): void => {
    const [caps, sides] = splitGroups(geo2);
    const l = byTone.get(tone);
    if (l) l.push(caps);
    else byTone.set(tone, [caps]);
    cores.push(sides);
  };

  // 3. 每个面 → 轮廓 → 卡纸块
  for (const f of faces) {
    let area = 0;
    for (const t of f.tris) area += areas[t]!;
    if (area < 0.002) continue;
    // 面内坐标系
    const n = f.n;
    const up = Math.abs(n.y) > 0.9 ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
    const u = new Vector3().crossVectors(up, n).normalize();
    const v = new Vector3().crossVectors(n, u).normalize();
    const o = n.clone().multiplyScalar(f.d);
    const to2 = (p: Vector3): Vector2 => new Vector2(p.clone().sub(o).dot(u), p.clone().sub(o).dot(v));
    // 面的范围（所有三角形的投影）
    const tri2 = f.tris.map((t) => tri[t]!.map((id) => to2(verts[id]!)) as [Vector2, Vector2, Vector2]);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const tr of tri2)
      for (const p of tr) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    // 网格切块（每块一个颜色）。布尔运算后的三角形在接缝处有 T 形接头，按边界追轮廓不可靠，
    // 所以每块卡纸 = 网格块 ∩ 这个面里的每个三角形（碎片同色、无缝，看起来是一整块）。
    const cells: Array<[number, number, number, number, number]> = [];
    if (opts.whole) cells.push([minX - 1, minY - 1, maxX + 1, maxY + 1, opts.color ?? tones[Math.floor(r() * tones.length)]!]);
    else {
      const rows = Math.max(1, Math.round((maxY - minY) / (tile * 0.8)));
      const rh = (maxY - minY) / rows;
      for (let ri = 0; ri < rows; ri++) {
        let x = minX;
        while (x < maxX - 1e-4) {
          let w = Math.min(tile * (0.6 + r() * 0.8), maxX - x);
          if (maxX - (x + w) < tile * 0.3) w = maxX - x;
          cells.push([x, minY + ri * rh, x + w, minY + (ri + 1) * rh, opts.color ?? tones[Math.floor(r() * tones.length)]!]);
          x += w;
        }
      }
    }
    const M = new Matrix4().makeBasis(u, v, n).setPosition(o);
    for (const [x0, y0, x1, y1, tone] of cells) {
      const rect = [new Vector2(x0 + gap / 2, y0 + gap / 2), new Vector2(x1 - gap / 2, y0 + gap / 2), new Vector2(x1 - gap / 2, y1 - gap / 2), new Vector2(x0 + gap / 2, y1 - gap / 2)];
      const lift = !opts.whole && r() < 0.15 ? thick * 0.5 : 0; // 有的块多叠一层，露出切边
      for (const tr of tri2) {
        let pts = tr.slice();
        if (ShapeUtils.isClockWise(pts)) pts = pts.reverse();
        const piece = clipPoly(pts, rect);
        if (piece.length < 3 || Math.abs(ShapeUtils.area(piece)) < 2e-6) continue;
        let geo2: BufferGeometry;
        try {
          geo2 = bev(piece, thick + lift, 0, [], 1);
        } catch {
          continue;
        }
        geo2.applyMatrix4(M);
        geo2.translate(n.x * 0.0005, n.y * 0.0005, n.z * 0.0005);
        pushGeo(tone, geo2);
      }
    }
  }
  const addMerged = (list: BufferGeometry[], mat: Material): void => {
    if (!list.length) return;
    const merged = mergeGeometries(list, false);
    if (!merged) return;
    const m = new Mesh(merged, mat);
    m.castShadow = m.receiveShadow = true;
    out.add(m);
  };
  for (const [tone, list] of byTone) addMerged(list, paperMaterial(tone, { scale: 0.25 }));
  addMerged(cores, paperMaterial(opts.core ?? 0xf6eee0, { scale: 0.25 }));

  // 4. 凸棱压金包边
  if (trim > 0) {
    const strips: BufferGeometry[] = [];
    for (const [k, ts] of edgeTris) {
      if (ts.length !== 2) continue;
      const [t0, t1] = ts as [number, number];
      if (faceOf[t0] === faceOf[t1]) continue;
      const n0 = normals[t0]!;
      const n1 = normals[t1]!;
      const ang = Math.acos(Math.max(-1, Math.min(1, n0.dot(n1))));
      if (ang < trimAngle) continue;
      const [ia, ib] = k.split('_').map(Number) as [number, number];
      const a = verts[ia]!;
      const b = verts[ib]!;
      // 凸棱：第二个三角形的第三个顶点在第一个面的背面
      const third = tri[t1]!.find((x) => x !== ia && x !== ib)!;
      if (n0.dot(new Vector3().subVectors(verts[third]!, a)) > 1e-5) continue; // 凹进去的棱不包
      const len = a.distanceTo(b);
      if (len < 0.02) continue;
      const dirv = new Vector3().subVectors(b, a).normalize();
      const bis = n0.clone().add(n1).normalize();
      const side = new Vector3().crossVectors(bis, dirv).normalize();
      const s = new Shape([new Vector2(-trim / 2, 0), new Vector2(trim / 2, 0), new Vector2(trim / 2, len), new Vector2(-trim / 2, len)]);
      void s;
      const geo2 = bev([new Vector2(-trim / 2, 0), new Vector2(trim / 2, 0), new Vector2(trim / 2, len), new Vector2(-trim / 2, len)], thick * 0.8, thick * 0.25, [], 1);
      geo2.applyMatrix4(new Matrix4().makeBasis(side, dirv, bis).setPosition(a.clone().addScaledVector(bis, thick * 0.7)));
      strips.push(geo2);
    }
    const caps: BufferGeometry[] = [];
    const sides: BufferGeometry[] = [];
    for (const st of strips) {
      const [c, sd] = splitGroups(st);
      caps.push(c);
      sides.push(sd);
    }
    addMerged(caps, gold);
    addMerged(sides, goldDark);
  }
  void Color;
  void MeshStandardMaterial;
  return out;
}

/** ExtrudeGeometry 的两个组：0 = 正反面，1 = 侧面。拆成两个非索引几何（只留 position、normal、uv）。 */
function splitGroups(geo: BufferGeometry): [BufferGeometry, BufferGeometry] {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const outs: BufferGeometry[] = [];
  for (const gi of [0, 1]) {
    const res = new BufferGeometry();
    const parts = g.groups.filter((x) => (x.materialIndex ?? 0) === gi);
    for (const name of ['position', 'normal', 'uv']) {
      const a = g.getAttribute(name);
      if (!a) continue;
      const arr: number[] = [];
      for (const p of parts) for (let i = p.start; i < p.start + p.count; i++) for (let k = 0; k < a.itemSize; k++) arr.push(a.array[i * a.itemSize + k]!);
      res.setAttribute(name, new Float32BufferAttribute(arr, a.itemSize));
    }
    outs.push(res);
  }
  return [outs[0]!, outs[1]!];
}

/** 去掉共线的点。 */
function simplify(loop: Vector2[]): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < loop.length; i++) {
    const a = loop[(i - 1 + loop.length) % loop.length]!;
    const b = loop[i]!;
    const c = loop[(i + 1) % loop.length]!;
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) > 1e-7 || a.distanceTo(b) < 1e-6) out.push(b);
  }
  return out.length >= 3 ? out : loop;
}

/** Sutherland–Hodgman：多边形 poly 裁到凸多边形 clip（逆时针）里。 */
function clipPoly(poly: Vector2[], clip: Vector2[]): Vector2[] {
  let out = poly;
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const inside = (p: Vector2): boolean => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= -1e-9;
    const inp = out;
    out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j]!;
      const q = inp[(j + 1) % inp.length]!;
      const ip = inside(p);
      const iq = inside(q);
      if (ip) out.push(p);
      if (ip !== iq) {
        const d1 = new Vector2(q.x - p.x, q.y - p.y);
        const d2 = new Vector2(b.x - a.x, b.y - a.y);
        const den = d1.x * d2.y - d1.y * d2.x;
        const t = ((a.x - p.x) * d2.y - (a.y - p.y) * d2.x) / den;
        out.push(new Vector2(p.x + d1.x * t, p.y + d1.y * t));
      }
    }
    if (!out.length) break;
  }
  return out;
}
