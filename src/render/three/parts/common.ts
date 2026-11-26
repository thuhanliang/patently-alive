import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, ShapeUtils, SphereGeometry, Vector2, Vector3, type BufferGeometry, type Material } from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { bev, rng } from '../craft';
import { paperMaterial } from '../paper';
import { brass, gold, goldDark } from './nose';

/**
 * 整车零件的公共部分（2026-11-26）：
 * 一切都按"纸怎么做出来"来想——大块是实心的厚纸板体（masses），表面一块块贴上有厚度的卡纸（tileFace），
 * 接缝处压金卡纸条（strip，两头用螺栓），圆杆有座（pole 两端各一个套环），斜面用整块实心体（convex），
 * 不把两个几何体随便放在一起：每个零件都交代"粘在哪里"。
 */

export const pb = (pts: Vector2[], depth: number, bevel: number, holes: Vector2[][] = []): BufferGeometry => bev(pts, depth, bevel, holes, 1);
export const rect = (x0: number, y0: number, x1: number, y1: number): Vector2[] => [new Vector2(x0, y0), new Vector2(x1, y0), new Vector2(x1, y1), new Vector2(x0, y1)];

export function mesh(geo: BufferGeometry, mats: Material | Material[]): Mesh {
  const x = new Mesh(geo, mats);
  x.castShadow = x.receiveShadow = true;
  return x;
}

export const shade = (c: number, k: number): number => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);
/** 厚纸板块：侧面同色略深。 */
export const block = (c: number, scale = 0.25): Material[] => [paperMaterial(c, { scale }), paperMaterial(shade(c, 0.8), { scale })];
/** 薄卡纸：切边露浅色纸芯。 */
export const sheet = (c: number, scale = 0.25): Material[] => [paperMaterial(c, { scale }), paperMaterial(0xf7efe0, { scale })];
export const goldMats: Material[] = [gold, goldDark];
export const woodMats = (c = 0xa0703e): Material[] => [paperMaterial(c, { scale: 0.12 }), paperMaterial(shade(c, 0.8), { scale: 0.12 })];
export const plain = (c: number, rough = 0.85): MeshStandardMaterial => new MeshStandardMaterial({ color: c, roughness: rough });

/** 空间里一块平的四边形卡纸：四个角 c（按顺序），正面朝 n，厚 t 往背面（-n）长。 */
export function plate(c: Vector3[], n: Vector3, t: number, mats: Material | Material[], bevel = 0.0012): Mesh {
  const ctr = c.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / c.length);
  const u = c[1]!.clone().sub(c[0]!).normalize();
  const v = new Vector3().crossVectors(n, u).normalize();
  const pts = c.map((p) => new Vector2(p.clone().sub(ctr).dot(u), p.clone().sub(ctr).dot(v)));
  if (ShapeUtils.isClockWise(pts)) pts.reverse();
  const x = mesh(pb(pts, t, Math.min(bevel, t * 0.3)), mats);
  x.matrixAutoUpdate = false;
  x.matrix.makeBasis(u, v, n).setPosition(ctr.clone().addScaledVector(n, -t));
  return x;
}

