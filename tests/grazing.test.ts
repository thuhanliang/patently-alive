import { describe, expect, it } from 'vitest';
import { grazingDamageRules, resolvePlants, scenarioLibrary, speciesFor, speciesLibrary, worldFor, type WorldParams } from '../src/data';
import { GrazingDamageSchema } from '../src/data/schema/plant';
import { WorldParamsSchema } from '../src/data/schema/world';
import { Sim, TICKS_PER_DAY, deserialize, serialize, type SimState } from '../src/sim';
import { createGrid, grazingResidual, growPlants, herbIndex, plantFloor, type Grid } from '../src/sim/grid';
import { eatPlants } from '../src/sim/population';
import { TERRAIN } from '../src/sim/terrain';
import { plantFood } from '../src/sim/grid';
import { Rng } from '../src/sim/rng';
const createRng = (seed: number): Rng => Rng.fromSeed(seed);
import damageJson from '../src/data/plants/damage.json';

// 关着"吃坏"的小鸟岛（第 8 步起鸟岛默认打开），用来和打开的比。
const { grazingDamage: _on, ...island }: WorldParams = worldFor(scenarioLibrary.get('bird-island-small')!);
const damaged: WorldParams = { ...island, grazingDamage: grazingDamageRules };
const R = grazingDamageRules;

/** 一小块只有草地的世界，开着吃坏，按天手动啃、手动长（季节、天气都取 1，不枯落）。 */
function plot(): { grid: Grid; world: WorldParams; herb: number } {
  const world: WorldParams = { ...damaged, width: 4, height: 4, terrain: undefined, fertility: { min: 1, max: 1, patchSize: 2 } };
  const grid = createGrid(world, createRng(1));
  return { grid, world, herb: herbIndex(world) };
}
/** 每格每天按比例啃掉"种子库以上"的 share。 */
function grazeDay(g: Grid, world: WorldParams, herb: number, share: number): void {
  const seed = world.plants[herb]!.floorBiomass! * R.seedBankShare.value;
  const b = g.plants[herb]!;
  for (let i = 0; i < b.length; i++) b[i] = b[i]! - share * Math.max(0, b[i]! - seed);
}

describe('植被被吃坏：数据与开关（阶段 3.5 第 7 步）', () => {
  it('每个数都写依据；根、土壤、种子库的下限不能是 0', () => {
    const rules = Object.fromEntries(Object.entries(damageJson).filter(([k]) => k !== '说明'));
    expect(GrazingDamageSchema.safeParse(rules).success).toBe(true);
    expect(GrazingDamageSchema.safeParse({ ...rules, minSoil: { ...damageJson.minSoil, value: 0 } }).success).toBe(false);
    const noBasis = structuredClone(rules) as Record<string, Record<string, unknown>>;
    delete noBasis.rootStop!.basis;
    expect(GrazingDamageSchema.safeParse(noBasis).success).toBe(false);
  });

  it('鸟岛、小鸟岛打开（第 8 步），草原不写；关着时格子里没有吃坏的状态', () => {
    for (const id of ['bird-island', 'bird-island-small']) expect(worldFor(scenarioLibrary.get(id)!).grazingDamage).toEqual(grazingDamageRules);
    expect(createGrid({ ...island, width: 16, height: 16 }, createRng(1)).damage).toBeUndefined();
    expect(createGrid({ ...damaged, width: 16, height: 16 }, createRng(1)).damage).toBeDefined();
  });

  it('世界数据写 true 时换成完整规则；写别的不行', () => {
    const raw = { ...island, plants: island.plants.map((p) => ({ ...p, type: p.type.id })) };
    const on = WorldParamsSchema.parse(resolvePlants({ ...raw, grazingDamage: true }, 't'));
    expect(on.grazingDamage).toEqual(grazingDamageRules);
    expect(() => resolvePlants({ ...raw, grazingDamage: { windowDays: 1 } }, 't')).toThrow();
  });
});

