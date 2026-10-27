import { bend, densify, type P, type Shape } from './fit';

/**
 * 耳朵的形状（`docs/research/body-params.md` 第六节"描出来的多边形 + 变形算子"，2026-10-27 重做）。
 *
 * 原画的耳先被"读成参数"：
 * - 中线：从耳根的中点指向耳尖；
 * - 两侧各一条宽度轮廓 w(s) = W · (1 − sⁿ)^(1/n)（s 从耳根 0 到耳尖 1）：n = 1 是直边，n 大是圆钝，n 小是凹边的尖；
 *   原画的耳两侧不对称（一侧直、一侧钝），所以两侧各有自己的 W、n；
 * - 手绘的起伏：两侧轮廓偏离拟合曲线的那一点点（最多 ±15%），按 s 记下来。
 * 换参数时只改这几个数（长度、W、n），再按它们重新画出两侧的轮廓、加回手绘的起伏；
 * 耳根（埋在头下面的那一截）照原画，只按宽窄缩放；内耳、斑纹按"沿中线走多远、占宽度的几成"跟着走。
 * 这样任何参数组合都是一只规整的耳，不会像径向伸缩那样在耳尖附近把小起伏放大成怪形状。
 * 软的耳朵最后再按 fit.ts 的 bend 弯下来。
 */

/** 宽度轮廓的形状：s ∈ [0, 1]，耳根 1、耳尖 0。 */
export const earProfile = (s: number, n: number): number => (s <= 0 ? 1 : s >= 1 ? 0 : Math.pow(1 - Math.pow(s, n), 1 / n));

interface Side {
  W: number;
  n: number;
  /** 手绘的起伏：[s, 相对拟合曲线多出来的比例]，按 s 排好。 */
  wobble: [number, number][];
}

/** 从原画读出来的耳（零件自己的坐标，转轴在原点）。 */
export interface EarModel {
  /** 耳根的中点。 */
  origin: P;
  /** 中线方向（单位向量），从耳根指向耳尖。 */
  ax: P;
  /** 耳根到耳尖。 */
  len: number;
  /** +n 一侧（n = 中线方向转 90°）和 −n 一侧。 */
  pos: Side;
  neg: Side;
}

const dot = (a: P, b: P): number => a[0] * b[0] + a[1] * b[1];

/** 把原画的耳读成参数。baseU：离转轴多远算耳根（再往里是埋在头下面的部分）。 */
export function fitEar(outline: number[], baseU: number): EarModel {
  const pts: P[] = [];
  for (let i = 0; i < outline.length; i += 2) pts.push([outline[i]!, outline[i + 1]!]);
  let tip = pts[0]!;
  for (const q of pts) if (Math.hypot(q[0], q[1]) > Math.hypot(tip[0], tip[1])) tip = q;
  const t0 = Math.hypot(tip[0], tip[1]);
  const a0: P = [tip[0] / t0, tip[1] / t0];
  const n0: P = [-a0[1], a0[0]];
  // 耳根：轮廓和"离转轴 baseU"那条线的两个交点，取中点。
  const cross: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const up = dot(p, a0) - baseU;
    const uq = dot(q, a0) - baseU;
    if (up === uq || up * uq > 0) continue;
    const k = up / (up - uq);
    cross.push(dot(p, n0) + (dot(q, n0) - dot(p, n0)) * k);
  }
  const vMid = cross.length >= 2 ? (Math.min(...cross) + Math.max(...cross)) / 2 : 0;
  const origin: P = [a0[0] * baseU + n0[0] * vMid, a0[1] * baseU + n0[1] * vMid];
  const d: P = [tip[0] - origin[0], tip[1] - origin[1]];
  const len = Math.hypot(d[0], d[1]);
  const ax: P = [d[0] / len, d[1] / len];
  const nx: P = [-ax[1], ax[0]];
  const sides = { pos: [] as [number, number][], neg: [] as [number, number][] };
  for (const q of pts) {
    const r: P = [q[0] - origin[0], q[1] - origin[1]];
    const s = dot(r, ax) / len;
    const v = dot(r, nx);
    if (s < 0 || s > 1) continue;
    (v >= 0 ? sides.pos : sides.neg).push([s, Math.abs(v)]);
  }
  return { origin, ax, len, pos: fitSide(sides.pos), neg: fitSide(sides.neg) };
}

