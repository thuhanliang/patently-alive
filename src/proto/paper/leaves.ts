import { hash2 } from './noise';

/**
 * 叶片级的植被：草丛、灌丛由一片片叶子在代码里拼出来。
 * - 叶与叶之间是真正的镂空（不是素材里烤进去的深色）；
 * - 明暗由代码按同一个光源（左上方）统一给：朝左上、靠前的叶子亮，靠后的暗；
 * - 疏密和枯黄程度跟着推演的植被量走。
 * 叶片形状现在是代码画的占位（会比最终素材规整）；P8 叶片素材表到了以后换成真图，其余不变。
 */

export type Rgb = [number, number, number];

/** 一片叶子：白色、带纸纹、叶尖朝上、叶柄在底部中间。 */
interface Leaf {
  canvas: HTMLCanvasElement;
  /** 白色衬底（比叶子略大一圈），画在叶子下面当撕纸白边。 */
  rim: HTMLCanvasElement;
}

export type LeafShape = 'blade' | 'bladeCurve' | 'lance' | 'oval' | 'lobed' | 'trefoil' | 'frond' | 'petal';
const SHAPES: LeafShape[] = ['blade', 'bladeCurve', 'lance', 'oval', 'lobed', 'trefoil', 'frond', 'petal'];
const VARIANTS = 3;
const LEAF_H = 64;
/** 叶片画布四周留白（叶片坐标），要大于白边的外扩。 */
const PAD = 8;
/** 白边外扩（叶片坐标）：叶子缩到十几像素时也有约 1 像素。 */
const RIM = 3.5;

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** 叶子轮廓（以叶柄为原点、叶尖朝 -y，长度 LEAF_H）。 */
function leafPath(shape: LeafShape, v: number, seed: number): { path: Path2D; width: number } {
  const L = LEAF_H;
  const r = (k: number): number => hash2(v * 13 + k, SHAPES.indexOf(shape), seed);
  const p = new Path2D();
  // 用左右两条边的采样点围出叶子；halfWidth(t) 给出 t（0 叶柄 → 1 叶尖）处的半宽。
  const outline = (halfWidth: (t: number) => number, bend: number, steps = 24): void => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      pts.push([bend * t * t * L + halfWidth(t), -t * L]);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      pts.push([bend * t * t * L - halfWidth(t), -t * L]);
    }
    p.moveTo(pts[0]![0], pts[0]![1]);
    for (const [x, y] of pts) p.lineTo(x, y);
    p.closePath();
  };
  let width = 0;
  switch (shape) {
    case 'blade': {
      const w = L * (0.05 + 0.03 * r(1));
      outline((t) => w * Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.08)) * (1 - t * 0.6), (r(2) - 0.5) * 0.12);
      width = w * 2 + L * 0.1;
      break;
    }
    case 'bladeCurve': {
      const w = L * (0.06 + 0.03 * r(1));
      outline((t) => w * (1 - t) ** 0.7, 0.25 + 0.2 * r(2));
      width = w * 2 + L * 0.5;
      break;
    }
    case 'lance': {
      const w = L * (0.12 + 0.05 * r(1));
      outline((t) => w * Math.sin(Math.PI * t) ** 0.8, (r(2) - 0.5) * 0.1);
      width = w * 2;
      break;
    }
    case 'oval': {
      const w = L * (0.22 + 0.08 * r(1));
      outline((t) => (t < 0.08 ? w * 0.15 : w * Math.sin(Math.PI * ((t - 0.08) / 0.92)) ** 0.6), 0);
      width = w * 2;
      break;
    }
    case 'lobed': {
      const w = L * (0.22 + 0.06 * r(1));
      const lobes = 3 + Math.floor(r(3) * 3);
      outline((t) => (t < 0.08 ? w * 0.12 : w * Math.sin(Math.PI * ((t - 0.08) / 0.92)) ** 0.7 * (0.72 + 0.28 * Math.abs(Math.sin(t * lobes * Math.PI)))), 0, 48);
      width = w * 2;
      break;
    }
    case 'trefoil': {
      // 三片圆叶（苜蓿一样）
      const rr = L * 0.2;
      p.moveTo(0, 0);
      p.lineTo(0, -L * 0.45);
      for (const [dx, dy] of [
        [0, -L * 0.72],
        [-L * 0.22, -L * 0.5],
        [L * 0.22, -L * 0.5],
      ] as const) {
        p.moveTo(dx + rr, dy);
        p.arc(dx, dy, rr, 0, Math.PI * 2);
      }
      p.rect(-L * 0.025, -L * 0.5, L * 0.05, L * 0.5);
      width = L * 0.9;
      break;
    }
    case 'frond': {
      // 中轴 + 两侧小叶
      p.rect(-L * 0.02, -L, L * 0.04, L);
      const n = 7;
      for (let i = 1; i <= n; i++) {
        const t = i / (n + 1);
        const len = L * 0.22 * (1 - t * 0.7);
        for (const side of [-1, 1]) {
          const bx = 0;
          const by = -t * L;
          p.moveTo(bx, by);
          p.quadraticCurveTo(bx + side * len * 0.6, by - len * 0.5, bx + side * len, by - len * 0.35);
          p.quadraticCurveTo(bx + side * len * 0.5, by - len * 0.05, bx, by + L * 0.03);
        }
      }
      width = L * 0.5;
      break;
    }
    case 'petal': {
      const w = L * 0.3;
      outline((t) => w * Math.sin(Math.PI * t) ** 0.5, 0);
      width = w * 2;
      break;
    }
  }
  return { path: p, width };
}

