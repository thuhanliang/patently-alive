import { fbm, valueNoise } from './noise';
import { PX, sample, type Fields, type PaperTex } from './terrain';

/**
 * 装饰性的地形台阶：按离岸距离加低频噪声，把陆地分成几层"叠起来的纸板"。
 * 推演里没有高程，这些台阶只是画面（和推演无关，不影响任何结果）。
 * - 正俯视时，台阶只表现为一道米白的纸边和往右下落的投影；
 * - 镜头倾斜时，每层往上抬、露出侧面（侧面是同一层剪影叠很多份，越往下越暗）。
 */

/** 陆地分几层（不含海面和海滩所在的第 0 层）。 */
export const LEVELS = 3;
/** 每层抬高多少世界像素（每格 PX 像素）。 */
export const LEVEL_H = 12;
/** 粗网格的间距（像素）：台阶的轮廓是平滑曲线，在粗网格上算、再双线性插值，毛边另外逐像素加。 */
const G = 4;
/** 纸边宽度（格）。 */
const RIM_W = 0.22;
const RIM: [number, number, number] = [242, 236, 217];

export interface LayerImage {
  /** 裁到有内容的范围以节省显存；x、y 是在整张地形图里的偏移。 */
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
}

export class Terraces {
  private readonly cw: number;
  private readonly ch: number;
  /** 每层一张粗网格的场：离岸距离减去这一层的门槛（格），大于 0 就在这一层之上。 */
  private readonly f: Float32Array[];

  constructor(
    fields: Fields,
    private readonly seed: number,
    readonly width: number,
    readonly height: number,
  ) {
    this.cw = Math.ceil(width / G) + 1;
    this.ch = Math.ceil(height / G) + 1;
    this.f = Array.from({ length: LEVELS }, () => new Float32Array(this.cw * this.ch));
    const { width: w, height: h } = fields;
    for (let gy = 0; gy < this.ch; gy++)
      for (let gx = 0; gx < this.cw; gx++) {
        const px = gx * G;
        const py = gy * G;
        // 和地形绘制用同一个低频扭曲，台阶和海岸线的走向一致。
        const warp = (fbm(px / (PX * 5), py / (PX * 5), seed) - 0.5) * 1.6;
        const sd = sample(fields.sd, w, h, (px + 0.5) / PX - 0.5, (py + 0.5) / PX - 0.5) + warp;
        const n = [0, 1, 2].map((k) => fbm(px / (PX * 14), py / (PX * 14), seed + 300 + k));
        // 门槛逐层加上正数，保证上层一定落在下层里面。第一层有时紧贴水边（成了海边的崖），有时让出一条海滩。
        const t1 = 0.6 + 2.8 * n[0]!;
        const t2 = t1 + 5 + 8 * n[1]!;
        const t3 = t2 + 7 + 10 * n[2]!;
        const i = gy * this.cw + gx;
        this.f[0]![i] = sd - t1;
        this.f[1]![i] = sd - t2;
        this.f[2]![i] = sd - t3;
      }
  }

  /** 第 k 层（0 起）的场在像素 (px, py) 处的值（格）。 */
  field(k: number, px: number, py: number): number {
    const u = Math.min(Math.max(px / G, 0), this.cw - 1.001);
    const v = Math.min(Math.max(py / G, 0), this.ch - 1.001);
    const ix = Math.floor(u);
    const iy = Math.floor(v);
    const fx = u - ix;
    const fy = v - iy;
    const f = this.f[k]!;
    const i = iy * this.cw + ix;
    const a = f[i]!;
    const b = f[i + 1]!;
    const c = f[i + this.cw]!;
    const d = f[i + this.cw + 1]!;
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }

  /** 像素处在第几层（0 = 海面、海滩）。 */
  levelAt(px: number, py: number): number {
    let L = 0;
    while (L < LEVELS && this.field(L, px, py) > 0) L++;
    return L;
  }

  /**
   * 把画好的地形图切成各层：
   * - 先在原图上加上高一层投下的影子（往右下偏）；
   * - 每层的顶面是原图里属于这一层的部分，靠边一圈换成米白纸边，边缘带纤维毛刺；
   * - 每层的侧面是同一个剪影，填上岩壁纸纹。
   * 原图（img）就地改成第 0 层。
   */
  split(img: ImageData, side: PaperTex): { tops: LayerImage[]; sides: LayerImage[] } {
    const W = img.width;
    const H = img.height;
    const d = img.data;
    const tops = Array.from({ length: LEVELS }, () => new ImageData(W, H));
    const sides = Array.from({ length: LEVELS }, () => new ImageData(W, H));
    const box = Array.from({ length: LEVELS }, () => [W, H, 0, 0]);
    const SHX = 5;
    const SHY = 6;
    const v = new Float32Array(LEVELS);
    for (let py = 0; py < H; py++)
      for (let px = 0; px < W; px++) {
        let L = 0;
        for (let k = 0; k < LEVELS; k++) {
          v[k] = this.field(k, px, py) + (valueNoise(px / 2.4, py / 2.4, this.seed + 41 + k * 13) - 0.5) * 0.3;
          if (v[k]! > 0) L = k + 1;
        }
        if (L === 0 && v[0]! < -1.5) continue;
        const o = (py * W + px) * 4;
        // 高一层投下的影子：往左上看一点，那里若属于更高的一层，这里就在它的影子里。
        if (L < LEVELS) {
          const sh = Math.min(1, Math.max(0, this.field(L, px - SHX, py - SHY) * PX * 0.25 + 0.5)) * 0.3;
          if (sh > 0) {
            d[o] = d[o]! * (1 - sh);
            d[o + 1] = d[o + 1]! * (1 - sh * 1.04);
            d[o + 2] = d[o + 2]! * (1 - sh * 1.1);
          }
        }
        const ti = ((py % side.size) * side.size + (px % side.size)) * 3;
        for (let k = 0; k < LEVELS; k++) {
          const m = Math.min(1, Math.max(0, v[k]! * PX + 0.5));
          if (m <= 0) break;
          const rimA = Math.min(1, Math.max(0, 1 - v[k]! / RIM_W));
          const t = tops[k]!.data;
          t[o] = d[o]! + (RIM[0] - d[o]!) * rimA;
          t[o + 1] = d[o + 1]! + (RIM[1] - d[o + 1]!) * rimA;
          t[o + 2] = d[o + 2]! + (RIM[2] - d[o + 2]!) * rimA;
          t[o + 3] = m * 255;
          const s = sides[k]!.data;
          s[o] = side.rgb[ti]! * 255;
          s[o + 1] = side.rgb[ti + 1]! * 255;
          s[o + 2] = side.rgb[ti + 2]! * 255;
          s[o + 3] = m * 255;
          const b = box[k]!;
          if (px < b[0]!) b[0] = px;
          if (py < b[1]!) b[1] = py;
          if (px > b[2]!) b[2] = px;
          if (py > b[3]!) b[3] = py;
        }
      }
    const crop = (im: ImageData, b: number[]): LayerImage => {
      const x = Math.max(0, b[0]! - 2);
      const y = Math.max(0, b[1]! - 2);
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.min(W, b[2]! + 3) - x);
      c.height = Math.max(1, Math.min(H, b[3]! + 3) - y);
      c.getContext('2d')!.putImageData(im, -x, -y);
      return { canvas: c, x, y };
    };
    return { tops: tops.map((t, k) => crop(t, box[k]!)), sides: sides.map((s, k) => crop(s, box[k]!)) };
  }
}
