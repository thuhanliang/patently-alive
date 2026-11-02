/**
 * 毛边算子（设计台第 3 步 b，`docs/research/body-params.md` 第五节"同时把它画出来"）。
 *
 * 毛长进了推演，画面上就要看得出：轮廓沿外法线长出一圈毛簇，毛越长毛簇越长，底绒厚了轮廓整体往外胀一点。
 * - 毛簇按轮廓的弧长等分：一片零件的毛簇个数在剪纸的原样上定好（teethFor），零件拉长、缩短时毛簇跟着拉伸，不会一簇簇冒出来或消失；
 * - 每簇是圆头、往一个方向倒（顺着毛流朝尾巴），长短按序号有一点不齐（确定的，不用随机数）；
 * - 零件压在别的长毛零件上的那段边（躯干中间的接缝、尾节之间）不长毛簇，只有外轮廓长（weights）；
 * - amp 和 swell 都是 0 时原样返回同一个数组：短毛的纸偶和以前一模一样。
 */

type P = [number, number];

/** 一片零件的毛簇个数：按原样的周长，每 step 一簇。 */
export function teethFor(outline: readonly number[], step: number): number {
  return Math.max(6, Math.round(perimeter(outline) / Math.max(1e-6, step)));
}

export function perimeter(outline: readonly number[]): number {
  const n = outline.length / 2;
  let L = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    L += Math.hypot(outline[2 * j]! - outline[2 * i]!, outline[2 * j + 1]! - outline[2 * i + 1]!);
  }
  return L;
}

/** 点在不在多边形里（偶奇规则）。 */
export function inside(poly: readonly number[], x: number, y: number): boolean {
  let c = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[2 * i]!;
    const yi = poly[2 * i + 1]!;
    const xj = poly[2 * j]!;
    const yj = poly[2 * j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** 每簇的长短（0.75–1），按序号确定。 */
const jitter = (k: number): number => 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(k * 2.399 + 0.7));

/** 一簇的形状：u 从 0 到 1，圆头（不是锯齿）。 */
const tuft = (u: number): number => Math.pow(Math.sin(Math.PI * u), 0.7);

export interface FringeOpts {
  /** 毛簇个数（teethFor）。 */
  teeth: number;
  /** 毛流朝哪（零件坐标里的单位向量，一般是朝尾巴）：毛簇的尖往这边倒。 */
  flow?: P;
  /** 每个顶点长不长毛簇（0–1，和 outline 的顶点一一对应）；不给就都长。 */
  weights?: readonly number[];
}

/** 给轮廓长毛边：amp 是毛簇最长多长，swell 是轮廓整体往外胀多少（都是零件坐标里的长度）。 */
export function fringe(outline: number[], amp: number, swell: number, o: FringeOpts): number[] {
  if (amp <= 0 && swell <= 0) return outline;
  const n = outline.length / 2;
  if (n < 3) return outline;
  const px = (i: number): number => outline[2 * (((i % n) + n) % n)]!;
  const py = (i: number): number => outline[2 * (((i % n) + n) % n) + 1]!;
  const wt = (i: number): number => o.weights?.[((i % n) + n) % n] ?? 1;
  // 外法线朝哪边：按有向面积判断轮廓是哪个方向绕的。
  let area = 0;
  for (let i = 0; i < n; i++) area += px(i) * py(i + 1) - px(i + 1) * py(i);
  const sgn = area > 0 ? 1 : -1;
  // 每个顶点的法线：前后两条边的法线平均（拐角处不劈开）。
  const nx: number[] = [];
  const ny: number[] = [];
  for (let i = 0; i < n; i++) {
    const ax = px(i) - px(i - 1);
    const ay = py(i) - py(i - 1);
    const bx = px(i + 1) - px(i);
    const by = py(i + 1) - py(i);
    const la = Math.hypot(ax, ay) || 1;
    const lb = Math.hypot(bx, by) || 1;
    const x = (ay / la + by / lb) * sgn;
    const y = (-ax / la - bx / lb) * sgn;
    const l = Math.hypot(x, y) || 1;
    nx.push(x / l);
    ny.push(y / l);
  }
  // 按弧长重新取点：每簇 8 个点，沿法线推出去，再顺着毛流倒一点。
  const L = perimeter(outline);
  const per = 8;
  const total = o.teeth * per;
  const out: number[] = [];
  let i = 0;
  let s0 = 0;
  let seg = Math.hypot(px(1) - px(0), py(1) - py(0));
  for (let k = 0; k < total; k++) {
    const s = (k / total) * L;
    while (s0 + seg < s && i < n - 1) {
      s0 += seg;
      i++;
      seg = Math.hypot(px(i + 1) - px(i), py(i + 1) - py(i));
    }
    const t = seg > 0 ? Math.min(1, Math.max(0, (s - s0) / seg)) : 0;
    const x = px(i) + (px(i + 1) - px(i)) * t;
    const y = py(i) + (py(i + 1) - py(i)) * t;
    let ex = nx[i]! + (nx[(i + 1) % n]! - nx[i]!) * t;
    let ey = ny[i]! + (ny[(i + 1) % n]! - ny[i]!) * t;
    const el = Math.hypot(ex, ey) || 1;
    ex /= el;
    ey /= el;
    const w = wt(i) + (wt(i + 1) - wt(i)) * t;
    const u = (k % per) / per;
    const h = amp * w * jitter(Math.floor(k / per)) * tuft(u);
    const d = swell * w + h;
    // 毛流：簇越高的地方往毛流的方向倒得越多（只取沿轮廓的那一份，不往里缩）。
    let lx = 0;
    let ly = 0;
    if (o.flow) {
      const along = o.flow[0] * -ey + o.flow[1] * ex;
      lx = -ey * along * h * 0.6;
      ly = ex * along * h * 0.6;
    }
    out.push(x + ex * d + lx, y + ey * d + ly);
  }
  return out;
}
