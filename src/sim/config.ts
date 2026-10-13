import { z } from 'zod';
import { SpeciesSchema } from '../data/schema/species';
import { WorldParamsSchema } from '../data/schema/world';
import { ToolsSchema } from '../data/schema/tools';

/** 创建一次推演所需的全部输入。同一份配置 + 同一份操作日志 = 同一个结果。 */
export const SimConfigSchema = z
  .object({
    seed: z.number().int().min(0).max(0xffff_ffff),
    world: WorldParamsSchema,
    /** 世界里的物种，顺序与 world.species 一致。 */
    species: z.array(SpeciesSchema),
    /** 兽医工具的参数（陷阱、搜捕）。不写就不能用工具（只看推演的测试、阶段 0 的草原）。 */
    tools: ToolsSchema.optional(),
  })
  .refine((c) => c.species.map((s) => s.id).join() === c.world.species.join(), {
    message: 'species 必须与 world.species 列出的 id 一一对应、顺序一致',
  });

export type SimConfig = z.infer<typeof SimConfigSchema>;
