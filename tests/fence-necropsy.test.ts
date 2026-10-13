import { describe, expect, it } from 'vitest';
import { grassland, scenarioLibrary, speciesFor, speciesLibrary, tools, worldFor, type WorldParams } from '../src/data';
import { CAUSE, SANDBOX_RULES, Session, Sim, TICKS_PER_DAY, type Rules } from '../src/sim';
import { buildBarriers, fenceStops, markFence, pathBlocked, type Barrier } from '../src/sim/fence';
import { createLedger, closeLedgerDay, FRESH_DAYS, freshIndex, recordDeaths } from '../src/sim/ledger';
import { deriveSpecies } from '../src/sim/physiology';
import { TERRAIN } from '../src/sim/terrain';

const scenario = scenarioLibrary.get('bird-island')!;
const island = worldFor(scenario);
const small: WorldParams = { ...island, width: 64, height: 64 };
const rules: Rules = { scenario: scenario.id, ...scenario.resources, allowRelease: false, sentiment: scenario.sentiment };
const rabbitFence = tools.fences.find((f) => f.id === 'rabbit-fence')!;
const predatorFence = tools.fences.find((f) => f.id === 'predator-fence')!;
const sp = (id: string) => deriveSpecies(speciesLibrary.get(id)!, island.cellSizeM);

describe('围栏挡谁由性状推出', () => {
  it('防兔网挡兔子；鼠钻得过、猫翻得过、鸟飞得过', () => {
    expect(fenceStops(rabbitFence, sp('rabbit'), sp('rabbit').params.bodyMassKg)).toBe(true);
    expect(fenceStops(rabbitFence, sp('rat'), sp('rat').params.bodyMassKg)).toBe(false);
    expect(fenceStops(rabbitFence, sp('cat'), sp('cat').params.bodyMassKg)).toBe(false);
    expect(fenceStops(rabbitFence, sp('dotterel'), sp('dotterel').params.bodyMassKg)).toBe(false);
  });

  it('防捕食者围栏挡猫、鼠、兔；鸟照样飞过', () => {
    for (const id of ['cat', 'rat', 'rabbit']) expect(fenceStops(predatorFence, sp(id), sp(id).params.bodyMassKg)).toBe(true);
    expect(fenceStops(predatorFence, sp('dotterel'), sp('dotterel').params.bodyMassKg)).toBe(false);
  });
});

describe('格边与路径', () => {
  const w = 10;
  const h = 10;
  const land = new Uint8Array(w * h).fill(TERRAIN.grass);
  const wall = (x0: number, y0: number, x1: number, y1: number): Barrier => {
    const b: Barrier = { v: new Uint8Array(w * h), h: new Uint8Array(w * h) };
    markFence(b, w, h, { id: 1, type: 0, x0, y0, x1, y1 });
    return b;
  };

  it('竖着的围栏 x=5 挡住左右穿越，不挡上下走', () => {
    const b = wall(5, 0, 5, 10);
    expect(pathBlocked(land, b, w, 2.5, 4.5, 7.5, 4.5)).toBe(true);
    expect(pathBlocked(land, b, w, 7.5, 1.5, 6.5, 8.5)).toBe(false);
    expect(pathBlocked(land, null, w, 2.5, 4.5, 7.5, 4.5)).toBe(false);
  });

  it('斜围栏没有缝：斜着走也过不去', () => {
    const b = wall(0, 0, 10, 10);
    // 对角线上方（x > y）到下方（x < y）。
    for (const [x0, y0, x1, y1] of [
      [6.5, 2.5, 2.5, 6.5],
      [5.5, 4.5, 4.5, 5.5],
      [1.5, 0.5, 0.5, 1.5],
    ] as const) {
      expect(pathBlocked(land, b, w, x0, y0, x1, y1)).toBe(true);
    }
  });

  it('围栏穿过的格子不会被四面封死：它算在一边，和那一边相通', () => {
    for (const b of [wall(0, 0, 10, 10), wall(0, 0, 3, 9), wall(5, 0, 5, 10)]) {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const open = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ].some(([dx, dy]) => {
            const nx = x + dx!;
            const ny = y + dy!;
            return nx >= 0 && ny >= 0 && nx < w && ny < h && !pathBlocked(land, b, w, x + 0.5, y + 0.5, nx + 0.5, ny + 0.5);
          });
          expect(open, `(${x}, ${y})`).toBe(true);
        }
      }
    }
  });

  it('围栏的尽头绕得过去', () => {
    const b = wall(5, 0, 5, 5);
    expect(pathBlocked(land, b, w, 2.5, 7.5, 7.5, 7.5)).toBe(false);
  });

  it('没有围栏时和只看水一样', () => {
    const species = [sp('cat'), sp('dotterel')];
    const { adult } = buildBarriers([], tools.fences, species, w, h);
    expect(adult).toEqual([null, null]);
  });
});

