import { z } from 'zod';

const food = z.object({
  plant: z.number().min(0).max(1),
  vertebrate: z.number().min(0).max(1),
  invertebrate: z.number().min(0).max(1),
});

/**
 * 兽医工具的数据：价格、要几支队伍、占用几天，以及工具本身的性状（陷阱的触发重量、诱饵）。
 * 抓到谁、抓多少由引擎按动物的性状算（铁律 5）：诱饵对谁有吸引力看食谱，能不能触发看体重，
 * 陷阱附近有多少只看动物每天走多远。
 */
export const TrapTypeSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    name: z.string(),
    /** 能触发机关的体重范围（千克）：太轻踩不动，太重钻不进。 */
    minMassKg: z.number().positive(),
    maxMassKg: z.number().positive(),
    /** 诱饵对三类食性的吸引力（0–1）。对一个物种的吸引力 = Σ 吸引力 × 它食谱里这一类的比例。 */
    bait: food,
    /** 一组陷阱有几个笼子；一个笼子一晚最多抓一只。 */
    cages: z.number().int().min(1),
    /**
     * 笼子散布的半径（格）：0 表示都放在一处；大于 0 是一张陷阱网，笼子摊开在这么大的范围里，
     * 网里的动物和走到一处陷阱边一样容易碰上，所以能覆盖的面积大得多（见 src/sim/jobs.ts）。
     */
    spreadCells: z.number().int().min(0).max(12).default(0),
    /** 布设一组的固定费用（元）和每晚的费用（元）。 */
    setupCost: z.number().int().min(0),
    nightlyCost: z.number().int().min(0),
    source: z.string(),
  })
  .refine((t) => t.minMassKg < t.maxMassKg, { message: 'minMassKg 要小于 maxMassKg' });

export const CullSchema = z.object({
  name: z.string(),
  /** 一晚搜索的半径（格）。 */
  radiusCells: z.number().int().min(1),
  /** 范围里每只目标动物被发现并移除的概率。 */
  success: z.number().min(0).max(1),
  cost: z.number().int().min(0),
  /** 扑杀本身就让人不舒服：每次固定扣的满意度（另外按扑杀的只数扣，见情景的 sentiment）。 */
  satisfaction: z.number().max(0),
  source: z.string(),
});

/**
 * 体检采样：兽医队在一处抓一种动物，称重、评体况、估年龄、看胃内容物，检查完放生。
 * 量出来的数由引擎按动物的真实状态加测量误差算出（src/sim/exam.ts）。
 */
export const SampleSchema = z.object({
  name: z.string(),
  /** 搜捕半径（格）。 */
  radiusCells: z.number().int().min(1),
  /** 范围里每只目标动物被抓到的概率。 */
  success: z.number().min(0).max(1),
  /** 一天最多检查几只。 */
  maxAnimals: z.number().int().min(1),
  cost: z.number().int().min(0),
  source: z.string(),
});

/**
 * 尸检：兽医队在一处搜一天，找新鲜尸体（死了不到几天、还没腐烂的，见 ledger.ts 的 FRESH_DAYS）带回来剖检。
 * 能找到多少看那一带最近死了多少；死因由引擎记账给出，报告的措辞在第 6 步。
 */
export const NecropsySchema = z.object({
  name: z.string(),
  /** 搜索半径（格）。 */
  radiusCells: z.number().int().min(1),
  /** 范围里每具新鲜尸体被找到的概率。 */
  detection: z.number().min(0).max(1),
  /** 一次最多带回几具。 */
  maxCarcasses: z.number().int().min(1),
  cost: z.number().int().min(0),
  source: z.string(),
});

/**
 * 围栏：画一条直线。谁过不去由性状推出（见 src/sim/fence.ts）：会飞的、比 minMassKg 轻的过得去，
 * 会爬的翻得过去，除非 stopsClimbers（顶上有防爬帽）。
 */
export const FenceTypeSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string(),
  /** 网眼挡得住的最小体重（千克）：更轻的钻得过去。 */
  minMassKg: z.number().positive(),
  /** 顶上有防爬帽，会爬的也翻不过。 */
  stopsClimbers: z.boolean(),
  /** 每公里造价（元）。 */
  costPerKm: z.number().int().min(0),
  /** 一支队伍一天能架多少公里。 */
  kmPerDay: z.number().positive(),
  source: z.string(),
});

/**
 * 引种：从别处买来（或繁育）一批动物，运到岛上、检疫、放归。花费分三块：
 * 一批的固定费用（许可、运输、检疫场地），每只的费用，再按体重加价（大动物运输、圈养都更贵）。
 * 一支队伍要忙几天（检疫和放归）。
 */
export const IntroductionSchema = z.object({
  name: z.string(),
  shipmentCost: z.number().int().min(0),
  perAnimalCost: z.number().int().min(0),
  perKgCost: z.number().int().min(0),
  days: z.number().int().min(1),
  /** 一次最多引进几只。 */
  maxAnimals: z.number().int().min(1),
  source: z.string(),
});

export const ToolsSchema = z.object({
  traps: z.array(TrapTypeSchema).min(1),
  cull: CullSchema,
  sample: SampleSchema,
  necropsy: NecropsySchema,
  fences: z.array(FenceTypeSchema).min(1),
  /** 没有时不能引种。 */
  introduction: IntroductionSchema.optional(),
});

export type TrapType = z.infer<typeof TrapTypeSchema>;
export type CullParams = z.infer<typeof CullSchema>;
export type SampleParams = z.infer<typeof SampleSchema>;
export type NecropsyParams = z.infer<typeof NecropsySchema>;
export type FenceType = z.infer<typeof FenceTypeSchema>;
export type IntroductionParams = z.infer<typeof IntroductionSchema>;
export type Tools = z.infer<typeof ToolsSchema>;
