import type { CutPart, Dye } from './cutout';
import type { P, Shape } from './fit';

/**
 * 代码剪的零件（纸偶 v2，2026-11-27）：成品图（猫）身上没有的东西——长颈、角——拉伸猫的零件做不出来，
 * 就按参数直接剪一片纸，和成品图的零件用同一套画法（白边、影子、纸纹、铆钉、三档颜色），挂在同一副骨架上。
 * 这里只算形状（零件自己的坐标：转轴在原点、骨头朝 +x，y 朝下，单位是成品图的像素）。
 */

/** 角质（牛羊的角鞘、蹄）的颜色：象牙白的底、深一档的环纹、浅色的尖。 */
export const KERATIN: Dye = { main: 0xc4ad86, stripe: 0x8a7350, pale: 0xe9dcc0 };
/** 犀牛角（压实的角蛋白纤维，没有骨芯，也没有环纹）：深灰褐。 */
export const RHINO_HORN: Dye = { main: 0x6f655a, stripe: 0x5a5148, pale: 0x8b8173 };

/** 新加的零件：插进成品图的零件表里（z 决定前后）。形状在 build 里按身体算好再给。 */
export function extraPart(id: string, parent: string, z: number, pivot: P, dye?: Dye): CutPart {
  return { id, parent, z, pivot, pivotEstimated: true, angle: 0, lapR: 0, outline: [0, 0, 1, 0, 0, 1], stripe: [], pale: [], ...(dye ? { dye } : {}) };
}

/**
 * 颈：从颈根（原点）沿 +x 到头的铆钉（len），根部半宽 wb、上端半宽 wt，两头是圆的搭接片（铆钉在圆心）。
 * y > 0 一侧是喉咙（颈朝前上方伸出时，零件的 +y 朝前下方）。
 * 色区：背侧一道道楔形的条纹（和成品图的猫一样从背往下变窄），喉咙一条浅色。
 * stripes：条纹的大约间距（像素）；0 就不画条纹。
 */
export function neckShape(len: number, wb: number, wt: number, stripes: number): Shape {
  const w = (x: number): number => wb + (wt - wb) * Math.min(1, Math.max(0, x / Math.max(1e-6, len)));
  const out: number[] = [];
  const N = 14;
  // 上沿（背侧，y < 0）从根到顶。
  for (let i = 0; i <= N; i++) {
    const x = (len * i) / N;
    out.push(x, -w(x));
  }
  // 顶端的半圆（绕到喉咙一侧）。
  for (let i = 1; i < 12; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 12;
    out.push(len + Math.cos(a) * wt, Math.sin(a) * wt);
  }
  // 下沿（喉咙）从顶回到根，中段微微鼓出一点（喉咙不是直线）。
  for (let i = N; i >= 0; i--) {
    const x = (len * i) / N;
    const t = i / N;
    out.push(x, w(x) * (1 + 0.06 * Math.sin(Math.PI * t)));
  }
  // 根部的半圆。
  for (let i = 1; i < 12; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / 12;
    out.push(Math.cos(a) * wb, Math.sin(a) * wb);
  }
  const pale: number[][] = [];
  // 喉咙的浅色：贴着下沿，宽度是半宽的四成，两头收尖。
  const throat: number[] = [];
  for (let i = 0; i <= N; i++) {
    const x = (len * i) / N;
    throat.push(x, w(x) * (1 + 0.06 * Math.sin((Math.PI * i) / N)) * 0.98);
  }
  for (let i = N; i >= 0; i--) {
    const x = (len * i) / N;
    const t = i / N;
    throat.push(x, w(x) * (0.98 - 0.4 * Math.sin(Math.PI * Math.min(1, t * 1.15))));
  }
  pale.push(throat);
  const stripe: number[][] = [];
  if (stripes > 0 && len > stripes * 0.8) {
    const n = Math.max(1, Math.floor(len / stripes));
    for (let k = 0; k < n; k++) {
      const x0 = ((k + 0.35) * len) / n;
      const ww = w(x0);
      const half = Math.min(stripes * 0.22, ww * 0.45);
      // 楔形：背侧宽，往喉咙方向收尖，略往后斜。
      stripe.push([x0 - half, -ww * 0.99, x0 + half, -ww * 0.99, x0 - half * 0.2, ww * 0.25, x0 - half * 0.6, ww * 0.2]);
    }
  }
  return { outline: out, stripe, pale };
}

/**
 * 角：从角根（原点）沿 +x 长出去，长 len，根部半宽 w0；curve（0–1）让角往 −y 一侧弯（0 直，1 卷将近一圈）。
 * 色区：根部的几道环纹（角鞘的生长纹），尖端浅色。
 */
