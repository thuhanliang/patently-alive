import { describe, expect, it } from 'vitest';
import { FixedStepClock, Sim, canonicalJson, checksum } from '../src/sim';

/** 把一串帧间隔喂给时钟，按时钟给出的步数推进，返回最终状态。 */
function runWithFrames(seed: number, frames: number[]): Sim {
  const sim = Sim.create({ seed });
  const clock = new FixedStepClock({ stepMs: 50, maxStepsPerFrame: 1000 });
  for (const dt of frames) sim.stepN(clock.advance(dt));
  return sim;
}

describe('确定性', () => {
  it('同种子跑两次，状态逐位相同', () => {
    const a = Sim.create({ seed: 2026 });
    const b = Sim.create({ seed: 2026 });
    a.stepN(5000);
    b.stepN(5000);
    expect(canonicalJson(a.snapshot())).toBe(canonicalJson(b.snapshot()));
    expect(checksum(a.state)).toBe(checksum(b.state));
  });

  it('不同种子得到不同结果', () => {
    const a = Sim.create({ seed: 1 });
    const b = Sim.create({ seed: 2 });
    a.stepN(500);
    b.stepN(500);
    expect(checksum(a.state)).not.toBe(checksum(b.state));
  });

  it('结果只取决于 tick 数，与帧率和卡顿无关', () => {
    // 两种帧节奏，总时长都是 10 秒 = 200 个 tick。
    const smooth = runWithFrames(77, new Array<number>(500).fill(20));
    const janky = runWithFrames(77, [1, 999, 3, 2000, 497, 4000, 2500]);
    expect(smooth.tick).toBe(200);
    expect(janky.tick).toBe(200);
    expect(checksum(smooth.state)).toBe(checksum(janky.state));
  });

  it('快照恢复后继续推进，和一口气跑完完全一样', () => {
    const straight = Sim.create({ seed: 31337 });
    straight.stepN(2000);

    const first = Sim.create({ seed: 31337 });
    first.stepN(1234);
    const saved = JSON.parse(JSON.stringify(first.snapshot())) as ReturnType<Sim['snapshot']>;
    const resumed = new Sim(saved);
    resumed.stepN(2000 - 1234);

    expect(canonicalJson(resumed.snapshot())).toBe(canonicalJson(straight.snapshot()));
  });

  it('快照是深拷贝，改它不影响推演', () => {
    const sim = Sim.create({ seed: 5 });
    const before = checksum(sim.state);
    const snap = sim.snapshot();
    snap.tick = 999;
    snap.walkers[0]!.x = -1;
    expect(checksum(sim.state)).toBe(before);
  });

  it('长跑校验和固定（改了推演规则就要有意识地更新它）', () => {
    const sim = Sim.create({ seed: 1 });
    sim.stepN(10_000);
    expect(checksum(sim.state)).toMatchInlineSnapshot(`872471979`);
  });
});
