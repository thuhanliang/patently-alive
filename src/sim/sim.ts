import { SimConfigSchema, type SimConfig } from './config';
import { Rng, type RngState } from './rng';
import { cloneData } from './data';
import { createGrid, growVegetation, type Grid } from './grid';
import { deriveAll, type DerivedSpecies } from './physiology';
import {
  createPopulation,
  dailyPopulation,
  emptyDayStats,
  populationTotal,
  type DayStats,
  type Population,
} from './population';
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

  step(): void {
    this.s.tick += 1;
    if (this.s.tick % TICKS_PER_DAY === 0) this.daily();
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

    this.s.lastDay = dailyPopulation({
      species: this.derived,
      prey: this.prey,
      grid: this.s.grid,
      populations: this.s.populations,
      cellAreaM2: cellArea(this.s.config),
      floorBiomass: world.vegetation.floorBiomass,
      breeding: this.derived.map((d) => d.params.reproduction.breedingByMonth[month]!),
      rng: this.rng,
      scratch: this.scratch,
    });
    this.s.rng = this.rng.state();
  }
}
