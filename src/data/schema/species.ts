import { z } from 'zod';

const monthlyFraction = z.array(z.number().min(0).max(1)).length(12);

/**
 * 物种数据：只写性状（体型、食性、活动时段、繁殖、存活、移动），不写"效果"。
 * 谁吃谁、吃多少、跑多远，都由引擎从这些性状推导（铁律 5）。
 */
export const SpeciesSchema = z
  .object({
    /** 英文短名，用作标识。 */
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    name: z.string(),
    /** 学名，方便核对出处。 */
    scientificName: z.string(),
    /** 食性：食草（吃植被层）或食肉（吃别的动物）。 */
    diet: z.enum(['herbivore', 'carnivore']),
    /** 成体平均体重（千克）。 */
    bodyMassKg: z.number().positive(),
    /** 主要活动时段，决定和谁碰得上。 */
    activity: z.enum(['diurnal', 'nocturnal', 'crepuscular', 'cathemeral']),
    reproduction: z.object({
      /** 平均每窝仔数。 */
      litterSize: z.number().positive(),
      /** 妊娠期（天）。 */
      gestationDays: z.number().positive(),
      /** 两窝之间的最短间隔（天），不短于妊娠期。 */
      litterIntervalDays: z.number().positive(),
      /** 性成熟年龄（天）。 */
      ageAtMaturityDays: z.number().positive(),
      /** 各月处于繁殖期的比例（月份从春季第一个月算起）。 */
      breedingByMonth: monthlyFraction,
    }),
    survival: z.object({
      /** 野外成体的年存活率。 */
      adultAnnual: z.number().min(0).max(1),
    }),
    /** 最长寿命（年），第 4 步个体有年龄后用。 */
    maxLifespanYears: z.number().positive(),
    movement: z.object({
      /** 每天活动范围的典型直径（米），决定扩散快慢。 */
      dailyRangeM: z.number().positive(),
    }),
    /** 开局密度（只 / 公顷）。 */
    initialDensityPerHa: z.number().min(0),
    source: z.string(),
  })
  .refine((s) => s.reproduction.litterIntervalDays >= s.reproduction.gestationDays, {
    message: 'litterIntervalDays 不能短于 gestationDays',
  });

export type SpeciesParams = z.infer<typeof SpeciesSchema>;
