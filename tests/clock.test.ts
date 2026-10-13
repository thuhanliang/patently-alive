import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../src/sim';

describe('FixedStepClock', () => {
  it('按固定步长换算，余下的时间留到下一帧', () => {
    const c = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: 100 });
    expect(c.advance(30)).toBe(0);
    expect(c.advance(30)).toBe(1);
    expect(c.advance(90)).toBe(2);
  });

  it('倍速与暂停', () => {
    const c = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: 100 });
    c.speed = 10;
    expect(c.advance(50)).toBe(10);
    c.speed = 0;
    expect(c.advance(1000)).toBe(0);
  });

  it('一帧推进的步数有上限，超出的时间丢弃', () => {
    const c = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: 5 });
    expect(c.advance(10_000)).toBe(5);
    expect(c.advance(10)).toBe(0);
  });

  it('忽略非正数和非数的时间', () => {
    const c = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: 5 });
    expect(c.advance(-100)).toBe(0);
    expect(c.advance(Number.NaN)).toBe(0);
  });
});
