import type { WorldParams } from '../data/schema/world';
import type { Rng } from './rng';
import { valueNoise } from './noise';
import { generateTerrain, TERRAIN } from './terrain';

/**
 * 格子地图。数据按行存放：第 (x, y) 格的下标是 y * width + x。
 * terrain、fertility 开局生成后不变；vegetation 每天更新。
 */
export interface Grid {
  width: number;
  height: number;
  /** 地形（见 TERRAIN）。水格没有植被，动物不能进。 */
  terrain: Uint8Array;
  /** 肥力，乘在植被上限上：肥力噪声（[fertility.min, fertility.max]）× 地形系数（水为 0，海岸、灌丛打折）。 */
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
  // 地形在肥力之后生成：没有地形参数的世界不多抽随机数，阶段 0 的草原逐位不变。
  const { terrain, fertilityBy } = generateTerrain(world, rng);
  for (let i = 0; i < fertility.length; i++) fertility[i] = fertility[i]! * fertilityBy[i]!;

  const vegetation = new Float64Array(width * height);
  const veg = world.vegetation;
  for (let i = 0; i < vegetation.length; i++) {
    vegetation[i] =
      terrain[i] === TERRAIN.water ? 0 : Math.max(veg.floorBiomass, veg.maxBiomass * fertility[i]! * veg.initialFraction);
  }
  return { width, height, terrain, fertility, vegetation };
}

/**
 * 每天一次的植被更新：logistic 生长（乘季节和天气）减去枯落，夹在 [下限, 上限] 之间。
 *   dv = r · g(季节) · w(天气) · v · (1 − v/K) − d(季节) · v，K = 最大生物量 × 肥力
 */
export function growVegetation(grid: Grid, world: WorldParams, growth: number, decay: number): void {
  const veg = world.vegetation;
  const r = veg.growthRate * growth;
  const { vegetation, fertility, terrain } = grid;
  for (let i = 0; i < vegetation.length; i++) {
    if (terrain[i] === TERRAIN.water) continue;
    const k = veg.maxBiomass * fertility[i]!;
    const v = vegetation[i]!;
    // 肥力为 0 的格子 K = 0：不长，只保留下限。
    let next = k > 0 ? v + r * v * (1 - v / k) - decay * v : 0;
    if (next > k) next = k;
    if (next < veg.floorBiomass) next = veg.floorBiomass;
    vegetation[i] = next;
  }
}

