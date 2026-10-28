import type { P, Shape } from './fit';

/**
 * 耳朵的形状（`docs/research/body-params.md` 第六节，2026-10-28 第三版）。
 *
 * 耳是一片按参数剪出来的纸，原画只提供三个数：铆钉到耳尖的方向、长度、耳根的宽。
 * 原画的猫耳是从侧前方看进耳窝的样子（带透视的内耳、深色的耳边、不规则的搭接片），
 * 拿它去拉长、垂下来，不规则的地方都会跟着放大，所以轮廓整片按参数重新剪：
 * - 耳根：以铆钉为圆心的半圆搭接片（纸偶的关节就是这样，`handoff/007` 的"圆头 + 搭接片"），整片绕铆钉怎么转，耳根都不变形；
 * - 耳身：两侧对称。从铆钉到露出头的地方一样宽（半宽 R，"耳宽"只管它），露出头以后半宽 R · (1 − tᵃ)ᵇ（t 从露出头 0 到耳尖 1）：
 *   耳最宽的地方总在露出头的那里，短耳也不会变成贴在脸上的一个大圆片；b 管耳尖（0.5 圆、1 直边的尖、大于 1 边略凹的尖），a 管耳身多饱满（大是 U 形的舌头，1 是三角）；
 * - 内耳：耳身里一块同形缩小的浅色，只在立着的耳上；
 * - 软硬只管"自然状态下耳朝哪"：整片绕铆钉经过脑后转下来（不往前盖住脸），半软的耳只把耳尖往前弯一点（半立耳）。
 */

/** 从原画读出来的耳（零件自己的坐标，转轴 = 铆钉在原点）。 */
export interface EarModel {
  /** 铆钉指向耳尖的单位向量。 */
  ax: P;
  /** 铆钉到耳尖。 */
  len: number;
  /** 铆钉埋在头的轮廓以内多深（这一截不随耳长伸缩）。 */
  base: number;
  /** 耳根（露出头的地方）的半宽。 */
  R: number;
}

const dot = (u: P, v: P): number => u[0] * v[0] + u[1] * v[1];

/** 露出头以后半宽的形状：t ∈ [0, 1]，露出头的地方 1、耳尖 0。 */
export const earProfile = (s: number, a: number, b: number): number => (s <= 0 ? 1 : s >= 1 ? 0 : Math.pow(1 - Math.pow(s, a), b));

/**
 * 猫耳（圆尖 = 0）的形状：直边略鼓的三角、耳尖收成一个点。不从原画拟合——原画是看进耳窝的透视，
 * 两侧一直一鼓，拟合出来是个蛋形。
 */
const CAT = { a: 1.4, b: 0.9 };

/** 把原画的耳读成参数。base：铆钉埋在头里多深（离铆钉多远算耳根）。 */
export function fitEar(outline: number[], base: number): EarModel {
  const pts: P[] = [];
  for (let i = 0; i < outline.length; i += 2) pts.push([outline[i]!, outline[i + 1]!]);
  let tip = pts[0]!;
  for (const q of pts) if (Math.hypot(q[0], q[1]) > Math.hypot(tip[0], tip[1])) tip = q;
  const len = Math.hypot(tip[0], tip[1]);
  const ax: P = [tip[0] / len, tip[1] / len];
  const nx: P = [-ax[1], ax[0]];
  // 耳根的宽：轮廓和"离铆钉 base"那条线的交点之间。
  const cross: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const up = dot(p, ax) - base;
    const uq = dot(q, ax) - base;
    if (up === uq || up * uq > 0) continue;
    const k = up / (up - uq);
    cross.push(dot(p, nx) + (dot(q, nx) - dot(p, nx)) * k);
  }
  const half = cross.length >= 2 ? (Math.max(...cross) - Math.min(...cross)) / 2 : len * 0.3;
  return { ax, len, base, R: half };
}

