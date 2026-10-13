import { z } from 'zod';

const monthly = z.array(z.number().min(0)).length(12);

/**
 * 一片世界的环境参数。阶段 0 只有草原：地图尺寸、肥力分布、植被生长、天气。
 * 生物量单位：克干物质 / 平方米（g/m²）；速率单位：每天。
 */
export const WorldParamsSchema = z.object({
  name: z.string(),
  /** 地图宽、高（格）。代码上不限制尺寸。 */
  width: z.number().int().min(1),
  height: z.number().int().min(1),
  /** 一格的边长（米），以后算密度用。 */
  cellSizeM: z.number().positive(),
  fertility: z.object({
    /** 肥力取值范围，乘在植被上限上。 */
    min: z.number().min(0).max(1),
    max: z.number().min(0).max(1),
    /** 肥力噪声的特征尺度（格）。越大斑块越大。 */
    patchSize: z.number().int().min(2),
  }),
  vegetation: z.object({
    /** 肥力为 1 的格子的植被上限。 */
    maxBiomass: z.number().positive(),
    /** 植被不会低于这个量（根和种子库），保证能再长回来。 */
    floorBiomass: z.number().min(0),
    /** 开局植被占上限的比例。 */
    initialFraction: z.number().min(0).max(1),
    /** logistic 生长的内禀增长率（每天）。 */
    growthRate: z.number().min(0),
    /** 各月生长系数，乘在增长率上（月份从春季第一个月算起）。 */
    growthByMonth: monthly,
    /** 各月枯落比例（每天）。 */
    decayByMonth: monthly,
  }),
  weather: z.object({
    /** 天气系数逐日变化的惯性（0–1），越大越"连阴天"。 */
    persistence: z.number().min(0).max(1),
    /** 每天新抽的天气系数范围，乘在植被生长上。 */
    min: z.number().min(0),
    max: z.number().min(0),
  }),
  /** 数值出处说明。 */
  source: z.string(),
});

export type WorldParams = z.infer<typeof WorldParamsSchema>;
