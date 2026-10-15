import type { WorldParams } from '../data/schema/world';
import type { Rng } from './rng';
import { valueNoise } from './noise';
import { generateTerrain, TERRAIN } from './terrain';
import type { PlantType } from '../data/schema/plant';
import { monthlyCurve } from './time';

/** 世界里的一种植物（类型 + 在这片世界里的生长参数）。 */
export type WorldPlant = WorldParams['plants'][number];

/**
 * 格子地图。数据按行存放：第 (x, y) 格的下标是 y * width + x。
 * terrain、fertility 开局生成后不变；plants 每天更新。
 */
export interface Grid {
  width: number;
  height: number;
  /** 地形（见 TERRAIN）。水格没有植物，动物不能进。 */
  terrain: Uint8Array;
  /** 属于哪座岛：0 水，1 主岛，2 起是离岸小岛（按面积从大到小）。没有海岛地形时全是 1。 */
  island: Uint8Array;
  /** 肥力，乘在草本的上限上：肥力噪声（[fertility.min, fertility.max]）× 地形系数（水为 0，海岸、灌丛打折）。 */
  fertility: Float64Array;
  /**
   * 各种植物的生物量（g/m²），顺序同 world.plants（阶段 3.5 起）。
   * 草本长在所有陆地格上；木本只在自己的地形上有，别处为 0。
   */
  plants: Float64Array[];
  /**
   * 每格的掩护（0–1），每天植物更新后算一次（见 updateCover）。
   * 存在状态里而不是现算：一天里植物会被啃，掩护按当天开始时算，快照恢复后才对得上。
   */
  cover: Float64Array;
}

export function cellIndex(grid: Pick<Grid, 'width'>, x: number, y: number): number {
  return y * grid.width + x;
}

/** 植物类型的地形名 → TERRAIN 编号。 */
const TERRAIN_OF: Record<PlantType['cover']['terrain'], number> = { coast: TERRAIN.coast, grass: TERRAIN.grass, shrub: TERRAIN.shrub };

/** 一种植物在这片世界里啃不到的下限（g/m²）：草本是绝对量，木本是上限的比例。 */
export function plantFloor(p: WorldPlant): number {
  return p.type.form === 'herb' ? p.floorBiomass! : p.maxBiomass * p.floorFraction!;
}

/** 草本在 world.plants 里的下标（schema 保证正好一种）。 */
export function herbIndex(world: Pick<WorldParams, 'plants'>): number {
  return world.plants.findIndex((p) => p.type.form === 'herb');
}

export function createGrid(world: WorldParams, rng: Rng): Grid {
  const { width, height } = world;
  const fertility = valueNoise(width, height, world.fertility.patchSize, rng);
  const { min, max } = world.fertility;
  for (let i = 0; i < fertility.length; i++) fertility[i] = min + (max - min) * fertility[i]!;
  // 地形在肥力之后生成：没有地形参数的世界不多抽随机数，阶段 0 的草原逐位不变。
  const { terrain, island, fertilityBy } = generateTerrain(world, rng);
  for (let i = 0; i < fertility.length; i++) fertility[i] = fertility[i]! * fertilityBy[i]!;

  const plants = world.plants.map((p) => {
    const b = new Float64Array(width * height);
    if (p.type.form === 'herb') {
      const floor = p.floorBiomass!;
      for (let i = 0; i < b.length; i++) b[i] = terrain[i] === TERRAIN.water ? 0 : Math.max(floor, p.maxBiomass * fertility[i]! * p.initialFraction);
    } else {
      const on = TERRAIN_OF[p.type.cover.terrain];
      for (let i = 0; i < b.length; i++) if (terrain[i] === on) b[i] = p.maxBiomass * p.initialFraction;
    }
    return b;
  });
  const grid = { width, height, terrain, island, fertility, plants, cover: new Float64Array(width * height) };
  updateCover(grid, world);
  return grid;
}

/**
 * 按当前植物算每格的掩护：每种地形的掩护来自给这种地形提供掩护的那种植物
 * （草地：草本 × 0.5；灌丛：木本），按生物量占上限的比例折算；其余地形没有掩护。
 */
export function updateCover(grid: Grid, world: WorldParams): void {
  const { terrain, plants, cover } = grid;
  // 每种地形由哪种植物给掩护（-1：没有）。
  const by = new Int8Array(4).fill(-1);
  world.plants.forEach((p, k) => {
    by[TERRAIN_OF[p.type.cover.terrain]] = k;
  });
  for (let i = 0; i < cover.length; i++) {
    const k = by[terrain[i]!]!;
    if (k < 0) {
      cover[i] = 0;
      continue;
    }
    const p = world.plants[k]!;
    const c = Math.min(1, plants[k]![i]! / p.maxBiomass);
    // 长满算 1 的植物直接取比例（和乘 1 一样，只是不多做一次乘法）。
    cover[i] = p.type.cover.atFull === 1 ? c : p.type.cover.atFull * c;
  }
}

