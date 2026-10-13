import { describe, expect, it } from 'vitest';
import { grassland, scenarioLibrary, speciesFor, worldFor } from '../src/data';
import { balanceCheck } from '../src/sim/balance';

/**
 * 平衡回归：默认草原跑 10 年，看有没有物种在头 3 年灭绝、或者爆炸到开局的 20 倍以上。
 * 只报警、不让测试失败（PHASE0：只做报警，不做硬性要求）。
 * 地图取 64×64 控制耗时；小地图上偶然灭绝更常见，报警时先用 npm run sweep 在 128×128 上复核。
 */
describe('平衡回归（只报警）', () => {
  it('默认草原 10 年', () => {
    const world = { ...grassland, width: 64, height: 64 };
    const report = balanceCheck({ seed: 1, world, species: speciesFor(world) }, 10);
    for (const alarm of report.alarms) console.warn(`⚠ 平衡报警：${alarm}`);
    const summary = report.species.map((s) => `${s.id} ${s.min}–${s.max}（年际变异 ${s.yearlyCv.toFixed(2)}）`).join('；');
    console.info(`平衡：${summary}`);
    // 报告本身要完整：每个物种都有 10 年的日序列。
    expect(report.species.every((s) => s.daily.length === 10 * 360)).toBe(true);
  }, 600_000);

  it('鸟岛 6 年', () => {
    // 鸟岛的地形按地图尺寸缩放，64×64 是一座小一号的岛（三座离岸小岛放不下时会少放）。
    const island = worldFor(scenarioLibrary.get('bird-island')!);
    const world = { ...island, width: 64, height: 64 };
    const report = balanceCheck({ seed: 1, world, species: speciesFor(world) }, 6);
    for (const alarm of report.alarms) console.warn(`⚠ 平衡报警（鸟岛）：${alarm}`);
    const summary = report.species.map((s) => `${s.id} ${s.min}–${s.max}，年均 [${s.yearlyMeans.map(Math.round).join(' ')}]`).join('；');
    console.info(`平衡（鸟岛）：${summary}`);
    expect(report.species.every((s) => s.daily.length === 6 * 360)).toBe(true);
  }, 600_000);
});
