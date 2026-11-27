import type { Design, Part } from '../../data/schema/design';
import type { GaitRules } from '../../data/schema/gait';
import type { BodySystem, ViabilityRules } from '../../data/schema/viability';
import { allocateBody, shapeOf } from '../../sim/body';
import { bodyLengthM, legLengthM } from './gait';
import { formValue } from '../../data';

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
  /** 耳朵的宽窄（外观，相对一般的耳朵）。 */
  earW: number;
  /** 有没有耳廓（耳长拉到 EAR_ABSENT 以下就只剩耳孔，不画耳片）。 */
  earOn: boolean;
  /** 耳尖从圆（0）到尖（1）；猫是 EAR_TIP_CAT。 */
  earTip: number;
  /** 耳的软硬：1 立着，0 软到整只垂下来。 */
  earStiff: number;
  /** 耳在头上的位置：0 头顶，1 头的两侧（后方）。 */
  earPos: number;
  /** 颈的姿态（form 的 neck.raise，0–1）：站着时颈再抬起多少。 */
  neckRaise: number;
  /** 颈长、颈粗相对一般样子的倍数（成品图的胸片上画着一般长的颈，多出来的由代码剪的颈片补）。 */
  neckK: number;
  neckWK: number;
  /** 吻长相对嘴型部件的倍数（form 的 snout.length）。 */
  snoutK: number;
  /** 吻的粗细（倍数）和吻端圆尖（0 钝 – 1 尖）。 */
  snoutDepth: number;
  snoutTip: number;
  /** 着地方式：0 跖行、0.5 趾行、1 蹄行（form 的 leg.stance）。 */
  stance: number;
  /** 角：几只、多长（米）、多弯（0–1）、长在哪（0 额 – 1 鼻）。 */
  horn: { count: number; len: number; curve: number; pos: number };
  tailLen: number;
  tailW: number;
  tailSegs: number;
  /** 尾巴的动力学参数（gait.json 的 tail）。 */
  tailMotion: { stiffness: number; damping: number; idle: number };
  parts: { coat: string; mouth: string; limbs: string; tail: string; digestion: string };
  /** 毛长（以 10 为底的对数，短毛 = 0；sim/fur.ts）：设计写了用设计的，不写用体表卡的点；鸟是 0。画毛边用。 */
  fur: number;
  relative: Readonly<Record<BodySystem, number>>;
}

/** 猫（成品图）的耳尖在"圆（0）↔ 尖（1）"上的位置：不写 earTip 就是它，耳的形状就是原画（ear.ts）。 */
export const EAR_TIP_CAT = 0.6;
/** 耳长（倍数）不到这么多就算没有耳廓（鼹鼠、海豹、猫头鹰）。 */
export const EAR_ABSENT = 0.12;

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

/** 步行腿的后腿三节（大腿 / 小腿 / 跖，相对腿长）。 */
const HIND_SEGS: readonly [number, number, number] = [0.44, 0.44, 0.27];

/** 前腿 ÷ 后腿的总长（intermembral index）：兔约 0.65，猫约 1。步态跳不跳看它。 */
export function intermembralOf(plan: Pick<BodyPlan, 'hindSegs' | 'foreSegs'>): number {
  const sum = (s: readonly number[]): number => s[0]! + s[1]! + s[2]!;
  return sum(plan.foreSegs) / sum(plan.hindSegs);
}

/** 消化方式：肚子大多少（反刍、后肠发酵要装大量植物）。只是画面。 */
const BELLY: Record<string, number> = { ruminant: 1.25, hindgut_fermenter: 1.15, simple_stomach: 1, crop_gizzard: 1, short_gut: 0.88 };

