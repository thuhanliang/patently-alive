import { SimConfigSchema, type SimConfig } from './config';
import { checksum, cloneData, shapeMismatch } from './data';
import { costOf, LOG_FORMAT, LOG_VERSION, OpLogSchema, OpSchema, RulesSchema, SANDBOX_RULES, type Cost, type LogEntry, type Op, type OpLog, type Rules } from './ops';
import { Sim, speciesOf, type SimState } from './sim';
import type { SpeciesParams } from '../data/schema/species';
import type { Design } from '../data/schema/design';
import { compileDesign, designKitFromData, type DesignKit } from './design';
import { SAVE_FORMAT, SAVE_VERSION, SaveSchema, type SaveFile } from './save';
import type { Alert } from './alerts';
import { fenceLengthCells } from './fence';
import { isLand } from './terrain';
import { baselineOf, QUARTER_DAYS, QUARTERS_PER_YEAR, satisfactionChange, score, type ScoreBaseline, type ScoreDetail, type ScoreGoal, type Scores } from './score';
import { DAYS_PER_YEAR, TICKS_PER_DAY } from './time';
import { caseLocation, caseStatus, type CaseStatus } from './cases';
import { MAX_SPECIES } from './individuals';

/** 一次季度结算。 */
export interface Quarter {
  /** 第几季（从 1 起）。 */
  index: number;
  day: number;
  scores: Scores;
  detail: ScoreDetail;
  /** 结算时满意度的变化（已计入）。 */
  satisfactionDelta: number;
  /** 委托人这一季拨的经费（已计入预算）。 */
  grant: number;
  /** 目标物种在结算这天的数量（之后几年和它比同季）。 */
  targetCount: number;
  /** 结算后的预算和满意度。 */
  budget: number;
  satisfaction: number;
  /** 委托期的最后一季。 */
  final: boolean;
}

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
  /** 有委托目标时的评分设置和开局基准。 */
  private readonly scoring: { goal: ScoreGoal; base: ScoreBaseline } | null;
  /** 一共花了多少、拿到多少（开局预算 + 各季拨款）。 */
  private spent = 0;
  private received: number;
  private readonly settled: Quarter[] = [];
  private readonly removedBySpecies: number[];

  constructor(config: SimConfig, rules: Rules = SANDBOX_RULES) {
    this.config = SimConfigSchema.parse(config);
    this.rules = RulesSchema.parse(rules);
    this.simulation = Sim.create(this.config);
    this.res = {
      budget: this.rules.budget,
      busyUntil: new Array<number>(this.rules.staff).fill(0),
      satisfaction: this.rules.satisfaction,
    };
    this.received = this.rules.budget;
    this.removedBySpecies = this.config.species.map(() => 0);
    const goal = this.rules.goal;
    if (goal) {
      const ids = this.config.species.map((s) => s.id);
      const target = ids.indexOf(goal.target);
      if (target < 0) throw new Error(`委托目标「${goal.target}」不是这片世界的物种`);
      const unknown = goal.native.find((id) => !ids.includes(id));
      if (unknown !== undefined) throw new Error(`本地物种「${unknown}」不是这片世界的物种`);
      this.scoring = {
        goal: { target, recovery: goal.recovery, native: ids.map((id) => goal.native.includes(id)) },
        base: baselineOf(this.simulation.state),
      };
    } else {
      this.scoring = null;
    }
    for (const c of this.rules.cases ?? []) {
      if (!this.config.species.some((s) => s.id === c.species)) throw new Error(`个案 ${c.id} 的物种「${c.species}」不是这片世界开局就有的物种`);
      if (!c.edible) throw new Error(`个案 ${c.id} 没有 edible（牙齿要先换成能吃下去的比例）`);
    }
  }

  /** 个案动物在哪一格（只看地形，开局算一次）。 */
  private caseCells: Map<string, { x: number; y: number }> | null = null;

  /**
   * 个案动物现在的状态（2026-10-22，见 cases.ts）：只由情景数据、今天和日志里的救助操作推出来，
   * 读档、回放后不用另外恢复。
   */
  cases(): CaseStatus[] {
    const list = this.rules.cases ?? [];
    if (list.length === 0) return [];
    this.caseCells ??= new Map(list.map((c) => [c.id, caseLocation(c, this.simulation.state.grid)] as const));
    const day = Math.floor(this.simulation.tick / TICKS_PER_DAY);
    return list.map((c) => caseStatus(c, this.config.species.find((s) => s.id === c.species)!, this.caseCells!.get(c.id)!, day, this.rescueDay(c.id)));
  }

  /** 日志里把这只个案带回来的那天；没有为 null。 */
  private rescueDay(id: string): number | null {
    const e = this.log.find((x) => x.op.type === 'rescue' && x.op.case === id);
    return e ? Math.floor(e.tick / TICKS_PER_DAY) : null;
  }

  /** 已经做过的季度结算（最早的在前）。 */
  get quarters(): readonly Quarter[] {
    return this.settled;
  }

  /** 一共花了多少、拿到多少（开局预算 + 各季拨款）。 */
  get money(): { spent: number; received: number } {
    return { spent: this.spent, received: this.received };
  }

  /** 开局以来各物种被人为移除（扑杀、陷阱里处死）的只数。 */
  get removed(): readonly number[] {
    return this.removedBySpecies;
  }

  /** 委托期一共几季；没有委托目标为 0。 */
  get totalQuarters(): number {
    return this.rules.goal ? (this.rules.goal.years * DAYS_PER_YEAR) / QUARTER_DAYS : 0;
  }

  /** 委托期结束了没有（结束后还能看，但不能再动手）。 */
  get ended(): boolean {
    return this.settled.at(-1)?.final === true;
  }

  /** 按现在的状态算一次评分（不结算，界面随时看用）；没有委托目标为 null。 */
  currentScore(): { scores: Scores; detail: ScoreDetail } | null {
    if (!this.scoring) return null;
    // 和第一年同一季的结算比（季节起伏大）；还在第一年时没有可比的。
    const day = Math.floor(this.simulation.tick / TICKS_PER_DAY);
    const index = Math.ceil(day / QUARTER_DAYS);
    const ref = index > QUARTERS_PER_YEAR ? this.settled[(index - 1) % QUARTERS_PER_YEAR] : undefined;
    const sameSeason = ref ? ref.targetCount : null;
    return score(this.simulation.state, this.scoring.goal, this.scoring.base, { spent: this.spent, received: this.received }, sameSeason);
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

  /** 当前的警报，最响的在前（含资源类：满意度低、预算不够布最便宜的工具）。有委托时数量类警报只看本地物种。 */
  alerts(): Alert[] {
    const tools = this.config.tools;
    const resources = tools
      ? {
          budget: this.res.budget,
          satisfaction: this.res.satisfaction,
          cheapestTool: Math.min(
            tools.cull.cost,
            tools.sample.cost,
            tools.necropsy.cost,
            ...tools.traps.map((t) => t.setupCost + t.nightlyCost),
            // 最短的围栏是一格长。
            ...tools.fences.map((f) => (f.costPerKm * this.config.world.cellSizeM) / 1000),
          ),
        }
      : undefined;
    return this.simulation.alerts(resources, this.scoring?.goal.native);
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
    const ids = this.speciesIds();
    let loss = 0;
    this.simulation.state.lastDay.forEach((d, s) => {
      this.removedBySpecies[s] = this.removedBySpecies[s]! + d.removed;
      if (d.removed > 0) loss += d.removed * (sentiment[ids[s]!] ?? 0);
    });
    if (loss > 0) this.res.satisfaction = Math.max(0, this.res.satisfaction - loss);
    const day = this.simulation.tick / TICKS_PER_DAY;
    if (this.scoring && !this.ended && day % QUARTER_DAYS === 0) this.settle(day);
  }

  /**
   * 季度结算：评分；满意度按恢复分变化；委托人按满意度拨下一季的经费。
   */
  private settle(day: number): void {
    const { scores, detail } = this.currentScore()!;
    const before = this.res.satisfaction;
    this.res.satisfaction = Math.min(100, Math.max(0, before + satisfactionChange(scores)));
    // 记实际变了多少（夹在 0–100 之后）。
    const delta = this.res.satisfaction - before;
    const index = this.settled.length + 1;
    const final = index >= this.totalQuarters;
    const grant = final ? 0 : Math.round((this.rules.goal!.quarterlyBudget * this.res.satisfaction) / 100);
    this.res.budget += grant;
    this.received += grant;
    this.settled.push({
      index,
      day,
      scores,
      detail,
      targetCount: this.simulation.state.lastDay[this.scoring!.goal.target]!.total,
      satisfactionDelta: delta,
      grant,
      budget: this.res.budget,
      satisfaction: this.res.satisfaction,
      final,
    });
  }

  /** 统一操作接口。 */
  submit(input: unknown): SubmitResult {
    const parsed = OpSchema.safeParse(input);
    if (!parsed.success) return { ok: false, reason: `操作格式不对：${parsed.error.issues.map((i) => i.message).join('；')}` };
    const op = parsed.data;

    const problem = this.check(op);
    if (problem) return { ok: false, reason: problem };

    const cost = costOf(op, this.config.tools, this.config.world.cellSizeM, this.rules);
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
      format: LOG_FORMAT,
      version: LOG_VERSION,
      config: cloneData(this.config),
      rules: cloneData(this.rules),
      entries: cloneData(this.log),
      endTick: this.simulation.tick,
    };
  }

  /** 存档：日志 + 此刻的快照。返回的是纯数据（类型化数组照原样），写文件时用 serialize。 */
  save(): SaveFile {
    return {
      format: SAVE_FORMAT,
      version: SAVE_VERSION,
      log: this.exportLog(),
      session: {
        speed: this.currentSpeed,
        resources: cloneData(this.res),
        spent: this.spent,
        received: this.received,
        quarters: cloneData(this.settled),
        removed: [...this.removedBySpecies],
      },
      state: this.simulation.snapshot() as unknown as Record<string, unknown>,
    };
  }

  /**
   * 读档：按存档里的日志建局，再把快照装回去（不重跑）。
   * 快照的配置、时刻、物种数要和日志对得上，否则拒绝。
   */
  static restore(input: unknown): Session {
    return Session.restoreParsed(SaveSchema.parse(input));
  }

  /** 已经用 SaveSchema 校验过的存档（免得几 MB 的快照校验两遍）。 */
  static restoreParsed(save: SaveFile): Session {
    const { log } = save;
    const state = save.state as unknown as SimState;
    // 新建一局拿开局基准，也拿来当快照形状的参照。
    const session = new Session(log.config, log.rules);
    if (state.tick !== log.endTick) throw new Error(`存档的快照在第 ${state.tick} tick，日志停在第 ${log.endTick} tick，对不上`);
    if (checksum(state.config) !== checksum(session.config)) throw new Error('存档的快照和日志不是同一个世界');
    const fresh = session.simulation.state;
    // 快照里有引进的物种：必须正是日志里那几次引种引进的（同样的先后、同样的性状），新建的局也按这个登记上，形状才对得上。
    const expected = introducedBy(log.config.species.map((s) => s.id), log.entries);
    if (checksum(state.introduced ?? []) !== checksum(expected)) throw new Error('存档的快照里引进的物种和日志对不上');
    for (const p of expected) session.addSpecies(p);
    const bad = shapeMismatch(state, fresh, fresh.grid.width * fresh.grid.height);
    if (bad) throw new Error(`存档的快照格式和这个版本不一样（${bad}），可能是旧版本的存档`);
    const n = session.speciesIds().length;
    const s = save.session;
    if (s.removed.length !== n || s.resources.busyUntil.length !== session.rules.staff) throw new Error('存档里的资源和开局规则对不上');
    // Sim 的构造函数自己会拷贝一份。
    session.simulation = new Sim(state);
    for (const e of cloneData(log.entries)) session.log.push(e);
    session.currentSpeed = s.speed;
    Object.assign(session.res, cloneData(s.resources));
    session.spent = s.spent;
    session.received = s.received;
    for (const q of cloneData(s.quarters)) session.settled.push(q);
    session.removedBySpecies.splice(0, n, ...s.removed);
    return session;
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
    this.spent += cost.budget;
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
    if (this.ended && op.type !== 'setSpeed' && op.type !== 'setFocus') return '委托期已经结束，不能再动手了（还可以继续观察）';
    switch (op.type) {
      case 'setSpeed':
        return null;
      case 'rescue': {
        const status = this.cases().find((c) => c.id === op.case);
        if (!status) return `这一局没有个案「${op.case}」`;
        if (status.phase === 'hidden') return '还没有人见过它';
        if (status.phase === 'rescued' || status.phase === 'office') return `${status.name}已经在事务所了`;
        if (status.phase === 'lost') return '来不及了：已经找不到它了';
        return null;
      }
      case 'release': {
        if (!this.rules.allowRelease) return '管理员身份不能往岛上引入动物（引种在下一阶段解锁）';
        if (!this.hasSpecies(op.species)) return `这片世界里没有物种「${op.species}」`;
        return this.landProblem(op.x, op.y);
      }
      case 'introduce': {
        const intro = this.rules.introduction;
        if (op.design) {
          if (!intro.designs) return '这份委托不允许投放自己设计的物种';
          const problem = this.designProblem(op.design, op.species);
          if (problem) return problem;
        } else {
          if (!intro.allowed) return '这份委托不允许从档案馆引进物种';
          if (op.species.id.startsWith('d_')) return '设计物种（d_ 开头）要附上设计本身';
          const catalog = this.config.catalog;
          if (catalog && !catalog.some((p) => checksum(p) === checksum(op.species))) return `档案馆里没有和「${op.species.name}」一模一样的条目`;
        }
        if (!this.config.tools?.introduction) return '这片世界没有引种的工具数据';
        if (intro.banned.includes(op.species.id)) return `业主明令禁止引进${op.species.name}`;
        const max = this.config.tools.introduction.maxAnimals;
        if (op.count > max) return `一次最多引进 ${max} 只`;
        // 同一个 id 已经在这一局里了：只能是同一种（性状完全一样），否则是另一个物种，得换个 id。
        const present = speciesOf(this.simulation.state);
        const known = present.find((s) => s.id === op.species.id);
        if (known && checksum(known) !== checksum(op.species)) return `这一局已经有「${op.species.id}」了，但性状不一样`;
        if (!known && present.length >= MAX_SPECIES) return `一局最多 ${MAX_SPECIES} 个物种，已经满了`;
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
        const bad = op.remove.find((id) => !this.hasSpecies(id));
        if (bad !== undefined) return `移除名单里的「${bad}」不是这片世界的物种`;
        return this.landProblem(op.x, op.y);
      }
      case 'cull': {
        if (!this.config.tools) return '这片世界没有兽医工具';
        if (!this.hasSpecies(op.species)) return `这片世界里没有物种「${op.species}」`;
        return this.landProblem(op.x, op.y);
      }
      case 'sample': {
        if (!this.config.tools) return '这片世界没有兽医工具';
        if (!this.hasSpecies(op.species)) return `这片世界里没有物种「${op.species}」`;
        return this.landProblem(op.x, op.y);
      }
      case 'necropsy': {
        if (!this.config.tools) return '这片世界没有兽医工具';
        if (op.species !== null && !this.hasSpecies(op.species)) return `这片世界里没有物种「${op.species}」`;
        return this.landProblem(op.x, op.y);
      }
      case 'fence': {
        const tools = this.config.tools;
        if (!tools) return '这片世界没有兽医工具';
        if (!tools.fences.some((f) => f.id === op.fence)) return `没有这种围栏：${op.fence}`;
        const { width, height } = this.simulation.state.grid;
        const inside = [op.x0, op.x1].every((v) => v >= 0 && v <= width) && [op.y0, op.y1].every((v) => v >= 0 && v <= height);
        if (!inside) return '围栏的端点要在地图内';
        if (fenceLengthCells(op) < 1) return '围栏太短（至少一格长）';
        return null;
      }
    }
  }

  private landProblem(x: number, y: number): string | null {
    const { width, height, terrain } = this.simulation.state.grid;
    if (x < 0 || y < 0 || x >= width || y >= height) return `位置 (${x}, ${y}) 不在地图内`;
    if (!isLand(terrain[y * width + x]!)) return `位置 (${x}, ${y}) 是水，不是陆地`;
    return null;
  }

  /** 设计编译的数据，按需从配置组装一次。 */
  private designKitCache: DesignKit | null = null;

  /**
   * 设计物种的核对：用这一局的设计数据重新编译，结果必须和操作里的物种参数一模一样。
   * 能力只能由性状推导（铁律 5）：不能手写一份参数冒充设计。
   */
  private designProblem(design: Design, species: SpeciesParams): string | null {
    const data = this.config.design;
    if (!data) return '这片世界没有设计数据，不能投放设计物种';
    this.designKitCache ??= designKitFromData(data);
    let compiled: SpeciesParams;
    try {
      compiled = compileDesign(design, this.designKitCache).params;
    } catch (e) {
      return `设计编译不了：${(e as Error).message}`;
    }
    if (checksum(compiled) !== checksum(species)) return '物种参数和设计对不上：设计物种的能力只能由设计推导';
    return null;
  }

  /** 这一局现在的全部物种 id（开局的 + 引进的），顺序和推演里的物种下标一致。 */
  private speciesIds(): string[] {
    return this.simulation.species.map((d) => d.params.id);
  }

  private hasSpecies(id: string): boolean {
    return this.speciesIds().includes(id);
  }

  private speciesIndex(id: string): number {
    return this.speciesIds().indexOf(id);
  }

  /** 登记一个新物种：推演里加上它，按物种排的记录（移除只数、评分的本地 / 外来、开局基准）跟着加一项。引进的都算外来。 */
  private addSpecies(params: SpeciesParams): number {
    const index = this.simulation.introduce(params);
    this.removedBySpecies.push(0);
    if (this.scoring) {
      (this.scoring.goal.native as boolean[]).push(false);
      this.scoring.base.totals.push(0);
    }
    return index;
  }

  private apply(op: Op): void {
    switch (op.type) {
      case 'rescue':
        // 个案动物不在推演里：带回来这件事就记在日志里，状态由日志推出来（见 cases()）。
        return;
      case 'setSpeed':
        this.currentSpeed = op.speed;
        return;
      case 'release':
        this.simulation.release(this.speciesIndex(op.species), op.x, op.y, op.count);
        return;
      case 'introduce': {
        const known = this.speciesIndex(op.species.id);
        const index = known >= 0 ? known : this.addSpecies(op.species);
        this.simulation.release(index, op.x, op.y, op.count);
        return;
      }
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
      case 'sample':
        this.simulation.sample(this.speciesIndex(op.species), op.x, op.y);
        return;
      case 'necropsy':
        this.simulation.necropsy(op.species === null ? -1 : this.speciesIndex(op.species), op.x, op.y);
        return;
      case 'fence': {
        const tools = this.config.tools!;
        const type = tools.fences.findIndex((f) => f.id === op.fence);
        const days = costOf(op, tools, this.config.world.cellSizeM).days;
        this.simulation.buildFence(type, op.x0, op.y0, op.x1, op.y1, days);
        return;
      }
    }
  }
}

/** 按日志里的引种操作，依次引进了哪些开局没有的物种（每个 id 只算第一次）。日志里的物种数据已经过 schema 校验。 */
function introducedBy(initial: readonly string[], entries: readonly LogEntry[]): SpeciesParams[] {
  const seen = new Set(initial);
  const out: SpeciesParams[] = [];
  for (const { op } of entries) {
    if (op.type !== 'introduce' || seen.has(op.species.id)) continue;
    seen.add(op.species.id);
    out.push(op.species);
  }
  return out;
}
