import { z } from 'zod';

/** 一条拟合公式：log10(y) = intercept + Σ terms[自变量] · 自变量。见 scripts/data/fit-scaling.mjs。 */
export const LawSchema = z.object({
  name: z.string(),
  unit: z.string(),
  intercept: z.number(),
  terms: z.record(z.string(), z.number()),
  n: z.number().int().positive(),
  r2: z.number(),
  /** 残差的标准差（log10）：真实物种通常落在预测值的 10^±sd 倍以内。 */
  residualSdLog10: z.number().nonnegative(),
  source: z.string(),
  note: z.string().optional(),
});

/** 带真实范围的公式：envelope 是真实物种残差（log10）的 1% 和 99% 分位。 */
export const EnvelopeLawSchema = LawSchema.extend({ envelope: z.object({ low: z.number(), high: z.number() }) });

const lifeHistory = {
  gestationDays: LawSchema,
  ageAtMaturityDays: LawSchema,
  maxLifespanYears: LawSchema,
};

/** 体重缩放公式（src/data/scaling/laws.json）：设计编译器从"原因"推导物种参数用。 */
export const ScalingLawsSchema = z.object({
  mammal: z.object({ ...lifeHistory, litterIntervalDays: LawSchema, weaningDays: LawSchema, weaningMassG: LawSchema, homeRangeKm2: LawSchema, basalMetabolismW: LawSchema }),
  bird: z.object({ ...lifeHistory, clutchesPerYear: LawSchema }),
  /** 繁殖检查（阶段 3.5）：一窝总重、新生体重的真实范围；鸟是每窝蛋数的真实范围。 */
  reproduction: z.object({
    mammal: z.object({ litterMassG: LawSchema, neonateMassG: EnvelopeLawSchema }),
    bird: z.object({ clutchSize: EnvelopeLawSchema }),
  }),
  survival: z.object({
    kMammal: z.number().positive(),
    kBird: z.number().positive(),
    residualSdLog10: z.object({ mammal: z.number(), bird: z.number() }),
  }),
  dailyRange: z.object({ c: z.number().positive(), residualSdLog10: z.number() }),
  /** 拟合用到的数据里最重的物种：比它重就是外推。 */
  dataRange: z.object({
    mammal: z.object({ maxMassKg: z.number().positive(), species: z.string() }),
    bird: z.object({ maxMassKg: z.number().positive(), species: z.string() }),
  }),
  flight: z.object({ maxMassKg: z.number().positive(), heaviestFlyer: z.string() }),
  fieldMetabolism: z.object({
    mammal: z.object({ coef: z.number().positive(), exp: z.number().positive() }),
    bird: z.object({ coef: z.number().positive(), exp: z.number().positive() }),
  }),
});

export type Law = z.infer<typeof LawSchema>;
export type EnvelopeLaw = z.infer<typeof EnvelopeLawSchema>;
export type ScalingLaws = z.infer<typeof ScalingLawsSchema>;
