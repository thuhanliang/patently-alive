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

/** 沿某个方向的一段（从 from 开始往 dir 方向）拉伸 k 倍，这段之前不动、之后平移（吻、耳朵用）。 */
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

/**
 * 磨圆或削尖（耳尖）：以 center 为圆心，朝 axis 方向的那一半（和 axis 的夹角不到 90°）按超椭圆的比例径向伸缩。
 * 超椭圆 |x/a|^n + |y/b|^n = 1：n = 1 是菱形（直边、尖），n = 2 是椭圆（圆），n < 1 是凹边（更尖）。
 * 原画的形状算作 nRef；每个方向的半径乘 SE(θ; n) ÷ SE(θ; nRef)，所以 n = nRef 时一点不动，原画的手绘起伏都保留。
 * 垂直于 axis（θ = 90°）的点不动，根部的宽窄不变。比原画圆的时候，正对 axis 的长度也收一点（圆耳不会和尖耳一样高）：
 * 目标的半长是 a × min(1, (n ÷ nRef)^−0.25)。
 */
export function radialReshape(center: P, axis: P, a: number, b: number, n: number, nRef: number): Warp {
  const aT = a * Math.min(1, Math.pow(n / nRef, -0.25));
  const m = Math.hypot(axis[0], axis[1]);
  const ax: P = [axis[0] / m, axis[1] / m];
  const se = (c: number, s: number, k: number, A: number): number => Math.pow(Math.pow(c / A, k) + Math.pow(s / b, k), -1 / k);
  return (x, y) => {
    const dx = x - center[0];
    const dy = y - center[1];
    const u = dx * ax[0] + dy * ax[1];
    if (u <= 0) return [x, y];
    const v = -dx * ax[1] + dy * ax[0];
    const r = Math.hypot(u, v);
    const c = u / r;
    const s = Math.abs(v) / r;
    const k = se(c, s, n, aT) / se(c, s, nRef, a);
    return [center[0] + dx * k, center[1] + dy * k];
  };
}

/**
 * 弯折（垂下的耳朵）：沿 axis 走到 from 以后，中线弯成一段圆弧，走 len 转过 angle（弧度，转的方向和 rot() 相同），再接着直走。
 * 离中线 v 远的点跟着中线的法线走，所以沿中线的长短不变（纸片是弯过去的，不是拉过去的）。
 * 圆弧的半径 R = len ÷ |angle| 可以比零件的半宽小：弯的内侧像折痕一样被挤紧（离中线最多 R），不会翻过去；外侧照常。
 */
export function bend(from: P, axis: P, len: number, angle: number): Warp {
  const m = Math.hypot(axis[0], axis[1]);
  const ax: P = [axis[0] / m, axis[1] / m];
  const nx: P = [-ax[1], ax[0]];
  if (Math.abs(angle) < 1e-9 || len <= 0) return (x, y) => [x, y];
  const kap = angle / len;
  const R = 1 / Math.abs(kap);
  // 内侧（圆心那一侧）的 v 的符号：angle > 0 时圆心在 +n 一侧。
  const inner = Math.sign(angle);
  return (x, y) => {
    const dx = x - from[0];
    const dy = y - from[1];
    const u = dx * ax[0] + dy * ax[1];
    if (u <= 0) return [x, y];
    let v = dx * nx[0] + dy * nx[1];
    const s = Math.min(u, len);
    // 挤紧的程度随弯过的比例渐渐加上，折点处不出台阶。
    const f = s / len;
    if (v * inner > 0) {
      const d = Math.abs(v);
      const squeezed = R * 0.92 * (1 - Math.exp(-d / (R * 0.92)));
      v = inner * (d + (squeezed - d) * f);
    }
    const al = kap * s;
    // 中线：c(s) = from + (sin κs · axis + (1 − cos κs) · n) / κ。
    const ci = Math.sin(al) / kap;
    const cj = (1 - Math.cos(al)) / kap;
    const ca = Math.cos(al);
    const sa = Math.sin(al);
    // 这一点的切线、法线是 axis、n 转过 al。
    const t: P = [ax[0] * ca + nx[0] * sa, ax[1] * ca + nx[1] * sa];
    const nn: P = [nx[0] * ca - ax[0] * sa, nx[1] * ca - ax[1] * sa];
    const rest = u - s;
    return [
      from[0] + ax[0] * ci + nx[0] * cj + nn[0] * v + t[0] * rest,
      from[1] + ax[1] * ci + nx[1] * cj + nn[1] * v + t[1] * rest,
    ];
  };
}

/** 把多边形加密：长于 maxSeg 的边等分（变形以后弯处才圆，不出棱角）。 */
export function densify(poly: number[], maxSeg: number): number[] {
  const out: number[] = [];
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const x0 = poly[2 * i]!;
    const y0 = poly[2 * i + 1]!;
    const x1 = poly[(2 * i + 2) % poly.length]!;
    const y1 = poly[(2 * i + 3) % poly.length]!;
    const k = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / maxSeg));
    for (let j = 0; j < k; j++) out.push(x0 + ((x1 - x0) * j) / k, y0 + ((y1 - y0) * j) / k);
  }
  return out;
}
