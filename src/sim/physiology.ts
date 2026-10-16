import type { GrazingDamage, PlantType } from '../data/schema/plant';
import { grazingResidual } from './grid';
import type { SpeciesParams } from '../data/schema/species';
import { detPow } from './detmath';
import { plantYield } from './viability';
import { DAYS_PER_MONTH, DAYS_PER_YEAR } from './time';

/**
 * 从性状推导模拟参数。这里的公式就是引擎的"规律层"：
 * 物种数据只给性状，吃多少、谁吃谁、饿多久会死，全在这里算（铁律 4、5）。
 */

/** 食草动物每天的干物质摄入量（克）≈ 70 · M^0.75（M 为千克），即代谢体重缩放。 */
const HERBIVORE_INTAKE_COEF = 70;
/** 食肉动物每天需要的猎物鲜重（克）≈ 230 · M^0.75。白鼬约 80 克，接近体重的三分之一。 */
const CARNIVORE_INTAKE_COEF = 230;
/**
 * 吃无脊椎动物每天需要的鲜重（克）≈ 300 · M^0.75。60 克的鸻约 36 克，约为体重的六成
 * （小型涉禽每天吃掉体重一半左右的无脊椎动物，鸟的代谢比同体重的哺乳动物高）。
 */
const INVERTEBRATE_INTAKE_COEF = 300;
/** 脊椎动物在食谱里占到这个比例以上，才算会追捕会跑的猎物的"捕食者"；以下的（例如鼠）只吃跑不掉的：蛋、雏鸟、窝里的幼崽。 */
export const PURSUIT_DIET_SHARE = 0.5;
/** 会飞的猎物（成体、出了窝的幼体）被捕食者碰上时，只有这个比例来不及飞走。 */
export const FLIGHT_ESCAPE = 0.45;
/**
 * 窝是藏起来的：捕食者走到窝边（CATCH_RADIUS_CELLS 以内）时，只有这个比例会发现它（乘在 nest 权重上）。
 * 窝被找到的概率随捕食者的密度上升（见 nestSearchCells）：鼠少的地方窝能熬过巢期，鼠多的地方很难。
 */
export const NEST_DISCOVERY = 0.055;
/** 洞穴、巢穴里的幼崽，比放在外面难找到这么多（乘在被抓的概率上）。 */
export const BURROW_EXPOSURE = 0.3;
/** 地面浅窝：掩护（0–1）最好时，被发现的概率降低这么多。 */
export const COVER_PROTECTION = 0.6;
/**
 * 有木本的格子里，吃植物的动物有这么多的植物食量来自木本（嫩枝、幼苗、草丛底部），其余吃草本；
 * 草本不够时也拿木本补。这是引擎规则；各种植物每天最多被吃掉多少写在植物类型的数据里（src/data/plants）。灌丛长得慢，兔子多了掩护就慢慢被啃薄（见 docs/MODEL.md）。
 */
export const BROWSE_SHARE = 0.25;
/** 完全吃不到东西时每天的饿死概率 ≈ 0.12 · M^−0.25：越小的动物撑得越短。 */
const STARVATION_COEF = 0.12;
/** 吃到需求的这个比例就不会挨饿；低于它时饿死概率随缺口线性上升。 */
export const FED_SUFFICIENT = 0.6;
/**
 * Damuth 定律：哺乳动物的典型种群密度 ≈ 10^4.23 · M^−0.75 只 / 平方公里（M 为克）。
 * 局部密度超过典型密度的 CROWDING_FACTOR 倍时就不再繁殖（领地、社会压制），
 * 之间线性下降。这是引擎规律，物种数据里只有体重。
 */
const DAMUTH_COEF = 16982;
const CROWDING_FACTOR = 20;
/** 拥挤程度按多大的区块统计（格）。动物会在几格之间走动，单格计数太跳。 */
export const CROWDING_BLOCK_CELLS = 8;
/** 有领地的物种，同一块地上能重叠几个家域（见 crowdingPerKm2）。 */
export const TERRITORY_OVERLAP = 2;
/**
 * 不守固定领地的食肉动物，领地里要有几天食量的猎物才算"有地方住"（见 crowdingByBlock）。
 * 量级按 PanTHERIA 推算：田鼠平均密度 19.5 只/公顷时，伶鼬家域（0.07 平方公里）里约有 120 天的食量，两只共享约 60 天。
 * 取 60 时伶鼬被压得太稳、田鼠没有多年周期；调到 15，出现约 6 年的田鼠–伶鼬周期且不灭绝（见 docs/MODEL.md）。
 */
