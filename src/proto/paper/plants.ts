import type { LeafKit, Rgb } from './leaves';
import { hash2 } from './noise';

/**
 * 立起来的植物（始终正对镜头的纸片，像 SketchUp 里的"面向相机"组件）。不是一片片叶子拼，而是景观表现图的画法：
 * - 草丛：一束细长的草叶，每根叶子从根部的暗橄榄绿渐变到叶梢的枯草黄，后排暗、前排亮；
 * - 灌丛：两三层整块的剪纸剪影叠起来——暗的底、中间一层、左上一块亮的顶，上层往下层落一点软影子；
 *   剪影的外轮廓用 P8 叶片剪出锯齿和圆齿，里面是整块的纸（带纸纹），不是一片片叶子。
 * 光源统一在左上。都在启动时烤成贴图，运行时只是普通的贴图。
 */

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];
const css = (c: Rgb): string => `rgb(${c.map((v) => Math.max(0, Math.min(255, Math.round(v)))).join(',')})`;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** 纸纹：纤维状的细小明暗（±5%），只作用在不透明的地方。 */
function grain(c: HTMLCanvasElement, seed: number): void {
  const ctx = c.getContext('2d')!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const x = (i / 4) % c.width;
    const y = Math.floor(i / 4 / c.width);
    const k = 1 + (hash2(x >> 1, y, seed) - 0.5) * 0.07 + (hash2(x, y >> 2, seed + 3) - 0.5) * 0.04;
    d[i] = d[i]! * k;
    d[i + 1] = d[i + 1]! * k;
    d[i + 2] = d[i + 2]! * k;
  }
  ctx.putImageData(img, 0, 0);
}

// ---------- 草丛 ----------

const BLADE_BASE: Rgb = [62, 74, 30];
const BLADE_MID: Rgb[] = [
  [142, 150, 60],
  [160, 160, 66],
  [126, 140, 56],
  [176, 166, 76],
];
const BLADE_TIP: Rgb[] = [
  [226, 202, 128],
  [214, 186, 108],
  [196, 188, 110],
];
const STRAW_MID: Rgb = [184, 152, 86];

/** 一根草叶：根部在 (x0, y0)，朝 angle（0 = 朝上），长 len，根部宽 width，叶梢往外垂 droop（占长度的比例，带符号）。 */
function blade(ctx: CanvasRenderingContext2D, x0: number, y0: number, angle: number, len: number, width: number, droop: number, base: Rgb, mid: Rgb, tip: Rgb): void {
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const nx = -dy;
  const ny = dx;
  const cx = x0 + dx * len * 0.6;
  const cy = y0 + dy * len * 0.6;
  const tx = x0 + dx * len + droop * len * 0.45;
  const ty = y0 + dy * len + Math.abs(droop) * len * 0.4;
  const hw = width / 2;
  const g = ctx.createLinearGradient(x0, y0, tx, ty);
  g.addColorStop(0, css(base));
  g.addColorStop(0.45, css(mid));
  g.addColorStop(1, css(tip));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0 - nx * hw, y0 - ny * hw);
  ctx.quadraticCurveTo(cx - nx * hw * 0.6, cy - ny * hw * 0.6, tx, ty);
  ctx.quadraticCurveTo(cx + nx * hw * 0.6, cy + ny * hw * 0.6, x0 + nx * hw, y0 + ny * hw);
  ctx.closePath();
  ctx.fill();
}

/**
 * 一丛草（宽 width 像素，高约 1.2 倍）：几十到一百多根细叶，像喷泉一样散开，外圈的叶梢往外垂。
 * 叶数随植被量 b（0–1），枯黄程度随 dry（0–1）。画布底边中点是草丛的根。
 */
