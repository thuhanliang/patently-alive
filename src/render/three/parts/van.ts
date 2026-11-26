import { CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, RepeatWrapping, SphereGeometry, SRGBColorSpace, Vector2, Vector3 } from 'three';
import { rng } from '../craft';
import { paperMaterial } from '../paper';
import { block, bolt, convex, goldMats, mesh, pb, plain, plate, pole, polyPlate, rect, sheet, shade, strip, tileFace, woodMats } from './common';
import { brass, buildNose, gold, goldDark } from './nose';
import { buildWheel } from './wheel';
import { buildWindshield } from './windshield';

/**
 * 整车（2026-11-26）：按平行投影（偏转 49°、俯视 12°）在设计图上量出来的大块尺寸搭起来。
 * 世界坐标：x 车宽（+x 是看得见的、有遮阳篷的那一侧）、y 向上、z 向车头；车头正面在 z = 0.05。
 * 分块：鼻子（nose.ts）→ 引擎盖楔形 → 驾驶室（挡风玻璃在 windshield.ts）→ 驾驶室顶（四面斜的实心体）+ 车顶栏杆 →
 *       货箱（舱内、桌板、后门、车顶、烟囱）→ 遮阳篷 + 支杆 → 凳子、坡道 → 车轮。
 * 做法：大块是实心的厚纸板体，表面一块块贴有厚度的卡纸（体块比贴面缩进 1.2 厘米，不共面），接缝压金卡纸条加螺栓。
 */

const F = 0.05;
export const XN = 0.78; // 鼻子 / 引擎盖半宽
export const XC = 0.8; // 驾驶室半宽
export const XG = 0.9; // 货箱半宽
export const Y0 = 0.52; // 车身下沿
export const Z_CAB = -2.7; // 驾驶室 / 货箱分界（设计图上货箱前上角在 z = -2.71，用平行投影反投量的）
export const Z_END = -5.57; // 货箱后端（后上角、后下角都反投到 -5.55 ~ -5.58；曾经目测改成 -6.05，错）
export const Y_ROOF = 2.5;
/** 车顶近侧边的高度：设计图上量到 2.66（前）→ 2.59 → 2.52 → 2.50（后），一整条连贯的顶，从驾驶室顶平顺地向后微微倾斜。 */
const Y_RF = 2.66;
const yAt = (z: number): number => Y_RF + (Y_ROOF - Y_RF) * ((Z_CAB - z) / (Z_CAB - Z_END));
export const Y_FLOOR = 1.0;
const IN = 0.012; // 体块相对贴面的缩进

const TONES = [0xe9d3ab, 0xdcb988, 0xd2a96f, 0xf1e2c8, 0xc9cdb8, 0xb9c2ae, 0xe4cfa6, 0xdfc79c];
const TONES_GREEN = [0xb9c2ae, 0xc9cdb8, 0xaebbaa, 0xe4cfa6, 0xdcb988];

const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
const X = V(1, 0, 0);
const Y = V(0, 1, 0);
const Z = V(0, 0, 1);

function mass(g: Group, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col = 0xcdbba0): void {
  g.add(convex([[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]], plain(col)));
}

/** 车的一个侧面（朝 +x 或 -x）：矩形贴面。z0 > z1（z0 靠车头）。 */
function sideFace(g: Group, s: number, x: number, y0: number, y1: number, z0: number, z1: number, seed: number, skip: Array<[number, number, number, number]> = [], tones = TONES): void {
  // 面内坐标：a 沿车头→车尾（-z），b 向上。+x 面朝外 n = u × v 要 = +x：u = -z, v = +y → (-z)×(y) = -(z×y) = +x ✓。-x 面用 u = +z。
  const u = s > 0 ? V(0, 0, -1) : V(0, 0, 1);
  const o = s > 0 ? V(x, y0, z0) : V(x, y0, z1);
  tileFace(g, o, u, Y, Math.abs(z0 - z1), y1 - y0, { seed, tones, cw: 0.34, ch: 0.28, skip });
}
function topFace(g: Group, y: number, x0: number, x1: number, z0: number, z1: number, seed: number, skip: Array<[number, number, number, number]> = []): void {
  // 朝上：n = +y：u = +x, v = -z → x × (-z) = -(x×z) = +y ✓
  tileFace(g, V(x0, y, z0), X, V(0, 0, -1), x1 - x0, z0 - z1, { seed, tones: TONES, cw: 0.36, ch: 0.3, skip });
}

/** 一个八角（局部 u,v 平面里的轮廓，逆时针）。 */
function octPts(hw: number, hh: number): Vector2[] {
  const cx = hw * 0.414;
  const cy = hh * 0.414;
  return [new Vector2(-hw + cx, -hh), new Vector2(hw - cx, -hh), new Vector2(hw, -hh + cy), new Vector2(hw, hh - cy), new Vector2(hw - cx, hh), new Vector2(-hw + cx, hh), new Vector2(-hw, hh - cy), new Vector2(-hw, -hh + cy)];
}

