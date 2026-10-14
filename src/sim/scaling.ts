import type { Law, ScalingLaws } from '../data/schema/scaling';
import type { SpeciesParams } from '../data/schema/species';
import { detExp, detLog, detPow } from './detmath';

/**
 * 体重缩放公式：从"原因"（体重、每窝仔数、食性、是鸟还是兽、会不会飞）推导生活史和活动范围。
 * 公式的系数是数据（src/data/scaling/laws.json，从 PanTHERIA、AnAge 拟合），这里只负责代入；确定、纯函数。
 * 阶段 3 的设计编译器用它把一份设计变成物种参数；真实物种用来做回归测试（推导值要接近数据库值）。
 */

export interface ScalingCauses {
  bodyMassKg: number;
  /** 每窝仔数（鸟是每窝蛋数）：同样的体重，生得多的就长得快、死得早（r/K 取舍）。 */
  litterSize: number;
  diet: SpeciesParams['diet'];
  /** 鸟用 AnAge 鸟纲的公式，兽用 PanTHERIA 的公式。 */
  bird: boolean;
  /** 长了翅膀（飞不飞得起来要看体重，见 tooHeavyToFly）。 */
  flies: boolean;
}

export interface ScaledTraits {
  gestationDays: number;
  litterIntervalDays: number;
  ageAtMaturityDays: number;
  maxLifespanYears: number;
  /** 野外成体年存活率。 */
  adultAnnualSurvival: number;
  homeRangeKm2: number;
  dailyRangeM: number;
  /** 基础代谢率（瓦），哺乳动物的公式（鸟也借用）。 */
  basalMetabolismW: number;
  /** 野外代谢率（千焦/天）：鸟和兽各用各的文献公式（Nagy 1999）。飞行的额外代价由翅膀部件另算。 */
  fieldMetabolismKjPerDay: number;
  /** 哪些量是借用哺乳动物公式推导的（鸟没有自己的数据库公式），可信度低一档。 */
  borrowed: readonly ('homeRangeKm2' | 'dailyRangeM' | 'basalMetabolismW')[];
  /** 会飞但比数据库里最重的飞鸟还重：飞不起来（设计台据此提醒，不禁止）。 */
  tooHeavyToFly: boolean;
}

const LN10 = detLog(10);
const log10 = (x: number): number => detLog(x) / LN10;
const pow10 = (y: number): number => detExp(y * LN10);

/** 代入一条公式。公式里有、vars 里没给的自变量直接报错（数据改了名，不能悄悄当 0 算）。 */
export function applyLaw(law: Law, vars: Readonly<Record<string, number>>): number {
  let y = law.intercept;
  for (const [k, b] of Object.entries(law.terms)) {
    const v = vars[k];
    if (v === undefined) throw new Error(`公式「${law.name}」要自变量 ${k}，推导时没有给`);
    y += b * v;
  }
  return pow10(y);
}

/** 一条公式的典型误差倍数：真实物种通常落在预测值的 1/f–f 倍之间。 */
export function errorFactor(law: Pick<Law, 'residualSdLog10'>): number {
  return pow10(law.residualSdLog10);
}

/** 营养级：PanTHERIA 的 1 = 食草，2 = 杂食，3 = 吃动物；设计按动物性食物比例连续取值。 */
export function trophicLevel(diet: SpeciesParams['diet']): number {
  return 1 + 2 * Math.min(1, Math.max(0, diet.vertebrate + diet.invertebrate));
}

export function scaleTraits(laws: ScalingLaws, c: ScalingCauses): ScaledTraits {
  const vars = { log10MassG: log10(c.bodyMassKg * 1000), log10Litter: log10(c.litterSize), trophicLevel: trophicLevel(c.diet) };
  const lh = c.bird ? laws.bird : laws.mammal;
  const gestationDays = applyLaw(lh.gestationDays, vars);
  const interval = c.bird ? 365 / applyLaw(laws.bird.clutchesPerYear, vars) : applyLaw(laws.mammal.litterIntervalDays, vars);
  const maxLifespanYears = applyLaw(lh.maxLifespanYears, vars);
  const k = c.bird ? laws.survival.kBird : laws.survival.kMammal;
  // 鸟没有家域的数据库公式，借用哺乳动物的（同体重、同食性）。
  const homeRangeKm2 = applyLaw(laws.mammal.homeRangeKm2, vars);
  const fmr = c.bird ? laws.fieldMetabolism.bird : laws.fieldMetabolism.mammal;
  return {
    gestationDays,
    litterIntervalDays: Math.max(gestationDays, interval),
    ageAtMaturityDays: applyLaw(lh.ageAtMaturityDays, vars),
    maxLifespanYears,
    adultAnnualSurvival: detExp(-k / maxLifespanYears),
    homeRangeKm2,
    dailyRangeM: laws.dailyRange.c * Math.sqrt(homeRangeKm2 * 1e6),
    basalMetabolismW: applyLaw(laws.mammal.basalMetabolismW, vars),
    fieldMetabolismKjPerDay: fmr.coef * detPow(c.bodyMassKg * 1000, fmr.exp),
    tooHeavyToFly: c.flies && c.bodyMassKg > laws.flight.maxMassKg,
    borrowed: c.bird ? ['homeRangeKm2', 'dailyRangeM', 'basalMetabolismW'] : [],
  };
}
