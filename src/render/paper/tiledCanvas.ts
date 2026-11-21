import { Container, Sprite, Texture } from 'pixi.js';

/**
 * 切成小块的大画布（2026-11-22）：一张很大的地形图（小岛细分以后 2304×2304）切成 TILE×TILE 的小块，
 * 每块各是一张画布、一张贴图。改了哪几块就只更新哪几块：按瓦片补细的时候，不用每次把整张二十几兆的图重新上传给显卡。
 */
export const TILE = 768;

export class TiledCanvas {
  readonly view = new Container();
  private readonly tiles: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: Texture; x: number; y: number; dirty: boolean }[] = [];
  readonly cols: number;
  readonly rows: number;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.cols = Math.ceil(width / TILE);
    this.rows = Math.ceil(height / TILE);
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(TILE, width - c * TILE);
        canvas.height = Math.min(TILE, height - r * TILE);
        const ctx = canvas.getContext('2d')!;
        const tex = Texture.from(canvas);
        const s = new Sprite(tex);
        s.position.set(c * TILE, r * TILE);
        this.view.addChild(s);
        this.tiles.push({ canvas, ctx, tex, x: c * TILE, y: r * TILE, dirty: false });
      }
  }

  /** 把一张图（整张的坐标）画上去，每块各画自己那一部分。 */
  drawImage(img: CanvasImageSource, w = this.width, h = this.height): void {
    for (const t of this.tiles) {
      t.ctx.imageSmoothingQuality = 'high';
      t.ctx.drawImage(img, -t.x, -t.y, w, h);
      t.dirty = true;
    }
  }

  /** 一条像素（从第 y0 行起、整张那么宽）贴进去：只动它跨过的那几块。 */
  putRows(y0: number, data: Uint8ClampedArray): void {
    const rows = data.length / 4 / this.width;
    const img = new ImageData(new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.length), this.width, rows);
    for (const t of this.tiles) {
      if (y0 + rows <= t.y || y0 >= t.y + t.canvas.height) continue;
      // putImageData 的"脏矩形"只贴这一块里那几行。
      t.ctx.putImageData(img, -t.x, y0 - t.y, t.x, Math.max(0, t.y - y0), t.canvas.width, Math.min(rows, t.y + t.canvas.height - y0) - Math.max(0, t.y - y0));
      t.dirty = true;
    }
  }

  /** 改过的块重新上传。 */
  flush(): void {
    for (const t of this.tiles)
      if (t.dirty) {
        t.tex.source.update();
        t.dirty = false;
      }
  }

  /** 拼回一整张（存进浏览器用）。 */
  toCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.width;
    c.height = this.height;
    const g = c.getContext('2d')!;
    for (const t of this.tiles) g.drawImage(t.canvas, t.x, t.y);
    return c;
  }

  get textures(): Texture[] {
    return this.tiles.map((t) => t.tex);
  }
}
