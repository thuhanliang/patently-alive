import { SimConfigSchema, type SimConfig } from './config';
import { Rng, type RngState } from './rng';
import { cloneData } from './data';
import { createGrid, growVegetation, type Grid } from './grid';
import { deriveAll, type DerivedSpecies } from './physiology';
import {
  createPopulation,
  crowdingByBlock,
  dailyPopulation,
  emptyDayStats,
  emptyPopulation,
  mergeInto,
  populationTotal,
  type DayStats,
  type Population,
} from './population';
import { FOCUS_BLOCK, FOCUS_MAX_CELLS, inFocus, sameFocus, type FocusRect } from './focus';
import {
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
  /** 已经走过的 tick 数（1 tick = 游戏内 1 小时）。 */
  tick: number;
  rng: RngState;
  /** 当天的天气系数，乘在植被生长上；逐日带惯性变化。 */
  weather: number;
  grid: Grid;
  /** 各物种按格子的计数，顺序与 config.species 一致。 */
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
}

function cellArea(config: SimConfig): number {
  return config.world.cellSizeM * config.world.cellSizeM;
}

export function createInitialState(config: SimConfig): SimState {
  const parsed = SimConfigSchema.parse(config);
  const rng = Rng.fromSeed(parsed.seed);
  const grid = createGrid(parsed.world, rng);
  const { derived } = deriveAll(parsed.species, parsed.world.cellSizeM);
  const populations = derived.map((d) => createPopulation(d, grid, cellArea(parsed), rng));
  return {
    config: parsed,
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
  private readonly derived: DerivedSpecies[];
  private readonly prey: number[][];
  private readonly scratch: Int32Array;

  constructor(state: SimState) {
    this.s = cloneData(state);
    this.rng = Rng.fromState(this.s.rng);
    ({ derived: this.derived, prey: this.prey } = deriveAll(this.s.config.species, this.s.config.world.cellSizeM));
    this.scratch = new Int32Array(this.s.grid.width * this.s.grid.height);
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
        (this.s.tick % TICKS_PER_DAY) / TICKS_PER_DAY,
      );
      this.s.rng = this.rng.state();
    }
  }

  /** 每个物种的总数：格子计数 + 待合并计数 + 展开的个体。 */
  totals(): number[] {
    const ind = countBySpecies(this.s.individuals, this.derived.length);
    return this.s.populations.map((p, i) => populationTotal(p) + populationTotal(this.s.emigrants[i]!) + ind[i]!);
  }

  step(): void {
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
        cellAreaM2: cellArea(this.s.config),
        floorBiomass: this.s.config.world.vegetation.floorBiomass,
        rng: this.rng,
        stats: this.s.dayAccum,
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

  private daily(): void {
    const { world } = this.s.config;
    const w = world.weather;
    const fresh = w.min + (w.max - w.min) * this.rng.nextFloat();
    this.s.weather = w.persistence * this.s.weather + (1 - w.persistence) * fresh;

    const { dayOfYear, month } = calendar(this.s.tick);
    const growth = monthlyCurve(world.vegetation.growthByMonth, dayOfYear) * this.s.weather;
    const decay = monthlyCurve(world.vegetation.decayByMonth, dayOfYear);
    growVegetation(this.s.grid, world, growth, decay);

    const breeding = this.derived.map((d) => d.params.reproduction.breedingByMonth[month]!);
    const crowding = crowdingByBlock(
      { grid: this.s.grid, species: this.derived, populations: this.s.populations },
      { individuals: this.s.individuals, pending: this.s.emigrants },
    );

    const cellStats = dailyPopulation({
      species: this.derived,
      prey: this.prey,
      grid: this.s.grid,
      populations: this.s.populations,
      cellAreaM2: cellArea(this.s.config),
      floorBiomass: world.vegetation.floorBiomass,
      breeding,
      rng: this.rng,
      scratch: this.scratch,
      crowding,
    });
    const acc = this.s.dayAccum;
    individualsDaily(this.s.individuals, {
      species: this.derived,
      width: this.s.grid.width,
      breeding,
      crowding,
      rng: this.rng,
      stats: acc,
    });
    // 今天收拢回来的动物并回格子计数（格子模型今天没有再算它们一遍）。
    this.s.populations.forEach((p, s) => mergeInto(p, this.s.emigrants[s]!));
    absorbImmigrants(this.s.individuals, this.derived, this.s.populations, this.s.grid, this.s.focus, this.rng);

    const totals = this.totals();
    this.s.lastDay = cellStats.map((c, s) => ({
      total: totals[s]!,
      births: c.births + acc[s]!.births,
      deathsPredation: c.deathsPredation + acc[s]!.deathsPredation,
      deathsStarvation: c.deathsStarvation + acc[s]!.deathsStarvation,
      deathsOther: c.deathsOther + acc[s]!.deathsOther,
      released: acc[s]!.released,
    }));
    this.s.dayAccum = this.derived.map(() => emptyDayStats());
  }
}
