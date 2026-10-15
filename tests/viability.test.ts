import { describe, expect, it } from 'vitest';
import { designTemplates, hintTemplates, partLibrary, scalingLaws, viabilityRules, type Design } from '../src/data';
import { ViabilityRulesSchema } from '../src/data/schema/viability';
import { DesignSchema } from '../src/data/schema/design';
import { allocateBody, compileDesign, makeDesignKit, skeletonSafety } from '../src/sim';
import viabilityJson from '../src/data/scaling/viability.json';

const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, designTemplates.map((t) => t.design));
const template = (species: string): Design => designTemplates.find((t) => t.species === species)!.design;
const withAlloc = (d: Design, allocation: Design['allocation']): Design => ({ ...d, allocation });

describe('可行性阈值数据', () => {
  it('每个数都要写依据、置信度和出处', () => {
    const bad = structuredClone(viabilityJson) as { skeleton: { cannotRun: Record<string, unknown> } };
    delete bad.skeleton.cannotRun.basis;
    expect(ViabilityRulesSchema.safeParse(bad).success).toBe(false);
    const extra = structuredClone(viabilityJson) as { skeleton: Record<string, unknown> };
    extra.skeleton.magic = { value: 1, basis: 'law', confidence: '1', source: 'x' };
    expect(ViabilityRulesSchema.safeParse(extra).success).toBe(false);
  });
});

describe('体重分配', () => {
  it('不写分配时每个系统的实际倍数正好是 1', () => {
    for (const t of designTemplates) {
      const body = allocateBody(t.design, partLibrary.get(t.design.parts.coat)!.bodyPlan === 'bird', viabilityRules);
      for (const v of Object.values(body.relative)) expect(v).toBe(1);
    }
  });

  it('此消彼长：多给骨头，其余系统按比例变少，总量不变', () => {
    const d = template('cat');
    const base = allocateBody(d, false, viabilityRules);
    const more = allocateBody(withAlloc(d, { skeleton: 2 }), false, viabilityRules);
    expect(more.relative.skeleton).toBeGreaterThan(1);
    expect(more.relative.muscle).toBeLessThan(1);
    const sum = (b: typeof base) => Object.values(b.share).reduce((s, x) => s + x, 0);
    expect(sum(more)).toBeCloseTo(sum(base), 12);
  });

  it('倍数夹在允许的范围里', () => {
    const d = template('cat');
    const a = allocateBody(withAlloc(d, { skeleton: 99 }), false, viabilityRules);
    const b = allocateBody(withAlloc(d, { skeleton: viabilityRules.body.maxRelative.value }), false, viabilityRules);
    expect(a.relative.skeleton).toBe(b.relative.skeleton);
  });

  it('不写分配的设计，内容和以前一样（设计的 id 来自内容的校验和，所以不变）', () => {
    const d = DesignSchema.parse(template('cat'));
    expect('allocation' in d).toBe(false);
  });
});

describe('骨骼检查', () => {
  it('17 条现有技术全部能跑能走', () => {
    for (const t of designTemplates) {
      const c = compileDesign(t.design, kit);
      expect(c.viability.every((r) => r.grade === 'ok'), t.species).toBe(true);
      expect(c.hints.some((h) => h.id.startsWith('bone')), t.species).toBe(false);
    }
  });

  it('骨头越少越危险：跑不动 → 走不动 → 站不住', () => {
    const d = { ...template('cat'), parts: { ...template('cat').parts, limbs: 'running_legs' } };
    const grade = (skeleton: number) => compileDesign(withAlloc(d, { skeleton }), kit).viability.find((r) => r.id === 'skeleton')!.grade;
    expect(grade(1)).toBe('ok');
    expect(grade(0.5)).toBe('strained');
  });

  it('超过站姿极限后，越重安全系数越低（平方–立方定律）', () => {
    const d = template('cat');
    const parts = { limbs: partLibrary.get('walking_legs')! } as never;
    const body = { relative: { skeleton: 1 } } as never;
    const at = (m: number) => skeletonSafety({ design: { ...d, bodyMassKg: m }, parts, body, rules: viabilityRules });
    expect(at(100)).toBe(at(1));
    const limit = viabilityRules.skeleton.postureLimitKg.value;
    expect(at(limit * 8)).toBeCloseTo(at(1) / 2, 2);
  });

  it('只出提醒，不改物种参数（推演里的后果从第 3 步起接入）', () => {
    const d = template('cat');
    const weak = compileDesign(withAlloc(d, { skeleton: 0.5 }), kit);
    const normal = compileDesign(d, kit);
    expect(weak.params).toEqual(normal.params);
  });

  it('环境输入只给预览，不影响物种参数', () => {
    const d = template('rabbit');
    expect(compileDesign(d, kit, { forage: [], climate: {} }).params).toEqual(compileDesign(d, kit).params);
  });
});
