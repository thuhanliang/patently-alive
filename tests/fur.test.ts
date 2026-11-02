import { describe, expect, it } from 'vitest';
import { designTemplates, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules, type Design } from '../src/data';
import { DesignSchema } from '../src/data/schema/design';
import { compileDesign, makeDesignKit } from '../src/sim';
import { furAnchors, furEnergyFactor, insulation } from '../src/sim/fur';

/** 毛长（设计台第 3 步 b，2026-11-02）：体表的第一个连续参数，体表卡是轴上的预设点。 */
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const template = (species: string): Design => designTemplates.find((t) => t.species === species)!.design;
const withCoat = (d: Design, coat: string): Design => ({ ...d, parts: { ...d.parts, coat } });
const withFur = (d: Design, fur: number): Design => ({ ...d, shape: { ...d.shape, fur } });
const anchors = furAnchors(partLibrary.values());
const DENSE = partLibrary.get('dense_fur')!.fur!;
const energyOf = (d: Design): number => compileDesign(d, kit).energy.needKjPerDay;

describe('毛长', () => {
  it('锚点：短毛 = 1、厚绒毛 = 卡原来的数（不经过浮点公式）', () => {
    expect(furEnergyFactor(0, anchors, viabilityRules)).toBe(1);
    expect(furEnergyFactor(DENSE, anchors, viabilityRules)).toBe(partLibrary.get('dense_fur')!.effects[0]!.factor);
    // 公式本身在锚点上也几乎正好是这两个数（反解出来的）。
    expect(furEnergyFactor(DENSE + 1e-12, anchors, viabilityRules)).toBeCloseTo(0.93, 9);
  });

  it('17 条现有技术不写毛长：编译结果不变；写成自己卡上的点：能量逐位相同', () => {
    for (const t of designTemplates) {
      const a = compileDesign(t.design, kit);
      const own = partLibrary.get(t.design.parts.coat)!.fur;
      if (own === undefined) continue;
      const b = compileDesign(withFur(t.design, own), kit);
      expect(b.params).toEqual(a.params);
      expect(b.energy.needKjPerDay).toBe(a.energy.needKjPerDay);
      expect(b.energy.appetite).toBe(a.energy.appetite);
    }
  });

  it('卡是预设：短毛拉到厚绒毛的点 = 厚绒毛；厚绒毛剪到 0 = 短毛', () => {
    const cat = template('cat');
    expect(energyOf(withFur(cat, DENSE))).toBe(energyOf(withCoat(cat, 'dense_fur')));
    expect(energyOf(withFur(withCoat(cat, 'dense_fur'), 0))).toBe(energyOf(cat));
    // 只有"来源"一行写的卡名不同。
    const { source: _a, ...a } = compileDesign(withFur(cat, DENSE), kit).params;
    const { source: _b, ...b } = compileDesign(withCoat(cat, 'dense_fur'), kit).params;
    expect(a).toEqual(b);
  });

  it('毛越长越省，有上限；裸的费得多；超出范围夹回来', () => {
    const cat = template('cat');
    const xs = [-1, -0.5, 0, 0.15, DENSE, 0.45, 0.6];
    const es = xs.map((x) => energyOf(withFur(cat, x)));
    for (let i = 1; i < es.length; i++) expect(es[i]!).toBeLessThan(es[i - 1]!);
    expect(energyOf(withFur(cat, 3))).toBe(energyOf(withFur(cat, 0.6)));
    expect(energyOf(withFur(cat, -9))).toBe(energyOf(withFur(cat, -1)));
    // 最长的毛比厚绒毛再多省不到 5%（推演里还没有热的代价，上限限住它）。
    expect(furEnergyFactor(0.6, anchors, viabilityRules)).toBeGreaterThan(0.93 - 0.05);
    expect(furEnergyFactor(-1, anchors, viabilityRules)).toBeGreaterThan(1.2);
    expect(compileDesign(withFur(cat, -0.5), kit).energy.lines.some((l) => l.label.startsWith('毛短') && l.kjPerDay > 0)).toBe(true);
  });

  it('保温随毛长线性增加，短毛 = 1', () => {
    expect(insulation(0, viabilityRules)).toBe(1);
    expect(insulation(Math.log10(3), viabilityRules)).toBeCloseTo(1 + 2 * (1 - viabilityRules.shape.furSkinShare.value), 9);
  });

  it('长羽毛的不看毛长', () => {
    const bird = designTemplates.find((t) => t.design.parts.coat === 'feathers')!.design;
    const a = compileDesign(bird, kit);
    const b = compileDesign(withFur(bird, 0.5), kit);
    expect(b.params).toEqual(a.params);
    expect(b.energy).toEqual(a.energy);
  });

  it('schema 收 shape.fur', () => {
    expect(DesignSchema.safeParse(withFur(template('cat'), 0.2)).success).toBe(true);
  });
});