/** 白色叶片加纸纹（明暗 ±6%），以及衬在下面的白边。 */
function buildLeaf(shape: LeafShape, v: number, seed: number): Leaf {
  const { path, width } = leafPath(shape, v, seed);
  const pad = PAD;
  const w = width + 2 * pad + 8;
  const h = LEAF_H + 2 * pad;
  const ox = w / 2;
  const oy = LEAF_H + pad;
  const c = canvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.translate(ox, oy);
  ctx.fillStyle = '#ffffff';
  ctx.fill(path);
  // 纸纹：纤维状的细小明暗。
  const img = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const px = (i / 4) % c.width;
    const py = Math.floor(i / 4 / c.width);
    const n = hash2(px >> 1, py, seed + 7 + v) * 0.08 + hash2(px, py >> 2, seed + 11) * 0.05;
    const k = 1 - n;
    img.data[i] = img.data[i]! * k;
    img.data[i + 1] = img.data[i + 1]! * k;
    img.data[i + 2] = img.data[i + 2]! * k;
  }
  ctx.putImageData(img, 0, 0);
  // 白边：把叶子剪影往八个方向挪一点叠起来。
  const rim = canvas(w, h);
  const rctx = rim.getContext('2d')!;
  // 衬底用半透明的米白：外轮廓有一道浅边，但不像描边那样抢眼。
  rctx.globalAlpha = 0.55;
  rctx.fillStyle = '#f2ecd9';
  for (let a = 0; a < 8; a++) {
    rctx.setTransform(1, 0, 0, 1, ox + Math.cos((a * Math.PI) / 4) * RIM, oy + Math.sin((a * Math.PI) / 4) * RIM);
    rctx.fill(path);
  }
  return { canvas: c, rim };
}

export class LeafKit {
  private leaves = new Map<string, Leaf>();
  private tinted = new Map<string, HTMLCanvasElement>();

  constructor(private readonly seed: number) {
    for (const s of SHAPES) for (let v = 0; v < VARIANTS; v++) this.leaves.set(`${s}${v}`, buildLeaf(s, v, seed));
  }

  leaf(shape: LeafShape, v: number): Leaf {
    return this.leaves.get(`${shape}${v % VARIANTS}`)!;
  }

