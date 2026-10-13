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
/** 幼体的基础日死亡率是成体的几倍。 */
const JUVENILE_MORTALITY_FACTOR = 2.5;
/** 一天里一格植被最多被啃掉的比例（剩下的够不着或不爱吃）。 */
export const MAX_GRAZE_FRACTION = 0.05;
/** 食肉动物的半饱和系数（天）：格子里的可捕猎物够它们吃这么多天时，捕获率达到一半。 */
export const PREDATION_HALF_SATURATION_DAYS = 0.5;
/** 扩散一跳的最大格数，限制计算量。 */
const MAX_MOVE_RADIUS = 8;

export interface DerivedSpecies {
  readonly params: SpeciesParams;
  readonly herbivore: boolean;
  readonly bodyMassG: number;
  /** 每天的食物需求：食草为干物质克数，食肉为猎物鲜重克数。 */
  readonly dailyIntakeG: number;
  readonly adultDailyMortality: number;
  readonly juvenileDailyMortality: number;
  readonly starvationRate: number;
  /** 幼体每天长成成体的概率。 */
  readonly maturationRate: number;
  /** 繁殖期内每只雌性每天产一窝的概率。 */
  readonly litterRate: number;
  /** 一格里住到这么多只就不再繁殖。 */
  readonly crowdingCapacity: number;
  /** 每天离开所在格子的概率，以及一跳的最大格数。 */
  readonly moveProb: number;
  readonly moveRadius: number;
}

export function deriveSpecies(p: SpeciesParams, cellSizeM: number): DerivedSpecies {
  const herbivore = p.diet === 'herbivore';
  const metabolicMass = detPow(p.bodyMassKg, 0.75);
  const adultDailyMortality = 1 - detPow(p.survival.adultAnnual, 1 / DAYS_PER_YEAR);
  const cellsPerDay = p.movement.dailyRangeM / cellSizeM;
  // 一年里处于繁殖期的天数；繁殖期比两窝间隔还短时，整个繁殖期只够生一窝。
  const breedingDays = p.reproduction.breedingByMonth.reduce((a, b) => a + b, 0) * DAYS_PER_MONTH;
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
    maturationRate: 1 / p.reproduction.ageAtMaturityDays,
    litterRate: breedingDays > 0 ? 1 / Math.min(p.reproduction.litterIntervalDays, breedingDays) : 0,
    crowdingCapacity: typicalPerKm2 * CROWDING_FACTOR * cellKm2,
    moveProb: Math.min(0.5, cellsPerDay / 2),
    moveRadius: Math.max(1, Math.min(MAX_MOVE_RADIUS, Math.round(cellsPerDay / 2))),
  };
}

type Activity = SpeciesParams['activity'];
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
