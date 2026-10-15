import type { Design, HintId, Part, Slot } from '../data/schema/design';
import type { ScalingLaws } from '../data/schema/scaling';
import type { ViabilityRules } from '../data/schema/viability';
import type { BodyAllocation } from './body';
import { detExp, detLog, detPow } from './detmath';

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
  /** 拟合的缩放公式（繁殖检查要用一窝总重和新生体重的真实范围）。 */
  readonly laws: ScalingLaws;
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

const LN10 = detLog(10);
const log10 = (x: number): number => detLog(x) / LN10;
const pow10 = (y: number): number => detExp(y * LN10);

/**
 * 繁殖的取舍（Smith & Fretwell 1974）：母亲每窝能投入的总重由她的体重定，玩家只选"生几个"和早成 / 晚成。
 * - 兽：一窝总重按体重（早成的重一些）拟合，新生体重 = 一窝总重 ÷ 每窝仔数，再和同体重、同育幼方式的真实新生儿的范围比。
 *   比最小的还小：幼崽保不住；比最大的还大：难产。
 * - 鸟：蛋重只随体重（Rahn），每窝蛋数和同体重真实鸟的上限比，多出来的孵不过来、喂不过来。
 * 返回比值：neonateRatio = 新生体重 ÷ 真实范围的下限（兽）；oversize = 新生体重 ÷ 上限（兽）；clutchRatio = 蛋数 ÷ 上限（鸟）。
 */
export function reproductionFit(ctx: Pick<ViabilityContext, 'design' | 'parts' | 'bird' | 'laws'>): { neonateG: number; neonateRatio: number; oversize: number; clutchRatio: number } {
  const lgM = log10(ctx.design.bodyMassKg * 1000);
  const lgL = log10(ctx.design.litterSize);
  if (ctx.bird) {
    const c = ctx.laws.reproduction.bird.clutchSize;
    const maxLg = c.intercept + c.terms.log10MassG! * lgM + c.envelope.high;
    return { neonateG: 0, neonateRatio: 1, oversize: 0, clutchRatio: pow10(lgL - maxLg) };
  }
  const r = ctx.laws.reproduction.mammal;
  const precocial = ctx.parts.rearing.id === 'precocial' ? 1 : 0;
  const litterLg = r.litterMassG.intercept + r.litterMassG.terms.log10MassG! * lgM + r.litterMassG.terms.precocial! * precocial;
  const neonateLg = litterLg - lgL;
  const typicalLg = r.neonateMassG.intercept + r.neonateMassG.terms.log10MassG! * lgM + r.neonateMassG.terms.precocial! * precocial;
  return {
    neonateG: pow10(neonateLg),
    neonateRatio: pow10(neonateLg - typicalLg - r.neonateMassG.envelope.low),
    oversize: pow10(neonateLg - typicalLg - r.neonateMassG.envelope.high),
    clutchRatio: 0,
  };
}

/** 繁殖撑不住时推演里的后果，写进物种参数的 body。 */
export interface ReproductionEffects {
  /** 生下来的幼崽（孵出来的雏）活下来的比例。 */
  neonateSurvival: number;
  /** 每生一窝母亲难产死亡的概率。 */
  dystociaPerLitter: number;
}

/**
 * 比值 → 后果（形状由引擎定，系数是数据）：
 * - 新生儿太小：活下来的比例 = neonateRatio^neonateSurvivalExp；
 * - 蛋太多：活下来的比例 = (1 / clutchRatio)^clutchSurvivalExp；
 * - 新生儿太大：每窝难产 = dystociaAtDouble ·（log2 超出倍数）²，封顶 1。
 */
export function reproductionEffects(fit: ReturnType<typeof reproductionFit>, rules: ViabilityRules): ReproductionEffects {
  const r = rules.reproduction;
  let survival = 1;
  if (fit.neonateRatio < 1) survival = detPow(fit.neonateRatio, r.neonateSurvivalExp.value);
  if (fit.clutchRatio > 1) survival = detPow(1 / fit.clutchRatio, r.clutchSurvivalExp.value);
  const over = fit.oversize > 1 ? log10(fit.oversize) / log10(2) : 0;
  return {
    neonateSurvival: survival < 1 ? Math.max(0.0001, round4(survival)) : 1,
    dystociaPerLitter: round4(Math.min(1, r.dystociaAtDouble.value * over * over)),
  };
}

/** 百分比：有后果就不写成 0（不到 1% 写"不到 1"）。 */
export function percentText(p: number): string {
  const n = Math.round(p * 100);
  return p > 0 && n === 0 ? '不到 1' : String(n);
}

const reproduction: ViabilityCheck = {
  id: 'reproduction',
  needs: [],
  evaluate(ctx) {
    const r = ctx.rules.reproduction;
    const fit = reproductionFit(ctx);
    const fx = reproductionEffects(fit, ctx.rules);
    const loss = 1 - fx.neonateSurvival;
    const hints: CheckResult['hints'][number][] = [];
    const vars = { litter: ctx.design.litterSize, neonate: round2(fit.neonateG), lost: percentText(loss), dystocia: percentText(fx.dystociaPerLitter) };
    if (loss > 0) hints.push({ id: ctx.bird ? 'clutchTooBig' : 'litterTooBig', vars });
    if (fx.dystociaPerLitter > 0) hints.push({ id: 'dystocia', vars });
    let grade: Grade = 'ok';
    if (loss > 0 || fx.dystociaPerLitter > 0) grade = 'strained';
    if (fx.neonateSurvival < r.failingSurvival.value || fx.dystociaPerLitter >= r.failingDystocia.value) grade = 'failing';
    if (fx.neonateSurvival < r.fatalSurvival.value || fx.dystociaPerLitter >= r.fatalDystocia.value) grade = 'fatal';
    // 余量：离真实范围的两头还有多远（取近的一头）。
    const margin = ctx.bird ? 1 / fit.clutchRatio : Math.min(fit.neonateRatio, 1 / fit.oversize);
    return { id: 'reproduction', grade, margin, evidence: { ...fit, ...fx }, hints };
  },
};

/** 按固定顺序跑的检查。消化与食性（第 6 步）做好后加进来。 */
export const CHECKS: readonly ViabilityCheck[] = [skeleton, reproduction];

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
