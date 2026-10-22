import { TICKS_PER_DAY, causeName, decodeCause, recentByCause, type SimState } from '../sim';

/**
 * 笔记本"死因"页：每个物种一张纸条，一根按死因分段的纸条（近期死亡，按 30 天半衰期加权），下面写出最多的三种和占比。
 * 每天更新一次。尸检和死因热力图之前，这是看"鸟为什么少"的第一个地方。
 * 颜色：被谁吃了用那个捕食者的主色（巢失败加斜线）；饿死、营养不良用赭黄；其他用灰牛皮；人为移除用蓝图蓝（玩家的干预）。
 * 朱红只留给警报，这里不用。
 */
export class DeathPanel {
  private lastDay = -1;

  constructor(
    private readonly el: HTMLElement,
    /** 物种名，按物种下标排；引进新物种后换掉。 */
    public names: readonly string[],
    /** 各物种在图表里的主色，按物种下标排。 */
    public colors: readonly number[],
  ) {}

  reset(): void {
    this.lastDay = -1;
  }

  update(state: Readonly<SimState>): void {
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    if (day === this.lastDay) return;
    this.lastDay = day;
    const head = document.createElement('div');
    head.className = 'dp-head';
    head.textContent = '近期死因（越近的权重越大，半衰期 30 天）';
    const rows = this.names.map((name, s) => {
      const row = document.createElement('div');
      row.className = 'dp-row';
      const title = document.createElement('div');
      title.className = 'dp-name';
      title.innerHTML = `<i style="background:${hex(this.colors[s] ?? 0x8a7a66)}"></i><span></span>`;
      title.querySelector('span')!.textContent = name;
      row.appendChild(title);
      const byCause = recentByCause(state.deaths, s);
      const total = byCause.reduce((a, b) => a + b, 0);
      if (total < 0.5) {
        const none = document.createElement('div');
        none.className = 'dp-none';
        none.textContent = '近期没有死亡';
        row.appendChild(none);
        return row;
      }
      const parts = byCause
        .map((n, cause) => ({ n, cause }))
        .filter((x) => x.n / total >= 0.01)
        .sort((a, b) => b.n - a.n || a.cause - b.cause);
      const label = (p: { n: number; cause: number }): string => `${causeName(p.cause, this.names)} ${Math.round((100 * p.n) / total)}%`;
      const bar = document.createElement('div');
      bar.className = 'dp-bar';
      for (const p of parts) {
        const seg = document.createElement('b');
        seg.style.flexGrow = String(p.n);
        seg.style.background = this.fill(p.cause);
        seg.title = label(p);
        bar.appendChild(seg);
      }
      const legend = document.createElement('div');
      legend.className = 'dp-legend';
      for (const p of parts.slice(0, 3)) {
        const item = document.createElement('span');
        item.innerHTML = `<i style="background:${this.fill(p.cause)}"></i>`;
        item.append(label(p));
        legend.appendChild(item);
      }
      row.append(bar, legend);
      return row;
    });
    this.el.replaceChildren(head, ...rows);
  }

  /** 死因的填充（CSS background）。 */
  private fill(cause: number): string {
    const d = decodeCause(cause, this.names.length);
    switch (d.kind) {
      case 'predation':
        return hex(this.colors[d.predator] ?? 0x8a7a66);
      case 'nest':
        return `repeating-linear-gradient(135deg, ${hex(this.colors[d.predator] ?? 0x8a7a66)} 0 4px, #f2e6c9 4px 6px)`;
      case 'starvation':
        return '#c9a24a';
      case 'malnutrition':
        return '#dcc58a';
      case 'removed':
        return 'var(--blueprint)';
      case 'fracture':
        return '#8a7a66';
      case 'dystocia':
        return '#a98a74';
      case 'other':
        return '#bdb19c';
    }
  }
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;
