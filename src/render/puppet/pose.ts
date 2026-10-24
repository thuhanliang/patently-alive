import type { Gait, GaitState } from './gait';
import { LEGS, isHind, type BodyPlan, type LegKey } from './plan';

/**
 * 纸偶的姿态（纯函数，单位米，y 朝上，x 朝前，原点在身体中点正下方的地面）。
 *
 * 姿态只给几样东西：髋、肩离地多高，脊背弯多少，脖子和头的角度，下颌张多大，四只脚踩在哪。
 * 关节（膝、踝、肘、腕）从"脚在哪"用两节的余弦定理解出来（不是贴地的 IK：只是摆姿势）。
 * 走、跑时脚的着地段按地面的速度往后移，所以脚不打滑：动作的快慢就是缩放律给的步频。
 */

export interface Vec {
  x: number;
  y: number;
}

export interface Pose {
  hipY: number;
  shoulderY: number;
  /** 胸相对臀转多少（弧度，正 = 胸往上抬）：奔跑时脊背一伸一曲。 */
  spine: number;
  /** 脖子相对水平的角度（正 = 抬起）。 */
  neck: number;
  /** 头相对脖子的角度。 */
  head: number;
  /** 下颌张开的角度。 */
  jaw: number;
  /** 尾根相对身体的抬起量（弧度，加在尾巴的静止角上）。 */
  tail: number;
  /** 腿折起来多少（0–1）：1 时跖骨（掌）平贴地面，趴着用。 */
  fold: number;
  /** 四只脚相对髋（后腿）、肩（前腿）的水平位置，和离地高度。 */
  feet: Record<LegKey, Vec>;
}

/** 每种步态里四条腿落地的先后（占一个周期的比例）。 */
const LEG_PHASE: Record<Exclude<Gait, 'stand'>, Record<LegKey, number>> = {
  // 走：侧向顺序，后左 → 前左 → 后右 → 前右，各差四分之一。
  walk: { nearHind: 0, nearFore: 0.25, farHind: 0.5, farFore: 0.75 },
  // 小跑：对角的两条腿一起。
  trot: { nearHind: 0, farFore: 0, farHind: 0.5, nearFore: 0.5 },
  // 奔跑（横向跑步）：两条后腿先后落地，半个周期后两条前腿。
  gallop: { nearHind: 0, farHind: 0.1, nearFore: 0.5, farFore: 0.6 },
};

const LIFT: Record<Exclude<Gait, 'stand'>, number> = { walk: 0.12, trot: 0.2, gallop: 0.28 };

const frac = (x: number): number => x - Math.floor(x);
const smooth = (t: number): number => t * t * (3 - 2 * t);
const TAU = Math.PI * 2;

/** 站着时髋、肩的高度（腿不完全伸直）。 */
export function standHeights(plan: BodyPlan): { hipY: number; shoulderY: number } {
  return { hipY: plan.legLen * 0.9, shoulderY: plan.legLen * 0.9 };
}

function feetAll(f: (k: LegKey) => Vec): Record<LegKey, Vec> {
  return { nearHind: f('nearHind'), nearFore: f('nearFore'), farHind: f('farHind'), farFore: f('farFore') };
}

/** 一条腿最多伸多长（三节伸直的 97%）。 */
export function reachOf(plan: BodyPlan, k: LegKey): number {
  const s = isHind(k) ? plan.hindSegs : plan.foreSegs;
  return (s[0] + s[1] + s[2]) * 0.97;
}

/** 站：重心在四脚之间，脚稍微分开一点。 */
export function standPose(plan: BodyPlan): Pose {
  const h = standHeights(plan);
  return {
    ...h,
    spine: 0,
    neck: 0.55,
    head: -0.45,
    jaw: 0,
    tail: 0,
    fold: 0,
    feet: feetAll((k) => ({ x: isHind(k) ? 0.03 * plan.legLen : -0.02 * plan.legLen, y: 0 })),
  };
}

/**
 * 走、小跑、奔跑：phase 是步态周期里的位置（0–1）。
 * 着地段脚在髋（肩）下方从前往后线性移动 duty·步长：身体以 v 前进时，脚正好钉在地上。
 */
