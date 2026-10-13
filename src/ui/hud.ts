import { QUARTER_DAYS, SEASON_NAMES, calendar } from '../sim';
import type { SessionReadout } from '../runtime/remote';

/** 左上角的状态读数：资源（情景里）、日期、植被、倍速、个体、日志、状态校验和。 */
export class Hud {
  private text = '';

  constructor(private readonly el: HTMLElement) {}

  /** 换了一局时强制重写一遍。 */
  reset(): void {
    this.text = '';
  }

  update(session: SessionReadout): void {
    const state = session.sim.state;
    const speed = session.speed;
    const logLength = session.entryCount;
    // 平均植被和校验和由 Worker 每天 0 点算好送来。
    const d = calendar(state.tick);
    const res = session.resources;
    const resources = session.rules.scenario !== null && !session.rules.allowRelease
      ? [
          `预算   ${res.budget.toLocaleString('zh-CN')} 元`,
          `兽医队 空闲 ${session.freeStaff} / ${res.busyUntil.length} 支`,
          `满意度 ${Math.round(res.satisfaction)} / 100`,
          ...(session.totalQuarters > 0
            ? [
                session.ended
                  ? `委托   已结束（${session.totalQuarters} 季）`
                  : `委托   第 ${session.quarters.length + 1} / ${session.totalQuarters} 季，第 ${(session.quarters.length + 1) * QUARTER_DAYS} 天结算`,
              ]
            : []),
        ]
      : ['沙盒   资源不限，可以投放'];
    const text = [
      ...resources,
      `种子   ${state.config.seed}`,
      `日期   第 ${d.year + 1} 年 ${d.month + 1} 月 ${d.dayOfMonth + 1} 日 ${String(d.hour).padStart(2, '0')}:00（${SEASON_NAMES[d.season]}）`,
      `天气   ${state.weather.toFixed(2)}`,
      `植被   陆地平均 ${session.meanVegetation.toFixed(0)} g/m²`,
      `倍速   ${speed}x`,
      `个体   ${state.focus ? `展开 ${state.individuals.count} 只（${state.focus.x1 - state.focus.x0}×${state.focus.y1 - state.focus.y0} 格）` : '未展开（放大到地块档）'}`,
      `日志   ${logLength} 条操作`,
      `校验和 ${session.dayChecksum.toString(16).padStart(8, '0')}（当天开始时）`,
    ].join('\n');
    // 每帧都会调用；内容没变就不碰 DOM。
    if (text !== this.text) {
      this.text = text;
      this.el.textContent = text;
    }
  }
}