export const PREY_STOCK_DAYS = 15;
/**
 * 幼体的"传送带"：格子里的幼体分成几个年龄段，每个物种每隔 stageDays 天（性成熟天数 ÷ 段数）
 * 整体往前挪一段，最后一段并入成体。挪段只是交换数组，不用抽随机数。
 * stageDays = ⌊性成熟天数 / 段数⌋，成熟时间落在 (段数−1)·stageDays+1 到 段数·stageDays 天之间，
 * 不晚于性状给的性成熟年龄；个体用同一条规则判断是否成年
 * （见 juvenileStageAt），所以展开、收拢严格对得上。
 */
export const JUVENILE_STAGES = 4;
/** 前这么多个年龄段的幼体还在窝里、跟着母亲，不自己扩散（个体里对应年龄不到性成熟一半的幼崽不走动）。 */
export const NEST_STAGES = JUVENILE_STAGES / 2;
/**
 * 写了窝里天数（nestDays）的物种：每段约 窝里天数 / 1.5 天（段数夹在 2–8 之间），前两段左右算在窝里。
 * 传送带对所有个体同一天挪段，新生的在第一段里平均只待半段；所以窝里的段数取
 * round(窝里天数 / 每段天数 + 0.5)，平均在窝里的时间 ≈ (窝里段数 − 0.5) × 每段天数 ≈ 窝里天数。
 * 例如鸻：每段 45 天、8 段，前 2 段在窝里，平均 67 天（孵化 + 出飞约 61 天）。
 */
const MIN_STAGES = 2;
const MAX_STAGES = 8;
/** 幼体按成体的这个比例算食量和体重（从刚出生到长成的平均）。 */
export const JUVENILE_SIZE_FACTOR = 0.5;
/** 幼体的基础日死亡率是成体的几倍。 */
const JUVENILE_MORTALITY_FACTOR = 2.5;
/** 食肉动物的半饱和系数（天）：格子里的可捕猎物够它们吃这么多天时，捕获率达到一半。 */
export const PREDATION_HALF_SATURATION_DAYS = 0.5;
/** 扩散一跳的最大格数，限制计算量。 */
const MAX_MOVE_RADIUS = 8;

/** 个体的体内储备上限（够吃几天）≈ 2 · M^0.25：大动物撑得久。 */
const RESERVE_COEF = 2;
/** 捕食者在这个距离（格）内碰上活动中的猎物才有机会抓。 */
export const CATCH_RADIUS_CELLS = 0.3;
/** 碰上之后、体型完全合适时的捕获成功率。 */
export const CATCH_SUCCESS = 0.3;
/** 吃够当天需求的这么多倍就不再捕猎（和格子模型一致：吃饱为止）。 */
export const SATIATION = 1;

