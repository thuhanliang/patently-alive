import { describe, expect, it } from 'vitest';
import { designTemplates, viabilityRules, type Design } from '../src/data';
import { BODY_SYSTEMS } from '../src/data/schema/viability';
import { allocateBody } from '../src/sim';
import { requestedOf } from '../src/sim/body';
import { requestFor } from '../src/proto/desk/pie';

// 体重分配纸饼（设计台第 2 步 b）：拖一瓣到想要的实际倍数，解出这一瓣要的倍数；总量不变。
const cat = designTemplates.find((t) => t.species === 'cat')!.design;
const lo = viabilityRules.body.minRelative.value;
const hi = viabilityRules.body.maxRelative.value;
const sum = (r: Readonly<Record<string, number>>): number => BODY_SYSTEMS.reduce((a, s) => a + r[s]!, 0);

describe('体重分配纸饼', () => {
  it('拖到哪，这一瓣的实际倍数就是多少；五个系统的总量不变', () => {
    for (const s of BODY_SYSTEMS)
      for (const target of [0.6, 0.9, 1.3, 1.7]) {
        const d: Design = structuredClone(cat);
        d.allocation = { muscle: 1.2, fat: 0.8 };
        const before = allocateBody(d, false, viabilityRules);
        const v = requestFor(s, target, before.base, requestedOf(d, viabilityRules), lo, hi);
        if (v <= lo || v >= hi) continue;
        d.allocation = { ...d.allocation, [s]: v };
        const after = allocateBody(d, false, viabilityRules);
        expect(after.relative[s], `${s} → ${target}`).toBeCloseTo(target, 9);
        expect(sum(after.share)).toBeCloseTo(sum(before.share), 12);
      }
  });

  it('多给心脏别的几乎不缩，多给肌肉别的都缩一圈', () => {
    const grow = (s: 'heart' | 'muscle'): number => {
      const d: Design = structuredClone(cat);
      const b = allocateBody(d, false, viabilityRules);
      d.allocation = { [s]: requestFor(s, 1.5, b.base, requestedOf(d, viabilityRules), lo, hi) };
      return allocateBody(d, false, viabilityRules).relative.gut;
    };
    expect(grow('heart')).toBeGreaterThan(0.99);
    expect(grow('muscle')).toBeLessThan(0.85);
  });

  it('要的倍数夹在可调范围里', () => {
    const b = allocateBody(cat, false, viabilityRules);
    const req = requestedOf(cat, viabilityRules);
    expect(requestFor('muscle', 4, b.base, req, lo, hi)).toBe(hi);
    expect(requestFor('muscle', 0.1, b.base, req, lo, hi)).toBe(lo);
  });
});
