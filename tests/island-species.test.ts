import { describe, expect, it } from 'vitest';
import { SpeciesSchema, WorldParamsSchema, scenarioLibrary, speciesFor, speciesLibrary, worldFor, type WorldParams } from '../src/data';
import { Sim, TICKS_PER_DAY, countAt } from '../src/sim';
import { createGrid, plantFood } from '../src/sim/grid';
import {
  BROWSE_SHARE,
  FLIGHT_ESCAPE,
  NEST_DISCOVERY,
  deriveSpecies,
  nestExposure,
  preyMatrix,
} from '../src/sim/physiology';
import { eatPlants } from '../src/sim/population';
import { Rng } from '../src/sim/rng';
import { TERRAIN } from '../src/sim/terrain';

const island: WorldParams = worldFor(scenarioLibrary.get('bird-island')!);
const cell = island.cellSizeM;
const ids = ['dotterel', 'rat', 'rabbit', 'cat'] as const;
const derived = ids.map((id) => deriveSpecies(speciesLibrary.get(id)!, cell));
const [bird, rat, rabbit, cat] = [0, 1, 2, 3];

describe('鸟岛物种的性状数据', () => {
  it('食谱三项加起来不是 1 时拒绝；写了窝类型却没写窝里天数时拒绝', () => {
    const base = speciesLibrary.get('rat')!;
    expect(SpeciesSchema.safeParse({ ...base, diet: { plant: 0.7, vertebrate: 0.1, invertebrate: 0.1 } }).success).toBe(false);
    const { nestDays: _, ...noDays } = base.reproduction;
    expect(SpeciesSchema.safeParse({ ...base, reproduction: noDays }).success).toBe(false);
  });

  it('窝里的日子由性状推出：前两段在窝里，平均待的天数接近窝里天数', () => {
    for (const sp of derived) {
      const nestDays = sp.params.reproduction.nestDays!;
      expect(sp.nestStages, sp.params.id).toBe(2);
      // 新生的在第一段平均待半段（见 physiology 的 conveyor）。
      const average = (sp.nestStages - 0.5) * sp.stageDays;
      expect(average / nestDays, sp.params.id).toBeGreaterThan(0.8);
      expect(average / nestDays, sp.params.id).toBeLessThan(1.4);
      expect(sp.juvenileStages * sp.stageDays).toBeLessThanOrEqual(sp.params.reproduction.ageAtMaturityDays);
    }
  });

  it('食谱比例决定三类食量：鸟只吃虫，猫几乎只吃肉，鼠以植物为主', () => {
    expect(derived[bird]!.invertebrateIntakeG).toBeGreaterThan(0);
    expect(derived[bird]!.plantIntakeG + derived[bird]!.vertebrateIntakeG).toBe(0);
    expect(derived[cat]!.carnivore).toBe(true);
    expect(derived[rat]!.carnivore).toBe(false);
    expect(derived[rat]!.predator).toBe(true);
    expect(derived[rat]!.params.diet.plant).toBeGreaterThan(0.5);
  });
});

describe('谁吃谁：会跑的和窝里的分开算', () => {
  const { mobile, nest } = preyMatrix(derived);

  it('鼠不追会跑的猎物，只吃窝里的：蛋和雏鸟', () => {
    expect(mobile[rat]!.every((w) => w === 0)).toBe(true);
    expect(nest[rat]![bird]!).toBeGreaterThan(0);
  });

  it('猫抓会跑的鼠、兔、鸟；成鸟会飞，比同样条件下难抓', () => {
    expect(mobile[cat]![rat]!).toBeGreaterThan(0.5);
    expect(mobile[cat]![rabbit]!).toBeGreaterThan(0.3);
    expect(mobile[cat]![bird]!).toBeGreaterThan(0);
    const grounded = preyMatrix(derived.map((d, i) => (i === bird ? { ...d, flies: false } : d))).mobile;
    expect(mobile[cat]![bird]!).toBeCloseTo(grounded[cat]![bird]! * FLIGHT_ESCAPE);
  });

  it('窝藏起来了：窝里幼体的权重不超过 NEST_DISCOVERY；洞穴比地面浅窝更难找', () => {
    for (const row of nest) for (const w of row) expect(w).toBeLessThanOrEqual(NEST_DISCOVERY);
    // 同一只猫、同一种猎物，把窝换成地面浅窝就更容易找到（地面浅窝还要再按各格掩护打折）。
    const open = preyMatrix(derived.map((d, i) => (i === rabbit ? { ...d, nest: 'ground' as const } : d))).nest;
    expect(nest[cat]![rabbit]!).toBeLessThan(open[cat]![rabbit]!);
  });

  it('掩护越好，地面浅窝越不容易被发现', () => {
    expect(nestExposure(0)).toBe(1);
    expect(nestExposure(1)).toBeLessThan(nestExposure(0.5));
    expect(nestExposure(1)).toBeGreaterThan(0);
  });

  it('不吃同类', () => {
    derived.forEach((_, i) => {
      expect(mobile[i]![i]).toBe(0);
      expect(nest[i]![i]).toBe(0);
    });
  });
});

