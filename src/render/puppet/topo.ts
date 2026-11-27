import type { P, Shape } from './fit';

/**
 * 纸偶零件的拓扑（docs/research/part-topology.md）：每类零件一个固定的拓扑 + 几个控制量，典型形态是控制量的预设。
 * 坐标：零件自己的坐标，转轴（铆钉）在原点、骨头朝 +x，y 朝下（上沿是负的 y）。单位随调用方（成品图的像素）。
 */

/** 骨段上的一个站点：位置 t（0–1，沿骨头），上沿、下沿的半宽。 */
export interface Station {
  t: number;
  up: number;
  down: number;
}

/** 单调的三次插值（Fritsch–Carlson），站点之间不过冲，轮廓不会鼓出奇怪的包。 */
function monotone(xs: readonly number[], ys: readonly number[]): (x: number) => number {
  const n = xs.length;
  if (n === 1) return () => ys[0]!;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1]! - ys[i]!) / Math.max(1e-9, xs[i + 1]! - xs[i]!));
  const m: number[] = [d[0]!];
  for (let i = 1; i < n - 1; i++) m.push(d[i - 1]! * d[i]! <= 0 ? 0 : (d[i - 1]! + d[i]!) / 2);
  m.push(d[n - 2]!);
  return (x) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]!) i++;
    const h = xs[i + 1]! - xs[i]!;
    const t = Math.min(1, Math.max(0, (x - xs[i]!) / Math.max(1e-9, h)));
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!;
  };
}

export interface SegmentOpts {
  /** 背深腹浅：下沿往里一条浅色带，占下半宽的比例（0 不要）。 */
  pale?: number;
  /** 条纹的间距（0 不要）。 */
  stripes?: number;
  /** 两头是不是搭接的圆头（转轴处的铆钉在圆心）。 */
  capA?: boolean;
  capB?: boolean;
}

/**
 * 带站点的骨段（颈的一节、臀片、胸片、腰片、大腿、小腿、尾节……）：
 * 轮廓是平滑地穿过各站点上沿、下沿的曲线，两头是圆头（圆心在骨头的两端，半径是那一头的平均半宽）。
 */
