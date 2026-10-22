import { fbm, hash2 } from './noise';

/**
 * 叶片级的植被和地面：草丛、灌丛、地面的碎叶都由 P8 叶片素材（6×6，同一种浅色、无阴影）在代码里拼出来。
 * - 叶与叶之间是真正的镂空，不是素材里烤进去的深色；
 * - 明暗由代码按同一个光源（左上方）统一给；
 * - 疏密和枯黄程度跟着推演的植被量走。
 */

export type Rgb = [number, number, number];

/** P8 的六行：草簇、披针叶、阔叶（卵形、心形、圆、锯齿）、裂叶、复叶和蕨、小叶和花。 */
export type LeafCat = 'tuft' | 'lance' | 'broad' | 'lobed' | 'compound' | 'small';
const ROWS: LeafCat[] = ['tuft', 'lance', 'broad', 'lobed', 'compound', 'small'];

interface Leaf {
  /** 去色、归一化成近白色的叶片（保留叶脉和纸纹的明暗）。叶柄在底边中点。 */
  canvas: HTMLCanvasElement;
  /** 白色衬底（叶片外扩一圈），画在整丛叶子下面当撕纸白边。 */
  rim: HTMLCanvasElement;
}

/** 画布四周留白（像素），要大于白边的外扩。 */
const PAD = 6;
const RIM = 3;

type Img = CanvasImageSource & { width: number; height: number };

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** 把一张素材图去色并归一化：不透明部分的平均亮度拉到 248，只留下叶脉、纸纹的相对明暗。 */
function buildLeaf(src: Img): Leaf {
  const c = canvas(src.width + 2 * PAD, src.height + 2 * PAD);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, PAD, PAD);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4)
    if (d[i + 3]! > 200) {
      sum += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
      n++;
    }
  const k = n ? 248 / (sum / n) : 1;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.min(255, ((d[i]! + d[i + 1]! + d[i + 2]!) / 3) * k);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  const rim = canvas(c.width, c.height);
  const rctx = rim.getContext('2d')!;
  for (let a = 0; a < 8; a++) rctx.drawImage(c, Math.cos((a * Math.PI) / 4) * RIM, Math.sin((a * Math.PI) / 4) * RIM);
  // 衬底用半透明的米白：外轮廓有一道浅边，但不像描边那样抢眼。
  rctx.globalCompositeOperation = 'source-in';
  rctx.fillStyle = 'rgba(242,236,217,0.6)';
  rctx.fillRect(0, 0, rim.width, rim.height);
  return { canvas: c, rim };
}

export class LeafKit {
  private readonly leaves: Leaf[][];
  private tinted = new Map<string, HTMLCanvasElement>();

  /** sheet：P8 每行每格的图（行顺序见 ROWS）。 */
  constructor(sheet: Img[][]) {
    this.leaves = sheet.map((row) => row.map(buildLeaf));
  }

  private leaf(cat: LeafCat, v: number): Leaf {
    const row = this.leaves[ROWS.indexOf(cat)]!;
    return row[((v % row.length) + row.length) % row.length]!;
  }

  /** 着色后的叶子（乘色，保留叶脉）；颜色量化后缓存。 */
  tint(cat: LeafCat, v: number, rgb: Rgb): HTMLCanvasElement {
    const q = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c / 5) * 5))) as Rgb;
    const key = `${cat}${v}|${q.join(',')}`;
    let c = this.tinted.get(key);
    if (c) return c;
    const base = this.leaf(cat, v).canvas;
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
   * 把一片叶子画到 ctx 上：叶柄在 (x, y)，朝 angle（弧度，0 = 朝上），高 len 像素。
   * part：'fill' 画叶子，'rim' 只画白色衬底。一丛植物先把所有叶子的衬底画完、再画叶子，
   * 白边就只出现在整丛的外轮廓上，而不是每片叶子各描一圈。
   */
  draw(ctx: CanvasRenderingContext2D, cat: LeafCat, v: number, rgb: Rgb, x: number, y: number, angle: number, len: number, part: 'fill' | 'rim' = 'fill'): void {
    const leaf = this.leaf(cat, v);
    const img = part === 'rim' ? leaf.rim : this.tint(cat, v, rgb);
    const k = len / (img.height - 2 * PAD);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(k, k);
    ctx.drawImage(img, -img.width / 2, -img.height + PAD);
    ctx.restore();
  }
}

