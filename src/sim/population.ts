import type { Grid } from './grid';
import { TERRAIN, crossesWater } from './terrain';
import {
  CROWDING_BLOCK_CELLS,
  FED_SUFFICIENT,
  INVERTEBRATE_YIELD,
  JUVENILE_SIZE_FACTOR,
  BROWSE_SHARE,
  MAX_BROWSE_FRACTION,
  MAX_GRAZE_FRACTION,
  PREDATION_HALF_SATURATION_DAYS,
  type DerivedSpecies,
  type PreyWeights,
  juvenileStageAt,
  nestExposure,
  usableMeal,
  breedingRoom,
  PREY_STOCK_DAYS,
} from './physiology';
import type { Rng } from './rng';
import { binomial, stochasticRound } from './sample';
import { CAUSE, recordDeaths, type DeathLedger } from './ledger';

/**
 * 按格子的种群：每个物种每格存幼体（分 juvenileStages 个年龄段，见 physiology 的 conveyor）和成体的整数计数。
 * 整数计数让"守恒"可以精确断言：每只动物的增减都有一笔账。
 */
export interface Population {
  /** juveniles[k][c]：第 k 个年龄段（0 = 刚出生）在第 c 格的数量。 */
  juveniles: Int32Array[];
  adults: Int32Array;
}

/** 一格里的幼体总数。 */
export function juvenilesAt(p: Population, c: number): number {
  let n = 0;
  for (const stage of p.juveniles) n += stage[c]!;
  return n;
}

/** 一格里的总数（幼体 + 成体）。 */
export function countAt(p: Population, c: number): number {
  return p.adults[c]! + juvenilesAt(p, c);
}

/** 一个物种一天的账目。 */
export interface DayStats {
  total: number;
  births: number;
  deathsPredation: number;
  deathsStarvation: number;
  deathsOther: number;
  /** 玩家投放进来的数量。 */
  released: number;
  /** 兽医工具移除的数量（陷阱、搜捕）。 */
  removed: number;
}

export function emptyDayStats(total = 0): DayStats {
  return { total, births: 0, deathsPredation: 0, deathsStarvation: 0, deathsOther: 0, released: 0, removed: 0 };
}

/** 按体型折算的数量：幼体算半只（食量、作为猎物的体重都按这个算）。 */
function sizeWeighted(p: Population, c: number): number {
  return p.adults[c]! + JUVENILE_SIZE_FACTOR * juvenilesAt(p, c);
}

/** 一个和 like 同样大小、全为 0 的种群计数。 */
export function emptyPopulation(like: Population): Population {
  return {
    juveniles: like.juveniles.map((st) => new Int32Array(st.length)),
    adults: new Int32Array(like.adults.length),
  };
}

/** 把 from 的计数加进 into，然后清零 from。 */
export function mergeInto(into: Population, from: Population): void {
  for (let i = 0; i < into.adults.length; i++) into.adults[i] = into.adults[i]! + from.adults[i]!;
  from.adults.fill(0);
  into.juveniles.forEach((st, k) => {
    const src = from.juveniles[k]!;
    for (let i = 0; i < st.length; i++) st[i] = st[i]! + src[i]!;
    src.fill(0);
  });
}

export function populationTotal(p: Population): number {
  let t = 0;
  for (const arr of [p.adults, ...p.juveniles]) for (let i = 0; i < arr.length; i++) t += arr[i]!;
  return t;
}

/** 开局分布：按物种的开局密度在陆地上抽样；mainIslandOnly 的物种只放在主岛上。 */
export function createPopulation(
  species: DerivedSpecies,
  grid: Grid,
  cellAreaM2: number,
  rng: Rng,
  mainIslandOnly = false,
): Population {
  const n = grid.width * grid.height;
  const adults = new Int32Array(n);
  const mean = (species.params.initialDensityPerHa * cellAreaM2) / 10_000;
  for (let i = 0; i < n; i++) {
    if (grid.terrain[i] === TERRAIN.water || (mainIslandOnly && grid.island[i] !== 1)) continue;
    // 开局分布有起伏：均值附近的二项抽样，均值很小时退化成按概率放一只。
    const trials = Math.max(1, Math.ceil(mean * 2));
    adults[i] = mean >= 1 ? binomial(rng, trials, mean / trials) : stochasticRound(rng, mean);
  }
  return { juveniles: Array.from({ length: species.juvenileStages }, () => new Int32Array(n)), adults };
}

