import { SEASON_NAMES, TICKS_PER_DAY, calendar, checksum, meanLandVegetation, type Session } from '../sim';

/** 左上角的状态读数：资源（情景里）、日期、植被、倍速、个体、日志、状态校验和。 */
export class Hud {
  private lastDay = -1;
  private sum = 0;
  private meanVeg = 0;

  constructor(private readonly el: HTMLElement) {}

  /** 换了一局时清掉按天缓存的数值。 */
  reset(): void {
    this.lastDay = -1;
  }

  update(session: Session): void {
    const state = session.sim.state;
    const speed = session.speed;
    const logLength = session.entries.length;
    // 校验和与平均植被都要遍历整张地图，每天算一次（取当天开始时的状态）。
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    if (day !== this.lastDay) {
      this.sum = checksum(state);
      this.meanVeg = meanLandVegetation(state.grid);
      this.lastDay = day;
    }
    const d = calendar(state.tick);
    const res = session.resources;
    const resources = session.rules.scenario !== null && !session.rules.allowRelease
      ? [
          `预算   ${res.budget.toLocaleString('zh-CN')} 元`,
          `兽医队 空闲 ${session.freeStaff()} / ${res.busyUntil.length} 支`,
          `满意度 ${Math.round(res.satisfaction)} / 100`,
        ]
      : ['沙盒   资源不限，可以投放'];
    this.el.textContent = [
      ...resources,
      `种子   ${state.config.seed}`,
      `日期   第 ${d.year + 1} 年 ${d.month + 1} 月 ${d.dayOfMonth + 1} 日 ${String(d.hour).padStart(2, '0')}:00（${SEASON_NAMES[d.season]}）`,
      `天气   ${state.weather.toFixed(2)}`,
      `植被   陆地平均 ${this.meanVeg.toFixed(0)} g/m²`,
      `倍速   ${speed}x`,
      `个体   ${state.focus ? `展开 ${state.individuals.count} 只（${state.focus.x1 - state.focus.x0}×${state.focus.y1 - state.focus.y0} 格）` : '未展开（放大到地块档）'}`,
      `日志   ${logLength} 条操作`,
      `校验和 ${this.sum.toString(16).padStart(8, '0')}（当天开始时）`,
    ].join('\n');
  }
}
