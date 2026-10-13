import type { SpeciesParams } from '../data/schema/species';
import { detPow } from './detmath';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from './time';

/**
 * 从性状推导模拟参数。这里的公式就是引擎的"规律层"：
 * 物种数据只给性状，吃多少、谁吃谁、饿多久会死，全在这里算（铁律 4、5）。
 */

/** 食草动物每天的干物质摄入量（克）≈ 70 · M^0.75（M 为千克），即代谢体重缩放。 */
const HERBIVORE_INTAKE_COEF = 70;
/** 食肉动物每天需要的猎物鲜重（克）≈ 230 · M^0.75。白鼬约 80 克，接近体重的三分之一。 */
const CARNIVORE_INTAKE_COEF = 230;
/** 完全吃不到东西时每天的饿死概率 ≈ 0.12 · M^−0.25：越小的动物撑得越短。 */
const STARVATION_COEF = 0.12;
/** 吃到需求的这个比例就不会挨饿；低于它时饿死概率随缺口线性上升。 */
export const FED_SUFFICIENT = 0.6;
/**
 * Damuth 定律：哺乳动物的典型种群密度 ≈ 10^4.23 · M^−0.75 只 / 平方公里（M 为克）。
 * 局部密度超过典型密度的 CROWDING_FACTOR 倍时就不再繁殖（领地、社会压制），
 * 之间线性下降。这是引擎规律，物种数据里只有体重。
 */
const DAMUTH_COEF = 16982;
const CROWDING_FACTOR = 20;
/** 拥挤程度按多大的区块统计（格）。动物会在几格之间走动，单格计数太跳。 */
export const CROWDING_BLOCK_CELLS = 8;
/**
 * 幼体的"传送带"：格子里的幼体分成几个年龄段，每个物种每隔 stageDays 天（性成熟天数 ÷ 段数）
 * 整体往前挪一段，最后一段并入成体。挪段只是交换数组，不用抽随机数。
 * stageDays = ⌊性成熟天数 / 段数⌋，成熟时间落在 (段数−1)·stageDays+1 到 段数·stageDays 天之间，
 * 不晚于性状给的性成熟年龄；个体用同一条规则判断是否成年
 * （见 juvenileStageAt），所以展开、收拢严格对得上。
 */
export const JUVENILE_STAGES = 4;
/** 前这么多个年龄段的幼体还在窝里、跟着母亲，不自己扩散（个体里对应年龄不到性成熟一半的幼崽不走动）。 */
export const NEST_STAGES = JUVENILE_STAGES / 2;
/** 幼体按成体的这个比例算食量和体重（从刚出生到长成的平均）。 */
export const JUVENILE_SIZE_FACTOR = 0.5;
/** 幼体的基础日死亡率是成体的几倍。 */
const JUVENILE_MORTALITY_FACTOR = 2.5;
/** 一天里一格植被最多被啃掉的比例（剩下的够不着或不爱吃）。 */
export const MAX_GRAZE_FRACTION = 0.05;
/** 食肉动物的半饱和系数（天）：格子里的可捕猎物够它们吃这么多天时，捕获率达到一半。 */
export const PREDATION_HALF_SATURATION_DAYS = 0.5;
/** 扩散一跳的最大格数，限制计算量。 */
const MAX_MOVE_RADIUS = 8;

/** 个体的体内储备上限（够吃几天）≈ 2 · M^0.25：大动物撑得久。 */
const RESERVE_COEF = 2;
/** 捕食者在这个距离（格）内碰上活动中的猎物才有机会抓。 */
export const CATCH_RADIUS_CELLS = 0.3;
/** 碰上之后、体型完全合适时的捕获成功率。 */
export const CATCH_SUCCESS = 0.3;
/** 吃够当天需求的这么多倍就不再捕猎（和格子模型一致：吃饱为止）。 */
export const SATIATION = 1;