export interface DailyContext {
  species: readonly DerivedSpecies[];
  /** 捕食权重（见 preyMatrix）。 */
  prey: PreyWeights;
  grid: Grid;
  populations: Population[];
  cellAreaM2: number;
  floorBiomass: number;
  /** 当月各物种的繁殖期系数。 */
  breeding: readonly number[];
  rng: Rng;
  /** 扩散用的暂存数组，不进状态。 */
  scratch: Int32Array;
  /** 各物种各区块的拥挤程度（见 crowdingByBlock），当天开始时算好。 */
  crowding: Float64Array[];
  /** 每格属于哪个拥挤区块（预先算好）。 */
  blockOf: Int32Array;
  /** 灌丛啃不到的下限（g/m²）；世界里没有灌丛时为 undefined，不啃灌丛。 */
  shrubFloor?: number | undefined;
  /** 陆地格的下标，从小到大（见 landCells）。 */
  land: Int32Array;
  /** 死因账本：每笔死亡记在这里（见 ledger.ts）。 */
  ledger: DeathLedger;
}

/** 陆地格的下标，从小到大。地图建好后算一次；没有水的地图就是全部格子。 */
export function landCells(grid: Pick<Grid, 'terrain'>): Int32Array {
  const out: number[] = [];
  for (let c = 0; c < grid.terrain.length; c++) if (grid.terrain[c] !== TERRAIN.water) out.push(c);
  return Int32Array.from(out);
}

/**
 * 一天的种群推演：捕食先按区块算好（捕食者跑遍家域），再逐格进行：捕食 → 进食 → 出生 → 死亡，最后整张图一起扩散。
 * （长大由传送带在这之前统一挪段，见 shiftStages。）
 * 先捕食：今天被吃掉的动物不再分走植被。
 * 返回各物种当天的账目。
 */
export function dailyPopulation(ctx: DailyContext): DayStats[] {
  const { species, populations, grid } = ctx;
  const stats = species.map(() => emptyDayStats());
  const fed: FedByFood = { plant: new Float64Array(species.length), vertebrate: new Float64Array(species.length), invertebrate: new Float64Array(species.length) };
  const { crowding, blockOf } = ctx;
  const hunting = huntingByBlock(ctx, crowding[0]!.length);

  // 只走陆地格：水里没有动物，海岛地图上大半是水。
  for (const c of ctx.land) {
    hunt(ctx, c, hunting, fed.vertebrate, stats);
    graze(ctx, c, fed.plant);
    forage(ctx, c, fed.invertebrate);
    const block = blockOf[c]!;
    for (let s = 0; s < species.length; s++) {
      if (countAt(populations[s]!, c) > 0) {
        lifeCycle(ctx, s, c, combineFed(species[s]!, fed, s), crowding[s]![block]!, stats[s]!);
      }
    }
  }

  for (let s = 0; s < species.length; s++) {
    disperse(ctx, s, populations[s]!.adults);
    // 窝里的幼崽不扩散。
    const stages = populations[s]!.juveniles;
    for (let k = species[s]!.nestStages; k < stages.length; k++) disperse(ctx, s, stages[k]!);
    stats[s]!.total = populationTotal(populations[s]!);
  }
  return stats;
}

/** 各物种今天每类食物吃到的份额（0–1）。 */
interface FedByFood {
  plant: Float64Array;
  vertebrate: Float64Array;
  invertebrate: Float64Array;
}

/**
 * 吃饱程度 = Σ 食谱比例 × 这一类吃到的份额。只吃一类的物种就是那一类的份额（和阶段 0 一样）。
 * 杂食的不会因为一类食物少了就改吃别的：鼠的食谱里蛋只占一点，没有蛋也饿不着。
 */
