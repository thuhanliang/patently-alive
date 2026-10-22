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
     * aquatic（可选，2026-10-22）= 水里的猎物：鱼、蟹虾等水生无脊椎动物、蛙（EltonTraits 的 Vfish 加水生的部分）。
     * 只在海岸格上有（世界数据的 shore），在水边觅食的动物（水獭）才写；不写为 0。
     */
    diet: z.object({
      plant: z.number().min(0).max(1),
      vertebrate: z.number().min(0).max(1),
      invertebrate: z.number().min(0).max(1),
      aquatic: z.number().gt(0).max(1).optional(),
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
    /**
     * 胃口：三类食物的需求都乘这个倍数（不写为 1）。真实物种不写；设计物种由设计编译器从能量收支推导
     * （部件的开销、育幼、消化率），吃不够照样挨饿（阶段 3）。
     */
    energyFactor: z.number().positive().optional(),
    /**
     * 身体撑不住的地方（阶段 3.5）：设计编译器按可行性检查算出（src/sim/viability.ts），真实物种不写，
     * 撑得住的设计也不写；只写出问题的那几项（骨骼的四个数一起写）。
     * 骨安全系数低：追不上、逃不掉、走得慢、会骨折。繁殖：幼崽保不住、难产。
     */
    body: z
      .strictObject({
        /** 骨的安全系数（尸检、设计台引用）。 */
        boneSafety: z.number().positive().optional(),
        /** 奔跑能力（0–1]：追捕时捕获率乘它；被追时被抓的概率乘 2 − 它。 */
        runFactor: z.number().gt(0).max(1).optional(),
        /** 走路能力（0–1]：每天的活动范围乘它。 */
        walkFactor: z.number().gt(0).max(1).optional(),
        /** 每天承重骨折的概率。 */
        fractureDaily: z.number().min(0).max(1).optional(),
        /**
         * 最高速度相对同体重、同部件的一般值（2026-10-22，腿长）：追捕时捕获率乘 捕食者的 ÷ 猎物的（会飞的猎物不看）。
         * 真实物种不写（= 1）。
         */
        speed: z.number().positive().optional(),
        /** 生下来（孵出来）的幼体活下来的比例（0–1）。 */
        neonateSurvival: z.number().gt(0).lt(1).optional(),
        /** 每生一窝母亲难产死亡的概率。 */
        dystociaPerLitter: z.number().gt(0).max(1).optional(),
        /**
         * 消化道（阶段 3.5，消化检查）：这具身体自己的性质，和世界无关；推演里再拿它和这片地的植物比（见 sim/physiology.ts 的 plantValue）。
         * fiber：纤维能发酵掉的比例（0–1，已算上体型）；capacity：一天最多能过多少植物（相对同体重真实食草动物的食量）；
         * scale：capacity ÷ 要的能量；selective：挑着吃最好的部分。
         * 真实物种不写，吃什么都按原来的算。
         */
        gut: z
          .strictObject({ fiber: z.number().min(0).max(1), capacity: z.number().positive(), scale: z.number().positive(), selective: z.literal(true).optional() })
          .optional(),
      })
      .refine((b) => Object.keys(b).length > 0, { message: 'body 不写就整个省掉' })
      .refine((b) => [b.boneSafety, b.runFactor, b.walkFactor, b.fractureDaily].every((v) => v === undefined) || [b.boneSafety, b.runFactor, b.walkFactor, b.fractureDaily].every((v) => v !== undefined), {
        message: '骨骼的四个数要么都写，要么都不写',
      })
      .optional(),
    /** 画法：主色（设计物种在设计台上选；真实物种的主色在 render/palette.ts）。推演不读它。 */
    appearance: z.object({ color: z.string().regex(/^#[0-9a-f]{6}$/) }).optional(),
    source: z.string(),
  })
  .refine((s) => s.reproduction.litterIntervalDays >= s.reproduction.gestationDays, {
    message: 'litterIntervalDays 不能短于 gestationDays',
  })
  .refine((s) => !s.movement.territorial || s.movement.homeRangeKm2 !== undefined, {
    message: 'territorial 需要 homeRangeKm2',
  })
  .refine((s) => Math.abs(s.diet.plant + s.diet.vertebrate + s.diet.invertebrate + (s.diet.aquatic ?? 0) - 1) < 1e-9, {
    message: 'diet 各项加起来要等于 1',
  })
  .refine((s) => s.reproduction.nest === undefined || s.reproduction.nestDays !== undefined, {
    message: 'nest 需要 nestDays',
  })
  .refine((s) => s.reproduction.nestDays === undefined || s.reproduction.nestDays < s.reproduction.ageAtMaturityDays, {
    message: 'nestDays 要短于 ageAtMaturityDays',
  });

export type SpeciesParams = z.infer<typeof SpeciesSchema>;
