import { grassland, speciesFor, type WorldParams } from '../src/data';
import { Sim, type SimConfig } from '../src/sim';

/** 测试用的小地图，跑得快；规则和默认草原完全相同。 */
export const smallWorld: WorldParams = { ...grassland, width: 32, height: 24 };

export function makeConfig(seed: number, world: WorldParams = smallWorld): SimConfig {
  return { seed, world, species: speciesFor(world) };
}

export function makeSim(seed: number, world: WorldParams = smallWorld): Sim {
  return Sim.create(makeConfig(seed, world));
}
