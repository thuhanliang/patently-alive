import type { GaitRules } from '../../data/schema/gait';

/**
 * 纸偶的动作节奏（M1 设计台玩具）：全是纯函数，不碰 PixiJS，可以单测。
 *
 * 节奏不是手调的动画曲线，是缩放律：
 * - 走、小跑、奔跑由弗劳德数 Fr = v²/(g·h) 决定（动力相似：Fr 相同，步态相似）；
 * - 步长 λ = 2.3·Fr^0.3·h（Alexander 1976），步频 = v/λ，所以同样的 Fr 下步频 ∝ √(g/h)：腿长的动物迈得慢、显得沉；
 * - 呼吸、心跳 ∝ 体重^(−1/4)；
 * - 尾巴、耳朵是弹簧跟随，固有频率按单摆 √(g/长度)。
 * 数和出处都在 gait.json。只在画面里用，不进推演。
 */

export const G = 9.81;

export type Gait = 'stand' | 'walk' | 'trot' | 'gallop';

export interface GaitState {
  gait: Gait;
  /** 弗劳德数 v²/(g·h)。 */
  froude: number;
  /** 一个完整步态周期（同一只脚两次落地之间）走过的距离，米。 */
  strideM: number;
  /** 步频（每秒几个周期）。 */
  strideHz: number;
  /** 每只脚着地的时间占一个周期的比例。 */
  duty: number;
}

const pow = (rule: { coef: { value: number }; exp: { value: number } }, x: number): number => rule.coef.value * Math.pow(x, rule.exp.value);

/** 弗劳德数。 */
export function froudeOf(speedMs: number, legM: number): number {
  return (speedMs * speedMs) / (G * legM);
}

/** 某个弗劳德数对应的速度（米/秒）。 */
export function speedAtFroude(froude: number, legM: number): number {
  return Math.sqrt(froude * G * legM);
}

/** 平常走路的速度：Fr ≈ 0.25。 */
export function walkSpeed(rules: GaitRules, legM: number): number {
  return speedAtFroude(rules.walkFroude.value, legM);
}

/** 按弗劳德数选步态；速度几乎是 0 就站着。 */
export function gaitOf(rules: GaitRules, speedMs: number, legM: number): GaitState {
  if (speedMs < 0.02 * Math.sqrt(G * legM)) return { gait: 'stand', froude: 0, strideM: 0, strideHz: 0, duty: 1 };
  const froude = froudeOf(speedMs, legM);
  const gait: Gait = froude < rules.walkTrotFroude.value ? 'walk' : froude < rules.trotGallopFroude.value ? 'trot' : 'gallop';
  const strideM = rules.strideLength.coef.value * Math.pow(froude, rules.strideLength.exp.value) * legM;
  return { gait, froude, strideM, strideHz: speedMs / strideM, duty: rules.duty[gait].value };
}

/** 最高跑速（米/秒）：Hirt 2017 的驼峰曲线，乘推演里腿长带来的速度倍数（params.body.speed）。 */
export function topSpeed(rules: GaitRules, massKg: number, speedFactor = 1): number {
  const { a, b, h, i } = rules.topSpeed;
  const kmh = a.value * Math.pow(massKg, b.value) * (1 - Math.exp(-h.value * Math.pow(massKg, i.value)));
  return (kmh / 3.6) * speedFactor;
}

/** 静息呼吸（次/分）。 */
export function breathsPerMin(rules: GaitRules, massKg: number): number {
  return pow(rules.breath, massKg);
}

/** 静息心率（次/分）。 */
export function heartPerMin(rules: GaitRules, massKg: number): number {
  return pow(rules.heart, massKg);
}

/** 咀嚼频率（次/秒）。 */
export function chewHz(rules: GaitRules, massKg: number): number {
  return pow(rules.chew, massKg);
}

/** 头体长（米）。 */
export function bodyLengthM(rules: GaitRules, massKg: number): number {
  return pow(rules.bodyLength, massKg);
}

/** 伸直的腿长（髋高，米），乘腿型部件自带的长度和设计的腿长倍数。 */
export function legLengthM(rules: GaitRules, massKg: number, limbsPart: string, legScale = 1): number {
  return pow(rules.hipHeight, massKg) * (rules.limbLength[limbsPart] ?? 1) * legScale;
}

/** 弹簧（阻尼振子）：位置 x 追目标，ω 是固有角频率，ζ 是阻尼比。 */
export interface Spring {
  x: number;
  v: number;
}

/**
 * 弹簧走一步。半隐式欧拉，按最多 1/120 秒切小步，所以掉帧（dt 很大）时也不会炸开。
 */
export function springStep(s: Spring, target: number, omega: number, zeta: number, dt: number): void {
  const n = Math.max(1, Math.ceil(dt * 120));
  const h = dt / n;
  for (let k = 0; k < n; k++) {
    const a = -omega * omega * (s.x - target) - 2 * zeta * omega * s.v;
    s.v += a * h;
    s.x += s.v * h;
  }
}

/** 单摆的固有角频率 √(g/长度)：长尾巴晃得慢。 */
export function pendulumOmega(lengthM: number): number {
  return Math.sqrt(G / Math.max(1e-3, lengthM));
}
