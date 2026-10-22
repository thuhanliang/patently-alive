import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, speciesLibrary, tools, worldFor, type WorldParams } from '../src/data';
import { scenarioRules, Session, TICKS_PER_DAY, type Rules } from '../src/sim';
import { MAX_SPECIES } from '../src/sim/individuals';
import { FED_SUFFICIENT } from '../src/sim/physiology';
import { TERRAIN } from '../src/sim/terrain';

/** 推演内核审查（2026-10-22）里改了的地方。用 48×48 的小鸟岛。 */
const scenario = scenarioLibrary.get('bird-island-small')!;
const world: WorldParams = worldFor(scenario);
const rules: Rules = { ...scenarioRules(scenario), goal: { ...scenario.goal, years: 1 }, staff: 10, budget: 1e9 };
const config = (w: WorldParams = world) => ({ seed: 3, world: w, species: speciesFor(w), tools });

describe('推演内核审查', () => {
  it('展开时的储备：吃不够的格子给 0（和格子模型一样当天就按缺口挨饿），吃够的给上限的一半', () => {
    // 没有水边食物的世界里放水獭：它们吃不饱。
    const { shore: _, ...dry } = world;
    const s = new Session(config(dry), rules);
    const otter = speciesLibrary.get('otter')!;
    const g = s.sim.state.grid;
    let coast = 0;
    while (!(g.terrain[coast] === TERRAIN.coast && g.island[coast] === 1)) coast++;
    const cx = coast % g.width;
    const cy = Math.floor(coast / g.width);
    expect(s.submit({ type: 'introduce', species: otter, x: cx, y: cy, count: 10 }).ok).toBe(true);
    s.advance(TICKS_PER_DAY * 3);
    const o = s.sim.species.length - 1;
    const x0 = Math.min(32, Math.floor(cx / 8) * 8);
    const y0 = Math.min(32, Math.floor(cy / 8) * 8);
    expect(s.submit({ type: 'setFocus', focus: { x0, y0, x1: x0 + 16, y1: y0 + 16 } }).ok).toBe(true);
    s.advance(1);
    const st = s.sim.state;
    const ind = st.individuals;
    let otters = 0;
    let fedOthers = 0;
    for (let i = 0; i < ind.count; i++) {
      const sp = ind.species[i]!;
      const c = Math.floor(ind.y[i]!) * g.width + Math.floor(ind.x[i]!);
      if (sp === o) {
        otters++;
        expect(st.fedLast[o]![c]!).toBeLessThan(FED_SUFFICIENT);
        expect(ind.reserve[i]).toBe(0);
      } else if (st.fedLast[sp]![c]! >= FED_SUFFICIENT) {
        fedOthers++;
        expect(ind.reserve[i]).toBe(s.sim.species[sp]!.maxReserveDays / 2);
      }
    }
    expect(otters).toBeGreaterThan(0);
    expect(fedOthers).toBeGreaterThan(0);
  });

  it(`一局最多 ${MAX_SPECIES} 个物种（个体的物种下标是 Uint8Array）`, () => {
    expect(MAX_SPECIES).toBe(2 ** 8);
    // 每次引种占一支队伍：给足人手。
    const s = new Session(config(), { ...rules, staff: MAX_SPECIES + 2 });
    const cat = speciesLibrary.get('cat')!;
    const g = s.sim.state.grid;
    let land = 0;
    while (g.terrain[land] === TERRAIN.water) land++;
    const at = { x: land % g.width, y: Math.floor(land / g.width) };
    let k = 0;
    while (s.sim.species.length < MAX_SPECIES) expect(s.submit({ type: 'introduce', species: { ...cat, id: `cat${k++}` }, ...at, count: 1 })).toEqual({ ok: true });
    expect(s.submit({ type: 'introduce', species: { ...cat, id: 'one_more' }, ...at, count: 1 })).toEqual({ ok: false, reason: `一局最多 ${MAX_SPECIES} 个物种，已经满了` });
    // 已经在的物种照样能再引一批。
    expect(s.submit({ type: 'introduce', species: { ...cat, id: 'cat0' }, ...at, count: 1 }).ok).toBe(true);
  }, 120000);
});