export interface DerivedSpecies {
  readonly params: SpeciesParams;
  /** 吃植被（食谱里有植物）。 */
  readonly grazer: boolean;
  /** 吃脊椎动物（食谱里有脊椎动物）。 */
  readonly predator: boolean;
  /** 以脊椎动物为主（≥ PURSUIT_DIET_SHARE）：会追捕会跑的猎物；领地按猎物多少伸缩；被更大的捕食者盯上时会还手。 */
  readonly carnivore: boolean;
  /** 吃无脊椎动物。 */
  readonly insectivore: boolean;
  readonly bodyMassG: number;
  /**
   * 每天对三类食物的需求，已乘上食谱比例：植物为干物质克数，脊椎动物、无脊椎动物为鲜重克数。
   * 吃饱程度 = Σ 比例 × 这一类吃到的份额（见 population 的 combineFed）。
   */
  readonly plantIntakeG: number;
  readonly vertebrateIntakeG: number;
  readonly invertebrateIntakeG: number;
  /** 幼体分几段、前几段在窝里。 */
  readonly juvenileStages: number;
  readonly nestStages: number;
  /** 窝的类型；null 表示没写（阶段 0 的物种，窝里的幼体和别的幼体一样容易被抓）。 */
  readonly nest: 'ground' | 'burrow' | null;
  readonly flies: boolean;
  readonly adultDailyMortality: number;
  readonly juvenileDailyMortality: number;
  readonly starvationRate: number;
  /** 幼体传送带每隔几天挪一段。 */
  readonly stageDays: number;
  /** 繁殖期内每只雌性每天产一窝的概率。 */
  readonly litterRate: number;
  /** 平均每格住到这么多只就不再繁殖（按区块统计）。 */
  readonly crowdingCapacity: number;
  /**
   * 拥挤程度在周围几圈区块里一起算（0 = 只看自己的区块）。家域比一个区块大得多的物种（野猫约 1.4 平方公里，
   * 一个区块 0.16 平方公里），一只就"占满"一个区块，得按家域那么大的范围统计。
   */
  readonly crowdingRadiusBlocks: number;
  /** 每天离开所在格子的概率，以及一跳的最大格数。 */
  readonly moveProb: number;
  readonly moveRadius: number;
  /** 个体：活动时每小时走多远（格）。 */
  readonly hourlyStepCells: number;
  /** 个体：一天里活动的小时数。 */
  readonly activeHours: number;
  /**
   * 一只捕食者一天里"仔细搜过"的面积（格）= 走过的路 × 发现半径的两倍 × 碰上后的成功率，和个体模型的捕猎一致。
   * 格子模型里窝里幼体被找到的概率 = 1 − exp(−捕食者每格只数 × 这个面积 × 窝权重)：捕食者越密，窝越难藏。
   */
  readonly nestSearchCells: number;
  /** 个体：体内储备上限（天）。 */
  readonly maxReserveDays: number;
  readonly maxAgeDays: number;
  /** 守固定领地：拥挤上限按领地算，见 breedingRoom。 */
  readonly territorial: boolean;
  /** 奔跑能力（阶段 3.5，骨骼撑不住的设计小于 1）：见 chaseFactor。 */
  readonly runFactor: number;
  /** 每天承重骨折的概率（阶段 3.5）。 */
  readonly fractureDaily: number;
  /** 生下来（孵出来）的幼体活下来的比例（阶段 3.5，繁殖撑不住的设计小于 1）。 */
  readonly neonateSurvival: number;
  /** 每生一窝母亲难产死亡的概率（阶段 3.5）。 */
  readonly dystociaPerLitter: number;
  /**
   * 吃各种植物（顺序同 world.plants）时，消化得到的能量占需求的比例（0–1，阶段 3.5 消化检查）。
   * 真实物种、或者每种植物都消化得够的，是 null：推演走原来的算法，不多算、不多抽随机数。
   */
  readonly plantValue: readonly number[] | null;
  /** 草本被啃到的最低量 ÷ 世界写的下限（阶段 3.5 第 7 步，吃坏打开时按体型；关着时为 1）。 */
  readonly herbResidual: number;
}

/** 推导物种要看的世界：植物（消化检查）和吃坏的规则（残留）。 */
export type DeriveWorld = { readonly plants: readonly { type: Pick<PlantType, 'soluble'> }[]; readonly grazingDamage?: GrazingDamage | undefined };

/** 消化道吃这个世界的各种植物能取出的能量比例；全都够（或者没写消化道）时为 null。 */
export function plantValues(p: SpeciesParams, plants: readonly { type: Pick<PlantType, 'soluble'> }[] | undefined): readonly number[] | null {
  const gut = p.body?.gut;
  if (!gut || !plants || p.diet.plant === 0) return null;
  const v = plants.map((w) => Math.min(1, plantYield(gut, w.type)));
  return v.every((x) => x >= 1) ? null : v;
}

/**
 * 繁殖期内每只雌性每天产一窝的概率：繁殖季里每隔一个间隔一窝，繁殖季比间隔还短也有一窝。
 * 间隔超过一年（阶段 3.5 起，大型动物几年才生一窝）：一年平均 365 / 间隔 窝，摊在繁殖季里。
 * 真实物种的间隔都不超过一年，走的是原来的式子。
 */
