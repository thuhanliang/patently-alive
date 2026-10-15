import { z } from 'zod';

/**
 * 植物类型（阶段 3.5）：一种植物本身的性质，写在 src/data/plants/plants.json。
 * 长多快、长多高这些随世界（气候、土壤）变的数写在世界数据里（WorldParams.plants），这里只写植物自己的。
 *
 * 生长方式（form）由引擎定义（src/sim/grid.ts），数据只选用哪一种：
 * - herb 草本：长在所有陆地格上，上限乘肥力，有绝对的下限（根和种子库），会按季节枯落；被"啃"（graze）。
 * - woody 木本：只长在自己的地形上，上限不乘肥力，下限是上限的一个比例，不枯落；被"嚼嫩枝"（browse）。
 */
export const PLANT_FORMS = ['herb', 'woody'] as const;
export type PlantForm = (typeof PLANT_FORMS)[number];

/** 地形名（和 TERRAIN 对应，水上不长）。 */
export const PLANT_TERRAINS = ['coast', 'grass', 'shrub'] as const;

export const PlantTypeSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  form: z.enum(PLANT_FORMS),
  /** 一天里一格最多被吃掉的比例（够得着的部分，即下限以上）。 */
  eatenPerDay: z.number().gt(0).max(1),
  /** 一格每天能找到的虫子 = 系数 × 生物量（g/m²）× 面积；虫子不单独模拟，跟着植物走。0 = 不养虫。 */
  invertebrateYield: z.number().min(0),
  /** 在哪种地形上给地面的窝提供掩护，长满时算多少（0–1）；按生物量占上限的比例折算。 */
  cover: z.strictObject({ terrain: z.enum(PLANT_TERRAINS), atFull: z.number().min(0).max(1) }),
  source: z.string().min(1),
});
export type PlantType = z.infer<typeof PlantTypeSchema>;

export const PlantsFileSchema = z.object({
  说明: z.string().optional(),
  types: z.array(PlantTypeSchema).min(1),
});