describe('灌丛与掩护', () => {
  const grid = createGrid(island, Rng.fromSeed(1));
  const shrubCell = grid.terrain.findIndex((t) => t === TERRAIN.shrub);
  const grassCell = grid.terrain.findIndex((t) => t === TERRAIN.grass);
  const area = cell * cell;
  const food = plantFood(island);
  const floor = food.woodyFloor;
  const herbFloor = food.herbFloor;
  const shrubP = island.plants[food.woody]!;

  it('灌丛格的掩护按灌丛算，草地按草算，海岸没有掩护', () => {
    expect(grid.cover[shrubCell]!).toBeCloseTo(shrubP.initialFraction);
    expect(grid.cover[grassCell]!).toBeGreaterThan(0);
    expect(grid.cover[grassCell]!).toBeLessThan(grid.cover[shrubCell]!);
    const coast = grid.terrain.findIndex((t) => t === TERRAIN.coast);
    expect(grid.cover[coast]).toBe(0);
  });

  it('有灌丛的格子里，吃植物的有一部分来自灌丛；草地格不啃灌丛', () => {
    const g = createGrid(island, Rng.fromSeed(1));
    const shrub = g.plants[food.woody]!;
    const before = shrub[shrubCell]!;
    const demand = 500;
    const eaten = eatPlants(g, shrubCell, demand, area, food);
    expect(eaten).toBeCloseTo(demand);
    expect((before - shrub[shrubCell]!) * area).toBeCloseTo(demand * BROWSE_SHARE);
    const grassBefore = shrub[grassCell]!;
    eatPlants(g, grassCell, demand, area, food);
    expect(shrub[grassCell]).toBe(grassBefore);
  });

  it('草被啃光时拿灌丛补；灌丛也啃不动了就吃不饱', () => {
    const g = createGrid(island, Rng.fromSeed(1));
    g.plants[food.herb]![shrubCell] = herbFloor;
    const eaten = eatPlants(g, shrubCell, 500, area, food);
    expect(eaten).toBeCloseTo(500);
    g.plants[food.woody]![shrubCell] = floor;
    expect(eatPlants(g, shrubCell, 500, area, food)).toBe(0);
  });

  it('兔子多的地方，几年下来灌丛（掩护）明显变薄', () => {
    const small: WorldParams = { ...island, width: 48, height: 48, species: ['rabbit'], mainIslandOnly: [] };
    const sim = Sim.create({ seed: 2, world: small, species: speciesFor(small) });
    const shrubSum = (): number => {
      let s = 0;
      sim.state.grid.terrain.forEach((t, i) => (s += t === TERRAIN.shrub ? sim.state.grid.plants[food.woody]![i]! : 0));
      return s;
    };
    const none = Sim.create({ seed: 2, world: { ...small }, species: speciesFor(small).map((s) => ({ ...s, initialDensityPerHa: 0 })) });
    sim.stepN(TICKS_PER_DAY * 360 * 3);
    none.stepN(TICKS_PER_DAY * 360 * 3);
    let noneSum = 0;
    none.state.grid.terrain.forEach((t, i) => (noneSum += t === TERRAIN.shrub ? none.state.grid.plants[food.woody]![i]! : 0));
    expect(shrubSum()).toBeLessThan(noneSum * 0.95);
  });
});

describe('开局分布与家域', () => {
  it('mainIslandOnly 里写了世界里没有的物种时拒绝', () => {
    expect(WorldParamsSchema.safeParse({ ...island, mainIslandOnly: ['cats'] }).success).toBe(false);
  });

  it('只在主岛开局的物种，离岸小岛上一只也没有', () => {
    const sim = Sim.create({ seed: 1, world: island, species: speciesFor(island) });
    const { island: label } = sim.state.grid;
    sim.state.config.species.forEach((sp, s) => {
      let onIslets = 0;
      for (let c = 0; c < label.length; c++) if (label[c]! >= 2) onIslets += countAt(sim.state.populations[s]!, c);
      if (island.mainIslandOnly!.includes(sp.id)) expect(onIslets, sp.id).toBe(0);
    });
  });

  it('家域比区块大得多的物种在周围几个区块里一起算拥挤（野猫 3×3 区块），其余只看自己的区块', () => {
    expect(derived[cat]!.crowdingRadiusBlocks).toBe(1);
    expect(derived[rat]!.crowdingRadiusBlocks).toBe(0);
    expect(deriveSpecies(speciesLibrary.get('stoat')!, cell).crowdingRadiusBlocks).toBe(0);
  });
});
