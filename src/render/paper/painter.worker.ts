import { LeafKit, applyCarpet, groundKindAt, paveGround } from './leaves';
import { paintTerrain, type Fields, type Palette } from './terrain';

/**
 * 地形绘制的 Worker：画一条（第 y0 到 y1 行）地形，再铺这一条的叶子。
 * 每个像素只看自己的坐标、叶子的顺序和整张画时一样，所以几条拼起来和在主线程整张画逐像素相同（painter.ts）。
 * 常驻：纸纹和 P8 叶片只在开头送一次（init），之后每次只送场和条的范围（paint）。
 */
export type PainterMessage =
  | { type: 'init'; pal: Palette; leaves: ImageBitmap[][] | null }
  | { type: 'paint'; id: number; fields: Fields; seed: number; opts: { softVegetation?: boolean; sculpt?: boolean }; band: [number, number] };

export interface PaintResult {
  id: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

let pal: Palette | null = null;
/** P8 叶片；没有时不铺叶。 */
let kit: LeafKit | null = null;

self.onmessage = (e: MessageEvent<PainterMessage>): void => {
  const msg = e.data;
  if (msg.type === 'init') {
    pal = msg.pal;
    kit = msg.leaves ? new LeafKit(msg.leaves) : null;
    return;
  }
  const { id, fields, seed, opts, band } = msg;
  const painted = paintTerrain(fields, pal!, seed, opts, band);
  if (kit) {
    const W = painted.width;
    const H = fields.height * (W / fields.width);
    applyCarpet(painted, paveGround(kit, W, H, groundKindAt(fields, seed), seed + 50, 9, band), band[0]);
  }
  const result: PaintResult = { id, data: painted.data };
  (self as unknown as Worker).postMessage(result, [painted.data.buffer]);
};
