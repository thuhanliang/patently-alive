import { describe, expect, it } from 'vitest';
import { grassland } from '../src/data';
import { makeConfig, makeSim } from './helpers';
import { FixedStepClock, Sim, TICKS_PER_DAY, checksum, deserialize, serialize, type SimState } from '../src/sim';


/** 把一串帧间隔喂给时钟，按时钟给出的步数推进，返回最终状态。 */
function runWithFrames(seed: number, frames: number[]): Sim {
  const sim = makeSim(seed);
  const clock = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: 100_000 });
  for (const dt of frames) sim.stepN(clock.advance(dt));
  return sim;
}

describe('确定性', () => {
  it('同种子跑两次，状态逐位相同', () => {
    const a = makeSim(2026);
    const b = makeSim(2026);
    a.stepN(5000);
    b.stepN(5000);
    expect(serialize(a.snapshot())).toBe(serialize(b.snapshot()));
    expect(checksum(a.state)).toBe(checksum(b.state));
  });

  it('不同种子得到不同结果', () => {
    const a = makeSim(1);
    const b = makeSim(2);
    a.stepN(500);
    b.stepN(500);
    expect(checksum(a.state)).not.toBe(checksum(b.state));
  });

  it('结果只取决于 tick 数，与帧率和卡顿无关', () => {
    // 两种帧节奏，总时长都是 60 秒 = 1200 个 tick（50 天）。
    const smooth = runWithFrames(77, new Array<number>(3000).fill(20));
    const janky = runWithFrames(77, [1, 999, 3, 20_000, 497, 4000, 34_500]);
    expect(smooth.tick).toBe(1200);
    expect(janky.tick).toBe(1200);
    expect(checksum(smooth.state)).toBe(checksum(janky.state));
  });

  it('快照存成文本再恢复后继续推进，和一口气跑完完全一样', () => {
    const straight = makeSim(31337);
    straight.stepN(2000);

    const first = makeSim(31337);
    first.stepN(1234);
    const resumed = new Sim(deserialize<SimState>(serialize(first.snapshot())));
    resumed.stepN(2000 - 1234);

    expect(serialize(resumed.snapshot())).toBe(serialize(straight.snapshot()));
  });

  it('快照是深拷贝，改它不影响推演', () => {
    const sim = makeSim(5);
    const before = checksum(sim.state);
    const snap = sim.snapshot();
    snap.tick = 999;
    snap.grid.vegetation[0] = -1;
    expect(checksum(sim.state)).toBe(before);
  });

  it('长跑校验和固定（改了推演规则就要有意识地更新它）', () => {
    const sim = Sim.create(makeConfig(1, { ...grassland, width: 48, height: 48 }));
    sim.stepN(TICKS_PER_DAY * 360 * 2);
    expect(checksum(sim.state)).toMatchInlineSnapshot(`1419134994`);
  });
});
