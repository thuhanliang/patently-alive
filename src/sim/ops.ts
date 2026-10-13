import { z } from 'zod';
import { SimConfigSchema } from './config';

/**
 * 玩家操作。所有会改变推演或时间流速的操作都写成这里的数据，
 * 只能通过统一操作接口（Session.submit）提交（铁律 7）。以后的 MCP 也只能调用它。
 */
const FocusRectSchema = z.object({
  x0: z.number().int(),
  y0: z.number().int(),
  x1: z.number().int(),
  y1: z.number().int(),
});

export const OpSchema = z.discriminatedUnion('type', [
  /** 调速；0 表示暂停。只影响"多快看到"，不影响推演结果，但照样记录。 */
  z.object({ type: z.literal('setSpeed'), speed: z.number().int().min(0).max(1000) }),
  /** 在某格投放若干只某物种的成体。 */
  z.object({
    type: z.literal('release'),
    species: z.string(),
    x: z.number().int(),
    y: z.number().int(),
    count: z.number().int().min(1).max(10_000),
  }),
  /** 设置关注区（展开成个体的区域）；null 表示全部收拢。 */
  z.object({ type: z.literal('setFocus'), focus: FocusRectSchema.nullable() }),
]);

export type Op = z.infer<typeof OpSchema>;

/** 日志里的一条：在第几个 tick（推进这个 tick 之前）提交了什么操作。 */
export const LogEntrySchema = z.object({
  tick: z.number().int().min(0),
  op: OpSchema,
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

/**
 * 操作日志文件 = 存档：完整的推演配置（含种子、世界、物种数据）+ 按时间排序的操作。
 * 同一份日志回放出同一个结果。
 */
export const OpLogSchema = z
  .object({
    format: z.literal('patently-alive/oplog'),
    /** 推演规则变了、旧日志回放结果会不同时加一；旧版本日志直接拒绝。 */
    version: z.literal(2),
    config: SimConfigSchema,
    entries: z.array(LogEntrySchema),
    /** 导出时推演走到的 tick；回放默认推进到这里（最后一条操作之后的时间也不丢）。 */
    endTick: z.number().int().min(0),
  })
  .refine((log) => log.entries.every((e, i) => i === 0 || e.tick >= log.entries[i - 1]!.tick), {
    message: '日志里的操作必须按 tick 先后排列',
  })
  .refine((log) => log.entries.every((e) => e.tick <= log.endTick), {
    message: 'endTick 不能早于最后一条操作',
  });
export type OpLog = z.infer<typeof OpLogSchema>;

/** 每种操作的花费。阶段 0 还没有预算和人手的玩法，全部为 0；以后兽医工具在这里定价。 */
export interface Cost {
  budget: number;
  staff: number;
}

export function costOf(_op: Op): Cost {
  return { budget: 0, staff: 0 };
}
