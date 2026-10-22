import { WorldParamsSchema, type WorldParams } from './schema/world';
import { GrazingDamageSchema, PlantsFileSchema, type GrazingDamage, type PlantType } from './schema/plant';
import plantsJson from './plants/plants.json';
import damageJson from './plants/damage.json';
import { SpeciesSchema, type SpeciesParams } from './schema/species';
import { GoalSchema, ScenarioSchema, type Goal, type Scenario } from './schema/scenario';
import { ToolsSchema, type Tools } from './schema/tools';
import toolsJson from './tools/tools.json';
import { NecropsyTemplatesSchema, type NecropsyTemplates } from './schema/report';
import necropsyJson from './reports/necropsy.json';
import { ArchiveEntrySchema, type ArchiveEntry } from './schema/archive';
import { ScalingLawsSchema, type ScalingLaws } from './schema/scaling';
import scalingJson from './scaling/laws.json';
import { ViabilityRulesSchema, type ViabilityRules } from './schema/viability';
import viabilityJson from './scaling/viability.json';
import { DesignSchema, HintTemplatesSchema, PartsFileSchema, TemplatesFileSchema, type Design, type HintTemplates, type Part } from './schema/design';
import partsJson from './design/parts.json';
import hintsJson from './design/hints.json';
import templatesJson from './design/templates.json';
import { DentitionFileSchema, type Case } from './schema/case';
import dentitionJson from './cases/dentition.json';

export { WorldParamsSchema, type WorldParams, SpeciesSchema, type SpeciesParams, ScenarioSchema, type Scenario, GoalSchema, type Goal, ToolsSchema, type Tools };

export { NecropsyTemplatesSchema, type NecropsyTemplates, ArchiveEntrySchema, type ArchiveEntry, ScalingLawsSchema, type ScalingLaws };

/** 体重缩放公式（从 PanTHERIA、AnAge 拟合，见 scripts/data/fit-scaling.mjs）。 */
export const scalingLaws: ScalingLaws = ScalingLawsSchema.parse(scalingJson);

/** 身体可行性检查的阈值（阶段 3.5）：每个数带依据、置信度和出处。 */
export const viabilityRules: ViabilityRules = ViabilityRulesSchema.parse(viabilityJson);

/** 尸检报告的模板。 */
export const necropsyTemplates: NecropsyTemplates = NecropsyTemplatesSchema.parse(necropsyJson);

/** 兽医工具的参数。 */
export const tools: Tools = ToolsSchema.parse(toolsJson);

const speciesFiles = import.meta.glob('./species/*.json', { eager: true, import: 'default' });
const worldFiles = import.meta.glob('./world/*.json', { eager: true, import: 'default' });
const scenarioFiles = import.meta.glob('./scenarios/*.json', { eager: true, import: 'default' });
const archiveFiles = import.meta.glob('./archive/*.json', { eager: true, import: 'default' });

/** 文件名（不含目录和 .json）。 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1, -'.json'.length);
}

/** 所有物种数据，加载时用 schema 校验。 */
export const speciesLibrary: ReadonlyMap<string, SpeciesParams> = new Map(
  Object.values(speciesFiles).map((json) => {
    const s = SpeciesSchema.parse(json);
    // 身体的后果（body）只能由设计编译器从性状算出（铁律 5），真实物种的数据不能直接写。
    if (s.body !== undefined) throw new Error(`真实物种 ${s.id} 不能写 body`);
    return [s.id, s] as const;
  }),
);

/**
 * 自然档案馆：所有现有技术，按物种 id 索引，按文件名顺序排列。
 * 每条都必须有能推演的物种数据；反过来，每个物种也都是一条现有技术（真实动物都收在档案馆里）。
 */
export const archiveLibrary: ReadonlyMap<string, ArchiveEntry> = new Map(
  Object.values(archiveFiles).map((json) => {
    const e = ArchiveEntrySchema.parse(json);
    if (!speciesLibrary.has(e.species)) throw new Error(`档案馆条目引用了不存在的物种：${e.species}`);
    return [e.species, e] as const;
  }),
);
for (const id of speciesLibrary.keys()) {
  if (!archiveLibrary.has(id)) throw new Error(`物种 ${id} 没有档案馆条目（src/data/archive/${id}.json）`);
}

