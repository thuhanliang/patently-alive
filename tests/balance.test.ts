import { describe, expect, it } from 'vitest';
import { grassland, scenarioLibrary, speciesFor, worldFor } from '../src/data';
import { balanceCheck } from '../src/sim/balance';
import { CAUSE, Sim, TICKS_PER_DAY, recentByCause } from '../src/sim';
import { decodeCause } from '../src/sim/ledger';
import { DAYS_PER_YEAR } from '../src/sim/time';

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

  it('鸟岛的转折：开局就没有猫时，鼠和兔更多，鸟的死因转向巢失败', () => {
    // GDD「情景走法」第 3 步：只清猫 → 鼠和兔反弹 → 尸检报告从"被捕食"变成"巢失败"。
    // 整座岛（128×128）、默认种子跑 3 年，比较第 3 年的年均数量和鸟的死因构成。
    const island = worldFor(scenarioLibrary.get('bird-island')!);
    const all = speciesFor(island);
    const run = (cats: boolean) => {
      const species = cats ? all : all.map((sp) => (sp.id === 'cat' ? { ...sp, initialDensityPerHa: 0 } : sp));
      const sim = Sim.create({ seed: 1, world: island, species });
      const ids = sim.species.map((sp) => sp.params.id);
      const sum = ids.map(() => 0);
      const causes = new Array<number>(sim.state.deaths.causes).fill(0);
      for (let d = 1; d <= 3 * DAYS_PER_YEAR; d++) {
        sim.stepN(TICKS_PER_DAY);
        if (d <= 2 * DAYS_PER_YEAR) continue;
        sim.totals().forEach((n, s) => (sum[s]! += n / DAYS_PER_YEAR));
        // 近期死因按 30 天半衰期累计，每 30 天取一次，约等于全年的构成。
        if (d % 30 === 0) recentByCause(sim.state.deaths, ids.indexOf('dotterel')).forEach((n, c) => (causes[c]! += n));
      }
      const all3 = causes.reduce((a, b) => a + b, 0);
      const nest = causes.filter((_, c) => decodeCause(c, ids.length).kind === 'nest');
      const byCat = causes[CAUSE.predation(ids.indexOf('cat'))]!;
      const mean = (id: string) => sum[ids.indexOf(id)]!;
      return { rat: mean('rat'), rabbit: mean('rabbit'), bird: mean('dotterel'), nestShare: nest.reduce((a, b) => a + b, 0) / all3, catShare: byCat / all3 };
    };
    const withCats = run(true);
    const noCats = run(false);
    const pct = (x: number) => `${Math.round(x * 100)}%`;
    console.info(
      `转折（第 3 年年均）：有猫 鼠 ${Math.round(withCats.rat)} 兔 ${Math.round(withCats.rabbit)} 鸟 ${Math.round(withCats.bird)}，` +
        `鸟死于猫 ${pct(withCats.catShare)}、巢失败 ${pct(withCats.nestShare)}；` +
        `没猫 鼠 ${Math.round(noCats.rat)} 兔 ${Math.round(noCats.rabbit)} 鸟 ${Math.round(noCats.bird)}，巢失败 ${pct(noCats.nestShare)}`,
    );
    if (noCats.rat < withCats.rat * 1.2) console.warn('⚠ 平衡报警（转折）：没有猫时鼠没有明显变多');
    if (noCats.rabbit < withCats.rabbit * 1.2) console.warn('⚠ 平衡报警（转折）：没有猫时兔没有明显变多');
    if (noCats.nestShare <= withCats.nestShare) console.warn('⚠ 平衡报警（转折）：没有猫时巢失败的比例没有上升');
    if (noCats.bird > withCats.bird * 1.1) console.warn('⚠ 平衡报警（转折）：只是没有猫，鸟就明显变多了，转折不成立');
    expect(withCats.catShare).toBeGreaterThan(0);
    expect(noCats.catShare).toBe(0);
  }, 600_000);
});
