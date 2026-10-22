import { z } from 'zod';

/**
 * 牙齿能对付哪些食物（2026-10-22，个案动物用）：每类食物里能吃下去的比例。
 * 野外能吃饱多少由它和物种的食谱推出来（铁律 5：写原因"没有牙"，不写效果"活不下去"）。
 */
const EdibleSchema = z.strictObject({
  plant: z.number().min(0).max(1),
  vertebrate: z.number().min(0).max(1),
  invertebrate: z.number().min(0).max(1),
  aquatic: z.number().min(0).max(1),
});
export type Edible = z.infer<typeof EdibleSchema>;

export const DentitionFileSchema = z.object({
  说明: z.string(),
  types: z.record(
    z.string(),
    z.strictObject({
      name: z.string(),
      edible: EdibleSchema,
      basis: z.enum(['data', 'law', 'assumption']),
      source: z.string(),
    }),
  ),
});
export type DentitionFile = z.infer<typeof DentitionFileSchema>;

/**
 * 个案动物（2026-10-22）：情景里单独记着的"这一只"，和格子、个体模型无关（不进数量、不被陷阱抓、不抽随机数）。
 * 属于个体医学这条线（GDD"兽医"），不是在两种尺度之间搭桥，也不是疾病系统。
 * 它的状态只由情景数据、当天日期和日志里的救助操作推出来（见 src/sim/cases.ts）。
 * 文字全写在这里（内容即数据）。
 */
export const CaseSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** 名字（带回事务所以后用）。 */
  name: z.string(),
  /** 是哪种动物（物种 id，用它的食谱）；必须是这片世界开局就有的物种。 */
  species: z.string(),
  /** 现在的体重（千克），决定饿得多快。 */
  massKg: z.number().positive(),
  /** 第几天被人看见。 */
  appearsDay: z.number().int().min(0),
  /** 大概在哪：占地图宽高的比例。开局时找离它最近的灌丛（没有就找陆地），换种子地形变了也落在陆地上。 */
  anchor: z.strictObject({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  /** 被看见时的体况（0–1，1 是健康）。 */
  condition: z.number().gt(0).max(1),
  /** 牙齿（dentition.json 的类型）。 */
  dentition: z.string(),
  /** 加载时按 dentition 填上（随规则进日志和存档，回放不依赖数据文件）。 */
  edible: EdibleSchema.optional(),
  /** 带回事务所：花多少钱（检查、手术、软食）、占一支兽医队几天、之后养几天算养好。 */
  rescue: z.strictObject({ cost: z.number().int().min(0), days: z.number().int().min(1), recoveryDays: z.number().int().min(0) }),
  /** 各个阶段的文字。 */
  text: z.strictObject({
    /** 刚被看见时（自动弹出的卡片）。 */
    found: z.array(z.string()).min(1),
    /** 在野外时的检查所见。 */
    wild: z.array(z.string()).min(1),
    /** 带回来以后、还在养。 */
    rescued: z.array(z.string()).min(1),
    /** 养好了，成了事务所的猫。 */
    office: z.array(z.string()).min(1),
    /** 没来得及。 */
    lost: z.array(z.string()).min(1),
  }),
});
export type Case = z.infer<typeof CaseSchema>;
