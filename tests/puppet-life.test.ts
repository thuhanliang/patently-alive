import { describe, expect, it } from 'vitest';
import { designTemplates, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules } from '../src/data';
import { compileDesign, makeDesignKit, withRelativeLitter } from '../src/sim';
import { lifeLines, lifeTally } from '../src/proto/desk/life';

/** 生养的账（设计台，2026-11-15）：只把编译结果里的数乘起来。 */
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const of = (id: string, mass?: number) => {
  const d = withRelativeLitter(designTemplates.find((t) => t.species === id)!.design, kit);
  return lifeTally(compileDesign(mass ? { ...d, bodyMassKg: mass } : d, kit));
};

describe('生养的账', () => {
  it('兔子一年多出不少，袋貂一年比一年少（和花园岛上放 20 只的结果同向）', () => {
    expect(of('rabbit').yearly).toBeGreaterThan(1.3);
    expect(of('possum').yearly).toBeLessThan(1);
    expect(of('mouse').yearly).toBeGreaterThan(of('rabbit').yearly);
  });
  it('把兔子拖大：生得慢了，一年多出来的变少', () => {
    expect(of('rabbit', 30).yearly).toBeLessThan(of('rabbit').yearly);
    expect(of('rabbit', 30).littersPerYear).toBeLessThanOrEqual(of('rabbit').littersPerYear);
  });
  it('两句话里有窝数、仔数、剩几只和一年的增减', () => {
    const [a, b] = lifeLines(of('rabbit'));
    expect(a).toMatch(/窝/);
    expect(a).toMatch(/十只成体一年后剩 \d+ 只/);
    expect(b).toMatch(/一年(多|少|翻|不多不少)/);
  });
});