export function gaitPose(plan: BodyPlan, gs: GaitState, phase: number): Pose {
  if (gs.gait === 'stand') return standPose(plan);
  const gait = gs.gait;
  const L = plan.legLen;
  const h = standHeights(plan);
  let hipY = h.hipY;
  let shoulderY = h.shoulderY;
  let spine = 0;
  let neck = 0.5;
  let tail = 0;
  if (gait === 'walk') {
    // 走是倒摆：支撑腿竖直时身体最高；一个周期里两次。
    hipY += 0.02 * L * Math.cos(TAU * 2 * phase);
    shoulderY += 0.02 * L * Math.cos(TAU * 2 * (phase - 0.25));
    neck = 0.45 + 0.06 * Math.sin(TAU * 2 * phase);
  } else if (gait === 'trot') {
    // 跑是弹簧：支撑腿竖直时身体最低。
    hipY -= 0.03 * L + 0.03 * L * Math.cos(TAU * 2 * phase);
    shoulderY -= 0.03 * L + 0.03 * L * Math.cos(TAU * 2 * phase);
    neck = 0.4;
    tail = 0.15;
  } else {
    // 奔跑：前后摇，脊背在后腿往前收时弓起、前腿往前伸时伸直。
    hipY -= 0.05 * L - 0.06 * L * Math.sin(TAU * (phase - 0.15));
    shoulderY -= 0.05 * L - 0.06 * L * Math.sin(TAU * (phase - 0.6));
    spine = 0.12 * Math.sin(TAU * (phase - 0.35));
    neck = 0.25 + 0.12 * Math.sin(TAU * (phase - 0.6));
    tail = 0.3;
  }
  const lift = LIFT[gait] * L;
  const feet = feetAll((k) => {
    const y0 = isHind(k) ? hipY : shoulderY;
    const r = reachOf(plan, k);
    // 步子太大、腿够不着时，按腿能够到的范围收窄（这时脚会滑一点）。
    const maxHalf = Math.sqrt(Math.max(0, r * r - y0 * y0)) * 0.95;
    const half = Math.min((gs.duty * gs.strideM) / 2, maxHalf);
    const p = frac(phase - LEG_PHASE[gait][k]);
    if (p < gs.duty) return { x: half - (2 * half * p) / gs.duty, y: 0 };
    const s = (p - gs.duty) / (1 - gs.duty);
    return { x: -half + 2 * half * smooth(s), y: lift * Math.sin(Math.PI * s) };
  });
  return { hipY, shoulderY, spine, neck, head: -0.35, jaw: 0, tail, fold: 0, feet };
}

/**
 * 吃：低头够到地面，下颌按咀嚼频率开合。脖子够不着时（腿长、脖子短），前腿往前叉开、肩压低。
 * t 是秒，chew 是咀嚼频率。
 */
export function eatPose(plan: BodyPlan, t: number, chew: number): Pose {
  const base = standPose(plan);
  const L = plan.legLen;
  // 脖子根大约在肩的高度上方；要把嘴放到地面，脖子 + 头要伸下去 drop 这么多。
  const reach = plan.neckLen + plan.headR * 1.2;
  let shoulderY = base.shoulderY;
  const minShoulder = L * 0.55;
  if (shoulderY + plan.chestH * 0.3 - reach > 0) shoulderY = Math.max(minShoulder, reach - plan.chestH * 0.3);
  const drop = shoulderY + plan.chestH * 0.3 - plan.headR * 0.4;
  const neck = -Math.asin(Math.min(1, drop / reach)) * 0.95;
  const splay = (base.shoulderY - shoulderY) / L;
  return {
    ...base,
    shoulderY,
    neck,
    head: 0.6,
    jaw: 0.3 * Math.max(0, Math.sin(TAU * chew * t)),
    tail: -0.1,
    feet: { ...base.feet, nearFore: { x: 0.15 * L + 0.6 * splay * L, y: 0 }, farFore: { x: 0.05 * L + 0.5 * splay * L, y: 0 } },
  };
}

/**
 * 趴：身体贴地，后腿折在身下（膝在前、踝在后，跖骨平贴地面），前腿肘着地、前臂往前伸（狮身人面像那样），尾巴贴着地。
 * 前脚的位置按"肘正好落在地上"算：上臂从肩斜到地面，前臂和掌平铺向前。
 */
export function liePose(plan: BodyPlan): Pose {
  const L = plan.legLen;
  const hipY = Math.min(plan.hindH * 1.05, plan.hindSegs[0] * 0.9);
  const shoulderY = Math.min(plan.chestH * 1.05, plan.foreSegs[0] * 0.9);
  const [a, b, c] = plan.foreSegs;
  const elbowX = -Math.sqrt(Math.max(0, a * a - shoulderY * shoulderY));
  const foreX = elbowX + (b + c) * 0.98;
  const hindX = plan.hindSegs[2] + 0.05 * L;
  return {
    hipY,
    shoulderY,
    spine: 0,
    neck: 0.6,
    head: -0.5,
    jaw: 0,
    tail: 0.45,
    fold: 1,
    feet: {
      nearHind: { x: hindX, y: 0 },
      farHind: { x: hindX - 0.05 * L, y: 0 },
      nearFore: { x: foreX, y: 0 },
      farFore: { x: foreX - 0.05 * L, y: 0 },
    },
  };
}