/** 一侧的宽度轮廓：在 n 的网格上找最小二乘，W 有解析解。 */
function fitSide(pts: [number, number][]): Side {
  if (pts.length === 0) return { W: 1, n: 1, wobble: [] };
  let best = { W: 1, n: 1, err: Infinity };
  for (let n = 0.5; n <= 4.001; n += 0.05) {
    let num = 0;
    let den = 0;
    for (const [s, w] of pts) {
      const p = earProfile(s, n);
      num += w * p;
      den += p * p;
    }
    const W = den > 0 ? num / den : 1;
    let err = 0;
    for (const [s, w] of pts) err += (w - W * earProfile(s, n)) ** 2;
    if (err < best.err) best = { W, n, err };
  }
  const wobble: [number, number][] = pts
    .filter(([s]) => s <= 0.85)
    .map(([s, w]): [number, number] => [s, Math.max(-0.15, Math.min(0.15, w / (best.W * earProfile(s, best.n)) - 1))])
    .sort((a, b) => a[0] - b[0]);
  return { W: best.W, n: best.n, wobble };
}

/** 起伏在 s 处的值（线性插值），耳尖附近渐渐收到 0（耳尖总是干净的）。 */
function wobbleAt(side: Side, s: number): number {
  const w = side.wobble;
  if (w.length === 0) return 0;
  let r: number;
  if (s <= w[0]![0]) r = w[0]![1];
  else if (s >= w[w.length - 1]![0]) r = w[w.length - 1]![1];
  else {
    let i = 1;
    while (w[i]![0] < s) i++;
    const [s0, r0] = w[i - 1]!;
    const [s1, r1] = w[i]!;
    r = s1 > s0 ? r0 + ((r1 - r0) * (s - s0)) / (s1 - s0) : r0;
  }
  const f = Math.min(1, Math.max(0, (0.95 - s) / 0.2));
  return r * f * f * (3 - 2 * f);
}

/** 耳的参数（都相对原画）。 */
export interface EarLook {
  /** 耳根以外的长度 × 多少。 */
  lenK: number;
  /** 宽 × 多少。 */
  wide: number;
  /**
   * 圆尖：0 是原画；往 1 走，两侧的轮廓一起变到圆（指数 N_ROUND）；往 −1 走，一起变到尖（N_SHARP）。
   * 原画的两侧不对称（一侧直、一侧钝），走到两头时两侧的宽窄、形状也一起变得对称。
   */
  round: number;
  /** 软硬：1 立着，0 整只垂下。 */
  stiff: number;
  /** 零件坐标的 +x 在画面里的朝向（弧度，y 朝下）：判断哪边是"下"。 */
  frame: number;
}

/** 最圆、最尖时两侧轮廓的指数：2.2 接近半个椭圆（圆顶），0.85 是边略凹的尖（猞猁）。 */
const N_ROUND = 2.2;
const N_SHARP = 0.85;
/** 拉得很长、很短时，两侧向这个中间的形状靠拢（直边、尖顶），远近两只耳也就长得一样。 */
const N_MID = 1.3;

