import type { Grid } from './grid';
import { FED_SUFFICIENT, MAX_GRAZE_FRACTION, PREDATION_HALF_SATURATION_DAYS, type DerivedSpecies } from './physiology';
import type { Rng } from './rng';
import { binomial, stochasticRound } from './sample';

/**
 * 按格子的种群：每个物种每格存幼体、成体两个整数计数。
 * 整数计数让"守恒"可以精确断言：每只动物的增减都有一笔账。
 */
export interface Population {
  juveniles: Int32Array;
  adults: Int32Array;
}

/** 一个物种一天的账目。 */
export interface DayStats {
  total: number;
  births: number;
  deathsPredation: number;
  deathsStarvation: number;
  deathsOther: number;
}

export function emptyDayStats(total = 0): DayStats {
  return { total, births: 0, deathsPredation: 0, deathsStarvation: 0, deathsOther: 0 };
}

export function populationTotal(p: Population): number {
  let t = 0;
  for (let i = 0; i < p.adults.length; i++) t += p.adults[i]! + p.juveniles[i]!;
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
  return { juveniles: new Int32Array(n), adults };
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
}

/**
 * 一天的种群推演，逐格进行：进食 → 捕食 → 出生 → 死亡 → 长大，最后整张图一起扩散。
 * 返回各物种当天的账目。
 */
export function dailyPopulation(ctx: DailyContext): DayStats[] {
  const { species, populations, grid } = ctx;
  const stats = species.map(() => emptyDayStats());
  const cells = grid.width * grid.height;
  const fed = new Float64Array(species.length);

  for (let c = 0; c < cells; c++) {
    graze(ctx, c, fed);
    hunt(ctx, c, fed, stats);
    for (let s = 0; s < species.length; s++) {
      if (populations[s]!.adults[c]! + populations[s]!.juveniles[c]! > 0) {
        lifeCycle(ctx, s, c, fed[s]!, stats[s]!);
      }
    }
  }

  for (let s = 0; s < species.length; s++) {
    disperse(ctx, s, populations[s]!.adults);
    disperse(ctx, s, populations[s]!.juveniles);
    stats[s]!.total = populationTotal(populations[s]!);
  }
  return stats;
}

/** 食草动物分享这一格能啃的植被；fed[s] 记下各物种吃饱的比例。 */
function graze(ctx: DailyContext, c: number, fed: Float64Array): void {
  const { species, populations, grid, cellAreaM2 } = ctx;
  let demand = 0;
  for (let s = 0; s < species.length; s++) {
    const sp = species[s]!;
    if (!sp.herbivore) continue;
    demand += (populations[s]!.adults[c]! + populations[s]!.juveniles[c]!) * sp.dailyIntakeG;
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
    const hunters = populations[s]!.adults[c]! + populations[s]!.juveniles[c]!;
    if (hunters === 0) {
      fed[s] = 1;
      continue;
    }
    const row = prey[s]!;
    let available = 0;
    for (let j = 0; j < species.length; j++) {
      const w = row[j]!;
      if (w === 0) continue;
      available += w * (populations[j]!.adults[c]! + populations[j]!.juveniles[c]!) * species[j]!.bodyMassG;
    }
    const demand = hunters * pred.dailyIntakeG;
    if (available <= 0) {
      fed[s] = 0;
      continue;
    }
    const captured = (demand * available) / (available + PREDATION_HALF_SATURATION_DAYS * demand);
    for (let j = 0; j < species.length; j++) {
      const w = row[j]!;
      if (w === 0) continue;
      // 每只该种猎物今天被抓的概率。
      const p = Math.min(1, (captured * w) / available);
      const pop = populations[j]!;
      const ka = binomial(rng, pop.adults[c]!, p);
      const kj = binomial(rng, pop.juveniles[c]!, p);
      pop.adults[c] = pop.adults[c]! - ka;
      pop.juveniles[c] = pop.juveniles[c]! - kj;
      stats[j]!.deathsPredation += ka + kj;
    }
    fed[s] = captured / demand;
  }
}

/** 一个物种在一格里的出生、死亡、长大。fedRatio 是今天吃饱的比例。 */
function lifeCycle(ctx: DailyContext, s: number, c: number, fedRatio: number, st: DayStats): void {
  const sp = ctx.species[s]!;
  const pop = ctx.populations[s]!;
  const rng = ctx.rng;
  let adults = pop.adults[c]!;
  let juveniles = pop.juveniles[c]!;

  // 出生：约一半成体是雌性；繁殖期内、按吃饱程度打折，越拥挤生得越少。
  const breeding = ctx.breeding[s]!;
  const room = 1 - (adults + juveniles) / sp.crowdingCapacity;
  if (breeding > 0 && adults > 0 && room > 0) {
    const pLitter = 0.5 * breeding * sp.litterRate * Math.min(1, fedRatio / FED_SUFFICIENT) * room;
    const litters = binomial(rng, adults, Math.min(1, pLitter));
    if (litters > 0) {
      const size = sp.params.reproduction.litterSize;
      const whole = Math.floor(size);
      const born = litters * whole + binomial(rng, litters, size - whole);
      juveniles += born;
      st.births += born;
    }
  }

  // 死亡：基础死亡（衰老、疾病、意外）+ 饥饿。先抽总数，再按比例分死因。
  const starve = sp.starvationRate * Math.max(0, 1 - fedRatio / FED_SUFFICIENT);
  const deathsA = dieOff(rng, adults, sp.adultDailyMortality, starve, st);
  const deathsJ = dieOff(rng, juveniles, sp.juvenileDailyMortality, starve, st);
  adults -= deathsA;
  juveniles -= deathsJ;

  // 长大。
  const grown = binomial(rng, juveniles, sp.maturationRate);
  juveniles -= grown;
  adults += grown;

  pop.adults[c] = adults;
  pop.juveniles[c] = juveniles;
}

function dieOff(rng: Rng, n: number, base: number, starve: number, st: DayStats): number {
  if (n === 0) return 0;
  const p = Math.min(1, base + starve);
  const dead = binomial(rng, n, p);
  if (dead > 0) {
    const starved = starve > 0 ? binomial(rng, dead, starve / p) : 0;
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

  const move = (c: number, x: number, y: number, k: number): void => {
    const dx = rng.nextInt(span) - r;
    const dy = rng.nextInt(span) - r;
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
