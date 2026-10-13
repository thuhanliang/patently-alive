import { z } from 'zod';

/**
 * 情景：一片预设世界 + 一段"历史" + 业主的委托 + 开局资源。
 * 世界（地形、物种）引用 world/ 下的数据文件；这里只写情景本身。
 * 评分方式不在这里写：指标只由引擎定义（铁律 4），情景只能选用引擎给的指标、给目标值（第 8 步）。
 */
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
  /** 委托人和委托内容（文字；能考核的目标值在第 8 步接入评分）。 */
  client: z.object({
    name: z.string(),
    letter: z.array(z.string()).min(1),
  }),
  /**
   * 委托人对扑杀的在意程度：每移除一只该物种，满意度降多少。没列出的物种不扣。
   * 这只是引擎定义的"满意度"指标里的权重，不是新的计分方式（铁律 4）。
   */
  sentiment: z.record(z.string(), z.number().min(0)),
  /** 开局资源：预算（元）、人手（兽医队数量）、客户满意度（0–100）。 */
  resources: z.object({
    budget: z.number().int().min(0),
    staff: z.number().int().min(0),
    satisfaction: z.number().min(0).max(100),
  }),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
