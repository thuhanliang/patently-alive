import { z } from 'zod';

/**
 * 设计台的部件与性状（阶段 3）。设计只写"原因"，效果全由设计编译器（src/sim/design.ts）推导（铁律 5）。
 *
 * 每个部件属于一个槽位；每个部件最多声明 3 个效果，每个效果通过引擎规定的一个"公式钩子"作用在一个推导量上（乘一个倍数）。
 * 钩子的名单由引擎定义（EFFECT_TARGETS），数据不能发明新的。
 */

/** 部件效果能作用的推导量（引擎定义）。 */
export const EFFECT_TARGETS = ['energy', 'dailyRange', 'mortality', 'gestation', 'nestDays', 'maturity'] as const;
export type EffectTarget = (typeof EFFECT_TARGETS)[number];

/** 槽位：看得见的身体部件，和看不见的性状。 */
export const SLOTS = ['coat', 'mouth', 'limbs', 'tail', 'digestion', 'rearing'] as const;
export type Slot = (typeof SLOTS)[number];

const Fractions = z.object({ plant: z.number().min(0).max(1), vertebrate: z.number().min(0).max(1), invertebrate: z.number().min(0).max(1) });

export const PartSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]*$/),
    slot: z.enum(SLOTS),
    name: z.string(),
    /** 设计台上的一句说明（只说是什么，不说效果的数值）。 */
    blurb: z.string(),
    /** 需要先拿到哪项发明（发明库，第 6 步）；不写就一开始开放。 */
    requires: z.string().optional(),
    /** 最多 3 个：通过哪个钩子、乘多少。 */
    effects: z
      .array(z.object({ target: z.enum(EFFECT_TARGETS), factor: z.number().positive(), why: z.string() }))
      .max(3)
      .default([]),
    /** 体表：长毛的是兽，长羽毛的是鸟（用哪一套缩放公式）。 */
    bodyPlan: z.enum(['mammal', 'bird']).optional(),
    /** 口器：决定吃什么（三类食物的比例，加起来为 1）。 */
    diet: Fractions.optional(),
    /** 口器是喙（鸟的）而不是牙（兽的）：只用于提醒，不影响推导。 */
    beak: z.boolean().optional(),
    /** 消化方式：三类食物各能吸收多少能量（0–1）。 */
    digest: Fractions.optional(),
    /** 腿、爪、翼：会不会飞、会不会爬（飞不飞得起来还要看体重）。 */
    flies: z.boolean().optional(),
    climbs: z.boolean().optional(),
  })
  .superRefine((p, ctx) => {
    const need: Partial<Record<Slot, keyof typeof p>> = { coat: 'bodyPlan', mouth: 'diet', digestion: 'digest' };
    const key = need[p.slot];
    if (key && p[key] === undefined) ctx.addIssue({ code: 'custom', message: `${p.slot} 槽的部件 ${p.id} 要写 ${key}` });
    if (p.diet) {
      const sum = p.diet.plant + p.diet.vertebrate + p.diet.invertebrate;
      if (Math.abs(sum - 1) > 1e-6) ctx.addIssue({ code: 'custom', message: `${p.id} 的食性加起来是 ${sum}，应为 1` });
    }
  });

export type Part = z.infer<typeof PartSchema>;

export const PartsFileSchema = z.object({
  slots: z.array(z.object({ id: z.enum(SLOTS), name: z.string(), visible: z.boolean() })),
  parts: z.array(PartSchema),
});

/** 一份设计：玩家拼出来的东西。本身是数据，可以存档、回放、写进申请书。 */
export const DesignSchema = z.object({
  /** 物种 id；设计的都以 d_ 开头，不会和现有技术撞上。 */
  id: z.string().regex(/^d_[a-z0-9_]+$/),
  name: z.string().min(1).max(20),
  /** 体重（千克）。 */
  bodyMassKg: z.number().min(0.005).max(100),
  /** 每窝仔数（鸟是每窝蛋数）。 */
  litterSize: z.number().int().min(1).max(16),
  activity: z.enum(['diurnal', 'nocturnal', 'crepuscular', 'cathemeral']),
  /** 繁殖季几个月，从春季第一个月算起。 */
  breedingMonths: z.number().int().min(1).max(12),
  nest: z.enum(['ground', 'burrow']),
  territorial: z.boolean(),
  /** 每个槽位选一个部件（部件 id）。 */
  parts: z.object(Object.fromEntries(SLOTS.map((s) => [s, z.string()])) as Record<Slot, z.ZodString>),
});

export type Design = z.infer<typeof DesignSchema>;

/** 设计台提醒的模板：{占位符} 由编译器填。 */
export const HintTemplatesSchema = z.record(z.string(), z.string());
export type HintTemplates = z.infer<typeof HintTemplatesSchema>;

/** 现有技术写成的设计（src/data/design/templates.json）。 */
export const TemplatesFileSchema = z.object({
  templates: z.array(z.object({ species: z.string(), design: DesignSchema })),
});
