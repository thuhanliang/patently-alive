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

export const ToolsSchema = z.object({
  traps: z.array(TrapTypeSchema).min(1),
  cull: CullSchema,
});

export type TrapType = z.infer<typeof TrapTypeSchema>;
export type CullParams = z.infer<typeof CullSchema>;
export type Tools = z.infer<typeof ToolsSchema>;
