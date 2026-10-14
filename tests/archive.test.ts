import { describe, expect, it } from 'vitest';
import { ArchiveEntrySchema, archiveLibrary, speciesLibrary } from '../src/data';
import { deriveSpecies } from '../src/sim/physiology';

/** 自然档案馆：每条现有技术都是一种能推演的真实动物。 */
const files = import.meta.glob('../src/data/archive/*.json', { eager: true, import: 'default' });

describe('档案馆条目', () => {
  for (const [file, json] of Object.entries(files)) {
    it(file, () => {
      const r = ArchiveEntrySchema.safeParse(json);
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
      // 文件名就是物种 id。
      if (r.success) expect(file.endsWith(`/${r.data.species}.json`)).toBe(true);
    });
  }

  it('每个物种都有一条档案，每条档案都有物种数据', () => {
    expect([...archiveLibrary.keys()].sort()).toEqual([...speciesLibrary.keys()].sort());
  });

  it('第一批至少 15 条，哺乳动物和鸟都有', () => {
    const classes = [...archiveLibrary.values()].map((e) => e.taxonomy.class);
    expect(archiveLibrary.size).toBeGreaterThanOrEqual(15);
    expect(classes).toContain('哺乳纲');
    expect(classes).toContain('鸟纲');
  });

  it('每条都能推导出可用的引擎参数（没有 NaN、繁殖和死亡率在范围内）', () => {
    for (const s of speciesLibrary.values()) {
      const d = deriveSpecies(s, 50);
      for (const [k, v] of Object.entries(d)) {
        if (typeof v === 'number') expect(Number.isFinite(v), `${s.id}.${k} = ${v}`).toBe(true);
      }
      expect(d.adultDailyMortality).toBeGreaterThan(0);
      expect(d.adultDailyMortality).toBeLessThan(0.05);
      expect(d.litterRate).toBeGreaterThan(0);
      expect(d.juvenileStages).toBeGreaterThanOrEqual(2);
    }
  });
});