export function litterRate(intervalDays: number, breedingDays: number): number {
  if (breedingDays <= 0) return 0;
  if (intervalDays > DAYS_PER_YEAR) return DAYS_PER_YEAR / intervalDays / breedingDays;
  return 1 / Math.min(intervalDays, breedingDays);
}

/**
 * 追捕会跑的猎物时，奔跑能力对捕获率的影响（阶段 3.5）：捕食者跑不动就少抓到，猎物跑不动就多被抓（被抓的概率乘 2 − 奔跑能力）。
 * 会飞的猎物靠飞逃（FLIGHT_ESCAPE），腿骨不影响它逃不逃得掉。
 * 两边都能跑时正好是 1，真实物种的结果不变。只用于会跑的猎物，窝里的不算。
 */
export function chaseFactor(pred: DerivedSpecies, prey: DerivedSpecies): number {
  return pred.runFactor * (prey.flies ? 1 : 2 - prey.runFactor);
}

/**
 * 每平方公里最多挤多少只（超过就不再繁殖）。
 * 守固定领地的：领地占满为止，同一块地上允许 TERRITORY_OVERLAP 只（雌雄领地重叠）；
 * 其余按 Damuth 定律的典型密度 × CROWDING_FACTOR。取两者中小的。
 */
function crowdingPerKm2(p: SpeciesParams, typicalPerKm2: number): number {
  const byMass = typicalPerKm2 * CROWDING_FACTOR;
  const home = p.movement.homeRangeKm2;
  return home !== undefined ? Math.min(byMass, TERRITORY_OVERLAP / home) : byMass;
}

/**
 * world：这个世界的植物（消化检查和它比）和吃坏的规则；不给就当作什么植物都消化得够、植被不会被吃坏（只看推演规律的测试）。
 */
export function deriveSpecies(p: SpeciesParams, cellSizeM: number, world?: DeriveWorld): DerivedSpecies {
  // 胃口（设计物种的能量收支）乘在代谢体重上：三类食物的需求一起放大或缩小。
  const metabolicMass = detPow(p.bodyMassKg, 0.75) * (p.energyFactor ?? 1);
  const { juvenileStages, nestStages, stageDays } = conveyor(p);
  const adultDailyMortality = 1 - detPow(p.survival.adultAnnual, 1 / DAYS_PER_YEAR);
  // 骨骼撑不住的设计走得慢（阶段 3.5）：活动范围、扩散、搜窝都跟着缩。
  const cellsPerDay = (p.movement.dailyRangeM * (p.body?.walkFactor ?? 1)) / cellSizeM;
  // 最长一段连续繁殖期的天数；它比两窝间隔还短时，每段繁殖期只够生一窝。
  const breedingDays = longestSeasonDays(p.reproduction.breedingByMonth);
  const typicalPerKm2 = DAMUTH_COEF * detPow(p.bodyMassKg * 1000, -0.75);
  const plantValue = plantValues(p, world?.plants);
  const cellKm2 = (cellSizeM * cellSizeM) / 1_000_000;
  return {
    params: p,
    grazer: p.diet.plant > 0,
    predator: p.diet.vertebrate > 0,
    carnivore: p.diet.vertebrate >= PURSUIT_DIET_SHARE,
    insectivore: p.diet.invertebrate > 0,
    bodyMassG: p.bodyMassKg * 1000,
    // 消化道对付不了这里植物的设计（阶段 3.5）：塞满肠子为止，一天吃 capacity 倍同体重真实食草动物的量（再多也过不去）。
    plantIntakeG: p.diet.plant * HERBIVORE_INTAKE_COEF * (plantValue && p.body?.gut ? detPow(p.bodyMassKg, 0.75) * p.body.gut.capacity : metabolicMass),
    vertebrateIntakeG: p.diet.vertebrate * CARNIVORE_INTAKE_COEF * metabolicMass,
    invertebrateIntakeG: p.diet.invertebrate * INVERTEBRATE_INTAKE_COEF * metabolicMass,
    juvenileStages,
    nestStages,
    nest: p.reproduction.nest ?? null,
    flies: p.movement.flies === true,
    adultDailyMortality,
    juvenileDailyMortality: Math.min(1, adultDailyMortality * JUVENILE_MORTALITY_FACTOR),
    starvationRate: Math.min(1, STARVATION_COEF * detPow(p.bodyMassKg, -0.25)),
    stageDays,
    litterRate: litterRate(p.reproduction.litterIntervalDays, breedingDays),
    crowdingCapacity: crowdingPerKm2(p, typicalPerKm2) * cellKm2,
    crowdingRadiusBlocks: crowdingRadius(p, cellSizeM),
    moveProb: Math.min(0.5, cellsPerDay / 2),
    moveRadius: Math.max(1, Math.min(MAX_MOVE_RADIUS, Math.round(cellsPerDay / 2))),
    hourlyStepCells: cellsPerDay / activeHoursPerDay(p.activity),
    activeHours: activeHoursPerDay(p.activity),
    nestSearchCells: 2 * CATCH_RADIUS_CELLS * cellsPerDay * CATCH_SUCCESS,
    maxReserveDays: RESERVE_COEF * detPow(p.bodyMassKg, 0.25),
    maxAgeDays: Math.round(p.maxLifespanYears * DAYS_PER_YEAR),
    territorial: p.movement.territorial === true && p.movement.homeRangeKm2 !== undefined,
    runFactor: p.body?.runFactor ?? 1,
    fractureDaily: p.body?.fractureDaily ?? 0,
    neonateSurvival: p.body?.neonateSurvival ?? 1,
    dystociaPerLitter: p.body?.dystociaPerLitter ?? 0,
    plantValue,
    herbResidual: world?.grazingDamage ? grazingResidual(p.bodyMassKg, world.grazingDamage) : 1,
  };
}

