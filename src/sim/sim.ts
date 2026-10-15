import { SimConfigSchema, type SimConfig } from './config';
import { Rng, type RngState } from './rng';
import { cloneData } from './data';
import { createGrid, dailyGrowthInput, growPlants, plantFood, type Grid, type PlantFood } from './grid';
import { isLand } from './terrain';
import { closeLedgerDay, createLedger, decayLedger, growLedger, type DeathLedger } from './ledger';
import type { SpeciesParams } from '../data/schema/species';
import { deriveAll, type DerivedSpecies, type PreyWeights } from './physiology';
import {
  createPopulation,
  crowdingBlockCount,
  crowdingBlocks,
  landCells,
  crowdingByBlock,
  dailyPopulation,
  shiftStages,
  emptyDayStats,
  emptyPopulation,
  mergeInto,
  populationTotal,
  type DayStats,
  type Population,
} from './population';
import { FOCUS_BLOCK, FOCUS_MAX_CELLS, inFocus, sameFocus, type FocusRect } from './focus';
import { alerts, type Alert, type AlertInputs } from './alerts';
import { runJobs, type Capture, type Job, type NecropsySearch } from './jobs';
import { buildBarriers, fenceLengthCells, type Barrier, type Fence } from './fence';
import {
  compact,
  absorbImmigrants,
  applyFocus,
  expandCell,
  countBySpecies,
  createIndividuals,
  individualsDaily,
  individualsHourly,
  type Individuals,
} from './individuals';
import { TICKS_PER_DAY, calendar, monthlyCurve } from './time';

/** 推演的全部状态。必须是纯数据：可以序列化成快照、原样恢复。 */
export interface SimState {
  readonly config: SimConfig;
  /**
   * 开局以后引进的物种（引种、投放自己设计的物种），按引进的先后排在 config.species 后面。
   * 全部物种 = config.species + introduced（见 speciesOf），各物种数组的顺序都按这个。
   */
  introduced: SpeciesParams[];
  /** 已经走过的 tick 数（1 tick = 游戏内 1 小时）。 */
  tick: number;
  rng: RngState;
  /** 当天的天气系数，乘在植被生长上；逐日带惯性变化。 */
  weather: number;
  grid: Grid;
  /** 各物种按格子的计数，顺序与 speciesOf(state) 一致。 */
  populations: Population[];
  /** 各物种最近一天的账目。 */
  lastDay: DayStats[];
  /** 当前展开成个体的区域；null 表示全部按格子计数。 */
  focus: FocusRect | null;
  /** 请求的关注区，下一个 tick 开始时生效。 */
  requestedFocus: FocusRect | null;
  /** 关注区里的个体。 */
  individuals: Individuals;
  /**
   * 当天从个体收拢回来、还没并进格子计数的动物（它们今天已经以个体身份吃过、捕过猎），
   * 换天时格子模型算完后再并回去。
   */
  emigrants: Population[];
  /** 当天到目前为止的账目（个体每小时被捕食的计入这里），换天时并入 lastDay。 */
  dayAccum: DayStats[];
  /** 死因账本（见 ledger.ts）。 */
  deaths: DeathLedger;
  /** 进行中的兽医队野外工作（陷阱线、搜捕），每晚执行一次。 */
  jobs: Job[];
  /** 下一个工作的编号。 */
  nextJobId: number;
  /** 最近的捕获记录。 */
  captures: Capture[];
  /** 最近的找尸体结果。 */
  necropsies: NecropsySearch[];
  /** 已经完工的围栏。 */
  fences: Fence[];
  /** 各物种各格最近一次每日结算吃饱的程度（占日需求的比例）；体检看体况用。开局当作吃饱。 */
  fedLast: Float64Array[];
  /** 每 CENSUS_DAYS 天记一次各物种总数（第 0 天开局时记第一次），留开局那次和最近几次，一共 CENSUS_KEEP 次；警报看趋势用。 */
  census: { day: number; totals: number[] }[];
}

