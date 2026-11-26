import { CylinderGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, ShapeUtils, SphereGeometry, Vector2, Vector3, type BufferGeometry, type Material } from 'three';
import { bev, ngon } from '../craft';
import { paperMaterial } from '../paper';
import { brass, gold, goldDark } from './nose';

/**
 * 挡风玻璃 + 卷帘"眼皮"（2026-11-26 部件实验台第 3 件，照 6-overall.jpg 和 2-shutter.jpg）。
 * 位置和车鼻子在同一个坐标系里（车鼻子正面在 z = 0.05，往后是 -z）。
 * 玻璃：底边高 1.78、在车鼻子正面后约 1.1、半宽 0.645；顶边高 2.35、再往后 0.28、半宽 0.59（往后倾约 27°，上窄下宽）。
 * 位置的来源和可信度（2026-11-26，用户指出我之前"视角不自洽"的说法是错的，引擎盖也画得太长）：
 * - 镜头：车鼻子的 14 个点（在带网格的放大图上用眼睛读的，误差约 ±3–5 像素）+ 轮毂（正八边形）的屏幕比，联合最小二乘
 *   （scripts/lab/fit-joint.py）。旧镜头只用鼻子的点，偏转角（31°）几乎没有约束，所以算出玻璃离鼻子 1.4 米，是错的。
 * - 检验：scripts/lab/draw3d.py 把地面网格、三个坐标轴（带刻度）和鼻子/引擎盖/玻璃的线框投到设计图上；
 *   旧镜头下玻璃框飘在窗框上方，新镜头下三者都落在设计图对应的位置上。
 * - 还没解决的：轮毂八边形拟合的误差仍然偏大（新镜头下约 18 像素），说明偏转角可能比 40° 还大（45–50°），后续用车身侧面的点再校。
 * 组成：
 * - 框：中间一根立柱、两侧 A 柱（米色厚纸板 + 内沿金边 + 小铆钉）、底下一根包金窗台、上面一根包金顶梁（三颗大铆钉，往前探出）；
 *   玻璃插在框的槽里（玻璃边伸进框里一点）。
 * - 卷帘（每片玻璃后面一扇 = 勾勾的一只眼皮，可以分别开合）：两侧金导轨；一片片米色卡纸帘片，两头各一个孔，麻绳从孔里串下来；
 *   底下一根木横杆（两头金帽），中间垂一根拉绳和一颗铜珠（拉绳按重力垂直往下）；顶上一卷纸卷（中间一道灰绿色带，两头金帽、木轴），
 *   藏在顶梁后面，卷上去的帘片越多纸卷越粗。
 * 本地坐标：u 沿车宽（x），w 沿玻璃往上（0 = 玻璃底边，0.64 = 顶边），n 朝外（法线）。
 */

const pb = (pts: Vector2[], depth: number, bevel: number, holes: Vector2[][] = []): BufferGeometry => bev(pts, depth, bevel, holes, 1);
const rect = (x0: number, y0: number, x1: number, y1: number): Vector2[] => [new Vector2(x0, y0), new Vector2(x1, y0), new Vector2(x1, y1), new Vector2(x0, y1)];
function m(geo: BufferGeometry, mats: Material | Material[], z = 0): Mesh {
  const x = new Mesh(geo, mats);
  x.position.z = z;
  x.castShadow = x.receiveShadow = true;
  return x;
}

// 玻璃在世界里的位置（见文件开头）。
const B = new Vector3(0, 1.782, -1.102);
const T = new Vector3(0, 2.347, -1.386);
export const GLASS_H = B.distanceTo(T); // ≈ 0.64
const HW0 = 0.645;
const HW1 = 0.592;
/** 玻璃在高度 w 处的半宽。 */
const hwAt = (w: number): number => HW0 + ((HW1 - HW0) * w) / GLASS_H;

const cream = (c: number): Material[] => [paperMaterial(c, { scale: 0.25 }), paperMaterial(0xf6eee0, { scale: 0.25 })];
const wood = [paperMaterial(0xa0703e, { scale: 0.12 }), paperMaterial(0x8a5e32, { scale: 0.12 })];
const twine = new MeshStandardMaterial({ color: 0xb48a52, roughness: 0.95 });
// 玻璃：暖灰茶色（约 20%），有存在感但看得见后面的帘片（不能是一层奶白把后面的帘片冲淡）。
const glassMat = new MeshStandardMaterial({ color: 0x8a7f70, transparent: true, opacity: 0.22, roughness: 0.08, metalness: 0, depthWrite: false });
const glintMat = new MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, roughness: 0.1, depthWrite: false, emissive: 0xffffff, emissiveIntensity: 0.1 });