// ───────────────────────── 车头：引擎盖楔形 + 鼻子侧面 ─────────────────────────
function addHood(g: Group): void {
  const zb = -1.1;
  const yTop0 = 1.44;
  const yTop1 = 1.79;
  const x = XN - IN;
  // 实心楔形
  g.add(convex([[-x, Y0, F - IN], [x, Y0, F - IN], [-x, yTop0 - IN, F - IN], [x, yTop0 - IN, F - IN], [-x, Y0, zb], [x, Y0, zb], [-x, yTop1 - IN, zb], [x, yTop1 - IN, zb]], plain(0xcdbba0)));
  // 侧面：矩形部分（到前沿高度）+ 斜面以上的三角
  for (const s of [-1, 1]) {
    sideFace(g, s, s * XN, Y0, yTop0, F, zb, 11 + s);
    const o = s > 0 ? V(s * XN, yTop0, F) : V(s * XN, yTop0, zb);
    const u = s > 0 ? V(0, 0, -1) : V(0, 0, 1);
    const L = F - zb;
    const tri = s > 0 ? [new Vector2(0, 0), new Vector2(L, 0), new Vector2(L, yTop1 - yTop0)] : [new Vector2(0, 0), new Vector2(L, 0), new Vector2(0, yTop1 - yTop0)];
    g.add(polyPlate(tri, o, u, Y, 0.016, sheet(0xe8dcc6)));
    // 斜面的金边（顺着斜线）
    const a = V(s * XN, yTop0, F);
    const b = V(s * XN, yTop1, zb);
    strip(g, a, b, 0.03, 0.01, V(s, 0, 0), true);
  }
  // 顶面：沿斜面贴（斜面的法线）
  const a = V(0, yTop0, F);
  const b = V(0, yTop1, zb);
  const dir = b.clone().sub(a);
  const L = dir.length();
  const u = X;
  const v = dir.clone().normalize(); // 沿斜面往上走（朝后）
  const n = new Vector3().crossVectors(u, v).normalize(); // 朝上
  tileFace(g, V(-XN, yTop0, F), u, v, XN * 2, L, { seed: 21, tones: TONES, cw: 0.34, ch: 0.28, lift: 0.003 });
  void n;
  // 引擎盖中间凸起的一块（厚 3 厘米，四周斜面——实心体），盖在斜面上
  const mid = 0.28;
  const t = 0.08;
  const p0 = a.clone().addScaledVector(v, 0.25);
  const p1 = a.clone().addScaledVector(v, L - 0.12);
  g.add(convex([[-mid, p0.y, p0.z], [mid, p0.y, p0.z], [-mid + 0.04, p0.y + t, p0.z - 0.06], [mid - 0.04, p0.y + t, p0.z - 0.06], [-mid, p1.y, p1.z], [mid, p1.y, p1.z], [-mid + 0.04, p1.y + t, p1.z + 0.06], [mid - 0.04, p1.y + t, p1.z + 0.06]], plain(0xf0e3cc)));
  // 引擎盖两侧、顶面两边各一条金压条
  for (const s of [-1, 1]) strip(g, V(s * (XN - 0.04), yTop0 + 0.012, F - 0.03), V(s * (XN - 0.04), yTop1 + 0.012, zb), 0.035, 0.008, V(0, 1, -0.0).normalize().add(V(0, 0, 0)), false);
}

// ───────────────────────── 驾驶室 ─────────────────────────
function addCab(g: Group): void {
  const zf = -1.1;
  const yb = Y0;
  const yTop = 2.42; // 侧墙顶（檐口）
  // 实心：前轮拱以上（整段），拱以下只有前后两小段
  const x = XC - IN;
  mass(g, -x, x, 0.98, 1.78, zf, Z_CAB);
  // 上半：前面顺着玻璃的斜面往后收（玻璃底边 z = -1.10、高 1.78；顶边 z = -1.39、高 2.35），比玻璃缩进 3 厘米
  g.add(convex([[-x, 1.78, -1.13], [x, 1.78, -1.13], [-x, yTop, -1.45], [x, yTop, -1.45], [-x, 1.78, Z_CAB], [x, 1.78, Z_CAB], [-x, yTop, Z_CAB], [x, yTop, Z_CAB]], plain(0xcdbba0)));
  mass(g, -x, x, yb, 0.98, zf, -1.2); // 拱前
  // 舷窗（正八边形的大窗，带卷帘）、旗帜、前轮拱——在 x = XC 的侧面
  const winC = new Vector2(-1.84, 2.1); // (z, y)
  const winHW = 0.4;
  const winHH = 0.34;
  for (const s of [-1, 1]) {
    const skip: Array<[number, number, number, number]> = [[-(winC.x - winHW - 0.05) - 0, 0, 0, 0]];
    void skip;
    // 面内 a = z0 - z（沿车头→车尾），b = y - yb
    const z0 = zf;
    const aw0 = z0 - (winC.x + winHW + 0.07);
    const aw1 = z0 - (winC.x - winHW - 0.07);
    const bw0 = winC.y - winHH - 0.07 - yb;
    const bw1 = winC.y + winHH + 0.07 - yb;
    const wheelSkip: [number, number, number, number] = [z0 - -1.2, 0, z0 - Z_CAB + 0.15, 0.98 - yb];
    sideFace(g, s, s * XC, yb, yTop, zf, Z_CAB, 31 + s, [[aw0, bw0, aw1, bw1], wheelSkip], TONES_GREEN);
  }
  // 舷窗：金色八角框（斜面框一整圈）+ 里面的卷帘（米色帘片）+ 玻璃
  const s = 1;
  const o = V(s * XC, winC.y, winC.x);
  const u = V(0, 0, -1);
  const w = (hw: number, hh: number, t: number, mats: ReturnType<typeof sheet>, dz = 0): Mesh => polyPlate(octPts(hw, hh), o.clone().addScaledVector(X, dz), u, Y, t, mats);
  // 外框：金（宽 0.05）
  const frame = pb(octPts(winHW + 0.06, winHH + 0.06), 0.03, 0.006, [octPts(winHW, winHH).reverse()]);
  const fm = mesh(frame, goldMats);
  fm.matrixAutoUpdate = false;
  fm.matrix.makeBasis(u, Y, X.clone().multiplyScalar(s)).setPosition(o.clone().addScaledVector(X, 0.0));
  g.add(fm);
  // 窗洞里：深色背板 + 卷帘（五片帘片放下一半）
  g.add(w(winHW, winHH, 0.02, sheet(0x3a2a1c), -0.02));
  const slatH = 0.085;
  for (let i = 0; i < 5; i++) {
    const yy = winHH - 0.03 - i * (slatH + 0.012);
    const half = Math.min(winHW, (winHH - Math.abs(yy)) * 0 + winHW - Math.max(0, Math.abs(yy) - (winHH - winHW * 0.414)) * 2.2);
    g.add(polyPlate(rect(-half + 0.01, -slatH / 2, half - 0.01, slatH / 2).map((p) => p.clone()), o.clone().addScaledVector(Y, yy).addScaledVector(X, -0.004), u, Y, 0.012, sheet(i % 2 ? 0xe8d6b2 : 0xf0e0c0)));
  }
  // 窗框外的小金卡扣（四个，钉在面板上）
  for (const [dz, dy] of [
    [winHW + 0.1, 0],
    [-winHW - 0.1, 0],
    [0, winHH + 0.1],
    [0, -winHH - 0.1],
  ] as const)
    bolt(g, o.clone().addScaledVector(u, -dz).addScaledVector(Y, dy).add(V(0.004, 0, 0)), X, 0.014);
  // 旗帜：吊在驾驶室侧面一根细金线上的五面米色小旗（每面上有一只狗的剪影）
  const flagY = 1.5;
  const zs = [-1.4, -1.65, -1.9, -2.15, -2.4];
  strip(g, V(XC + 0.004, flagY + 0.04, -1.3), V(XC + 0.004, flagY + 0.04, -2.45), 0.012, 0.006, X, false);
  zs.forEach((z, i) => {
    const pts = [new Vector2(-0.08, 0), new Vector2(0.08, 0), new Vector2(0.08, -0.12), new Vector2(0, -0.2), new Vector2(-0.08, -0.12)];
    const fp = polyPlate(pts, V(XC + 0.006, flagY, z), V(0, 0, -1), Y, 0.008, sheet(0xf2e6d0));
    g.add(fp);
    bolt(g, V(XC + 0.007, flagY + 0.02, z), X, 0.006);
    void i;
  });
  // 前轮拱：金边的圆弧（八角拱）+ 米色边条，围着车轮
  archTrim(g, XC + 0.002, -1.88, 0.45);
  archTrim(g, XG + 0.004, -4.65, 0.45);
  // 驾驶室后墙（舱内看见的那面，朝 +z）和货箱接缝处的金压条（竖的）
  strip(g, V(XC + 0.006, yb + 0.1, Z_CAB), V(XC + 0.006, yTop, Z_CAB), 0.045, 0.01, X, true);
}