function combineFed(sp: DerivedSpecies, fed: FedByFood, s: number): number {
  const d = sp.params.diet;
  let f = 0;
  if (d.plant > 0) f += d.plant * fed.plant[s]!;
  if (d.vertebrate > 0) f += d.vertebrate * fed.vertebrate[s]!;
  if (d.invertebrate > 0) f += d.invertebrate * fed.invertebrate[s]!;
  return f;
}

/** 某格所在拥挤区块的下标。 */
export function crowdingBlockOf(width: number, x: number, y: number): number {
  const bw = Math.ceil(width / CROWDING_BLOCK_CELLS);
  return Math.floor(y / CROWDING_BLOCK_CELLS) * bw + Math.floor(x / CROWDING_BLOCK_CELLS);
}

/** 区块一共有几个（和 crowdingBlocks 的布局一致）。 */
export function crowdingBlockCount(width: number, height: number): number {
  return Math.ceil(width / CROWDING_BLOCK_CELLS) * Math.ceil(height / CROWDING_BLOCK_CELLS);
}

/**
 * 每格属于哪个区块，以及每个区块有几格陆地（边缘区块不满，海岸区块有水）。地图建好后算一次。
 * 拥挤程度按陆地格数算：动物只住在陆地上。全是水的区块记 1 格，免得除以 0（里面也不会有动物）。
 */
export function crowdingBlocks(
  width: number,
  height: number,
  terrain?: Uint8Array,
): { blockOf: Int32Array; cellsIn: Float64Array; blocksWide: number } {
  const bw = Math.ceil(width / CROWDING_BLOCK_CELLS);
  const bh = Math.ceil(height / CROWDING_BLOCK_CELLS);
  const blockOf = new Int32Array(width * height);
  const cellsIn = new Float64Array(bw * bh);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = crowdingBlockOf(width, x, y);
      blockOf[y * width + x] = b;
      if (!terrain || terrain[y * width + x] !== TERRAIN.water) cellsIn[b] = cellsIn[b]! + 1;
    }
  }
  for (let b = 0; b < cellsIn.length; b++) if (cellsIn[b] === 0) cellsIn[b] = 1;
  return { blockOf, cellsIn, blocksWide: bw };
}

/**
 * 幼体传送带挪一段：最后一段并入成体，其余各段往后挪，第 0 段清空。
 * 只交换数组和做一次加法，不抽随机数。
 */
export function shiftStages(pop: Population): void {
  const stages = pop.juveniles;
  const last = stages[stages.length - 1]!;
  for (let c = 0; c < last.length; c++) pop.adults[c] = pop.adults[c]! + last[c]!;
  last.fill(0);
  for (let k = stages.length - 1; k > 0; k--) stages[k] = stages[k - 1]!;
  stages[0] = last;
}

/** 格子计数之外、也要算进拥挤度的动物：展开的个体（按位置）和待合并的计数。 */
export interface CrowdingExtras {
  /** 展开的个体，带地图宽度（个体坐标换算格子下标用）和当天（按出生日分成体、幼体）。 */
  individuals?: { count: number; species: Uint8Array; x: Float64Array; y: Float64Array; born: Int32Array; width: number; day: number };
  pending?: readonly Population[];
}

/** 没有猎物时的拥挤程度：远大于 1，表示住不下。 */
const NO_ROOM = 1e9;

/** 捕食者抓到各种猎物的成体、幼体各一只，能用上的肉量（见 usableMeal）。捕猎和"有没有地方住"用同一把尺子。 */
function preyMeals(pred: DerivedSpecies, species: readonly DerivedSpecies[]): { adult: number[]; juvenile: number[] } {
  return {
    adult: species.map((sp) => usableMeal(pred, pred.vertebrateIntakeG, sp.bodyMassG)),
    juvenile: species.map((sp) => usableMeal(pred, pred.vertebrateIntakeG, sp.bodyMassG * JUVENILE_SIZE_FACTOR)),
  };
}

/**
 * 各物种在每个区块里的拥挤程度（1 = 住满，见 breedingRoom）。当天开始时统计一次。
 * - 一般物种：区块平均每格只数 / 拥挤上限（区块边缘不满 8×8 时按实际格数算）。
 * - 不守固定领地的食肉动物：领地随食物伸缩，能住多少只取决于区块里可捕的猎物，
 *   每只要有 PREY_STOCK_DAYS 天的食量（Leslie–Gower 型数量反应）。
 */