/** 普查间隔（天）和保留次数。 */
export const CENSUS_DAYS = 30;
export const CENSUS_KEEP = 25;

/** 这一局现在的全部物种：开局的 + 引进的。 */
export function speciesOf(state: Pick<SimState, 'config' | 'introduced'>): SpeciesParams[] {
  return [...state.config.species, ...state.introduced];
}

function cellArea(config: SimConfig): number {
  return config.world.cellSizeM * config.world.cellSizeM;
}

export function createInitialState(config: SimConfig): SimState {
  const parsed = SimConfigSchema.parse(config);
  const rng = Rng.fromSeed(parsed.seed);
  const grid = createGrid(parsed.world, rng);
  const { derived } = deriveAll(parsed.species, parsed.world.cellSizeM);
  const mainOnly = new Set(parsed.world.mainIslandOnly ?? []);
  const populations = derived.map((d) => createPopulation(d, grid, cellArea(parsed), rng, mainOnly.has(d.params.id)));
  return {
    config: parsed,
    introduced: [],
    tick: 0,
    rng: rng.state(),
    weather: 1,
    grid,
    populations,
    lastDay: populations.map((p) => emptyDayStats(populationTotal(p))),
    focus: null,
    requestedFocus: null,
    individuals: createIndividuals(),
    emigrants: populations.map(emptyPopulation),
    dayAccum: populations.map(() => emptyDayStats()),
    deaths: createLedger(derived.length, crowdingBlockCount(grid.width, grid.height)),
    jobs: [],
    nextJobId: 1,
    captures: [],
    necropsies: [],
    fences: [],
    fedLast: populations.map(() => new Float64Array(grid.width * grid.height).fill(1)),
    census: [{ day: 0, totals: populations.map(populationTotal) }],
  };
}

/**
 * 模拟内核：固定步长推进，一次 step() 就是一个 tick。
 * 结果只取决于初始配置和已经走过的步数，与真实时间、帧率、调用节奏无关。
 */
export class Sim {
  private s: SimState;
  private rng: Rng;
  // 由配置推导、不随时间变化的量，不进状态。
  private derived: DerivedSpecies[];
  private prey: PreyWeights;
  private readonly scratch: Int32Array;
  private readonly blocks: { blockOf: Int32Array; cellsIn: Float64Array; blocksWide: number };
  private readonly land: Int32Array;
  /** 围栏挡住的格边，由 state.fences 推出（不进快照）。 */
  private barriers: { adult: (Barrier | null)[]; juvenile: (Barrier | null)[] } | undefined;
  private barrierCount = 0;

  constructor(state: SimState) {
    this.s = cloneData(state);
    this.rng = Rng.fromState(this.s.rng);
    ({ derived: this.derived, prey: this.prey } = deriveAll(speciesOf(this.s), this.s.config.world.cellSizeM));
    this.scratch = new Int32Array(this.s.grid.width * this.s.grid.height);
    this.blocks = crowdingBlocks(this.s.grid.width, this.s.grid.height, this.s.grid.terrain);
    this.land = landCells(this.s.grid);
    this.rebuildBarriers();
  }

  private rebuildBarriers(): void {
    const { fences } = this.s;
    this.barrierCount = fences.length;
    const types = this.s.config.tools?.fences;
    this.barriers =
      fences.length > 0 && types
        ? buildBarriers(fences, types, this.derived, this.s.grid.width, this.s.grid.height)
        : undefined;
  }

  /** 吃植物、找虫子的参数（见 plantFood）；世界不变，算一次就够。 */
  private foodCache: PlantFood | undefined;
  private get food(): PlantFood {
    return (this.foodCache ??= plantFood(this.s.config.world));
  }

  static create(config: SimConfig): Sim {
    return new Sim(createInitialState(config));
  }

  get tick(): number {
    return this.s.tick;
  }

  /** 只读视图，给渲染和界面用。不要修改它。 */
  get state(): Readonly<SimState> {
    return this.s;
  }

