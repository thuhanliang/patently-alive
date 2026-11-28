import { z } from 'zod';
import { GrazingDamageSchema, PlantTypeSchema } from './plant';

const monthly = z.array(z.number().min(0)).length(12);

/**
 * 海岛地形：一座主岛（圆形加噪声的海岸线）加几座离岸小岛，其余是水。
 * 不写这一项的世界整张图都是草地（阶段 0 的草原）。
 */
export const IslandTerrainSchema = z.object({
  kind: z.literal('island'),
  /** 主岛半径，占地图短边一半的比例。 */
  mainRadius: z.number().min(0.05).max(1),
  /** 海岸线起伏的幅度（占半径的比例）。 */
  coastRoughness: z.number().min(0).max(1),
  /** 海岸线噪声的特征尺度（格）。 */
  coastPatchSize: z.number().int().min(2),
  islets: z.object({
    count: z.number().int().min(0).max(16),
    /** 小岛半径范围（格）。 */
    minRadius: z.number().int().min(1),
    maxRadius: z.number().int().min(1),
    /** 小岛离主岛、离别的小岛至少隔多少格水。 */
    minGapCells: z.number().int().min(1),
  }).refine((i) => i.minRadius <= i.maxRadius, { message: 'islets.minRadius 不能大于 islets.maxRadius' }),
  /** 内陆（非海岸）陆地里灌丛占的比例。 */
  shrubFraction: z.number().min(0).max(1),
  /** 灌丛斑块的特征尺度（格）。 */
  shrubPatchSize: z.number().int().min(2),
  /** 各地形的肥力系数，乘在肥力噪声上（水的肥力恒为 0）。 */
  fertilityBy: z.object({
    coast: z.number().min(0).max(1),
    grass: z.number().min(0).max(1),
    shrub: z.number().min(0).max(1),
  }),
});
export type IslandTerrain = z.infer<typeof IslandTerrainSchema>;

/**
 * 一片世界的环境参数。阶段 0 只有草原：地图尺寸、肥力分布、植被生长、天气。
 * 生物量单位：克干物质 / 平方米（g/m²）；速率单位：每天。
 */
/**
 * 一种寄生虫（先只有肠道线虫这一类：虫卵随粪便排出，在草上孵成幼虫，吃草的动物吃进去被感染）。
 * 宿主由性状推出（铁律 5）：食谱里植物占到 hostMinPlantDiet 以上的就会吃进幼虫。
 */
