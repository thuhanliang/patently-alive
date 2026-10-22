import { fbm, hash2 } from './noise';
import { PX, SHRUB_EDGE, sample, terrainWarp, type Fields } from './terrain';

/**
 * P8 叶片素材（6×6，同一种浅色、无阴影）：载入后去色归一，颜色全部由代码给。
 * 用在两处：地面铺一层叶片（paveGround），以及灌丛剪影外沿的锯齿（plants.ts）。
 */

export type Rgb = [number, number, number];

/** P8 的六行：草簇、披针叶、阔叶（卵形、心形、圆、锯齿）、裂叶、复叶和蕨、小叶和花。 */
export type LeafCat = 'tuft' | 'lance' | 'broad' | 'lobed' | 'compound' | 'small';
const ROWS: LeafCat[] = ['tuft', 'lance', 'broad', 'lobed', 'compound', 'small'];

/** 主线程用 <canvas>，Web Worker 里用 OffscreenCanvas（地形在 Worker 里分条并行地画，见 painter.ts）。 */
export type Canvas = HTMLCanvasElement | OffscreenCanvas;
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface Leaf {
  /** 去色、归一化成近白色的叶片（保留叶脉和纸纹的明暗）。叶柄在底边中点。 */
  canvas: Canvas;
}

/** 画布四周留白（像素）。 */
const PAD = 6;

type Img = CanvasImageSource & { width: number; height: number };

function canvas(w: number, h: number): Canvas {
  const cw = Math.max(1, Math.ceil(w));
  const ch = Math.max(1, Math.ceil(h));
  if (typeof document === 'undefined') return new OffscreenCanvas(cw, ch);
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  return c;
}

const ctx2d = (c: Canvas, opts?: CanvasRenderingContext2DSettings): Ctx2D => c.getContext('2d', opts) as Ctx2D;

/** 把一张素材图去色并归一化：不透明部分的平均亮度拉到 248，只留下叶脉、纸纹的相对明暗。 */
function buildLeaf(src: Img): Leaf {
  const c = canvas(src.width + 2 * PAD, src.height + 2 * PAD);
  const ctx = ctx2d(c, { willReadFrequently: true });
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
  return { canvas: c };
}

export class LeafKit {
  private readonly leaves: Leaf[][];
  private tinted = new Map<string, Canvas>();

  /** sheet：P8 每行每格的图（行顺序见 ROWS）。 */
  constructor(sheet: Img[][]) {
    this.leaves = sheet.map((row) => row.map(buildLeaf));
  }

  private leaf(cat: LeafCat, v: number): Leaf {
    const row = this.leaves[ROWS.indexOf(cat)]!;
    return row[((v % row.length) + row.length) % row.length]!;
  }

