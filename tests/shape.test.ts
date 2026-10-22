import { describe, expect, it } from 'vitest';
import { designTemplates, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules, type Design } from '../src/data';
import { DesignSchema } from '../src/data/schema/design';
import { compileDesign, makeDesignKit, skeletonSafety, allocateBody, partsOf } from '../src/sim';
import { chaseFactor, deriveSpecies } from '../src/sim/physiology';

/** 形状（腿长、尾长，2026-10-22）：设计的性状，推导走引擎。 */
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const template = (species: string): Design => designTemplates.find((t) => t.species === species)!.design;
const withShape = (d: Design, shape: Design['shape']): Design => ({ ...d, shape });
const safety = (d: Design): number => {
  const parts = partsOf(d, kit);
  const bird = parts.coat.bodyPlan === 'bird';
  return skeletonSafety({ design: d, parts, body: allocateBody(d, bird, viabilityRules), rules: viabilityRules });
};

describe('腿长、尾长', () => {
  it('不写形状、或写成一般长：编译结果和以前一模一样（17 条现有技术不变）', () => {
    for (const t of designTemplates) {
      const a = compileDesign(t.design, kit);
      const b = compileDesign(withShape(t.design, { leg: 0, tail: 0 }), kit);
      expect(b.params).toEqual(a.params);
      expect(b.energy).toEqual(a.energy);
      expect(a.params.body?.speed).toBeUndefined();
    }
  });

  it('腿长：跑得快、走一米省力、骨头受力大', () => {
    const cat = template('cat');
    const base = compileDesign(cat, kit);
    const long = compileDesign(withShape(cat, { leg: 0.2 }), kit);
    const short = compileDesign(withShape(cat, { leg: -0.2 }), kit);
    expect(long.params.body!.speed!).toBeCloseTo(Math.sqrt(10 ** 0.2), 3);
    expect(short.params.body!.speed!).toBeLessThan(1);
    // 走路的那一份（locomotionShare）按腿长成反比变：长腿省、短腿费。
    expect(long.energy.needKjPerDay).toBeLessThan(base.energy.needKjPerDay);
    expect(short.energy.needKjPerDay).toBeGreaterThan(base.energy.needKjPerDay);
    expect(long.energy.lines.some((l) => l.label.startsWith('腿长') && l.kjPerDay < 0)).toBe(true);
    // 骨安全系数按腿长倍数的 -1 次方。
    expect(safety(withShape(cat, { leg: 0.2 }))).toBeCloseTo(safety(cat) / 10 ** 0.2, 6);
    expect(safety(withShape(cat, { leg: -0.2 }))).toBeGreaterThan(safety(cat));
  });

  it('很重的动物再拉长腿：骨头撑不住，跑不动', () => {
    const big = { ...template('cat'), bodyMassKg: 3000 };
    const plain = compileDesign(big, kit).viability.find((r) => r.id === 'skeleton')!;
    const leggy = compileDesign(withShape(big, { leg: 0.2 }), kit).viability.find((r) => r.id === 'skeleton')!;
    expect(leggy.evidence.safety!).toBeLessThan(plain.evidence.safety!);
    expect(compileDesign(withShape(big, { leg: 0.2 }), kit).params.body!.runFactor!).toBeLessThan(1);
  });

  it('尾长：尾型自己的效果按倍数次方放大，长尾多带一点体重', () => {
    const d = { ...template('cat'), parts: { ...template('cat').parts, tail: 'balance_tail' } };
    const base = compileDesign(d, kit);
    const long = compileDesign(withShape(d, { tail: 0.3 }), kit);
    const k = 10 ** 0.3;
    // 平衡尾的"躲得开"是死亡率 × 0.95：尾巴长 k 倍就是 × 0.95^k。
    expect(long.multipliers.mortality).toBeCloseTo(base.multipliers.mortality * 0.95 ** (k - 1), 6);
    expect(long.energy.lines.some((l) => l.label.startsWith('尾长') && l.kjPerDay > 0)).toBe(true);
  });

  it('超出范围的形状夹回范围里', () => {
    const cat = template('cat');
    const wild = compileDesign(withShape(cat, { leg: 5, tail: -5 }), kit);
    const edge = compileDesign(withShape(cat, { leg: viabilityRules.shape.legMax.value, tail: viabilityRules.shape.tailMin.value }), kit);
    expect(wild.params).toEqual({ ...edge.params, id: wild.params.id });
    expect(DesignSchema.safeParse(withShape(cat, { leg: Number.NaN })).success).toBe(false);
  });

  it('追捕：捕食者比猎物快就多抓到，猎物会飞时不看腿', () => {
    const species = (d: Design) => deriveSpecies(compileDesign(d, kit).params, 50);
    const cat = template('cat');
    const fast = species(withShape(cat, { leg: 0.2 }));
    const plain = species(cat);
    const prey = species(template('rabbit'));
    expect(chaseFactor(plain, prey)).toBe(1);
    expect(chaseFactor(fast, prey)).toBeCloseTo(Math.sqrt(10 ** 0.2), 3);
    const fastPrey = species(withShape(template('rabbit'), { leg: 0.2 }));
    expect(chaseFactor(plain, fastPrey)).toBeLessThan(1);
    const bird = species(template('dotterel'));
    expect(chaseFactor(fast, bird)).toBe(chaseFactor(plain, bird));
  });
});
