import type { Tools } from '../data';
import { calendar, TICKS_PER_DAY, type SimState } from '../sim';

/** 左侧的"最近捕获"：陷阱里抓到了什么、怎么处理的（最近几条）。 */
export class CapturePanel {
  private shown = -1;

  constructor(
    private readonly el: HTMLElement,
    private readonly names: readonly string[],
    private readonly tools: Tools | undefined,
  ) {}

  reset(): void {
    this.shown = -1;
  }

  update(state: Readonly<SimState>): void {
    const caps = state.captures;
    const last = caps.length > 0 ? caps[caps.length - 1]! : null;
    const key = last ? last.day * 1000 + caps.length : 0;
    if (key === this.shown) return;
    this.shown = key;
    this.el.style.display = caps.length > 0 ? '' : 'none';
    const lines = ['最近捕获'];
    for (const c of caps.slice(-8).reverse()) {
      const d = calendar(c.day * TICKS_PER_DAY);
      const trap = this.tools?.traps[c.trap]?.name ?? '陷阱';
      const who = `${this.names[c.species]}（${c.juvenile ? '幼' : '成年'}${c.female ? '雌' : '雄'}）`;
      lines.push(`第${d.year + 1}年${d.month + 1}月${d.dayOfMonth + 1}日 ${trap}#${c.job}：${who} → ${c.removed ? '移除' : '放生'}`);
    }
    this.el.textContent = lines.join('\n');
  }
}
