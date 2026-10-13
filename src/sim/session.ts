import { SimConfigSchema, type SimConfig } from './config';
import { cloneData } from './data';
import { costOf, OpLogSchema, OpSchema, RulesSchema, SANDBOX_RULES, type Cost, type LogEntry, type Op, type OpLog, type Rules } from './ops';
import { Sim } from './sim';
import { isLand } from './terrain';
import { TICKS_PER_DAY } from './time';

export type SubmitResult = { ok: true } | { ok: false; reason: string };

/** 一局的资源：预算、兽医队（每支队伍忙到第几个 tick）、客户满意度。 */
export interface Resources {
  budget: number;
  /** 每支兽医队忙到哪个 tick（不晚于当前 tick 就是空闲）。 */
  busyUntil: number[];
  /** 0–100。 */
  satisfaction: number;
}

/**
 * 一局游戏：一个推演 + 统一操作接口 + 操作日志 + 资源。
 *
 * 所有玩家操作都走 submit()：校验格式和语义、检查预算与空闲的兽医队、写进日志、再执行并扣除花费。
 * 被拒绝的操作不进日志、不改变任何东西。推演只能由 advance() 推进时间。
 * 界面和以后的 MCP 都只能通过这里改变世界（铁律 7）。
 */
export class Session {
  private simulation: Sim;
  private readonly config: SimConfig;
  readonly rules: Rules;
  private readonly log: LogEntry[] = [];
  private currentSpeed = 1;
  private readonly res: Resources;

  constructor(config: SimConfig, rules: Rules = SANDBOX_RULES) {
    this.config = SimConfigSchema.parse(config);
    this.rules = RulesSchema.parse(rules);
    this.simulation = Sim.create(this.config);
    this.res = {
      budget: this.rules.budget,
      busyUntil: new Array<number>(this.rules.staff).fill(0),
      satisfaction: this.rules.satisfaction,
    };
  }

  /** 推演的只读入口（状态、物种参数、总数）。不要直接调用它的修改方法。 */
  get sim(): Pick<Sim, 'state' | 'species' | 'tick' | 'totals' | 'snapshot' | 'day'> {
    return this.simulation;
  }

  get speed(): number {
    return this.currentSpeed;
  }

  get entries(): readonly LogEntry[] {
    return this.log;
  }

  /** 资源的只读视图。 */
  get resources(): Readonly<Resources> {
    return this.res;
  }

  /** 现在空闲的兽医队数量。 */
  freeStaff(): number {
    const now = this.simulation.tick;
    return this.res.busyUntil.filter((t) => t <= now).length;
  }

  /**
   * 推进 n 个 tick。这是时间前进的唯一入口。
   * 每过一天按当天被移除的动物扣满意度（委托人在意扑杀，见 Rules.sentiment）。
   */
  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) {
      this.simulation.step();
      if (this.simulation.tick % TICKS_PER_DAY === 0) this.afterDay();
    }
  }

  private afterDay(): void {
    const { sentiment } = this.rules;
    let loss = 0;
    this.simulation.state.lastDay.forEach((d, s) => {
      if (d.removed > 0) loss += d.removed * (sentiment[this.config.species[s]!.id] ?? 0);
    });
    if (loss > 0) this.res.satisfaction = Math.max(0, this.res.satisfaction - loss);
  }

  /** 统一操作接口。 */
  submit(input: unknown): SubmitResult {
    const parsed = OpSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: `操作格式不对：${parsed.error.issues.map((i) => i.message).join('；')}` };
    const op = parsed.data;

    const problem = this.check(op);
    if (problem) return { ok: false, reason: problem };

    const cost = costOf(op, this.config.tools);
    if (cost.budget > this.res.budget) return { ok: false, reason: `预算不够：要 ${cost.budget} 元，还剩 ${this.res.budget} 元` };
    if (cost.staff > this.freeStaff()) return { ok: false, reason: `人手不够：要 ${cost.staff} 支兽医队，空闲 ${this.freeStaff()} 支` };

    this.apply(op);
    this.pay(cost);
    this.log.push({ tick: this.simulation.tick, op: cloneData(op) });
    return { ok: true };
  }

  /** 导出操作日志（存档）。 */
  exportLog(): OpLog {
    return {
      format: 'patently-alive/oplog',
      version: 3,
      config: cloneData(this.config),
      rules: cloneData(this.rules),
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
    const session = new Session(log.config, log.rules);
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

  /** 扣除花费：预算、满意度（夹在 0–100），占用最早空出来的几支兽医队若干天。 */
  private pay(cost: Cost): void {
    this.res.budget -= cost.budget;
    this.res.satisfaction = Math.min(100, Math.max(0, this.res.satisfaction + cost.satisfaction));
    if (cost.staff > 0) {
      const now = this.simulation.tick;
      const until = now + cost.days * TICKS_PER_DAY;
      // 按下标顺序挑空闲的队伍，结果确定。
      let left = cost.staff;
      for (let k = 0; k < this.res.busyUntil.length && left > 0; k++) {
        if (this.res.busyUntil[k]! <= now) {
          this.res.busyUntil[k] = until;
          left -= 1;
        }
      }
    }
  }

  /** 语义检查：返回问题描述，没问题返回 null。 */
  private check(op: Op): string | null {
    switch (op.type) {
      case 'setSpeed':
        return null;
      case 'release': {
        if (!this.rules.allowRelease) return '管理员身份不能往岛上引入动物（引种在下一阶段解锁）';
        if (!this.config.species.some((s) => s.id === op.species)) return `这片世界里没有物种「${op.species}」`;
        return this.landProblem(op.x, op.y);
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
      case 'trap': {
        const tools = this.config.tools;
        if (!tools) return '这片世界没有兽医工具';
        if (!tools.traps.some((t) => t.id === op.trap)) return `没有这种陷阱：${op.trap}`;
        const bad = op.remove.find((id) => !this.config.species.some((s) => s.id === id));
        if (bad !== undefined) return `移除名单里的「${bad}」不是这片世界的物种`;
        return this.landProblem(op.x, op.y);
      }
      case 'cull': {
        if (!this.config.tools) return '这片世界没有兽医工具';
        if (!this.config.species.some((s) => s.id === op.species)) return `这片世界里没有物种「${op.species}」`;
        return this.landProblem(op.x, op.y);
      }
    }
  }

  private landProblem(x: number, y: number): string | null {
    const { width, height, terrain } = this.simulation.state.grid;
    if (x < 0 || y < 0 || x >= width || y >= height) return `位置 (${x}, ${y}) 不在地图内`;
    if (!isLand(terrain[y * width + x]!)) return `位置 (${x}, ${y}) 是水，不是陆地`;
    return null;
  }

  private speciesIndex(id: string): number {
    return this.config.species.findIndex((s) => s.id === id);
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
      case 'trap':
        this.simulation.placeTrap(
          this.config.tools!.traps.findIndex((t) => t.id === op.trap),
          op.x,
          op.y,
          op.nights,
          op.remove.map((id) => this.speciesIndex(id)),
        );
        return;
      case 'cull':
        this.simulation.cull(this.speciesIndex(op.species), op.x, op.y);
        return;
    }
  }
}