/** 轮拱：围着轮子的八角形金边 + 米色边（只画上半圈）。 */
function archTrim(g: Group, x: number, zc: number, yc: number, R = 0.56): void {
  const pts: Vector3[] = [];
  for (let k = 0; k <= 4; k++) {
    const a = (Math.PI / 4) * k - 0; // 0..π 的上半圈，八角
    pts.push(V(x, yc + Math.sin(a) * R, zc + Math.cos(a) * R));
  }
  for (let i = 0; i < pts.length - 1; i++) strip(g, pts[i]!, pts[i + 1]!, 0.05, 0.012, X, false, [paperMaterial(0xeadfc4, { scale: 0.2 }), paperMaterial(0xcdbb98, { scale: 0.2 })]);
  for (let i = 0; i < pts.length - 1; i++) strip(g, pts[i]!.clone().add(V(0.004, 0.0, 0)), pts[i + 1]!.clone().add(V(0.004, 0, 0)), 0.014, 0.006, X, false);
  void gold;
}

// ───────────────────────── 驾驶室顶 + 车顶栏杆 ─────────────────────────
function addCabRoof(g: Group): void {
  const yE = 2.44; // 檐口
  const yT = 2.68; // 平顶
  const zF = -1.43; // 前檐（顶梁后面）
  const zF2 = -1.9; // 前坡顶
  const zB = Z_CAB;
  const xe = XC + 0.04;
  const xt = 0.6;
  // 实心四面坡：下面一个矩形（檐口），上面一个小矩形（平顶）
  g.add(convex([[-xe, yE, zF], [xe, yE, zF], [-xe, yE, zB], [xe, yE, zB], [-xt, yT, zF2], [xt, yT, zF2], [-xt, yT, zB], [xt, yT, zB]], plain(0xcdbba0)));
  // 前坡、侧坡的贴面：沿各斜面贴卡纸（n 朝外）
  const slopeTile = (a0: Vector3, a1: Vector3, b0: Vector3, seed: number): void => {
    const u = a1.clone().sub(a0);
    const w = u.length();
    u.normalize();
    const v = b0.clone().sub(a0);
    const h = v.length();
    v.normalize();
    tileFace(g, a0, u, v, w, h, { seed, tones: TONES, cw: 0.3, ch: 0.22, th: 0.014 });
  };
  // 前坡（朝前上）：从前檐 (x 从 -xe→xe, y yE, z zF) 往上到 (±xt, yT, zF2)；u = +x，v 指向斜上后方，n = u × v 要朝前上
  slopeTile(V(-xe, yE + 0.012, zF - 0.006), V(xe, yE + 0.012, zF - 0.006), V(-xe, yT + 0.012, zF2 - 0.006), 41);
  // 右侧坡（朝 +x 上）：沿 z 方向 u = -z（车头→车尾）、v 指向上内；n = u × v 朝外 → (-z)×(-x..up)…
  {
    const a0 = V(xe, yE, zF);
    const a1 = V(xe, yE, zB);
    const b0 = V(xt, yT, zF2);
    const u = a1.clone().sub(a0).normalize();
    const v = b0.clone().sub(a0).normalize();
    // 梯形：前缘在 b 方向较短；用矩形近似，宽取后缘长度，贴不到的角留给压条盖住
    tileFace(g, a0, u, v, Math.abs(zB - zF) - 0.16, b0.clone().sub(a0).length(), { seed: 42, tones: TONES, cw: 0.3, ch: 0.22, th: 0.014 });
  }
  // 平顶：贴面 + 四周金边
  tileFace(g, V(-xt, yT + 0.006, zF2), X, V(0, 0, -1), xt * 2, zF2 - zB, { seed: 43, tones: TONES, cw: 0.34, ch: 0.28 });
  // 檐口金压条一圈（前、右、左），斜坡的棱上也压金条
  strip(g, V(-xe, yE + 0.02, zF + 0.005), V(xe, yE + 0.02, zF + 0.005), 0.05, 0.012, V(0, 0, 1), true);
  for (const s of [-1, 1]) {
    strip(g, V(s * xe, yE + 0.02, zF), V(s * xe, yE + 0.02, zB), 0.05, 0.012, V(s, 0, 0), false);
    strip(g, V(s * xe, yE, zF), V(s * xt, yT, zF2), 0.04, 0.01, V(s * 0.7, 0.7, 0), false);
  }
  // 车顶栏杆：四根角柱 + 上下两根横杆 + X 形交叉的细杆（沿 +x 一侧和前、后各一段），所有杆端插在套环里、套环贴在顶面上
  const ry = yT + 0.012;
  const hRail = 0.22;
  const px = [-0.52, 0.52];
  const pz = [zF2 - 0.08, zB + 0.12];
  for (const x of px)
    for (const z of pz) {
      g.add(plate([V(x - 0.045, ry + 0.014, z - 0.045), V(x + 0.045, ry + 0.014, z - 0.045), V(x + 0.045, ry + 0.014, z + 0.045), V(x - 0.045, ry + 0.014, z + 0.045)], Y, 0.016, goldMats)); // 每根立柱下一块方座，粘在顶板上
      pole(g, V(x, ry + 0.014, z), V(x, ry + hRail + 0.04, z), 0.012, new MeshStandardMaterial({ color: 0xd9a050, metalness: 0.3, roughness: 0.45 }));
      const cap = new Mesh(new CylinderGeometry(0.02, 0.02, 0.025, 8), gold);
      cap.position.set(x, ry + hRail + 0.055, z);
      g.add(cap);
    }
  const railMat = new MeshStandardMaterial({ color: 0xd9a050, metalness: 0.3, roughness: 0.45 });
  const rail = (a: Vector3, b: Vector3, r = 0.008): void => pole(g, a, b, r, railMat, false);
  for (const x of px) {
    rail(V(x, ry + 0.04, pz[0]!), V(x, ry + 0.04, pz[1]!));
    rail(V(x, ry + hRail, pz[0]!), V(x, ry + hRail, pz[1]!));
    const n = 9;
    for (let i = 0; i < n; i++) {
      const z0 = pz[0]! + ((pz[1]! - pz[0]!) * i) / n;
      const z1 = pz[0]! + ((pz[1]! - pz[0]!) * (i + 1)) / n;
      rail(V(x, ry + 0.04, z0), V(x, ry + hRail, z1), 0.006);
      rail(V(x, ry + hRail, z0), V(x, ry + 0.04, z1), 0.006);
    }
  }
  for (const z of pz) {
    rail(V(px[0]!, ry + 0.04, z), V(px[1]!, ry + 0.04, z));
    rail(V(px[0]!, ry + hRail, z), V(px[1]!, ry + hRail, z));
  }
}

