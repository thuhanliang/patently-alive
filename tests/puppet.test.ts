import { describe, expect, it } from 'vitest';
import { designTemplates, gaitRules, partLibrary, viabilityRules, type Design } from '../src/data';
import { partsOf } from '../src/sim';
import { breathsPerMin, gaitOf, heartPerMin, legLengthM, springStep, topSpeed, walkSpeed } from '../src/render/puppet/gait';
import { EAR_TIP_CAT, bodyPlan, intermembralOf } from '../src/render/puppet/plan';
import { DesignSchema } from '../src/data/schema/design';
import { LEGS } from '../src/render/puppet/plan';
import { eatPose, gaitPose, liePose, skeletonOf, solveTwoBone, standPose } from '../src/render/puppet/pose';

/** 纸偶的节奏和姿态（M1-1）：缩放律给出的行为对不对，姿态解出来的骨头长度守不守。 */

const template = (species: string): Design => designTemplates.find((t) => t.species === species)!.design;
const planOf = (d: Design) => bodyPlan(d, partsOf(d, { parts: partLibrary }), false, viabilityRules, gaitRules);
const cat = template('cat');
const tiger: Design = { ...cat, bodyMassKg: 200 };
const rat = template('brownrat');
const leg = (d: Design) => planOf(d).legLen;

describe('缩放律的节奏', () => {
  it('同样慢慢走，步频：鼠 > 猫 > 虎', () => {
    const hz = (d: Design) => gaitOf(gaitRules, walkSpeed(gaitRules, leg(d)), leg(d)).strideHz;
    expect(hz(rat)).toBeGreaterThan(hz(cat));
    expect(hz(cat)).toBeGreaterThan(hz(tiger));
    // 猫约 2 赫兹，虎约 1 赫兹（真实的走路步频大致在这个范围）。
    expect(hz(cat)).toBeGreaterThan(1.3);
    expect(hz(cat)).toBeLessThan(2.8);
    expect(hz(tiger)).toBeGreaterThan(0.6);
    expect(hz(tiger)).toBeLessThan(1.4);
  });

  it('同样每秒 2 米：猫已经在跑，虎还在走', () => {
    const c = gaitOf(gaitRules, 2, leg(cat));
    const t = gaitOf(gaitRules, 2, leg(tiger));
    expect(c.froude).toBeGreaterThan(gaitRules.walkTrotFroude.value);
    expect(['trot', 'gallop']).toContain(c.gait);
    expect(t.froude).toBeLessThan(gaitRules.walkTrotFroude.value);
    expect(t.gait).toBe('walk');
  });

  it('同体重，腿越长步频越低', () => {
    const long = { ...cat, shape: { leg: 0.2 } };
    const short = { ...cat, shape: { leg: -0.2 } };
    expect(leg(long)).toBeGreaterThan(leg(cat));
    const hz = (d: Design) => gaitOf(gaitRules, 1, leg(d)).strideHz;
    expect(hz(long)).toBeLessThan(hz(cat));
    expect(hz(short)).toBeGreaterThan(hz(cat));
  });

  it('腿型部件自带的腿长：奔跑长腿 > 步行腿 > 短腿', () => {
    expect(legLengthM(gaitRules, 4, 'running_legs')).toBeGreaterThan(legLengthM(gaitRules, 4, 'walking_legs'));
    expect(legLengthM(gaitRules, 4, 'walking_legs')).toBeGreaterThan(legLengthM(gaitRules, 4, 'short_legs'));
  });

  it('呼吸、心跳随体重变慢；家猫、虎的数量级对', () => {
    expect(breathsPerMin(gaitRules, 200)).toBeLessThan(breathsPerMin(gaitRules, 4));
    expect(heartPerMin(gaitRules, 200)).toBeLessThan(heartPerMin(gaitRules, 4));
    expect(heartPerMin(gaitRules, 4)).toBeGreaterThan(140);
    expect(heartPerMin(gaitRules, 4)).toBeLessThan(200);
    expect(heartPerMin(gaitRules, 200)).toBeGreaterThan(50);
    expect(heartPerMin(gaitRules, 200)).toBeLessThan(80);
  });

  it('最高跑速是驼峰：中等体型最快，腿长的倍数照乘', () => {
    expect(topSpeed(gaitRules, 89)).toBeGreaterThan(topSpeed(gaitRules, 4));
    expect(topSpeed(gaitRules, 89)).toBeGreaterThan(topSpeed(gaitRules, 5000));
    expect(topSpeed(gaitRules, 89) * 3.6).toBeCloseTo(63, -1);
    expect(topSpeed(gaitRules, 4, 1.2)).toBeCloseTo(topSpeed(gaitRules, 4) * 1.2, 9);
  });

  it('弹簧会收敛，掉帧（dt 很大）也不炸开', () => {
    const s = { x: 0, v: 0 };
    for (let i = 0; i < 300; i++) springStep(s, 1, 12, 0.4, 1 / 60);
    expect(s.x).toBeCloseTo(1, 3);
    const big = { x: 0, v: 0 };
    springStep(big, 1, 40, 0.3, 0.5);
    expect(Number.isFinite(big.x)).toBe(true);
    expect(Math.abs(big.x)).toBeLessThan(3);
  });
});