  /** 由性状推导出的物种参数（只读），给界面显示用。 */
  get species(): readonly DerivedSpecies[] {
    return this.derived;
  }

  /**
   * 请求换关注区（null = 全部收拢）。下一个 tick 开始时生效。
   * 关注区会影响推演结果，第 5 步改成写进操作日志的操作。
   */
  setFocus(focus: FocusRect | null): void {
    this.validateFocus(focus);
    this.s.requestedFocus = focus ? { ...focus } : null;
  }

  /** 关注区不合法时抛出 RangeError（在地图内、左上角对齐、边长不超过上限）。 */
  validateFocus(focus: FocusRect | null): void {
    if (focus) {
      const { width, height } = this.s.grid;
      const { x0, y0, x1, y1 } = focus;
      const ok =
        [x0, y0, x1, y1].every(Number.isInteger) &&
        x0 >= 0 && y0 >= 0 && x1 <= width && y1 <= height &&
        x0 < x1 && y0 < y1 &&
        x1 - x0 <= FOCUS_MAX_CELLS && y1 - y0 <= FOCUS_MAX_CELLS &&
        x0 % FOCUS_BLOCK === 0 && y0 % FOCUS_BLOCK === 0;
      if (!ok) {
        throw new RangeError(
          `关注区不合法：${JSON.stringify(focus)}（要在地图内、左上角对齐到 ${FOCUS_BLOCK} 格、边长不超过 ${FOCUS_MAX_CELLS} 格）`,
        );
      }
    }
  }

  /**
   * 引进一个新物种（开局时没有的）：排在已有物种后面，数量从 0 开始，返回它的下标。
   * 谁吃谁、拥挤、围栏挡不挡得住都按全部物种重新推导（新来的捕食者会改变老物种的处境）。
   * 只是"登记"这个物种；要放多少只到哪里，接着用 release。只该由统一操作接口调用。
   */
  introduce(params: SpeciesParams): number {
    if (speciesOf(this.s).some((p) => p.id === params.id)) throw new RangeError(`已经有物种「${params.id}」了`);
    this.s.introduced.push(cloneData(params));
    ({ derived: this.derived, prey: this.prey } = deriveAll(speciesOf(this.s), this.s.config.world.cellSizeM));
    const sp = this.derived.at(-1)!;
    const cells = this.s.grid.width * this.s.grid.height;
    const pop: Population = { juveniles: Array.from({ length: sp.juvenileStages }, () => new Int32Array(cells)), adults: new Int32Array(cells) };
    this.s.populations.push(pop);
    this.s.emigrants.push(emptyPopulation(pop));
    this.s.lastDay.push(emptyDayStats(0));
    this.s.dayAccum.push(emptyDayStats());
    this.s.deaths = growLedger(this.s.deaths, this.derived.length);
    this.s.fedLast.push(new Float64Array(cells).fill(1));
    // 以前的普查里它是 0 只。
    for (const c of this.s.census) c.totals.push(0);
    this.rebuildBarriers();
    return this.derived.length - 1;
  }

  /**
   * 在 (x, y) 格投放 count 只成体。立即生效；那一格在关注区里就直接展开成个体。
   * 计入当天账目的 released。只该由统一操作接口调用（它负责校验和写日志）。
   */
  release(speciesIndex: number, x: number, y: number, count: number): void {
    const { width, height } = this.s.grid;
    const sp = this.derived[speciesIndex];
    if (!sp || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) {
      throw new RangeError(`投放位置或物种不合法：${speciesIndex} @ (${x}, ${y})`);
    }
    if (!Number.isInteger(count) || count < 1) throw new RangeError(`投放数量不合法：${count}`);
    const c = y * width + x;
    if (!isLand(this.s.grid.terrain[c]!)) throw new RangeError(`不能投放到水里：(${x}, ${y})`);
    const pop = this.s.populations[speciesIndex]!;
    pop.adults[c] = pop.adults[c]! + count;
    this.s.dayAccum[speciesIndex]!.released += count;
    if (inFocus(this.s.focus, x, y)) {
      expandCell(
        this.s.individuals,
        this.derived,
        this.s.populations,
        width,
        c,
        this.rng,
        this.day,
        (this.s.tick % TICKS_PER_DAY) / TICKS_PER_DAY,
      );
      this.s.rng = this.rng.state();
    }
  }

