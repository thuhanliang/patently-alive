import { describe, expect, it } from 'vitest';
import { designTemplates, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules, type Design } from '../src/data';
import { compileDesign, makeDesignKit, type CheckResult } from '../src/sim';
import { signsOf, thermalOf } from '../src/proto/desk/signs';

/** 冷热试验（设计台第 3 步 b，2026-11-02）：只给预览，要气候输入。 */
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const template = (species: string): Design => designTemplates.find((t) => t.species === species)!.design;
const at = (d: Design, temperatureC: number): CheckResult => compileDesign(d, kit, { climate: { temperatureC } }).viability.find((r) => r.id === 'thermal')!;
const withFur = (d: Design, fur: number): Design => ({ ...d, shape: { ...d.shape, fur } });

describe('冷热', () => {
  it('不给气候：跳过，没有提醒，体征和以前一样', () => {
    for (const t of designTemplates) {
      const c = compileDesign(t.design, kit);
      const th = c.viability.find((r) => r.id === 'thermal')!;
      expect(th.skipped).toBe('climate');
      expect(th.grade).toBe('ok');
      expect(c.hints.some((h) => h.id === 'tooCold' || h.id === 'tooHot')).toBe(false);
      expect(signsOf(c.viability).length).toBe(0);
      expect(thermalOf(c.viability)).toEqual({ shiver: 0, pant: 0 });
    }
  });

  it('给了气候也不改物种参数和能量收支', () => {
    for (const t of designTemplates) {
      const a = compileDesign(t.design, kit);
      const b = compileDesign(t.design, kit, { climate: { temperatureC: -40 } });
      expect(b.params).toEqual(a.params);
      expect(b.energy).toEqual(a.energy);
    }
  });

  it('17 条现有技术在 0–25 °C 都没问题（温带）', () => {
    for (const t of designTemplates) for (let c = 0; c <= 25; c += 5) expect(at(t.design, c).grade, `${t.species} ${c} °C`).toBe('ok');
  });

  it('毛长：冷处好过、热处难过', () => {
    const cat = template('cat');
    expect(at(cat, -40).grade).toBe('strained');
    expect(at(withFur(cat, 0.6), -40).grade).toBe('ok');
    expect(at(withFur(cat, -1), 0).grade).not.toBe('ok');
    expect(at(cat, 25).grade).toBe('ok');
    expect(at(withFur(cat, 0.6), 25).grade).toBe('strained');
    // 方向写在 evidence 里：纸签按它写"发抖"还是"喘"。
    expect(at(cat, -40).evidence.cold).toBe(1);
    expect(at(withFur(cat, 0.6), 25).evidence.cold).toBe(0);
    expect(signsOf([at(cat, -40)])[0]!.label).toBe('发抖');
    expect(signsOf([at(withFur(cat, 0.6), 25)])[0]!.label).toBe('喘');
  });

  it('个子：大的怕热，小的怕冷', () => {
    const cat = template('cat');
    expect(at({ ...cat, bodyMassKg: 1000 }, 32).grade).not.toBe('ok');
    expect(at({ ...cat, bodyMassKg: 0.01 }, -10).grade).not.toBe('ok');
    expect(at({ ...cat, bodyMassKg: 1000 }, -40).grade).toBe('ok');
  });

  it('越冷越重，到头是致命；热到体温以上也是', () => {
    const bare = withFur(template('cat'), -1);
    const rank = ['ok', 'strained', 'failing', 'fatal'];
    let last = 0;
    for (const c of [30, 15, 5, -5, -15]) {
      const g = rank.indexOf(at(bare, c).grade);
      expect(g).toBeGreaterThanOrEqual(last);
      last = g;
    }
    expect(at(bare, -15).grade).toBe('fatal');
    expect(at(template('cat'), 45).grade).toBe('fatal');
  });

  it('提醒和余量：出问题才提醒，余量 1 以上没问题', () => {
    const cat = template('cat');
    const cold = compileDesign(withFur(cat, -1), kit, { climate: { temperatureC: 0 } });
    expect(cold.hints.some((h) => h.id === 'tooCold')).toBe(true);
    expect(at(cat, 10).margin).toBeGreaterThan(1);
    expect(at(withFur(cat, -1), 0).margin).toBeLessThan(1);
    expect(at(withFur(cat, -1), 0).evidence.extraHeat).toBeGreaterThan(0);
  });
});