export function crowdingByBlock(
  ctx: Pick<DailyContext, 'species' | 'populations' | 'blockOf' | 'prey'> & {
    cellsIn: Float64Array;
    /** 区块网格的宽度（按家域窗口统计拥挤时要用）。 */
    blocksWide: number;
    cover?: Float64Array;
  },
  extras: CrowdingExtras = {},
): Float64Array[] {
  const { blockOf, cellsIn, species, cover } = ctx;
  const blocks = cellsIn.length;
  // 各物种每个区块的：成体、出了窝的幼体、窝里的幼体（地面浅窝按各格掩护折算成"找得到的"只数）。
  const adults = species.map(() => new Float64Array(blocks));
  const mobileJuv = species.map(() => new Float64Array(blocks));
  const nestJuv = species.map(() => new Float64Array(blocks));
  const add = (into: Float64Array, cells: Int32Array, exposed: boolean): void => {
    for (let c = 0; c < cells.length; c++) {
      const n = cells[c]!;
      if (n === 0) continue;
      const b = blockOf[c]!;
      into[b] = into[b]! + (exposed && cover ? n * nestExposure(cover[c]!) : n);
    }
  };
  species.forEach((sp, s) => {
    const pop = ctx.populations[s]!;
    const pending = extras.pending?.[s];
    for (const p of pending ? [pop, pending] : [pop]) {
      add(adults[s]!, p.adults, false);
      p.juveniles.forEach((st, k) => {
        if (k >= sp.nestStages) add(mobileJuv[s]!, st, false);
        else add(nestJuv[s]!, st, sp.nest === 'ground');
      });
    }
  });
  const ind = extras.individuals;
  // 窝里的个体按实际只数另记（拥挤程度用），nestJuv 里的是按掩护折算过的。
  const nestRaw = species.map(() => new Float64Array(blocks));
  if (ind) {
    // 展开的个体按年龄归入成体、出了窝的幼体、窝里的幼体，和格子计数同一条规则（见 juvenileStageAt）。
    for (let i = 0; i < ind.count; i++) {
      const s = ind.species[i]!;
      const sp = species[s]!;
      const c = Math.floor(ind.y[i]!) * ind.width + Math.floor(ind.x[i]!);
      const b = blockOf[c]!;
      const k = juvenileStageAt(sp, ind.born[i]!, ind.day);
      if (k >= sp.juvenileStages) adults[s]![b] = adults[s]![b]! + 1;
      else if (k >= sp.nestStages) mobileJuv[s]![b] = mobileJuv[s]![b]! + 1;
      else {
        nestJuv[s]![b] = nestJuv[s]![b]! + (sp.nest === 'ground' && cover ? nestExposure(cover[c]!) : 1);
        nestRaw[s]![b] = nestRaw[s]![b]! + 1;
      }
    }
  }

  return species.map((sp, s) => {
    // 拥挤程度按实际只数算：窝里的幼体按 1 只算，不打掩护的折扣。
    // 守固定领地的只数成体：领地是成体占的，幼体还跟着母亲或在找地方。
    const out = new Float64Array(blocks);
    if (sp.territorial) {
      out.set(adults[s]!);
    } else {
      for (let b = 0; b < blocks; b++) out[b] = adults[s]![b]! + mobileJuv[s]![b]! + nestRaw[s]![b]!;
      rawJuvAdd(out, ctx.populations[s]!, extras.pending?.[s], blockOf, sp.nestStages);
    }
    const r = sp.crowdingRadiusBlocks;
    const bw = ctx.blocksWide;
    const counts = r > 0 ? windowSum(out, bw, r) : out;
    if (!sp.carnivore || sp.territorial) {
      const cells = r > 0 ? windowSum(cellsIn, bw, r) : cellsIn;
      for (let b = 0; b < blocks; b++) out[b] = counts[b]! / cells[b]! / sp.crowdingCapacity;
      return out;
    }
    const meals = preyMeals(sp, species);
    const mob = ctx.prey.mobile[s]!;
    const nst = ctx.prey.nest[s]!;
    const perPredator = sp.vertebrateIntakeG * PREY_STOCK_DAYS;
    const stock = new Float64Array(blocks);
    for (let b = 0; b < blocks; b++) {
      let st = 0;
      for (let j = 0; j < species.length; j++) {
        if (mob[j]! > 0) st += mob[j]! * (adults[j]![b]! * meals.adult[j]! + mobileJuv[j]![b]! * meals.juvenile[j]!);
        if (nst[j]! > 0) st += nst[j]! * nestJuv[j]![b]! * meals.juvenile[j]!;
      }
      stock[b] = st;
    }
    // 家域比区块大的，在家域那么大的窗口里比捕食者和猎物。
    const stocks = r > 0 ? windowSum(stock, bw, r) : stock;
    for (let b = 0; b < blocks; b++) {
      if (counts[b] === 0) {
        out[b] = 0;
        continue;
      }
      // 没有猎物：住不下（breedingRoom 为 0）。用有限的大数，免得以后参与运算出 NaN。
      out[b] = stocks[b]! > 0 ? (counts[b]! * perPredator) / stocks[b]! : NO_ROOM;
    }
    return out;
  });
}