  /**
   * 布一组陷阱：在 (x, y) 放 nights 晚，抓到 remove 名单里的物种就移除，其余放生。
   * 当晚（下一次每日结算）开始生效。只该由统一操作接口调用。
   */
  placeTrap(trap: number, x: number, y: number, nights: number, remove: readonly number[]): number {
    const tools = this.s.config.tools;
    if (!tools || !tools.traps[trap]) throw new RangeError(`没有这种陷阱：${trap}`);
    this.checkLand(x, y);
    if (!Number.isInteger(nights) || nights < 1) throw new RangeError(`晚数不合法：${nights}`);
    if (remove.some((s) => !this.derived[s])) throw new RangeError(`移除名单里有不存在的物种：${remove.join(',')}`);
    const id = this.s.nextJobId++;
    this.s.jobs.push({ kind: 'trap', id, trap, x, y, nightsLeft: nights, remove: [...remove] });
    return id;
  }

  /** 夜间搜捕：在 (x, y) 附近移除物种 species，当晚生效。只该由统一操作接口调用。 */
  cull(species: number, x: number, y: number): number {
    if (!this.s.config.tools) throw new RangeError('这片世界没有兽医工具');
    if (!this.derived[species]) throw new RangeError(`没有这个物种：${species}`);
    this.checkLand(x, y);
    const id = this.s.nextJobId++;
    this.s.jobs.push({ kind: 'cull', id, x, y, nightsLeft: 1, species });
    return id;
  }

  /** 体检采样：在 (x, y) 一带抓物种 species 检查后放生。只该由统一操作接口调用。 */
  sample(species: number, x: number, y: number): number {
    if (!this.s.config.tools) throw new RangeError('这片世界没有兽医工具');
    if (!this.derived[species]) throw new RangeError(`没有这个物种：${species}`);
    this.checkLand(x, y);
    const id = this.s.nextJobId++;
    this.s.jobs.push({ kind: 'sample', id, x, y, nightsLeft: 1, species });
    return id;
  }

  /** 找尸体：在 (x, y) 一带搜一天，species 为 −1 时不限物种。只该由统一操作接口调用。 */
  necropsy(species: number, x: number, y: number): number {
    if (!this.s.config.tools) throw new RangeError('这片世界没有兽医工具');
    if (species !== -1 && !this.derived[species]) throw new RangeError(`没有这个物种：${species}`);
    this.checkLand(x, y);
    const id = this.s.nextJobId++;
    this.s.jobs.push({ kind: 'necropsy', id, x, y, nightsLeft: 1, species });
    return id;
  }

  /**
   * 架一段围栏：端点在格子的角上（0..width、0..height 的整数），days 天后完工、开始挡动物。
   * 只该由统一操作接口调用。
   */
  buildFence(type: number, x0: number, y0: number, x1: number, y1: number, days: number): number {
    const types = this.s.config.tools?.fences;
    if (!types || !types[type]) throw new RangeError(`没有这种围栏：${type}`);
    const { width, height } = this.s.grid;
    const ok = [x0, y0, x1, y1].every(Number.isInteger) && [x0, x1].every((v) => v >= 0 && v <= width) && [y0, y1].every((v) => v >= 0 && v <= height);
    if (!ok || fenceLengthCells({ x0, y0, x1, y1 }) < 1) throw new RangeError(`围栏端点不合法：(${x0}, ${y0})–(${x1}, ${y1})`);
    if (!Number.isInteger(days) || days < 1) throw new RangeError(`工期不合法：${days}`);
    const id = this.s.nextJobId++;
    this.s.jobs.push({ kind: 'fence', id, x: x0, y: y0, nightsLeft: days, fence: { id, type, x0, y0, x1, y1 } });
    return id;
  }

