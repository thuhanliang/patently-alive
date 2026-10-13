import type { Capture } from './jobs';

/**
 * 抽样推断：从体检记录（陷阱捕获和采样）估计一个物种的整体状况，给出 95% 置信区间。
 * 公式只在这里定义（铁律 4）；界面只负责显示。
 *
 * 比例用 Wilson 区间（样本小、比例接近 0 或 1 时也不会越出 0–1）；平均体重用正态近似（均值 ± 1.96 × 标准误）。
 * 注意抽样本身有偏：陷阱抓到的是被诱饵吸引、体重合适的，界面要说清楚样本从哪来。
 */

/** 95% 置信水平对应的正态分位数。 */
export const Z95 = 1.96;
/** 体况评分不高于这个值算"偏瘦"。 */
export const THIN_BCS = 2;
/** 体况评分高于这个值算"偏胖 / 脂肪充足"（吃饱的平均约 3.5）。 */
export const GOOD_BCS = 3.5;

export interface Proportion {
  k: number;
  n: number;
  p: number;
  lo: number;
  hi: number;
}

export function wilson(k: number, n: number, z = Z95): Proportion {
  if (n === 0) return { k, n, p: 0, lo: 0, hi: 1 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { k, n, p, lo: Math.max(0, centre - half), hi: Math.min(1, centre + half) };
}

export interface MeanEstimate {
  n: number;
  mean: number;
  lo: number;
  hi: number;
}

export function meanCi(values: readonly number[], z = Z95): MeanEstimate {
  const n = values.length;
  if (n === 0) return { n, mean: 0, lo: 0, hi: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { n, mean, lo: mean, hi: mean };
  const variance = values.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1);
  const half = z * Math.sqrt(variance / n);
  return { n, mean, lo: mean - half, hi: mean + half };
}

export interface SampleSummary {
  species: number;
  /** 检查过的只数。 */
  n: number;
  female: Proportion;
  juvenile: Proportion;
  thin: Proportion;
  /** 成体的平均体重（千克）。 */
  adultMassKg: MeanEstimate;
  /** 胃里有某物种残骸的比例（按物种下标；没见过的物种不列）。 */
  stomachPrey: { prey: number; nest: Proportion; mobile: Proportion }[];
  /** 样本里多少来自陷阱、多少来自采样。 */
  fromTraps: number;
  fromSampling: number;
}

/** 物种 s 在 sinceDay（含）之后的体检记录汇总。 */
export function summarize(records: readonly Capture[], s: number, sinceDay = -Infinity): SampleSummary {
  const mine = records.filter((r) => r.species === s && r.day >= sinceDay);
  const n = mine.length;
  const count = (f: (r: Capture) => boolean): number => mine.reduce((a, r) => a + (f(r) ? 1 : 0), 0);
  const preys = [...new Set(mine.filter((r) => r.stomach.prey >= 0).map((r) => r.stomach.prey))].sort((a, b) => a - b);
  return {
    species: s,
    n,
    female: wilson(count((r) => r.female), n),
    juvenile: wilson(count((r) => r.juvenile), n),
    thin: wilson(count((r) => r.bcs <= THIN_BCS), n),
    adultMassKg: meanCi(mine.filter((r) => !r.juvenile).map((r) => r.massKg)),
    stomachPrey: preys.map((prey) => ({
      prey,
      nest: wilson(count((r) => r.stomach.prey === prey && r.stomach.preyNest), n),
      mobile: wilson(count((r) => r.stomach.prey === prey && !r.stomach.preyNest), n),
    })),
    fromTraps: count((r) => r.trap >= 0),
    fromSampling: count((r) => r.trap < 0),
  };
}
