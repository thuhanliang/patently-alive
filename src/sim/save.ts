import { z } from 'zod';
import { OpLogSchema } from './ops';
import type { Quarter, Resources } from './session';

/**
 * 存档 = 操作日志 + 这一局此刻的快照（推演状态 + 资源 + 结算记录）。
 *
 * 只靠操作日志也能重现一局（Session.replay），但三年的局要重跑一分多钟；
 * 存档里带上快照，读档时直接恢复。日志照样带着：导出、回放、核对都靠它。
 * 快照必须和"按日志回放到同一刻"逐位相同（tests/save.test.ts 核对）。
 *
 * 读档时核对快照的时刻、配置和形状（防旧版本、防坏文件），但不重跑日志去核对数值：
 * 那正是存档要省掉的时间。手改过的存档文件因此不再等于回放；它只是本机的单机存档，接受这一点。
 */
export const SAVE_FORMAT = 'patently-alive/save';
/**
 * 4：死因账本多了三种身体撑不住的死因（阶段 3.5），旧快照的账本形状不同。
 * 5：格子的植被改成按植物类型存（grid.plants），世界配置也跟着变了（阶段 3.5）。
 */
export const SAVE_VERSION = 5;

const ScoresSchema = z.object({
  recovery: z.number().nullable(),
  stability: z.number().nullable(),
  diversity: z.number().nullable(),
  cost: z.number().nullable(),
  welfare: z.number().nullable(),
});

// 和 Quarter / Resources 类型绑在一起：类型加了字段而这里没加，类型检查就会报错。
const QuarterSchema: z.ZodType<Quarter> = z.object({
  index: z.number().int().min(1),
  day: z.number().int().min(0),
  scores: ScoresSchema,
  detail: z.object({
    targetRatio: z.number().nullable(),
    boom: z.object({ species: z.number().int(), ratio: z.number() }).nullable(),
    nativesLow: z.array(z.number().int()),
    habitat: z.number(),
    spentShare: z.number(),
    sufferingShare: z.number(),
  }),
  targetCount: z.number(),
  satisfactionDelta: z.number(),
  grant: z.number(),
  budget: z.number(),
  satisfaction: z.number(),
  final: z.boolean(),
});

/** Session 自己的状态（推演状态之外的部分）。 */
export const SessionStateSchema = z.object({
  speed: z.number().int().min(0),
  resources: z.object({
    budget: z.number(),
    busyUntil: z.array(z.number().int()),
    satisfaction: z.number().min(0).max(100),
  }) satisfies z.ZodType<Resources>,
  spent: z.number().min(0),
  received: z.number().min(0),
  quarters: z.array(QuarterSchema),
  removed: z.array(z.number().int().min(0)),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

export const SaveSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  version: z.literal(SAVE_VERSION),
  log: OpLogSchema,
  session: SessionStateSchema,
  /** 推演状态（SimState，类型化数组照原样）。读档时再核对它和日志对得上。 */
  state: z.record(z.string(), z.unknown()),
});
export type SaveFile = z.infer<typeof SaveSchema>;
