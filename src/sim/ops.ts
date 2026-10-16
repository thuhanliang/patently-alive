import { z } from 'zod';
import { SimConfigSchema } from './config';
import type { Tools } from '../data/schema/tools';
import { GoalSchema, type Scenario } from '../data/schema/scenario';
import { SpeciesSchema } from '../data/schema/species';
import { DesignSchema } from '../data/schema/design';
import { fenceLengthCells } from './fence';

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
  /**
   * 引种：把一个物种的 count 只成体运到 (x, y) 放归。物种可以是这一局还没有的（真实动物、以后自己设计的），
   * 完整的性状数据随操作写进日志，所以日志自己就能回放。投放后收不回来（只能靠兽医工具减少）。
   */
  z.object({
    type: z.literal('introduce'),
    species: SpeciesSchema,
    x: z.number().int(),
    y: z.number().int(),
    count: z.number().int().min(1).max(10_000),
    /**
     * 自己设计的物种：附上设计本身。操作接口用这一局的设计数据重新编译，编译结果必须和 species 一模一样
     * （能力只能由性状推导，不能手写参数冒充设计，铁律 5）。
     */
    design: DesignSchema.optional(),
  }),
  /** 设置关注区（展开成个体的区域）；null 表示全部收拢。 */
  z.object({ type: z.literal('setFocus'), focus: FocusRectSchema.nullable() }),
  /** 布一组陷阱：放几晚，抓到名单上的物种就移除，其余放生。占一支兽医队若干天。 */
  z.object({
    type: z.literal('trap'),
    trap: z.string(),
    x: z.number().int(),
    y: z.number().int(),
    nights: z.number().int().min(1).max(30),
    remove: z.array(z.string()),
  }),
  /** 夜间搜捕：在一处移除一种动物。占一支兽医队一天，扑杀本身降低满意度。 */
  z.object({ type: z.literal('cull'), species: z.string(), x: z.number().int(), y: z.number().int() }),
  /** 体检采样：在一处抓一种动物，检查完放生。占一支兽医队一天。 */
  z.object({ type: z.literal('sample'), species: z.string(), x: z.number().int(), y: z.number().int() }),
  /** 找尸体做尸检：在一处搜一天；species 为 null 时什么物种的都要。 */
  z.object({ type: z.literal('necropsy'), species: z.string().nullable(), x: z.number().int(), y: z.number().int() }),
  /** 架一段直围栏：端点在格子的角上。工期按长度算，完工后才挡得住动物。 */
  z.object({
    type: z.literal('fence'),
    fence: z.string(),
    x0: z.number().int(),
    y0: z.number().int(),
    x1: z.number().int(),
    y1: z.number().int(),
  }),
]);

export type Op = z.infer<typeof OpSchema>;

/** 日志里的一条：在第几个 tick（推进这个 tick 之前）提交了什么操作。 */
export const LogEntrySchema = z.object({
  tick: z.number().int().min(0),
  op: OpSchema,
});
export type LogEntry = z.infer<typeof LogEntrySchema>;

/**
 * 一局的规则：开局资源和身份能做什么。情景给定；沙盒（阶段 0 的草原、?sandbox=1）资源不限、可以投放。
 * 资源会随操作变化，也写进日志，回放时从同样的开局资源出发。
 */
export const RulesSchema = z.object({
  /** 情景 id；沙盒为 null。 */
  scenario: z.string().nullable(),
  /** 开局预算（元）。 */
  budget: z.number().int().min(0),
  /** 兽医队数量。 */
  staff: z.number().int().min(0),
  /** 开局的客户满意度（0–100）。 */
  satisfaction: z.number().min(0).max(100),
  /** 能不能直接投放这片世界已有的物种（沙盒的调试手段，不花钱）：沙盒可以，情景里不行。 */
  allowRelease: z.boolean(),
  /** 引种（introduce）：允不允许，以及业主禁止引进的物种。来自情景数据；沙盒允许。 */
  /** designs：能不能投放自己设计的物种（阶段 3）。 */
  introduction: z
    .object({ allowed: z.boolean(), banned: z.array(z.string()), designs: z.boolean().default(false) })
    .default({ allowed: false, banned: [], designs: false }),
  /** 每移除一只某物种，满意度降多少（情景的 sentiment）。没列出的不扣。 */
  sentiment: z.record(z.string(), z.number().min(0)),
  /** 委托目标（情景的 goal）：有了它才按季度结算、评分；沙盒为 null。 */
  goal: GoalSchema.nullable().default(null),
});
export type Rules = z.infer<typeof RulesSchema>;