export const PathogenSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string(),
  kind: z.literal('nematode'),
  hostMinPlantDiet: z.number().min(0).max(1),
  /** 草地上的幼虫量（0 = 没有，1 = 很重的污染）每天随感染的宿主增加多少：每平方米多少只感染的宿主 × 这个数。 */
  shedPerHostDensity: z.number().positive(),
  /** 幼虫在草上能活多少天（平均）。 */
  larvaeDays: z.number().positive(),
  /** 每天被感染的概率 = 1 − exp(−infectRate × 幼虫量 × 食谱里植物的比例)。 */
  infectRate: z.number().positive(),
  /** 感染以后每天自己清掉（免疫）的概率。 */
  clearPerDay: z.number().min(0).max(1),
  /** 感染的成体每天额外的死亡概率（营养被抢、贫血）。 */
  deathPerDay: z.number().min(0).max(1),
  /** 感染的动物体况评分平均低多少分。 */
  bcsPenalty: z.number().min(0),
  /** 粪检：感染的动物每克粪便的虫卵数（EPG）的平均值，和聚集程度（负二项分布的 k，越小越不均）。 */
  epgMean: z.number().positive(),
  epgK: z.number().positive(),
  /** 开局：草地上的幼虫量（0–1，只在草地格），各物种的感染率。 */
  larvae: z.number().min(0).max(1),
  prevalence: z.record(z.string(), z.number().min(0).max(1)),
  source: z.string(),
});
export type Pathogen = z.infer<typeof PathogenSchema>;

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
  }).refine((f) => f.min <= f.max, { message: 'fertility.min 不能大于 fertility.max' }),
  /** 季节：各月生长系数（乘在每种植物的增长率上）和草本的各月枯落比例（每天）。月份从春季第一个月算起。以后接气候。 */
  season: z.object({
    growthByMonth: monthly,
    decayByMonth: monthly,
  }),
  /**
   * 这片世界里长的植物（阶段 3.5）：植物类型（src/data/plants，加载时按 id 换成完整数据，随配置进存档）
   * 加上它在这片世界里长多快、长多高。顺序就是状态里 grid.plants 的顺序。
   */
  plants: z
    .array(
      z.strictObject({
        type: PlantTypeSchema,
        /** 长满时的生物量（g/m²）。草本乘肥力，木本不乘。 */
        maxBiomass: z.number().positive(),
        /** 开局占上限的比例。 */
        initialFraction: z.number().min(0).max(1),
        /** logistic 生长的内禀增长率（每天），乘季节和天气。 */
        growthRate: z.number().min(0),
        /** 草本：不会低于这个量（根和种子库，g/m²），保证能再长回来。 */
        floorBiomass: z.number().min(0).optional(),
        /** 木本：啃不到的部分（占上限的比例）。 */
        floorFraction: z.number().min(0).max(1).optional(),
      }),
    )
    .min(1)
    .refine((ps) => ps.every((p) => (p.type.form === 'herb' ? p.floorBiomass !== undefined : p.floorFraction !== undefined)), {
      message: '草本要写 floorBiomass，木本要写 floorFraction',
    })
    .refine((ps) => ps.filter((p) => p.type.form === 'herb').length === 1, { message: '现在每片世界正好一种草本（多种草本等吃坏的规则定了再开）' })
    .refine((ps) => ps.filter((p) => p.type.form === 'woody').length <= 1, { message: '现在每片世界最多一种木本' })
    .refine((ps) => ps.every((p) => p.type.form !== 'woody' || p.type.cover.terrain === 'shrub'), {
      message: '木本长在它给掩护的地形上，现在只能是灌丛',
    })
    .refine((ps) => new Set(ps.map((p) => p.type.cover.terrain)).size === ps.length, {
      message: '每种地形的掩护只能来自一种植物',
    }),
  weather: z.object({
    /** 天气系数逐日变化的惯性（0–1），越大越"连阴天"。 */
    persistence: z.number().min(0).max(1),
    /** 每天新抽的天气系数范围，乘在植被生长上。 */
    min: z.number().min(0),
    max: z.number().min(0),
  }).refine((w) => w.min <= w.max, { message: 'weather.min 不能大于 weather.max' }),
  /**
   * 植被会被吃坏（阶段 3.5 第 7 步）：写了才打开，不写就是原来的植被（逐位不变）。
   * 世界数据里写 true，加载时换成 src/data/plants/damage.json 的完整规则（随配置进存档）。
   */
  grazingDamage: GrazingDamageSchema.optional(),
  /** 地形生成参数；不写就整张图都是草地。 */
  terrain: IslandTerrainSchema.optional(),
  /**
   * 水边的食物（2026-10-22）：每平方米海岸格每天能捞到的水生猎物（克鲜重，鱼、蟹虾、蛙），
   * 只给食谱里有 aquatic 的物种（水獭），按拥挤区块合起来分（动物沿着海岸跑遍家域，见 population 的 shoreFood）。
   * 不写就没有；没有在水边觅食的物种时引擎不算这一项。
   */
  shore: z.strictObject({ aquaticPerM2: z.number().min(0) }).optional(),
  /**
   * 岛上的寄生虫（2026-11-28，B 段：兽医从推演里长出来）。见 src/sim/parasite.ts 和 docs/MODEL.md 五之十八。
   * 不写就没有寄生虫，推演和以前完全一样（不多抽一个随机数）。
   */
  pathogens: z.array(PathogenSchema).optional(),
  /** 这片世界里的预设物种（物种数据文件的 id）。 */
  species: z.array(z.string()).min(1),
  /** 开局只在主岛上的物种（离岸小岛上没有）。没有海岛地形时不起作用。 */
  mainIslandOnly: z.array(z.string()).optional(),
  /** 数值出处说明。 */
  source: z.string(),
}).refine((w) => !w.terrain || w.terrain.shrubFraction === 0 || w.plants.some((p) => p.type.form === 'woody' && p.type.cover.terrain === 'shrub'), {
  message: '有灌丛地形的世界要有一种长在灌丛地形上的木本植物',
}).refine((w) => (w.mainIslandOnly ?? []).every((id) => w.species.includes(id)), {
  message: 'mainIslandOnly 里的物种要在 species 里',
});

export type WorldParams = z.infer<typeof WorldParamsSchema>;
