import { z } from 'zod';
import { SpeciesSchema } from '../data/schema/species';
import { WorldParamsSchema } from '../data/schema/world';
import { ToolsSchema } from '../data/schema/tools';
import { HintTemplatesSchema, PartSchema } from '../data/schema/design';
import { ScalingLawsSchema } from '../data/schema/scaling';
import { ViabilityRulesSchema } from '../data/schema/viability';
import { PlantTypeSchema } from '../data/schema/plant';

/**
 * 设计编译要用的数据（部件、缩放公式、提醒模板、可行性阈值、植物类型、胃口基准）。放进配置，存档和日志自己就能重新编译、核对设计物种。
 */
export const DesignDataSchema = z.object({
  parts: z.array(PartSchema),
  laws: ScalingLawsSchema,
  hints: HintTemplatesSchema,
  viability: ViabilityRulesSchema,
  /** 植物类型（消化检查用）。 */
  plants: z.array(PlantTypeSchema),
  appetiteBaseline: z.number().positive(),
});
export type DesignData = z.infer<typeof DesignDataSchema>;

/** 创建一次推演所需的全部输入。同一份配置 + 同一份操作日志 = 同一个结果。 */
export const SimConfigSchema = z
  .object({
    seed: z.number().int().min(0).max(0xffff_ffff),
    world: WorldParamsSchema,
    /** 世界里的物种，顺序与 world.species 一致。 */
    species: z.array(SpeciesSchema),
    /** 兽医工具的参数（陷阱、搜捕）。不写就不能用工具（只看推演的测试、阶段 0 的草原）。 */
    tools: ToolsSchema.optional(),
    /** 设计编译的数据。不写就不能投放设计物种。 */
    design: DesignDataSchema.optional(),
    /**
     * 能从档案馆引进的现有技术（真实物种的完整参数）。写了的话，不附设计的引种必须和其中一条一模一样：
     * 不能手写一份参数说它是真实动物（铁律 5）。不写就不核对（只看推演的测试）。
     */
    catalog: z.array(SpeciesSchema).optional(),
  })
  .refine((c) => c.species.map((s) => s.id).join() === c.world.species.join(), {
    message: 'species 必须与 world.species 列出的 id 一一对应、顺序一致',
  });

export type SimConfig = z.infer<typeof SimConfigSchema>;