export function segmentShape(L: number, stations: readonly Station[], o: SegmentOpts = {}): Shape {
  const st = [...stations].sort((a, b) => a.t - b.t);
  const ts = st.map((s) => s.t * L);
  const up = monotone(ts, st.map((s) => s.up));
  const dn = monotone(ts, st.map((s) => s.down));
  const N = 24;
  const top: P[] = [];
  const bot: P[] = [];
  for (let i = 0; i <= N; i++) {
    const x = (L * i) / N;
    top.push([x, -up(x)]);
    bot.push([x, dn(x)]);
  }
  const outline: number[] = [];
  const cap = (cx: number, a: number, b: number, from: number, to: number): void => {
    // 圆头：从上沿 (cx, −a) 绕到下沿 (cx, b)，圆心在两者中点，往骨头外面鼓。
    const cy = (b - a) / 2;
    const r = (a + b) / 2;
    const K = 10;
    for (let k = 1; k < K; k++) {
      const ang = from + ((to - from) * k) / K;
      outline.push(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
    }
  };
  for (const q of top) outline.push(q[0], q[1]);
  if (o.capB !== false) cap(L, up(L), dn(L), -Math.PI / 2, Math.PI / 2);
  for (let i = bot.length - 1; i >= 0; i--) outline.push(bot[i]![0], bot[i]![1]);
  if (o.capA !== false) cap(0, up(0), dn(0), Math.PI / 2, (3 * Math.PI) / 2);
  const pale: number[][] = [];
  if (o.pale && o.pale > 0) {
    const band: number[] = [];
    for (const q of bot) band.push(q[0], q[1] * 0.985);
    for (let i = bot.length - 1; i >= 0; i--) {
      const x = bot[i]![0];
      band.push(x, bot[i]![1] - (dn(x) + up(x)) * o.pale * Math.sin((Math.PI * (i + 0.5)) / (N + 1)) ** 0.5);
    }
    pale.push(band);
  }
  const stripe: number[][] = [];
  if (o.stripes && o.stripes > 0) {
    const n = Math.max(0, Math.floor(L / o.stripes));
    for (let k = 0; k < n; k++) {
      const x = ((k + 0.5) * L) / n;
      const w = Math.min(o.stripes * 0.22, (up(x) + dn(x)) * 0.25);
      const depth = (up(x) + dn(x)) * 0.55;
      stripe.push([x - w, -up(x) * 0.99, x + w, -up(x) * 0.99, x - w * 0.15, -up(x) + depth, x - w * 0.55, -up(x) + depth * 0.95]);
    }
  }
  return { outline, stripe, pale };
}

/** 头的控制量（docs/research/part-topology.md 第三节）。长度都按头骨半径 R 算。 */
export interface HeadForm {
  R: number;
  /** 吻长 ÷ R。 */
  snout: number;
  /** 吻根的高 ÷ R、吻端的高 ÷ 吻根的高。 */
  rootH: number;
  tipH: number;
  /** 吻端：0 圆钝 – 1 尖。 */
  tip: number;
  /** 鼻梁：−1 凹（波斯猫、鹿）、0 直、1 凸（马、羊的罗马鼻）。 */
  bridge: number;
  /** 下颌厚 ÷ R。 */
  jaw: number;
}

/** 典型形态（预设）。 */
export const HEAD_PRESETS: Record<string, Omit<HeadForm, 'R'>> = {
  猫: { snout: 0.45, rootH: 1.05, tipH: 0.7, tip: 0.4, bridge: 0, jaw: 0.3 },
  扁脸: { snout: 0.15, rootH: 1.1, tipH: 0.9, tip: 0.1, bridge: -0.3, jaw: 0.3 },
  狐: { snout: 0.95, rootH: 0.85, tipH: 0.45, tip: 0.8, bridge: 0, jaw: 0.35 },
  熊: { snout: 0.75, rootH: 1.2, tipH: 0.7, tip: 0.1, bridge: 0, jaw: 0.5 },
  马鹿: { snout: 1.6, rootH: 1.05, tipH: 0.55, tip: 0.3, bridge: 0.3, jaw: 0.4 },
  食蚁兽: { snout: 3.5, rootH: 0.55, tipH: 0.85, tip: 0.2, bridge: 0, jaw: 0.1 },
  鼠: { snout: 0.8, rootH: 0.85, tipH: 0.4, tip: 0.9, bridge: 0.1, jaw: 0.25 },
};

export interface HeadCut {
  head: Shape;
  jaw: Shape;
  /** 下颌的转轴（头片的坐标）。 */
  jawPivot: P;
  /** 深色的小件（眼、鼻垫），头片的坐标。 */
  ink: number[][];
  /** 头骨的圆心（耳、角沿头骨的轮廓滑）。 */
  skull: P;
  /** 吻端（鼻尖）。 */
  nose: P;
}

/**
 * 头：头骨是一个圆（圆心 c，半径 R），转轴（颈的铆钉）在头骨的后下方；
 * 吻从头骨前上方的"额"往前伸，背侧的线按鼻梁的弯拱起或凹下，吻端按圆尖收口；腹侧的线回到下巴、喉。
 * 下颌是另一片：从下颌关节沿吻的下沿往前，一条渐细的骨段。眼睛钉在头骨上，不随吻变。
 */
export function headShape(f: HeadForm): HeadCut {
  const R = f.R;
  const c: P = [0.55 * R, -0.45 * R];
  const Ls = f.snout * R;
  const hRoot = f.rootH * R;
  const hTip = hRoot * f.tipH;
  // 吻的中线：从头骨前缘、比圆心略低的地方，水平往前。
  const yMid = c[1] + 0.2 * R;
  const x0 = c[0] + 0.75 * R;
  const xTip = x0 + Ls;
  const topAt = (u: number): number => {
    // u：0 吻根 → 1 吻端。背侧的线：从吻根的高线性收到吻端的高，鼻梁的弯加一个正弦的拱。
    const h = hRoot + (hTip - hRoot) * u;
    return yMid - h / 2 - f.bridge * 0.18 * R * Math.sin(Math.PI * u) * Math.min(1, f.snout);
  };
  const botAt = (u: number): number => yMid + (hRoot + (hTip - hRoot) * u) / 2;
  const outline: number[] = [];
  // 1. 额（头骨圆周 −35°）往后，经头顶、后脑，到后下方（+115°）。
  const a0 = (-35 * Math.PI) / 180;
  const a1 = (-245 * Math.PI) / 180;
  // 头骨是横着的椭圆（脑颅 + 两颊），比圆更像兽的头。
  const RX = 1.08 * R;
  const RY = 0.9 * R;
  for (let k = 0; k <= 20; k++) {
    const a = a0 + ((a1 - a0) * k) / 20;
    outline.push(c[0] + Math.cos(a) * RX, c[1] + Math.sin(a) * RY);
  }
  // 2. 喉、下巴：从后下方到吻根的下沿。
  const chin: P = [x0 - 0.1 * R, botAt(0) + 0.06 * R];
  outline.push(c[0] + 0.1 * R, c[1] + RY * 0.98, chin[0], chin[1]);
  // 3. 吻的腹侧线（吻根 → 吻端）。
  const N = 12;
  for (let i = 1; i <= N; i++) {
    const u = i / N;
    outline.push(x0 + Ls * u, botAt(u));
  }
  // 4. 吻端：圆钝是一个竖着的半圆，尖是往前伸出一个尖。
  const tipC = (topAt(1) + botAt(1)) / 2;
  const hr = (botAt(1) - topAt(1)) / 2;
  const pointy = f.tip;
  for (let k = 1; k < 10; k++) {
    const a = Math.PI / 2 - (Math.PI * k) / 10;
    const ex = hr * (0.6 + 1.2 * pointy);
    const sharp = Math.pow(Math.abs(Math.cos(a)), 1 + 2 * pointy);
    outline.push(xTip + Math.cos(a) * ex * sharp, tipC + Math.sin(a) * hr);
  }
  // 5. 吻的背侧线（吻端 → 吻根），接回额。
  for (let i = N; i >= 1; i--) {
    const u = i / N;
    outline.push(x0 + Ls * u, topAt(u));
  }
  // 吻根的背侧接到额：一个平滑的"止"（stop，额和鼻梁的转折）。
  outline.push(x0 - 0.05 * R, topAt(0) - 0.02 * R);
  const nose: P = [xTip + hr * (0.6 + 1.2 * pointy) * 0.9, tipC - hr * 0.35];
  // 色区：下巴、喉、吻的腹侧一条浅色。
  const pale: number[] = [chin[0] - 0.25 * R, chin[1] + 0.05 * R];
  for (let i = 0; i <= N; i++) pale.push(x0 + Ls * (i / N), botAt(i / N) * 0.985 + yMid * 0.015);
  for (let i = N; i >= 0; i--) pale.push(x0 + Ls * (i / N), botAt(i / N) - (botAt(i / N) - topAt(i / N)) * 0.2);
  const stripe: number[][] = [
    // 额上两道短纹（猫、虎都有）。
    [c[0] - 0.1 * R, c[1] - 0.98 * R, c[0] + 0.05 * R, c[1] - 0.99 * R, c[0] + 0.02 * R, c[1] - 0.6 * R],
    [c[0] + 0.2 * R, c[1] - 0.95 * R, c[0] + 0.33 * R, c[1] - 0.92 * R, c[0] + 0.24 * R, c[1] - 0.6 * R],
  ];
  // 眼：头骨前上方，跟头骨走。鼻垫：吻端上方一小块。
  const eye = ellipse(c[0] + 0.62 * R, c[1] - 0.12 * R, 0.13 * R, 0.11 * R, 12);
  const pad = ellipse(nose[0] - hr * 0.15, nose[1], hr * 0.32, hr * 0.24, 10);
  // 下颌：从关节（头骨下方）沿吻的下沿往前，到吻端前面一点。
  const jawPivot: P = [c[0] + 0.15 * R, c[1] + 0.75 * R];
  const jawLen = xTip - jawPivot[0] - hr * 0.2;
  const jt = Math.max(0.04, f.jaw) * R;
  const jaw = segmentShape(jawLen, [
    { t: 0, up: jt * 0.6, down: jt * 0.9 },
    { t: 0.5, up: jt * 0.5, down: jt * 0.7 },
    { t: 1, up: jt * 0.35, down: jt * 0.4 },
  ], { pale: 0.6 });
  // 下颌的骨头要从关节斜到吻端下沿：零件坐标里沿 +x 剪，摆的时候转过去（见 jawAngle）。
  return { head: { outline, stripe, pale: [pale] }, jaw, jawPivot, ink: [eye, pad], skull: c, nose };
}

/** 下颌从关节指向吻端下沿的角度（头片的坐标）。 */
export function jawAngle(f: HeadForm, cut: HeadCut): number {
  const target: P = [cut.nose[0] - 0.1 * f.R, cut.nose[1] + f.R * f.rootH * f.tipH * 0.6];
  return Math.atan2(target[1] - cut.jawPivot[1], target[0] - cut.jawPivot[0]);
}

function ellipse(cx: number, cy: number, rx: number, ry: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(cx + Math.cos((i / n) * Math.PI * 2) * rx, cy + Math.sin((i / n) * Math.PI * 2) * ry);
  return out;
}

/** 骨段的典型形态（预设）：每种零件几档。宽度按骨长的比例给。 */
export const SEGMENT_PRESETS: Record<string, Record<string, Array<[number, number, number]>>> = {
  颈: {
    细颈: [[0, 0.22, 0.22], [0.5, 0.16, 0.18], [1, 0.15, 0.15]],
    扁颈: [[0, 0.3, 0.32], [0.5, 0.22, 0.3], [1, 0.18, 0.2]],
    粗颈: [[0, 0.45, 0.45], [0.5, 0.38, 0.4], [1, 0.3, 0.3]],
  },
  大腿: {
    猫: [[0, 0.3, 0.3], [0.35, 0.28, 0.33], [1, 0.12, 0.12]],
    马: [[0, 0.32, 0.36], [0.4, 0.3, 0.3], [1, 0.11, 0.11]],
    熊: [[0, 0.36, 0.36], [0.4, 0.34, 0.34], [1, 0.22, 0.22]],
  },
  小腿: {
    细: [[0, 0.1, 0.1], [0.5, 0.08, 0.07], [1, 0.06, 0.06]],
    一般: [[0, 0.13, 0.13], [0.5, 0.11, 0.1], [1, 0.08, 0.08]],
    柱状: [[0, 0.2, 0.2], [0.5, 0.19, 0.19], [1, 0.18, 0.18]],
  },
  尾节: {
    光尾: [[0, 0.1, 0.1], [1, 0.05, 0.05]],
    一般: [[0, 0.16, 0.16], [1, 0.12, 0.12]],
    蓬尾: [[0, 0.3, 0.3], [0.5, 0.42, 0.42], [1, 0.25, 0.25]],
  },
  胸片: {
    浅胸: [[0, 0.32, 0.3], [0.6, 0.35, 0.3], [1, 0.3, 0.25]],
    深胸: [[0, 0.32, 0.45], [0.6, 0.36, 0.55], [1, 0.3, 0.4]],
    肩峰: [[0, 0.35, 0.4], [0.5, 0.6, 0.45], [1, 0.4, 0.35]],
  },
};