export interface DerivedSpecies {
  readonly params: SpeciesParams;
  readonly herbivore: boolean;
  readonly bodyMassG: number;
  /** 每天的食物需求：食草为干物质克数，食肉为猎物鲜重克数。 */
  readonly dailyIntakeG: number;
  readonly adultDailyMortality: number;
  readonly juvenileDailyMortality: number;
  readonly starvationRate: number;
  /** 幼体传送带每隔几天挪一段。 */
  readonly stageDays: number;
  /** 繁殖期内每只雌性每天产一窝的概率。 */
  readonly litterRate: number;
  /** 平均每格住到这么多只就不再繁殖（按区块统计）。 */
  readonly crowdingCapacity: number;
  /** 每天离开所在格子的概率，以及一跳的最大格数。 */
  readonly moveProb: number;
  readonly moveRadius: number;
  /** 个体：活动时每小时走多远（格）。 */
  readonly hourlyStepCells: number;
  /** 个体：一天里活动的小时数。 */
  readonly activeHours: number;
  /** 个体：体内储备上限（天）。 */
  readonly maxReserveDays: number;
  readonly maxAgeDays: number;
}

export function deriveSpecies(p: SpeciesParams, cellSizeM: number): DerivedSpecies {
  const herbivore = p.diet === 'herbivore';
  const metabolicMass = detPow(p.bodyMassKg, 0.75);
  const adultDailyMortality = 1 - detPow(p.survival.adultAnnual, 1 / DAYS_PER_YEAR);
  const cellsPerDay = p.movement.dailyRangeM / cellSizeM;
  // 最长一段连续繁殖期的天数；它比两窝间隔还短时，每段繁殖期只够生一窝。
  const breedingDays = longestSeasonDays(p.reproduction.breedingByMonth);
  const typicalPerKm2 = DAMUTH_COEF * detPow(p.bodyMassKg * 1000, -0.75);
  const cellKm2 = (cellSizeM * cellSizeM) / 1_000_000;
  return {
    params: p,
    herbivore,
    bodyMassG: p.bodyMassKg * 1000,
    dailyIntakeG: (herbivore ? HERBIVORE_INTAKE_COEF : CARNIVORE_INTAKE_COEF) * metabolicMass,
    adultDailyMortality,
    juvenileDailyMortality: Math.min(1, adultDailyMortality * JUVENILE_MORTALITY_FACTOR),
    starvationRate: Math.min(1, STARVATION_COEF * detPow(p.bodyMassKg, -0.25)),
    stageDays: Math.max(1, Math.floor(p.reproduction.ageAtMaturityDays / JUVENILE_STAGES)),
    litterRate: breedingDays > 0 ? 1 / Math.min(p.reproduction.litterIntervalDays, breedingDays) : 0,
    crowdingCapacity: typicalPerKm2 * CROWDING_FACTOR * cellKm2,
    moveProb: Math.min(0.5, cellsPerDay / 2),
    moveRadius: Math.max(1, Math.min(MAX_MOVE_RADIUS, Math.round(cellsPerDay / 2))),
    hourlyStepCells: cellsPerDay / activeHoursPerDay(p.activity),
    activeHours: activeHoursPerDay(p.activity),
    maxReserveDays: RESERVE_COEF * detPow(p.bodyMassKg, 0.25),
    maxAgeDays: Math.round(p.maxLifespanYears * DAYS_PER_YEAR),
  };
}

/** 最长一段连续（跨年也算连续）繁殖期的天数，按各月比例累加。 */
function longestSeasonDays(byMonth: readonly number[]): number {
  if (byMonth.every((m) => m > 0)) return byMonth.reduce((a, b) => a + b, 0) * DAYS_PER_MONTH;
  let best = 0;
  let run = 0;
  // 走两圈，处理跨年的繁殖期。
  for (let i = 0; i < byMonth.length * 2; i++) {
    const m = byMonth[i % byMonth.length]!;
    run = m > 0 ? run + m : 0;
    if (run > best) best = run;
  }
  return best * DAYS_PER_MONTH;
}

/** 由配置推导全部物种参数和捕食矩阵；状态初始化和推演都用这一处，保证一致。 */
export function deriveAll(species: readonly SpeciesParams[], cellSizeM: number): {
  derived: DerivedSpecies[];
  prey: number[][];
} {
  const derived = species.map((s) => deriveSpecies(s, cellSizeM));
  return { derived, prey: preyMatrix(derived) };
}