describe('姿态', () => {
  it('两节的余弦定理：够得着时两节长度不变、末端到位；膝往前、肘往后', () => {
    const j = { x: 0, y: 1 };
    const t = { x: 0.1, y: 0.2 };
    const knee = solveTwoBone(j, t, 0.5, 0.5, 1);
    expect(Math.hypot(knee.x - j.x, knee.y - j.y)).toBeCloseTo(0.5, 9);
    expect(Math.hypot(t.x - knee.x, t.y - knee.y)).toBeCloseTo(0.5, 9);
    expect(knee.x).toBeGreaterThan(0.05);
    const elbow = solveTwoBone(j, t, 0.5, 0.5, -1);
    expect(elbow.x).toBeLessThan(0.05);
  });

  it('每个姿态、每个步态的相位上，腿的三节都保持原长', () => {
    for (const d of [cat, tiger, rat, template('rabbit'), template('fox')]) {
      const plan = planOf(d);
      const poses = [standPose(plan), eatPose(plan, 0.3, 3), liePose(plan)];
      for (const v of [0.3, 1, 3, 8]) {
        const gs = gaitOf(gaitRules, v, plan.legLen);
        for (let p = 0; p < 1; p += 0.125) poses.push(gaitPose(plan, gs, p));
      }
      for (const pose of poses) {
        const sk = skeletonOf(plan, pose);
        for (const k of LEGS) {
          const segs = k.endsWith('Hind') ? plan.hindSegs : plan.foreSegs;
          const pts = sk.legs[k];
          for (let i = 0; i < 3; i++) expect(Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y)).toBeCloseTo(segs[i]!, 6);
        }
      }
    }
  });

  it('走路时着地的脚每一帧往后移的距离正好等于身体前进的距离（脚不打滑）', () => {
    const plan = planOf(cat);
    const v = walkSpeed(gaitRules, plan.legLen);
    const gs = gaitOf(gaitRules, v, plan.legLen);
    const dt = 1 / 120;
    const dPhase = gs.strideHz * dt;
    // 近侧后腿在相位 0 落地，着地段里取两帧。
    const a = gaitPose(plan, gs, 0.1).feet.nearHind;
    const b = gaitPose(plan, gs, 0.1 + dPhase).feet.nearHind;
    expect(a.y).toBe(0);
    expect(a.x - b.x).toBeCloseTo(v * dt, 6);
  });

  it('站着时四只脚都在地上', () => {
    const sk = skeletonOf(planOf(cat), standPose(planOf(cat)));
    for (const k of LEGS) expect(sk.legs[k][3].y).toBeCloseTo(0, 6);
  });
});

