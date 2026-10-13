import type { Tools } from '../data';
import { calendar, causeName, TICKS_PER_DAY, type SimState } from '../sim';

/**
 * 左侧的"野外记录"：陷阱里抓到了什么、怎么处理的；找尸体带回了什么（最近几条）。
 * 尸检这里只列引擎记下的死因；临床口吻的尸检报告在第 6 步。
 */
export class CapturePanel {
  // 上次显示时最后一条记录（对象本身）：记录只追加，换了对象就说明有新的。
  private lastCapture: unknown = null;
  private lastSearch: unknown = null;
  private drawn = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly names: readonly string[],
    private readonly tools: Tools | undefined,
  ) {}

  reset(): void {
    this.drawn = false;
  }

  update(state: Readonly<SimState>): void {
    const caps = state.captures;
    const nec = state.necropsies;
    const lastCapture = caps[caps.length - 1] ?? null;
    const lastSearch = nec[nec.length - 1] ?? null;
    if (this.drawn && lastCapture === this.lastCapture && lastSearch === this.lastSearch) return;
    this.drawn = true;
    this.lastCapture = lastCapture;
    this.lastSearch = lastSearch;
    this.el.style.display = caps.length + nec.length > 0 ? '' : 'none';
    const lines: string[] = [];
    if (nec.length > 0) {
      lines.push('找尸体');
      for (const n of nec.slice(-3).reverse()) {
        const want = n.species >= 0 ? `${this.names[n.species]}的` : '';
        if (n.found.length === 0) {
          lines.push(`${date(n.day)} #${n.job}：没找到${want}新鲜尸体`);
          continue;
        }
        const items = n.found.map((c) => `${this.names[c.species]}（${causeName(c.cause, this.names)}，死后约 ${c.daysDead + 1} 天）`);
        lines.push(`${date(n.day)} #${n.job}：${items.join('；')}`);
      }
    }
    if (caps.length > 0) {
      lines.push('最近捕获');
      for (const c of caps.slice(-8).reverse()) {
        const trap = this.tools?.traps[c.trap]?.name ?? '陷阱';
        const who = `${this.names[c.species]}（${c.juvenile ? '幼' : '成年'}${c.female ? '雌' : '雄'}）`;
        lines.push(`${date(c.day)} ${trap}#${c.job}：${who} → ${c.removed ? '移除' : '放生'}`);
      }
    }
    this.el.textContent = lines.join('\n');
  }
}

function date(day: number): string {
  const d = calendar(day * TICKS_PER_DAY);
  return `第${d.year + 1}年${d.month + 1}月${d.dayOfMonth + 1}日`;
}