describe('围栏挡住扩散', () => {
  it('草原中间一道完工的防捕食者围栏：一年后右边还是一只田鼠都没有；不架围栏就会扩散过去', () => {
    const world: WorldParams = { ...grassland, width: 32, height: 32 };
    const species = speciesFor(world);
    const vole = species.findIndex((s) => s.id === 'vole');
    const clearRight = (sim: Sim): Sim => {
      // 从快照恢复（围栏挡住的格边由快照里的围栏重建），右半边清空。
      const st = sim.snapshot();
      for (const pop of st.populations) {
        for (let c = 0; c < pop.adults.length; c++) {
          if (c % world.width >= 16) {
            pop.adults[c] = 0;
            for (const j of pop.juveniles) j[c] = 0;
          }
        }
      }
      return new Sim(st);
    };
    const right = (s: Sim): number => {
      const p = s.state.populations[vole]!;
      let n = 0;
      for (let c = 0; c < p.adults.length; c++) if (c % world.width >= 16) n += p.adults[c]!;
      return n;
    };

    const base = Sim.create({ seed: 3, world, species, tools });
    base.buildFence(tools.fences.indexOf(predatorFence), 16, 0, 16, 32, 1);
    base.stepN(TICKS_PER_DAY);
    expect(base.state.fences.length).toBe(1);
    const fenced = clearRight(base);
    fenced.stepN(TICKS_PER_DAY * 360);
    expect(right(fenced)).toBe(0);

    const open = clearRight(Sim.create({ seed: 3, world, species, tools }));
    open.stepN(TICKS_PER_DAY * 360);
    expect(right(open)).toBeGreaterThan(0);
  });

  it('围栏要等完工才挡得住；工期和花费按长度算', () => {
    const s = new Session({ seed: 1, world: small, species: speciesFor(small), tools }, rules);
    const budget = s.resources.budget;
    // 20 格 × 50 米 = 1 公里。
    const r = s.submit({ type: 'fence', fence: 'rabbit-fence', x0: 10, y0: 20, x1: 30, y1: 20 });
    expect(r).toEqual({ ok: true });
    expect(s.resources.budget).toBe(budget - rabbitFence.costPerKm);
    expect(s.freeStaff()).toBe(rules.staff - 1);
    expect(s.sim.state.fences.length).toBe(0);
    s.advance(TICKS_PER_DAY);
    expect(s.sim.state.fences.length).toBe(1);
    expect(s.sim.state.jobs.length).toBe(0);
  });

  it('太短或出了地图的围栏被拒绝', () => {
    const s = new Session({ seed: 1, world: small, species: speciesFor(small), tools }, rules);
    expect(s.submit({ type: 'fence', fence: 'rabbit-fence', x0: 3, y0: 3, x1: 3, y1: 3 }).ok).toBe(false);
    expect(s.submit({ type: 'fence', fence: 'rabbit-fence', x0: 0, y0: 0, x1: 99, y1: 0 }).ok).toBe(false);
    expect(s.submit({ type: 'fence', fence: 'nope', x0: 0, y0: 0, x1: 5, y1: 0 }).ok).toBe(false);
  });

  it('有围栏的局存档回放结果一样', () => {
    const s = new Session({ seed: 4, world: small, species: speciesFor(small), tools }, SANDBOX_RULES);
    s.advance(TICKS_PER_DAY * 3);
    expect(s.submit({ type: 'fence', fence: 'predator-fence', x0: 20, y0: 10, x1: 20, y1: 50 }).ok).toBe(true);
    s.advance(TICKS_PER_DAY * 30);
    const replayed = Session.replay(JSON.parse(JSON.stringify(s.exportLog())));
    expect(replayed.sim.totals()).toEqual(s.sim.totals());
    expect(replayed.sim.state.fences).toEqual(s.sim.state.fences);
  });
});