// ---------- 配色和光照 ----------

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

/** 草：橄榄绿到黄绿；dry 0–1 往枯草色混。 */
const GRASS: Rgb[] = [
  [138, 150, 62],
  [164, 168, 72],
  [112, 130, 56],
  [186, 176, 88],
  [128, 146, 70],
];
const STRAW: Rgb[] = [
  [206, 176, 104],
  [190, 154, 88],
  [222, 196, 130],
];
const SHRUB: Rgb[] = [
  [62, 98, 52],
  [82, 116, 58],
  [50, 86, 62],
  [104, 132, 64],
  [60, 92, 78],
];
const TWIG: Rgb = [112, 84, 60];
const FLOWERS: Rgb[] = [
  [250, 246, 236],
  [240, 204, 80],
  [236, 186, 196],
];

/** 叶片朝向带来的明暗：朝左上（光源方向）的亮，朝右下的暗。angle 为弧度，0 = 朝上。 */
function facing(angle: number): number {
  const d = -0.6 * Math.sin(angle) + 0.8 * Math.cos(angle);
  return 0.9 + 0.14 * d;
}

/** 整丛的竖向明暗：底部被自己挡住、偏暗，梢部受光、偏亮偏黄。只盖在已有的叶子上（叶缝仍透明）。 */
function verticalLight(ctx: CanvasRenderingContext2D, W: number, H: number, top: string, bottom: string): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(0.55, 'rgba(0,0,0,0)');
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------- 拼草丛、灌丛 ----------

/**
 * 一丛草：由几簇 P8 草簇加零散的长叶拼成，簇数随植被量 b（0–1），枯黄程度随 dry（0–1）。
 * 后排先画、偏暗，前排后画；整丛下暗上亮。叶缝透明，草叶不描白边（细叶各描一圈会变成一团白）。
 * 画布底边中点是草丛的根。
 */
export function bakeTussock(kit: LeafKit, b: number, dry: number, seed: number, size: number, flowers = false): HTMLCanvasElement {
  const W = size * 1.7;
  const H = size * 1.12;
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  const bx = W / 2;
  const by = H - 1;
  const r = (i: number, k: number): number => hash2(i * 7 + k, seed, 4242);
  const n = Math.round(3 + 6 * b);
  const parts = Array.from({ length: n }, (_, i) => {
    const spread = (r(i, 1) - 0.5) * 2;
    const back = i < n / 2;
    const tuft = r(i, 9) < 0.8;
    return {
      i,
      cat: (tuft ? 'tuft' : 'lance') as LeafCat,
      angle: spread * 0.45,
      x: spread * size * 0.22,
      back,
      len: size * (back ? 0.85 + 0.15 * r(i, 4) : 0.6 + 0.3 * r(i, 4)) * (tuft ? 1 : 0.7),
    };
  });
  for (const p of parts) {
    const isDry = r(p.i, 5) < dry;
    const base = isDry ? STRAW[Math.floor(r(p.i, 6) * STRAW.length)]! : mix(GRASS[Math.floor(r(p.i, 6) * GRASS.length)]!, STRAW[0]!, dry * 0.35);
    const k = facing(p.angle) * (p.back ? 0.78 : 1);
    const flip = r(p.i, 8) < 0.5 ? -1 : 1;
    ctx.save();
    ctx.translate(bx + p.x, by);
    ctx.scale(flip, 1);
    kit.draw(ctx, p.cat, Math.floor(r(p.i, 7) * 6), shade(base, k), 0, 0, p.angle * flip, p.len);
    ctx.restore();
  }
  verticalLight(ctx, W, H, 'rgba(236,214,140,0.28)', 'rgba(30,36,10,0.4)');
  if (flowers) {
    const m = 2 + Math.floor(r(99, 1) * 3);
    for (let j = 0; j < m; j++) {
      const fx = bx + (r(j, 20) - 0.5) * size * 0.8;
      const fy = by - size * (0.4 + 0.35 * r(j, 21));
      const col = FLOWERS[Math.floor(r(j, 22) * FLOWERS.length)]!;
      const v = r(j, 23) < 0.5 ? 3 : 5;
      kit.draw(ctx, 'small', v, col, fx, fy, 0, size * 0.22, 'rim');
      kit.draw(ctx, 'small', v, col, fx, fy, 0, size * 0.22);
    }
  }
  return c;
}

