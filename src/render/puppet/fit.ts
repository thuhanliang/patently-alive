/**
 * 零件贴骨头（纯几何，单位是成品图的像素，坐标原点在零件的转轴）。
 *
 * 部件的零件是从一张成品图切出来的，长短粗细是那只动物的。换了体型、部件，骨头变了，零件要跟着变，但纸偶的关节不能露缝：
 * - 先整片等比缩放到新的粗细（关节的圆头还是圆的，搭接片的半径跟着变）；
 * - 再只拉伸两个圆头之间的那一截杆，补足新的长度（圆头不变形，铆钉还在圆心）。
 * 杆最多压到原来的 30%，再短就整片一起压（这时已经该换一档零件了，见 DECISIONS"纸偶的部件抽象"）。
 */

export type P = [number, number];

/** 骨头：从转轴（原点）指向骨头末端（下一个关节，或趾尖、尾尖）。rA、rB 是两头圆头的半径。 */
export interface Bone {
  end: P;
  rA: number;
  rB: number;
}

/** 一片零件的形状：轮廓 + 色区，都是 [x0, y0, x1, y1, …]。 */
export interface Shape {
  outline: number[];
  stripe: number[][];
  pale: number[][];
}

/** 点的变换。 */
export type Warp = (x: number, y: number) => P;

export function mapPoly(poly: number[], f: Warp): number[] {
  const out = new Array<number>(poly.length);
  for (let i = 0; i < poly.length; i += 2) {
    const [x, y] = f(poly[i]!, poly[i + 1]!);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

export function mapShape(s: Shape, f: Warp): Shape {
  return { outline: mapPoly(s.outline, f), stripe: s.stripe.map((p) => mapPoly(p, f)), pale: s.pale.map((p) => mapPoly(p, f)) };
}

/**
 * 贴骨头的变换：整片按 w 缩放，再沿骨头拉伸杆，让骨头的长度变成 len。
 * 返回点的变换（零件上的点、插口都用它变）。
 */
export function boneWarp(bone: Bone, w: number, len: number): Warp {
  const L0 = Math.hypot(bone.end[0], bone.end[1]);
  const ax: P = [bone.end[0] / L0, bone.end[1] / L0];
  const a = bone.rA * w;
  const b = Math.max(0, L0 - bone.rB) * w;
  const shaft = b - a;
  const target = len - (L0 * w - shaft);
  // 杆能压到的最短：原来的 30%；再短，整片沿骨头一起压。
  const minShaft = shaft * 0.3;
  let k: number;
  let uniform = 1;
  if (shaft <= 1e-6) {
    k = 1;
    uniform = len / (L0 * w);
  } else if (target >= minShaft) {
    k = target / shaft;
  } else {
    k = 0.3;
    uniform = len / (L0 * w - shaft + minShaft);
  }
  return (x, y) => {
    const u0 = (x * ax[0] + y * ax[1]) * w;
    const v = (-x * ax[1] + y * ax[0]) * w;
    let u = u0 <= a ? u0 : u0 >= b ? u0 + shaft * (k - 1) : a + (u0 - a) * k;
    u *= uniform;
    return [u * ax[0] - v * ax[1], u * ax[1] + v * ax[0]];
  };
}

/** 沿某个方向的一段（从 from 开始往 dir 方向）拉伸 k 倍，这段之前不动、之后平移（吻用）。 */
export function regionStretch(from: P, dir: P, k: number, wide = 1): Warp {
  const n = Math.hypot(dir[0], dir[1]);
  const ax: P = [dir[0] / n, dir[1] / n];
  return (x, y) => {
    const dx = x - from[0];
    const dy = y - from[1];
    const u = dx * ax[0] + dy * ax[1];
    let v = -dx * ax[1] + dy * ax[0];
    if (u <= 0) return [x, y];
    // 宽度从起点往外渐渐变到 wide 倍（起点处不变，不在根部出台阶）。
    const t = Math.min(1, u / 40);
    v *= 1 + (wide - 1) * t;
    const u2 = u * k;
    return [from[0] + u2 * ax[0] - v * ax[1], from[1] + u2 * ax[1] + v * ax[0]];
  };
}

/** 两个变换接起来：先 f 后 g。 */
export const compose =
  (f: Warp, g: Warp): Warp =>
  (x, y) => {
    const [a, b] = f(x, y);
    return g(a, b);
  };

/** 按比例缩放（各向不同）。 */
export const scale =
  (sx: number, sy = sx): Warp =>
  (x, y) => [x * sx, y * sy];

/** 轮廓上沿某个方向最远的点到原点的距离（尾尖、趾尖找不到下一个关节时用）。 */
export function reach(poly: number[], dir: P): number {
  const n = Math.hypot(dir[0], dir[1]);
  let best = 0;
  for (let i = 0; i < poly.length; i += 2) best = Math.max(best, (poly[i]! * dir[0] + poly[i + 1]! * dir[1]) / n);
  return best;
}
