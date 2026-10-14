import type { Scenario } from '../data';
import { QUARTERS_PER_YEAR, SCORE_KEYS, SEASON_NAMES, type Quarter } from '../sim';
import type { SessionReadout } from '../runtime/remote';
import { SCORE_LABELS, scoreRows } from './scoreText';

/**
 * 委托的流程卡片：开局的历史卡与委托信、每季的结算单、委托结束的总结。
 * 卡片打开时推演不走（由 main 看 isOpen 决定），关上才继续。只读 Session，不改任何东西。
 */
export class CommissionCards {
  private open = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly scenario: Scenario,
    /** 物种 id，顺序和各方法收到的 names 一致；引进新物种后换掉。 */
    public speciesIds: readonly string[],
  ) {}

  get isOpen(): boolean {
    return this.open;
  }

  close(): void {
    this.open = false;
    this.el.replaceChildren();
    this.el.style.display = 'none';
  }

  /** 开局：档案馆的历史卡 + 委托人来信 + 目标和评分怎么算。 */
  briefing(names: readonly string[]): void {
    const { history, client, goal } = this.scenario;
    const target = this.nameOf(goal.target, names);
    const years = goal.years;
    const body: HTMLElement[] = [
      heading(history.title),
      ...history.paragraphs.map((t) => para(t)),
      para(`出处：${history.source}`, 'note'),
      heading(`委托 · ${client.name}`),
      ...client.letter.map((t) => para(t)),
      heading('委托目标'),
      para(
        `${years} 年为期，每季度结算一次。第一年记下${target}各季的数量作为基准；之后每一季和第一年同一季比，` +
          `达到 ${goal.recovery} 倍算完全恢复。委托人按恢复情况调整满意度，按满意度拨下一季的经费。`,
      ),
      para(
        `评分分五项、分开看，没有唯一的正确答案：${SCORE_KEYS.map((k) => SCORE_LABELS[k]).join('、')}。` +
          '什么都不做，花费和福利会是满分，但鸟不会回来。',
        'note',
      ),
    ];
    this.show(`${this.scenario.name} · 开局`, body, [['接受委托，开始', () => this.close()]]);
  }

  /** 季度结算单。 */
  quarter(q: Quarter, session: SessionReadout, names: readonly string[]): void {
    if (q.final) {
      this.summary(session, names);
      return;
    }
    const goal = this.scenario.goal;
    const target = this.nameOf(goal.target, names);
    const year = Math.floor((q.index - 1) / QUARTERS_PER_YEAR) + 1;
    const season = SEASON_NAMES[(q.index - 1) % QUARTERS_PER_YEAR]!;
    const prev = session.quarters[q.index - 2];
    const body: HTMLElement[] = [
      para(`${target}：${q.targetCount} 只${prev ? `（上一季 ${prev.targetCount} 只）` : ''}`),
      scoreRows(q.scores, q.detail, goal, names, target),
      para(
        `满意度 ${Math.round(q.satisfaction - q.satisfactionDelta)} → ${Math.round(q.satisfaction)}（${signed(q.satisfactionDelta)}）` +
          (`；委托人拨下一季经费 ${q.grant.toLocaleString('zh-CN')} 元，预算现在 ${q.budget.toLocaleString('zh-CN')} 元`),
      ),
    ];
    this.show(`第 ${q.index} 季度结算 · 第 ${year} 年${season}季末`, body, [['继续', () => this.close()]]);
  }

  /** 委托结束：最后一季的评分、每季的走势、花了多少、移除了多少。 */
  summary(session: SessionReadout, names: readonly string[]): void {
    const goal = this.scenario.goal;
    const target = this.nameOf(goal.target, names);
    const last = session.quarters.at(-1)!;
    // 和第一年同一季比（季节起伏大）。
    const first = session.quarters[(last.index - 1) % QUARTERS_PER_YEAR];
    const money = session.money;
    const removed = session.removed
      .map((n, s) => (n > 0 ? `${names[s]} ${n} 只` : ''))
      .filter((t) => t)
      .join('、');
    const body: HTMLElement[] = [
      para(`${target}：第一年同一季 ${first?.targetCount ?? '—'} 只 → 最后一季 ${last.targetCount} 只。`),
      scoreRows(last.scores, last.detail, goal, names, target),
      heading('每季走势'),
      quarterTable(session.quarters),
      para(
        `一共拿到经费 ${money.received.toLocaleString('zh-CN')} 元，花掉 ${money.spent.toLocaleString('zh-CN')} 元；` +
          `操作 ${session.entryCount} 条；人为移除：${removed || '没有'}。最后的满意度 ${Math.round(last.satisfaction)}。`,
      ),
      para('委托期结束后还可以继续观察（不能再动手）。导出日志就是这一局的完整记录，可以原样回放。', 'note'),
    ];
    this.show('委托结束 · 总结', body, [
      ['继续观察', () => this.close()],
      ['再来一局', () => location.reload()],
    ]);
  }

  private nameOf(id: string, names: readonly string[]): string {
    return names[this.speciesIds.indexOf(id)] ?? id;
  }

  private show(title: string, body: HTMLElement[], buttons: Array<[string, () => void]>): void {
    this.open = true;
    const card = document.createElement('div');
    card.className = 'modal-card';
    const h = document.createElement('div');
    h.className = 'modal-title';
    h.textContent = title;
    const bar = document.createElement('div');
    bar.className = 'bar';
    for (const [label, action] of buttons) {
      const b = document.createElement('button');
      b.textContent = label;
      b.addEventListener('click', action);
      bar.appendChild(b);
    }
    card.append(h, ...body, bar);
    this.el.replaceChildren(card);
    this.el.style.display = '';
  }
}

function heading(text: string): HTMLElement {
  const e = document.createElement('div');
  e.className = 'log-head';
  e.textContent = text;
  return e;
}

function para(text: string, className?: string): HTMLElement {
  const e = document.createElement('p');
  e.textContent = text;
  if (className) e.className = className;
  return e;
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0';
}

function quarterTable(quarters: readonly Quarter[]): HTMLElement {
  const table = document.createElement('table');
  table.className = 'quarter-table';
  const head = table.insertRow();
  for (const t of ['季', ...SCORE_KEYS.map((k) => SCORE_LABELS[k]), '满意度']) {
    const th = document.createElement('th');
    th.textContent = t;
    head.appendChild(th);
  }
  for (const q of quarters) {
    const row = table.insertRow();
    for (const v of [q.index, ...SCORE_KEYS.map((k) => q.scores[k] ?? '—'), Math.round(q.satisfaction)]) row.insertCell().textContent = String(v);
  }
  return table;
}