/**
 * 一丛灌木：P8 阔叶、裂叶、复叶排成一个半圆顶，从里往外画，外沿的叶子盖住里面的；
 * 里面暗、外沿亮，左上亮、右下暗。植被量 a 低时叶子少、露出枝条。白边只在整丛外轮廓上。
 */
export function bakeShrub(kit: LeafKit, a: number, seed: number, size: number): HTMLCanvasElement {
  const W = size * 1.3;
  const H = size * 1.0;
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  const cx = W / 2;
  const by = H - 2;
  const rx = size * 0.5;
  const ry = size * 0.72;
  const r = (i: number, k: number): number => hash2(i * 11 + k, seed, 777);
  ctx.lineCap = 'round';
  const twigs = 4 + Math.floor(r(0, 1) * 4);
  for (let i = 0; i < twigs; i++) {
    const ang = (r(i, 2) - 0.5) * 1.8;
    const len = ry * (0.5 + 0.45 * r(i, 3));
    ctx.strokeStyle = `rgb(${shade(TWIG, 0.85 + 0.2 * r(i, 4)).map(Math.round).join(',')})`;
    ctx.lineWidth = size * 0.03;
    ctx.beginPath();
    ctx.moveTo(cx, by);
    ctx.quadraticCurveTo(cx + Math.sin(ang) * len * 0.3, by - len * 0.5, cx + Math.sin(ang) * len, by - Math.cos(ang) * len);
    ctx.stroke();
  }
  const cats: LeafCat[] = ['broad', 'lobed', 'compound', 'broad', 'lance'];
  const n = Math.round(16 + 64 * a);
  const leaves = Array.from({ length: n }, (_, i) => {
    const th = (r(i, 5) - 0.5) * Math.PI * 0.95;
    const rad = 0.3 + 0.7 * Math.sqrt(r(i, 6));
    const cat = cats[Math.floor(r(i, 8) * cats.length)]!;
    return {
      i,
      x: Math.sin(th) * rx * rad,
      y: -Math.cos(th) * ry * rad * 0.85,
      rad,
      cat,
      v: Math.floor(r(i, 11) * 6),
      ang: th * 0.85 + (r(i, 9) - 0.5) * 0.7,
      len: size * (cat === 'compound' ? 0.28 : 0.18) * (0.8 + 0.4 * r(i, 10)),
    };
  });
  // 从里往外、从上往下画：里面的叶子被外沿的盖住。
  leaves.sort((p, q) => p.rad - q.rad || p.y - q.y);
  for (const lf of leaves) kit.draw(ctx, lf.cat, lf.v, [0, 0, 0], cx + lf.x, by + lf.y, lf.ang, lf.len, 'rim');
  for (const lf of leaves) {
    const base = SHRUB[Math.floor(r(lf.i, 7) * SHRUB.length)]!;
    const light = 0.6 + 0.42 * lf.rad + 0.22 * ((-lf.x / rx) * 0.5 - (lf.y / ry) * 0.5);
    kit.draw(ctx, lf.cat, lf.v, shade(base, light), cx + lf.x, by + lf.y, lf.ang, lf.len);
  }
  verticalLight(ctx, W, H, 'rgba(220,226,150,0.16)', 'rgba(10,24,10,0.35)');
  return c;
}

