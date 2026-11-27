import { describe, expect, it } from 'vitest';
import {
  alleleFrequencies,
  countHeterozygotes,
  density,
  diversityIndex,
  expectedHeterozygosity,
  frequency,
  heterozygosityIndex,
  netPrimaryProductivity,
  percentCover,
  speciesRichness,
  transferEfficiency,
  type Genotype,
} from '../src/sim/measure';

/**
 * 课本例题回归测试：课本和真题里的数喂进引擎，要算出同样的答案。
 * 出处见 docs/research/syllabus-engine.md。引擎改了，这些必须照样对。
 */

describe('U2 4.18 多样性指数 D = N(N−1)/Σn(n−1)', () => {
  it('课本 4C.2 worked example：池塘 5 种 40 只 → 3.60', () => {
    // dragonfly larvae 4, mosquito larvae 12, water boatman 3, tadpole shrimp 4, copepods 17
    const d = diversityIndex([4, 12, 3, 4, 17])!;
    expect(d).toBeCloseTo(1560 / 434, 10);
    expect(Number(d.toFixed(1))).toBe(3.6);
  });

  it('课本 4C.2 Checkpoint 2：林地 6 种 24 株 → 5.02', () => {
    // holly 9, bramble 3, oak 3, butcher's broom 5, ivy 3, yew 1
    expect(Number(diversityIndex([9, 3, 3, 5, 3, 1])!.toFixed(2))).toBe(5.02);
  });

  it('2021 WBI12 Jun Q7(c)(i)：圣克鲁斯原生林 8 种 147 株 → 4.6', () => {
    const counts = [21, 2, 4, 13, 54, 15, 6, 32];
    expect(counts.reduce((a, b) => a + b)).toBe(147);
    expect(counts.reduce((a, n) => a + n * (n - 1), 0)).toBe(4684);
    expect(Number(diversityIndex(counts)!.toFixed(1))).toBe(4.6);
  });

  it('没有定义的情况：每种只有一只、总数不到两只', () => {
    expect(diversityIndex([1, 1, 1])).toBeNull();
    expect(diversityIndex([1])).toBeNull();
    expect(diversityIndex([])).toBeNull();
  });

  it('只有一种时 D = 1；种越多、越均匀，D 越大', () => {
    expect(diversityIndex([10])).toBe(1);
    expect(diversityIndex([5, 5])!).toBeGreaterThan(diversityIndex([9, 1])!);
    expect(diversityIndex([4, 4, 4])!).toBeGreaterThan(diversityIndex([6, 6])!);
  });

  it('丰富度只数出现过的种', () => {
    expect(speciesRichness([4, 12, 0, 4, 17])).toBe(4);
  });
});

describe('U2 4.17 杂合度指数 = 杂合子数 ÷ 个体数', () => {
  it('课本 4C.2 fig C：23 只欧洲蟾蜍，5 只杂合 → 0.217', () => {
    // 电泳胶：两条带是杂合，一条带是纯合
    const toads: Genotype[] = [...Array.from({ length: 5 }, (): Genotype => [0, 1]), ...Array.from({ length: 12 }, (): Genotype => [0, 0]), ...Array.from({ length: 6 }, (): Genotype => [1, 1])];
    expect(toads.length).toBe(23);
    const h = heterozygosityIndex(countHeterozygotes(toads), toads.length)!;
    expect(Number(h.toFixed(3))).toBe(0.217);
  });

  it('2022 WBI12 Jan Q7(c)(ii)：500 株巨魔芋，指数 0.166 → 83 株杂合', () => {
    expect(Math.round(0.166 * 500)).toBe(83);
    expect(heterozygosityIndex(83, 500)).toBeCloseTo(0.166, 3);
  });

  it('等位基因频率：每只算两份', () => {
    const f = alleleFrequencies([[0, 1], [0, 0], [1, 1], [0, 2]], 3);
    expect(f).toEqual([4 / 8, 3 / 8, 1 / 8]);
  });

  it('漂变：杂合度每代按 (1 − 1/2N) 下降，种群越小掉得越快', () => {
    expect(expectedHeterozygosity(0.5, 10, 1)).toBeCloseTo(0.475, 10);
    expect(expectedHeterozygosity(0.5, 5, 10)).toBeLessThan(expectedHeterozygosity(0.5, 50, 10));
  });
});

describe('U4 5.14 / CP11 样方', () => {
  it('盖度、频度、密度', () => {
    expect(percentCover(25, 100)).toBe(25);
    expect(frequency(7, 20)).toBe(35);
    // 10 个 0.25 平方米的样方一共数到 30 只 → 每平方米 12 只
    expect(density(30, 10, 0.25)).toBe(12);
  });
});

describe('U4 5.10 生产量和传递效率【待换成课本原题】', () => {
  it('NPP = GPP − R；效率 = 下一级 ÷ 这一级', () => {
    expect(netPrimaryProductivity(20810, 11977)).toBe(8833);
    expect(transferEfficiency(1478, 14700)).toBeCloseTo(10.05, 2);
  });
});
