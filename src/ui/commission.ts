import type { Scenario } from '../data';
import { QUARTERS_PER_YEAR, SCORE_KEYS, SEASON_NAMES, type Quarter } from '../sim';
import type { SessionReadout } from '../runtime/remote';
import { SCORE_LABELS, scoreRows } from './scoreText';
import { replyKeyOf, speciesBlock, wishList, wishesOf } from './verdict';

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
    /** "立足"型委托用：岛上有什么（开局卡上写给设计的人看）、去设计台、回事务所。 */
    private readonly extra: { facts?: readonly string[]; desk?: () => void; office?: () => void; ended?: (reply: string, count: number) => void } = {},
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
    if (goal.establish) {
      // 先读信：委托人要什么；再是岛上有什么（设计要用）；历史卡放最后，当作档案馆的提醒。
      const body: HTMLElement[] = [
        heading(`来信 · ${client.name}`),
        ...client.letter.map((t) => para(t)),
        heading('他要的四件事'),
        wishList(wishesOf({ targetCount: 0, detail: { targetRatio: 0, boom: null, nativesLow: [], habitat: 1, spentShare: 0, sufferingShare: 0 } }, goal, names).map((w) => ({ ...w, ok: true, note: '' }))),
        ...(this.extra.facts?.length ? [heading('岛上有什么'), ...this.extra.facts.map((t) => para(t))] : []),
        heading(history.title),
        ...history.paragraphs.map((t) => para(t)),
        para(`出处：${history.source}`, 'note'),
        para(`${goal.years} 年为期，每季度出一张验收单：你的动物生了多少、死了多少、是怎么死的。`, 'note'),
      ];
      this.show(`${this.scenario.name} · 新委托`, body, [['去设计台', () => (this.close(), this.extra.desk?.())]]);
      return;
    }
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
    const year = Math.floor((q.index - 1) / QUARTERS_PER_YEAR) + 1;
    const season = SEASON_NAMES[(q.index - 1) % QUARTERS_PER_YEAR]!;
    if (goal.establish) {
      const body = [...this.verdicts(q, names), heading('委托人要的四件事'), wishList(wishesOf(q, goal, names)), para(`预算还有 ${q.budget.toLocaleString('zh-CN')} 元。还剩 ${session.totalQuarters - q.index} 季。`, 'note')];
      this.show(`验收单 · 第 ${year} 年${season}季`, body, [
        ['继续', () => this.close()],
        ['回设计台改一版', () => (this.close(), this.extra.desk?.())],
      ]);
      return;
    }
    const target = this.nameOf(goal.target, names);
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
    const last = session.quarters.at(-1)!;
    if (goal.establish) {
      const key = replyKeyOf(last, goal);
      const reply = this.scenario.client.replies?.[key] ?? [];
      const body = [
        heading(`回信 · ${this.scenario.client.name}`),
        ...reply.map((t) => para(t)),
        heading('他要的四件事'),
        wishList(wishesOf(last, goal, names)),
        heading('最后一季的验收单'),
        ...this.verdicts(last, names),
        heading('三年里的数量'),
        para(session.quarters.map((x) => x.targetCount).join(' → ')),
      ];
      this.extra.ended?.(key, last.targetCount);
      this.show('委托结束', body, [
        ['再接一次这份委托', () => location.reload()],
        ['回事务所', () => this.extra.office?.()],
        ['留下来再看看', () => this.close()],
      ]);
      return;
    }
    const target = this.nameOf(goal.target, names);
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

  /** 验收单的正文：先是事务所设计的动物（id 以 d_ 开头），再是岛上原来就有的。还没投放时只说一句。 */
  private verdicts(q: Quarter, names: readonly string[]): HTMLElement[] {
    const rows = q.species ?? [];
    const mine = rows.filter((x) => x.id.startsWith('d_'));
    const others = rows.filter((x) => !x.id.startsWith('d_'));
    const block = (x: (typeof rows)[number], own: boolean): HTMLElement => speciesBlock(x, names, this.nameOf(x.id, names), own);
    return [
      ...(mine.length ? mine.map((x) => block(x, true)) : [para('这一季你还没有往岛上放任何动物。委托人在等。')]),
      ...others.map((x) => block(x, false)),
    ];
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
