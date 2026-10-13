import { SEASON_NAMES, TICKS_PER_DAY, calendar, checksum, type SimState } from '../sim';

/** 左上角的状态读数：种子、日期、植被、倍速、状态校验和。 */
export class Hud {
  private lastDay = -1;
  private sum = 0;
  private meanVeg = 0;

  constructor(private readonly el: HTMLElement) {}

  update(state: Readonly<SimState>, speed: number): void {
    // 校验和与平均植被都要遍历整张地图，每天算一次（取当天开始时的状态）。
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    if (day !== this.lastDay) {
      this.sum = checksum(state);
      const veg = state.grid.vegetation;
      let total = 0;
      for (let i = 0; i < veg.length; i++) total += veg[i]!;
      this.meanVeg = total / veg.length;
      this.lastDay = day;
    }
    const d = calendar(state.tick);
    this.el.textContent = [
      `种子   ${state.config.seed}`,
      `日期   第 ${d.year + 1} 年 ${d.month + 1} 月 ${d.dayOfMonth + 1} 日 ${String(d.hour).padStart(2, '0')}:00（${SEASON_NAMES[d.season]}）`,
      `天气   ${state.weather.toFixed(2)}`,
      `植被   平均 ${this.meanVeg.toFixed(0)} g/m²`,
      `倍速   ${speed}x`,
      `校验和 ${this.sum.toString(16).padStart(8, '0')}（当天开始时）`,
    ].join('\n');
  }
}
