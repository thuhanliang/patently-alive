import { z } from 'zod';

/** 创建一次推演所需的全部输入。同一份配置 + 同一份操作日志 = 同一个结果。 */
export const SimConfigSchema = z.object({
  seed: z.number().int().min(0).max(0xffff_ffff),
});

export type SimConfig = z.infer<typeof SimConfigSchema>;
