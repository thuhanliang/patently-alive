import { describe, expect, it } from 'vitest';
import { scenarioLibrary, speciesFor, worldFor, type WorldParams } from '../src/data';
import { Session, Sim, TICKS_PER_DAY, checksum, countAt } from '../src/sim';
import { createGrid } from '../src/sim/grid';
import { Rng } from '../src/sim/rng';
import { TERRAIN } from '../src/sim/terrain';
import { pathBlocked } from '../src/sim/fence';

const island: WorldParams = worldFor(scenarioLibrary.get('bird-island')!);
/** 测试用的小岛：同样的参数，地图小一些。 */
const smallIsland: WorldParams = {
  ...island,
  width: 64,
  height: 64,
  terrain: { ...island.terrain!, islets: { count: 2, minRadius: 3, maxRadius: 4, minGapCells: 6 } },
};

function components(terrain: Uint8Array, width: number, height: number): number[] {
  const seen = new Uint8Array(terrain.length);
  const sizes: number[] = [];
  for (let s = 0; s < terrain.length; s++) {
    if (terrain[s] === TERRAIN.water || seen[s]) continue;
    let size = 0;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % width;
      const y = (i - x) / width;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        const j = ny * width + nx;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && terrain[j] !== TERRAIN.water && !seen[j]) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

describe('海岛地形', () => {
  it('同一个种子生成同一张图，换种子换一张', () => {
    const a = createGrid(island, Rng.fromSeed(7));
    const b = createGrid(island, Rng.fromSeed(7));
    const c = createGrid(island, Rng.fromSeed(8));
    expect(checksum(a)).toBe(checksum(b));
    expect(checksum(a)).not.toBe(checksum(c));
  });

  it('一座主岛加几座离岸小岛；四种地形都有', () => {
    for (const seed of [1, 2, 3]) {
      const g = createGrid(island, Rng.fromSeed(seed));
      const sizes = components(g.terrain, g.width, g.height);
      expect(sizes.length).toBe(1 + island.terrain!.islets.count);
      // 主岛远大于小岛（小岛是离岸的鸟类避难所，单座最多主岛的十分之一左右）。
      expect(sizes[0]!).toBeGreaterThan(10 * sizes[1]!);
      const counts = [0, 0, 0, 0];
      for (const t of g.terrain) counts[t]! += 1;
      expect(counts.every((n) => n > 0)).toBe(true);
    }
  });

  it('海岸挨着水，内陆不挨水', () => {
    const g = createGrid(island, Rng.fromSeed(1));
    const { width, height, terrain } = g;
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const t = terrain[y * width + x]!;
        if (t === TERRAIN.water) continue;
        let wet = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (terrain[(y + dy) * width + x + dx] === TERRAIN.water) wet = true;
        expect(wet).toBe(t === TERRAIN.coast);
      }
    }
  });

  it('水里没有植被、不长植被', () => {
    const sim = Sim.create({ seed: 3, world: smallIsland, species: speciesFor(smallIsland) });
    sim.stepN(TICKS_PER_DAY * 60);
    const { terrain, plants } = sim.state.grid;
    for (let i = 0; i < terrain.length; i++) if (terrain[i] === TERRAIN.water) for (const b of plants) expect(b[i]).toBe(0);
  });

  it('动物开局只在陆地上，扩散、展开成个体之后也不进水', () => {
    const sim = Sim.create({ seed: 4, world: smallIsland, species: speciesFor(smallIsland) });
    // 关注区放在海岸一带，个体会碰到水边。
    sim.setFocus({ x0: 0, y0: 24, x1: 32, y1: 56 });
    const wetAnimals = (): number => {
      const { terrain, width } = sim.state.grid;
      let n = 0;
      for (let i = 0; i < terrain.length; i++) {
        if (terrain[i] !== TERRAIN.water) continue;
        for (const p of sim.state.populations) n += countAt(p, i);
        for (const p of sim.state.emigrants) n += countAt(p, i);
      }
      const ind = sim.state.individuals;
      for (let k = 0; k < ind.count; k++) if (terrain[Math.floor(ind.y[k]!) * width + Math.floor(ind.x[k]!)] === TERRAIN.water) n += 1;
      return n;
    };
    expect(wetAnimals()).toBe(0);
    for (let d = 0; d < 40; d++) {
      sim.stepN(TICKS_PER_DAY);
      expect(wetAnimals()).toBe(0);
    }
    expect(sim.state.individuals.count).toBeGreaterThan(0);
  });

  it('不能把动物投放到水里', () => {
    const session = new Session({ seed: 5, world: smallIsland, species: speciesFor(smallIsland) });
    const r = session.submit({ type: 'release', species: smallIsland.species[0]!, x: 0, y: 0, count: 5 });
    expect(r.ok).toBe(false);
    expect(session.entries.length).toBe(0);
  });
});

describe('过水判定', () => {
  // 5×1 的一行：陆 陆 水 陆 陆。
  const terrain = Uint8Array.from([2, 2, 0, 2, 2]);
  it('路上有水就算过水，哪怕落点是陆地', () => {
    expect(pathBlocked(terrain, null, 5, 0.5, 0.5, 4.5, 0.5)).toBe(true);
    expect(pathBlocked(terrain, null, 5, 3.5, 0.5, 4.5, 0.5)).toBe(false);
    expect(pathBlocked(terrain, null, 5, 0.2, 0.5, 1.9, 0.5)).toBe(false);
  });

  it('格子扩散过不了水：清空一座离岸小岛后，没有动物能扩散上去', () => {
    const sim = Sim.create({ seed: 6, world: smallIsland, species: speciesFor(smallIsland) });
    const st = sim.snapshot();
    // 找到最小的一块陆地（离岸小岛），把上面的动物清空。
    const { terrain: t, width, height } = st.grid;
    const label = new Int32Array(t.length).fill(-1);
    const sizes: number[] = [];
    for (let s = 0; s < t.length; s++) {
      if (t[s] === TERRAIN.water || label[s] !== -1) continue;
      const id = sizes.length;
      let n = 0;
      const stack = [s];
      label[s] = id;
      while (stack.length) {
        const i = stack.pop()!;
        n++;
        const x = i % width;
        const y = (i - x) / width;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = (y + dy) * width + x + dx;
          if (x + dx >= 0 && y + dy >= 0 && x + dx < width && y + dy < height && t[j] !== TERRAIN.water && label[j] === -1) {
            label[j] = id;
            stack.push(j);
          }
        }
      }
      sizes.push(n);
    }
    const islet = sizes.indexOf(Math.min(...sizes));
    for (const p of st.populations) for (let i = 0; i < t.length; i++) if (label[i] === islet) {
      p.adults[i] = 0;
      for (const j of p.juveniles) j[i] = 0;
    }
    const cleared = new Sim(st);
    cleared.stepN(TICKS_PER_DAY * 120);
    let onIslet = 0;
    for (const p of cleared.state.populations) for (let i = 0; i < t.length; i++) if (label[i] === islet) onIslet += countAt(p, i);
    expect(onIslet).toBe(0);
  });
});
