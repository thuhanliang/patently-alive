import type { SimState } from '../sim';

/**
 * 种群曲线的数据：每天记一次各物种总数和平均植被，环形缓冲。
 * 只是界面上的记录，不属于推演状态。
 */
export class PopulationHistory {
  readonly capacity: number;
  /** series[s][i]：第 s 条线的第 i 个点（按时间顺序展开后）。最后一条是平均植被。 */
  private readonly buf: Float64Array[];
  private readonly days: Int32Array;
  private start = 0;
  private count = 0;
  private lastDay = -1;

  constructor(
    readonly labels: readonly string[],
    capacity = 360 * 12,
  ) {
    this.capacity = capacity;
    this.buf = labels.map(() => new Float64Array(capacity));
    this.days = new Int32Array(capacity);
  }

  /** 每天最多记一次；同一天重复调用会被忽略。 */
  record(day: number, state: Readonly<SimState>): void {
    if (day === this.lastDay) return;
    this.lastDay = day;
    const i = (this.start + this.count) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
    else this.start = (this.start + 1) % this.capacity;
    this.days[i] = day;
    state.lastDay.forEach((d, s) => (this.buf[s]![i] = d.total));
    const veg = state.grid.vegetation;
    let total = 0;
    for (let k = 0; k < veg.length; k++) total += veg[k]!;
    this.buf[this.buf.length - 1]![i] = total / veg.length;
  }

  get length(): number {
    return this.count;
  }

  value(series: number, i: number): number {
    return this.buf[series]![(this.start + i) % this.capacity]!;
  }

  day(i: number): number {
    return this.days[(this.start + i) % this.capacity]!;
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
    this.lastDay = -1;
  }
}
