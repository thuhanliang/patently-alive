import type { WorldParams } from '../data/schema/world';
import type { Rng } from './rng';

/**
 * 格子地图。数据按行存放：第 (x, y) 格的下标是 y * width + x。
 * fertility 开局生成后不变；vegetation 每天更新。
 */
export interface Grid {
  width: number;
  height: number;
  /** 肥力，[fertility.min, fertility.max]，乘在植被上限上。 */
  fertility: Float64Array;
  /** 植被生物量（g/m²）。 */
  vegetation: Float64Array;
}

export function cellIndex(grid: Pick<Grid, 'width'>, x: number, y: number): number {
  return y * grid.width + x;
}

export function createGrid(world: WorldParams, rng: Rng): Grid {
  const { width, height } = world;
  const fertility = valueNoise(width, height, world.fertility.patchSize, rng);
  const { min, max } = world.fertility;
  for (let i = 0; i < fertility.length; i++) fertility[i] = min + (max - min) * fertility[i]!;

  const vegetation = new Float64Array(width * height);
  const veg = world.vegetation;
  for (let i = 0; i < vegetation.length; i++) {
    vegetation[i] = Math.max(veg.floorBiomass, veg.maxBiomass * fertility[i]! * veg.initialFraction);
  }
  return { width, height, fertility, vegetation };
}

/**
 * 每天一次的植被更新：logistic 生长（乘季节和天气）减去枯落，夹在 [下限, 上限] 之间。
 *   dv = r · g(季节) · w(天气) · v · (1 − v/K) − d(季节) · v，K = 最大生物量 × 肥力
 */
export function growVegetation(grid: Grid, world: WorldParams, growth: number, decay: number): void {
  const veg = world.vegetation;
  const r = veg.growthRate * growth;
  const { vegetation, fertility } = grid;
  for (let i = 0; i < vegetation.length; i++) {
    const k = veg.maxBiomass * fertility[i]!;
    const v = vegetation[i]!;
    let next = v + r * v * (1 - v / k) - decay * v;
    if (next > k) next = k;
    if (next < veg.floorBiomass) next = veg.floorBiomass;
    vegetation[i] = next;
  }
}

/**
 * 两个八度的值噪声，输出在 [0, 1]。只用加减乘除，确定。
 * 格点上的随机值来自 rng，所以同一个种子得到同一张肥力图。
 */
export function valueNoise(width: number, height: number, patchSize: number, rng: Rng): Float64Array {
  const out = new Float64Array(width * height);
  const octaves: Array<[number, number]> = [
    [patchSize, 0.65],
    [Math.max(2, Math.floor(patchSize / 3)), 0.35],
  ];
  for (const [scale, weight] of octaves) {
    const lw = Math.floor(width / scale) + 2;
    const lh = Math.floor(height / scale) + 2;
    const lattice = new Float64Array(lw * lh);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.nextFloat();
    for (let y = 0; y < height; y++) {
      const gy = y / scale;
      const y0 = Math.floor(gy);
      const ty = smooth(gy - y0);
      for (let x = 0; x < width; x++) {
        const gx = x / scale;
        const x0 = Math.floor(gx);
        const tx = smooth(gx - x0);
        const a = lattice[y0 * lw + x0]!;
        const b = lattice[y0 * lw + x0 + 1]!;
        const c = lattice[(y0 + 1) * lw + x0]!;
        const d = lattice[(y0 + 1) * lw + x0 + 1]!;
        const top = a + (b - a) * tx;
        const bottom = c + (d - c) * tx;
        out[y * width + x] = out[y * width + x]! + weight * (top + (bottom - top) * ty);
      }
    }
  }
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