/**
 * 每天的生长输入（季节 × 天气），集中在这一处：以后接气候（降雨、气温）就在这里加。
 * growth 乘在每种植物的增长率上；decay 是草本当天的枯落比例。
 */
export function dailyGrowthInput(world: WorldParams, dayOfYear: number, weather: number): { growth: number; decay: number } {
  return {
    growth: monthlyCurve(world.season.growthByMonth, dayOfYear) * weather,
    decay: monthlyCurve(world.season.decayByMonth, dayOfYear),
  };
}

/**
 * 每天一次的植物更新，按生长方式（引擎定义）：
 * - 草本：logistic 生长减去枯落，夹在 [下限, 上限] 之间。dv = r · 生长输入 · v · (1 − v/K) − 枯落 · v，K = 上限 × 肥力。
 * - 木本：只在自己的地形上，logistic 生长，不枯落，夹在 [下限, 上限]。
 */
export function growPlants(grid: Grid, world: WorldParams, growth: number, decay: number): void {
  const { fertility, terrain } = grid;
  world.plants.forEach((p, k) => {
    const b = grid.plants[k]!;
    const r = p.growthRate * growth;
    if (p.type.form === 'herb') {
      const floor = p.floorBiomass!;
      for (let i = 0; i < b.length; i++) {
        if (terrain[i] === TERRAIN.water) continue;
        const cap = p.maxBiomass * fertility[i]!;
        const v = b[i]!;
        // 肥力为 0 的格子 K = 0：不长，只保留下限。
        let next = cap > 0 ? v + r * v * (1 - v / cap) - decay * v : 0;
        if (next > cap) next = cap;
        if (next < floor) next = floor;
        b[i] = next;
      }
    } else {
      const on = TERRAIN_OF[p.type.cover.terrain];
      const floor = p.maxBiomass * p.floorFraction!;
      for (let i = 0; i < b.length; i++) {
        if (terrain[i] !== on) continue;
        const v = b[i]!;
        b[i] = Math.min(p.maxBiomass, Math.max(floor, v + r * v * (1 - v / p.maxBiomass)));
      }
    }
  });
  updateCover(grid, world);
}

/** 陆地上草本的平均生物量（g/m²）：水格不算，否则海岛的平均值会被大片水面拉低。 */
export function meanLandVegetation(grid: Readonly<Grid>, world: Pick<WorldParams, 'plants'>): number {
  const herb = grid.plants[herbIndex(world)]!;
  let total = 0;
  let n = 0;
  for (let i = 0; i < herb.length; i++) {
    if (grid.terrain[i] === TERRAIN.water) continue;
    total += herb[i]!;
    n += 1;
  }
  return n > 0 ? total / n : 0;
}

/**
 * 吃植物、找虫子要用的参数，从 world.plants 预先整理好（推演里每天、每小时都要用，不每次去查）。
 * 植物被吃的比例、虫子产量来自植物类型的数据；"先啃多少木本"（BROWSE_SHARE）是引擎规则。
 */
export interface PlantFood {
  /** 草本在 grid.plants 里的下标。 */
  herb: number;
  /** 草本啃不到的下限（g/m²）。 */
  herbFloor: number;
  /** 草本每天最多被吃掉的比例（下限以上的部分）。 */
  herbEaten: number;
  /** 木本的下标；世界里没有木本时为 -1，不啃木本。 */
  woody: number;
  woodyFloor: number;
  woodyEaten: number;
  /** 各种植物每克生物量每天养出的无脊椎动物（克鲜重），顺序同 grid.plants。 */
  invertebrateYield: readonly number[];
}

export function plantFood(world: Pick<WorldParams, 'plants'>): PlantFood {
  const herb = herbIndex(world);
  const woody = world.plants.findIndex((p) => p.type.form === 'woody');
  const h = world.plants[herb]!;
  const w = woody >= 0 ? world.plants[woody]! : undefined;
  return {
    herb,
    herbFloor: plantFloor(h),
    herbEaten: h.type.eatenPerDay,
    woody,
    woodyFloor: w ? plantFloor(w) : 0,
    woodyEaten: w ? w.type.eatenPerDay : 0,
    invertebrateYield: world.plants.map((p) => p.type.invertebrateYield),
  };
}

/** 一格每平方米每天能找到的无脊椎动物（克鲜重）：各种植物的生物量 × 各自的虫子产量。 */
export function invertebratesPerM2(grid: Readonly<Grid>, food: PlantFood, c: number): number {
  let total = 0;
  for (let k = 0; k < grid.plants.length; k++) total += food.invertebrateYield[k]! * grid.plants[k]![c]!;
  return total;
}
