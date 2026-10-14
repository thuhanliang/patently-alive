import { TICKS_PER_DAY, causeName, recentByCause, type SimState } from '../sim';

/**
 * 左侧的"近期死因"：每个物种近期（按 30 天半衰期加权）死得最多的三种死因及占比。
 * 每天更新一次。尸检和死因热力图之前，这是看"鸟为什么少"的第一个地方。
 */
export class DeathPanel {
  private lastDay = -1;

  constructor(
    private readonly el: HTMLElement,
    /** 物种名，按物种下标排；引进新物种后换掉。 */
    public names: readonly string[],
  ) {}

  reset(): void {
    this.lastDay = -1;
  }

  update(state: Readonly<SimState>): void {
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    if (day === this.lastDay) return;
    this.lastDay = day;
    const lines = ['近期死因（越近的权重越大，半衰期 30 天）'];
    this.names.forEach((name, s) => {
      const byCause = recentByCause(state.deaths, s);
      const total = byCause.reduce((a, b) => a + b, 0);
      if (total < 0.5) {
        lines.push(`${name}：—`);
        return;
      }
      const top = byCause
        .map((n, cause) => ({ n, cause }))
        .filter((x) => x.n / total >= 0.01)
        .sort((a, b) => b.n - a.n || a.cause - b.cause)
        .slice(0, 3)
        .map((x) => `${causeName(x.cause, this.names)} ${Math.round((100 * x.n) / total)}%`);
      lines.push(`${name}：${top.join('，')}`);
    });
    this.el.textContent = lines.join('\n');
  }
}
