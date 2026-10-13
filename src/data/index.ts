import { WorldParamsSchema, type WorldParams } from './schema/world';
import grasslandJson from './world/grassland.json';

export { WorldParamsSchema, type WorldParams };

/** 阶段 0 的默认世界：一片草原。加载时用 schema 校验。 */
export const grassland: WorldParams = WorldParamsSchema.parse(grasslandJson);