export function bodyPlan(
  design: Design,
  parts: Readonly<Record<'coat' | 'mouth' | 'limbs' | 'tail' | 'digestion', Pick<Part, 'id' | 'fur'>>>,
  bird: boolean,
  viability: ViabilityRules,
  gait: GaitRules,
): BodyPlan {
  const M = design.bodyMassKg;
  const rel = allocateBody(design, bird, viability).relative;
  const shape = shapeOf(design, viability);
  const B = bodyLengthM(gait, M);
  const L = legLengthM(gait, M, parts.limbs.id, shape.legScale);
  // 形状参数（form.json，只是画面）。L 类是以 2 为底的对数偏离。
  const f = (id: string): number => formValue(design.form, id);
  const x2 = (id: string): number => Math.pow(2, f(id));
  // 躯干长短：体重不变，拉长就变细（截面 ∝ 长度^−1/2）。
  const kBody = x2('body.length');
  const kThin = 1 / Math.sqrt(kBody);
  // 骨头粗细比长度长得快（弹性相似：直径 ∝ 长度^1.5），所以大动物的腿看起来更粗。
  const legW = B * 0.045 * Math.pow(M / 4, 0.08) * Math.sqrt(rel.skeleton);
  const thighW = legW * (1.55 + 0.9 * (rel.muscle - 1));
  const round = 1 + 0.35 * (rel.fat - 1) + 0.15 * (rel.gut - 1);
  const chestH = B * 0.145 * round * kThin * x2('body.depth');
  const hindH = B * 0.145 * round * kThin * 0.92;
  const tail = gait.tailLength[parts.tail.id] ?? { length: 0.6, width: 0.06 };
  const tailLen = B * tail.length * shape.tailScale;
  const headR = B * 0.12 * Math.pow(M / 4, -0.05) * x2('head.size');
  // 前后腿的比例：腿型部件自带（跳跃后腿的后腿长、前腿短），总长不变的意思是两边按 √比例 分摊。
  const ls = gait.limbShape[parts.limbs.id];
  const hf = Math.sqrt(ls?.hindFore ?? 1);
  const hp = ls?.hindSegs ?? HIND_SEGS;
  const hk = (HIND_SEGS[0] + HIND_SEGS[1] + HIND_SEGS[2]) / (hp[0] + hp[1] + hp[2]);
  // 远端的腿节：跖（掌）变长或变短，三节的总长不变（腿长是推演的量，不能被画面改掉）。
  const kd = x2('leg.distal');
  const distal = (seg: [number, number, number]): [number, number, number] => {
    const sum = seg[0] + seg[1] + seg[2];
    const d = [seg[0], seg[1], seg[2] * kd];
    const k = sum / (d[0]! + d[1]! + d[2]!);
    return [d[0]! * k, d[1]! * k, d[2]! * k];
  };
  const torso = 0.54 * B * kBody;
  const hornCount = f('horn.count');
  return {
    massKg: M,
    bird,
    bodyLen: B + torso - 0.54 * B,
    legLen: L,
    hindSegs: distal([hp[0] * hk * hf * L, hp[1] * hk * hf * L, hp[2] * hk * hf * L]),
    foreSegs: distal([(0.44 * L) / hf, (0.47 * L) / hf, (0.22 * L) / hf]),
    hipX: -0.3 * B * kBody,
    shoulderX: 0.24 * B * kBody,
    chestH,
    hindH,
    belly: B * 0.145 * round * kThin * 0.35 * (BELLY[parts.digestion.id] ?? 1) * (0.7 + 0.3 * rel.gut) * (0.6 + 0.4 * rel.fat),
    legW,
    thighW,
    neckLen: B * 0.2 * x2('neck.length'),
    neckW: B * 0.145 * round * 0.9 * kThin * x2('neck.width'),
    neckRaise: f('neck.raise'),
    neckK: x2('neck.length'),
    neckWK: x2('neck.width'),
    headR,
    // 大型兽的脸相对更长（颅面异速，Cardini & Polly 2013，未核对）：吻长的零点随体重变长，4 千克（猫）不变。
    snout: headR * (SNOUT[parts.mouth.id] ?? 0.7) * x2('snout.length') * Math.pow(Math.max(1, M / 4), 0.06),
    snoutK: x2('snout.length'),
    snoutDepth: x2('snout.depth'),
    snoutTip: f('snout.tip'),
    stance: f('leg.stance'),
    horn: { count: hornCount, len: hornCount > 0 ? headR * 1.1 * x2('horn.length') : 0, curve: f('horn.curve'), pos: f('horn.pos') },
    earH: headR * 0.7 * (design.appearance?.earLen ?? 1),
    earW: design.appearance?.earWide ?? 1,
    earOn: (design.appearance?.earLen ?? 1) > EAR_ABSENT,
    earTip: design.appearance?.earTip ?? EAR_TIP_CAT,
    earStiff: design.appearance?.earStiff ?? 1,
    earPos: design.appearance?.earPos ?? 0,
    tailLen,
    tailW: B * tail.width,
    tailSegs: tail.length < 0.2 ? 1 : parts.tail.id === 'bushy_tail' ? 2 : tail.length < 0.5 ? 3 : 5,
    tailMotion: { stiffness: gait.tail.stiffness.value, damping: gait.tail.damping.value, idle: gait.tail.idle.value },
    parts: { coat: parts.coat.id, mouth: parts.mouth.id, limbs: parts.limbs.id, tail: parts.tail.id, digestion: parts.digestion.id },
    fur: bird ? 0 : Math.min(viability.shape.furMax.value, Math.max(viability.shape.furMin.value, design.shape?.fur ?? parts.coat.fur ?? 0)),
    relative: rel,
  };
}