/** 每个区块周围 (2r+1)² 个区块的和（地图边上只算地图里的）。 */
function windowSum(values: Float64Array, bw: number, r: number): Float64Array {
  const bh = values.length / bw;
  const out = new Float64Array(values.length);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      for (let y = Math.max(0, by - r); y <= Math.min(bh - 1, by + r); y++) {
        for (let x = Math.max(0, bx - r); x <= Math.min(bw - 1, bx + r); x++) sum += values[y * bw + x]!;
      }
      out[by * bw + bx] = sum;
    }
  }
  return out;
}

/** 把窝里的幼体按实际只数加进各区块的计数（crowdingByBlock 里 nestJuv 是按掩护折算过的，不能直接用）。 */
function rawJuvAdd(out: Float64Array, pop: Population, pending: Population | undefined, blockOf: Int32Array, nestStages: number): void {
  for (const p of pending ? [pop, pending] : [pop]) {
    for (let k = 0; k < nestStages; k++) {
      const st = p.juveniles[k]!;
      for (let c = 0; c < st.length; c++) {
        const n = st[c]!;
        if (n !== 0) out[blockOf[c]!] = out[blockOf[c]!]! + n;
      }
    }
  }
}

/**
 * 吃植被的分享这一格能啃的植被；草不够时再啃灌丛（灌丛长得慢，啃掉的掩护要很久才长回来）。
 * fed[s] 记下各物种植物这一类吃到的份额。
 */
function graze(ctx: DailyContext, c: number, fed: Float64Array): void {
  const { species, populations, grid, cellAreaM2 } = ctx;
  let demand = 0;
  for (let s = 0; s < species.length; s++) {
    const sp = species[s]!;
    if (!sp.grazer) continue;
    demand += sizeWeighted(populations[s]!, c) * sp.plantIntakeG;
  }
  let ratio = 1;
  if (demand > 0) {
    ratio = eatPlants(grid, c, demand, cellAreaM2, ctx.floorBiomass, ctx.shrubFloor) / demand;
  }
  for (let s = 0; s < species.length; s++) if (species[s]!.grazer) fed[s] = ratio;
}

/**
 * 一格里吃掉 demand 克植物（干物质），返回实际吃到的量。有灌丛的格子先按 BROWSE_SHARE 啃灌丛，其余吃草，
 * 草不够再拿灌丛补。草和灌丛每天最多被啃掉 MAX_GRAZE_FRACTION、MAX_BROWSE_FRACTION（够得着的部分）。
 * 格子模型一天调用一次（整格一起吃），个体模型每小时每只调用一次；没有灌丛的世界 shrubFloor 为 undefined。
 */
