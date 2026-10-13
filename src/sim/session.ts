import { SimConfigSchema, type SimConfig } from './config';
import { cloneData } from './data';
import { costOf, OpLogSchema, OpSchema, type LogEntry, type Op, type OpLog } from './ops';
import { Sim } from './sim';

export type SubmitResult = { ok: true } | { ok: false; reason: string };

/** 预算与人手。阶段 0 只是占位：足够多，操作也都不花钱。 */
export interface Resources {
  budget: number;
  staff: number;
}

/**
 * 一局游戏：一个推演 + 统一操作接口 + 操作日志。
 *
 * 所有玩家操作都走 submit()：校验格式和语义、检查预算与人手、写进日志、再执行。
 * 被拒绝的操作不进日志、不改变任何东西。推演只能由 advance() 推进时间。
 * 界面和以后的 MCP 都只能通过这里改变世界（铁律 7）。
 */
export class Session {
  private simulation: Sim;
  private readonly config: SimConfig;
  private readonly log: LogEntry[] = [];
  private currentSpeed = 1;
  readonly resources: Resources = { budget: Number.MAX_SAFE_INTEGER, staff: Number.MAX_SAFE_INTEGER };

  constructor(config: SimConfig) {
    this.config = SimConfigSchema.parse(config);
    this.simulation = Sim.create(this.config);
  }

  /** 推演的只读入口（状态、物种参数、总数）。不要直接调用它的修改方法。 */
  get sim(): Pick<Sim, 'state' | 'species' | 'tick' | 'totals' | 'snapshot'> {
    return this.simulation;
  }

  get speed(): number {
    return this.currentSpeed;
  }

  get entries(): readonly LogEntry[] {
    return this.log;
  }

  /** 推进 n 个 tick。这是时间前进的唯一入口。 */
  advance(ticks: number): void {
    this.simulation.stepN(ticks);
  }

  /** 统一操作接口。 */
  submit(input: unknown): SubmitResult {
    const parsed = OpSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: `操作格式不对：${parsed.error.issues.map((i) => i.message).join('；')}` };
    const op = parsed.data;

    const problem = this.check(op);
    if (problem) return { ok: false, reason: problem };

    const cost = costOf(op);
    if (cost.budget > this.resources.budget) return { ok: false, reason: '预算不够' };
    if (cost.staff > this.resources.staff) return { ok: false, reason: '人手不够' };

    this.apply(op);
    this.resources.budget -= cost.budget;
    this.resources.staff -= cost.staff;
    this.log.push({ tick: this.simulation.tick, op: cloneData(op) });
    return { ok: true };
  }

  /** 导出操作日志（存档）。 */
  exportLog(): OpLog {
    return {
      format: 'patently-alive/oplog',
      version: 1,
      config: cloneData(this.config),
      entries: cloneData(this.log),
      endTick: this.simulation.tick,
    };
  }

  /**
   * 回放：按日志重建一局，推进到 untilTick（默认是日志导出时的 tick）。
   * 回放出的局继续可玩，后续操作接着写进它自己的日志。
   */
  static replay(input: unknown, untilTick?: number): Session {
    const log = OpLogSchema.parse(input);
    const session = new Session(log.config);
    const end = untilTick ?? log.endTick;
    for (const entry of log.entries) {
      if (entry.tick > end) break;
      session.advance(entry.tick - session.simulation.tick);
      const r = session.submit(entry.op);
      if (!r.ok) throw new Error(`回放失败：第 ${entry.tick} tick 的操作被拒绝（${r.reason}）`);
    }
    session.advance(Math.max(0, end - session.simulation.tick));
    return session;
  }

  /** 语义检查：返回问题描述，没问题返回 null。 */
  private check(op: Op): string | null {
    const { width, height } = this.simulation.state.grid;
    switch (op.type) {
      case 'setSpeed':
        return null;
      case 'release': {
        if (!this.config.species.some((s) => s.id === op.species)) return `这片世界里没有物种「${op.species}」`;
        if (op.x < 0 || op.y < 0 || op.x >= width || op.y >= height) return `位置 (${op.x}, ${op.y}) 不在地图内`;
        return null;
      }
      case 'setFocus': {
        try {
          // 借用推演自己的校验（越界、对齐、大小），校验不通过时什么都不会改变。
          this.simulation.validateFocus(op.focus);
          return null;
        } catch (e) {
          return (e as Error).message;
        }
      }
    }
  }

  private apply(op: Op): void {
    switch (op.type) {
      case 'setSpeed':
        this.currentSpeed = op.speed;
        return;
      case 'release':
        this.simulation.release(
          this.config.species.findIndex((s) => s.id === op.species),
          op.x,
          op.y,
          op.count,
        );
        return;
      case 'setFocus':
        this.simulation.setFocus(op.focus);
        return;
    }
  }
}