// ───────────────────────── 货箱 ─────────────────────────
function addCargo(g: Group): void {
  const x = XG - IN;
  const yR = Y_ROOF;
  const zF = Z_CAB;
  const zB = Z_END;
  // 地板、下部（桌板以下）
  mass(g, -x, x, 0.6, Y_FLOOR, zF, -4.1);
  mass(g, -x, x, 0.6, Y_FLOOR, -5.2, zB);
  mass(g, -x, x, 0.96, Y_FLOOR, -4.1, -5.2);
  // 车顶：一整块实心斜板（前高后低，和驾驶室顶连成一条），贴面沿斜面铺；中间一块凸起（四面斜的实心体）；四周金边；烟囱立在凸起上
  const xr = XG + 0.02;
  const t = 0.07;
  g.add(convex([[-xr, yAt(zF), zF], [xr, yAt(zF), zF], [-xr, yAt(zF) - t, zF], [xr, yAt(zF) - t, zF], [-xr, yAt(zB), zB], [xr, yAt(zB), zB], [-xr, yAt(zB) - t, zB], [xr, yAt(zB) - t, zB]], plain(0xcdbba0)));
  const slope = V(0, yAt(zB) - yAt(zF), zB - zF).normalize(); // 沿斜面向后
  tileFace(g, V(-xr, yAt(zF) + 0.004, zF), X, slope, xr * 2, Math.hypot(zF - zB, yAt(zB) - yAt(zF)), { seed: 51, tones: TONES, cw: 0.36, ch: 0.3, lift: 0.003 });
  // 坡顶：整个货箱顶是一个浅的人字形（实心体）——两侧檐口在 yAt(z)，中脊高出 0.36（设计图上中段比近侧檐口高约 0.3~0.37 米）
  const rh = 0.36;
  const rw = 0.2; // 脊顶半宽
  g.add(convex([[-xr, yAt(zF) - 0.01, zF], [xr, yAt(zF) - 0.01, zF], [-rw, yAt(zF) + rh, zF], [rw, yAt(zF) + rh, zF], [-xr, yAt(zB) - 0.01, zB], [xr, yAt(zB) - 0.01, zB], [-rw, yAt(zB) + rh, zB], [rw, yAt(zB) + rh, zB]], plain(0xcdbba0)));
  // 近侧坡面的贴面：u 沿车尾方向，v 沿坡面往上往里（朝中脊），n 朝外上
  {
    const uu = V(0, yAt(zB) - yAt(zF), zB - zF).normalize();
    const vv = V(-(xr - rw), rh + 0.01, 0).normalize();
    tileFace(g, V(xr + 0.004, yAt(zF), zF), uu, vv, Math.hypot(zF - zB, yAt(zB) - yAt(zF)), Math.hypot(xr - rw, rh), { seed: 52, tones: TONES, cw: 0.36, ch: 0.26, lift: 0.003 });
    // 前山墙（脊的前面那块三角，朝 +z）：一块整板
    g.add(polyPlate([new Vector2(-xr, 0), new Vector2(xr, 0), new Vector2(rw, rh), new Vector2(-rw, rh)], V(0, yAt(zF) - 0.01, zF + 0.002), X, Y, 0.02, block(0xdcc79c)));
    // 脊顶金条 + 两侧坡的檐口金条
    strip(g, V(rw, yAt(zF) + rh + 0.01, zF), V(rw, yAt(zB) + rh + 0.01, zB), 0.06, 0.012, V(0, 1, 0), true);
    strip(g, V(xr - 0.02, yAt(zF) + 0.014, zF), V(xr - 0.02, yAt(zB) + 0.014, zB), 0.07, 0.012, V(0.7, 0.7, 0), false);
  }
  // 屋顶两侧、后沿金边
  for (const sgn of [-1, 1]) strip(g, V(sgn * XG, yAt(zF) + 0.012, zF), V(sgn * XG, yAt(zB) + 0.012, zB), 0.05, 0.014, V(sgn, 0, 0), true);
  strip(g, V(-XG, yAt(zB) + 0.012, zB), V(XG, yAt(zB) + 0.012, zB), 0.05, 0.014, V(0, 0, -1), true);
  // 烟囱：底座法兰 + 方筒 + 帽 + 天线，立在凸起的顶面上
  const cz = -4.55;
  const cb = yAt(cz) + rh - 0.01;
  g.add(convex([[-0.17, cb, cz + 0.17], [0.17, cb, cz + 0.17], [-0.17, cb + 0.03, cz + 0.17], [0.17, cb + 0.03, cz + 0.17], [-0.17, cb, cz - 0.17], [0.17, cb, cz - 0.17], [-0.17, cb + 0.03, cz - 0.17], [0.17, cb + 0.03, cz - 0.17]], new MeshStandardMaterial({ color: 0xd9a050, metalness: 0.3, roughness: 0.45 })));
  g.add(convex([[-0.12, cb + 0.03, cz + 0.12], [0.12, cb + 0.03, cz + 0.12], [-0.12, cb + 0.4, cz + 0.12], [0.12, cb + 0.4, cz + 0.12], [-0.12, cb + 0.03, cz - 0.12], [0.12, cb + 0.03, cz - 0.12], [-0.12, cb + 0.4, cz - 0.12], [0.12, cb + 0.4, cz - 0.12]], plain(0xb8aa95)));
  g.add(convex([[-0.16, cb + 0.4, cz + 0.16], [0.16, cb + 0.4, cz + 0.16], [-0.14, cb + 0.46, cz + 0.14], [0.14, cb + 0.46, cz + 0.14], [-0.16, cb + 0.4, cz - 0.16], [0.16, cb + 0.4, cz - 0.16], [-0.14, cb + 0.46, cz - 0.14], [0.14, cb + 0.46, cz - 0.14]], new MeshStandardMaterial({ color: 0xd9a050, metalness: 0.3, roughness: 0.45 })));
  pole(g, V(0.06, cb + 0.46, cz), V(0.06, cb + 0.62, cz), 0.006, brass, false);

  // 舱内：地板、远墙（x = -XG 内面）、前墙（驾驶室后墙内面）、顶（内面，暗）
  const inner = 0.012;
  g.add(plate([V(-XG + inner, Y_FLOOR, zF), V(XG, Y_FLOOR, zF), V(XG, Y_FLOOR, zB), V(-XG + inner, Y_FLOOR, zB)], Y, 0.02, woodMats(0xb98d58))); // 地板（木）
  // 远墙内面（朝 +x）
  tileFace(g, V(-XG + inner, Y_FLOOR, zF), V(0, 0, -1), Y, zF - zB, yR - Y_FLOOR - 0.06, { seed: 61, tones: [0xcfc2a8, 0xd8c8aa, 0xc8bba2, 0xd9dccb], cw: 0.4, ch: 0.3 });
  // 前墙内面（朝 -z）：u = -x 方向（从 +x 往 -x）, v = +y, n = u × v = (-x)×y = -z ✓
  tileFace(g, V(XG - inner, Y_FLOOR, zF - 0.004), V(-1, 0, 0), Y, XG * 2 - inner, yR - Y_FLOOR - 0.06, { seed: 62, tones: [0xc8bba2, 0xd8c8aa, 0xcfc2a8], cw: 0.4, ch: 0.3 });
  // 舱顶内面：暗色
  g.add(plate([V(-XG + inner, yAt(zF) - 0.07, zF), V(XG, yAt(zF) - 0.07, zF), V(XG, yAt(zB) - 0.07, zB), V(-XG + inner, yAt(zB) - 0.07, zB)], V(0, -1, 0), 0.012, block(0x8a7a64)));
  // 后墙内面（朝 +z）
  tileFace(g, V(XG, Y_FLOOR, zB + 0.006), V(-1, 0, 0), Y, XG * 2, yR - Y_FLOOR - 0.06, { seed: 63, tones: [0xc8bba2, 0xd8c8aa], cw: 0.4, ch: 0.3 });
  // 舱内：抽屉柜（靠驾驶室后墙、贴着远墙）、两层搁架（上面摆罐子）、后端一条窗帘
  const cab = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: number): void => {
    g.add(convex([[x0, y0, z0], [x1, y0, z0], [x0, y1, z0], [x1, y1, z0], [x0, y0, z1], [x1, y0, z1], [x0, y1, z1], [x1, y1, z1]], plain(col)));
  };
  cab(-XG + 0.02, -0.3, Y_FLOOR + 0.02, 1.62, zF - 0.02, zF - 0.95, 0xc9ad7c);
  for (let i = 0; i < 3; i++) {
    const y0 = Y_FLOOR + 0.08 + i * 0.17;
    g.add(plate([V(-0.3 + 0.004, y0, zF - 0.1), V(-0.3 + 0.004, y0, zF - 0.88), V(-0.3 + 0.004, y0 + 0.14, zF - 0.88), V(-0.3 + 0.004, y0 + 0.14, zF - 0.1)], X, 0.012, sheet(0xe8d7b4)));
    pole(g, V(-0.3 + 0.012, y0 + 0.07, zF - 0.44), V(-0.3 + 0.012, y0 + 0.07, zF - 0.54), 0.006, brass, true);
  }
  for (const y of [1.78, 2.08]) {
    g.add(plate([V(XG - 0.02, y, zF - 0.01), V(-0.2, y, zF - 0.01), V(-0.2, y, zF - 0.3), V(XG - 0.02, y, zF - 0.3)], Y, 0.025, woodMats(0xa0703e)));
    for (let k = 0; k < 6; k++) {
      const jx = XG - 0.1 - k * 0.17;
      g.add(convex([[jx - 0.04, y, zF - 0.06], [jx + 0.04, y, zF - 0.06], [jx - 0.04, y + 0.1 + (k % 3) * 0.04, zF - 0.06], [jx + 0.04, y + 0.1 + (k % 3) * 0.04, zF - 0.06], [jx - 0.04, y, zF - 0.14], [jx + 0.04, y, zF - 0.14], [jx - 0.04, y + 0.1 + (k % 3) * 0.04, zF - 0.14], [jx + 0.04, y + 0.1 + (k % 3) * 0.04, zF - 0.14]], plain([0xd8d2c4, 0x9eb08a, 0xcfa56e][k % 3]!)));
    }
  }
  g.add(plate([V(XG - 0.06, 1.15, zB + 0.04), V(XG - 0.06, 1.15, zB + 0.5), V(XG - 0.06, yR - 0.15, zB + 0.5), V(XG - 0.06, yR - 0.15, zB + 0.04)], X, 0.01, block(0xcfc2a8))); // 后端的窗帘
  void sheet;
  void shade;
  void rng;
  void RepeatWrapping;
  void CanvasTexture;
  void SRGBColorSpace;
  void goldDark;
}