export function eatPlants(
  grid: Grid,
  c: number,
  demand: number,
  cellAreaM2: number,
  floorBiomass: number,
  shrubFloor: number | undefined,
): number {
  const shrubAvail = shrubFloor === undefined ? 0 : Math.max(0, grid.shrub[c]! - shrubFloor) * cellAreaM2 * MAX_BROWSE_FRACTION;
  let browsed = Math.min(demand * BROWSE_SHARE, shrubAvail);
  const veg = grid.vegetation[c]!;
  const grazed = Math.min(demand - browsed, Math.max(0, veg - floorBiomass) * cellAreaM2 * MAX_GRAZE_FRACTION);
  grid.vegetation[c] = veg - grazed / cellAreaM2;
  browsed = Math.min(demand - grazed, shrubAvail);
  if (browsed > 0) grid.shrub[c] = grid.shrub[c]! - browsed / cellAreaM2;
  return grazed + browsed;
}

/**
 * 吃无脊椎动物的分享这一格当天能找到的虫子（INVERTEBRATE_YIELD × 植被）；fed[s] 记下这一类吃到的份额。
 * 在吃草之后算：被啃光的地方虫子也少。
 */
function forage(ctx: DailyContext, c: number, fed: Float64Array): void {
  const { species, populations, grid, cellAreaM2 } = ctx;
  let demand = 0;
  for (let s = 0; s < species.length; s++) {
    const sp = species[s]!;
    if (sp.insectivore) demand += sizeWeighted(populations[s]!, c) * sp.invertebrateIntakeG;
  }
  const ratio = demand > 0 ? Math.min(1, (INVERTEBRATE_YIELD * grid.vegetation[c]! * cellAreaM2) / demand) : 1;
  for (let s = 0; s < species.length; s++) if (species[s]!.insectivore) fed[s] = ratio;
}

/** 一个捕食者物种在各区块的捕猎结果。 */
interface BlockHunting {
  /** 每只可捕猎物（适合度为 1 时）今天被抓的概率。 */
  kill: Float64Array;
  /** 捕食者吃饱的比例。 */
  fed: Float64Array;
}

/**
 * 捕食（II 型功能反应，带捕食者之间的分摊），按拥挤区块统计：
 *   可捕生物量 B = Σ 适合度 × 数量 × 一只能用上的肉量；需求 D = 捕食者数 × 日需求
 *   捕获量 = D · B / (B + 半饱和天数 · D)
 * 一个区块 8×8 格（50 米一格时 0.16 平方公里），和鼬类的家域相当（PanTHERIA：白鼬约 0.11、伶鼬约 0.07 平方公里）。
 * 捕食者一天要跑遍家域，只看自己那一格会让它在猎物稀疏时饿死，和展开后的个体对不上。
 * 捕食者吃饱的程度按期望捕获量算：一天抓到几只是随机的，但动物有体内储备，
 * 饿不饿取决于平均捕获率，不取决于某一天的运气。
 * 返回值按物种下标排列，食草动物是 null。
 */
function huntingByBlock(ctx: DailyContext, blocks: number): (BlockHunting | null)[] {
  const { species, populations, prey, blockOf } = ctx;
  return species.map((pred, s) => {
    if (!pred.predator) return null;
    const hunters = new Float64Array(blocks);
    const available = new Float64Array(blocks);
    const mob = prey.mobile[s]!;
    const nst = prey.nest[s]!;
    // 每种猎物（成体 / 幼体）抓到一只能派上用场的肉量，见 usableMeal。
    // 格子里的捕食者不分个体，按成体的需求算上限（幼体捕食者在个体模型里上限减半，是已知的小差别）。
    const { adult: adultMeal, juvenile: juvenileMeal } = preyMeals(pred, species);
    for (const c of ctx.land) {
      const b = blockOf[c]!;
      hunters[b] = hunters[b]! + sizeWeighted(populations[s]!, c);
      let avail = 0;
      for (let j = 0; j < species.length; j++) {
        if (mob[j] === 0 && nst[j] === 0) continue;
        const pop = populations[j]!;
        const ns = species[j]!.nestStages;
        const stages = pop.juveniles;
        let nested = 0;
        let mobile = 0;
        for (let k = 0; k < stages.length; k++) {
          if (k < ns) nested += stages[k]![c]!;
          else mobile += stages[k]![c]!;
        }
        avail += mob[j]! * (pop.adults[c]! * adultMeal[j]! + mobile * juvenileMeal[j]!);
        avail += nestWeight(ctx, s, j, c) * nested * juvenileMeal[j]!;
      }
      available[b] = available[b]! + avail;
    }
    const kill = new Float64Array(blocks);
    const fed = new Float64Array(blocks);
    for (let b = 0; b < blocks; b++) {
      const demand = hunters[b]! * pred.vertebrateIntakeG;
      const avail = available[b]!;
      if (demand === 0) {
        fed[b] = 1;
        continue;
      }
      if (avail <= 0) continue;
      // 捕获量不会超过区块里实际可捕的猎物。
      const captured = Math.min(avail, (demand * avail) / (avail + PREDATION_HALF_SATURATION_DAYS * demand));
      kill[b] = captured / avail;
      fed[b] = captured / demand;
    }
    return { kill, fed };
  });
}

