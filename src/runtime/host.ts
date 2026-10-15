import {
  checksum,
  decodeData,
  FixedStepClock,
  LOG_FORMAT,
  LOG_VERSION,
  meanLandVegetation,
  OpLogSchema,
  SAVE_FORMAT,
  SAVE_VERSION,
  SaveSchema,
  serialize,
  Session,
  TICKS_PER_DAY,
  type Alert,
  type Op,
  type Quarter,
  type Resources,
  type Rules,
  type SimConfig,
  type SimState,
  type SubmitResult,
} from '../sim';

/**
 * 推演宿主：在 Web Worker 里持有这一局（Session），按真实时间推进，把画面要的东西打包成"视图"发给主线程。
 * 主线程只渲染、收输入；所有操作仍然通过 Session.submit（铁律 7）。
 *
 * 这个类不碰 Worker 的 API（时间、消息由外面传进来），所以能直接在测试里跑。
 */

/** 每天的一行曲线数据（主线程的种群曲线用；视图之间可能隔了好几天）。 */
export interface DayRecord {
  day: number;
  totals: number[];
  veg: number;
}

export interface SessionView {
  /** 换种子、读档后加一：主线程据此清掉按局缓存的东西。 */
  generation: number;
  tick: number;
  /** 推演状态；和上次发的同一时刻时为 null（暂停时不重发几 MB 的快照）。 */
  state: SimState | null;
  speed: number;
  held: boolean;
  resources: Resources;
  freeStaff: number;
  entries: number;
  quarters: Quarter[];
  ended: boolean;
  totalQuarters: number;
  money: { spent: number; received: number };
  removed: number[];
  alerts: Alert[];
  days: DayRecord[];
  /** 当天开始时的状态校验和（HUD 显示，用来对照回放）。 */
  dayChecksum: number;
  /** 当天开始时陆地的平均植被（g/m²）。 */
  meanVegetation: number;
}

export type ToHost =
  | { t: 'init'; config: SimConfig; rules: Rules; speed: number; held: boolean }
  | { t: 'submit'; id: number; op: Op }
  | { t: 'hold'; on: boolean }
  | { t: 'stepDay' }
  | { t: 'frame' }
  | { t: 'reseed'; seed: number }
  | { t: 'save'; id: number }
  | { t: 'exportLog'; id: number }
  | { t: 'load'; id: number; text: string };

export type Reply =
  | { t: 'failed'; id: number; message: string }
  | { t: 'submitted'; id: number; result: SubmitResult }
  | { t: 'text'; id: number; text: string; day: number }
  | { t: 'loaded'; id: number; ok: boolean; message: string };

export type FromHost = { t: 'view'; view: SessionView } | Reply | { t: 'error'; message: string };

/** 一次 run 最多推进几个 tick（真实时间卡顿后不一口气追太多）。 */
const MAX_TICKS_PER_RUN = TICKS_PER_DAY * 4;