export function bakeTussock(b: number, dry: number, seed: number, width: number, kit?: LeafKit, flowers = false): HTMLCanvasElement {
  const W = width;
  const H = width * 1.2;
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  const bx = W / 2;
  const by = H - 2;
  const r = (i: number, k: number): number => hash2(i * 7 + k, seed, 4242);
  const n = Math.round(30 + 90 * b);
  const blades = Array.from({ length: n }, (_, i) => {
    const u = r(i, 1) * 2 - 1;
    return {
      i,
      u,
      back: r(i, 2) < 0.45,
      angle: u * 0.8 + (r(i, 3) - 0.5) * 0.25,
      len: H * (0.6 + 0.38 * r(i, 4)) * (1 - 0.3 * u * u),
    };
  });
  // 后排先画；同一排里外圈先画，正中最后画。
  blades.sort((p, q) => Number(q.back) - Number(p.back) || Math.abs(q.u) - Math.abs(p.u));
  for (const bl of blades) {
    const mid0 = BLADE_MID[Math.floor(r(bl.i, 5) * BLADE_MID.length)]!;
    const mid = mix(mid0, STRAW_MID, Math.min(1, dry * (0.6 + 0.6 * r(bl.i, 6))));
    const tip = mix(BLADE_TIP[Math.floor(r(bl.i, 7) * BLADE_TIP.length)]!, mid0, r(bl.i, 8) < 0.3 && dry < 0.5 ? 0.6 : 0);
    // 往左（光源一侧）倒的叶子亮一点；后排整体暗。
    const k = (bl.back ? 0.72 : 1) * (1 - 0.12 * bl.u);
    blade(
      ctx,
      bx + bl.u * W * 0.1 + (r(bl.i, 9) - 0.5) * W * 0.06,
      by,
      bl.angle,
      bl.len,
      W * (0.022 + 0.014 * r(bl.i, 10)),
      Math.sign(bl.u) * (0.1 + 0.5 * Math.abs(bl.u)) * r(bl.i, 11),
      shade(BLADE_BASE, k),
      shade(mid, k),
      shade(tip, k),
    );
  }
  if (flowers && kit) {
    const m = 3 + Math.floor(r(99, 1) * 3);
    const cols: Rgb[] = [
      [250, 246, 236],
      [240, 204, 80],
    ];
    for (let j = 0; j < m; j++) {
      const fx = bx + (r(j, 20) - 0.5) * W * 0.6;
      const fy = by - H * (0.45 + 0.35 * r(j, 21));
      kit.draw(ctx, 'small', r(j, 23) < 0.5 ? 3 : 5, cols[j % 2]!, fx, fy + W * 0.05, 0, W * 0.1);
    }
  }
  grain(c, seed);
  return c;
}

// ---------- 灌丛 ----------

interface Blob {
  x: number;
  y: number;
  r: number;
}

/** 一块剪影（白色）：几个圆叠成的团，外沿一圈用 P8 叶片剪出锯齿、圆齿。 */
function silhouette(W: number, H: number, blobs: Blob[], kit: LeafKit, seed: number): HTMLCanvasElement {
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  const cats = ['broad', 'lobed', 'small', 'broad'] as const;
  blobs.forEach((bl, i) => {
    ctx.beginPath();
    ctx.arc(bl.x, bl.y, bl.r, 0, Math.PI * 2);
    ctx.fill();
    // 上半圈朝外贴几片叶子，叶柄埋在团里。
    const m = 7;
    for (let j = 0; j < m; j++) {
      const a = -Math.PI * 0.62 + (j / (m - 1)) * Math.PI * 1.24 + (hash2(i, j, seed) - 0.5) * 0.3;
      const px = bl.x + Math.sin(a) * bl.r * 0.78;
      const py = bl.y - Math.cos(a) * bl.r * 0.78;
      kit.draw(ctx, cats[(i + j) % cats.length]!, (i * 3 + j) % 6, [255, 255, 255], px, py, a, bl.r * (0.5 + 0.2 * hash2(j, i, seed + 1)));
    }
  });
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillRect(0, 0, W, H);
  return c;
}

