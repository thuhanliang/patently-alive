import { describe, expect, it } from 'vitest';
import { designTemplates, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules, type Design } from '../src/data';
import { compileDesign, makeDesignKit, type CheckResult } from '../src/sim';
import { cannotStand, limpOf, signsOf, thinOf } from '../src/proto/desk/signs';

// 体征（设计台第 3 步 a）：只读可行性检查的结果，长在纸偶身上。
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const cat = designTemplates.find((t) => t.species === 'cat')!.design;
const checks = (p: Partial<Design>): readonly CheckResult[] => compileDesign({ ...cat, ...p } as Design, kit).viability;
const fake = (grades: Partial<Record<CheckResult['id'], CheckResult['grade']>>): CheckResult[] =>
  (['skeleton', 'digestion', 'reproduction'] as const).map((id) => ({ id, grade: grades[id] ?? 'ok', margin: 1, evidence: {}, hints: [] }));

describe('体征', () => {
  it('17 条现有技术都没有体征，纸偶和原来一样', () => {
    for (const t of designTemplates) {
      const v = compileDesign(t.design, kit).viability;
      expect(signsOf(v), t.species).toEqual([]);
      expect(thinOf(v)).toBe(1);
      expect(limpOf(v, true, true)).toBe(0);
    }
  });

  it('猫换上研磨臼齿：消化撑不住 → 瘦，签是朱红', () => {
    const v = checks({ parts: { ...cat.parts, mouth: 'grinding_molars' } });
    const s = signsOf(v);
    expect(s.map((x) => [x.id, x.grade, x.loudest])).toEqual([['digestion', 'failing', true]]);
    expect(s[0]!.hintIds).toContain('gutFailing');
    expect(thinOf(v)).toBeLessThan(0.9);
  });

  it('同一时间只有一个最响的：最重的那个', () => {
    const s = signsOf(fake({ skeleton: 'strained', digestion: 'fatal', reproduction: 'failing' }));
    expect(s.filter((x) => x.loudest).map((x) => x.id)).toEqual(['digestion']);
  });

  it('骨骼吃力只在跑的时候跛；撑不住走路也跛；致命站不起来', () => {
    expect(limpOf(fake({ skeleton: 'strained' }), false, true)).toBe(0);
    expect(limpOf(fake({ skeleton: 'strained' }), true, true)).toBeGreaterThan(0);
    expect(limpOf(fake({ skeleton: 'failing' }), false, true)).toBeGreaterThan(0);
    expect(limpOf(fake({ skeleton: 'failing' }), false, false)).toBe(0);
    expect(cannotStand(fake({ skeleton: 'fatal' }))).toBe(true);
    expect(cannotStand(fake({ skeleton: 'failing' }))).toBe(false);
  });

  it('越重越瘦', () => {
    const t = (g: CheckResult['grade']): number => thinOf(fake({ digestion: g }));
    expect(t('ok')).toBe(1);
    expect(t('strained')).toBeGreaterThan(t('failing'));
    expect(t('failing')).toBeGreaterThan(t('fatal'));
  });
});