/** 植物类型，按 id 索引。 */
export const plantLibrary: ReadonlyMap<string, PlantType> = new Map(PlantsFileSchema.parse(plantsJson).types.map((t) => [t.id, t] as const));

/** 植被被吃坏的规则（阶段 3.5 第 7 步）；世界数据写 "grazingDamage": true 时用这一份。 */
export const grazingDamageRules: GrazingDamage = GrazingDamageSchema.parse(Object.fromEntries(Object.entries(damageJson).filter(([k]) => k !== '说明')));

/**
 * 世界数据里植物写的是类型 id，加载时换成完整的类型数据（配置因此自带植物数据，日志和存档不依赖植物库）。
 * "grazingDamage": true 同样换成完整的规则。
 */
export function resolvePlants(json: unknown, name: string): unknown {
  const w = json as { plants?: Array<{ type: unknown }>; grazingDamage?: unknown };
  if (!Array.isArray(w.plants)) return json;
  if (w.grazingDamage !== undefined && w.grazingDamage !== true) throw new Error(`世界「${name}」的 grazingDamage 只能写 true（规则在 src/data/plants/damage.json）`);
  return {
    ...w,
    ...(w.grazingDamage === true ? { grazingDamage: grazingDamageRules } : {}),
    plants: w.plants.map((p) => {
      // 植物类型只能引用植物库里的 id，不能在世界数据里另写一份。
      if (p === null || typeof p !== 'object' || typeof p.type !== 'string') throw new Error(`世界「${name}」的植物要写成 { "type": "植物类型 id", ... }`);
      const t = plantLibrary.get(p.type);
      if (!t) throw new Error(`世界「${name}」引用了不存在的植物类型：${p.type}`);
      return { ...p, type: t };
    }),
  };
}

/** 所有世界数据，按文件名索引。 */
export const worldLibrary: ReadonlyMap<string, WorldParams> = new Map(
  Object.entries(worldFiles).map(([path, json]) => [baseName(path), WorldParamsSchema.parse(resolvePlants(json, baseName(path)))] as const),
);

/** 牙齿能对付哪些食物（个案动物用）。 */
export const dentitionTypes = DentitionFileSchema.parse(dentitionJson).types;

/** 个案动物的牙齿换成能吃下去的比例（随规则进日志，回放不依赖数据文件）。 */
function resolveCase(c: Case, scenario: string): Case {
  const d = dentitionTypes[c.dentition];
  if (!d) throw new Error(`情景「${scenario}」的个案 ${c.id} 用了不存在的牙齿类型：${c.dentition}`);
  return { ...c, edible: d.edible };
}

/** 所有情景，按 id 索引。 */
export const scenarioLibrary: ReadonlyMap<string, Scenario> = new Map(
  Object.values(scenarioFiles).map((json) => {
    const s = ScenarioSchema.parse(json);
    return [s.id, s.cases ? { ...s, cases: s.cases.map((c) => resolveCase(c, s.id)) } : s] as const;
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

export { DesignSchema, type Design, type Part, type HintTemplates };

const partsFile = PartsFileSchema.parse(partsJson);
/** 设计台的槽位（看得见的身体部件、看不见的性状），按显示顺序。 */
export const designSlots = partsFile.slots;
/** 设计台的部件，按 id 索引，按文件里的顺序。 */
export const partLibrary: ReadonlyMap<string, Part> = new Map(partsFile.parts.map((p) => [p.id, p] as const));
/** 设计台提醒的模板。 */
export const hintTemplates: HintTemplates = HintTemplatesSchema.parse(hintsJson);
/** 现有技术写成的设计：设计台的起点，也是设计编译器的回归测试。 */
export const designTemplates: ReadonlyArray<{ species: string; design: Design }> = TemplatesFileSchema.parse(templatesJson).templates;
for (const t of designTemplates) {
  if (!speciesLibrary.has(t.species)) throw new Error(`设计模板引用了不存在的物种：${t.species}`);
  for (const [slot, id] of Object.entries(t.design.parts)) {
    if (partLibrary.get(id)?.slot !== slot) throw new Error(`设计模板 ${t.species} 的 ${slot} 槽用了不存在或不属于这个槽的部件：${id}`);
  }
}
