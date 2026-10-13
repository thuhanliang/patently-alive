import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import { countAt, type SimState } from '../sim';
import { TERRAIN } from '../sim/terrain';
import { INK, PAPER, TERRAIN_COLORS as T, lerpColor } from './palette';
import { CELL_PX, mapWorldSize } from './projection';

/** 离岸多少格以外算深水。 */
const DEEP_WATER_CELLS = 10;

/** 数据图层：植被，或某个物种的密度。一次只开一层。 */
export type DataLayer = { kind: 'vegetation' } | { kind: 'species'; index: number };

/**
 * 格子图层：一格一个像素画进离屏画布，再整体放大成一张贴图（最近邻采样，格子边界清楚）。
 * 田野笔记的水彩配色（见 palette.ts）：植被图层里陆地按地形和植被多少着色，水按离岸远近分浅深；
 * 物种图层在淡纸色上用物种主色表示密度，按当前地图上的最高值归一化。每格带一点固定的纸纹起伏。
 */
export class GridLayer {
  readonly container = new Container();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly texture: Texture;
  private readonly lines = new Graphics();
  private readonly counts: Int32Array;
  /** 每格：水离岸的远近（0 浅 – 1 深），陆地为 0。跟着地形换（换种子时地形会变）。 */
  private depth: Float64Array;
  private terrain: Uint8Array;
  /** 每格固定的纸纹起伏（−1 – 1）。 */
  private readonly grain: Float64Array;

  constructor(
    width: number,
    height: number,
    terrain: Uint8Array,
    private readonly speciesColors: readonly number[],
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 画布');
    this.ctx = ctx;
    this.image = ctx.createImageData(width, height);
    this.counts = new Int32Array(width * height);
    this.terrain = terrain;
    this.depth = waterDepth(terrain, width, height);
    this.grain = new Float64Array(width * height);
    for (let i = 0; i < this.grain.length; i++) {
      // 简单的整数哈希，只用于画面，不进推演。
      let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
      h ^= h >>> 13;
      h = Math.imul(h, 0xc2b2ae35);
      h ^= h >>> 16;
      this.grain[i] = ((h >>> 0) / 0xffffffff) * 2 - 1;
    }

    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = 'nearest';
    const sprite = new Sprite(this.texture);
    sprite.scale.set(CELL_PX);
    this.container.addChild(sprite, this.lines);
    this.drawGridLines(width, height);
  }

  update(state: Readonly<SimState>, layer: DataLayer): void {
    // 换了一局（换种子、载入日志）时海岛的形状会变。
    if (state.grid.terrain !== this.terrain) {
      this.terrain = state.grid.terrain;
      this.depth = waterDepth(this.terrain, state.grid.width, state.grid.height);
    }
    const px = this.image.data;
    const { terrain, depth, grain } = this;
    const put = (i: number, color: number): void => {
      // 纸纹：亮度上下浮动约 3%。
      const k = 1 + 0.03 * grain[i]!;
      const o = i * 4;
      px[o] = Math.min(255, ((color >> 16) & 0xff) * k);
      px[o + 1] = Math.min(255, ((color >> 8) & 0xff) * k);
      px[o + 2] = Math.min(255, (color & 0xff) * k);
      px[o + 3] = 255;
    };
    const water = (i: number): number => lerpColor(T.shallowWater, T.deepWater, depth[i]!);

    if (layer.kind === 'vegetation') {
      const veg = state.grid.vegetation;
      const max = state.config.world.vegetation.maxBiomass;
      const shrub = state.grid.shrub;
      const shrubMax = state.config.world.shrub?.maxBiomass ?? 1;
      for (let i = 0; i < veg.length; i++) {
        const f = veg[i]! / max;
        switch (terrain[i]) {
          case TERRAIN.water: put(i, water(i)); break;
          case TERRAIN.coast: put(i, lerpColor(T.coast, T.grassDry, f * 1.5)); break;
          // 灌丛格按灌丛多少着色：被啃薄了就褪成枯黄。
          case TERRAIN.shrub: put(i, lerpColor(T.shrubDry, T.shrubLush, shrub[i]! / shrubMax)); break;
          default: put(i, lerpColor(T.grassDry, T.grassLush, f * 1.4));
        }
      }
    } else {
      const counts = this.countSpecies(state, layer.index);
      let max = 1;
      for (let i = 0; i < counts.length; i++) if (counts[i]! > max) max = counts[i]!;
      const base = lerpColor(PAPER, T.grassDry, 0.25);
      const hue = this.speciesColors[layer.index] ?? INK;
      for (let i = 0; i < counts.length; i++) {
        if (terrain[i] === TERRAIN.water) put(i, water(i));
        else put(i, lerpColor(base, hue, Math.sqrt(counts[i]! / max)));
      }
    }
    this.ctx.putImageData(this.image, 0, 0);
    this.texture.source.update();
  }

  /** 某物种每格的只数：格子计数 + 待合并计数 + 展开的个体。 */
  private countSpecies(state: Readonly<SimState>, s: number): Int32Array {
    const pop = state.populations[s]!;
    const counts = this.counts;
    counts.set(pop.adults);
    for (const stage of pop.juveniles) for (let i = 0; i < counts.length; i++) counts[i] = counts[i]! + stage[i]!;
    // 当天从个体收拢回来、还没并进计数的也要算。
    const pending = state.emigrants[s]!;
    for (let i = 0; i < counts.length; i++) counts[i] = counts[i]! + countAt(pending, i);
    // 关注区里的动物已经展开成个体，也要算进密度。
    const ind = state.individuals;
    for (let k = 0; k < ind.count; k++) {
      if (ind.species[k] !== s) continue;
      const c = Math.floor(ind.y[k]!) * state.grid.width + Math.floor(ind.x[k]!);
      counts[c] = counts[c]! + 1;
    }
    return counts;
  }

  /** 放大到地块档时才看得见的格线。 */
  setGridLinesVisible(visible: boolean): void {
    this.lines.visible = visible;
  }

  private drawGridLines(width: number, height: number): void {
    const size = mapWorldSize(width, height);
    for (let x = 0; x <= width; x++) this.lines.moveTo(x * CELL_PX, 0).lineTo(x * CELL_PX, size.y);
    for (let y = 0; y <= height; y++) this.lines.moveTo(0, y * CELL_PX).lineTo(size.x, y * CELL_PX);
    this.lines.stroke({ width: 1, pixelLine: true, color: INK, alpha: 0.12 });
    this.lines.visible = false;
  }
}

/** 每格水离最近陆地的远近，按 DEEP_WATER_CELLS 归一到 0–1（多源广度优先，八连通）。陆地为 0。 */
function waterDepth(terrain: Uint8Array, width: number, height: number): Float64Array {
  const dist = new Int32Array(terrain.length).fill(-1);
  const queue: number[] = [];
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] !== TERRAIN.water) {
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    if (dist[i]! >= DEEP_WATER_CELLS) continue;
    const x = i % width;
    const y = (i - x) / width;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (dist[j] === -1) {
          dist[j] = dist[i]! + 1;
          queue.push(j);
        }
      }
    }
  }
  const out = new Float64Array(terrain.length);
  for (let i = 0; i < out.length; i++) out[i] = dist[i] === -1 ? 1 : dist[i]! / DEEP_WATER_CELLS;
  return out;
}
