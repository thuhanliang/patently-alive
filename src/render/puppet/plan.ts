import type { Design, Part } from '../../data/schema/design';
import type { GaitRules } from '../../data/schema/gait';
import type { BodySystem, ViabilityRules } from '../../data/schema/viability';
import { allocateBody, shapeOf } from '../../sim/body';
import { bodyLengthM, legLengthM } from './gait';

/**
 * 纸偶的身材（纯函数，单位米）：从设计算出每一片纸多长多粗。
 *
 * 比例跟着功能走，玩家不用捏：
 * - 体重 → 头体长、腿长（gait.json 的缩放式）；大动物的腿相对更粗（骨头粗细比长度长得快）；
 * - 体重分配（引擎的 allocateBody）→ 骨头多腿就粗，肌肉多大腿和肩就厚，脂肪多、消化道大肚子就圆；
 * - 腿长、尾长手柄（引擎的 shapeOf）→ 和推演用的是同一个倍数；
 * - 部件 → 腿型、尾型、嘴型的剪影和自带的比例。
 * 这里只决定画面，推演里的后果在 sim/。
 */

export type LegKey = 'nearHind' | 'nearFore' | 'farHind' | 'farFore';
export const LEGS: readonly LegKey[] = ['nearHind', 'nearFore', 'farHind', 'farFore'];
export const isHind = (k: LegKey): boolean => k === 'nearHind' || k === 'farHind';

export interface BodyPlan {
  massKg: number;
  bird: boolean;
  /** 头体长。 */
  bodyLen: number;
  /** 伸直的腿长（髋到地）。 */
  legLen: number;
  /** 后腿、前腿三节的长度：大腿 / 小腿 / 跖（上臂 / 前臂 / 掌）。加起来比腿长多一点，站着时关节是弯的。 */
  hindSegs: [number, number, number];
  foreSegs: [number, number, number];
  /** 髋、肩在身体上的前后位置（相对身体中点）。 */
  hipX: number;
  shoulderX: number;
  /** 胸、臀的半高；肚子往下垂多少。 */
  chestH: number;
  hindH: number;
  belly: number;
  /** 腿的粗细（小腿处）和大腿、上臂的粗细。 */
  legW: number;
  thighW: number;
  neckLen: number;
  neckW: number;
  headR: number;
  /** 吻（或喙）伸出头外多长。 */
  snout: number;
  earH: number;
  tailLen: number;
  tailW: number;
  tailSegs: number;
  parts: { coat: string; mouth: string; limbs: string; tail: string; digestion: string };
  relative: Readonly<Record<BodySystem, number>>;
}

/** 嘴型部件：吻伸出多长（相对头的半径）。只是画面。 */
const SNOUT: Record<string, number> = {
  carnassials: 0.45,
  gnawing_incisors: 0.85,
  grinding_molars: 1.0,
  mixed_teeth: 0.75,
  pointed_snout: 1.6,
  seed_beak: 0.6,
  probe_bill: 2.4,
  hooked_beak: 0.75,
  stout_bill: 0.95,
};

/** 消化方式：肚子大多少（反刍、后肠发酵要装大量植物）。只是画面。 */
const BELLY: Record<string, number> = { ruminant: 1.25, hindgut_fermenter: 1.15, simple_stomach: 1, crop_gizzard: 1, short_gut: 0.88 };

export function bodyPlan(
  design: Design,
  parts: Readonly<Record<'coat' | 'mouth' | 'limbs' | 'tail' | 'digestion', Pick<Part, 'id'>>>,
  bird: boolean,
  viability: ViabilityRules,
  gait: GaitRules,
): BodyPlan {
  const M = design.bodyMassKg;
  const rel = allocateBody(design, bird, viability).relative;
  const shape = shapeOf(design, viability);
  const B = bodyLengthM(gait, M);
  const L = legLengthM(gait, M, parts.limbs.id, shape.legScale);
  // 骨头粗细比长度长得快（弹性相似：直径 ∝ 长度^1.5），所以大动物的腿看起来更粗。
  const legW = B * 0.045 * Math.pow(M / 4, 0.08) * Math.sqrt(rel.skeleton);
  const thighW = legW * (1.55 + 0.9 * (rel.muscle - 1));
  const round = 1 + 0.35 * (rel.fat - 1) + 0.15 * (rel.gut - 1);
  const chestH = B * 0.145 * round;
  const tail = gait.tailLength[parts.tail.id] ?? { length: 0.6, width: 0.06 };
  const tailLen = B * tail.length * shape.tailScale;
  const headR = B * 0.12 * Math.pow(M / 4, -0.05);
  return {
    massKg: M,
    bird,
    bodyLen: B,
    legLen: L,
    hindSegs: [0.44 * L, 0.44 * L, 0.27 * L],
    foreSegs: [0.44 * L, 0.47 * L, 0.22 * L],
    hipX: -0.3 * B,
    shoulderX: 0.24 * B,
    chestH,
    hindH: chestH * 0.92,
    belly: chestH * 0.35 * (BELLY[parts.digestion.id] ?? 1) * (0.7 + 0.3 * rel.gut) * (0.6 + 0.4 * rel.fat),
    legW,
    thighW,
    neckLen: B * 0.2,
    neckW: chestH * 0.9,
    headR,
    snout: headR * (SNOUT[parts.mouth.id] ?? 0.7),
    earH: headR * 0.7,
    tailLen,
    tailW: B * tail.width,
    tailSegs: tail.length < 0.2 ? 1 : parts.tail.id === 'bushy_tail' ? 2 : tail.length < 0.5 ? 3 : 5,
    parts: { coat: parts.coat.id, mouth: parts.mouth.id, limbs: parts.limbs.id, tail: parts.tail.id, digestion: parts.digestion.id },
    relative: rel,
  };
}