/** 捕食者 s 对第 c 格里猎物 j 窝里幼体的捕食权重：地面浅窝再乘这一格的暴露程度。 */
function nestWeight(ctx: DailyContext, s: number, j: number, c: number): number {
  const w = ctx.prey.nest[s]![j]!;
  return w > 0 && ctx.species[j]!.nest === 'ground' ? w * nestExposure(ctx.grid.cover[c]!) : w;
}

/** 按区块的捕猎结果，在这一格里抽出被抓的猎物；fed[s] 记下捕食者脊椎动物这一类吃到的份额。 */
function hunt(ctx: DailyContext, c: number, hunting: readonly (BlockHunting | null)[], fed: Float64Array, stats: DayStats[]): void {
  const { species, populations, prey, rng } = ctx;
  const b = ctx.blockOf[c]!;
  for (let s = 0; s < species.length; s++) {
    const h = hunting[s];
    if (!h) continue;
    fed[s] = h.fed[b]!;
    const kill = h.kill[b]!;
    if (kill === 0) continue;
    const mob = prey.mobile[s]!;
    for (let j = 0; j < species.length; j++) {
      const wn = nestWeight(ctx, s, j, c);
      if (mob[j] === 0 && wn === 0) continue;
      // 每只该种猎物今天被抓的概率：会跑的按 mobile，窝里的按 nest。
      const pMobile = Math.min(1, kill * mob[j]!);
      const pNest = Math.min(1, kill * wn);
      const pop = populations[j]!;
      const ka = binomial(rng, pop.adults[c]!, pMobile);
      pop.adults[c] = pop.adults[c]! - ka;
      stats[j]!.deathsPredation += ka;
      recordDeaths(ctx.ledger, j, CAUSE.predation(s), b, ka);
      const ns = species[j]!.nestStages;
      const stages = pop.juveniles;
      for (let k = 0; k < stages.length; k++) {
        const stage = stages[k]!;
        const kj = binomial(rng, stage[c]!, k < ns ? pNest : pMobile);
        stage[c] = stage[c]! - kj;
        stats[j]!.deathsPredation += kj;
        // 写了窝类型的物种，窝里的被吃算"巢失败"；阶段 0 的物种没有窝的概念，都算被捕食。
        const nested = k < ns && species[j]!.nest !== null;
        recordDeaths(ctx.ledger, j, nested ? CAUSE.nest(s) : CAUSE.predation(s), b, kj);
      }
    }
  }
}

/**
 * 一个物种在一格里的出生、死亡、长大。
 * fedRatio 是今天吃饱的比例；crowding 是所在区块的拥挤程度（1 = 住满）。
 */
