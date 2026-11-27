import { describe, expect, it } from 'vitest';
import { floraSpecies } from '../src/data';
import { cutPlant } from '../src/render/flora/shapes';

describe('植物图鉴', () => {
  it('每一种都有出处、都剪得出来，高度和数据一致', () => {
    expect(floraSpecies.length).toBeGreaterThanOrEqual(20);
    for (const sp of floraSpecies) {
      expect(sp.source.length).toBeGreaterThan(5);
      const cut = cutPlant(sp.look, 1, 1, 1);
      expect(cut.sheets.length).toBeGreaterThan(0);
      for (const sh of cut.sheets) for (const p of sh.polys) expect(p.every(Number.isFinite)).toBe(true);
      // 剪出来的高度在真实高度的 0.5–2 倍以内（花葶、花穗可以高出叶丛）。
      expect(cut.height).toBeGreaterThan(sp.look.height * 0.5);
      expect(cut.height).toBeLessThan(sp.look.height * 2.2);
    }
  });

  it('同一个种子剪出同一株（确定）', () => {
    const sp = floraSpecies[0]!;
    expect(cutPlant(sp.look, 7)).toEqual(cutPlant(sp.look, 7));
  });

  it('不开花的月份不画花', () => {
    const p = floraSpecies.find((s) => s.id === 'pohutukawa')!;
    const off = cutPlant(p.look, 3, 0, 0).sheets.map((s) => s.color);
    expect(off).not.toContain(p.look.flower);
    expect(cutPlant(p.look, 3, 1, 0).sheets.map((s) => s.color)).toContain(p.look.flower);
  });
});
