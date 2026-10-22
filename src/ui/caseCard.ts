import type { Case } from '../data/schema/case';
import type { CaseStatus } from '../sim';

/**
 * 个案动物的卡片（2026-10-22，见 sim/cases.ts）：
 * - 第一次在野外被看见时弹出：发现经过、病情、体况、还能撑几天，和"带回事务所"（走统一操作接口的 rescue）；
 * - 笔记本"记录"页最上面一张小纸条，点开同一张卡片；带回来以后变成"事务所的猫"。
 * 卡片开着时推演停着（由 main 看 isOpen 决定）。只读 Session，带回来这件事交给 rescue 回调提交。
 */
export class CaseCards {
  private open: string | null = null;
  /** 已经自动弹过的个案（每个只自动弹一次）。 */
  private shown = new Set<string>();
  private notesKey = '';
  private cardKey = '';
  private list: readonly CaseStatus[] = [];
  private cases: readonly Case[] = [];

  constructor(
    private readonly el: HTMLElement,
    private readonly notes: HTMLElement,
    /** 提交带回事务所的操作；成功返回 null，被拒绝返回原因（写在卡片上）。 */
    private readonly rescue: (id: string) => Promise<string | null>,
  ) {}

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** 换了一局：已经不是 hidden 的个案当作看过了，不再自动弹。 */
  reset(cases: readonly Case[], list: readonly CaseStatus[]): void {
    this.close();
    this.cases = cases;
    this.shown = new Set(list.filter((c) => c.phase !== 'hidden').map((c) => c.id));
    this.notesKey = '';
  }

  close(): void {
    this.open = null;
    this.cardKey = '';
    this.el.replaceChildren();
    this.el.style.display = 'none';
  }

  /** 每帧调用：第一次看见时弹卡片；纸条和开着的卡片内容变了才重写。 */
  update(cases: readonly Case[], list: readonly CaseStatus[]): void {
    this.cases = cases;
    this.list = list;
    for (const c of list)
      if (c.phase === 'wild' && !this.shown.has(c.id)) {
        this.shown.add(c.id);
        this.show(c.id);
      }
    const key = list.map((c) => `${c.id}:${c.phase}:${pct(c.condition)}:${c.daysLeft}`).join('|');
    if (key !== this.notesKey) {
      this.notesKey = key;
      this.renderNotes();
    }
    if (this.open) this.renderCard();
  }

  /** 打开某个个案的卡片（纸条、地图上点到它时）。 */
  show(id: string): void {
    this.open = id;
    this.cardKey = '';
    this.renderCard();
  }

  /** 地图上点到的格子附近（2 格内）有野外的个案：返回它的 id。 */
  at(cell: { x: number; y: number }): string | null {
    const c = this.list.find((c) => c.phase === 'wild' && Math.abs(c.x - cell.x) <= 2 && Math.abs(c.y - cell.y) <= 2);
    return c?.id ?? null;
  }

  private renderNotes(): void {
    const visible = this.list.filter((c) => c.phase !== 'hidden');
    this.notes.style.display = visible.length ? '' : 'none';
    this.notes.replaceChildren(
      ...visible.map((c) => {
        const b = document.createElement('button');
        b.className = `case-note ${c.phase}`;
        b.innerHTML = `${KITTEN_ICON}<span><b></b><small></small></span>`;
        b.querySelector('b')!.textContent = c.phase === 'office' ? `事务所的猫 · ${c.name}` : c.name;
        b.querySelector('small')!.textContent = summary(c);
        b.addEventListener('click', () => this.show(c.id));
        return b;
      }),
    );
  }