export function hornShape(len: number, w0: number, curve: number, rings = true): Shape {
  const N = 24;
  // 中线：曲率沿长度递增（κ ∝ 1/(1 − 0.8·s/len)，近似对数螺旋：大角羊的角根部缓、越往尖卷得越紧），总转角 = curve · 1.7π。
  const turn = curve * 1.7 * Math.PI;
  const kappa = (t: number): number => 1 / (1 - 0.8 * t);
  let ksum = 0;
  for (let i = 0; i < N; i++) ksum += kappa((i + 0.5) / N);
  const spine: P[] = [];
  const tang: number[] = [];
  let x = 0;
  let y = 0;
  let a = 0;
  const step = len / N;
  for (let i = 0; i <= N; i++) {
    spine.push([x, y]);
    tang.push(a);
    if (i < N) a -= (turn * kappa((i + 0.5) / N)) / ksum;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
  }
  // 半宽从根到尖按 (1 − t)^1.3 收（审核 r1：根部粗、尖端细）。
  const half = (i: number): number => w0 * Math.pow(1 - i / N, 1.3) + w0 * 0.05;
  const left: P[] = [];
  const right: P[] = [];
  spine.forEach(([px, py], i) => {
    const n: P = [-Math.sin(tang[i]!), Math.cos(tang[i]!)];
    left.push([px - n[0] * half(i), py - n[1] * half(i)]);
    right.push([px + n[0] * half(i), py + n[1] * half(i)]);
  });
  const outline: number[] = [];
  // 根部是平的（插进头里，被头盖住一截）。
  for (const q of left) outline.push(q[0], q[1]);
  for (let i = right.length - 1; i >= 0; i--) outline.push(right[i]![0], right[i]![1]);
  const stripe: number[][] = [];
  const nRings = rings ? Math.max(1, Math.round(len / (w0 * 0.9))) : 0;
  for (let r = 1; r <= Math.min(nRings, 7); r++) {
    const i = Math.min(N - 3, Math.round((r * N * 0.6) / (Math.min(nRings, 7) + 1)));
    const j = i + 1;
    stripe.push([left[i]![0], left[i]![1], left[j]![0], left[j]![1], right[j]![0], right[j]![1], right[i]![0], right[i]![1]]);
  }
  const tipFrom = Math.round(N * 0.78);
  const pale: number[] = [];
  for (let i = tipFrom; i <= N; i++) pale.push(left[i]![0], left[i]![1]);
  for (let i = N; i >= tipFrom; i--) pale.push(right[i]![0], right[i]![1]);
  return { outline, stripe, pale: [pale] };
}

/**
 * 腰片：插在臀片和胸片之间（拉长的身体），从原点（臀片的铆钉）沿 +x 到 len（胸片的铆钉）。
 * top、bot 是上下沿（零件坐标，y 朝下，top < 0 < bot），两头是圆的搭接。色区：背上一道道楔形条纹、肚子一条浅色。
 */
export function waistShape(len: number, top: number, bot: number, stripes: number): Shape {
  const h = (bot - top) / 2;
  const cy = (top + bot) / 2;
  const outline: number[] = [];
  const N = 10;
  for (let i = 0; i <= N; i++) outline.push((len * i) / N, top);
  for (let i = 1; i < 12; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / 12;
    outline.push(len + Math.cos(a) * h * 0.35, cy + Math.sin(a) * h);
  }
  for (let i = N; i >= 0; i--) outline.push((len * i) / N, bot);
  for (let i = 1; i < 12; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / 12;
    outline.push(Math.cos(a) * h * 0.35, cy + Math.sin(a) * h);
  }
  const stripe: number[][] = [];
  const n = Math.max(0, Math.floor(len / stripes));
  for (let k = 0; k < n; k++) {
    const x0 = ((k + 0.5) * len) / n;
    const half = stripes * 0.18;
    stripe.push([x0 - half, top + 1, x0 + half, top + 1, x0 - half * 0.1, top + h * 1.1, x0 - half * 0.5, top + h * 1.05]);
  }
  const pale = [[0, bot - h * 0.32, len, bot - h * 0.28, len, bot - 1, 0, bot - 1]];
  return { outline, stripe, pale };
}

/**
 * 蹄：原点在趾尖，+x 是掌（跖）骨的方向（从踝指向趾尖），蹄往回包住 len 那么长，半宽 w。
 * 蹄底平、蹄尖略圆；一条浅一点的蹄冠线。
 */
export function hoofShape(len: number, w: number): Shape {
  const outline = [-len, -w * 0.85, -len * 0.15, -w * 1.05, w * 0.18, -w * 0.7, w * 0.25, 0, w * 0.18, w * 0.75, -len * 0.1, w * 1.05, -len, w * 0.85, -len * 1.08, 0];
  const pale = [[-len * 1.0, -w * 0.82, -len * 0.82, -w * 0.9, -len * 0.82, w * 0.9, -len * 1.0, w * 0.82]];
  return { outline, stripe: [], pale };
}
