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
});
export type ViabilityRules = z.infer<typeof ViabilityRulesSchema>;
