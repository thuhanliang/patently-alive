import { z } from 'zod';

/**
 * 身体可行性检查的阈值（阶段 3.5，src/data/scaling/viability.json）。
 *
 * 检查的种类和公式由引擎定义（src/sim/viability.ts），数据只给数。每个数都要写依据：
 * 和 MODEL.md 一样分三级（data 数据 / law 规律 / assumption 假设），再写置信度和出处，方便以后核对和调参。
 */

/** 依据三级：数据（直接来自数据库或测量）、规律（文献里的缩放关系）、假设（我们定的，可调）。 */
export const BASIS = ['data', 'law', 'assumption'] as const;
/** 置信度：checked 读过原文；2+ 两个以上来源一致；1 单一来源；unverified 未核对。 */
export const CONFIDENCE = ['checked', '2+', '1', 'unverified'] as const;

export const ThresholdSchema = z.strictObject({
  value: z.number(),
  basis: z.enum(BASIS),
  confidence: z.enum(CONFIDENCE),
  source: z.string().min(1),
});
export type Threshold = z.infer<typeof ThresholdSchema>;

/** 体内系统（体重分配的五个份额）。引擎定义，数据不能新增。 */
export const BODY_SYSTEMS = ['skeleton', 'muscle', 'gut', 'heart', 'fat'] as const;
export type BodySystem = (typeof BODY_SYSTEMS)[number];

/** 一个系统的默认份额：coef · M^exp（M 为千克），占体重的比例。 */
const ShareLawSchema = z.strictObject({ coef: ThresholdSchema, exp: ThresholdSchema });
const SharesSchema = z.strictObject(Object.fromEntries(BODY_SYSTEMS.map((s) => [s, ShareLawSchema])) as Record<BodySystem, typeof ShareLawSchema>);

export const ViabilityRulesSchema = z.strictObject({
  body: z.strictObject({
    mammal: SharesSchema,
    bird: SharesSchema,
    /** 玩家能调的倍数范围（相对默认份额）。 */
    minRelative: ThresholdSchema,
    maxRelative: ThresholdSchema,
  }),
  skeleton: z.strictObject({
    /** 默认份额、1 千克时的骨安全系数。 */
    safetyAtRef: ThresholdSchema,
    /** 站姿变直能抵消应力上升到多重（千克）；再重腿已经是柱子，安全系数按 M^-stressExp 下降。 */
    postureLimitKg: ThresholdSchema,
    /** 形状不变放大时骨应力上升的指数（平方–立方定律：1/3）。 */
    stressExp: ThresholdSchema,
    /** 安全系数低于这几个数：跑不动 / 走不动 / 站不住。 */
    cannotRun: ThresholdSchema,
    cannotWalk: ThresholdSchema,
    cannotStand: ThresholdSchema,
    /** 安全系数正好在"站不住"时每天承重骨折的概率；"走不动"以上为 0，中间按缺口的平方插值，再低继续上升（封顶 1）。 */
    fractureDailyAtStand: ThresholdSchema,
  }),
  /** 繁殖（阶段 3.5）：一窝总重和新生体重的真实范围在 laws.json（拟合），这里只给后果的形状和分级。 */
  reproduction: z.strictObject({
    /** 新生儿比真实范围还小时，活下来的比例 =（新生体重 ÷ 范围下限）^这个指数。 */
    neonateSurvivalExp: ThresholdSchema,
    /** 鸟每窝蛋数超过真实范围时，养得活的比例 =（范围上限 ÷ 蛋数）^这个指数。 */
    clutchSurvivalExp: ThresholdSchema,
    /** 新生儿正好是范围上限的两倍大时，每生一窝母亲难产死亡的概率；按超出倍数的对数的平方上升，封顶 1。 */
    dystociaAtDouble: ThresholdSchema,
    /** 分级：幼崽活下来的比例低于这两个数是"不行""致命"；难产概率高于这两个数同理。 */
    failingSurvival: ThresholdSchema,
    fatalSurvival: ThresholdSchema,
    failingDystocia: ThresholdSchema,
    fatalDystocia: ThresholdSchema,
  }),
  /**
   * 消化与食性（阶段 3.5）：能从植物里得到多少能量 = 可溶部分 + 纤维 × 这副消化道能发酵掉的比例；
   * 一天能过的食物量 = headroom × 部件的容量 × 消化道份额；和这具身体要的能量比。公式见 src/sim/viability.ts。
   */
  digestion: z.strictObject({
    /** 部件的植物消化率是按这个可溶比例的植物定的（大体型吃整株草本）。 */
    referenceSoluble: ThresholdSchema,
    /** 一天最多能过平时食量的几倍。 */
    headroom: ThresholdSchema,
    /** 比这个体重（千克）小，纤维在肠里留不够久，按 (M / smallKg)^sizeExp 打折。 */
    smallKg: ThresholdSchema,
    sizeExp: ThresholdSchema,
    /** 吃盲肠便把小体型的折扣补回多少（0–1）。 */
    caecotrophyRecovery: ThresholdSchema,
    /** 分级：只吃草本时得到的能量占需求的比例低于这几个数，是"吃力""不行""致命"。 */
    strainedFed: ThresholdSchema,
    failingFed: ThresholdSchema,
    fatalFed: ThresholdSchema,
    /** 只出提醒、不设上限：以虫子为主的超过这个体重、以肉为主的超过这个体重，很可能吃不饱（千克）。 */
    insectivoreMaxKg: ThresholdSchema,
    carnivoreMaxKg: ThresholdSchema,
  }),
  /**
   * 形状（2026-10-22，腿长、尾长进推演）：设计的 shape 写"比一般长多少"（以 10 为底的对数），范围在这里。
   * 腿长 L 改三样：每走一米的能量 ∝ L^-costLegExp（只改 locomotionShare 那一份）、最高速度 ∝ L^speedLegExp（追捕）、
   * 骨安全系数 ∝ L^-boneLegExp。尾长 T 改两样：尾型部件自己的效果按 T 次方放大或缩小、多带 tailMassShare × (T − 1) 的体重。
   */
  shape: z.strictObject({
    legMin: ThresholdSchema,
    legMax: ThresholdSchema,
    tailMin: ThresholdSchema,
    tailMax: ThresholdSchema,
    locomotionShare: ThresholdSchema,
    costLegExp: ThresholdSchema,
    speedLegExp: ThresholdSchema,
    boneLegExp: ThresholdSchema,
    tailMassShare: ThresholdSchema,
  }),
});
export type ViabilityRules = z.infer<typeof ViabilityRulesSchema>;
