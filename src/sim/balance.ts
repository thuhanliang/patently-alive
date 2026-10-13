import type { SimConfig } from './config';
import { Sim } from './sim';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from './time';

/**
 * 平衡体检：跑若干年，按物种汇总每天的总数，找出"过早灭绝"和"爆炸"。
 * 只给报告，不做判断——用在平衡回归测试（只报警）和批量推演脚本里。
 */
export interface SpeciesReport {
  id: string;
  /** 每天的总数。 */
  daily: number[];
  min: number;
  max: number;
  /** 第几天灭绝（总数变成 0）；没灭绝为 null。 */
  extinctDay: number | null;
  /** 每年的日均数量。 */
  yearlyMeans: number[];
  /** 第二年以后年均值的变异系数，衡量"起伏"。 */
  yearlyCv: number;
  /** 第二年以后，日总数相对最大值的跌幅峰值（0–1）：越大说明有过大起大落。 */
  maxDrawdown: number;
}

export interface BalanceReport {
  seed: number;
  years: number;
  species: SpeciesReport[];
  /** 人能读懂的报警。空数组表示没发现问题。 */
  alarms: string[];
}

export interface BalanceThresholds {
  /** 前几年内灭绝算"过早灭绝"。 */
  earlyExtinctionYears: number;
  /** 总数超过开局的这么多倍算"爆炸"。 */
  explosionFactor: number;
}

export const DEFAULT_THRESHOLDS: BalanceThresholds = { earlyExtinctionYears: 3, explosionFactor: 20 };

export function balanceCheck(config: SimConfig, years: number, t: BalanceThresholds = DEFAULT_THRESHOLDS): BalanceReport {
  const sim = Sim.create(config);
  const ids = sim.species.map((s) => s.params.id);
  const daily: number[][] = ids.map(() => []);
  const start = sim.totals();
  for (let d = 0; d < years * DAYS_PER_YEAR; d++) {
    sim.stepN(TICKS_PER_DAY);
    sim.totals().forEach((n, s) => daily[s]!.push(n));
  }

  const alarms: string[] = [];
  const species = ids.map((id, s) => {
    const series = daily[s]!;
    const extinct = series.findIndex((n) => n === 0);
    const max = Math.max(...series);
    const min = Math.min(...series);
    if (extinct >= 0 && extinct < t.earlyExtinctionYears * DAYS_PER_YEAR) {
      alarms.push(`${id} 在第 ${Math.floor(extinct / DAYS_PER_YEAR) + 1} 年第 ${(extinct % DAYS_PER_YEAR) + 1} 天灭绝`);
    }
    // 开局为 0 的物种（后来投放的）没有"开局的几倍"可言，不报爆炸。
    if (start[s]! > 0 && max > start[s]! * t.explosionFactor) {
      alarms.push(`${id} 最多到 ${max} 只，是开局（${start[s]}）的 ${(max / Math.max(1, start[s]!)).toFixed(0)} 倍`);
    }
    const yearlyMeans: number[] = [];
    for (let y = 0; y < years; y++) {
      const slice = series.slice(y * DAYS_PER_YEAR, (y + 1) * DAYS_PER_YEAR);
      yearlyMeans.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    }
    const yearly = yearlyMeans.slice(1);
    const mean = yearly.reduce((a, b) => a + b, 0) / Math.max(1, yearly.length);
    const sd = Math.sqrt(yearly.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, yearly.length));
    let peak = 0;
    let drawdown = 0;
    for (const n of series.slice(DAYS_PER_YEAR)) {
      peak = Math.max(peak, n);
      if (peak > 0) drawdown = Math.max(drawdown, 1 - n / peak);
    }
    return {
      id,
      daily: series,
      min,
      max,
      extinctDay: extinct >= 0 ? extinct : null,
      yearlyMeans,
      yearlyCv: mean > 0 ? sd / mean : 0,
      maxDrawdown: drawdown,
    };
  });
  return { seed: config.seed, years, species, alarms };
}