/**
 * 第 born 天出生的个体，到第 day 天时在传送带上的哪一段：0..JUVENILE_STAGES−1 是幼体，
 * JUVENILE_STAGES 表示已成年。等于它出生以来传送带挪过几次
 * （每个 day % stageDays === 0 的日子挪一次，在那天的出生之前挪）。
 * day 指"传送带最近一次可能挪段的那一天"，即最近一次每日结算所在的天（见 Sim.day）。
 */
export function juvenileStageAt(sp: Pick<DerivedSpecies, 'stageDays'>, born: number, day: number): number {
  const shifts = Math.floor(day / sp.stageDays) - Math.floor(born / sp.stageDays);
  return Math.min(JUVENILE_STAGES, shifts);
}

type Activity = SpeciesParams['activity'];

/**
 * 各活动时段在一天 24 小时里哪些小时活动（个体用）。
 * 昼行 6–17 时；夜行 18–5 时；晨昏 4–7 时和 17–20 时；全天型全天都可能活动。
 */
const ACTIVE_HOURS: Record<Activity, readonly boolean[]> = {
  diurnal: hoursMask((h) => h >= 6 && h < 18),
  nocturnal: hoursMask((h) => h >= 18 || h < 6),
  crepuscular: hoursMask((h) => (h >= 4 && h < 8) || (h >= 17 && h < 21)),
  cathemeral: hoursMask(() => true),
};

function hoursMask(f: (h: number) => boolean): boolean[] {
  return Array.from({ length: 24 }, (_, h) => f(h));
}

export function isActive(activity: Activity, hour: number): boolean {
  return ACTIVE_HOURS[activity][hour]!;
}

export function activeHoursPerDay(activity: Activity): number {
  return ACTIVE_HOURS[activity].filter(Boolean).length;
}

const ACTIVITY_INDEX: Record<Activity, number> = { diurnal: 0, nocturnal: 1, crepuscular: 2, cathemeral: 3 };
/** 两种活动时段碰上的程度（对称）。晨昏型和昼行、夜行都有一半重叠。 */
const ACTIVITY_OVERLAP = [
  [1.0, 0.1, 0.5, 0.6],
  [0.1, 1.0, 0.5, 0.6],
  [0.5, 0.5, 1.0, 0.6],
  [0.6, 0.6, 0.6, 0.8],
];

export function activityOverlap(a: Activity, b: Activity): number {
  return ACTIVITY_OVERLAP[ACTIVITY_INDEX[a]]![ACTIVITY_INDEX[b]]!;
}

/**
 * 体型适合度：猎物体重 / 捕食者体重之比 → [0, 1]。
 * 太小不值得抓，和自己差不多大或更大就越来越难抓。分段线性。
 */
const SIZE_RATIO_POINTS: Array<[number, number]> = [
  [0.005, 0],
  [0.02, 0.5],
  [0.05, 1],
  [0.5, 1],
  [1, 0.6],
  [3, 0.3],
  [8, 0],
];

export function sizeSuitability(preyToPredatorMass: number): number {
  const pts = SIZE_RATIO_POINTS;
  if (preyToPredatorMass <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    if (preyToPredatorMass <= x1) {
      const [x0, y0] = pts[i - 1]!;
      return y0 + ((y1 - y0) * (preyToPredatorMass - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1]![1];
}

/**
 * 捕食矩阵：suitability[捕食者][猎物] ∈ [0, 1] = 体型适合度 × 活动时段重叠。
 * 只有食肉动物有非零行；不吃同种。
 */
export function preyMatrix(species: readonly DerivedSpecies[]): number[][] {
  return species.map((pred, i) =>
    species.map((prey, j) => {
      if (pred.herbivore || i === j) return 0;
      return sizeSuitability(prey.bodyMassG / pred.bodyMassG) * activityOverlap(pred.params.activity, prey.params.activity);
    }),
  );
}
