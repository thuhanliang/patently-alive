import { z } from 'zod';
import { ThresholdSchema } from './viability';

/**
 * 纸偶的身材和动作节奏（M1 设计台玩具，src/data/scaling/gait.json）。只在画面里用，不进推演：
 * 推演里的速度、骨骼等仍然只看 viability.json 和部件的钩子。每个数照 viability.json 的写法带依据。
 */

const Power = z.strictObject({ coef: ThresholdSchema, exp: ThresholdSchema });

const Reference = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  massKg: z.number().positive(),
  bodyLengthM: z.number().positive(),
  shoulderM: z.number().positive(),
  /** 尾长、耳高、颈长（相对头体长）：只用来画剪影。 */
  tail: z.number().min(0),
  ears: z.number().min(0),
  neck: z.number().min(0),
  /**
   * 用切图零件拼它（2026-10-25）：拿哪条现有技术的设计当底子，体重换成上面的 massKg，再换几个部件、外观。
   * 没有对应现有技术的（獾、狼、鹿……）用最像的部件拼一个替身。只是画面。
   */
  look: z.strictObject({ template: z.string(), parts: z.record(z.string(), z.string()).optional(), appearance: z.strictObject({ earLen: z.number(), earWide: z.number() }).partial().optional() }),
});

export const GaitRulesSchema = z.strictObject({
  说明: z.string(),
  bodyLength: Power,
  hipHeight: Power,
  strideLength: Power,
  walkTrotFroude: ThresholdSchema,
  trotGallopFroude: ThresholdSchema,
  walkFroude: ThresholdSchema,
  duty: z.strictObject({ walk: ThresholdSchema, trot: ThresholdSchema, gallop: ThresholdSchema }),
  breath: Power,
  heart: Power,
  topSpeed: z.strictObject({ a: ThresholdSchema, b: ThresholdSchema, h: ThresholdSchema, i: ThresholdSchema }),
  chew: Power,
  /** 腿型部件自带的腿长（相对步行腿），键是部件 id。 */
  limbLength: z.object({ 说明: z.string() }).catchall(z.number().positive()),
  /** 尾型部件自带的尾长、粗细（相对头体长），键是部件 id。 */
  tailLength: z.object({ 说明: z.string() }).catchall(z.strictObject({ length: z.number().positive(), width: z.number().positive() })),
  references: z.strictObject({ 说明: z.string(), animals: z.array(Reference).min(2) }),
});
export type GaitRules = z.infer<typeof GaitRulesSchema>;
export type ReferenceAnimal = z.infer<typeof Reference>;
