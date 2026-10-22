import { PX, type Fields, type Palette } from './terrain';
import type { PaintJob } from './painter.worker';

/**
 * 地形分条并行地画：按行切成几条，每条交给一个 Worker（painter.worker.ts）画地形、铺叶，再拼回一张。
 * 逐像素的地形和铺叶是主要的载入时间（单线程约 5 秒），分到几个核上同时画；结果和单线程逐像素相同。
 */
export async function paintParallel(
  fields: Fields,
  pal: Palette,
  seed: number,
  opts: PaintJob['opts'],
  leaves: CanvasImageSource[][] | null,
): Promise<ImageData> {
  const W = fields.width * PX;
  const H = fields.height * PX;
  const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  const bitmaps = leaves ? await Promise.all(leaves.map((row) => Promise.all(row.map((img) => createImageBitmap(img))))) : null;
  const out = new ImageData(W, H);
  const step = Math.ceil(H / n);
  await Promise.all(
    Array.from({ length: n }, (_, i) => {
      const band: [number, number] = [Math.min(H, i * step), Math.min(H, (i + 1) * step)];
      if (band[0] >= band[1]) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL('./painter.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent<Uint8ClampedArray>): void => {
          out.data.set(e.data, band[0] * W * 4);
          worker.terminate();
          resolve();
        };
        worker.onerror = (e): void => {
          worker.terminate();
          reject(new Error(e.message));
        };
        const job: PaintJob = { fields, pal, seed, opts, band, leaves: bitmaps };
        worker.postMessage(job);
      });
    }),
  );
  return out;
}