/** 实心体：一组点的凸包（斜面、楔形、棱台都用它——整块料，没有拼缝）。 */
export function convex(pts: Array<[number, number, number]>, mat: Material | Material[]): Mesh {
  const geo = new ConvexGeometry(pts.map((p) => new Vector3(...p)));
  const m = new Mesh(geo, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}

export interface TileOpts {
  seed: number;
  tones: number[];
  /** 平均块宽、块高（米） */
  cw?: number;
  ch?: number;
  th?: number;
  gap?: number;
  /** 跳过这个矩形（局部坐标 a0, b0, a1, b1）：窗、洞的位置 */
  skip?: Array<[number, number, number, number]>;
  /** 有的块凸出（3 毫米），露出白色切边 */
  lift?: number;
}

/**
 * 在一个矩形面上贴一块块有厚度的卡纸。面的原点 o，方向 u、v（单位向量），尺寸 w × h；n = u × v 朝外。
 * 卡纸的正面在这个面上，厚度往里长（所以"体块"要比这个面缩进 th，才不会共面）。
 */
export function tileFace(parent: Group, o: Vector3, u: Vector3, v: Vector3, w: number, h: number, opts: TileOpts): void {
  const r = rng(opts.seed);
  const n = new Vector3().crossVectors(u, v).normalize();
  const th = opts.th ?? 0.016;
  const gap = opts.gap ?? 0.005;
  const cw = opts.cw ?? 0.3;
  const ch = opts.ch ?? 0.25;
  const rows = Math.max(1, Math.round(h / ch));
  const rowH = h / rows;
  for (let ri = 0; ri < rows; ri++) {
    const b0 = ri * rowH;
    const b1 = b0 + rowH;
    let a = 0;
    while (a < w - 0.02) {
      const bw = Math.min(cw * (0.6 + r() * 0.8), w - a);
      const a0 = a;
      const a1 = a + bw;
      a = a1;
      const tone = opts.tones[Math.floor(r() * opts.tones.length)]!;
      const lift = opts.lift && r() < 0.18 ? opts.lift : 0;
      // 被"跳过"的矩形切开（不是整块跳过）
      let segs: Array<[number, number]> = [[a0, a1]];
      for (const [sa0, sb0, sa1, sb1] of opts.skip ?? []) {
        if (b1 <= sb0 || b0 >= sb1) continue;
        const next: Array<[number, number]> = [];
        for (const [x0, x1] of segs) {
          if (x1 <= sa0 || x0 >= sa1) next.push([x0, x1]);
          else {
            if (sa0 - x0 > 0.03) next.push([x0, sa0]);
            if (x1 - sa1 > 0.03) next.push([sa1, x1]);
          }
        }
        segs = next;
      }
      for (const [x0, x1] of segs) {
        const p = (aa: number, bb: number): Vector3 => o.clone().addScaledVector(u, aa).addScaledVector(v, bb);
        const q = [p(x0 + gap / 2, b0 + gap / 2), p(x1 - gap / 2, b0 + gap / 2), p(x1 - gap / 2, b1 - gap / 2), p(x0 + gap / 2, b1 - gap / 2)];
        const t = plate(q, n, th + lift, sheet(tone));
        if (lift) t.matrix.setPosition(new Vector3().setFromMatrixPosition(t.matrix).addScaledVector(n, lift));
        parent.add(t);
      }
    }
  }
}

/** 金卡纸压条：沿 a→b、宽 width、厚 thick，贴在法线为 n 的面上；两头各一颗螺栓（bolts）。 */
export function strip(parent: Group, a: Vector3, b: Vector3, width: number, thick: number, n: Vector3, bolts = false, mats: Material[] = goldMats): void {
  const dir = b.clone().sub(a).normalize();
  const side = new Vector3().crossVectors(n, dir).normalize().multiplyScalar(width / 2);
  parent.add(plate([a.clone().sub(side), b.clone().sub(side), b.clone().add(side), a.clone().add(side)], n, thick, mats));
  if (bolts) {
    for (const p of [a.clone().addScaledVector(dir, width * 0.9), b.clone().addScaledVector(dir, -width * 0.9)]) bolt(parent, p.addScaledVector(n, 0.0), n, width * 0.28);
  }
}

/** 螺栓：垫圈 + 扁圆帽，朝 n，立在点 p（面上）。 */
export function bolt(parent: Group, p: Vector3, n: Vector3, r = 0.012): void {
  const quat = new Mesh().quaternion.setFromUnitVectors(new Vector3(0, 1, 0), n);
  const washer = new Mesh(new CylinderGeometry(r * 1.6, r * 1.6, 0.003, 18), goldDark);
  washer.quaternion.copy(quat);
  washer.position.copy(p).addScaledVector(n, 0.0015);
  const cap = new Mesh(new SphereGeometry(r, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  cap.quaternion.copy(quat);
  cap.scale.set(1, 0.5, 1);
  cap.position.copy(p).addScaledVector(n, 0.003);
  washer.castShadow = cap.castShadow = true;
  parent.add(washer, cap);
}

/** 圆杆（木杆 / 铜杆）：从 a 到 b；两端各一个套环（交代"插在哪里"）。 */
export function pole(parent: Group, a: Vector3, b: Vector3, r: number, mat: Material, caps = true): void {
  const len = a.distanceTo(b);
  const dir = b.clone().sub(a).normalize();
  const quat = new Mesh().quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
  const rod = new Mesh(new CylinderGeometry(r, r, len, 8), mat);
  rod.quaternion.copy(quat);
  rod.position.copy(a).add(b).multiplyScalar(0.5);
  rod.castShadow = rod.receiveShadow = true;
  parent.add(rod);
  if (caps)
    for (const [p, s] of [
      [a, 1],
      [b, -1],
    ] as const) {
      const ring = new Mesh(new CylinderGeometry(r * 1.45, r * 1.45, r * 1.8, 8), brass);
      ring.quaternion.copy(quat);
      ring.position.copy(p).addScaledVector(dir, s * r * 0.9);
      ring.castShadow = true;
      parent.add(ring);
    }
}

/** 本地平面里的多边形轮廓（逆时针）→ 空间里一块板：原点 o，方向 u、v，厚 t 往 -n 长。 */
export function polyPlate(pts: Vector2[], o: Vector3, u: Vector3, v: Vector3, t: number, mats: Material | Material[]): Mesh {
  const n = new Vector3().crossVectors(u, v).normalize();
  const pp = pts.slice();
  if (ShapeUtils.isClockWise(pp)) pp.reverse();
  const x = mesh(pb(pp, t, Math.min(0.0012, t * 0.3)), mats);
  x.matrixAutoUpdate = false;
  x.matrix.makeBasis(u, v, n).setPosition(o.clone().addScaledVector(n, -t));
  return x;
}