/**
 * 家域边长折合几个区块，取 (边长 / 区块边长 − 1) / 2 向上取整：窗口 (2r+1)² 个区块不小于家域。
 * 向下取的话，家域比一个区块大一点的物种（例如 0.5 平方公里）窗口只有一个区块，按领地算一个区块住不下一只，
 * 一只就"住满"，再也不繁殖。
 */
function crowdingRadius(p: SpeciesParams, cellSizeM: number): number {
  const home = p.movement.homeRangeKm2;
  if (home === undefined) return 0;
  const blockKm = (CROWDING_BLOCK_CELLS * cellSizeM) / 1000;
  // 减一个极小量：边长正好是奇数个区块时，浮点误差不会把窗口多算一圈。
  return Math.max(0, Math.ceil((Math.sqrt(home) / blockKm - 1) / 2 - 1e-9));
}

/** 幼体传送带的段数、窝里的段数、每段天数（见 JUVENILE_STAGES、MIN_STAGES）。 */
function conveyor(p: SpeciesParams): { juvenileStages: number; nestStages: number; stageDays: number } {
  const maturity = p.reproduction.ageAtMaturityDays;
  const nestDays = p.reproduction.nestDays;
  if (nestDays === undefined) {
    return { juvenileStages: JUVENILE_STAGES, nestStages: NEST_STAGES, stageDays: Math.max(1, Math.floor(maturity / JUVENILE_STAGES)) };
  }
  const juvenileStages = Math.min(MAX_STAGES, Math.max(MIN_STAGES, Math.round(maturity / (nestDays / 1.5))));
  const stageDays = Math.max(1, Math.floor(maturity / juvenileStages));
  const nestStages = Math.min(juvenileStages - 1, Math.max(1, Math.round(nestDays / stageDays + 0.5)));
  return { juvenileStages, nestStages, stageDays };
}

/** 最长一段连续（跨年也算连续）繁殖期的天数，按各月比例累加。 */
function longestSeasonDays(byMonth: readonly number[]): number {
  if (byMonth.every((m) => m > 0)) return byMonth.reduce((a, b) => a + b, 0) * DAYS_PER_MONTH;
  let best = 0;
  let run = 0;
  // 走两圈，处理跨年的繁殖期。
  for (let i = 0; i < byMonth.length * 2; i++) {
    const m = byMonth[i % byMonth.length]!;
    run = m > 0 ? run + m : 0;
    if (run > best) best = run;
  }
  return best * DAYS_PER_MONTH;
}