function tinted(sil: HTMLCanvasElement, col: Rgb): HTMLCanvasElement {
  const c = canvas(sil.width, sil.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(sil, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = css(col);
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

const CANOPY: Rgb[][] = [
  // 每组：底、中、顶
  [
    [40, 70, 44],
    [70, 104, 56],
    [118, 146, 72],
  ],
  [
    [46, 74, 40],
    [82, 112, 54],
    [132, 154, 74],
  ],
  [
    [38, 66, 52],
    [64, 98, 66],
    [108, 140, 84],
  ],
];
const CANOPY_DRY: Rgb = [112, 104, 60];
const TWIG: Rgb = [96, 72, 52];

/**
 * 一丛灌木（宽 width 像素，高约 0.85 倍）：三层整块剪影叠成的圆顶。
 * 植被量 a（0–1）低时团小、团少，中间露出空隙和枝条，颜色往枯橄榄色偏。
 */
export function bakeShrub(kit: LeafKit, a: number, seed: number, width: number): HTMLCanvasElement {
  const W = width;
  const H = width * 0.85;
  const cx = W / 2;
  const by = H - 3;
  const r = (i: number, k: number): number => hash2(i * 11 + k, seed, 777);
  const pal = CANOPY[Math.floor(r(0, 0) * CANOPY.length)]!.map((col) => mix(col, CANOPY_DRY, (1 - a) * 0.45));
  const n = Math.round(5 + 6 * a);
  const blobs: Blob[] = [];
  for (let i = 0; i < n; i++) {
    const th = (r(i, 1) - 0.5) * Math.PI * 0.9;
    const rad = Math.sqrt(r(i, 2));
    const rr = W * (0.11 + 0.08 * r(i, 3)) * (0.75 + 0.25 * a);
    blobs.push({ x: cx + Math.sin(th) * W * 0.3 * rad, y: by - rr - Math.cos(th) * H * 0.42 * rad, r: rr });
  }
  // 底下一排压住，让圆顶的底边平一点。
  for (let i = 0; i < 3; i++) {
    const rr = W * 0.12 * (0.75 + 0.25 * a);
    blobs.push({ x: cx + (i - 1) * W * 0.24, y: by - rr * 0.95, r: rr });
  }
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  // 枝条：只在植被量低、团之间有空隙时画，从空隙里露出来。
  ctx.lineCap = 'round';
  ctx.strokeStyle = css(TWIG);
  ctx.lineWidth = W * 0.022;
  for (let i = 0; i < (a < 0.5 ? 5 : 0); i++) {
    const ang = (r(i, 4) - 0.5) * 1.6;
    const len = H * (0.35 + 0.3 * r(i, 5));
    ctx.beginPath();
    ctx.moveTo(cx, by);
    ctx.quadraticCurveTo(cx + Math.sin(ang) * len * 0.3, by - len * 0.5, cx + Math.sin(ang) * len, by - Math.cos(ang) * len);
    ctx.stroke();
  }
  const base = silhouette(W, H, blobs, kit, seed);
  // 中层：同样的团缩小、往左上挪；顶层：只取左上的几个团，再缩小、再往左上挪。
  const shrink = (bs: Blob[], k: number, dx: number, dy: number): Blob[] => bs.map((bl) => ({ x: cx + (bl.x - cx) * k + dx, y: by + (bl.y - by) * k + dy, r: bl.r * k }));
  const midB = shrink(blobs.slice(0, n), 0.82, -W * 0.04, -H * 0.06);
  const topB = shrink(
    [...blobs.slice(0, n)].sort((p, q) => p.x + p.y - (q.x + q.y)).slice(0, Math.max(2, Math.ceil(n * 0.4))),
    0.62,
    -W * 0.07,
    -H * 0.1,
  );
  ctx.drawImage(tinted(base, pal[0]!), 0, 0);
  for (const [bs, col, s] of [
    [midB, pal[1]!, seed + 5],
    [topB, pal[2]!, seed + 9],
  ] as const) {
    const sil = silhouette(W, H, bs, kit, s);
    // 上层只落在下层上（source-atop），先往右下落一点软影子，再铺本色。
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.filter = `blur(${Math.max(1, W * 0.012)}px)`;
    ctx.globalAlpha = 0.45;
    ctx.drawImage(tinted(sil, [12, 22, 10]), W * 0.015, H * 0.025);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.drawImage(tinted(sil, col), 0, 0);
    ctx.restore();
  }
  grain(c, seed);
  return c;
}
