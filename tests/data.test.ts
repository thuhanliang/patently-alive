import { describe, expect, it } from 'vitest';
import { SpeciesSchema, WorldParamsSchema, speciesLibrary } from '../src/data';

/** 内容即数据：src/data 下所有世界数据文件都必须通过 schema 校验。 */
const worlds = import.meta.glob('../src/data/world/*.json', { eager: true, import: 'default' });
const species = import.meta.glob('../src/data/species/*.json', { eager: true, import: 'default' });

describe('数据文件校验', () => {
  it('找到了世界数据', () => {
    expect(Object.keys(worlds).length).toBeGreaterThan(0);
  });
  for (const [file, json] of Object.entries(worlds)) {
    it(file, () => {
      const r = WorldParamsSchema.safeParse(json);
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
      if (r.success) expect(r.data.fertility.min).toBeLessThanOrEqual(r.data.fertility.max);
    });
  }
});

describe('世界 schema 的取值约束', () => {
  it('min 大于 max 时拒绝', () => {
    const base = worlds[Object.keys(worlds)[0]!] as Record<string, Record<string, unknown>>;
    expect(WorldParamsSchema.safeParse({ ...base, fertility: { ...base.fertility, min: 0.9, max: 0.2 } }).success).toBe(false);
    expect(WorldParamsSchema.safeParse({ ...base, weather: { ...base.weather, min: 2, max: 1 } }).success).toBe(false);
  });
});

describe('物种数据校验', () => {
  for (const [file, json] of Object.entries(species)) {
    it(file, () => {
      const r = SpeciesSchema.safeParse(json);
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
      // 文件名就是 id，方便查找。
      if (r.success) expect(file.endsWith(`/${r.data.id}.json`)).toBe(true);
    });
  }

  it('世界里引用的物种都存在', () => {
    for (const json of Object.values(worlds)) {
      const w = WorldParamsSchema.parse(json);
      for (const id of w.species) expect(speciesLibrary.has(id), id).toBe(true);
    }
  });
});
