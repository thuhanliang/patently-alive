import { SimConfigSchema, type SimConfig } from './config';
import { Rng, type RngState } from './rng';
import { cloneData } from './checksum';

/**
 * 占位用的随机游走点，只为了让阶段 0 第 1 步有东西可推、可看、可测。
 * 第 2、3 步换成格子地图和按格子的种群推演后删掉。
 */
export interface Walker {
  x: number;
  y: number;
}

/** 推演的全部状态。必须是纯数据：可以序列化成快照、原样恢复。 */
export interface SimState {
  readonly config: SimConfig;
  tick: number;
  rng: RngState;
  walkers: Walker[];
}

export const PLACEHOLDER_GRID = 64;
const PLACEHOLDER_WALKERS = 32;

export function createInitialState(config: SimConfig): SimState {
  const parsed = SimConfigSchema.parse(config);
  const rng = Rng.fromSeed(parsed.seed);
  const walkers: Walker[] = [];
  for (let i = 0; i < PLACEHOLDER_WALKERS; i++) {
    walkers.push({ x: rng.nextInt(PLACEHOLDER_GRID), y: rng.nextInt(PLACEHOLDER_GRID) });
  }
  return { config: parsed, tick: 0, rng: rng.state(), walkers };
}

/**
 * 模拟内核：固定步长推进，一次 step() 就是一个 tick。
 * 结果只取决于初始配置和已经走过的步数，与真实时间、帧率、调用节奏无关。
 */
export class Sim {
  private s: SimState;
  private rng: Rng;

  constructor(state: SimState) {
    this.s = cloneData(state);
    this.rng = Rng.fromState(this.s.rng);
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

  step(): void {
    const n = PLACEHOLDER_GRID;
    for (const w of this.s.walkers) {
      // 四个方向或原地，环形边界。
      switch (this.rng.nextInt(5)) {
        case 0: w.x = (w.x + 1) % n; break;
        case 1: w.x = (w.x + n - 1) % n; break;
        case 2: w.y = (w.y + 1) % n; break;
        case 3: w.y = (w.y + n - 1) % n; break;
        default: break;
      }
    }
    this.s.tick += 1;
    this.s.rng = this.rng.state();
  }

  stepN(count: number): void {
    for (let i = 0; i < count; i++) this.step();
  }

  /** 深拷贝的快照，可以存档、也可以用 new Sim(snapshot) 恢复。 */
  snapshot(): SimState {
    return cloneData(this.s);
  }
}