// ───────────────────────── 货箱的服务侧：下墙、立柱、桌板、遮阳篷、支杆、凳子、坡道、后门 ─────────────────────────
function dogShape(): Vector2[] {
  // 一只站着的狗的剪影（轮廓，局部 u 向右、v 向上，约 0.3 × 0.22）
  const p: Array<[number, number]> = [[-0.15, 0.0], [-0.15, 0.1], [-0.13, 0.15], [-0.08, 0.17], [-0.06, 0.22], [-0.03, 0.2], [0.0, 0.22], [0.03, 0.17], [0.1, 0.16], [0.15, 0.19], [0.17, 0.14], [0.12, 0.1], [0.1, 0.0], [0.06, 0.0], [0.05, 0.07], [-0.02, 0.07], [-0.04, 0.0], [-0.08, 0.0], [-0.09, 0.07], [-0.12, 0.0]];
  return p.map(([a, b]) => new Vector2(a, b));
}

function addService(g: Group): void {
  const yR = Y_ROOF;
  const zF = Z_CAB;
  const zB = Z_END;
  const xo = XG; // 外侧面
  // 下墙（桌板以下）：外面贴面，后轮处开口
  sideFace(g, 1, xo, 0.6, Y_FLOOR, zF, -4.1, 71, [], TONES);
  sideFace(g, 1, xo, 0.6, Y_FLOOR, -5.2, zB, 72, [], TONES);
  sideFace(g, -1, -xo, 0.6, yAt(zB) - 0.07, zF, zB, 73, [], TONES_GREEN); // 对面整面墙
  // 立柱：前（驾驶室后墙旁）、后；顶梁（挂遮阳篷）——米色厚纸板 + 金边 + 螺栓
  const post = (z: number): void => {
    g.add(plate([V(xo + 0.02, Y_FLOOR, z), V(xo + 0.02, Y_FLOOR, z - 0.14), V(xo + 0.02, yAt(z - 0.14), z - 0.14), V(xo + 0.02, yAt(z), z)], X, 0.05, block(0xdfcaa0)));
    strip(g, V(xo + 0.025, Y_FLOOR + 0.05, z - 0.03), V(xo + 0.025, yAt(z - 0.03) - 0.08, z - 0.03), 0.02, 0.008, X, false);
    strip(g, V(xo + 0.025, Y_FLOOR + 0.05, z - 0.11), V(xo + 0.025, yAt(z - 0.11) - 0.08, z - 0.11), 0.02, 0.008, X, false);
    for (const y of [Y_FLOOR + 0.12, yAt(z - 0.07) - 0.15]) bolt(g, V(xo + 0.03, y, z - 0.07), X, 0.014);
  };
  post(zF);
  post(zB + 0.14);
  g.add(plate([V(xo + 0.02, yAt(zF) - 0.22, zF), V(xo + 0.02, yAt(zB) - 0.22, zB), V(xo + 0.02, yAt(zB), zB), V(xo + 0.02, yAt(zF), zF)], X, 0.05, block(0xdfcaa0)));
  strip(g, V(xo + 0.026, yAt(zF) - 0.2, zF - 0.05), V(xo + 0.026, yAt(zB) - 0.2, zB + 0.05), 0.03, 0.008, X, true);

  // 桌板：从货箱地板外伸 0.62 米的木板（三块拼），两头各一条横档；外沿前角切斜
  const tz0 = -2.55;
  const tz1 = -4.75;
  const tw = 0.62;
  const ty = Y_FLOOR + 0.02;
  const planks = 5;
  for (let i = 0; i < planks; i++) {
    const a = tz0 + ((tz1 - tz0) * i) / planks;
    const b = tz0 + ((tz1 - tz0) * (i + 1)) / planks - 0.01;
    g.add(plate([V(xo, ty, a), V(xo + tw, ty, a), V(xo + tw, ty, b), V(xo, ty, b)], Y, 0.035, woodMats(i % 2 ? 0xb58a52 : 0xc29a62)));
  }
  for (const z of [tz0 - 0.04, tz1 + 0.04, (tz0 + tz1) / 2]) g.add(plate([V(xo + 0.05, ty - 0.035, z - 0.03), V(xo + tw - 0.03, ty - 0.035, z - 0.03), V(xo + tw - 0.03, ty - 0.035, z + 0.03), V(xo + 0.05, ty - 0.035, z + 0.03)], V(0, -1, 0), 0.03, woodMats(0x8a5e32)));
  // 桌板的支撑：两根斜撑，上端顶在桌板下面的横档上（套环），下端顶在货箱下墙的外面（套环）
  for (const z of [tz0 - 0.04, tz1 + 0.04]) pole(g, V(xo + tw - 0.08, ty - 0.07, z), V(xo + 0.03, ty - 0.42, z), 0.018, woodMats(0x8a5e32)[0]!, true);
  // 桌板上的东西：一张地图（浅卡纸 + 绿色一块），一只铜台灯（底座、两节臂、锥形灯罩）、一只笔筒
  g.add(plate([V(xo + 0.12, ty + 0.002, -3.1), V(xo + 0.55, ty + 0.002, -3.1), V(xo + 0.55, ty + 0.002, -3.7), V(xo + 0.12, ty + 0.002, -3.7)], Y, 0.006, sheet(0xe9e3cf)));
  g.add(plate([V(xo + 0.22, ty + 0.009, -3.25), V(xo + 0.45, ty + 0.009, -3.3), V(xo + 0.43, ty + 0.009, -3.55), V(xo + 0.25, ty + 0.009, -3.5)], Y, 0.004, sheet(0x9eb08a)));
  lamp(g, V(xo + 0.1, ty + 0.0, -4.3));
  g.add(convex([[xo + 0.2, ty, -4.55], [xo + 0.28, ty, -4.55], [xo + 0.2, ty + 0.14, -4.55], [xo + 0.28, ty + 0.14, -4.55], [xo + 0.2, ty, -4.63], [xo + 0.28, ty, -4.63], [xo + 0.2, ty + 0.14, -4.63], [xo + 0.28, ty + 0.14, -4.63]], plain(0xd8d2c4)));
  // 桌板外沿下面挂着的"狗侧板"：一块立着的米色板，金边、中间一只狗的剪影；顶上两个合页挂在桌板外沿
  const dz0 = -2.6;
  const dz1 = -3.5;
  const dx = xo + tw - 0.02;
  g.add(plate([V(dx, ty - 0.52, dz0), V(dx, ty - 0.52, dz1), V(dx, ty - 0.04, dz1), V(dx, ty - 0.04, dz0)], X, 0.03, block(0xcfa56e)));
  strip(g, V(dx + 0.002, ty - 0.5, dz0 - 0.03), V(dx + 0.002, ty - 0.5, dz1 + 0.03), 0.03, 0.008, X, false);
  strip(g, V(dx + 0.002, ty - 0.07, dz0 - 0.03), V(dx + 0.002, ty - 0.07, dz1 + 0.03), 0.03, 0.008, X, false);
  g.add(polyPlate(dogShape().map((q) => q.clone().multiplyScalar(2.1)), V(dx + 0.004, ty - 0.46, (dz0 + dz1) / 2 + 0.31), V(0, 0, -1), Y, 0.01, sheet(0xb8864a)));
  for (const z of [dz0 - 0.1, dz1 + 0.1]) strip(g, V(dx + 0.004, ty - 0.1, z), V(dx + 0.004, ty + 0.0, z), 0.04, 0.008, X, true);

  // 遮阳篷：一整块布，一边夹在顶梁上，另一边向外下垂；条纹、毛边；两根斜支杆
  const ax0 = xo + 0.04;
  const ay0 = yAt(zB) - 0.1;
  const ax1 = xo + 1.05;
  const ay1 = yAt(zB) - 0.42;
  const az0 = zF + 0.4; // 篷的前端比货箱开口再往前一点（设计图里篷盖过驾驶室后墙）
  const az1 = zB + 0.25;
  const L = Math.hypot(ax1 - ax0, ay1 - ay0);
  const dir = V(ax1 - ax0, ay1 - ay0, 0).normalize();
  const rr = rng(77);
  const edge: Vector2[] = [new Vector2(0, 0), new Vector2(L, 0)];
  const len = az0 - az1;
  const n = 26;
  for (let i = 0; i <= n; i++) edge.push(new Vector2(L - 0.03 - rr() * 0.08, (len * i) / n));
  edge.push(new Vector2(0, len));
  const stripes = stripeMaterial();
  const aw = polyPlate(edge, V(ax0, ay0, az0), dir, V(0, 0, -1), 0.012, [stripes, stripes]);
  g.add(aw);
  // 篷边的金色夹条（贴在顶梁上），夹条上每隔 0.5 米一颗螺栓
  strip(g, V(ax0, ay0 + 0.01, az0), V(ax0, ay0 + 0.01, az1), 0.05, 0.014, V(0, 1, 0), false);
  for (let z = az0 - 0.2; z > az1; z -= 0.5) bolt(g, V(ax0 + 0.0, ay0 + 0.026, z), V(0, 1, 0), 0.012);
  // 支杆：木杆，上端顶在篷外沿下面的小金座上，下端插在地上的小木底座里
  const poleMat = woodMats(0xa0703e)[0]!;
  for (const [tz, fz] of [
    [az0 - 0.1, az0 + 0.25],
    [az1 + 0.2, az1 + 0.55],
  ] as const) {
    const top = V(ax1 - 0.02, ay1 - 0.02, tz);
    const foot = V(ax1 + 0.2, 0.0, fz);
    pole(g, foot, top, 0.028, poleMat, true);
    g.add(convex([[foot.x - 0.07, 0, foot.z - 0.07], [foot.x + 0.07, 0, foot.z - 0.07], [foot.x - 0.07, 0.05, foot.z - 0.07], [foot.x + 0.07, 0.05, foot.z - 0.07], [foot.x - 0.07, 0, foot.z + 0.07], [foot.x + 0.07, 0, foot.z + 0.07], [foot.x - 0.07, 0.05, foot.z + 0.07], [foot.x + 0.07, 0.05, foot.z + 0.07]], plain(0x8a5e32)));
  }
  // 凳子：两张折叠凳（木，四条腿，叉开，面上两条板）
  stool(g, V(xo + 0.85, 0, -3.35));
  stool(g, V(xo + 0.8, 0, -4.15));
  // 坡道：从后门口斜着下到地面（木板拼，两边木框）
  ramp(g, zB);
  // 后门：开着，贴在后墙右端外侧，和侧墙平行的一块厚板，金边、一条窄窗，铰链在后墙边上
  const dxx = xo + 0.1;
  g.add(plate([V(dxx, 0.62, zB), V(dxx, 0.62, zB - 0.62), V(dxx, yR - 0.08, zB - 0.62), V(dxx, yR - 0.08, zB)], X, 0.05, block(0xe4d6b8)));
  strip(g, V(dxx + 0.004, 0.7, zB - 0.04), V(dxx + 0.004, yR - 0.16, zB - 0.04), 0.03, 0.01, X, true);
  strip(g, V(dxx + 0.004, 0.7, zB - 0.58), V(dxx + 0.004, yR - 0.16, zB - 0.58), 0.03, 0.01, X, false);
  g.add(plate([V(dxx + 0.004, 1.5, zB - 0.2), V(dxx + 0.004, 1.5, zB - 0.42), V(dxx + 0.004, 2.1, zB - 0.42), V(dxx + 0.004, 2.1, zB - 0.2)], X, 0.01, sheet(0xaebbc2)));
  for (const y of [0.9, 1.7, 2.2]) strip(g, V(dxx + 0.004, y, zB - 0.0), V(dxx - 0.06, y, zB + 0.0), 0.05, 0.008, V(0, 0, 1), false);
}

