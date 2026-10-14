import { describe, expect, it } from 'vitest';
import { PopulationHistory } from '../src/ui/history';

describe('种群曲线的记录', () => {
  it('引进新物种后加一条线，插在植被前面，引进以前记为 0', () => {
    const h = new PopulationHistory(['鸟', '猫', '平均植被'], 10);
    h.recordValues(0, [100, 5], 300);
    h.setSpecies(['鸟', '猫', '獴']);
    h.recordValues(1, [98, 5, 20], 299);
    expect(h.labels).toEqual(['鸟', '猫', '獴', '平均植被']);
    expect([h.value(2, 0), h.value(2, 1)]).toEqual([0, 20]);
    expect([h.value(3, 0), h.value(3, 1)]).toEqual([300, 299]);
    expect(h.value(1, 1)).toBe(5);
  });

  it('读档后物种变少：去掉多出来的线', () => {
    const h = new PopulationHistory(['鸟', '猫', '獴', '平均植被'], 10);
    h.clear();
    h.setSpecies(['鸟', '猫']);
    h.recordValues(0, [1, 2], 3);
    expect(h.labels).toEqual(['鸟', '猫', '平均植被']);
    expect(h.value(2, 0)).toBe(3);
  });
});
