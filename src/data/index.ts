import { WorldParamsSchema, type WorldParams } from './schema/world';
import { SpeciesSchema, type SpeciesParams } from './schema/species';
import { GoalSchema, ScenarioSchema, type Goal, type Scenario } from './schema/scenario';
import { ToolsSchema, type Tools } from './schema/tools';
import toolsJson from './tools/tools.json';
import { NecropsyTemplatesSchema, type NecropsyTemplates } from './schema/report';
import necropsyJson from './reports/necropsy.json';

export { WorldParamsSchema, type WorldParams, SpeciesSchema, type SpeciesParams, ScenarioSchema, type Scenario, GoalSchema, type Goal, ToolsSchema, type Tools };

export { NecropsyTemplatesSchema, type NecropsyTemplates };

/** 尸检报告的模板。 */
export const necropsyTemplates: NecropsyTemplates = NecropsyTemplatesSchema.parse(necropsyJson);

/** 兽医工具的参数。 */
export const tools: Tools = ToolsSchema.parse(toolsJson);

const speciesFiles = import.meta.glob('./species/*.json', { eager: true, import: 'default' });
const worldFiles = import.meta.glob('./world/*.json', { eager: true, import: 'default' });
const scenarioFiles = import.meta.glob('./scenarios/*.json', { eager: true, import: 'default' });

/** 文件名（不含目录和 .json）。 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
}

/** 所有物种数据，加载时用 schema 校验。 */
export const speciesLibrary: ReadonlyMap<string, SpeciesParams> = new Map(
  Object.values(speciesFiles).map((json) => {
    const s = SpeciesSchema.parse(json);
    return [s.id, s] as const;
  }),
);

/** 所有世界数据，按文件名索引。 */
export const worldLibrary: ReadonlyMap<string, WorldParams> = new Map(
  Object.entries(worldFiles).map(([path, json]) => [baseName(path), WorldParamsSchema.parse(json)] as const),
);

/** 所有情景，按 id 索引。 */
export const scenarioLibrary: ReadonlyMap<string, Scenario> = new Map(
  Object.values(scenarioFiles).map((json) => {
    const s = ScenarioSchema.parse(json);
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

/** 情景引用的世界。缺了就报错。 */
export function worldFor(scenario: Scenario): WorldParams {
  const w = worldLibrary.get(scenario.world);
  if (!w) throw new Error(`情景「${scenario.name}」引用了不存在的世界：${scenario.world}`);
  return w;
}

/** 阶段 0 的草原。 */
export const grassland: WorldParams = worldLibrary.get('grassland')!;
export const grasslandSpecies: SpeciesParams[] = speciesFor(grassland);