/** 耳的参数（都相对原画）。 */
export interface EarLook {
  /** 露在头外面的那一截的长度 × 多少。 */
  lenK: number;
  /** 耳根的宽 × 多少。 */
  wide: number;
  /** 圆尖：0 是原画；1 最圆（U 形、圆头），−1 最尖（三角、边略凹）。 */
  round: number;
  /** 软硬：1 立着，0 整只垂下。 */
  stiff: number;
  /** 零件坐标的 +x 在画面里的朝向（弧度，y 朝下）：判断哪边是"下"、哪边是"前"。 */
  frame: number;
}

/** 最圆、最尖时的 (a, b)。 */
const ROUND = { a: 2.4, b: 0.5 };
const SHARP = { a: 1.1, b: 1.35 };
/** 整只垂下来时耳尖朝哪（画面里，y 朝下）：正下方略偏前，贴着脸颊。 */
const HANG = Math.PI / 2 - 0.15;
/** 半立耳的耳尖往前弯：最多弯多少（弧度），在露出头的那一截的哪一段弯（这一段以外的耳尖是直的）。真正折过来的耳尖（柯利）要画折痕，还没做。 */
const FOLD_MAX = 1.5;
const FOLD_AT = 0.5;
const FOLD_SPAN = 0.25;

const smooth = (x: number): number => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

/** 软到什么程度整片垂下（0 立着、1 垂到底）：软度过了 0.3 才开始。 */
export const earDroop = (stiff: number): number => smooth((1 - stiff - 0.3) / 0.7);

/**
 * 按参数剪一只耳（零件自己的坐标，铆钉在原点）。
 * hinge：整片绕铆钉再转多少（弧度，加在摆放的角度上）；
 * sink：垂下来的耳的铆钉该往头里挪多深（耳根的折痕贴着头顶的轮廓，耳从脸侧挂下来，不翘在头顶上面）。
 */
