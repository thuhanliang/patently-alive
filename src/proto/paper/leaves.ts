import { fbm, hash2 } from './noise';

/**
 * P8 叶片素材（6×6，同一种浅色、无阴影）：载入后去色归一，颜色全部由代码给。
 * 用在两处：地面铺一层叶片（paveGround），以及灌丛剪影外沿的锯齿（plants.ts）。
 */

export type Rgb = [number, number, number];

/** P8 的六行：草簇、披针叶、阔叶（卵形、心形、圆、锯齿）、裂叶、复叶和蕨、小叶和花。 */
export type LeafCat = 'tuft' | 'lance' | 'broad' | 'lobed' | 'compound' | 'small';
const ROWS: LeafCat[] = ['tuft', 'lance', 'broad', 'lobed', 'compound', 'small'];

interface Leaf {
  /** 去色、归一化成近白色的叶片（保留叶脉和纸纹的明暗）。叶柄在底边中点。 */
  canvas: HTMLCanvasElement;
}

/** 画布四周留白（像素）。 */
const PAD = 6;

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
  return { canvas: c };
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

  /** 把一片叶子画到 ctx 上：叶柄在 (x, y)，朝 angle（弧度，0 = 朝上），高 len 像素。 */
  draw(ctx: CanvasRenderingContext2D, cat: LeafCat, v: number, rgb: Rgb, x: number, y: number, angle: number, len: number): void {
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

/**
 * 地面铺叶：在一张灰色（128 = 不变）的"明暗图"上，按网格抖动铺满叶片（草地、灌丛下）或卵石（海岸），
 * 叶片大小约为兔子身长的四分之一（和示意图一样）；之后用 applyCarpet 乘到地形图上。
 * 只改明暗、不改颜色，所以地面的底色（被啃的地方泛黄等）仍然由推演决定。
 * 明暗还叠了一层低频的"斑块"：大片的深色苔藓和浅色草皮交替，像示意图里的地面。
 */
export function paveGround(kit: LeafKit, W: number, H: number, kindAt: (px: number, py: number) => GroundKind, seed: number, step = 9): HTMLCanvasElement {
  const c = canvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgb(128,128,128)';
  ctx.fillRect(0, 0, W, H);
  const grey = (v: number): Rgb => [v, v, v];
  const groundCats: LeafCat[] = ['broad', 'lobed', 'broad', 'small', 'lobed'];
  for (let gy = 0; gy < H; gy += step)
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