  private checkLand(x: number, y: number): void {
    const { width, height, terrain } = this.s.grid;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height || !isLand(terrain[y * width + x]!)) {
      throw new RangeError(`位置不在陆地上：(${x}, ${y})`);
    }
  }

  /** 当前的警报（最响的在前），见 alerts.ts。资源由统一操作接口那边传入。 */
  alerts(resources?: AlertInputs['resources'], native?: readonly boolean[]): Alert[] {
    return alerts(this.s, { blockOf: this.blocks.blockOf, resources, native });
  }

  /** 每个物种的总数：格子计数 + 待合并计数 + 展开的个体。 */
  totals(): number[] {
    const ind = countBySpecies(this.s.individuals, this.derived.length);
    return this.s.populations.map((p, i) => populationTotal(p) + populationTotal(this.s.emigrants[i]!) + ind[i]!);
  }

  /**
   * 传送带的当前日：最近一次每日结算所在的天（tick / 24 向下取整）。
   * 一天里的 24 个小时都属于这一天，直到下一次每日结算；判断幼体、成体统一用它。
   */
  get day(): number {
    return Math.floor(this.s.tick / TICKS_PER_DAY);
  }

  step(): void {
    // 这一小时属于"推进之前"的那一天：第 24 个小时也还没到下一次每日结算。
    const hourDay = this.day;
    if (!sameFocus(this.s.focus, this.s.requestedFocus)) {
      // 今天已经过去的小时数。刚换天（还没有任何个体行动过）时收拢的直接回格子计数，
      // 一天中途收拢的进待合并计数；中途展开的当作已经按时吃过。
      const hoursDone = this.s.tick % TICKS_PER_DAY;
      applyFocus(
        this.s.individuals,
        this.derived,
        this.s.populations,
        hoursDone === 0 ? this.s.populations : this.s.emigrants,
        this.s.grid,
        this.s.focus,
        this.s.requestedFocus,
        this.rng,
        this.day,
        hoursDone / TICKS_PER_DAY,
      );
      this.s.focus = this.s.requestedFocus ? { ...this.s.requestedFocus } : null;
    }
    this.s.tick += 1;
    if (this.s.focus) {
      individualsHourly(this.s.individuals, {
        species: this.derived,
        emigrants: this.s.emigrants,
        grid: this.s.grid,
        focus: this.s.focus,
        hour: calendar(this.s.tick).hour,
        day: hourDay,
        cellAreaM2: cellArea(this.s.config),
        food: this.food,
        rng: this.rng,
        stats: this.s.dayAccum,
        ledger: this.s.deaths,
        blockOf: this.blocks.blockOf,
        barriers: this.barriers,
      });
    }
    if (this.s.tick % TICKS_PER_DAY === 0) this.daily();
    this.s.rng = this.rng.state();
  }

  stepN(count: number): void {
    for (let i = 0; i < count; i++) this.step();
  }

  /** 深拷贝的快照，可以存档、也可以用 new Sim(snapshot) 恢复。 */
  snapshot(): SimState {
    return cloneData(this.s);
  }

  private runJobs(): void {
    const tools = this.s.config.tools;
    const removedIndividuals = new Uint8Array(this.s.individuals.count);
    this.s.jobs = runJobs(this.s.jobs, {
      species: this.derived,
      traps: tools?.traps ?? [],
      cull: tools?.cull,
      sample: tools?.sample,
      necropsy: tools?.necropsy,
      populations: this.s.populations,
      individuals: this.s.individuals,
      grid: this.s.grid,
      cellSizeM: this.s.config.world.cellSizeM,
      day: this.day,
      rng: this.rng,
      stats: this.s.dayAccum,
      ledger: this.s.deaths,
      blockOf: this.blocks.blockOf,
      captures: this.s.captures,
      necropsies: this.s.necropsies,
      fedLast: this.s.fedLast,
      blockCells: this.blocks.cellsIn,
      fences: this.s.fences,
      removedIndividuals,
    });
    compact(this.s.individuals, removedIndividuals);
    if (this.s.fences.length !== this.barrierCount) this.rebuildBarriers();
  }

  private daily(): void {
    const { world } = this.s.config;
    const w = world.weather;
    const fresh = w.min + (w.max - w.min) * this.rng.nextFloat();
    this.s.weather = w.persistence * this.s.weather + (1 - w.persistence) * fresh;

    const { dayOfYear, month } = calendar(this.s.tick);
    const { growth, decay } = dailyGrowthInput(world, dayOfYear, this.s.weather);
    growPlants(this.s.grid, world, growth, decay);

    // 幼体传送带：到了挪段的日子，格子计数和待合并计数一起挪（个体按同一规则自动成年）。
    const day = this.day;
    this.derived.forEach((sp, s) => {
      if (day % sp.stageDays === 0) {
        shiftStages(this.s.populations[s]!);
        shiftStages(this.s.emigrants[s]!);
      }
    });

    const breeding = this.derived.map((d) => d.params.reproduction.breedingByMonth[month]!);
    const crowding = crowdingByBlock(
      { species: this.derived, populations: this.s.populations, prey: this.prey, cover: this.s.grid.cover, ...this.blocks },
      { individuals: { ...this.s.individuals, width: this.s.grid.width, day }, pending: this.s.emigrants },
    );

    const cellStats = dailyPopulation({
      species: this.derived,
      prey: this.prey,
      grid: this.s.grid,
      populations: this.s.populations,
      cellAreaM2: cellArea(this.s.config),
      food: this.food,
      breeding,
      rng: this.rng,
      scratch: this.scratch,
      crowding,
      blockOf: this.blocks.blockOf,
      land: this.land,
      ledger: this.s.deaths,
      barriers: this.barriers,
      fedLast: this.s.fedLast,
    });
    const acc = this.s.dayAccum;
    individualsDaily(this.s.individuals, {
      species: this.derived,
      width: this.s.grid.width,
      day,
      breeding,
      crowding,
      blockOf: this.blocks.blockOf,
      rng: this.rng,
      stats: acc,
      ledger: this.s.deaths,
    });
    // 今天收拢回来的动物并回格子计数（格子模型今天没有再算它们一遍）。
    this.s.populations.forEach((p, s) => mergeInto(p, this.s.emigrants[s]!));
    absorbImmigrants(this.s.individuals, this.derived, this.s.populations, this.s.grid, this.s.focus, this.rng, day);
    // 夜里兽医队的活（陷阱、搜捕）：在当天的计数都并回来之后做，哪些动物在格子里、哪些展开成个体都抓得到。
    if (this.s.jobs.length > 0) this.runJobs();

    const totals = this.totals();
    this.s.lastDay = cellStats.map((c, s) => ({
      total: totals[s]!,
      births: c.births + acc[s]!.births,
      deathsPredation: c.deathsPredation + acc[s]!.deathsPredation,
      deathsStarvation: c.deathsStarvation + acc[s]!.deathsStarvation,
      deathsOther: c.deathsOther + acc[s]!.deathsOther,
      released: acc[s]!.released,
      removed: acc[s]!.removed,
    }));
    this.s.dayAccum = this.derived.map(() => emptyDayStats());
    // 普查：day 是刚开始的这一天（tick 已经到了它的 0 点）。
    if (day % CENSUS_DAYS === 0) {
      this.s.census.push({ day, totals: [...totals] });
      // 开局那次（第 0 个）一直留着：濒临消失按开局的数量算。
      if (this.s.census.length > CENSUS_KEEP) this.s.census.splice(1, this.s.census.length - CENSUS_KEEP);
    }
    // 死因账本：今天的合计存进 lastDay，旧账（含今天的）衰减一天。
    closeLedgerDay(this.s.deaths);
    decayLedger(this.s.deaths);
  }
}
