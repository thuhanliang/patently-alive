import type { Grid } from './grid';
import {
  CROWDING_BLOCK_CELLS,
  FED_SUFFICIENT,
  JUVENILE_SIZE_FACTOR,
  JUVENILE_STAGES,
  MAX_GRAZE_FRACTION,
  NEST_STAGES,
  PREDATION_HALF_SATURATION_DAYS,
  type DerivedSpecies,
} from './physiology';
import type { Rng } from './rng';
import { binomial, stochasticRound } from './sample';

/**
 * 按格子的种群：每个物种每格存幼体（分 JUVENILE_STAGES 个年龄段）和成体的整数计数。
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
}

export function emptyDayStats(total = 0): DayStats {
  return { total, births: 0, deathsPredation: 0, deathsStarvation: 0, deathsOther: 0, released: 0 };
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
  for (let i = 0; i < p.adults.length; i++) t += countAt(p, i);
  return t;
}

export function createPopulation(
  species: DerivedSpecies,
  grid: Grid,
  cellAreaM2: number,
  rng: Rng,
): Population {
  const n = grid.width * grid.height;
  const adults = new Int32Array(n);
  const mean = (species.params.initialDensityPerHa * cellAreaM2) / 10_000;
  for (let i = 0; i < n; i++) {
    // 开局分布有起伏：均值附近的二项抽样，均值很小时退化成按概率放一只。
    const trials = Math.max(1, Math.ceil(mean * 2));
    adults[i] = mean >= 1 ? binomial(rng, trials, mean / trials) : stochasticRound(rng, mean);
  }
  return { juveniles: Array.from({ length: JUVENILE_STAGES }, () => new Int32Array(n)), adults };
}

export interface DailyContext {
  species: readonly DerivedSpecies[];
  /** suitability[捕食者][猎物]。 */
  prey: readonly (readonly number[])[];
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
}

/**
 * 一天的种群推演，逐格进行：捕食 → 进食 → 出生 → 死亡，最后整张图一起扩散。
 * （长大由传送带在这之前统一挪段，见 shiftStages。）
 * 先捕食：今天被吃掉的动物不再分走植被。
 * 返回各物种当天的账目。
 */
export function dailyPopulation(ctx: DailyContext): DayStats[] {
  const { species, populations, grid } = ctx;
  const stats = species.map(() => emptyDayStats());
  const cells = grid.width * grid.height;
  const fed = new Float64Array(species.length);
  const { crowding, blockOf } = ctx;

  for (let c = 0; c < cells; c++) {
    hunt(ctx, c, fed, stats);
    graze(ctx, c, fed);
    const block = blockOf[c]!;
    for (let s = 0; s < species.length; s++) {
      if (countAt(populations[s]!, c) > 0) {
        lifeCycle(ctx, s, c, fed[s]!, crowding[s]![block]!, stats[s]!);
      }
    }
  }

  for (let s = 0; s < species.length; s++) {
    disperse(ctx, s, populations[s]!.adults);
    // 窝里的幼崽不扩散。
    const stages = populations[s]!.juveniles;
    for (let k = NEST_STAGES; k < stages.length; k++) disperse(ctx, s, stages[k]!);
    stats[s]!.total = populationTotal(populations[s]!);
  }
  return stats;
}

/** 某格所在拥挤区块的下标。 */
export function crowdingBlockOf(width: number, x: number, y: number): number {
  const bw = Math.ceil(width / CROWDING_BLOCK_CELLS);
  return Math.floor(y / CROWDING_BLOCK_CELLS) * bw + Math.floor(x / CROWDING_BLOCK_CELLS);
}

/** 每格属于哪个区块，以及每个区块有几格（边缘区块不满）。地图建好后算一次。 */
export function crowdingBlocks(width: number, height: number): { blockOf: Int32Array; cellsIn: Float64Array } {
  const bw = Math.ceil(width / CROWDING_BLOCK_CELLS);
  const bh = Math.ceil(height / CROWDING_BLOCK_CELLS);
  const blockOf = new Int32Array(width * height);
  const cellsIn = new Float64Array(bw * bh);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = crowdingBlockOf(width, x, y);
      blockOf[y * width + x] = b;
      cellsIn[b] = cellsIn[b]! + 1;
    }
  }
  return { blockOf, cellsIn };
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
  individuals?: { count: number; species: Uint8Array; x: Float64Array; y: Float64Array };
  /** 个体坐标换算格子下标用的地图宽度。 */
  width?: number;
  pending?: readonly Population[];
}

/**
 * 各物种在每个区块里的拥挤程度：区块平均每格只数 / 拥挤上限。
 * 当天开始时统计一次（区块边缘不满 8×8 时按实际格数算）。
 */
export function crowdingByBlock(
  ctx: Pick<DailyContext, 'species' | 'populations' | 'blockOf'> & { cellsIn: Float64Array },
  extras: CrowdingExtras = {},
): Float64Array[] {
  const { blockOf, cellsIn } = ctx;
  return ctx.species.map((sp, s) => {
    const pop = ctx.populations[s]!;
    const pending = extras.pending?.[s];
    const out = new Float64Array(cellsIn.length);
    const add = (counts: Int32Array): void => {
      for (let c = 0; c < counts.length; c++) {
        const n = counts[c]!;
        if (n !== 0) out[blockOf[c]!] = out[blockOf[c]!]! + n;
      }
    };
    add(pop.adults);
    for (const st of pop.juveniles) add(st);
    if (pending) {
      add(pending.adults);
      for (const st of pending.juveniles) add(st);
    }
    const ind = extras.individuals;
    if (ind && extras.width) {
      for (let i = 0; i < ind.count; i++) {
        if (ind.species[i] !== s) continue;
        const b = blockOf[Math.floor(ind.y[i]!) * extras.width + Math.floor(ind.x[i]!)]!;
        out[b] = out[b]! + 1;
      }
    }
    for (let b = 0; b < out.length; b++) out[b] = out[b]! / cellsIn[b]! / sp.crowdingCapacity;
    return out;
  });
}