  private renderCard(): void {
    const c = this.list.find((x) => x.id === this.open);
    const data = this.cases.find((x) => x.id === this.open);
    if (!c || !data) return;
    const key = `${c.phase}:${pct(c.condition)}:${c.daysLeft}`;
    if (key === this.cardKey) return;
    this.cardKey = key;
    const t = data.text;
    const paras: string[] =
      c.phase === 'wild' ? [...t.found, ...t.wild] : c.phase === 'rescued' ? t.rescued : c.phase === 'office' ? t.office : c.phase === 'lost' ? [...t.found, ...t.lost] : [];
    const card = document.createElement('div');
    card.className = 'modal-card case-card';
    const h = document.createElement('div');
    h.className = 'modal-title';
    h.textContent = c.phase === 'office' ? `事务所的猫 · ${c.name}` : `个案 · ${c.name}`;
    const art = document.createElement('div');
    art.className = 'case-art';
    art.innerHTML = KITTEN_ICON;
    const body = paras.map((s) => {
      const p = document.createElement('p');
      p.textContent = s;
      return p;
    });
    const meter = document.createElement('div');
    meter.className = 'case-meter';
    meter.innerHTML = '<span>体况</span><i><em></em></i><small></small>';
    meter.querySelector('em')!.style.width = `${pct(c.condition)}%`;
    meter.querySelector('small')!.textContent = summary(c);
    if (c.phase === 'wild') meter.classList.add('falling');
    const bar = document.createElement('div');
    bar.className = 'bar';
    if (c.phase === 'wild') {
      const go = document.createElement('button');
      go.className = 'primary';
      go.textContent = `带回事务所（${data.rescue.cost.toLocaleString('zh-CN')} 元，一支队伍 ${data.rescue.days} 天）`;
      go.addEventListener('click', () => {
        go.disabled = true;
        void this.rescue(c.id).then((reason) => {
          if (reason === null) return;
          go.disabled = false;
          refused.textContent = `没办成：${reason}`;
        });
      });
      bar.appendChild(go);
    }
    const refused = document.createElement('p');
    refused.className = 'note refused';
    const shut = document.createElement('button');
    shut.textContent = c.phase === 'wild' ? '先不管' : '关上';
    shut.addEventListener('click', () => this.close());
    bar.appendChild(shut);
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = '个案不进物种数量、不进评分；带回来要花钱、占一支队伍。';
    card.append(h, art, ...body, meter, ...(c.phase === 'wild' ? [note, refused] : []), bar);
    this.el.replaceChildren(card);
    this.el.style.display = '';
  }
}

const pct = (x: number): number => Math.round(x * 100);

function summary(c: CaseStatus): string {
  switch (c.phase) {
    case 'wild':
      return `在野外，体况 ${pct(c.condition)}%` + (c.daysLeft !== null ? `，大约还能撑 ${c.daysLeft} 天` : '');
    case 'rescued':
      return `在事务所养着，体况 ${pct(c.condition)}%`;
    case 'office':
      return '没有牙，吃软食，很健康';
    case 'lost':
      return '没来得及';
    default:
      return '';
  }
}

/** 代码画的剪纸小猫（黑白花，和地图上的一样）：纸色底上两层纸、墨线轮廓。 */
const KITTEN_ICON =
  '<svg class="kitten" viewBox="0 0 48 36" aria-hidden="true">' +
  '<path d="M6 30 q-4 -10 4 -14" fill="none" stroke="#1f1f22" stroke-width="3" stroke-linecap="round"/>' +
  '<ellipse cx="20" cy="24" rx="12" ry="7" fill="#f2eee6" stroke="#4a3a28" stroke-width="1.2"/>' +
  '<ellipse cx="17" cy="22" rx="6" ry="4" fill="#1f1f22"/>' +
  '<rect x="11" y="27" width="4" height="6" rx="1.5" fill="#f2eee6" stroke="#4a3a28" stroke-width="1"/>' +
  '<rect x="25" y="27" width="4" height="6" rx="1.5" fill="#f2eee6" stroke="#4a3a28" stroke-width="1"/>' +
  '<path d="M30 14 l1 -9 l5 6 l4 -6 l1 9" fill="#1f1f22" stroke="#4a3a28" stroke-width="1"/>' +
  '<circle cx="36" cy="17" r="7.5" fill="#f2eee6" stroke="#4a3a28" stroke-width="1.2"/>' +
  '<circle cx="33.5" cy="16" r="1" fill="#4a3a28"/><circle cx="38.5" cy="16" r="1" fill="#4a3a28"/>' +
  '<path d="M34.5 19.5 q1.5 1.2 3 0" fill="none" stroke="#4a3a28" stroke-width="0.9"/>' +
  '</svg>';