/** 本地空间里一块平的四边形卡纸（四个角 c，朝 nrm 那面是正面，厚 t 往背面长）。 */
function plate(c: Vector3[], nrm: Vector3, t: number, mats: Material | Material[]): Mesh {
  const ctr = c.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / c.length);
  const u = c[1]!.clone().sub(c[0]!).normalize();
  const vv = new Vector3().crossVectors(nrm, u).normalize();
  const pts = c.map((p) => new Vector2(p.clone().sub(ctr).dot(u), p.clone().sub(ctr).dot(vv)));
  if (ShapeUtils.isClockWise(pts)) pts.reverse();
  const x = new Mesh(pb(pts, t, Math.min(0.0015, t * 0.3)), mats);
  x.matrixAutoUpdate = false;
  x.matrix.makeBasis(u, vv, nrm).setPosition(ctr.clone().addScaledVector(nrm, -t));
  x.castShadow = x.receiveShadow = true;
  return x;
}

/** 驾驶室侧墙内表面的半宽（A 柱的"肩"、顶梁的折角都接到这里）。 */
export const CAB_HW = 0.8;
/** A 柱的"肩"往后折到的深度（本地 n）。 */
export const SHOULDER_N = -0.12;

/** 扁铆钉（垫圈 + 扁圆帽），在本地平面上，朝 +n。 */
function rivet(g: Group, u: number, w: number, n: number, r = 0.012): void {
  const washer = new Mesh(new CylinderGeometry(r * 1.6, r * 1.6, 0.003, 20), goldDark);
  washer.rotation.x = Math.PI / 2;
  washer.position.set(u, w, n + 0.0015);
  const cap = new Mesh(new SphereGeometry(r, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  cap.rotation.x = Math.PI / 2;
  cap.scale.set(1, 0.55, 1);
  cap.position.set(u, w, n + 0.003);
  washer.castShadow = cap.castShadow = true;
  g.add(washer, cap);
}

/** 沿 u 方向的圆柱（纸卷、横杆、木轴）。 */
function rodU(len: number, r: number, mat: Material, seg = 16): Mesh {
  const c = new Mesh(new CylinderGeometry(r, r, len, seg), mat);
  c.rotation.z = Math.PI / 2;
  c.castShadow = c.receiveShadow = true;
  return c;
}

/** 一扇卷帘：在本地平面里，横向从 u0 到 u1，玻璃后面 n = NS；lid = 放下的比例（0 全卷起、1 全放下）。 */
const NS = -0.04;
const SLAT_H = 0.043;
const PITCH = SLAT_H + 0.003; // 帘片几乎紧贴，只留一道细阴影线（闭眼时整面是实的）
function shutter(u0: number, u1: number, lid: number): Group {
  const g = new Group();
  const top = GLASS_H - 0.02;
  const full = top - 0.03;
  const bottom = top - Math.max(0.06, lid * full); // 底杆的位置
  // 导轨：两侧各一条金色 U 槽（这里简化成一根方条 + 一道深色槽），从窗台到顶梁背后。
  for (const uu of [u0 + 0.006, u1 - 0.006]) {
    const rail = m(pb(rect(uu - 0.006, 0.0, uu + 0.006, top + 0.02), 0.014, 0.0015), [gold, goldDark], NS - 0.016);
    g.add(rail);
  }
  const iu0 = u0 + 0.014;
  const iu1 = u1 - 0.014;
  const wid = iu1 - iu0;
  // 帘片：从底杆往上一片片排到纸卷下面；每片两头各一个孔。
  const holeU = 0.022;
  const hole = (cx: number): Vector2[] => ngon(10, 0.0055).map((p) => new Vector2(p.x + cx, p.y));
  const slatMat = cream(0xf0dcbc);
  const slatAlt = cream(0xc9cdbb); // 每 4 片一片灰绿色
  let k = 0;
  for (let w = bottom + 0.024; w + SLAT_H <= top - 0.02; w += PITCH, k++) {
    const geo = pb(rect(iu0, -SLAT_H / 2, iu1, SLAT_H / 2), 0.003, 0.0006, [hole(iu0 + holeU).reverse(), hole(iu1 - holeU).reverse()]);
    const s = m(geo, k % 4 === 2 ? slatAlt : slatMat);
    s.position.set(0, w + SLAT_H / 2, NS - 0.0015);
    g.add(s);
  }
  // 麻绳：两头各一根，从纸卷一直串到底杆（穿过帘片的孔）。
  for (const uu of [iu0 + holeU, iu1 - holeU]) {
    const len = top - bottom;
    const tw = new Mesh(new CylinderGeometry(0.0022, 0.0022, len, 6), twine);
    tw.position.set(uu, bottom + len / 2, NS);
    g.add(tw);
  }
  // 底杆：一根木条，两头金帽。
  const bar = rodU(wid + 0.004, 0.016, wood[0]!, 12);
  bar.position.set((iu0 + iu1) / 2, bottom, NS);
  g.add(bar);
  for (const uu of [iu0 - 0.004, iu1 + 0.004]) {
    const capm = rodU(0.016, 0.02, gold, 14);
    capm.position.set(uu, bottom, NS);
    g.add(capm);
  }
  // 拉绳 + 铜珠：从底杆中间按重力垂直往下（本地坐标里要把世界的"下"换算过来，见 buildWindshield 的 down）。
  const cord = new Group();
  cord.name = 'cord';
  cord.position.set((iu0 + iu1) / 2 + wid * 0.25, bottom - 0.016, NS);
  const cl = 0.09;
  const cy = new Mesh(new CylinderGeometry(0.0018, 0.0018, cl, 6), twine);
  cy.position.y = -cl / 2;
  const bead = new Mesh(new SphereGeometry(0.016, 12, 8), brass);
  bead.position.y = -cl - 0.013;
  bead.castShadow = cy.castShadow = true;
  cord.add(cy, bead);
  g.add(cord);
  // 纸卷：藏在顶梁后面；卷上去的帘片越多越粗。中间一道灰绿色带，两头金帽，木轴伸出去搭在支架上。
  const rr = 0.022 + 0.026 * (1 - lid);
  const roll = rodU(wid, rr, paperMaterial(0xf0e6d2, { scale: 0.2 }));
  // 顶梁占 n ∈ [-0.06, 0.06]：纸卷整个放在它后面（不穿插）。
  roll.position.set((iu0 + iu1) / 2, top + 0.04, -0.06 - rr - 0.006);
  g.add(roll);
  const band = rodU(wid * 0.22, rr + 0.0012, paperMaterial(0xa9b4a2, { scale: 0.2 }));
  band.position.copy(roll.position);
  g.add(band);
  for (const uu of [iu0, iu1]) {
    const capm = rodU(0.016, rr + 0.004, gold, 18);
    capm.position.set(uu, roll.position.y, roll.position.z);
    const axle = rodU(0.05, 0.006, wood[0]!, 10);
    axle.position.set(uu + (uu === iu0 ? -0.02 : 0.02), roll.position.y, roll.position.z);
    g.add(capm, axle);
  }
  return g;
}

export interface Windshield {
  group: Group;
  /** 设两只眼皮放下的比例（0 全睁开 / 1 全闭上）。 */
  setLids(l: number, r: number): void;
}

export function buildWindshield(lidL = 0.8, lidR = 0.8): Windshield {
  const root = new Group();
  // 本地坐标系：u = x，w = 沿玻璃往上，n = 朝外。
  const v = T.clone().sub(B).normalize();
  const x = new Vector3(1, 0, 0);
  const n = new Vector3().crossVectors(x, v).normalize();
  const g = new Group();
  g.matrixAutoUpdate = false;
  g.matrix.copy(new Matrix4().makeBasis(x, v, n).setPosition(B));
  root.add(g);
  const H = GLASS_H;
  // 玻璃：两片，插进框里（边缘伸进立柱、A 柱、窗台、顶梁的槽里 1 厘米）。
  const mull = 0.015; // 中间立柱半宽（细金条，约 A 柱宽的 40%）
  for (const s of [-1, 1]) {
    const pts = [new Vector2(s * (mull - 0.01), -0.01), new Vector2(s * (hwAt(-0.01) + 0.01), -0.01), new Vector2(s * (hwAt(H + 0.01) + 0.01), H + 0.01), new Vector2(s * (mull - 0.01), H + 0.01)];
    if (s < 0) pts.reverse();
    const glass = new Mesh(pb(pts, 0.004, 0), glassMat);
    glass.position.z = -0.002;
    glass.renderOrder = 2;
    g.add(glass);
    // 一道斜的反光（两片的位置、宽度错开，不像贴纸）。
    for (const [a, wd] of (s < 0 ? [[0.3, 0.045]] : [[0.62, 0.03]]) as Array<[number, number]>) {
      const cx = s * (mull + (hwAt(H / 2) - mull) * a);
      const gl = new Mesh(pb([new Vector2(cx - 0.12, 0.05), new Vector2(cx - 0.12 + wd, 0.05), new Vector2(cx + 0.06 + wd, H - 0.05), new Vector2(cx + 0.06, H - 0.05)], 0.0005, 0), glintMat);
      gl.position.z = 0.0025;
      gl.renderOrder = 3;
      g.add(gl);
    }
  }
  // 中间立柱：一根细金条。
  g.add(m(pb(rect(-mull, -0.02, mull, H + 0.02), 0.045, 0.0015), [gold, goldDark], -0.02));
  // A 柱：顺着玻璃斜边的米色厚纸板（宽 7 厘米），内沿一道金边、三颗小铆钉。
  for (const s of [-1, 1]) {
    const a0 = hwAt(-0.04);
    const a1 = hwAt(H + 0.04);
    const pts = [new Vector2(s * a0, -0.04), new Vector2(s * (a0 + 0.075), -0.04), new Vector2(s * (a1 + 0.075), H + 0.04), new Vector2(s * a1, H + 0.04)];
    if (s < 0) pts.reverse();
    g.add(m(pb(pts, 0.06, 0.0015), cream(0xece0c8), -0.03));
    const ep = [new Vector2(s * (a0 - 0.002), -0.04), new Vector2(s * (a0 + 0.012), -0.04), new Vector2(s * (a1 + 0.012), H + 0.04), new Vector2(s * (a1 - 0.002), H + 0.04)];
    if (s < 0) ep.reverse();
    g.add(m(pb(ep, 0.064, 0.001), [gold, goldDark], -0.03));
    for (const w of [0.12, 0.32, 0.52]) rivet(g, s * (hwAt(w) + 0.045), w, 0.03, 0.012);
    // 肩：A 柱外沿往后斜折出一条（米色卡纸），一直接到驾驶室侧墙（侧墙前沿顺着这条线），中间没有缝。
    const o0 = new Vector3(s * (a0 + 0.075), -0.04, 0.03);
    const o1 = new Vector3(s * (a1 + 0.075), H + 0.04, 0.03);
    const b0 = new Vector3(s * CAB_HW, -0.04, SHOULDER_N);
    const b1 = new Vector3(s * CAB_HW, H + 0.04, SHOULDER_N);
    const sn = new Vector3().crossVectors(b0.clone().sub(o0), o1.clone().sub(o0)).normalize().multiplyScalar(s);
    g.add(plate(s > 0 ? [o0, b0, b1, o1] : [b0, o0, o1, b1], sn.z < 0 ? sn.negate() : sn, 0.012, cream(0xe6d8bf)));
  }
  // 窗台：一根包金的横条（略往外凸），两只小金卡子。
  g.add(m(pb(rect(-hwAt(0) - 0.08, -0.07, hwAt(0) + 0.08, 0.012), 0.065, 0.002), [gold, goldDark], -0.03));
  for (const s of [-1, 1]) {
    g.add(m(pb(rect(s * 0.3 - 0.022, -0.06, s * 0.3 + 0.022, 0.02), 0.012, 0.0015), [gold, goldDark], 0.035));
    rivet(g, s * 0.3, -0.02, 0.047, 0.006);
  }
  // 顶梁：一根厚的包金横梁，压住玻璃顶边、往前探出 6 厘米；正面三颗大铆钉，背面挂卷帘纸卷的支架。
  const bw = hwAt(H) + 0.09;
  const core = [new MeshStandardMaterial({ color: 0xd6a457, metalness: 0.3, roughness: 0.5, emissive: 0x2e1c06 }), goldDark];
  const edgeMat = [new MeshStandardMaterial({ color: 0xb98236, metalness: 0.35, roughness: 0.45, emissive: 0x241406 }), goldDark];
  const bt = H - 0.07; // 往下压住玻璃顶边 7 厘米（窗显得更扁）
  g.add(m(pb(rect(-bw, bt, bw, H + 0.13), 0.12, 0.002), core, -0.06));
  for (const [y0, y1] of [
    [bt - 0.004, bt + 0.024],
    [H + 0.104, H + 0.134],
  ] as const)
    g.add(m(pb(rect(-bw - 0.004, y0, bw + 0.004, y1), 0.126, 0.0015), edgeMat, -0.062));
  for (const u of [-0.48, -0.24, 0, 0.24, 0.48]) {
    const d = new Mesh(new SphereGeometry(0.026, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    d.rotation.x = Math.PI / 2;
    d.position.set(u, (bt + H + 0.13) / 2 + 0.005, 0.06);
    d.castShadow = true;
    g.add(d);
    const ws = new Mesh(new CylinderGeometry(0.036, 0.036, 0.004, 24), goldDark);
    ws.rotation.x = Math.PI / 2;
    ws.position.set(u, (bt + H + 0.13) / 2 + 0.005, 0.062);
    g.add(ws);
  }
  // 两端折角：从顶梁正面的两头往后斜折到侧墙（盖住上面的缝，顶梁也就落在了侧墙上）。
  for (const s of [-1, 1]) {
    const c0 = new Vector3(s * bw, bt, 0.06);
    const c1 = new Vector3(s * bw, H + 0.13, 0.06);
    const d0 = new Vector3(s * CAB_HW, bt, SHOULDER_N);
    const d1 = new Vector3(s * CAB_HW, H + 0.13, SHOULDER_N);
    const sn = new Vector3().crossVectors(d0.clone().sub(c0), c1.clone().sub(c0)).normalize();
    g.add(plate([c0, d0, d1, c1], sn.z < 0 ? sn.negate() : sn, 0.012, core));
  }
  // 后视镜：从 A 柱外沿的"肩"上伸出一根扁金支架（先往外、再折向上，上面一颗铆钉），顶着一块厚卡纸镜板
  // （瘦长的切角六边形，厚约宽的 1/5，暖橙棕色，边缘更深）。支架根部固定在肩上，不穿过侧墙。
  const mirrorMat = [paperMaterial(0xd49a56, { scale: 0.2 }), paperMaterial(0xa87038, { scale: 0.2 })];
  for (const s of [-1, 1]) {
    const baseU = s * (hwAt(0.3) + 0.075);
    const foot = m(pb(rect(-0.03, -0.04, 0.03, 0.04), 0.01, 0.0015), [gold, goldDark]);
    foot.rotation.y = (s * Math.PI) / 2;
    foot.position.set(baseU + s * 0.004, 0.3, 0.03);
    g.add(foot);
    // 横臂：一条扁金条，从脚座往外 0.16；竖臂：折向上 0.1，再托住镜板下沿。
    const arm1 = m(pb(rect(0, -0.018, 0.17, 0.018), 0.012, 0.0015), [gold, goldDark]);
    arm1.position.set(baseU * 1 + (s > 0 ? 0 : -0.17), 0.3, 0.024);
    const arm2 = m(pb(rect(-0.018, 0, 0.018, 0.13), 0.012, 0.0015), [gold, goldDark]);
    arm2.position.set(baseU + s * 0.17 - s * 0.0, 0.3, 0.024);
    g.add(arm1, arm2);
    rivet(g, baseU + s * 0.17, 0.33, 0.036, 0.007);
    const hex = [new Vector2(-0.075, -0.15), new Vector2(0.075, -0.15), new Vector2(0.095, -0.05), new Vector2(0.082, 0.16), new Vector2(-0.082, 0.16), new Vector2(-0.095, -0.05)];
    const mirror = m(pb(hex, 0.045, 0.002), mirrorMat);
    mirror.position.set(baseU + s * 0.17, 0.6, 0.0);
    mirror.rotation.y = s * 0.45;
    g.add(mirror);
  }
  // 卷帘：每片玻璃后面一扇。
  const shutters = new Group();
  g.add(shutters);
  const panes: Array<[number, number]> = [
    [-hwAt(H) + 0.004, -mull - 0.004],
    [mull + 0.004, hwAt(H) - 0.004],
  ];
  // 世界的"下"在本地坐标里的方向（拉绳按重力垂下）。
  const down = new Vector3(0, -1, 0).applyMatrix4(new Matrix4().makeBasis(x, v, n).invert());
  const setLids = (l: number, r: number): void => {
    shutters.clear();
    [l, r].forEach((lid, i) => {
      const [u0, u1] = panes[i]!;
      const s = shutter(u0, u1, lid);
      const cord = s.getObjectByName('cord');
      if (cord) cord.quaternion.setFromUnitVectors(new Vector3(0, -1, 0), down);
      shutters.add(s);
    });
  };
  setLids(lidL, lidR);
  return { group: root, setLids };
}