export class SimHost {
  private session: Session;
  private readonly clock = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: MAX_TICKS_PER_RUN });
  private generation = 0;
  private held: boolean;
  private sentTick = -1;
  private sentGeneration = -1;
  /** 操作改了状态但时刻没变（暂停时放陷阱、调关注区……）：下一份视图要带新状态。 */
  private dirty = true;
  private days: DayRecord[] = [];
  private alertList: Alert[] = [];
  private alertDay = -1;
  private dayChecksum = 0;
  private meanVegetation = 0;

  constructor(
    private readonly config: SimConfig,
    private readonly rules: Rules,
    opts: { speed: number; held: boolean },
  ) {
    this.session = new Session(config, rules);
    this.held = opts.held;
    this.session.submit({ type: 'setSpeed', speed: opts.speed });
    this.recordDay();
  }

  /** 处理一条消息，返回要发回去的回复（没有为 null）。 */
  handle(msg: Exclude<ToHost, { t: 'init' } | { t: 'frame' }>): Reply | null {
    switch (msg.t) {
      case 'submit': {
        const result = this.session.submit(msg.op);
        // 花了钱、降了满意度：资源类警报马上重算；状态变了，下一份视图要带上。
        if (result.ok) {
          this.alertDay = -1;
          this.dirty = true;
        }
        return { t: 'submitted', id: msg.id, result };
      }
      case 'hold':
        this.held = msg.on;
        this.clock.reset();
        return null;
      case 'stepDay':
        if (!this.held) this.advance(TICKS_PER_DAY - (this.session.sim.tick % TICKS_PER_DAY));
        this.dirty = true;
        return null;
      case 'reseed': {
        const speed = this.session.speed;
        this.replace(new Session({ ...this.config, seed: msg.seed }, this.rules));
        this.session.submit({ type: 'setSpeed', speed });
        return null;
      }
      case 'save':
        return { t: 'text', id: msg.id, text: serialize(this.session.save()), day: this.session.sim.day };
      case 'exportLog':
        return { t: 'text', id: msg.id, text: JSON.stringify(this.session.exportLog()), day: this.session.sim.day };
      case 'load':
        return { t: 'loaded', id: msg.id, ...this.load(msg.text) };
    }
  }

  /** 按流逝的真实时间推进；deadline 是这次最多算到的时刻（now() 的单位），到点就停，好去收消息。 */
  run(elapsedMs: number, now: () => number, deadline: number): void {
    this.clock.speed = this.session.speed;
    if (this.held || this.session.speed === 0) {
      this.clock.reset();
      return;
    }
    const ticks = this.clock.advance(elapsedMs);
    for (let i = 0; i < ticks; i++) {
      if (!this.advance(1)) break;
      if (now() >= deadline) {
        // 没算完的时间丢掉：跟不上就是跟不上，不攒着。
        this.clock.reset();
        break;
      }
    }
  }

  /** 推进 n 个 tick；刚结算了一季就停下并挂起（等主线程看完结算单）。返回是否还能继续。 */
  private advance(n: number): boolean {
    for (let i = 0; i < n; i++) {
      const settled = this.session.quarters.length;
      this.session.advance(1);
      if (this.session.sim.tick % TICKS_PER_DAY === 0) this.recordDay();
      if (this.session.quarters.length > settled) {
        this.held = true;
        this.clock.reset();
        return false;
      }
    }
    return true;
  }

  /** 每天 0 点（和开局、换局时）记一次：曲线数据、校验和、平均植被都取当天开始时的状态。 */
  private recordDay(): void {
    const state = this.session.sim.state;
    this.meanVegetation = meanLandVegetation(state.grid, state.config.world);
    this.dayChecksum = checksum(state);
    this.days.push({ day: this.session.sim.day, totals: state.lastDay.map((d) => d.total), veg: this.meanVegetation });
  }

  /** 打包视图。推演状态只在时刻变了（或换了一局）时才拷贝一份。 */
  view(): SessionView {
    const s = this.session;
    const tick = s.sim.tick;
    const day = s.sim.day;
    if (day !== this.alertDay) {
      this.alertList = s.alerts();
      this.alertDay = day;
    }
    const fresh = this.dirty || tick !== this.sentTick || this.generation !== this.sentGeneration;
    this.dirty = false;
    this.sentTick = tick;
    this.sentGeneration = this.generation;
    const days = this.days;
    this.days = [];
    return {
      generation: this.generation,
      tick,
      state: fresh ? s.sim.snapshot() : null,
      speed: s.speed,
      held: this.held,
      resources: { budget: s.resources.budget, busyUntil: [...s.resources.busyUntil], satisfaction: s.resources.satisfaction },
      freeStaff: s.freeStaff(),
      entries: s.entries.length,
      quarters: [...s.quarters],
      ended: s.ended,
      totalQuarters: s.totalQuarters,
      money: s.money,
      removed: [...s.removed],
      alerts: this.alertList,
      days,
      dayChecksum: this.dayChecksum,
      meanVegetation: this.meanVegetation,
    };
  }

  private replace(next: Session): void {
    this.session = next;
    this.generation += 1;
    this.days = [];
    this.alertDay = -1;
    this.dirty = true;
    // 换了一局：上一局结算后的挂起不带过来（主线程按新局决定要不要停）。
    this.held = false;
    this.clock.reset();
    this.recordDay();
  }

  /** 载入存档文件或操作日志：存档直接装回快照，日志从头回放。世界、物种、工具或规则不同的不载入。 */
  private load(text: string): { ok: boolean; message: string } {
    try {
      const json = JSON.parse(text) as { format?: unknown; version?: unknown };
      const isSave = json.format === SAVE_FORMAT;
      if (isSave && json.version !== SAVE_VERSION) return { ok: false, message: `存档版本是 ${String(json.version)}，这个版本的游戏只认 ${SAVE_VERSION}` };
      if (!isSave && json.format !== LOG_FORMAT) return { ok: false, message: `不认识的文件格式：${String(json.format)}` };
      if (!isSave && json.version !== LOG_VERSION) return { ok: false, message: `操作日志版本是 ${String(json.version)}，这个版本的游戏只认 ${LOG_VERSION}（旧版本的日志回放结果会不同）` };
      const parsed = isSave ? SaveSchema.safeParse(decodeData(json)) : OpLogSchema.safeParse(json);
      if (!parsed.success) return { ok: false, message: `${isSave ? '存档' : '操作日志'}内容不对：${parsed.error.issues[0]?.message ?? ''}` };
      const log = 'log' in parsed.data ? parsed.data.log : parsed.data;
      // 画面、曲线都是按当前世界和物种建的；按内容比（校验和和键的顺序无关；存档文件里的键是排过序的）。
      const cur = this.session.exportLog().config;
      const same =
        checksum(log.config.world) === checksum(cur.world) &&
        checksum(log.config.species) === checksum(cur.species) &&
        checksum(log.rules) === checksum(this.session.rules) &&
        checksum(log.config.tools ?? null) === checksum(cur.tools ?? null) &&
        checksum(log.config.design ?? null) === checksum(cur.design ?? null) &&
        checksum(log.config.catalog ?? null) === checksum(cur.catalog ?? null);
      if (!same) return { ok: false, message: '这份存档的世界、物种、工具、设计数据或开局规则和当前不同，暂不支持载入' };
      const next = 'log' in parsed.data ? Session.restoreParsed(parsed.data) : Session.replay(log);
      this.replace(next);
      return { ok: true, message: `已${isSave ? '读档' : '回放'}到第 ${next.sim.day} 天` };
    } catch (e) {
      return { ok: false, message: `无法载入：${(e as Error).message}` };
    }
  }
}