export function earShape(m: EarModel, look: EarLook): { shape: Shape; hinge: number; sink: number } {
  const L = m.base + (m.len - m.base) * look.lenK;
  const R = m.R * look.wide;
  const f = Math.min(1, Math.abs(look.round));
  const to = look.round >= 0 ? ROUND : SHARP;
  const a = CAT.a + (to.a - CAT.a) * f;
  const b = CAT.b + (to.b - CAT.b) * f;
  // 中线上的位置 s 从铆钉 0 到耳尖 1；露出头的地方是 sb。
  const sb = m.base / L;
  const w = (s: number): number => (s <= sb ? R : R * earProfile((s - sb) / (1 - sb), a, b));
  const fAt = sb + FOLD_AT * (1 - sb);
  const fSpan = FOLD_SPAN * (1 - sb);
  const nx: P = [-m.ax[1], m.ax[0]];

  // 软硬：整片垂下的量 droop；还没怎么垂下的时候（半立耳，软度 0–0.5），耳尖往前弯，软度 0.25 时弯得最多。
  const soft = 1 - look.stiff;
  const droop = earDroop(look.stiff);
  let hinge = 0;
  if (droop > 0) {
    // 经过脑后转到 HANG（往后转是角度变小）。
    const dir = look.frame + Math.atan2(m.ax[1], m.ax[0]);
    let d = HANG - dir;
    while (d > 0) d -= 2 * Math.PI;
    while (d <= -2 * Math.PI) d += 2 * Math.PI;
    hinge = d * droop;
  }
  // 往前弯：中线只在 FOLD_AT 起的一小段里弯（曲率平滑地起落，轮廓上不出折角），这一段以外的耳尖是直的；
  // 弯得最急的地方半径也不小于那里半宽的 1.6 倍（内侧不挤出缺口）。
  // +n 是中线顺时针转 90°（y 朝下），耳朝上时就是朝前（脸那边）。
  const K = 120;
  const ramp = (s: number): number => (s <= fAt || s >= fAt + fSpan ? 0 : Math.sin((Math.PI * (s - fAt)) / fSpan) ** 2);
  let fold = soft < 0.5 ? FOLD_MAX * Math.sin((Math.PI * soft) / 0.5) : 0;
  const rampArea = fSpan / 2;
  if (fold > 0) {
    let worst = 0;
    for (let k = 0; k <= K; k++) worst = Math.max(worst, (ramp(k / K) / (rampArea * L)) * w(k / K));
    if (fold * worst > 1 / 1.6) fold = 1 / 1.6 / worst;
  }
  // 中线：每个 s 上的转角 th 和位置 c（以铆钉为原点，长度是 L 倍）。
  const th: number[] = [0];
  const cs: P[] = [[0, 0]];
  for (let k = 1; k <= K; k++) {
    const sm = (k - 0.5) / K;
    th.push(th[k - 1]! + (fold * ramp(sm)) / rampArea / K);
    const tm = (th[k - 1]! + th[k]!) / 2;
    cs.push([cs[k - 1]![0] + (Math.cos(tm) * L) / K, cs[k - 1]![1] + (Math.sin(tm) * L) / K]);
  }
  const at = (s: number, v: number): P => {
    const x = Math.min(K, Math.max(0, s * K));
    const k = Math.min(K - 1, Math.floor(x));
    const t = x - k;
    const a0 = th[k]! + (th[k + 1]! - th[k]!) * t;
    // 中线上的点 + 那里的法线 × v（都写在 (ax, nx) 底下）。
    const u = cs[k]![0] + (cs[k + 1]![0] - cs[k]![0]) * t - v * Math.sin(a0);
    const n = cs[k]![1] + (cs[k + 1]![1] - cs[k]![1]) * t + v * Math.cos(a0);
    return [m.ax[0] * u + nx[0] * n, m.ax[1] * u + nx[1] * n];
  };

  // 轮廓：+n 一侧从耳尖下到铆钉，绕到铆钉后面的半圆，−n 一侧再上到耳尖。耳尖附近的点密一些。
  const N = 40;
  const sAt = (k: number): number => 1 - (1 - k / N) * (1 - k / N);
  const outline: number[] = [];
  for (let k = N; k >= 0; k--) outline.push(...at(sAt(k), w(sAt(k))));
  const M = 16;
  for (let k = 1; k < M; k++) {
    const a0 = Math.PI / 2 + (Math.PI * k) / M;
    outline.push(m.ax[0] * Math.cos(a0) * R + nx[0] * Math.sin(a0) * R, m.ax[1] * Math.cos(a0) * R + nx[1] * Math.sin(a0) * R);
  }
  for (let k = 0; k < N; k++) outline.push(...at(sAt(k), -w(sAt(k))));

  // 内耳：耳身中间一块同形缩小的浅色，从露出头的地方到弯起来的地方（或耳尖附近）；垂下来露的是耳背，没有内耳。
  const pale: number[][] = [];
  if (droop < 0.3) {
    const s0 = sb + 0.06 * (1 - sb);
    const s1 = fold > 0.3 ? fAt + fSpan / 2 : sb + 0.88 * (1 - sb);
    if (s1 - s0 > 0.1) {
      const inner = (s: number): number => {
        const e = (2 * (s - s0)) / (s1 - s0) - 1;
        return 0.5 * w(s) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(e), 3)));
      };
      const J = 20;
      const poly: number[] = [];
      for (let k = 0; k <= J; k++) poly.push(...at(s0 + ((s1 - s0) * k) / J, inner(s0 + ((s1 - s0) * k) / J)));
      for (let k = J - 1; k > 0; k--) poly.push(...at(s0 + ((s1 - s0) * k) / J, -inner(s0 + ((s1 - s0) * k) / J)));
      pale.push(poly);
    }
  }
  return { shape: { outline, stripe: [], pale }, hinge, sink: R * droop };
}