/** 前保险杠（米色厚板 + 两条金带，带螺栓）、下面吊一只铜铃；车顶栏杆上的小狗风向标。 */
function addExtras(g: Group): void {
  const zb0 = F + 0.2;
  const zb1 = F - 0.04;
  // 保险杠：横在鼻子下面的一块厚纸板条（实心体，前面略探出鼻子面板 0.2）
  g.add(convex([[-0.86, 0.38, zb0], [0.86, 0.38, zb0], [-0.86, 0.62, zb0], [0.86, 0.62, zb0], [-0.82, 0.38, zb1], [0.82, 0.38, zb1], [-0.82, 0.62, zb1], [0.82, 0.62, zb1]], plain(0xdcc79c)));
  tileFace(g, V(-0.86, 0.38, zb0 + 0.002), X, Y, 1.72, 0.24, { seed: 91, tones: TONES, cw: 0.34, ch: 0.2 });
  for (const x of [-0.7, 0.7]) strip(g, V(x, 0.38, zb0 + 0.01), V(x, 0.62, zb0 + 0.01), 0.07, 0.012, Z, true);
  strip(g, V(-0.86, 0.62, zb0 + 0.01), V(0.86, 0.62, zb0 + 0.01), 0.04, 0.012, Z, false);
  // 铃铛：挂在保险杠下面一个小金座上（座 → 吊环 → 铃）
  g.add(convex([[-0.04, 0.38, zb0 - 0.02], [0.04, 0.38, zb0 - 0.02], [-0.04, 0.35, zb0 - 0.02], [0.04, 0.35, zb0 - 0.02], [-0.04, 0.38, zb0 - 0.1], [0.04, 0.38, zb0 - 0.1], [-0.04, 0.35, zb0 - 0.1], [0.04, 0.35, zb0 - 0.1]], new MeshStandardMaterial({ color: 0xd9a050, metalness: 0.3, roughness: 0.45 })));
  const bell = new Mesh(new CylinderGeometry(0.035, 0.07, 0.1, 14), brass);
  bell.position.set(0, 0.27, zb0 - 0.06);
  bell.castShadow = true;
  g.add(bell);
  pole(g, V(0, 0.35, zb0 - 0.06), V(0, 0.32, zb0 - 0.06), 0.006, brass, false);
  // 小狗风向标：栏杆前角上立一根铜杆，顶上一只狗的剪影（两面都看得见的薄板，下面有座）
  const px = -0.35;
  const pz = -2.05;
  const yb = 2.7;
  pole(g, V(px, yb, pz), V(px, yb + 0.4, pz), 0.02, brass, true);
  const ball = new Mesh(new SphereGeometry(0.03, 12, 8), gold);
  ball.position.set(px, yb + 0.4, pz);
  g.add(ball);
  const dogFace = new Mesh(new CylinderGeometry(0.0001, 0.0001, 0.0001), brass);
  void dogFace;
  g.add(polyPlate(dogShape().map((q) => q.clone().multiplyScalar(1.5)), V(px + 0.006, yb + 0.42, pz + 0.22), V(0, 0, -1), Y, 0.012, sheet(0xd9b078)));
}

