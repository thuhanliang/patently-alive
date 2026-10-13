import { WorldParamsSchema, type WorldParams } from './schema/world';
import { SpeciesSchema, type SpeciesParams } from './schema/species';
import grasslandJson from './world/grassland.json';

export { WorldParamsSchema, type WorldParams, SpeciesSchema, type SpeciesParams };

const speciesFiles = import.meta.glob('./species/*.json', { eager: true, import: 'default' });

/** 所有物种数据，加载时用 schema 校验。 */
export const speciesLibrary: ReadonlyMap<string, SpeciesParams> = new Map(
  Object.values(speciesFiles).map((json) => {
    const s = SpeciesSchema.parse(json);
    return [s.id, s] as const;
  }),
);

/** 按世界里列出的 id 取物种，顺序保持一致。缺了就报错。 */
export function speciesFor(world: WorldParams): SpeciesParams[] {
  return world.species.map((id) => {
    const s = speciesLibrary.get(id);
    if (!s) throw new Error(`世界「${world.name}」引用了不存在的物种：${id}`);
    return s;
  });
}

/** 阶段 0 的默认世界：一片草原。 */
export const grassland: WorldParams = WorldParamsSchema.parse(grasslandJson);
export const grasslandSpecies: SpeciesParams[] = speciesFor(grassland);
