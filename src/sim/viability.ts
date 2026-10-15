import type { Design, HintId, Part, Slot } from '../data/schema/design';
import type { ViabilityRules } from '../data/schema/viability';
import type { BodyAllocation } from './body';
import { detPow } from './detmath';

/**
 * 身体可行性检查（阶段 3.5）。
 *
 * 一项检查只看这具身体本身（体重、部件、体重分配），算出它撑不撑得住；和世界无关，所以同一份设计放到哪个情景都一样，
 * id 也不变（铁律 5）。要比较世界（这片地的草够不够好、冷不冷）的检查，声明自己需要哪种环境输入；
 * 环境输入只给设计台预览用，没有就跳过，从不写进物种参数。以后接气候就是在 EnvironmentProfile 上加字段。
 *
 * 检查的种类、公式、顺序由引擎定义（CHECKS），数据只给阈值（viability.json）。全部是纯函数，结果确定。
 * 提示而不是禁止：检查只给等级、余量和提醒；不合理的身体照样能投放，后果在推演里按等级发生：
 * 设计编译器把后果算进物种参数（例如 skeletonEffects → params.body），推演只读参数。
 */

/** 引擎定义的检查（会逐步加：体温、循环……）。 */
export const CHECK_IDS = ['skeleton', 'digestion', 'reproduction'] as const;
export type CheckId = (typeof CHECK_IDS)[number];

/** 等级：正常 / 吃力 / 不行 / 致命（骨骼就是：能跑 / 跑不动 / 走不动 / 站不住）。 */
export const GRADES = ['ok', 'strained', 'failing', 'fatal'] as const;
export type Grade = (typeof GRADES)[number];

/** 环境输入（只给设计台预览）。现在没有字段；以后加植物（第 6 步）、气候（降雨、季节、气温……）。 */
export interface EnvironmentProfile {
  readonly forage?: unknown;
  readonly climate?: unknown;
}
export type EnvironmentInput = keyof EnvironmentProfile;

export interface ViabilityContext {
  readonly design: Design;
  readonly parts: Readonly<Record<Slot, Part>>;
  readonly bird: boolean;
  readonly body: BodyAllocation;
  readonly rules: ViabilityRules;
  readonly env?: EnvironmentProfile;
}

export interface CheckResult {
  readonly id: CheckId;
  readonly grade: Grade;
  /** 余量：大于 1 是安全的，越小越危险（设计台画成刻度）。 */
  readonly margin: number;
  /** 算出等级用的数（例如骨的安全系数），尸检和设计台的说明引用。 */
  readonly evidence: Readonly<Record<string, number>>;
  readonly hints: readonly { id: HintId; vars: Record<string, string | number> }[];
  /** 需要的环境输入没有：没算。 */
  readonly skipped?: EnvironmentInput;
}

export interface ViabilityCheck {
  readonly id: CheckId;
  /** 需要哪些环境输入（没有就跳过）。只看身体的检查写空数组。 */
  readonly needs: readonly EnvironmentInput[];
  evaluate(ctx: ViabilityContext): CheckResult;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * 骨骼：骨的安全系数（断裂应力 ÷ 奔跑时的峰值应力）。
 * 默认份额下，0.1–300 千克的动物靠站姿变直维持在 2–4（Biewener）；再重就按平方–立方定律 M^(-1/3) 下降。
 * 骨头多给一倍，截面积大约也多一倍，安全系数跟着翻倍；腿型的站姿再乘上去。
 */
export function skeletonSafety(ctx: Pick<ViabilityContext, 'design' | 'parts' | 'body' | 'rules'>): number {
  const r = ctx.rules.skeleton;
  const m = ctx.design.bodyMassKg;
  const heavy = m > r.postureLimitKg.value ? detPow(m / r.postureLimitKg.value, -r.stressExp.value) : 1;
  return r.safetyAtRef.value * ctx.body.relative.skeleton * (ctx.parts.limbs.posture ?? 1) * heavy;
}

/** 骨骼撑不住时推演里的后果，写进物种参数的 body（见 SpeciesSchema）。 */
export interface SkeletonEffects {
  boneSafety: number;
  runFactor: number;
  walkFactor: number;
  fractureDaily: number;
}

const round4 = (x: number): number => Math.round(x * 10000) / 10000;

/**
 * 安全系数 → 后果（形状由引擎定，系数是数据）：
 * - 奔跑能力 = 安全系数 ÷ "跑不动"的阈值（封顶 1）：追捕的捕获率、被追时逃脱的机会跟着打折；
 * - 走路能力 = 安全系数 ÷ "走不动"的阈值（封顶 1）：每天的活动范围跟着缩；
 * - 每天骨折的概率："走不动"以上为 0，往下按缺口的平方上升，正好"站不住"时为 fractureDailyAtStand，再低继续上升（封顶 1）。
 */
export function skeletonEffects(safety: number, rules: ViabilityRules): SkeletonEffects {
  const r = rules.skeleton;
  const walk = r.cannotWalk.value;
  const gap = Math.max(0, (walk - safety) / (walk - r.cannotStand.value));
  return {
    boneSafety: Math.max(0.0001, round4(safety)),
    runFactor: round4(Math.max(0.0001, Math.min(1, safety / r.cannotRun.value))),
    walkFactor: round4(Math.max(0.0001, Math.min(1, safety / walk))),
    fractureDaily: round4(Math.min(1, r.fractureDailyAtStand.value * gap * gap)),
  };
}

const skeleton: ViabilityCheck = {
  id: 'skeleton',
  needs: [],
  evaluate(ctx) {
    const r = ctx.rules.skeleton;
    const safety = skeletonSafety(ctx);
    const vars = { mass: ctx.design.bodyMassKg, safety: round2(safety) };
    let grade: Grade = 'ok';
    let hint: HintId | undefined;
    if (safety < r.cannotStand.value) [grade, hint] = ['fatal', 'boneCannotStand'];
    else if (safety < r.cannotWalk.value) [grade, hint] = ['failing', 'boneCannotWalk'];
    else if (safety < r.cannotRun.value) [grade, hint] = ['strained', 'boneCannotRun'];
    return { id: 'skeleton', grade, margin: safety / r.cannotRun.value, evidence: { safety }, hints: hint ? [{ id: hint, vars }] : [] };
  },
};

/** 按固定顺序跑的检查。消化与食性（第 6 步）、繁殖（第 4 步）做好后加进来。 */
export const CHECKS: readonly ViabilityCheck[] = [skeleton];

export function runChecks(ctx: ViabilityContext): CheckResult[] {
  return CHECKS.map((c) => {
    const missing = c.needs.find((n) => ctx.env?.[n] === undefined);
    if (missing) return { id: c.id, grade: 'ok', margin: Infinity, evidence: {}, hints: [], skipped: missing };
    return c.evaluate(ctx);
  });
}

/** 几项检查里最差的等级。 */
export function worstGrade(results: readonly CheckResult[]): Grade {
  let worst = 0;
  for (const r of results) worst = Math.max(worst, GRADES.indexOf(r.grade));
  return GRADES[worst]!;
}