// ---------- 地面：一片片叶子铺出来 ----------

export type GroundKind = 'grass' | 'shrub' | 'pebble' | null;

/**
 * 地面铺叶：在一张灰色（128 = 不变）的"明暗图"上，按网格抖动铺满叶片（草地、灌丛下）或卵石（海岸），
 * 每片叶子先画一个往右下偏的暗影、再画本身；之后用 applyCarpet 乘到地形图上。
 * 只改明暗、不改颜色，所以地面的底色（被啃的地方泛黄等）仍然由推演决定。
 * 明暗还叠了一层低频的"斑块"：大片的深色苔藓和浅色草皮交替，像示意图里的地面。
 */
export function paveGround(kit: LeafKit, W: number, H: number, kindAt: (px: number, py: number) => GroundKind, seed: number, step = 5): HTMLCanvasElement {
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, W, H);
  const grey = (v: number): Rgb => [v, v, v];
  const groundCats: LeafCat[] = ['broad', 'small', 'lobed', 'broad', 'small', 'lance'];
  for (let gy = 0; gy < H; gy += step)
    for (let gx = 0; gx < W; gx += step) {
      const x = gx + hash2(gx, gy, seed + 1) * step;
      const y = gy + hash2(gx, gy, seed + 2) * step;
      const kind = kindAt(x, y);
      if (!kind) continue;
      const rk = hash2(gx, gy, seed + 3);
      if (kind === 'pebble') {
        const s = step * (0.45 + 0.4 * hash2(gx, gy, seed + 5));
        const v = Math.round(128 * (0.82 + 0.3 * rk));
        ctx.fillStyle = 'rgb(96,96,96)';
        ctx.beginPath();
        ctx.ellipse(x + s * 0.25, y + s * 0.3, s, s * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgb(${v},${v},${v})`;
        ctx.beginPath();
        ctx.ellipse(x, y, s, s * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const patch = fbm(x / 70, y / 70, seed + 9) - 0.5;
      const cat = groundCats[Math.floor(hash2(gx, gy, seed + 6) * groundCats.length)]!;
      const v = Math.floor(hash2(gx, gy, seed + 7) * 6);
      const len = step * (kind === 'shrub' ? 1.5 : 1.3) * (0.8 + 0.6 * hash2(gx, gy, seed + 5));
      const ang = (hash2(gx, gy, seed + 4) - 0.5) * Math.PI * 2;
      const k = (kind === 'shrub' ? 0.8 : 0.96) * (0.84 + 0.3 * rk) * (1 + patch * 0.55);
      kit.draw(ctx, cat, v, grey(kind === 'shrub' ? 82 : 96), x + len * 0.12, y + len * 0.15, ang, len);
      kit.draw(ctx, cat, v, grey(Math.min(255, 128 * k)), x, y, ang, len);
    }
  return c;
}

/** 把铺叶的明暗图乘到地形图上：亮的叶子再往黄绿偏一点，暗的往蓝绿偏一点。 */
export function applyCarpet(img: ImageData, carpet: HTMLCanvasElement): void {
  const m = carpet.getContext('2d')!.getImageData(0, 0, carpet.width, carpet.height).data;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = m[i]! / 128;
    if (k === 1) continue;
    const warm = Math.max(-1, Math.min(1, (k - 1) * 4));
    d[i] = d[i]! * k + 10 * warm;
    d[i + 1] = d[i + 1]! * k + 4 * warm;
    d[i + 2] = d[i + 2]! * k - 8 * warm;
  }
}
