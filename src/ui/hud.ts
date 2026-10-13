import { SEASON_NAMES, calendar, checksum, type SimState } from '../sim';

/** 左上角的状态读数：种子、日期、植被、倍速、状态校验和。 */
export class Hud {
  private lastTick = -1;
  private sum = 0;

  constructor(private readonly el: HTMLElement) {}

  update(state: Readonly<SimState>, speed: number): void {
    // 校验和要遍历整张地图，tick 不变就不重算。
    if (state.tick !== this.lastTick) {
      this.sum = checksum(state);
      this.lastTick = state.tick;
    }
    const d = calendar(state.tick);
    const veg = state.grid.vegetation;
    let total = 0;
    for (let i = 0; i < veg.length; i++) total += veg[i]!;
    this.el.textContent = [
      `种子   ${state.config.seed}`,
      `日期   第 ${d.year + 1} 年 ${d.month + 1} 月 ${d.dayOfMonth + 1} 日 ${String(d.hour).padStart(2, '0')}:00（${SEASON_NAMES[d.season]}）`,
      `天气   ${state.weather.toFixed(2)}`,
      `植被   平均 ${(total / veg.length).toFixed(0)} g/m²`,
      `倍速   ${speed}x`,
      `校验和 ${this.sum.toString(16).padStart(8, '0')}`,
    ].join('\n');
  }
}