/** 情景的开局规则：管理员身份（不能投放），资源、扑杀的在意程度、委托目标都来自情景数据。 */
export function scenarioRules(scenario: Scenario): Rules {
  return {
    scenario: scenario.id,
    ...scenario.resources,
    allowRelease: false,
    introduction: {
      allowed: scenario.introduction?.allowed ?? false,
      banned: scenario.introduction?.banned ?? [],
      designs: scenario.introduction?.designs ?? false,
    },
    sentiment: scenario.sentiment,
    goal: scenario.goal,
  };
}

export const SANDBOX_RULES: Rules = {
  scenario: null,
  budget: 1_000_000_000,
  staff: 99,
  satisfaction: 100,
  allowRelease: true,
  introduction: { allowed: true, banned: [], designs: true },
  sentiment: {},
  goal: null,
};

/**
 * 操作日志文件 = 存档：完整的推演配置（含种子、世界、物种数据）+ 开局规则 + 按时间排序的操作。
 * 同一份日志回放出同一个结果。
 */
export const LOG_FORMAT = 'patently-alive/oplog';
/**
 * 推演规则变了、旧日志回放结果会不同时加一；旧版本日志直接拒绝。8：设计物种（配置带设计数据、操作附设计）。
 * 9：设计数据带身体可行性阈值（阶段 3.5）。10：骨骼撑不住的设计，后果写进物种参数（body），阈值数据也改了（阶段 3.5）。
 * 11：体重上限放到 100 吨，缩放数据多了 dataRange。12：世界的植被改成植物类型列表（world.plants，阶段 3.5）。
 * 13：繁殖检查（阶段 3.5）：缩放数据和阈值数据都多了 reproduction，物种参数 body 多了两项。
 * 14：繁殖节奏（阶段 3.5）：大型动物几年一窝（间隔可超过一年），设计可以写"自动"仔数，缩放数据多了 pace。
 * 15：消化检查（阶段 3.5）：设计数据多了植物类型和消化阈值，部件多了消化道、挑食和反刍，植物类型多了食物质量，物种参数 body 多了 gut。
 */
export const LOG_VERSION = 15;

export const OpLogSchema = z
  .object({
    format: z.literal(LOG_FORMAT),
    version: z.literal(LOG_VERSION),
    config: SimConfigSchema,
    rules: RulesSchema,
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

/**
 * 一个操作的花费：预算（元）、几支兽医队、占用几天、满意度变化（负数是下降）。
 * 时间也是资源：兽医队出工期间不能接别的活。
 */
export interface Cost {
  budget: number;
  staff: number;
  days: number;
  satisfaction: number;
}

export const FREE: Cost = { budget: 0, staff: 0, days: 0, satisfaction: 0 };

/**
 * 每种操作的花费。调速、关注区、沙盒里的投放不花钱；兽医工具按工具数据定价。
 * 价格来自推演配置里的工具数据（config.tools），回放时和当时一样。围栏按长度计价，要知道一格多少米。
 */
export function costOf(op: Op, tools: Tools | undefined, cellSizeM: number): Cost {
  switch (op.type) {
    case 'trap': {
      const t = tools?.traps.find((x) => x.id === op.trap);
      if (!t) return FREE;
      return { budget: t.setupCost + t.nightlyCost * op.nights, staff: 1, days: op.nights, satisfaction: 0 };
    }
    case 'cull':
      return tools ? { budget: tools.cull.cost, staff: 1, days: 1, satisfaction: tools.cull.satisfaction } : FREE;
    case 'sample':
      return tools ? { budget: tools.sample.cost, staff: 1, days: 1, satisfaction: 0 } : FREE;
    case 'necropsy':
      return tools ? { budget: tools.necropsy.cost, staff: 1, days: 1, satisfaction: 0 } : FREE;
    case 'introduce': {
      const t = tools?.introduction;
      if (!t) return FREE;
      const budget = t.shipmentCost + op.count * (t.perAnimalCost + Math.round(t.perKgCost * op.species.bodyMassKg));
      return { budget, staff: 1, days: t.days, satisfaction: 0 };
    }
    case 'fence': {
      const f = tools?.fences.find((x) => x.id === op.fence);
      if (!f) return FREE;
      const km = (fenceLengthCells(op) * cellSizeM) / 1000;
      return { budget: Math.round(f.costPerKm * km), staff: 1, days: fenceDays(km, f.kmPerDay), satisfaction: 0 };
    }
    default:
      return FREE;
  }
}

/** 架 km 公里围栏要几天（至少一天）。 */
export function fenceDays(km: number, kmPerDay: number): number {
  return Math.max(1, Math.ceil(km / kmPerDay - 1e-9));
}