function lifeCycle(ctx: DailyContext, s: number, c: number, fedRatio: number, crowding: number, st: DayStats): void {
  const sp = ctx.species[s]!;
  const pop = ctx.populations[s]!;
  const rng = ctx.rng;
  let adults = pop.adults[c]!;

  // 出生：约一半成体是雌性；繁殖期内、按吃饱程度打折，越拥挤生得越少。新生的进第 0 段。
  const breeding = ctx.breeding[s]!;
  const room = breedingRoom(sp, crowding);
  let born = 0;
  if (breeding > 0 && adults > 0 && room > 0) {
    const pLitter = 0.5 * breeding * sp.litterRate * Math.min(1, fedRatio / FED_SUFFICIENT) * room;
    const litters = binomial(rng, adults, Math.min(1, pLitter));
    if (litters > 0) {
      const size = sp.params.reproduction.litterSize;
      const whole = Math.floor(size);
      born = litters * whole + binomial(rng, litters, size - whole);
      st.births += born;
    }
  }

  // 死亡：基础死亡（衰老、疾病、意外）+ 饥饿。先抽总数，再按比例分死因。
  const starve = sp.starvationRate * Math.max(0, 1 - fedRatio / FED_SUFFICIENT);
  const block = ctx.blockOf[c]!;
  adults -= dieOff(ctx, s, block, adults, sp.adultDailyMortality, starve, st);
  const stages = pop.juveniles;
  for (const stage of stages) {
    stage[c] = stage[c]! - dieOff(ctx, s, block, stage[c]!, sp.juvenileDailyMortality, starve, st);
  }

  // 长大由传送带负责（见 shiftStages）；新生的进第 0 段。
  stages[0]![c] = stages[0]![c]! + born;

  pop.adults[c] = adults;
}

function dieOff(ctx: DailyContext, s: number, block: number, n: number, base: number, starve: number, st: DayStats): number {
  if (n === 0) return 0;
  const rng = ctx.rng;
  const p = Math.min(1, base + starve);
  const dead = binomial(rng, n, p);
  if (dead > 0) {
    // 按两种死因各自的比重拆分（p 被截到 1 时也保持比例）。
    const starved = starve > 0 ? binomial(rng, dead, starve / (base + starve)) : 0;
    st.deathsStarvation += starved;
    st.deathsOther += dead - starved;
    recordDeaths(ctx.ledger, s, CAUSE.starvation, block, starved);
    recordDeaths(ctx.ledger, s, CAUSE.other, block, dead - starved);
  }
  return dead;
}

/**
 * 扩散：每格有一部分个体离开，落到半径 r 内的随机一格；落到地图外、水里，或者路上要过水，就留在原地。
 * 所以离岸小岛和主岛之间，靠扩散是过不去的（以后要做"会游泳"的性状再改）。
 * 先把移动量写进暂存数组，最后一起加回去，结果与遍历顺序无关。
 */
function disperse(ctx: DailyContext, s: number, counts: Int32Array): void {
  const sp = ctx.species[s]!;
  const { width, height, terrain } = ctx.grid;
  const rng = ctx.rng;
  const incoming = ctx.scratch;
  incoming.fill(0);
  const r = sp.moveRadius;
  const span = 2 * r + 1;

  const cellsInSpan = span * span;
  const move = (c: number, x: number, y: number, k: number): void => {
    // 一次抽出落点在 span×span 方块里的位置，等价于分别抽横纵偏移。
    const o = rng.nextInt(cellsInSpan);
    const dx = (o % span) - r;
    const dy = Math.floor(o / span) - r;
    const nx = x + dx;
    const ny = y + dy;
    if ((dx === 0 && dy === 0) || nx < 0 || ny < 0 || nx >= width || ny >= height) return;
    if (crossesWater(terrain, width, x + 0.5, y + 0.5, nx + 0.5, ny + 0.5)) return;
    counts[c] = counts[c]! - k;
    incoming[ny * width + nx] = incoming[ny * width + nx]! + k;
  };

  for (const c of ctx.land) {
    const x = c % width;
    const y = (c - x) / width;
    const n = counts[c]!;
    if (n === 0) continue;
    let moving = binomial(rng, n, sp.moveProb);
    if (moving === 0) continue;
    if (moving <= 16) {
      // 数量少时一只一只走。
      for (let k = 0; k < moving; k++) move(c, x, y, 1);
    } else {
      // 数量多时平均分成 8 群，每群一起走。
      for (let g = 8; g > 0; g--) {
        const k = g === 1 ? moving : binomial(rng, moving, 1 / g);
        if (k > 0) move(c, x, y, k);
        moving -= k;
      }
    }
  }
  for (let c = 0; c < counts.length; c++) counts[c] = counts[c]! + incoming[c]!;
}
