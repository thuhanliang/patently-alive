import { describe, expect, it } from 'vitest';
import { DAYS_PER_YEAR, TICKS_PER_DAY, TICKS_PER_YEAR, calendar, monthlyCurve } from '../src/sim';

describe('游戏日历', () => {
  it('tick 换算成日期', () => {
    expect(calendar(0)).toEqual({ year: 0, dayOfYear: 0, month: 0, dayOfMonth: 0, season: 0, hour: 0 });
    const d = calendar(TICKS_PER_YEAR + TICKS_PER_DAY * 95 + 13);
    expect(d).toEqual({ year: 1, dayOfYear: 95, month: 3, dayOfMonth: 5, season: 1, hour: 13 });
    expect(calendar(TICKS_PER_DAY * (DAYS_PER_YEAR - 1)).season).toBe(3);
  });

  it('季节曲线在月中点取表里的值，月间线性过渡，跨年连续', () => {
    const table = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    expect(monthlyCurve(table, 14.5)).toBeCloseTo(0);
    expect(monthlyCurve(table, 44.5)).toBeCloseTo(1);
    expect(monthlyCurve(table, 29.5)).toBeCloseTo(0.5);
    // 12 月中点到次年 1 月中点之间：从 11 回到 0。
    expect(monthlyCurve(table, 344.5)).toBeCloseTo(11);
    expect(monthlyCurve(table, 359.5)).toBeCloseTo(5.5);
    // 第 0 天的中点（0.5）距 12 月中点 15.5 天。
    expect(monthlyCurve(table, 0)).toBeCloseTo(11 - (11 * 15.5) / 30, 9);
  });
});