/** 按参数重画一只耳（零件自己的坐标）。src 是原画的这片零件。hinge：整片绕铆钉再转多少（弧度，加在摆放的角度上）。 */
export function earShape(m: EarModel, src: Shape, look: EarLook): { shape: Shape; hinge: number } {
  const L = m.len * look.lenK;
  // 先按长短向对称的中间形状靠拢（原画一侧直、一侧钝，拉长了会像一把歪的刀），再按圆尖往两头走。
  const fLen = 0.8 * Math.min(1, Math.abs(Math.log(look.lenK)) / Math.log(3));
  const f = Math.min(1, Math.abs(look.round));
  const nTarget = look.round >= 0 ? N_ROUND : N_SHARP;
  const fSym = 1 - (1 - fLen) * (1 - f);
  const wAvg = (m.pos.W + m.neg.W) / 2;
  const lerpLog = (a: number, b: number, t: number): number => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t);
  const side = (sd: Side) => ({ W: (sd.W + (wAvg - sd.W) * fSym) * look.wide, n: lerpLog(lerpLog(sd.n, N_MID, fLen), nTarget, f) });
  const pos = side(m.pos);
  const neg = side(m.neg);
  // 拉长的耳中段鼓起来（兔、驴的耳像一片柳叶，最宽在中间，不是根部最宽的三角）。
  const bulge = 0.6 * Math.min(1, Math.max(0, Math.log(look.lenK) / Math.log(3)));
  const prof = (s: number, nn: number): number => earProfile(s, nn) * (1 + bulge * 4 * s * (1 - s));
  // 软的耳朵（纸偶的耳是单独一片、铆在头上）：
  // - 要转多少：耳的中线从现在的朝向，经过脑后转到下方略偏后（π/2 + 0.1，量的是耳根到耳尖的中线，耳尖还会再往后一点），乘以软的程度；
  // - 一部分是整片绕铆钉转（hinge，越软越多，垂耳兔的整只耳从头顶垂下来），其余是耳尖那一段弯下来（半立的耳只折耳尖）；
  // - 折过去的部分露的是耳背：内耳（浅色）只留在折点以前；整片翻下来时内耳就看不见了。
  const soft = 1 - look.stiff;
  const smooth = (x: number): number => {
    const c = Math.min(1, Math.max(0, x));
    return c * c * (3 - 2 * c);
  };
  let phiAll = 0;
  if (soft > 0) {
    const dir = look.frame + Math.atan2(m.ax[1], m.ax[0]);
    const hang = Math.PI / 2 + 0.1 - 2 * Math.PI;
    let base = dir;
    while (base - hang > 2 * Math.PI) base -= 2 * Math.PI;
    while (base - hang < 0) base += 2 * Math.PI;
    phiAll = (hang - base) * soft;
  }
  const hs = smooth((soft - 0.4) / 0.6);
  const sF = 1 - 0.45 * Math.min(1, soft / 0.5);
  const nx: P = [-m.ax[1], m.ax[0]];
  const at = (s: number, v: number): P => [m.origin[0] + m.ax[0] * s * L + nx[0] * v, m.origin[1] + m.ax[1] * s * L + nx[1] * v];
  // 原画上的一点 → (s, 占宽度的几成) → 新耳上的一点。耳根以下（s < 0）只按宽窄缩放、长度不变。
  const mapPt = (x: number, y: number, inside: boolean, sMax = 1): P => {
    const r: P = [x - m.origin[0], y - m.origin[1]];
    const u = dot(r, m.ax);
    const v = dot(r, nx);
    const sd = v >= 0 ? m.pos : m.neg;
    const nw = v >= 0 ? pos : neg;
    if (u < 0) {
      const k = nw.W / sd.W;
      return [m.origin[0] + m.ax[0] * u + nx[0] * v * k, m.origin[1] + m.ax[1] * u + nx[1] * v * k];
    }
    const s0 = Math.min(inside ? 0.97 : 1, u / m.len);
    const w0 = sd.W * earProfile(s0, sd.n);
    let t = w0 > 1e-6 ? v / w0 : 0;
    if (inside) t = Math.max(-0.95, Math.min(0.95, t));
    const s = Math.min(s0, sMax);
    return at(s, t * nw.W * prof(s, nw.n));
  };
  const mapPoly = (poly: number[], sMax = 1): number[] => {
    const out: number[] = [];
    for (let i = 0; i < poly.length; i += 2) out.push(...mapPt(poly[i]!, poly[i + 1]!, true, sMax));
    return out;
  };

  // 轮廓：耳根那一截照原画（只缩放宽窄），两侧按新的宽度轮廓重画，耳尖附近加密。
  const o = src.outline;
  const n = o.length / 2;
  const sOf = (i: number): number => dot([o[2 * i]! - m.origin[0], o[2 * i + 1]! - m.origin[1]], m.ax);
  const vOf = (i: number): number => dot([o[2 * i]! - m.origin[0], o[2 * i + 1]! - m.origin[1]], nx);
  // 找耳根那一截（s < 0 的连续一段）的起止。
  let start = -1;
  for (let i = 0; i < n; i++) if (sOf(i) < 0 && sOf((i - 1 + n) % n) >= 0) start = i;
  const outline: number[] = [];
  // 原画的轮廓在耳根（s = 0）处的宽：重画的两侧从这里起步，和照原画的耳根一截接上，不出台阶。
  const rootV = { pos: m.pos.W, neg: m.neg.W };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = sOf(i);
    const b = sOf(j);
    if (a === b || a * b > 0) continue;
    const v = vOf(i) + ((vOf(j) - vOf(i)) * a) / (a - b);
    if (v >= 0) rootV.pos = v;
    else rootV.neg = -v;
  }
  const N = 32;
  const sideCurve = (sd: Side, nw: { W: number; n: number }, sign: number, up: boolean): void => {
    const r0 = (sign > 0 ? rootV.pos : rootV.neg) / sd.W - 1;
    for (let k = 0; k <= N; k++) {
      const q = up ? k / N : 1 - k / N;
      // 耳尖附近的点密一些：s = 1 − (1 − q)²。
      const s = 1 - (1 - q) * (1 - q);
      const g = Math.min(1, s / 0.12);
      const r = r0 + (wobbleAt(sd, s) - r0) * g * g * (3 - 2 * g);
      outline.push(...at(s, sign * nw.W * prof(s, nw.n) * (1 + r)));
    }
  };
  if (start < 0) {
    // 原画的耳没有埋在头下面的部分：耳根就是一条直线。
    sideCurve(m.neg, neg, -1, true);
    sideCurve(m.pos, pos, 1, false);
  } else {
    let i = start;
    while (sOf(i) < 0) {
      outline.push(...mapPt(o[2 * i]!, o[2 * i + 1]!, false));
      i = (i + 1) % n;
    }
    // 耳根这一截走完，接着走的是哪一侧（原画的走向），先沿这一侧上到耳尖，再沿另一侧下来。
    const firstPos = vOf(i) >= 0;
    if (firstPos) {
      sideCurve(m.pos, pos, 1, true);
      sideCurve(m.neg, neg, -1, false);
    } else {
      sideCurve(m.neg, neg, -1, true);
      sideCurve(m.pos, pos, 1, false);
    }
  }
  const dz = (poly: number[]): number[] => mapPoly(densify(poly, 3));
  const paleMax = soft > 0 ? sF * (1 - smooth((soft - 0.4) / 0.4)) : 1;
  let shape: Shape = { outline, stripe: src.stripe.map(dz), pale: src.pale.map((q) => mapPoly(densify(q, 3), paleMax)) };

  // 耳尖那一段弯下来：弧长占折点以外的七成；弯的半径不小于折点处耳宽的一半多一点（不卷成圈）。
  // 弯不了那么多的部分，越软越多地交给整片的转动（很软的耳一定垂到底）。
  const bendLen = (1 - sF) * L * 0.7;
  const wF = ((pos.W * prof(sF, pos.n) + neg.W * prof(sF, neg.n)) / 2) * 1.1;
  let phiBend = phiAll * (1 - 0.85 * hs);
  if (bendLen / Math.abs(phiBend || 1) < wF) phiBend = Math.sign(phiBend) * (bendLen / wF);
  const hinge = (phiAll - phiBend) * hs;
  if (Math.abs(phiBend) > 1e-6) {
    const len = bendLen;
    const b = bend(at(sF, 0), m.ax, len, phiBend);
    const bp = (poly: number[]): number[] => {
      const out: number[] = [];
      for (let i = 0; i < poly.length; i += 2) out.push(...b(poly[i]!, poly[i + 1]!));
      return out;
    };
    shape = { outline: bp(shape.outline), stripe: shape.stripe.map(bp), pale: shape.pale.map(bp) };
  }
  return { shape, hinge };
}