function lamp(g: Group, p: Vector3): void {
  const brassMat = brass;
  g.add(convex([[p.x - 0.07, p.y, p.z - 0.07], [p.x + 0.07, p.y, p.z - 0.07], [p.x - 0.05, p.y + 0.03, p.z - 0.05], [p.x + 0.05, p.y + 0.03, p.z - 0.05], [p.x - 0.07, p.y, p.z + 0.07], [p.x + 0.07, p.y, p.z + 0.07], [p.x - 0.05, p.y + 0.03, p.z + 0.05], [p.x + 0.05, p.y + 0.03, p.z + 0.05]], brassMat));
  pole(g, V(p.x, p.y + 0.03, p.z), V(p.x + 0.04, p.y + 0.28, p.z), 0.008, brassMat, true);
  pole(g, V(p.x + 0.04, p.y + 0.28, p.z), V(p.x + 0.0, p.y + 0.44, p.z), 0.008, brassMat, true);
  const shade2 = new Mesh(new CylinderGeometry(0.04, 0.11, 0.12, 14, 1, true), new MeshStandardMaterial({ color: 0xe8b95a, metalness: 0.3, roughness: 0.5, side: 2, emissive: 0x6a4410, emissiveIntensity: 0.6 }));
  shade2.position.set(p.x - 0.03, p.y + 0.46, p.z);
  shade2.rotation.z = 0.5;
  shade2.castShadow = true;
  g.add(shade2);
}

