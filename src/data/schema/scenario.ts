import { z } from 'zod';

/**
 * 情景：一片预设世界 + 一段"历史" + 业主的委托 + 开局资源。
 * 世界（地形、物种）引用 world/ 下的数据文件；这里只写情景本身。
 * 评分方式不在这里写：指标只由引擎定义（铁律 4），情景只能选用引擎给的指标、给目标值（goal）。
 */
/**
 * 委托目标：情景只能选用引擎定义的指标、给目标值（铁律 4），评分公式在 src/sim/score.ts。
 */
export const GoalSchema = z.object({
  /** 要恢复的物种。 */
  target: z.string(),
  /** 恢复目标：和第一年同一季比，达到几倍算"完全恢复"（恢复分 100；持平是 50 分，见 src/sim/score.ts）。 */
  recovery: z.number().min(1),
  /** 本地物种（其余算外来）：多样性看本地物种是否都还在，稳定度看外来物种有没有暴涨。 */
  native: z.array(z.string()).min(1),
  /** 委托期（年），按季度结算。 */
  years: z.number().int().min(1).max(20),
  /** 委托人每季度拨的经费（满意度 100 时的全额，按满意度打折）。 */
  quarterlyBudget: z.number().int().min(0),
});

export type Goal = z.infer<typeof GoalSchema>;

export const ScenarioSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string(),
  /** 世界数据文件名（不含 .json）。 */
  world: z.string(),
  /** 默认种子；同一个情景每次开局地图一样，换种子是另一张图。 */
  seed: z.number().int().min(0).max(0xffff_ffff),
  /** 档案馆的历史卡：开局时读到的背景，取材于真实的生态史。 */
  history: z.object({
    title: z.string(),
    paragraphs: z.array(z.string()).min(1),
    /** 真实依据的出处。 */
    source: z.string(),
  }),
  /** 委托人和委托内容（文字；能考核的目标值在 goal）。 */
  client: z.object({
    name: z.string(),
    letter: z.array(z.string()).min(1),
  }),
  /**
   * 委托人对扑杀的在意程度：每移除一只该物种，满意度降多少。没列出的物种不扣。
   * 这只是引擎定义的"满意度"指标里的权重，不是新的计分方式（铁律 4）。
   */
  sentiment: z.record(z.string(), z.number().min(0)),
  goal: GoalSchema,
  /**
   * 引种：委托允不允许往岛上引进新物种，以及业主明令禁止的物种（例如"本岛禁止引入哺乳动物"就把它们列进来）。
   * 不写时不允许引种。禁令是业主的规定，属于世界内的理由（见 GDD"合理约束"）。
   */
  introduction: z
    .object({
      /** 能不能从档案馆引进真实物种。 */
      allowed: z.boolean(),
      banned: z.array(z.string()).default([]),
      /** 能不能投放事务所自己设计的物种（阶段 3）。设计物种的能力全由性状推导，操作接口会重新编译核对。 */
      designs: z.boolean().default(false),
    })
    .optional(),
  /** 开局资源：预算（元）、人手（兽医队数量）、客户满意度（0–100）。 */
  resources: z.object({
    budget: z.number().int().min(0),
    staff: z.number().int().min(0),
    satisfaction: z.number().min(0).max(100),
  }),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
