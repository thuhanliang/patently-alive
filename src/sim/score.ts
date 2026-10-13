import { detLog } from './detmath';
import { CAUSE, recentByCause } from './ledger';
import type { SimState } from './sim';
import { TERRAIN } from './terrain';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from './time';

/**
 * 多维评分：目标物种恢复、稳定度、多样性、花费、福利，各 0–100。
 * 公式只在这里定义（铁律 4）；情景只给目标值（src/data/schema/scenario.ts 的 goal）。
 * 五项分开看，没有唯一的正确答案（GDD「评价」），所以不给"综合分"：什么都不做时花费、福利会是满分，平均起来会误导。
 *
 * - 恢复：目标物种现在 / 第一年同一季（季节起伏很大，繁殖季过后鸟本来就多，只能和同季比）。
 *   一半以下 0 分，持平 50 分，达到目标倍数 100 分（两段各自线性）。第一年用来建立各季的基准，不评（null）。
 * - 稳定度：外来物种和一年前同期比有没有暴涨。最猛的那种翻倍 0 分，没涨 100 分（按 log2 线性）；
 *   一年前不到 STABILITY_MIN_COUNT 只的按这么多算。
 *   第一年（前 4 季）不评（null）：开局数量离平衡远，和开局比没有意义。
 * - 多样性：本地物种都还在（每种不少于开局的一半算满分）、栖息地（灌丛）没被啃光，两半各占一半。
 * - 花费：花掉的钱占拿到的钱（开局预算 + 各季拨款）的比例越小越高。
 * - 福利：近期死亡里饿死的和被人处死的比例（各物种平均）越小越高。
 */
export const QUARTER_DAYS = 90;
/** 恢复分里"一半以下 0 分"的那条线。 */
export const RECOVERY_FLOOR = 0.5;
/** 本地物种不少于开局的这个比例，多样性里算"还在"。 */
export const PERSIST_FRACTION = 0.5;
/** 稳定度里一年前的数量至少按这么多算：十几只的物种多几只就"翻倍"，那是偶然，不是暴涨。 */
export const STABILITY_MIN_COUNT = 20;
/** 福利只看近期死亡至少这么多的物种（太少的不稳）。 */
export const WELFARE_MIN_DEATHS = 5;
/** 每季结算时满意度最多变多少（恢复分 100 时 +，0 时 −）。 */
export const SATISFACTION_PER_QUARTER = 6;

export type ScoreKey = 'recovery' | 'stability' | 'diversity' | 'cost' | 'welfare';
export const SCORE_KEYS: readonly ScoreKey[] = ['recovery', 'stability', 'diversity', 'cost', 'welfare'];

export type Scores = Record<ScoreKey, number | null>;

/** 开局时记下的基准。 */
export interface ScoreBaseline {
  /** 各物种开局总数。 */
  totals: number[];
  /** 开局灌丛的平均量（没有灌丛的世界为 0）。 */
  shrub: number;
}

export interface ScoreGoal {
  /** 目标物种下标。 */
  target: number;
  recovery: number;
  /** 各物种是不是本地物种。 */
  native: boolean[];
}

export interface ScoreDetail {
  /** 目标物种现在 / 第一年同季；第一年为 null。 */
  targetRatio: number | null;
  /** 涨得最猛的外来物种（下标）和它和去年同期的比；第一年为 null。 */
  boom: { species: number; ratio: number } | null;
  /** 本地物种里现在不到开局一半的（下标）。 */
  nativesLow: number[];
  /** 灌丛现在 / 开局（没有灌丛为 1）。 */
  habitat: number;
  /** 花掉的比例。 */
  spentShare: number;
  /** 近期死亡里饿死 + 人为处死的比例（各物种平均）。 */
  sufferingShare: number;
}

export interface ScoreResult {
  scores: Scores;
  detail: ScoreDetail;
}

const LN2 = detLog(2);
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
/** 分数取整到 1 分：显示用，也让结算结果不受浮点尾数影响。 */
const pts = (x: number): number => Math.round(clamp01(x) * 100);