function stool(g: Group, p: Vector3): void {
  const wood = woodMats(0xb58a52)[0]!;
  const h = 0.45;
  const w = 0.36;
  const d = 0.3;
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) pole(g, V(p.x + sx * (w / 2 + 0.05), 0, p.z + sz * (d / 2 + 0.05)), V(p.x + sx * (w / 2 - 0.02), h, p.z + sz * (d / 2 - 0.02)), 0.014, wood, false);
  for (let i = 0; i < 3; i++) {
    const z0 = p.z - d / 2 + (d * i) / 3;
    g.add(plate([V(p.x - w / 2, h, z0), V(p.x + w / 2, h, z0), V(p.x + w / 2, h, z0 + d / 3 - 0.012), V(p.x - w / 2, h, z0 + d / 3 - 0.012)], Y, 0.022, woodMats(0xc29a62)));
  }
}

function ramp(g: Group, zB: number): void {
  // 坡道：从后墙边（z = zB - 0.7）贴着地面向外延伸，朝 +x：上端 y=0.98、下端 y=0.02，宽 0.55、长 1.1（沿 z 方向 0.55 宽）
  const w = 0.6;
  const x0 = XG + 0.12;
  const x1 = XG + 1.05;
  const y0 = 0.92;
  const y1 = 0.03;
  const z0 = zB - 0.05;
  const dirv = V(x1 - x0, y1 - y0, 0).normalize();
  const n = new Vector3().crossVectors(V(0, 0, -1), dirv).normalize().multiplyScalar(-1);
  for (let i = 0; i < 7; i++) {
    const a = i / 7;
    const b = (i + 1) / 7 - 0.012;
    const A = V(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a, z0);
    const B = V(x0 + (x1 - x0) * b, y0 + (y1 - y0) * b, z0);
    g.add(plate([A, B, B.clone().add(V(0, 0, -w)), A.clone().add(V(0, 0, -w))], n.y < 0 ? n.negate() : n, 0.025, woodMats(i % 2 ? 0xe0c89a : 0xcfa56e)));
  }
  for (const z of [z0 + 0.02, z0 - w - 0.02]) {
    const A = V(x0, y0 - 0.02, z);
    const B = V(x1, y1 - 0.02, z);
    g.add(convex([[A.x, A.y - 0.04, A.z - 0.02], [A.x, A.y + 0.04, A.z - 0.02], [A.x, A.y - 0.04, A.z + 0.02], [A.x, A.y + 0.04, A.z + 0.02], [B.x, B.y - 0.04, B.z - 0.02], [B.x, B.y + 0.04, B.z - 0.02], [B.x, B.y - 0.04, B.z + 0.02], [B.x, B.y + 0.04, B.z + 0.02]], woodMats(0x8a5e32)[0]!));
  }
}

let stripeMat: MeshStandardMaterial | null = null;
function stripeMaterial(): MeshStandardMaterial {
  if (stripeMat) return stripeMat;
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const cols = ['#f1e6cf', '#c4cbb6', '#e2c28a', '#f1e6cf'];
  cols.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(0, i * 64, 16, 64);
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(1, 1 / 0.64); // ExtrudeGeometry 的 UV 是局部坐标（米）：沿长度（局部 y）每 0.64 米一个周期（4 条纹）
  stripeMat = new MeshStandardMaterial({ map: t, roughness: 0.95, side: 2 });
  return stripeMat;
}

/** 整车。 */
export function buildVan(): Group {
  const g = new Group();
  g.add(buildNose());
  addHood(g);
  addCab(g);
  addCabRoof(g);
  addCargo(g);
  addService(g);
  addExtras(g);
  // 驾驶室侧墙（x = 0.8）和货箱外面（x = 0.9）差 10 厘米：这个台阶的立面（朝 +z）用一整块米色厚板封住，再压一根金条
  for (const sx of [-1, 1]) {
    g.add(plate([V(sx * XC, 0.6, Z_CAB + 0.002), V(sx * XG, 0.6, Z_CAB + 0.002), V(sx * XG, yAt(Z_CAB) - 0.0, Z_CAB + 0.002), V(sx * XC, yAt(Z_CAB) - 0.0, Z_CAB + 0.002)].map((p, i, a) => (sx > 0 ? p : a[(4 - i) % 4]!)), V(0, 0, 1), 0.03, block(0xdcc79c)));
  }
  const ws = buildWindshield(0.8, 0.8);
  g.add(ws.group);
  // 前轮、后轮（侧面朝外）
  for (const [zc, zz] of [
    [-1.88, 0],
    [-4.65, 0],
  ] as const)
    for (const s of [-1, 1]) {
      const w = buildWheel(0.42);
      w.rotation.y = (s * Math.PI) / 2;
      w.position.set(s * 0.8, 0.42, zc + zz);
      g.add(w);
    }
  return g;
}
