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
    /**
     * 食性：三类食物各占多少（加起来为 1），口径参照 EltonTraits 1.0：
     * plant = 果实 + 花蜜 + 种子 + 其他植物部分（吃植被层）；vertebrate = 各类脊椎动物 + 腐肉（捕食别的动物）；
     * invertebrate = 无脊椎动物（昆虫等，多少跟着植被走）。
     */
    diet: z.object({
      plant: z.number().min(0).max(1),
      vertebrate: z.number().min(0).max(1),
      invertebrate: z.number().min(0).max(1),
    }),
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
      /** 性成熟年龄（天，整数）。引擎把幼体分成 8 个年龄段，至少要 8 天。 */
      ageAtMaturityDays: z.number().int().min(8),
      /** 各月处于繁殖期的比例（月份从春季第一个月算起）。 */
      breedingByMonth: monthlyFraction,
      /**
       * 幼体在窝里待多少天：鸟是孵化期 + 出飞前的雏鸟期（蛋从产下那天起就算"幼体"），哺乳动物是断奶前。
       * 窝里的幼体不走动、不能逃，按 nest 的类型决定多容易被找到。
       * 不写的物种按旧规则：幼体前一半时间在窝里，和别的幼体一样容易被抓（阶段 0 的物种）。
       */
      nestDays: z.number().int().min(1).optional(),
      /** 窝的类型：ground 地面浅窝（靠植被掩护）；burrow 洞穴或巢穴（不太容易被找到）。需要 nestDays。 */
      nest: z.enum(['ground', 'burrow']).optional(),
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
      /** 家域面积（平方公里），参考数据。 */
      homeRangeKm2: z.number().positive().optional(),
      /**
       * 是否守固定领地（不随食物多少伸缩）。守领地的物种按家域面积限定能挤多密：领地占满了就不再繁殖。
       * 否则按体重的典型密度算（Damuth 定律）。需要 homeRangeKm2。
       */
      territorial: z.boolean().optional(),
      /** 会飞：受惊的成体和出了窝的幼体大多能飞走（窝里的蛋和雏鸟不能）。 */
      flies: z.boolean().optional(),
      /** 会爬：翻得过普通围栏（顶上有防爬帽的翻不过，见 tools.fences）。 */
      climbs: z.boolean().optional(),
    }),
    /** 开局密度（只 / 公顷）。 */
    initialDensityPerHa: z.number().min(0),
    source: z.string(),
  })
  .refine((s) => s.reproduction.litterIntervalDays >= s.reproduction.gestationDays, {
    message: 'litterIntervalDays 不能短于 gestationDays',
  })
  .refine((s) => !s.movement.territorial || s.movement.homeRangeKm2 !== undefined, {
    message: 'territorial 需要 homeRangeKm2',
  })
  .refine((s) => Math.abs(s.diet.plant + s.diet.vertebrate + s.diet.invertebrate - 1) < 1e-9, {
    message: 'diet 三项加起来要等于 1',
  })
  .refine((s) => s.reproduction.nest === undefined || s.reproduction.nestDays !== undefined, {
    message: 'nest 需要 nestDays',
  })
  .refine((s) => s.reproduction.nestDays === undefined || s.reproduction.nestDays < s.reproduction.ageAtMaturityDays, {
    message: 'nestDays 要短于 ageAtMaturityDays',
  });

export type SpeciesParams = z.infer<typeof SpeciesSchema>;