/** 食草动物分享这一格能啃的植被；fed[s] 记下各物种吃饱的比例。 */
function graze(ctx: DailyContext, c: number, fed: Float64Array): void {
  const { species, populations, grid, cellAreaM2 } = ctx;
  let demand = 0;
  for (let s = 0; s < species.length; s++) {
    const sp = species[s]!;
    if (!sp.herbivore) continue;
    demand += sizeWeighted(populations[s]!, c) * sp.dailyIntakeG;
  }
  let ratio = 1;
  if (demand > 0) {
    const veg = grid.vegetation[c]!;
    const available = Math.max(0, veg - ctx.floorBiomass) * cellAreaM2 * MAX_GRAZE_FRACTION;
    const eaten = Math.min(demand, available);
    ratio = eaten / demand;
    grid.vegetation[c] = veg - eaten / cellAreaM2;
  }
  for (let s = 0; s < species.length; s++) if (species[s]!.herbivore) fed[s] = ratio;
}

/**
 * 捕食（II 型功能反应，带捕食者之间的分摊）：
 *   可捕生物量 B = Σ 适合度 × 数量 × 体重；需求 D = 捕食者数 × 日需求
 *   捕获量 = D · B / (B + 半饱和天数 · D)
 * 再按各猎物在 B 里的份额分摊成每种猎物的死亡概率。
 * 捕食者吃饱的程度按期望捕获量算：一天抓到几只是随机的，但动物有体内储备，
 * 饿不饿取决于平均捕获率，不取决于某一天的运气。
 */
function hunt(ctx: DailyContext, c: number, fed: Float64Array, stats: DayStats[]): void {
  const { species, populations, prey, rng } = ctx;
  for (let s = 0; s < species.length; s++) {
    const pred = species[s]!;
    if (pred.herbivore) continue;
    const hunters = sizeWeighted(populations[s]!, c);
    if (hunters === 0) {
      fed[s] = 1;
      continue;
    }
    const row = prey[s]!;
    let available = 0;
    for (let j = 0; j < species.length; j++) {
      const w = row[j]!;
      if (w === 0) continue;
      available += w * sizeWeighted(populations[j]!, c) * species[j]!.bodyMassG;
    }
    const demand = hunters * pred.dailyIntakeG;
    if (available <= 0) {
      fed[s] = 0;
      continue;
    }
    // 捕获量不会超过格子里实际可捕的猎物。
    const captured = Math.min(available, (demand * available) / (available + PREDATION_HALF_SATURATION_DAYS * demand));
    for (let j = 0; j < species.length; j++) {
      const w = row[j]!;
      if (w === 0) continue;
      // 每只该种猎物今天被抓的概率。
      const p = Math.min(1, (captured * w) / available);
      const pop = populations[j]!;
      const ka = binomial(rng, pop.adults[c]!, p);
      pop.adults[c] = pop.adults[c]! - ka;
      stats[j]!.deathsPredation += ka;
      for (const stage of pop.juveniles) {
        const kj = binomial(rng, stage[c]!, p);
        stage[c] = stage[c]! - kj;
        stats[j]!.deathsPredation += kj;
      }
    }
    fed[s] = captured / demand;
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
  const room = 1 - crowding;
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
  adults -= dieOff(rng, adults, sp.adultDailyMortality, starve, st);
  const stages = pop.juveniles;
  for (const stage of stages) {
    stage[c] = stage[c]! - dieOff(rng, stage[c]!, sp.juvenileDailyMortality, starve, st);
  }

  // 长大由传送带负责（见 shiftStages）；新生的进第 0 段。
  stages[0]![c] = stages[0]![c]! + born;

  pop.adults[c] = adults;
}

function dieOff(rng: Rng, n: number, base: number, starve: number, st: DayStats): number {
  if (n === 0) return 0;
  const p = Math.min(1, base + starve);
  const dead = binomial(rng, n, p);
  if (dead > 0) {
    // 按两种死因各自的比重拆分（p 被截到 1 时也保持比例）。
    const starved = starve > 0 ? binomial(rng, dead, starve / (base + starve)) : 0;
    st.deathsStarvation += starved;
    st.deathsOther += dead - starved;
  }
  return dead;
}

/**
 * 扩散：每格有一部分个体离开，落到半径 r 内的随机一格；落到地图外就留在原地。
 * 先把移动量写进暂存数组，最后一起加回去，结果与遍历顺序无关。
 */
function disperse(ctx: DailyContext, s: number, counts: Int32Array): void {
  const sp = ctx.species[s]!;
  const { width, height } = ctx.grid;
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
    counts[c] = counts[c]! - k;
    incoming[ny * width + nx] = incoming[ny * width + nx]! + k;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const c = y * width + x;
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
  }
  for (let c = 0; c < counts.length; c++) counts[c] = counts[c]! + incoming[c]!;
}
