import { powInt } from './detmath';
import type { Rng } from './rng';

/**
 * 确定的随机抽样。只用 Rng 和加减乘除。
 */

/** 二项分布 B(n, p)：n 次独立试验、每次成功概率 p，返回成功次数。 */
export function binomial(rng: Rng, n: number, p: number): number {
  if (n <= 0 || p <= 0) return 0;
  if (p >= 1) return n;
  // 对称：p > 0.5 时抽失败次数。
  if (p > 0.5) return n - binomial(rng, n, 1 - p);
  const mean = n * p;
  if (mean < 30) return binomialInversion(rng, n, p);
  // 均值大时用正态近似，四舍五入后夹在 [0, n]。
  const sd = Math.sqrt(mean * (1 - p));
  const k = Math.round(mean + sd * standardNormal(rng));
  return k < 0 ? 0 : k > n ? n : k;
}

/** 逆变换法：从 P(0) 开始累加概率，直到超过一个均匀随机数。适合均值较小的情况。 */
function binomialInversion(rng: Rng, n: number, p: number): number {
  const q = 1 - p;
  const ratio = p / q;
  let prob = powInt(q, n);
  let cdf = prob;
  const u = rng.nextFloat();
  let k = 0;
  while (u > cdf && k < n) {
    prob *= ((n - k) / (k + 1)) * ratio;
    k += 1;
    cdf += prob;
    // 浮点累加到不了 1 的极端情况，兜底。
    if (prob === 0) break;
  }
  return k;
}

/**
 * 近似标准正态：12 个均匀数之和减 6（Irwin–Hall）。
 * 均值 0、方差 1，尾部截断在 ±6，对计数抽样足够；不用 log / cos。
 */
export function standardNormal(rng: Rng): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += rng.nextFloat();
  return s - 6;
}

/** 把小数期望值随机取整：floor(x)，再以小数部分为概率加 1。期望不变。 */
export function stochasticRound(rng: Rng, x: number): number {
  const base = Math.floor(x);
  return base + (rng.nextFloat() < x - base ? 1 : 0);
}
