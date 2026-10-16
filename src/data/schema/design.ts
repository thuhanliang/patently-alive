import { z } from 'zod';
import { BODY_SYSTEMS, type BodySystem } from './viability';

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
/** 消化效率不能是 0：否则只吃这一类的设计胃口无穷大。 */
const Efficiencies = z.object({ plant: z.number().min(0.05).max(1), vertebrate: z.number().min(0.05).max(1), invertebrate: z.number().min(0.05).max(1) });

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
    /** 消化方式：三类食物各能吸收多少能量（0–1）。植物这一项是大体型动物吃整株草本时的消化率。 */
    digest: Efficiencies.optional(),
    /**
     * 消化道（阶段 3.5，消化检查）：capacity 是一天能过多少食物（相对单胃，1 为单胃）；
     * caecotrophy 吃自己的盲肠便（兔、田鼠），小体型时纤维也能消化得比较完全；
     * fermentMinKg 发酵要在肠里留够时间，比这个体重小时纤维消化不完全（反刍）。数是假设，见 viability.json 的消化一节。
     */
    gut: z.strictObject({ capacity: z.number().min(0.2).max(3), caecotrophy: z.literal(true).optional(), fermentMinKg: z.number().positive().optional() }).optional(),
    /** 口器能挑着吃植物最好的部分（种子、嫩叶、芽），见植物类型的 soluble.select。 */
    selective: z.literal(true).optional(),
    /** 腿、爪、翼：会不会飞、会不会爬（飞不飞得起来还要看体重）。 */
    flies: z.boolean().optional(),
    climbs: z.boolean().optional(),
    /**
     * 腿型的站姿（阶段 3.5，骨骼检查）：越接近柱子、越粗壮，同样的骨头撑得越多（1 为普通的腿）。
     * 只有 limbs 槽的部件写；数是假设，见 viability.json 的骨骼一节。
     */
    posture: z.number().min(0.5).max(2).optional(),
  })
  .superRefine((p, ctx) => {
    const need: Partial<Record<Slot, readonly (keyof typeof p)[]>> = { coat: ['bodyPlan'], mouth: ['diet'], digestion: ['digest', 'gut'] };
    for (const key of need[p.slot] ?? []) {
      if (p[key] === undefined) ctx.addIssue({ code: 'custom', message: `${p.slot} 槽的部件 ${p.id} 要写 ${key}` });
    }
    if (p.diet) {
      const sum = p.diet.plant + p.diet.vertebrate + p.diet.invertebrate;
      if (Math.abs(sum - 1) > 1e-6) ctx.addIssue({ code: 'custom', message: `${p.id} 的食性加起来是 ${sum}，应为 1` });
    }
  });

export type Part = z.infer<typeof PartSchema>;

export const PartsFileSchema = z
  .object({
    slots: z.array(z.object({ id: z.enum(SLOTS), name: z.string(), visible: z.boolean() })),
    parts: z.array(PartSchema),
  })
  .superRefine((f, ctx) => {
    const ids = f.slots.map((s) => s.id);
    if (ids.length !== SLOTS.length || SLOTS.some((s) => !ids.includes(s))) ctx.addIssue({ code: 'custom', message: `slots 要正好列出 ${SLOTS.join('、')} 各一次` });
    const partIds = new Set<string>();
    for (const p of f.parts) {
      if (partIds.has(p.id)) ctx.addIssue({ code: 'custom', message: `部件 id 重复：${p.id}` });
      partIds.add(p.id);
    }
  });

/** 一份设计：玩家拼出来的东西。本身是数据，可以存档、回放、写进申请书。 */
export const DesignSchema = z.object({
  /** 物种 id；设计的都以 d_ 开头，不会和现有技术撞上。 */
  id: z.string().regex(/^d_[a-z0-9_]+$/),
  name: z.string().min(1).max(20),
  /** 体重（千克）。 */
  /** 5 克到 100 吨（2026-10-15 从 100 千克放开）。超过数据里最重的物种时公式是外推，设计台会提醒。 */
  bodyMassKg: z.number().min(0.005).max(100_000),
  /** 每窝仔数（鸟是每窝蛋数）。 */
  litterSize: z.number().int().min(1).max(16),
  /** 写 true：仔数不用上面那个数，按同体型、同食性的典型值推（阶段 3.5 第 4 步；等于 litterBias 写 0）。 */
  litterAuto: z.literal(true).optional(),
  /**
   * 仔数写成"比同体型、同食性的典型值多多少"（以 10 为底的对数，0 = 一般，0.3 ≈ 两倍；阶段 3.5）。
   * 写了它，仔数就不用 litterSize，而是 典型值 × 10^litterBias 四舍五入：体型变了仔数跟着变，猫放大还是"猫的生法"。
   */
  litterBias: z.number().min(-1.5).max(1.5).optional(),
  activity: z.enum(['diurnal', 'nocturnal', 'crepuscular', 'cathemeral']),
  /** 繁殖季几个月，从春季第一个月算起。 */
  breedingMonths: z.number().int().min(1).max(12),
  nest: z.enum(['ground', 'burrow']),
  territorial: z.boolean(),
  /** 在世界里的主色（田野笔记的平涂色，可选的几种见 render/palette.ts 的 DESIGN_COLORS）；不写用墨灰。 */
  color: z.string().regex(/^#[0-9a-f]{6}$/).optional(),
  /** 每个槽位选一个部件（部件 id）。 */
  parts: z.object(Object.fromEntries(SLOTS.map((s) => [s, z.string()])) as Record<Slot, z.ZodString>),
  /**
   * 体重分配（阶段 3.5）：每个体内系统相对默认份额的倍数（范围见 viability.json），此消彼长。
   * 不写或不写某个系统就是 1：老设计不受影响，id 也不变。
   */
  allocation: z.strictObject(Object.fromEntries(BODY_SYSTEMS.map((s) => [s, z.number().positive()])) as Record<BodySystem, z.ZodNumber>).partial().optional(),
});

export type Design = z.infer<typeof DesignSchema>;

/** 设计编译器会发出的提醒（引擎定义）；每个都要有模板。 */
export const HINT_IDS = [
  'energyHigh',
  'energyLow',
  'dietMismatch',
  'tooHeavyToFly',
  'beyondData',
  'beakOnMammal',
  'teethOnBird',
  'wingsOnMammal',
  'oneLitterSeason',
  'multiYearLitter',
  'groundNestLong',
  'bigLitterShortLife',
  'carnivoreHomeRange',
  'borrowedLaw',
  'boneCannotRun',
  'boneCannotWalk',
  'boneCannotStand',
  'litterTooBig',
  'clutchTooBig',
  'dystocia',
  'gutStrained',
  'gutFailing',
  'insectivoreTooBig',
  'carnivoreTooBig',
] as const;

/** 设计台提醒的模板：{占位符} 由编译器填。每个提醒都必须有，不能多。 */
export const HintTemplatesSchema = z.strictObject(Object.fromEntries(HINT_IDS.map((id) => [id, z.string().min(1)])) as Record<(typeof HINT_IDS)[number], z.ZodString>);
export type HintTemplates = z.infer<typeof HintTemplatesSchema>;
export type HintId = (typeof HINT_IDS)[number];

/** 现有技术写成的设计（src/data/design/templates.json）。 */
export const TemplatesFileSchema = z.object({
  templates: z.array(z.object({ species: z.string(), design: DesignSchema })),
});