/** 两个姿态插值（t = 0 是 a，1 是 b）。 */
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const m = (x: number, y: number): number => x + (y - x) * t;
  return {
    hipY: m(a.hipY, b.hipY),
    shoulderY: m(a.shoulderY, b.shoulderY),
    spine: m(a.spine, b.spine),
    neck: m(a.neck, b.neck),
    head: m(a.head, b.head),
    jaw: m(a.jaw, b.jaw),
    tail: m(a.tail, b.tail),
    fold: m(a.fold, b.fold),
    feet: feetAll((k) => ({ x: m(a.feet[k].x, b.feet[k].x), y: m(a.feet[k].y, b.feet[k].y) })),
  };
}

/**
 * 两节的余弦定理：从关节 j 出发，两节长 a、b，末端要到 t；bend = +1 中间的关节往前凸（后腿的膝），−1 往后凸（前腿的肘）。
 * 够不着时伸直指向目标，太近时按最近能折到的距离。返回中间关节的位置。
 */
export function solveTwoBone(j: Vec, t: Vec, a: number, b: number, bend: 1 | -1): Vec {
  const dx = t.x - j.x;
  const dy = t.y - j.y;
  const d = Math.min(a + b - 1e-6, Math.max(Math.abs(a - b) + 1e-6, Math.hypot(dx, dy)));
  const base = Math.atan2(dy, dx);
  const cos = (a * a + d * d - b * b) / (2 * a * d);
  const ang = Math.acos(Math.max(-1, Math.min(1, cos)));
  // 方向朝下的腿（base ≈ −90°）：bend = +1 时中间关节转到前面（x 增大），即 base + ang。
  const th = base + bend * ang;
  return { x: j.x + a * Math.cos(th), y: j.y + a * Math.sin(th) };
}

/**
 * 一条腿的四个点：髋（肩）→ 膝（肘）→ 踝（腕）→ 趾。脚在地上时跖骨（掌）稍微往后斜立着；抬起时往后翻一点。
 */
export function legJoints(plan: BodyPlan, k: LegKey, root: Vec, foot: Vec, fold = 0): [Vec, Vec, Vec, Vec] {
  const hind = isHind(k);
  const [a, b, c] = hind ? plan.hindSegs : plan.foreSegs;
  const lifted = Math.min(1, foot.y / (0.1 * plan.legLen + 1e-9));
  const t0 = (hind ? 0.35 : 0.15) + lifted * (hind ? 0.5 : 0.9);
  const tilt = t0 + fold * (Math.PI / 2 - t0);
  const ankle = { x: foot.x - c * Math.sin(tilt), y: foot.y + c * Math.cos(tilt) };
  const knee = solveTwoBone(root, ankle, a, b, hind ? 1 : -1);
  // 够不着时，踝就停在两节伸直能到的地方，趾跟着。
  const ang = Math.atan2(ankle.y - knee.y, ankle.x - knee.x);
  const ankle2 = { x: knee.x + b * Math.cos(ang), y: knee.y + b * Math.sin(ang) };
  const toe = { x: ankle2.x + (foot.x - ankle.x), y: ankle2.y + (foot.y - ankle.y) };
  return [root, knee, ankle2, toe];
}

/** 姿态对应的四条腿：根在髋、肩（考虑身体前后倾和脊背弯曲）。 */
export interface Skeleton {
  pitch: number;
  hip: Vec;
  shoulder: Vec;
  /** 脊背中间的关节（臀片和胸片的铆钉）。 */
  mid: Vec;
  legs: Record<LegKey, [Vec, Vec, Vec, Vec]>;
}

export function skeletonOf(plan: BodyPlan, pose: Pose): Skeleton {
  const hip = { x: plan.hipX, y: pose.hipY };
  const pitch = Math.atan2(pose.shoulderY - pose.hipY, plan.shoulderX - plan.hipX);
  // 脊背中间的关节在髋和肩之间偏后；胸片绕它转 spine。
  const midLocal = (plan.shoulderX - plan.hipX) * 0.45;
  const mid = { x: hip.x + midLocal * Math.cos(pitch), y: hip.y + midLocal * Math.sin(pitch) };
  const rest = plan.shoulderX - plan.hipX - midLocal;
  const shoulder = { x: mid.x + rest * Math.cos(pitch + pose.spine), y: mid.y + rest * Math.sin(pitch + pose.spine) };
  const legs = {} as Record<LegKey, [Vec, Vec, Vec, Vec]>;
  for (const k of LEGS) {
    const root = isHind(k) ? hip : shoulder;
    const f = pose.feet[k];
    legs[k] = legJoints(plan, k, root, { x: root.x + f.x, y: f.y }, pose.fold);
  }
  return { pitch, hip, shoulder, mid, legs };
}
