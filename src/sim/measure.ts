/**
 * 计量：课本里的指数和计算（Edexcel IAL 生物 U2 4.17–4.18、U4 5.9–5.14）。
 * 铁律 4：游戏里这类数字只从这里算，界面只负责显示。
 * 输入是玩家亲手采到的样本（样方、捕捉、血样），不是推演的真值，所以带抽样误差。
 * 对照表和课本例题见 docs/research/syllabus-engine.md，例题测试在 tests/syllabus.test.ts。
 */

import { powInt } from './detmath';

/**
 * 多样性指数（课本 4C.2）：D = N(N − 1) / Σ n(n − 1)。
 * counts：每个物种采到的只数（株数）。N 是总数。
 * 每种都只采到一只时分母为 0，D 没有定义，返回 null；采到不到两只时也返回 null。
 */
export function diversityIndex(counts: readonly number[]): number | null {
  let big = 0;
  let sum = 0;
  for (const n of counts) {
    if (!(n >= 0) || !Number.isInteger(n)) throw new Error(`只数必须是非负整数：${n}`);
    big += n;
    sum += n * (n - 1);
  }
  if (big < 2 || sum === 0) return null;
  return (big * (big - 1)) / sum;
}

/** 物种丰富度：一个生境里有几个物种（采到至少一只的）。 */
export function speciesRichness(counts: readonly number[]): number {
  return counts.filter((n) => n > 0).length;
}

/** 杂合度指数（课本 4C.2）：杂合子数 ÷ 种群个体数。 */
export function heterozygosityIndex(heterozygotes: number, individuals: number): number | null {
  if (individuals <= 0) return null;
  if (heterozygotes < 0 || heterozygotes > individuals) throw new Error(`杂合子数不对：${heterozygotes} / ${individuals}`);
  return heterozygotes / individuals;
}

/** 一个二倍体基因型（两个等位基因的编号）。 */
export type Genotype = readonly [number, number];

/** 从一批基因型数杂合子（电泳胶上两条带的个体）。 */
export function countHeterozygotes(genotypes: readonly Genotype[]): number {
  return genotypes.filter(([a, b]) => a !== b).length;
}

/** 等位基因频率：每个等位基因在基因库里占几成（每只算两份）。 */
export function alleleFrequencies(genotypes: readonly Genotype[], alleles: number): number[] {
  const f = new Array<number>(alleles).fill(0);
  if (genotypes.length === 0) return f;
  for (const [a, b] of genotypes) {
    f[a] = f[a]! + 1;
    f[b] = f[b]! + 1;
  }
  return f.map((x) => x / (2 * genotypes.length));
}

/**
 * 漂变下杂合度的期望（遗传漂变、瓶颈、建立者效应的标准结论，课本 4C.5 的定性说法的定量版）：
 * 每一代按 (1 − 1/2N) 的比例下降。N 是有效种群大小，generations 取整数。
 */
export function expectedHeterozygosity(h0: number, populationSize: number, generations: number): number {
  return h0 * powInt(1 - 1 / (2 * populationSize), generations);
}

/** 样方：百分比盖度 = 落在这种植物上的点 ÷ 总点数 × 100（点样方框）。 */
export function percentCover(hits: number, points: number): number {
  if (points <= 0) throw new Error('点数要大于 0');
  return (100 * hits) / points;
}

/** 样方：频度 = 出现这个物种的样方数 ÷ 样方总数 × 100。 */
export function frequency(quadratsWith: number, quadrats: number): number {
  if (quadrats <= 0) throw new Error('样方数要大于 0');
  return (100 * quadratsWith) / quadrats;
}

/** 样方：密度 = 样方里数到的个体总数 ÷ 样方总面积（只 / 平方米）。 */
export function density(totalCount: number, quadrats: number, quadratAreaM2: number): number {
  if (quadrats <= 0 || quadratAreaM2 <= 0) throw new Error('样方数和面积要大于 0');
  return totalCount / (quadrats * quadratAreaM2);
}

/** 净初级生产量（U4 5.10）：NPP = GPP − R。单位跟输入一致。 */
export function netPrimaryProductivity(gpp: number, respiration: number): number {
  return gpp - respiration;
}

/** 能量传递效率（U4 5.10）：下一营养级得到的能量 ÷ 这一营养级的能量 × 100。 */
export function transferEfficiency(energyOut: number, energyIn: number): number {
  if (energyIn <= 0) throw new Error('输入的能量要大于 0');
  return (100 * energyOut) / energyIn;
}
