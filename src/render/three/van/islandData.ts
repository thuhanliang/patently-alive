import { scenarioLibrary, speciesFor, tools, worldFor } from '../../../data';
import { createInitialState, herbIndex, woodyIndex } from '../../../sim';
import { reliefField, type ReliefField } from '../relief';
import type { IslandInput } from '../vegetation';

/** 一个情景第 0 天的岛：画面要的地形和植被（工作台托盘、全屏地图共用）。 */
export function islandOf(id: string): { field: ReliefField; input: IslandInput; name: string } {
  const scenario = scenarioLibrary.get(id) ?? scenarioLibrary.get('garden-island')!;
  const world = worldFor(scenario);
  const state = createInitialState({ seed: scenario.seed, world, species: speciesFor(world), tools });
  const g = state.grid;
  const hi = herbIndex(world);
  const wi = woodyIndex(world);
  const n = g.width * g.height;
  const herb = new Float64Array(n);
  const shrub = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const hp = world.plants[hi];
    if (hp) herb[i] = g.plants[hi]![i]! / Math.max(1, hp.maxBiomass * g.fertility[i]!);
    const wp = wi >= 0 ? world.plants[wi] : undefined;
    if (wp) shrub[i] = g.plants[wi]![i]! / Math.max(1, wp.maxBiomass);
  }
  const input = { width: g.width, height: g.height, terrain: g.terrain, herb, shrub, seed: scenario.seed };
  return { field: reliefField(input), input, name: scenario.name };
}
