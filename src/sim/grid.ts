import type { WorldParams } from '../data/schema/world';
import type { Rng } from './rng';
import { valueNoise } from './noise';
import { generateTerrain, TERRAIN } from './terrain';
import { GRASS_COVER } from './physiology';

/**
 * 格子地图。数据按行存放：第 (x, y) 格的下标是 y * width + x。
 * terrain、fertility 开局生成后不变；vegetation 每天更新。
 */
export interface Grid {
  width: number;
  height: number;
  /** 地形（见 TERRAIN）。水格没有植被，动物不能进。 */
  terrain: Uint8Array;
  /** 属于哪座岛：0 水，1 主岛，2 起是离岸小岛（按面积从大到小）。没有海岛地形时全是 1。 */
  island: Uint8Array;
  /** 肥力，乘在植被上限上：肥力噪声（[fertility.min, fertility.max]）× 地形系数（水为 0，海岸、灌丛打折）。 */
  fertility: Float64Array;
  /** 植被生物量（g/m²）。 */
  vegetation: Float64Array;
  /** 灌丛生物量（g/m²），只在灌丛格里有。 */
  shrub: Float64Array;
  /**
   * 每格的掩护（0–1），每天植被、灌丛更新后算一次（见 updateCover）。
   * 存在状态里而不是现算：一天里植被会被啃，掩护按当天开始时算，快照恢复后才对得上。
   */
  cover: Float64Array;
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
  const { terrain, island, fertilityBy } = generateTerrain(world, rng);
  for (let i = 0; i < fertility.length; i++) fertility[i] = fertility[i]! * fertilityBy[i]!;

  const vegetation = new Float64Array(width * height);
  const veg = world.vegetation;
  for (let i = 0; i < vegetation.length; i++) {
    vegetation[i] =
      terrain[i] === TERRAIN.water ? 0 : Math.max(veg.floorBiomass, veg.maxBiomass * fertility[i]! * veg.initialFraction);
  }
  const shrub = new Float64Array(width * height);
  if (world.shrub) {
    for (let i = 0; i < shrub.length; i++) {
      if (terrain[i] === TERRAIN.shrub) shrub[i] = world.shrub.maxBiomass * world.shrub.initialFraction;
    }
  }
  const grid = { width, height, terrain, island, fertility, vegetation, shrub, cover: new Float64Array(width * height) };
  updateCover(grid, world);
  return grid;
}

/** 按当前植被和灌丛算每格的掩护（见 Grid.cover、physiology 的 GRASS_COVER）。 */
export function updateCover(grid: Grid, world: WorldParams): void {
  const { terrain, vegetation, shrub, cover } = grid;
  const vegMax = world.vegetation.maxBiomass;
  const shrubMax = world.shrub?.maxBiomass ?? 1;
  for (let i = 0; i < cover.length; i++) {
    switch (terrain[i]) {
      case TERRAIN.shrub: cover[i] = Math.min(1, shrub[i]! / shrubMax); break;
      case TERRAIN.grass: cover[i] = GRASS_COVER * Math.min(1, vegetation[i]! / vegMax); break;
      default: cover[i] = 0;
    }
  }
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
  // 灌丛：只在灌丛格，logistic 生长，不枯落（木本），夹在 [下限, 上限]。
  const sh = world.shrub;
  if (sh) {
    const rs = sh.growthRate * growth;
    const floor = sh.maxBiomass * sh.floorFraction;
    const { shrub } = grid;
    for (let i = 0; i < shrub.length; i++) {
      if (terrain[i] !== TERRAIN.shrub) continue;
      const v = shrub[i]!;
      shrub[i] = Math.min(sh.maxBiomass, Math.max(floor, v + rs * v * (1 - v / sh.maxBiomass)));
    }
  }
  updateCover(grid, world);
}


/** 陆地上的平均植被（g/m²）：水格不算，否则海岛的平均值会被大片水面拉低。 */
export function meanLandVegetation(grid: Readonly<Grid>): number {
  let total = 0;
  let n = 0;
  for (let i = 0; i < grid.vegetation.length; i++) {
    if (grid.terrain[i] === TERRAIN.water) continue;
    total += grid.vegetation[i]!;
    n += 1;
  }
  return n > 0 ? total / n : 0;
}
