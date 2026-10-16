import { z } from 'zod';
import { ThresholdSchema } from './viability';

/**
 * 植物类型（阶段 3.5）：一种植物本身的性质，写在 src/data/plants/plants.json。
 * 长多快、长多高这些随世界（气候、土壤）变的数写在世界数据里（WorldParams.plants），这里只写植物自己的。
 *
 * 生长方式（form）由引擎定义（src/sim/grid.ts），数据只选用哪一种：
 * - herb 草本：长在所有陆地格上，上限乘肥力，有绝对的下限（根和种子库），会按季节枯落；被"啃"（graze）。
 * - woody 木本：只长在它给掩护的那种地形上（cover.terrain，现在只能是灌丛），上限不乘肥力，下限是上限的一个比例，不枯落；被"嚼嫩枝"（browse）。
 */
export const PLANT_FORMS = ['herb', 'woody'] as const;
export type PlantForm = (typeof PLANT_FORMS)[number];

/** 地形名（和 src/sim/terrain.ts 的 TERRAIN 键名一致，水上不长）。 */
export const PLANT_TERRAINS = ['coast', 'grass', 'shrub'] as const;

export const PlantTypeSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  form: z.enum(PLANT_FORMS),
  /** 一天里一格最多被吃掉的比例（够得着的部分，即下限以上）。 */
  eatenPerDay: z.number().gt(0).max(1),
  /** 一格每天能找到的虫子 = 系数 × 生物量（g/m²）× 面积；虫子不单独模拟，跟着植物走。0 = 不养虫。 */
  invertebrateYield: z.number().min(0),
  /**
   * 食物质量（阶段 3.5）：干物质里不用发酵就能消化的部分（细胞内容物）占多少，其余是要靠微生物发酵的纤维。
   * whole 是整株一起吃，select 是挑着吃最好的部分（种子、嫩叶、芽），挑食的嘴（部件的 selective）吃的是后者。
   * 消化检查用它（src/sim/viability.ts），见 docs/MODEL.md。
   */
  soluble: z.strictObject({ whole: z.number().gt(0).max(1), select: z.number().gt(0).max(1) }).refine((q) => q.select >= q.whole, { message: '挑着吃的部分不会比整株差' }),
  /** 在哪种地形上给地面的窝提供掩护，长满时算多少（0–1）；按生物量占上限的比例折算。 */
  cover: z.strictObject({ terrain: z.enum(PLANT_TERRAINS), atFull: z.number().min(0).max(1) }),
  source: z.string().min(1),
});
export type PlantType = z.infer<typeof PlantTypeSchema>;

export const PlantsFileSchema = z.object({
  说明: z.string().optional(),
  types: z.array(PlantTypeSchema).min(1),
});

/**
 * 植被被吃坏（阶段 3.5 第 7 步，src/data/plants/damage.json）：啃食压力、根储备、土壤、按体型的残留。
 * 公式由引擎定义（src/sim/grid.ts 的 growPlants、grazingResidual），数据只给数，每个数带依据。默认关闭。
 */
export const GrazingDamageSchema = z.strictObject({
  /** 啃食压力按最近多少天累计（压力 = 每天被吃掉的份额的逐日衰减和，衰减 1 − 1/windowDays）。 */
  windowDays: ThresholdSchema,
  /** 压力高于它根储备减少、低于 rootRecover 才补回。 */
  rootStop: ThresholdSchema,
  rootRecover: ThresholdSchema,
  rootLossPerDay: ThresholdSchema,
  rootRecoverPerDay: ThresholdSchema,
  /** 根储备的下限（长势乘根储备）。 */
  minRoot: ThresholdSchema,
  /** 草本低于（按土壤打过折的）上限的这个比例算裸地；裸地日土壤减少，否则慢慢补回。 */
  bareShare: ThresholdSchema,
  soilLossPerDay: ThresholdSchema,
  soilRecoverPerDay: ThresholdSchema,
  /** 土壤的下限（草本上限乘土壤）。 */
  minSoil: ThresholdSchema,
  /** 啃不到的残留：比这个体重轻的吃草动物按 (M / 它)^(1/3) 啃得更低。 */
  residualRefKg: ThresholdSchema,
  /** 再低也剩下限的这个比例（根和种子库）。 */
  seedBankShare: ThresholdSchema,
})
  .refine((d) => d.rootRecover.value <= d.rootStop.value, { message: 'rootRecover 不能高于 rootStop' })
  .refine((d) => d.minSoil.value > 0 && d.minRoot.value > 0 && d.seedBankShare.value > 0, { message: '根、土壤、种子库的下限都要大于 0，否则吃坏了长不回来' });
export type GrazingDamage = z.infer<typeof GrazingDamageSchema>;