// 动作的差异来自部件的几何，不来自"选了哪个物种当模板"（DECISIONS"纸偶的部件抽象"）。
describe('跳由前后腿的比例推出来', () => {
  const withLimbs = (d: Design, limbs: string): Design => ({ ...d, parts: { ...d.parts, limbs } });
  const gaitAt = (d: Design, fr: number) => {
    const p = planOf(d);
    return gaitOf(gaitRules, Math.sqrt(fr * 9.81 * p.legLen), p.legLen, intermembralOf(p)).gait;
  };
  const rabbit = template('rabbit');

  it('穴兔（跳跃后腿）走、跑都是跳；猫也一样，换上跳跃后腿就跳', () => {
    for (const fr of [0.25, 1, 3]) {
      expect(gaitAt(rabbit, fr)).toBe('hop');
      expect(gaitAt(withLimbs(cat, 'leaping_legs'), fr)).toBe('hop');
    }
  });

  it('兔子换成步行腿就不跳了：走、小跑、奔跑', () => {
    const r = withLimbs(rabbit, 'walking_legs');
    expect(gaitAt(r, 0.25)).toBe('walk');
    expect(gaitAt(r, 1)).toBe('trot');
    expect(gaitAt(r, 3)).toBe('gallop');
  });

  it('前腿 ÷ 后腿：跳跃后腿约 0.65，其余的腿型约 1', () => {
    expect(intermembralOf(planOf(rabbit))).toBeLessThan(0.7);
    for (const limbs of ['walking_legs', 'running_legs', 'climbing_claws', 'digging_claws', 'short_legs']) {
      expect(intermembralOf(planOf(withLimbs(cat, limbs)))).toBeGreaterThan(0.95);
    }
  });

  it('前腿短的身体站着前低后高；一般的腿前后一样高（和以前一样）', () => {
    const r = standPose(planOf(rabbit));
    expect(r.shoulderY).toBeLessThan(r.hipY * 0.9);
    const c = standPose(planOf(cat));
    expect(c.shoulderY).toBe(c.hipY);
    expect(c.hipY).toBe(planOf(cat).legLen * 0.9);
  });

  it('跳的每个时刻，骨头长度不变、脚不钻地', () => {
    const p = planOf(rabbit);
    const gs = gaitOf(gaitRules, Math.sqrt(9.81 * p.legLen), p.legLen, intermembralOf(p));
    for (let i = 0; i < 20; i++) {
      const sk = skeletonOf(p, gaitPose(p, gs, i / 20));
      for (const k of LEGS) {
        const segs = k.endsWith('Hind') ? p.hindSegs : p.foreSegs;
        const pts = sk.legs[k];
        for (let j = 0; j < 3; j++) expect(Math.hypot(pts[j + 1]!.x - pts[j]!.x, pts[j + 1]!.y - pts[j]!.y)).toBeCloseTo(segs[j]!, 6);
        expect(pts[3]!.y).toBeGreaterThan(-1e-9);
      }
    }
  });
});

// 耳朵的形状参数（外观，只影响画面）：不写就是猫的耳；耳长拉到头就没有耳廓。
describe('耳朵的形状参数', () => {
  const tpl = (sp: string): Design => structuredClone(designTemplates.find((t) => t.species === sp)!.design);

  it('猫不写，就是原画的样子', () => {
    const p = planOf(tpl('cat'));
    expect(p.earTip).toBe(EAR_TIP_CAT);
    expect(p.earStiff).toBe(1);
    expect(p.earPos).toBe(0);
    expect(p.earOn).toBe(true);
  });

  it('啮齿类、鼬的耳是圆的，狐的比猫尖', () => {
    for (const sp of ['brownrat', 'rat', 'kiore', 'mouse', 'vole', 'stoat', 'weasel', 'ferret', 'mongoose']) expect(planOf(tpl(sp)).earTip).toBeLessThan(0.3);
    expect(planOf(tpl('fox')).earTip).toBeGreaterThan(EAR_TIP_CAT);
  });

  it('耳长拉到 0 就没有耳廓，schema 接受', () => {
    const d = tpl('cat');
    d.appearance = { earLen: 0 };
    expect(DesignSchema.safeParse(d).success).toBe(true);
    expect(planOf(d).earOn).toBe(false);
    d.appearance = { earLen: 0.2, earTip: 0, earStiff: 0, earPos: 1 };
    expect(DesignSchema.safeParse(d).success).toBe(true);
    expect(planOf(d).earOn).toBe(true);
  });
});
