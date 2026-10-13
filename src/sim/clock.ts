/**
 * 固定步长时钟：把外部传进来的真实流逝时间换算成要推进的 tick 数。
 *
 * 它自己不读系统时钟，时间由调用方（渲染循环）传入，所以模拟内核仍然与真实时间无关。
 * 推演结果只取决于 tick 数，帧率高低、卡顿与否只影响"多快看到"，不影响"看到什么"。
 */
export interface FixedStepClockOptions {
  /** 1 倍速下每个 tick 对应的真实毫秒数。 */
  stepMs: number;
  /** 每帧最多推进的 tick 数，防止卡顿后一次追太多步把画面拖死；超出的时间直接丢弃。 */
  maxStepsPerFrame: number;
}

export class FixedStepClock {
  readonly stepMs: number;
  readonly maxStepsPerFrame: number;
  /** 倍速；0 表示暂停。 */
  speed = 1;
  private accumulatorMs = 0;

  constructor(options: FixedStepClockOptions) {
    if (!(options.stepMs > 0)) throw new RangeError('stepMs 必须大于 0');
    if (!Number.isInteger(options.maxStepsPerFrame) || options.maxStepsPerFrame < 1) {
      throw new RangeError('maxStepsPerFrame 必须是正整数');
    }
    this.stepMs = options.stepMs;
    this.maxStepsPerFrame = options.maxStepsPerFrame;
  }

  /** 传入这一帧流逝的真实毫秒数，返回这一帧应该推进几个 tick。 */
  advance(elapsedMs: number): number {
    if (this.speed <= 0 || !(elapsedMs > 0)) return 0;
    this.accumulatorMs += elapsedMs * this.speed;
    let steps = Math.floor(this.accumulatorMs / this.stepMs);
    if (steps > this.maxStepsPerFrame) {
      steps = this.maxStepsPerFrame;
      this.accumulatorMs = 0;
    } else {
      this.accumulatorMs -= steps * this.stepMs;
    }
    return steps;
  }

  reset(): void {
    this.accumulatorMs = 0;
  }
}
