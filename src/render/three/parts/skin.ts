import { Group, Matrix4, Mesh, SphereGeometry, CylinderGeometry, Vector2, Vector3, type Material } from 'three';
import { paperMaterial } from '../paper';
import { pb } from './common';
import { gold, goldDark } from './nose';

/**
 * 车身外皮的"多层纸"细节（2026-11-26，用户：不同配色用多层纸实现，结合设计图大幅增加细节）。
 * 体块转成整纸以后，侧面的颜色、分块、饰条都按设计图（三视图侧视）一层层贴上去：
 *   第 0 层：整纸（cardify，离体块 0.015）
 *   第 1 层：底板、色块（离体块 0.015 起，厚 0.008）
 *   第 2 层：压在色块上的框、条（再往外 0.008）
 *   金条：金卡纸压条（厚 0.006）+ 铆钉
 * 位置都从侧视读：z = 0.05 − (像素 x − 157)·0.005385，y = (610 − 像素 y)·0.005385。
 */

export const L0 = 0.015; // 整纸外表面离体块
export const LT = 0.008; // 每层纸厚

const mats = new Map<number, Material[]>();
function paper(c: number): Material[] {
  let m = mats.get(c);
  if (!m) {
    m = [paperMaterial(c, { scale: 0.2 }), paperMaterial(0xf6eee0, { scale: 0.2 })];
    mats.set(c, m);
  }
  return m;
}

/**
 * 在车身侧面（s = ±1）贴一层纸：轮廓在 (z, y) 里给，贴在离车身中线 x0 的面上，往外厚 t。
 * holes：轮廓里挖的洞（同样是 (z, y)）。
 */
export function sideSheet(g: Group, s: number, x0: number, pts: Array<[number, number]>, color: number | Material[], t = LT, holes: Array<Array<[number, number]>> = [], bevel = 0.0015): Mesh {
  const a = (z: number): number => (s > 0 ? -z : z);
  const toV = (p: Array<[number, number]>): Vector2[] => {
    const v = p.map(([z, y]) => new Vector2(a(z), y));
    // 保证逆时针
    let area = 0;
    for (let i = 0; i < v.length; i++) area += v[i]!.x * v[(i + 1) % v.length]!.y - v[(i + 1) % v.length]!.x * v[i]!.y;
    return area < 0 ? v.reverse() : v;
  };
  const hs = holes.map((h) => toV(h).reverse());
  const geo = pb(toV(pts), t, Math.min(bevel, t * 0.3), hs);
  const u = new Vector3(0, 0, s > 0 ? -1 : 1);
  const n = new Vector3(s, 0, 0);
  const m = new Mesh(geo, typeof color === 'number' ? paper(color) : color);
  m.matrixAutoUpdate = false;
  m.matrix.copy(new Matrix4().makeBasis(u, new Vector3(0, 1, 0), n).setPosition(s * x0, 0, 0));
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}

export const rectZY = (z0: number, z1: number, y0: number, y1: number): Array<[number, number]> => [
  [z0, y0],
  [z1, y0],
  [z1, y1],
  [z0, y1],
];

/** 正八边形（平边朝上下），中心 (z, y)，外接半径 r。 */
export function octZY(z: number, y: number, r: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let k = 0; k < 8; k++) {
    const ang = Math.PI / 8 + (k * Math.PI) / 4;
    out.push([z + Math.cos(ang) * r, y + Math.sin(ang) * r]);
  }
  return out;
}