  /** 着色后的叶子（乘色，保留叶脉）；颜色量化后缓存。 */
  tint(cat: LeafCat, v: number, rgb: Rgb): Canvas {
    const q = rgb.map((c) => Math.max(0, Math.min(255, Math.round(c / 5) * 5))) as Rgb;
    const key = `${cat}${v}|${q.join(',')}`;
    let c = this.tinted.get(key);
    if (c) return c;
    const base = this.leaf(cat, v).canvas;
    c = canvas(base.width, base.height);
    const ctx = ctx2d(c);
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${q[0]},${q[1]},${q[2]})`;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(base, 0, 0);
    this.tinted.set(key, c);
    return c;
  }

  /** 把一片叶子画到 ctx 上：叶柄在 (x, y)，朝 angle（弧度，0 = 朝上），高 len 像素。 */
  draw(ctx: Ctx2D, cat: LeafCat, v: number, rgb: Rgb, x: number, y: number, angle: number, len: number): void {
    const img = this.tint(cat, v, rgb);
    const k = len / (img.height - 2 * PAD);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.scale(k, k);
    ctx.drawImage(img, -img.width / 2, -img.height + PAD);
    ctx.restore();
  }
}

// ---------- 地面：一片片叶子铺出来 ----------

export type GroundKind = 'grass' | 'shrub' | 'pebble' | null;

/** 这个像素该铺什么：和地形绘制用同一个低频扭曲判断落在哪层纸上，撕边附近留空。 */
export function groundKindAt(fields: Fields, seed: number): (px: number, py: number) => GroundKind {
  const { width: w, height: h } = fields;
  return (px, py) => {
    const u = (px + 0.5) / PX - 0.5;
    const v = (py + 0.5) / PX - 0.5;
    const warp = terrainWarp(px, py, seed);
    if (sample(fields.sd, w, h, u, v) + warp < 0.5) return null;
    const g = sample(fields.grass, w, h, u, v) + warp * 0.12;
    if (g > 0.62) return sample(fields.shrubLand, w, h, u, v) + warp * 0.12 > SHRUB_EDGE ? 'shrub' : 'grass';
    if (g < 0.38) return 'pebble';
    return null;
  };
}

/** 一片叶子（或一块卵石）最远能伸出它的格点多少像素（宽叶转过来能到叶长的两倍多）：分条画时，条外这么远的叶子也要画。 */
const REACH = 80;

/**
 * 地面铺叶：在一张灰色（128 = 不变）的"明暗图"上，按网格抖动铺满叶片（草地、灌丛下）或卵石（海岸），
 * 叶片大小约为兔子身长的四分之一（和示意图一样）；之后用 applyCarpet 乘到地形图上。
 * 只改明暗、不改颜色，所以地面的底色（被啃的地方泛黄等）仍然由推演决定。
 * 明暗还叠了一层低频的"斑块"：大片的深色苔藓和浅色草皮交替，像示意图里的地面。
 */
export function paveGround(
  kit: LeafKit,
  W: number,
  H: number,
  kindAt: (px: number, py: number) => GroundKind,
  seed: number,
  step = 9,
  /**
   * 只画第 y0 到 y1 行附近的叶子（分条并行用），用 applyCarpet 的 y0 读回这一条。
   * 画布仍是整张大小、坐标不平移：图片取样的舍入和画布上的绝对坐标有关，平移了会差一两级；
   * 不平移、叶子的顺序也一样，拼起来就和整张画逐像素相同。
   */
  band: [number, number] = [0, H],
): Canvas {
  const [y0, y1] = band;
  const c = canvas(W, H);
  const ctx = ctx2d(c, { willReadFrequently: true });
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, y0, W, y1 - y0);
  const grey = (v: number): Rgb => [v, v, v];
  const groundCats: LeafCat[] = ['broad', 'lobed', 'broad', 'small', 'lobed'];
  const gyFrom = Math.max(0, Math.floor((y0 - REACH) / step)) * step;
  const gyTo = Math.min(H, y1 + REACH);
  for (let gy = gyFrom; gy < gyTo; gy += step)
    for (let gx = 0; gx < W; gx += step) {
      const x = gx + hash2(gx, gy, seed + 1) * step;
      const y = gy + hash2(gx, gy, seed + 2) * step;
      const kind = kindAt(x, y);
      if (!kind) continue;
      const rk = hash2(gx, gy, seed + 3);
      if (kind === 'pebble') {
        const s = step * (0.3 + 0.25 * hash2(gx, gy, seed + 5));
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
      const patch = fbm(x / 90, y / 90, seed + 9) - 0.5;
      const cat = groundCats[Math.floor(hash2(gx, gy, seed + 6) * groundCats.length)]!;
      const v = Math.floor(hash2(gx, gy, seed + 7) * 6);
      const len = step * (1.6 + 0.7 * hash2(gx, gy, seed + 5));
      const ang = (hash2(gx, gy, seed + 4) - 0.5) * Math.PI * 2;
      const k = (kind === 'shrub' ? 0.82 : 0.97) * (0.88 + 0.24 * rk) * (1 + patch * 0.35);
      // 每片叶子是一小块纸：左上一道亮边、右下一点影子，再盖本身。
      kit.draw(ctx, cat, v, grey(Math.min(255, 128 * k * 1.12)), x - 0.8, y - 0.8, ang, len);
      kit.draw(ctx, cat, v, grey(128 * k * 0.72), x + 1, y + 1.3, ang, len);
      kit.draw(ctx, cat, v, grey(Math.min(255, 128 * k)), x, y, ang, len);
    }
  return c;
}

/** 把铺叶的明暗图乘到地形图上：亮的叶子再往黄绿偏一点，暗的往蓝绿偏一点。img 是明暗图里从第 y0 行开始的一条。 */
export function applyCarpet(img: { data: Uint8ClampedArray; width: number; height: number }, carpet: Canvas, y0 = 0): void {
  const m = ctx2d(carpet, { willReadFrequently: true }).getImageData(0, y0, img.width, img.height).data;
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
