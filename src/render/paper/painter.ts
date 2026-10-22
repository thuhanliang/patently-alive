import { PX, type Fields, type Palette } from './terrain';
import type { PaintResult, PainterMessage } from './painter.worker';

type Opts = { softVegetation?: boolean; sculpt?: boolean };

/**
 * 地形分条并行地画：按行切成几条，每条交给一个 Worker（painter.worker.ts）画地形、铺叶，再拼回一张。
 * 逐像素的地形和铺叶是主要的载入时间（单线程约 5 秒），分到几个核上同时画；结果和单线程逐像素相同。
 * Worker 常驻，纸纹和叶片只送一次；游戏里植被变了要重画时，同一组 Worker 接着用。
 */
export class PaintPool {
  private readonly workers: Worker[];
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (data: Uint8ClampedArray) => void; reject: (e: Error) => void }>();

  private constructor(n: number, pal: Palette, leaves: ImageBitmap[][] | null) {
    this.workers = Array.from({ length: n }, () => {
      const worker = new Worker(new URL('./painter.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e: MessageEvent<PaintResult>): void => {
        const job = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        job?.resolve(e.data.data);
      };
      worker.onerror = (e): void => {
        // 出错的 Worker 上还没回来的活一律算失败（调用方保留旧的那张图）。
        for (const job of this.pending.values()) job.reject(new Error(e.message));
        this.pending.clear();
      };
      const init: PainterMessage = { type: 'init', pal, leaves };
      worker.postMessage(init);
      return worker;
    });
  }

  static async create(pal: Palette, leaves: CanvasImageSource[][] | null): Promise<PaintPool> {
    const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    const bitmaps = leaves ? await Promise.all(leaves.map((row) => Promise.all(row.map((img) => createImageBitmap(img))))) : null;
    return new PaintPool(n, pal, bitmaps);
  }

  /** 画一整张：每个 Worker 一条，拼回一张 ImageData。 */
  async paint(fields: Fields, seed: number, opts: Opts): Promise<ImageData> {
    const W = fields.width * PX;
    const H = fields.height * PX;
    const out = new ImageData(W, H);
    const step = Math.ceil(H / this.workers.length);
    await Promise.all(
      this.workers.map((worker, i) => {
        const band: [number, number] = [Math.min(H, i * step), Math.min(H, (i + 1) * step)];
        if (band[0] >= band[1]) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
          const id = this.nextId++;
          this.pending.set(id, {
            resolve: (data) => {
              out.data.set(data, band[0] * W * 4);
              resolve();
            },
            reject,
          });
          const job: PainterMessage = { type: 'paint', id, fields, seed, opts, band };
          worker.postMessage(job);
        });
      }),
    );
    return out;
  }

  dispose(): void {
    for (const w of this.workers) w.terminate();
    this.pending.clear();
  }
}

/** 只画一次（demo 用）：建一组 Worker，画完就关掉。 */
export async function paintParallel(fields: Fields, pal: Palette, seed: number, opts: Opts, leaves: CanvasImageSource[][] | null): Promise<ImageData> {
  const pool = await PaintPool.create(pal, leaves);
  try {
    return await pool.paint(fields, seed, opts);
  } finally {
    pool.dispose();
  }
}
