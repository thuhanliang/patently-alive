import { describe, expect, it } from 'vitest';
import { Rng } from '../src/sim';
import { binomial, standardNormal, stochasticRound } from '../src/sim/sample';

function stats(xs: number[]): { mean: number; variance: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  return { mean, variance };
}

describe('二项抽样', () => {
  const cases: Array<[number, number]> = [
    [10, 0.3], // 逆变换
    [40, 0.006], // 逆变换，小概率
    [5000, 0.2], // 正态近似
    [200, 0.9], // 对称
  ];
  for (const [n, p] of cases) {
    it(`B(${n}, ${p}) 的均值和方差接近理论值，且不越界`, () => {
      const rng = Rng.fromSeed(n);
      const xs = Array.from({ length: 20_000 }, () => binomial(rng, n, p));
      expect(xs.every((k) => Number.isInteger(k) && k >= 0 && k <= n)).toBe(true);
      const { mean, variance } = stats(xs);
      const m = n * p;
      const v = n * p * (1 - p);
      expect(Math.abs(mean - m)).toBeLessThan(0.03 * m + 0.02);
      expect(Math.abs(variance - v)).toBeLessThan(0.08 * v + 0.02);
    });
  }

  it('边界：n = 0、p = 0、p = 1', () => {
    const rng = Rng.fromSeed(1);
    expect(binomial(rng, 0, 0.5)).toBe(0);
    expect(binomial(rng, 10, 0)).toBe(0);
    expect(binomial(rng, 10, 1)).toBe(10);
  });

  it('近似正态的均值 0、方差 1', () => {
    const rng = Rng.fromSeed(2);
    const { mean, variance } = stats(Array.from({ length: 20_000 }, () => standardNormal(rng)));
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(variance - 1)).toBeLessThan(0.05);
  });

  it('随机取整的期望不变', () => {
    const rng = Rng.fromSeed(3);
    const { mean } = stats(Array.from({ length: 20_000 }, () => stochasticRound(rng, 2.3)));
    expect(Math.abs(mean - 2.3)).toBeLessThan(0.02);
  });
});