  /** 着色后的叶子（乘色，保留纸纹）；颜色量化后缓存。 */
  tint(shape: LeafShape, v: number, rgb: Rgb): HTMLCanvasElement {
    const q = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c / 6) * 6))) as Rgb;
    const key = `${shape}${v % VARIANTS}|${q.join(',')}`;
    let c = this.tinted.get(key);
    if (c) return c;
    const base = this.leaf(shape, v).canvas;
    c = canvas(base.width, base.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${q[0]},${q[1]},${q[2]})`;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(base, 0, 0);
    this.tinted.set(key, c);
    return c;
  }

  /**
   * 把一片叶子画到 ctx 上：叶柄在 (x, y)，朝 angle（弧度，0 = 朝上），长 len 像素。
   * part：'fill' 只画叶子，'rim' 只画白色衬底。一丛植物先把所有叶子的衬底画完、再画叶子，
   * 白边就只出现在整丛的外轮廓上，而不是每片叶子各描一圈（那样看起来碎）。
   */
  draw(ctx: CanvasRenderingContext2D, shape: LeafShape, v: number, rgb: Rgb, x: number, y: number, angle: number, len: number, part: 'fill' | 'rim' = 'fill'): void {
    const leaf = this.leaf(shape, v);
    const k = len / LEAF_H;
    const ox = leaf.canvas.width / 2;
    const oy = LEAF_H + PAD;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(k, k);
    ctx.drawImage(part === 'rim' ? leaf.rim : this.tint(shape, v, rgb), -ox, -oy);
    ctx.restore();
  }
}

// ---------- 配色和光照 ----------

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** 草的几种绿和枯色；dry 0–1 往枯黄混。 */
const GRASS: Rgb[] = [
  [150, 168, 70],
  [176, 182, 82],
  [120, 140, 60],
  [196, 186, 96],
  [138, 152, 66],
];
const STRAW: Rgb[] = [
  [200, 172, 108],
  [184, 150, 92],
  [214, 190, 128],
];
const SHRUB: Rgb[] = [
  [76, 110, 58],
  [96, 128, 64],
  [60, 96, 66],
  [118, 142, 70],
  [72, 104, 84],
];
const TWIG: Rgb = [128, 96, 70];
const FLOWERS: Rgb[] = [
  [246, 240, 226],
  [238, 200, 84],
];

/** 叶片朝向带来的明暗：朝左上（光源方向）的亮，朝右下的暗。angle 为弧度，0 = 朝上。 */
function facing(angle: number): number {
  // 光从左上来：方向向量 (-0.6, -0.8)，叶尖方向 (sin a, -cos a)。
  const d = -0.6 * Math.sin(angle) + 0.8 * Math.cos(angle);
  return 0.9 + 0.14 * d;
}

// ---------- 拼草丛、灌丛 ----------

export interface Baked {
  canvas: HTMLCanvasElement;
  /** 叶柄群的位置（底边中点）占画布的比例，贴到地图上时做锚点。 */
  anchorY: number;
}

/**
 * 一丛草：叶数随植被量 b（0–1）增多，枯黄程度随 dry（0–1）。
 * 后排的叶子先画、偏暗，前排后画、偏亮；中间没有任何"填充色"，叶缝是透明的。
 */
export function bakeTussock(kit: LeafKit, b: number, dry: number, seed: number, size: number, flowers = false): Baked {
  const W = size * 1.6;
  const H = size * 1.15;
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  const bx = W / 2;
  const by = H - 2;
  const n = Math.round(10 + 46 * b);
  const r = (i: number, k: number): number => hash2(i * 7 + k, seed, 4242);
  const blades = Array.from({ length: n }, (_, i) => {
    const spread = (r(i, 1) - 0.5) * 2;
    const angle = spread * 1.2 * (0.55 + 0.45 * r(i, 2));
    const back = r(i, 3) < 0.5;
    return { i, angle, back, len: size * (0.5 + 0.5 * r(i, 4)) * (1 - 0.4 * Math.abs(spread)) };
  });
  // 后排先画、两侧先画，正中靠前的最后画。
  blades.sort((a, z) => Number(z.back) - Number(a.back) || Math.abs(z.angle) - Math.abs(a.angle));
  // 草叶不描白边：细叶片各描一圈会变成一团白；整丛的轮廓靠投影分开。
  for (const bl of blades) {
    const isDry = r(bl.i, 5) < dry;
    const base = isDry ? STRAW[Math.floor(r(bl.i, 6) * STRAW.length)]! : mix(GRASS[Math.floor(r(bl.i, 6) * GRASS.length)]!, STRAW[0]!, dry * 0.4);
    const k = facing(bl.angle) * (bl.back ? 0.8 : 1.02);
    const shape: LeafShape = r(bl.i, 7) < 0.55 ? 'blade' : 'bladeCurve';
    const flip = bl.angle < 0 && shape === 'bladeCurve' ? -1 : 1;
    ctx.save();
    ctx.translate(bx + (r(bl.i, 8) - 0.5) * size * 0.16, by);
    ctx.scale(flip, 1);
    kit.draw(ctx, shape, bl.i, shade(base, k), 0, 0, bl.angle * flip, bl.len);
    ctx.restore();
  }
  if (flowers) {
    const m = 2 + Math.floor(r(99, 1) * 3);
    for (let j = 0; j < m; j++) {
      const fx = bx + (r(j, 20) - 0.5) * size * 0.8;
      const fy = by - size * (0.45 + 0.35 * r(j, 21));
      const col = FLOWERS[Math.floor(r(j, 22) * FLOWERS.length)]!;
      for (let p = 0; p < 5; p++) kit.draw(ctx, 'petal', p, col, fx, fy, (p / 5) * Math.PI * 2 + r(j, 23), size * 0.12, 'rim');
      for (let p = 0; p < 5; p++) kit.draw(ctx, 'petal', p, shade(col, p < 2 ? 1.02 : 0.94), fx, fy, (p / 5) * Math.PI * 2 + r(j, 23), size * 0.12);
      ctx.fillStyle = '#d9a23a';
      ctx.beginPath();
      ctx.arc(fx, fy, size * 0.025, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return { canvas: c, anchorY: by / H };
}

/**
 * 一丛灌木：叶片排成一个半圆顶，从上往下、从后往前画，下面的盖住上面的；
 * 左上的叶子亮、右下的暗。植被量 a 低时叶子少、露出枝条。
 */
export function bakeShrub(kit: LeafKit, a: number, seed: number, size: number): Baked {
  const W = size * 1.25;
  const H = size * 1.0;
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  const cx = W / 2;
  const by = H - 2;
  const rx = size * 0.5;
  const ry = size * 0.75;
  const r = (i: number, k: number): number => hash2(i * 11 + k, seed, 777);
  // 枝条
  const twigs = 4 + Math.floor(r(0, 1) * 4);
  ctx.lineCap = 'round';
  for (let i = 0; i < twigs; i++) {
    const ang = (r(i, 2) - 0.5) * 1.8;
    const len = ry * (0.5 + 0.45 * r(i, 3));
    ctx.strokeStyle = `rgb(${shade(TWIG, 0.85 + 0.2 * r(i, 4)).map(Math.round).join(',')})`;
    ctx.lineWidth = size * 0.035;
    ctx.beginPath();
    ctx.moveTo(cx, by);
    ctx.quadraticCurveTo(cx + Math.sin(ang) * len * 0.3, by - len * 0.5, cx + Math.sin(ang) * len, by - Math.cos(ang) * len);
    ctx.stroke();
  }
  const n = Math.round(24 + 110 * a);
  const leaves = Array.from({ length: n }, (_, i) => {
    // 在半圆顶里取点（偏向外沿），叶尖朝外。
    const th = (r(i, 5) - 0.5) * Math.PI * 0.95;
    const rad = 0.3 + 0.7 * Math.sqrt(r(i, 6));
    const x = Math.sin(th) * rx * rad;
    const y = -Math.cos(th) * ry * rad * 0.85;
    const shape: LeafShape = r(i, 8) < 0.45 ? 'lobed' : r(i, 8) < 0.75 ? 'oval' : 'lance';
    return { i, x, y, th, rad, shape, ang: th * 0.9 + (r(i, 9) - 0.5) * 0.6, len: size * (0.15 + 0.08 * r(i, 10)) };
  });
  // 从里往外、从上往下画：里面的叶子被外沿的盖住。
  leaves.sort((p, q) => p.rad - q.rad || p.y - q.y);
  // 先画整丛的白色衬底，白边只留在外轮廓上。
  for (const lf of leaves) kit.draw(ctx, lf.shape, lf.i, [0, 0, 0], cx + lf.x, by + lf.y, lf.ang, lf.len, 'rim');
  for (const lf of leaves) {
    const base = SHRUB[Math.floor(r(lf.i, 7) * SHRUB.length)]!;
    // 里面暗（被遮住）、外沿亮；左上亮、右下暗。
    const light = 0.62 + 0.4 * lf.rad + 0.2 * (-lf.x / rx * 0.5 - lf.y / ry * 0.5);
    kit.draw(ctx, lf.shape, lf.i, shade(base, light), cx + lf.x, by + lf.y, lf.ang, lf.len);
  }
  return { canvas: c, anchorY: by / H };
}

// ---------- 地面的碎叶 ----------

/**
 * 在地形图上撒一层低对比的碎叶（草地、灌丛）和碎石（海岸），让平铺的纸面有手工拼贴的颗粒感。
 * 颜色取自所在像素的底色，只做明暗（草地 -20%～+14%，亮的偏黄绿）：地面要退在后面，不抢动物和标记。
 */
export function scatterGround(
  ctx: CanvasRenderingContext2D,
  img: ImageData,
  kindAt: (px: number, py: number) => 'leaf' | 'pebble' | null,
  seed: number,
  step = 6,
): number {
  const W = img.width;
  const H = img.height;
  const leafPaths = [0, 1, 2].map((v) => {
    const p = new Path2D();
    const w = 0.42 + 0.12 * v;
    p.moveTo(0, 0.5);
    p.quadraticCurveTo(w, 0, 0, -0.5);
    p.quadraticCurveTo(-w, 0, 0, 0.5);
    return p;
  });
  let count = 0;
  for (let gy = 0; gy < H; gy += step)
    for (let gx = 0; gx < W; gx += step) {
      const x = gx + hash2(gx, gy, seed + 1) * step;
      const y = gy + hash2(gx, gy, seed + 2) * step;
      const kind = kindAt(x, y);
      if (!kind) continue;
      const o = (Math.floor(y) * W + Math.floor(x)) * 4;
      // 草地上的碎叶有暗有亮，亮的偏黄绿；海岸的碎石只做明暗。
      const rk = hash2(gx, gy, seed + 3);
      const k = kind === 'leaf' ? 0.8 + 0.34 * rk : 0.86 + 0.22 * rk;
      const warm = kind === 'leaf' && rk > 0.7 ? 1 : 0;
      const col = `rgb(${Math.round(img.data[o]! * k + 14 * warm)},${Math.round(img.data[o + 1]! * k + 8 * warm)},${Math.round(img.data[o + 2]! * k - 6 * warm)})`;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(hash2(gx, gy, seed + 4) * Math.PI * 2);
      if (kind === 'leaf') {
        const s = step * (1.1 + 0.8 * hash2(gx, gy, seed + 5));
        ctx.scale(s, s);
        ctx.fillStyle = col;
        ctx.fill(leafPaths[Math.floor(hash2(gx, gy, seed + 6) * 3)]!);
      } else {
        const s = step * (0.35 + 0.35 * hash2(gx, gy, seed + 5));
        ctx.scale(s, s * 0.75);
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        // 卵石受光的一侧提亮一点
        ctx.fillStyle = 'rgba(255,250,240,0.18)';
        ctx.beginPath();
        ctx.arc(-0.3, -0.35, 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      count++;
    }
  return count;
}
