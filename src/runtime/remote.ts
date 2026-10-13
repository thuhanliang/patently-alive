import { TICKS_PER_DAY, type Op, type Quarter, type Resources, type Rules, type SimConfig, type SimState, type SubmitResult, type DerivedSpecies, type Alert } from '../sim';
import { deriveAll } from '../sim/physiology';
import type { DayRecord, FromHost, Reply, SessionView, ToHost } from './host';

/**
 * 界面读一局用的接口：主线程上没有 Session，只有 Worker 发来的最新视图。
 * Hud、委托卡片等只依赖这个接口。
 */
export interface SessionReadout {
  readonly sim: { readonly state: SimState; readonly species: readonly DerivedSpecies[]; readonly tick: number; readonly day: number };
  readonly rules: Rules;
  readonly speed: number;
  readonly resources: Readonly<Resources>;
  readonly freeStaff: number;
  readonly entryCount: number;
  readonly quarters: readonly Quarter[];
  readonly ended: boolean;
  readonly totalQuarters: number;
  readonly money: { spent: number; received: number };
  readonly removed: readonly number[];
  readonly alerts: readonly Alert[];
  readonly dayChecksum: number;
  readonly meanVegetation: number;
}

/** 主线程这边的"一局"：转发操作给 Worker，保存 Worker 发来的最新视图。 */
export class RemoteSession implements SessionReadout {
  private latest: SessionView | null = null;
  private state: SimState | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (r: Reply) => void; reject: (e: Error) => void }>();
  /** Worker 那边是不是挂起着（以视图为准；Worker 结算后会自己挂起）。 */
  private held: boolean;
  /** 新视图到了：days 是这次视图带来的每日曲线数据，regenerated 表示换了一局。 */
  onView: (days: DayRecord[], regenerated: boolean) => void = () => {};
  onError: (message: string) => void = () => {};
  readonly species: readonly DerivedSpecies[];

  constructor(
    private readonly worker: Worker,
    config: SimConfig,
    readonly rules: Rules,
    speed: number,
    held: boolean,
  ) {
    this.species = deriveAll(config.species, config.world.cellSizeM).derived;
    this.held = held;
    worker.onmessage = (e: MessageEvent<FromHost>) => this.receive(e.data);
    worker.onerror = (e: ErrorEvent) => this.fail(e.message || 'Worker 出错了');
    this.send({ t: 'init', config, rules, speed, held });
  }

  private waiters: Array<() => void> = [];

  /** 下一份视图到了之后调用 f（只调一次）。 */
  afterNextView(f: () => void): void {
    this.waiters.push(f);
  }

  /** Worker 整个出错了：报告，所有还在等的请求都失败。 */
  private fail(message: string): void {
    this.onError(message);
    for (const p of this.pending.values()) p.reject(new Error(message));
    this.pending.clear();
  }

  private receive(msg: FromHost): void {
    if (msg.t === 'error') {
      this.onError(msg.message);
      return;
    }
    if (msg.t === 'view') {
      const v = msg.view;
      const regenerated = this.latest !== null && v.generation !== this.latest.generation;
      this.latest = v;
      this.held = v.held;
      if (v.state) this.state = v.state;
      this.onView(v.days, regenerated);
      const waiters = this.waiters;
      this.waiters = [];
      for (const f of waiters) f();
      return;
    }
    const p = this.pending.get(msg.id);
    this.pending.delete(msg.id);
    if (msg.t === 'failed') p?.reject(new Error(msg.message));
    else p?.resolve(msg);
  }

  /** 主线程画完一帧，要下一份视图。 */
  requestFrame(): void {
    this.send({ t: 'frame' });
  }

  private send(msg: ToHost): void {
    this.worker.postMessage(msg);
  }

  private request<R extends Reply>(make: (id: number) => ToHost): Promise<R> {
    const id = this.nextId++;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: Reply) => void, reject });
      this.send(make(id));
    });
  }

  /** 提交操作；Worker 出错时当作被拒绝（带原因）。 */
  submit(op: Op): Promise<SubmitResult> {
    return this.request<Extract<Reply, { t: 'submitted' }>>((id) => ({ t: 'submit', id, op })).then(
      (r) => r.result,
      (e: Error) => ({ ok: false as const, reason: `推演出错：${e.message}` }),
    );
  }

  /** 卡片打开时让推演停着。和 Worker 那边（最新视图）不一样时才发消息。 */
  hold(on: boolean): void {
    if (on === this.held) return;
    this.held = on;
    this.send({ t: 'hold', on });
  }

  stepDay(): void {
    this.send({ t: 'stepDay' });
  }

  reseed(seed: number): void {
    this.send({ t: 'reseed', seed });
  }

  saveText(): Promise<{ text: string; day: number }> {
    return this.request<Extract<Reply, { t: 'text' }>>((id) => ({ t: 'save', id }));
  }

  logText(): Promise<{ text: string; day: number }> {
    return this.request<Extract<Reply, { t: 'text' }>>((id) => ({ t: 'exportLog', id }));
  }

  load(text: string): Promise<{ ok: boolean; message: string }> {
    return this.request<Extract<Reply, { t: 'loaded' }>>((id) => ({ t: 'load', id, text }));
  }

  private get v(): SessionView {
    if (!this.latest) throw new Error('推演还没准备好');
    return this.latest;
  }

  get sim(): SessionReadout['sim'] {
    const state = this.state!;
    const tick = this.v.tick;
    return { state, species: this.species, tick, day: Math.floor(tick / TICKS_PER_DAY) };
  }

  get speed(): number {
    return this.v.speed;
  }
  get resources(): Readonly<Resources> {
    return this.v.resources;
  }
  get freeStaff(): number {
    return this.v.freeStaff;
  }
  get entryCount(): number {
    return this.v.entries;
  }
  get quarters(): readonly Quarter[] {
    return this.v.quarters;
  }
  get ended(): boolean {
    return this.v.ended;
  }
  get totalQuarters(): number {
    return this.v.totalQuarters;
  }
  get money(): { spent: number; received: number } {
    return this.v.money;
  }
  get removed(): readonly number[] {
    return this.v.removed;
  }
  get alerts(): readonly Alert[] {
    return this.v.alerts;
  }
  get dayChecksum(): number {
    return this.v.dayChecksum;
  }
  get meanVegetation(): number {
    return this.v.meanVegetation;
  }
}