/** 由配置推导全部物种参数和捕食矩阵；状态初始化和推演都用这一处，保证一致。 */
export function deriveAll(species: readonly SpeciesParams[], cellSizeM: number, world?: DeriveWorld): {
  derived: DerivedSpecies[];
  prey: PreyWeights;
} {
  const derived = species.map((s) => deriveSpecies(s, cellSizeM, world));
  return { derived, prey: preyMatrix(derived) };
}

/**
 * 第 born 天出生的个体，到第 day 天时在传送带上的哪一段：0..JUVENILE_STAGES−1 是幼体，
 * JUVENILE_STAGES 表示已成年。等于它出生以来传送带挪过几次
 * （每个 day % stageDays === 0 的日子挪一次，在那天的出生之前挪）。
 * day 指"传送带最近一次可能挪段的那一天"，即最近一次每日结算所在的天（见 Sim.day）。
 */
export function juvenileStageAt(sp: Pick<DerivedSpecies, 'stageDays' | 'juvenileStages'>, born: number, day: number): number {
  const shifts = Math.floor(day / sp.stageDays) - Math.floor(born / sp.stageDays);
  return Math.min(sp.juvenileStages, shifts);
}

type Activity = SpeciesParams['activity'];

/**
 * 各活动时段在一天 24 小时里哪些小时活动（个体用）。
 * 昼行 6–17 时；夜行 18–5 时；晨昏 4–7 时和 17–20 时；全天型全天都可能活动。
 */
const ACTIVE_HOURS: Record<Activity, readonly boolean[]> = {
  diurnal: hoursMask((h) => h >= 6 && h < 18),
  nocturnal: hoursMask((h) => h >= 18 || h < 6),
  crepuscular: hoursMask((h) => (h >= 4 && h < 8) || (h >= 17 && h < 21)),
  cathemeral: hoursMask(() => true),
};

function hoursMask(f: (h: number) => boolean): boolean[] {
  return Array.from({ length: 24 }, (_, h) => f(h));
}

export function isActive(activity: Activity, hour: number): boolean {
  return ACTIVE_HOURS[activity][hour]!;
}

export function activeHoursPerDay(activity: Activity): number {
  return ACTIVE_HOURS[activity].filter(Boolean).length;
}

const ACTIVITY_INDEX: Record<Activity, number> = { diurnal: 0, nocturnal: 1, crepuscular: 2, cathemeral: 3 };
/** 两种活动时段碰上的程度（对称）。晨昏型和昼行、夜行都有一半重叠。 */
const ACTIVITY_OVERLAP = [
  [1.0, 0.1, 0.5, 0.6],
  [0.1, 1.0, 0.5, 0.6],
  [0.5, 0.5, 1.0, 0.6],
  [0.6, 0.6, 0.6, 0.8],
];

export function activityOverlap(a: Activity, b: Activity): number {
  return ACTIVITY_OVERLAP[ACTIVITY_INDEX[a]]![ACTIVITY_INDEX[b]]!;
}

/**
 * 体型适合度：猎物体重 / 捕食者体重之比 → [0, 1]。
 * 太小不值得抓；比自己大得越多越难抓，到 12 倍就抓不动了。分段线性。
 */
const SIZE_RATIO_POINTS: Array<[number, number]> = [
  [0.005, 0],
  [0.02, 0.5],
  [0.05, 1],
  [0.5, 1],
  [1, 0.7],
  // 鼬科能放倒比自己重好几倍的猎物：兔子（约为白鼬体重的 6 倍）是英国、新西兰白鼬的主要猎物。
  [3, 0.5],
  [8, 0.15],
  [12, 0],
];

