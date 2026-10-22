import { LeafKit, applyCarpet, groundKindAt, paveGround } from './leaves';
import { paintTerrain, type Fields, type Palette } from './terrain';

/**
 * 地形绘制的 Worker：画一条（第 y0 到 y1 行）地形，再铺这一条的叶子。
 * 每个像素只看自己的坐标、叶子的顺序和整张画时一样，所以几条拼起来和在主线程整张画逐像素相同（painter.ts）。
 */
export interface PaintJob {
  fields: Fields;
  pal: Palette;
  seed: number;
  opts: { softVegetation?: boolean; sculpt?: boolean };
  band: [number, number];
  /** P8 叶片；null 时不铺叶。 */
  leaves: ImageBitmap[][] | null;
}

let kit: LeafKit | null = null;

self.onmessage = (e: MessageEvent<PaintJob>): void => {
  const { fields, pal, seed, opts, band, leaves } = e.data;
  const painted = paintTerrain(fields, pal, seed, opts, band);
  if (leaves) {
    kit ??= new LeafKit(leaves);
    const W = painted.width;
    const H = fields.height * (W / fields.width);
    applyCarpet(painted, paveGround(kit, W, H, groundKindAt(fields, seed), seed + 50, 9, band), band[0]);
  }
  (self as unknown as Worker).postMessage(painted.data, [painted.data.buffer]);
};