describe('植被被吃坏：规则（阶段 3.5 第 7 步）', () => {
  it('残留按体型：小个子啃得低，羊鹿大小以上不变，再小也剩种子库', () => {
    expect(grazingResidual(1.6, R)).toBeLessThan(0.5);
    expect(grazingResidual(1.6, R)).toBeGreaterThan(R.seedBankShare.value);
    expect(grazingResidual(200, R)).toBe(1);
    expect(grazingResidual(0.03, R)).toBe(R.seedBankShare.value);
  });

  it('eatPlants 用残留：同一格，残留低的啃得更低', () => {
    const w = { ...island, width: 4, height: 4, terrain: undefined };
    const food = plantFood(w);
    const mk = () => createGrid(w, createRng(2));
    const a = mk();
    const b = mk();
    const h = food.herb;
    for (const g of [a, b]) g.plants[h]!.fill(food.herbFloor * 1.01);
    eatPlants(a, 0, 1e9, 2500, food);
    eatPlants(b, 0, 1e9, 2500, food, undefined, 0.3);
    expect(a.plants[h]![0]!).toBeGreaterThanOrEqual(food.herbFloor);
    expect(b.plants[h]![0]!).toBeLessThan(a.plants[h]![0]!);
  });

  it('连续啃满（每天 5%）几周内越过 Crider 的五成，根储备开始下降；真实兔子那样的啃法（每天 0.2%）远到不了', () => {
    const heavy = plot();
    let crossed = -1;
    for (let d = 0; d < 60; d++) {
      grazeDay(heavy.grid, heavy.world, heavy.herb, 0.05);
      growPlants(heavy.grid, heavy.world, 1, 0);
      if (crossed < 0 && heavy.grid.damage!.pressure[5]! > R.rootStop.value) crossed = d;
    }
    expect(crossed).toBeGreaterThan(0);
    expect(crossed).toBeLessThan(30);
    expect(heavy.grid.damage!.root[5]!).toBeLessThan(1);
    const light = plot();
    for (let d = 0; d < 365; d++) {
      grazeDay(light.grid, light.world, light.herb, 0.002);
      growPlants(light.grid, light.world, 1, 0);
    }
    expect(light.grid.damage!.pressure[5]!).toBeLessThan(0.05);
    expect(light.grid.damage!.root[5]).toBe(1);
    expect(light.grid.damage!.soil[5]).toBe(1);
  });

  it('啃成裸地土壤会退化、长得更差；不再啃就慢慢恢复，不会锁死', () => {
    const { grid, world, herb } = plot();
    const cap = world.plants[herb]!.maxBiomass;
    for (let d = 0; d < 2 * 365; d++) {
      grazeDay(grid, world, herb, 0.9);
      growPlants(grid, world, 1, 0);
    }
    const st = grid.damage!;
    expect(st.soil[5]!).toBeLessThan(0.5);
    expect(st.root[5]!).toBe(R.minRoot.value);
    expect(grid.plants[herb]![5]!).toBeGreaterThanOrEqual(plantFloor(world.plants[herb]!) * R.seedBankShare.value);
    // 停止啃食：一年后根补回、草长回来，但上限还被土壤压着；土壤要好几年。
    for (let d = 0; d < 365; d++) growPlants(grid, world, 1, 0);
    expect(st.root[5]).toBe(1);
    expect(grid.plants[herb]![5]!).toBeLessThan(cap * 0.8);
    for (let d = 0; d < 7 * 365; d++) growPlants(grid, world, 1, 0);
    expect(st.soil[5]).toBe(1);
    expect(grid.plants[herb]![5]!).toBeGreaterThan(cap * 0.95);
  });
});