/** 恢复分：RECOVERY_FLOOR 倍以下 0 分，持平（1 倍）50 分，目标倍数 100 分，两段各自线性。 */
export function recoveryPoints(ratio: number, target: number): number {
  if (ratio <= 1) return pts(((ratio - RECOVERY_FLOOR) / (1 - RECOVERY_FLOOR)) * 0.5);
  return target <= 1 ? 100 : pts(0.5 + ((ratio - 1) / (target - 1)) * 0.5);
}

export function meanShrub(state: Readonly<SimState>): number {
  const { terrain, shrub } = state.grid;
  let sum = 0;
  let n = 0;
  for (let i = 0; i < terrain.length; i++) {
    if (terrain[i] !== TERRAIN.shrub) continue;
    sum += shrub[i]!;
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

export function baselineOf(state: Readonly<SimState>): ScoreBaseline {
  return { totals: state.lastDay.map((d) => d.total), shrub: meanShrub(state) };
}

export function score(
  state: Readonly<SimState>,
  goal: ScoreGoal,
  base: ScoreBaseline,
  money: { spent: number; received: number },
  /** 目标物种第一年同一季的数量；还在第一年时为 null。 */
  sameSeasonLastYear: number | null,
): ScoreResult {
  const now = state.lastDay.map((d) => d.total);
  const start = base.totals;

  // 恢复
  // 第一年同季一只都没有时按 1 只算，回来多少都看得见。
  const targetRatio = sameSeasonLastYear === null ? null : now[goal.target]! / Math.max(1, sameSeasonLastYear);
  const recovery = targetRatio === null ? null : recoveryPoints(targetRatio, goal.recovery);

  // 稳定度：和一年前最近的一次普查比。
  const today = Math.floor(state.tick / TICKS_PER_DAY);
  const yearAgo = today > DAYS_PER_YEAR ? [...state.census].reverse().find((c) => c.day <= today - DAYS_PER_YEAR) : undefined;
  let boom: ScoreDetail['boom'] = null;
  let stability: number | null = null;
  if (yearAgo) {
    for (let s = 0; s < now.length; s++) {
      if (goal.native[s]) continue;
      const before = yearAgo.totals[s]!;
      // 一年前很少（或已经清干净）的按至少 STABILITY_MIN_COUNT 只算。
      const ratio = now[s]! / Math.max(STABILITY_MIN_COUNT, before);
      if (!boom || ratio > boom.ratio) boom = { species: s, ratio };
    }
    stability = pts(1 - detLog(Math.max(1, boom?.ratio ?? 1)) / LN2);
  }

  // 多样性
  const natives = now.map((_, s) => s).filter((s) => goal.native[s]);
  const nativesLow = natives.filter((s) => now[s]! < start[s]! * PERSIST_FRACTION);
  const persist =
    natives.length > 0
      ? natives.reduce((a, s) => a + clamp01(start[s]! > 0 ? now[s]! / (start[s]! * PERSIST_FRACTION) : 1), 0) / natives.length
      : 1;
  const habitat = base.shrub > 0 ? clamp01(meanShrub(state) / base.shrub) : 1;
  const diversity = pts(0.5 * persist + 0.5 * habitat);

  // 花费
  const spentShare = money.received > 0 ? clamp01(money.spent / money.received) : 0;
  const cost = pts(1 - spentShare);

  // 福利
  let suffering = 0;
  let counted = 0;
  for (let s = 0; s < now.length; s++) {
    const byCause = recentByCause(state.deaths, s);
    const all = byCause.reduce((a, b) => a + b, 0);
    if (all < WELFARE_MIN_DEATHS) continue;
    suffering += (byCause[CAUSE.starvation]! + byCause[CAUSE.removed]!) / all;
    counted += 1;
  }
  const sufferingShare = counted > 0 ? suffering / counted : 0;
  const welfare = pts(1 - sufferingShare);

  return {
    scores: { recovery, stability, diversity, cost, welfare },
    detail: { targetRatio, boom, nativesLow, habitat, spentShare, sufferingShare },
  };
}

/** 每季结算时满意度的变化：按恢复分，50 分不变；第一年还没有恢复分，委托人在观望，不变。 */
export function satisfactionChange(scores: Scores): number {
  return Math.round((((scores.recovery ?? 50) - 50) / 50) * SATISFACTION_PER_QUARTER);
}

/** 一年几季。 */
export const QUARTERS_PER_YEAR = DAYS_PER_YEAR / QUARTER_DAYS;
