import { describe, expect, it } from 'vitest';
import { ScenarioSchema, SpeciesSchema, WorldParamsSchema, plantLibrary, resolvePlants, speciesLibrary, worldFor } from '../src/data';
import { PlantsFileSchema } from '../src/data/schema/plant';
import plantsJson from '../src/data/plants/plants.json';

/** 内容即数据：src/data 下所有世界数据文件都必须通过 schema 校验。 */
const worldFiles = import.meta.glob('../src/data/world/*.json', { eager: true, import: 'default' });
/** 世界数据里的植物写的是类型 id，校验前先换成完整的类型数据（同 src/data 的加载）。 */
const worlds = Object.fromEntries(Object.entries(worldFiles).map(([f, j]) => [f, resolvePlants(j, f)]));
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

  it('植物：要正好一种草本，木本最多一种；有灌丛地形就要有长在灌丛上的木本', () => {
    const island = worlds['../src/data/world/island.json'] as { plants: Array<{ type: { form: string } }> };
    const herb = island.plants.find((p) => p.type.form === 'herb')!;
    const woody = island.plants.find((p) => p.type.form === 'woody')!;
    expect(WorldParamsSchema.safeParse(island).success).toBe(true);
    expect(WorldParamsSchema.safeParse({ ...island, plants: [woody] }).success).toBe(false);
    expect(WorldParamsSchema.safeParse({ ...island, plants: [herb, herb, woody] }).success).toBe(false);
    expect(WorldParamsSchema.safeParse({ ...island, plants: [herb] }).success).toBe(false);
    expect(WorldParamsSchema.safeParse({ ...island, plants: [{ ...herb, floorBiomass: undefined }, woody] }).success).toBe(false);
  });
});

describe('植物类型数据', () => {
  it('通过 schema 校验，id 不重复', () => {
    const r = PlantsFileSchema.safeParse(plantsJson);
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
    expect(plantLibrary.size).toBe(r.data!.types.length);
  });

  it('世界引用不存在的植物类型时报错', () => {
    expect(() => resolvePlants({ plants: [{ type: 'no-such-plant' }] }, 'x')).toThrow(/no-such-plant/);
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

describe('情景数据校验', () => {
  const scenarios = import.meta.glob('../src/data/scenarios/*.json', { eager: true, import: 'default' });
  it('找到了情景数据', () => {
    expect(Object.keys(scenarios).length).toBeGreaterThan(0);
  });
  for (const [file, json] of Object.entries(scenarios)) {
    it(file, () => {
      const r = ScenarioSchema.safeParse(json);
      expect(r.success, r.success ? '' : JSON.stringify(r.error.issues, null, 2)).toBe(true);
      if (!r.success) return;
      expect(file.endsWith(`/${r.data.id}.json`)).toBe(true);
      // 引用的世界存在，世界里的物种也都存在。
      const world = worldFor(r.data);
      for (const id of world.species) expect(speciesLibrary.has(id), id).toBe(true);
      // 委托人在意的物种（sentiment）要是这片世界里的物种，写错了名字会悄悄不扣满意度。
      for (const id of Object.keys(r.data.sentiment)) expect(world.species, `sentiment: ${id}`).toContain(id);
    });
  }
});