/** 侧面一颗铆钉：垫圈 + 扁圆帽，在 (z, y)，面在 x0。 */
export function sideRivet(g: Group, s: number, x0: number, z: number, y: number, r = 0.012): void {
  const w = new Mesh(new CylinderGeometry(r * 1.5, r * 1.5, 0.003, 14), goldDark);
  w.rotation.z = Math.PI / 2;
  w.position.set(s * (x0 + 0.0015), y, z);
  const c = new Mesh(new SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  c.rotation.z = (-s * Math.PI) / 2;
  c.scale.set(1, 0.55, 1);
  c.position.set(s * (x0 + 0.003), y, z);
  c.castShadow = true;
  g.add(w, c);
}

/** 侧面金条：沿 z 或 y 的矩形金卡纸压条，可带一排铆钉。 */
export function sideGold(g: Group, s: number, x0: number, z0: number, z1: number, y0: number, y1: number, rivetStep = 0): void {
  sideSheet(g, s, x0, rectZY(z0, z1, y0, y1), [gold, goldDark], 0.006, [], 0.0015);
  if (rivetStep > 0) {
    const horiz = Math.abs(z1 - z0) > Math.abs(y1 - y0);
    const len = horiz ? Math.abs(z1 - z0) : Math.abs(y1 - y0);
    const k = Math.max(2, Math.round(len / rivetStep) + 1);
    for (let i = 0; i < k; i++) {
      const t = (i + 0.5) / k;
      const z = horiz ? z0 + (z1 - z0) * t : (z0 + z1) / 2;
      const y = horiz ? (y0 + y1) / 2 : y0 + (y1 - y0) * t;
      sideRivet(g, s, x0 + 0.006, z, y, Math.min(0.011, Math.min(Math.abs(z1 - z0), Math.abs(y1 - y0)) * 0.3));
    }
  }
}

/** 在车头正面（朝 +z）贴一层纸：轮廓在 (x, y) 里，面在 z0，往外厚 t。 */
export function frontSheet(g: Group, z0: number, pts: Array<[number, number]>, color: number | Material[], t = LT, holes: Array<Array<[number, number]>> = []): Mesh {
  const toV = (p: Array<[number, number]>): Vector2[] => {
    const v = p.map(([x, y]) => new Vector2(x, y));
    let area = 0;
    for (let i = 0; i < v.length; i++) area += v[i]!.x * v[(i + 1) % v.length]!.y - v[(i + 1) % v.length]!.x * v[i]!.y;
    return area < 0 ? v.reverse() : v;
  };
  const geo = pb(toV(pts), t, Math.min(0.0015, t * 0.3), holes.map((h) => toV(h).reverse()));
  const m = new Mesh(geo, typeof color === 'number' ? paper(color) : color);
  m.position.z = z0;
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}
export const rectXY = (x0: number, x1: number, y0: number, y1: number): Array<[number, number]> => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
/** 正面一颗铆钉。 */
export function frontRivet(g: Group, z0: number, x: number, y: number, r = 0.012): void {
  const w = new Mesh(new CylinderGeometry(r * 1.5, r * 1.5, 0.003, 14), goldDark);
  w.rotation.x = Math.PI / 2;
  w.position.set(x, y, z0 + 0.0015);
  const c = new Mesh(new SphereGeometry(r, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  c.rotation.x = Math.PI / 2;
  c.scale.set(1, 0.55, 1);
  c.position.set(x, y, z0 + 0.003);
  c.castShadow = true;
  g.add(w, c);
}
export function frontGold(g: Group, z0: number, x0: number, x1: number, y0: number, y1: number, rivetStep = 0): void {
  frontSheet(g, z0, rectXY(x0, x1, y0, y1), [gold, goldDark], 0.006);
  if (rivetStep > 0) {
    const horiz = Math.abs(x1 - x0) > Math.abs(y1 - y0);
    const len = horiz ? Math.abs(x1 - x0) : Math.abs(y1 - y0);
    const k = Math.max(2, Math.round(len / rivetStep) + 1);
    for (let i = 0; i < k; i++) {
      const t = (i + 0.5) / k;
      frontRivet(g, z0 + 0.006, horiz ? x0 + (x1 - x0) * t : (x0 + x1) / 2, horiz ? (y0 + y1) / 2 : y0 + (y1 - y0) * t, Math.min(0.011, Math.min(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 0.3));
    }
  }
}