describe('植被被吃坏：推演（阶段 3.5 第 7 步）', () => {
  const world = { ...damaged, width: 48, height: 48 };
  const config = { seed: 3, world, species: speciesFor(world) };

  it('打开时一天中途存档再恢复，和一口气跑完逐位相同', () => {
    const straight = Sim.create(config);
    straight.setFocus({ x0: 8, y0: 8, x1: 32, y1: 32 });
    straight.stepN(TICKS_PER_DAY * 40);
    const first = Sim.create(config);
    first.setFocus({ x0: 8, y0: 8, x1: 32, y1: 32 });
    first.stepN(TICKS_PER_DAY * 23 + 5);
    const resumed = new Sim(deserialize<SimState>(serialize(first.snapshot())));
    resumed.stepN(TICKS_PER_DAY * 40 - (TICKS_PER_DAY * 23 + 5));
    expect(serialize(resumed.snapshot())).toBe(serialize(straight.snapshot()));
  }, 120_000);

  it.each([
    ['格子模型', false],
    ['个体模型（关注区）', true],
  ])('胃口极大的兔子把草啃到世界的下限以下（按体型的残留），压力越过五成（%s）', (_, focused) => {
    const rabbit = speciesLibrary.get('rabbit')!;
    const w = { ...world, species: ['rabbit'], mainIslandOnly: [] };
    const sim = Sim.create({ seed: 5, world: w, species: [{ ...rabbit, energyFactor: 12, initialDensityPerHa: 40 }] });
    if (focused) sim.setFocus({ x0: 8, y0: 8, x1: 40, y1: 40 });
    sim.stepN(TICKS_PER_DAY * 120);
    const herb = sim.state.grid.plants[herbIndex(w)]!;
    const floor = w.plants[herbIndex(w)]!.floorBiomass!;
    // 关注区里（个体模型就在这里吃）草本最低的那一格。
    let low = Infinity;
    const land = sim.state.grid.terrain;
    for (let y = 8; y < 40; y++) for (let x = 8; x < 40; x++) if (land[y * 48 + x] !== TERRAIN.water) low = Math.min(low, herb[y * 48 + x]!);
    expect(low).toBeLessThan(floor);
    // 兔子啃得比世界写的下限低得多（残留约四成，每天只能再啃掉剩下的 5%，慢慢逼近）；枯落还能再往下一点，但不会低于种子库。
    expect(low).toBeLessThan(floor * 0.5);
    expect(low).toBeGreaterThanOrEqual(floor * R.seedBankShare.value);
    expect(Math.max(...sim.state.grid.damage!.pressure)).toBeGreaterThan(R.rootStop.value);
  }, 180_000);
});

describe('鸟岛打开吃坏以后（阶段 3.5 第 8 步）', () => {
  it('投放一大群大型食草设计，能把小鸟岛的一片草地吃坏：根储备耗下去，土壤变差', async () => {
    const data = await import('../src/data');
    const { compileDesign, designDataOf, makeDesignKit, scenarioRules, Session } = await import('../src/sim');
    const kit = makeDesignKit(data.partLibrary, data.scalingLaws, data.hintTemplates, data.viabilityRules, [...data.plantLibrary.values()], data.designTemplates.map((t) => t.design));
    const sc = scenarioLibrary.get('bird-island-small')!;
    const rabbit = data.designTemplates.find((t) => t.species === 'rabbit')!.design;
    // 300 千克、反刍：像一群牛。
    const design = { ...rabbit, id: 'd_cow', name: '试验牛', bodyMassKg: 300, parts: { ...rabbit.parts, digestion: 'ruminant' } };
    const species = compileDesign(design, kit).params;
    const s = new Session({ seed: 3, world: worldFor(sc), species: speciesFor(worldFor(sc)), tools: data.tools, design: designDataOf(kit) }, { ...scenarioRules(sc), budget: 1e9 });
    const g = s.sim.state.grid;
    const cx = Math.floor(g.width / 2);
    const cy = Math.floor(g.height / 2);
    const before = s.sim.state.grid.damage!;
    expect(Math.min(...before.root)).toBe(1);
    for (const dx of [-6, 6]) expect(s.submit({ type: 'introduce', species, design, x: cx + dx, y: cy, count: 150 })).toEqual({ ok: true });
    s.advance(360 * TICKS_PER_DAY);
    const dmg = s.sim.state.grid.damage!;
    expect(Math.min(...dmg.root)).toBeLessThan(0.5);
    expect(Math.min(...dmg.soil)).toBeLessThan(0.6);
  }, 180_000);
});
