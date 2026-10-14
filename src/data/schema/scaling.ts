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

const lifeHistory = {
  gestationDays: LawSchema,
  ageAtMaturityDays: LawSchema,
  maxLifespanYears: LawSchema,
};

/** 体重缩放公式（src/data/scaling/laws.json）：设计编译器从"原因"推导物种参数用。 */
export const ScalingLawsSchema = z.object({
  mammal: z.object({ ...lifeHistory, litterIntervalDays: LawSchema, homeRangeKm2: LawSchema, basalMetabolismW: LawSchema }),
  bird: z.object({ ...lifeHistory, clutchesPerYear: LawSchema }),
  survival: z.object({
    kMammal: z.number().positive(),
    kBird: z.number().positive(),
    residualSdLog10: z.object({ mammal: z.number(), bird: z.number() }),
  }),
  dailyRange: z.object({ c: z.number().positive(), residualSdLog10: z.number() }),
  flight: z.object({ maxMassKg: z.number().positive(), heaviestFlyer: z.string(), energyFactor: z.number().positive() }),
});

export type Law = z.infer<typeof LawSchema>;
export type ScalingLaws = z.infer<typeof ScalingLawsSchema>;
