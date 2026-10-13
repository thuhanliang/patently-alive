import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { SimState } from '../sim';
import { CELL_PX, mapWorldSize } from './projection';

/**
 * 植被图层：一格一个像素画进离屏画布，再整体放大成一张贴图（最近邻采样，格子边界清楚）。
 * 灰盒配色：植被越多越深。
 */
export class GridLayer {
  readonly container = new Container();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly texture: Texture;
  private readonly lines = new Graphics();

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 画布');
    this.ctx = ctx;
    this.image = ctx.createImageData(width, height);

    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = 'nearest';
    const sprite = new Sprite(this.texture);
    sprite.scale.set(CELL_PX);
    this.container.addChild(sprite, this.lines);
    this.drawGridLines(width, height);
  }

  update(state: Readonly<SimState>): void {
    const { vegetation } = state.grid;
    const max = state.config.world.vegetation.maxBiomass;
    const px = this.image.data;
    for (let i = 0; i < vegetation.length; i++) {
      const f = Math.min(1, vegetation[i]! / max);
      const g = Math.round(222 - 172 * f);
      const o = i * 4;
      px[o] = g;
      px[o + 1] = g;
      px[o + 2] = g;
      px[o + 3] = 255;
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }

  /** 放大到地块档时才看得见的格线。 */
  setGridLinesVisible(visible: boolean): void {
    this.lines.visible = visible;
  }

  private drawGridLines(width: number, height: number): void {
    const size = mapWorldSize(width, height);
    for (let x = 0; x <= width; x++) this.lines.moveTo(x * CELL_PX, 0).lineTo(x * CELL_PX, size.y);
    for (let y = 0; y <= height; y++) this.lines.moveTo(0, y * CELL_PX).lineTo(size.x, y * CELL_PX);
    this.lines.stroke({ width: 1, pixelLine: true, color: 0x000000, alpha: 0.3 });
    this.lines.visible = false;
  }
}