describe('新鲜尸体', () => {
  it('过了 FRESH_DAYS 天就腐烂；人为移除的不留尸体', () => {
    const l = createLedger(2, 4);
    recordDeaths(l, 1, CAUSE.starvation, 3, 5);
    recordDeaths(l, 1, CAUSE.removed, 3, 7);
    const sum = (): number => l.fresh.reduce((a, b) => a + b, 0);
    expect(sum()).toBe(5);
    expect(l.fresh[freshIndex(l, l.freshSlot, 1, CAUSE.starvation, 3)]).toBe(5);
    for (let d = 1; d < FRESH_DAYS; d++) {
      closeLedgerDay(l);
      expect(sum()).toBe(5);
    }
    closeLedgerDay(l);
    expect(sum()).toBe(0);
  });

  it('找尸体：带回的不超过上限，死因来自账本，带回的从新鲜尸体里拿走', () => {
    const s = new Session({ seed: 2, world: small, species: speciesFor(small), tools }, rules);
    s.advance(TICKS_PER_DAY * 60);
    const g = s.sim.state.grid;
    let at = { x: 32, y: 32 };
    for (let c = 0; c < g.terrain.length; c++) {
      if (g.terrain[c] === TERRAIN.grass && Math.abs((c % g.width) - 32) + Math.abs(Math.floor(c / g.width) - 32) < 10) {
        at = { x: c % g.width, y: Math.floor(c / g.width) };
        break;
      }
    }
    const budget = s.resources.budget;
    expect(s.submit({ type: 'necropsy', species: null, x: at.x, y: at.y })).toEqual({ ok: true });
    expect(s.resources.budget).toBe(budget - tools.necropsy.cost);
    s.advance(TICKS_PER_DAY);
    const result = s.sim.state.necropsies.at(-1)!;
    expect(result.x).toBe(at.x);
    expect(result.found.length).toBeGreaterThan(0);
    expect(result.found.length).toBeLessThanOrEqual(tools.necropsy.maxCarcasses);
    for (const c of result.found) {
      expect(c.cause).not.toBe(CAUSE.removed);
      expect(c.daysDead).toBeGreaterThanOrEqual(0);
      expect(c.daysDead).toBeLessThan(FRESH_DAYS);
      expect((c.x - at.x) ** 2 + (c.y - at.y) ** 2).toBeLessThanOrEqual(tools.necropsy.radiusCells ** 2);
    }
  });

  it('指定物种时只带回那个物种', () => {
    const s = new Session({ seed: 2, world: small, species: speciesFor(small), tools }, rules);
    s.advance(TICKS_PER_DAY * 60);
    const rat = s.sim.species.findIndex((x) => x.params.id === 'rat');
    const g = s.sim.state.grid;
    const c = g.terrain.findIndex((t, i) => t === TERRAIN.grass && Math.abs((i % g.width) - 32) < 8 && Math.abs(Math.floor(i / g.width) - 32) < 8);
    expect(s.submit({ type: 'necropsy', species: 'rat', x: c % g.width, y: Math.floor(c / g.width) }).ok).toBe(true);
    s.advance(TICKS_PER_DAY);
    for (const k of s.sim.state.necropsies.at(-1)!.found) expect(k.species).toBe(rat);
  });
});
