import { QUARTER_DAYS, SEASON_NAMES, calendar } from '../sim';
import type { SessionReadout } from '../runtime/remote';

/**
 * 状态读数，分两处：
 * - 左上角的纸条：日期、季节、天气，下面一排资源纸签（预算、兽医队、满意度、委托进度）——玩的时候要看的；
 * - 笔记本"文件"页：种子、倍速、个体、日志条数、状态校验和——查问题、对存档时才看的。
 */
export class Hud {
  private ribbonKey = '';
  private debugText = '';
  private readonly date = document.createElement('div');
  private readonly chips = document.createElement('div');

  constructor(
    ribbon: HTMLElement,
    private readonly debug: HTMLElement,
  ) {
    this.date.className = 'date strip';
    this.chips.className = 'chips';
    ribbon.append(this.date, this.chips);
  }

  /** 换了一局时强制重写一遍。 */
  reset(): void {
    this.ribbonKey = '';
    this.debugText = '';
  }

  update(session: SessionReadout): void {
    const state = session.sim.state;
    const d = calendar(state.tick);
    const res = session.resources;
    const scenario = session.rules.scenario !== null && !session.rules.allowRelease;
    const chips: [string, string][] = scenario
      ? [
          ['预算', `${res.budget.toLocaleString('zh-CN')} 元`],
          ['兽医队', `空闲 ${session.freeStaff} / ${res.busyUntil.length}`],
          ['满意度', `${Math.round(res.satisfaction)}`],
          ...(session.totalQuarters > 0
            ? ([
                session.ended
                  ? ['委托', `已结束（${session.totalQuarters} 季）`]
                  : ['委托', `第 ${session.quarters.length + 1} / ${session.totalQuarters} 季，第 ${(session.quarters.length + 1) * QUARTER_DAYS} 天结算`],
              ] as [string, string][])
            : []),
        ]
      : [['沙盒', '资源不限，可以投放']];
    const weather = weatherOf(state.weather);
    // 每帧都会调用；内容没变就不碰 DOM。
    const key = `${d.year}:${d.month}:${d.dayOfMonth}:${d.season}:${weather}:${chips.map((c) => c.join('')).join('|')}`;
    if (key !== this.ribbonKey) {
      this.ribbonKey = key;
      this.date.innerHTML = `${WEATHER_ICONS[weather]}<span>第 ${d.year + 1} 年 ${d.month + 1} 月 ${d.dayOfMonth + 1} 日</span><span class="sep"></span><span>${SEASON_NAMES[d.season]}季</span>`;
      this.date.title = `天气：${WEATHER_NAMES[weather]}（${state.weather.toFixed(2)}，1 为平常年景）`;
      this.chips.replaceChildren(
        ...chips.map(([k, v]) => {
          const c = document.createElement('span');
          c.className = 'chip kraft';
          const b = document.createElement('b');
          b.textContent = k;
          c.append(b, ` ${v}`);
          return c;
        }),
      );
    }
    const text = [
      `种子   ${state.config.seed}`,
      `时刻   ${String(d.hour).padStart(2, '0')}:00`,
      `天气   ${state.weather.toFixed(2)}`,
      `植被   陆地平均 ${session.meanVegetation.toFixed(0)} g/m²`,
      `倍速   ${session.speed}x`,
      `个体   ${state.focus ? `展开 ${state.individuals.count} 只（${state.focus.x1 - state.focus.x0}×${state.focus.y1 - state.focus.y0} 格）` : '未展开（放大到地块档）'}`,
      `日志   ${session.entryCount} 条操作`,
      `校验和 ${session.dayChecksum.toString(16).padStart(8, '0')}（当天开始时）`,
    ].join('\n');
    if (text !== this.debugText) {
      this.debugText = text;
      this.debug.textContent = text;
    }
  }
}

type Weather = 'good' | 'fair' | 'poor';
const WEATHER_NAMES: Record<Weather, string> = { good: '好年景', fair: '平常', poor: '年景差' };
/** 天气是推演里的年景倍数（1 为平常）；纸条上只画三种。 */
function weatherOf(w: number): Weather {
  return w >= 1.05 ? 'good' : w <= 0.95 ? 'poor' : 'fair';
}
/** 代码画的剪纸小图标：太阳是一片橙纸加一圈三角，云是两层灰白纸。 */
const SUN = '<circle cx="16" cy="16" r="7" fill="#f0a64a" stroke="#c97a26" stroke-width="1"/>';
const RAYS = Array.from({ length: 8 }, (_, i) => {
  const a = (i * Math.PI) / 4;
  const p = (r: number, da: number): string => `${(16 + r * Math.cos(a + da)).toFixed(1)},${(16 + r * Math.sin(a + da)).toFixed(1)}`;
  return `<polygon points="${p(9.5, -0.22)} ${p(15, 0)} ${p(9.5, 0.22)}" fill="#f0a64a"/>`;
}).join('');
const CLOUD = (y: number, fill: string): string =>
  `<path d="M7 ${y + 8} q0 -6 6 -6 q2 -5 8 -3 q6 0 6 6 q3 1 2 3 z" fill="${fill}" stroke="rgba(74,58,40,.35)" stroke-width="1"/>`;
const WEATHER_ICONS: Record<Weather, string> = {
  good: `<svg viewBox="0 0 32 32">${RAYS}${SUN}</svg>`,
  fair: `<svg viewBox="0 0 32 32"><g transform="translate(-4 -4)">${RAYS}${SUN}</g>${CLOUD(14, '#f4ede0')}</svg>`,
  poor: `<svg viewBox="0 0 32 32">${CLOUD(6, '#c9c2b6')}${CLOUD(13, '#e6dfd2')}<path d="M12 27 l-2 3 M17 27 l-2 3 M22 27 l-2 3" stroke="#6f8fb0" stroke-width="1.6"/></svg>`,
};
