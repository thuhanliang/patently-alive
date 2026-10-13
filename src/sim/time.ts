/**
 * 游戏日历。1 tick = 游戏内 1 小时。
 * 一年 12 个月、每月 30 天（共 360 天），年初是春季第一个月。
 * 格子层（植被、以后的种群）每天更新一次；以后展开的个体每个 tick 行动。
 */
export const TICKS_PER_DAY = 24;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
export const TICKS_PER_YEAR = TICKS_PER_DAY * DAYS_PER_YEAR;

export const SEASON_NAMES = ['春', '夏', '秋', '冬'] as const;

export interface CalendarDate {
  /** 从 0 开始的年份。 */
  year: number;
  /** 一年中的第几天，0–359。 */
  dayOfYear: number;
  /** 0–11。 */
  month: number;
  /** 一月中的第几天，0–29。 */
  dayOfMonth: number;
  /** 0 春 1 夏 2 秋 3 冬。 */
  season: number;
  hour: number;
}

export function calendar(tick: number): CalendarDate {
  const day = Math.floor(tick / TICKS_PER_DAY);
  const dayOfYear = day % DAYS_PER_YEAR;
  const month = Math.floor(dayOfYear / DAYS_PER_MONTH);
  return {
    year: Math.floor(day / DAYS_PER_YEAR),
    dayOfYear,
    month,
    dayOfMonth: dayOfYear % DAYS_PER_MONTH,
    season: Math.floor(month / 3),
    hour: tick % TICKS_PER_DAY,
  };
}

/**
 * 按"每月一个值"的表在一年中平滑插值：每个值落在该月中点，首尾循环相接。
 * 只用加减乘除，结果确定（季节曲线不用 Math.sin）。
 */
export function monthlyCurve(table: readonly number[], dayOfYear: number): number {
  const pos = (dayOfYear + 0.5) / DAYS_PER_MONTH - 0.5; // 以月中点为节点
  const wrapped = (pos + MONTHS_PER_YEAR) % MONTHS_PER_YEAR;
  const i = Math.floor(wrapped);
  const t = wrapped - i;
  const a = table[i]!;
  const b = table[(i + 1) % MONTHS_PER_YEAR]!;
  return a + (b - a) * t;
}
