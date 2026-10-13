import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { countAt, type SimState } from '../sim';
import { CELL_PX, mapWorldSize } from './projection';

/** 数据图层：植被，或某个物种的密度。一次只开一层。 */
export type DataLayer = { kind: 'vegetation' } | { kind: 'species'; index: number };

/**
 * 格子图层：一格一个像素画进离屏画布，再整体放大成一张贴图（最近邻采样，格子边界清楚）。
 * 灰盒配色：数值越高越深。物种密度按当前地图上的最高值归一化。
 */
export class GridLayer {
  readonly container = new Container();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly texture: Texture;
  private readonly lines = new Graphics();
  private readonly counts: Int32Array;

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 画布');
    this.ctx = ctx;
    this.image = ctx.createImageData(width, height);
    this.counts = new Int32Array(width * height);

    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = 'nearest';
    const sprite = new Sprite(this.texture);
    sprite.scale.set(CELL_PX);
    this.container.addChild(sprite, this.lines);
    this.drawGridLines(width, height);
  }

  update(state: Readonly<SimState>, layer: DataLayer): void {
    let values: ArrayLike<number>;
    let max: number;
    if (layer.kind === 'vegetation') {
      values = state.grid.vegetation;
      max = state.config.world.vegetation.maxBiomass;
    } else {
      const pop = state.populations[layer.index]!;
      const counts = this.counts;
      max = 1;
      counts.set(pop.adults);
      for (const stage of pop.juveniles) for (let i = 0; i < counts.length; i++) counts[i] = counts[i]! + stage[i]!;
      // 当天从个体收拢回来、还没并进计数的也要算。
      const pending = state.emigrants[layer.index]!;
      for (let i = 0; i < counts.length; i++) counts[i] = counts[i]! + countAt(pending, i);
      // 关注区里的动物已经展开成个体，也要算进密度。
      const ind = state.individuals;
      for (let k = 0; k < ind.count; k++) {
        if (ind.species[k] !== layer.index) continue;
        const c = Math.floor(ind.y[k]!) * state.grid.width + Math.floor(ind.x[k]!);
        counts[c] = counts[c]! + 1;
      }
      for (let i = 0; i < counts.length; i++) if (counts[i]! > max) max = counts[i]!;
      values = counts;
    }
    const px = this.image.data;
    for (let i = 0; i < values.length; i++) {
      const f = Math.min(1, values[i]! / max);
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