export function sizeSuitability(preyToPredatorMass: number): number {
  const pts = SIZE_RATIO_POINTS;
  if (preyToPredatorMass <= pts[0]![0]) return pts[0]![1];
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i]!;
    if (preyToPredatorMass <= x1) {
      const [x0, y0] = pts[i - 1]!;
      return y0 + ((y1 - y0) * (preyToPredatorMass - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1]![1];
}

/**
 * 捕食权重（捕食者 × 猎物，通常在 [0, 1]），分两种：
 * - mobile：会跑的猎物（成体、出了窝的幼体）= 体型适合度 × 活动时段重叠 × 会飞的话 FLIGHT_ESCAPE × 奔跑能力（chaseFactor）。
 *   跑不动的猎物可以大于 1（不截断，和个体模型一致；被抓的概率在 hunt 里再截到 1）。
 *   只有以脊椎动物为主的捕食者（carnivore）才追得上；鼠这样的杂食动物为 0。
 * - nest：窝里的幼体（蛋、雏鸟、窝里的幼崽）= 体型适合度（按幼体体重）× NEST_DISCOVERY × 窝的暴露程度。
 *   窝不会跑，也不分白天黑夜，不乘活动时段重叠；地面浅窝还要再乘各格的掩护（见 nestExposure）。
 *   没写窝类型的物种（阶段 0）按旧规则：和 mobile 一样。
 * 不吃同种。
 */
export interface PreyWeights {
  mobile: number[][];
  nest: number[][];
}

export function preyMatrix(species: readonly DerivedSpecies[]): PreyWeights {
  const mobile = species.map((pred, i) =>
    species.map((prey, j) => {
      if (!pred.carnivore || i === j) return 0;
      const fly = prey.flies ? FLIGHT_ESCAPE : 1;
      return catchSuitability(pred, prey, prey.bodyMassG / pred.bodyMassG) * activityOverlap(pred.params.activity, prey.params.activity) * fly * chaseFactor(pred, prey);
    }),
  );
  const nest = species.map((pred, i) =>
    species.map((prey, j) => {
      if (!pred.predator || i === j) return 0;
      if (prey.nest === null) return mobile[i]![j]!;
      const ratio = (prey.bodyMassG * JUVENILE_SIZE_FACTOR) / pred.bodyMassG;
      return catchSuitability(pred, prey, ratio) * NEST_DISCOVERY * (prey.nest === 'burrow' ? BURROW_EXPOSURE : 1);
    }),
  );
  return { mobile, nest };
}

/**
 * 窝的暴露程度：掩护（0–1，见 grid.updateCover，按植物类型的 cover 数据算）越好越难被发现。
 */
export function nestExposure(cover: number): number {
  return 1 - COVER_PROTECTION * cover;
}

/**
 * 捕食者能不能抓这种猎物（这一只和那一只的体重比 → [0, 1]）。
 * 一般按体型适合度；以脊椎动物为主的捕食者会还手，只抓成体比自己物种轻的
 * （白鼬会吃伶鼬，伶鼬不会去抓白鼬）。这条按物种的成体体重判断，格子模型和个体模型才一致。
 */
export function catchSuitability(pred: DerivedSpecies, prey: DerivedSpecies, preyToPredatorMass: number): number {
  if (prey.carnivore && prey.bodyMassG >= pred.bodyMassG) return 0;
  return sizeSuitability(preyToPredatorMass);
}

/**
 * 捕食者抓到一只 preyMassG 克的猎物，能派上用场的肉量：最多吃掉一天的需求 needG、再存满体内储备，
 * 多出来的浪费掉（小型鼬抓到一只兔子也吃不完）。格子模型和个体模型都按这个算，两边才一致。
 * needG 是这只捕食者自己的日需求（幼体按体型打折；格子模型按成体算）。
 */
export function usableMeal(pred: DerivedSpecies, needG: number, preyMassG: number): number {
  return Math.min(preyMassG, needG * (1 + pred.maxReserveDays));
}

/**
 * 拥挤对繁殖的折扣（crowding：所在区块的拥挤程度，1 = 住满）。
 * 一般物种越挤生得越少（线性）；有领地的物种只要还有空领地就照常繁殖，占满了才停。
 */
export function breedingRoom(sp: DerivedSpecies, crowding: number): number {
  if (sp.territorial) return crowding < 1 ? 1 : 0;
  return Math.max(0, 1 - crowding);
}
