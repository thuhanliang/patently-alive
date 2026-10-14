import type { ArchiveEntry, SpeciesParams } from '../data';
import { nearest, traitsOf } from '../sim';
import { css, speciesColor } from '../render/palette';

const ACTIVITY: Record<SpeciesParams['activity'], string> = {
  diurnal: '昼行',
  nocturnal: '夜行',
  crepuscular: '晨昏活动',
  cathemeral: '昼夜都活动',
};

const NEST: Record<string, string> = { ground: '地面浅窝', burrow: '洞穴或巢穴', none: '—' };

/** 档案馆里"引进到这里"要的东西；情景不允许引种时不传，就不显示这一栏。 */
export interface IntroduceHooks {
  /** 一次最多引进几只（工具数据）。 */
  maxAnimals: number;
  /** 引进 count 只的花费说明；业主禁止引进的物种 allowed 为 false，text 是原因。 */
  quote(id: string, count: number): { text: string; allowed: boolean };
  /** 选好了物种和数量：档案馆关掉，回到地图上点投放地点。 */
  start(id: string, count: number): void;
}

/**
 * 自然档案馆（极简版）：翻看现有技术的条目、数据档案、知识卡，以及按性状算出的"最接近的现有技术"。
 * 只读数据，不改推演；打开时推演暂停（由 main 看 isOpen 决定）。
 */
export class ArchivePanel {
  private open = false;
  private selected: string;
  private filter = '';
  private count = 10;

  constructor(
    private readonly el: HTMLElement,
    private readonly entries: ReadonlyMap<string, ArchiveEntry>,
    private readonly species: ReadonlyMap<string, SpeciesParams>,
    private readonly introduce?: IntroduceHooks,
  ) {
    this.selected = entries.keys().next().value ?? '';
    // 点遮罩空白处关闭。
    el.addEventListener('click', (e) => {
      if (e.target === el) this.close();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(id?: string): void {
    if (id !== undefined) this.selected = id;
    this.open = true;
    this.el.style.display = 'flex';
    this.render();
  }

  close(): void {
    this.open = false;
    this.el.replaceChildren();
    this.el.style.display = 'none';
  }

  /** 按中文名或学名筛选。 */
  private matches(): string[] {
    const f = this.filter.trim().toLowerCase();
    return [...this.entries.keys()].filter((id) => {
      if (!f) return true;
      const p = this.species.get(id)!;
      return p.name.includes(f) || p.scientificName.toLowerCase().includes(f) || id.includes(f);
    });
  }

  private render(): void {
    const card = div('modal-card archive-card');
    const head = div('archive-head');
    head.append(textEl('div', '自然档案馆 · 现有技术', 'modal-title'));
    const closeBtn = textEl('button', '×', 'card-close');
    closeBtn.title = '关闭';
    closeBtn.addEventListener('click', () => this.close());
    head.append(closeBtn);

    const search = document.createElement('input');
    search.className = 'archive-search';
    search.placeholder = '按名字或学名查';
    search.value = this.filter;
    search.addEventListener('input', () => {
      this.filter = search.value;
      this.renderList(list);
    });

    const list = div('archive-list');
    this.renderList(list);
    const left = div('archive-left');
    left.append(search, list);

    const body = div('archive-body');
    body.append(left, this.entryView(this.selected));
    card.append(head, body);
    this.el.replaceChildren(card);
  }

  private renderList(list: HTMLElement): void {
    const ids = this.matches();
    list.replaceChildren(
      ...ids.map((id) => {
        const p = this.species.get(id)!;
        const row = textEl('button', '', `log-row${id === this.selected ? ' active' : ''}`);
        row.append(swatch(id), document.createTextNode(` ${p.name}`));
        row.addEventListener('click', () => {
          this.selected = id;
          this.render();
        });
        return row;
      }),
    );
    // 名字查不到：档案馆员的标准回复。按性状找最接近的条目要等设计台（阶段 3）有了性状输入。
    if (ids.length === 0) list.append(textEl('p', '暂无收录。', 'note'));
  }

  private entryView(id: string): HTMLElement {
    const box = div('archive-entry');
    const e = this.entries.get(id);
    const p = this.species.get(id);
    if (!e || !p) return box;
    const r = p.reproduction;
    const bird = e.taxonomy.class === '鸟纲';
    const diet = [
      ['植物', p.diet.plant],
      ['脊椎动物', p.diet.vertebrate],
      ['无脊椎动物', p.diet.invertebrate],
    ]
      .filter(([, v]) => (v as number) > 0)
      .map(([k, v]) => `${k} ${Math.round((v as number) * 100)}%`)
      .join('，');
    const move = [p.movement.flies ? '会飞' : null, p.movement.climbs ? '会爬树' : null, p.movement.territorial ? '守领地' : null].filter(Boolean).join('，');
    const title = textEl('div', '', 'archive-name');
    title.append(swatch(id), document.createTextNode(` ${p.name}`), textEl('i', ` ${p.scientificName}`, 'note'));
    box.append(
      title,
      ...(this.introduce ? [this.introduceRow(id, this.introduce)] : []),
      textEl('p', `${e.taxonomy.class} · ${e.taxonomy.order} · ${e.taxonomy.family}`, 'note'),
      textEl('p', e.range),
      dl([
        ['体重', mass(p.bodyMassKg)],
        ['食性', diet],
        ['活动', ACTIVITY[p.activity]],
        [bird ? '每窝蛋数' : '每窝仔数', fmt(r.litterSize)],
        [bird ? '孵化期' : '妊娠期', `${Math.round(r.gestationDays)} 天`],
        ['性成熟', days(r.ageAtMaturityDays)],
        ['最长寿命', `${fmt(p.maxLifespanYears)} 年`],
        ['窝', NEST[r.nest ?? 'none']!],
        ['移动', move || '—'],
      ]),
      textEl('div', '知识卡', 'log-head'),
      ...e.card.map((t) => textEl('p', t)),
      textEl('p', `出处：${e.cardSource}`, 'note'),
      textEl('div', '按性状最接近的现有技术', 'log-head'),
    );
    for (const m of nearest(traitsOf(p), this.species.values(), 3, [id])) {
      const q = this.species.get(m.id)!;
      const row = textEl('button', '', 'log-row');
      row.append(swatch(m.id), document.createTextNode(` ${q.name}  相似度 ${Math.round(m.similarity * 100)}%`));
      row.addEventListener('click', () => {
        this.selected = m.id;
        this.render();
      });
      box.append(row);
    }
    return box;
  }

  /** 引进这一种：选数量，看花费，然后回到地图上点地点。引进不可撤销。 */
  private introduceRow(id: string, hooks: IntroduceHooks): HTMLElement {
    const row = div('bar archive-introduce');
    const count = document.createElement('input');
    count.type = 'number';
    count.min = '1';
    count.max = String(hooks.maxAnimals);
    count.value = String(this.count);
    count.style.width = '5em';
    const cost = textEl('span', '', 'note');
    const chosen = (): number => Math.max(1, Math.min(hooks.maxAnimals, Math.floor(Number(count.value) || 1)));
    const go = textEl('button', '引进到这里') as HTMLButtonElement;
    const refresh = (): void => {
      this.count = chosen();
      const q = hooks.quote(id, this.count);
      cost.textContent = q.text;
      go.disabled = !q.allowed;
    };
    count.addEventListener('input', refresh);
    // 填的数超出范围：离开输入框时改成实际会引进的数。
    count.addEventListener('change', () => (count.value = String(chosen())));
    go.title = '关掉档案馆，在地图上点投放地点。引进以后收不回来，只能再用兽医手段减少。';
    go.addEventListener('click', () => {
      refresh();
      if (go.disabled) return;
      this.close();
      hooks.start(id, this.count);
    });
    const countLabel = document.createElement('label');
    countLabel.append('引进 ', count, ' 只');
    row.append(countLabel, go, cost);
    refresh();
    return row;
  }
}

function div(cls: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = cls;
  return d;
}

function textEl(tag: string, text: string, cls?: string): HTMLElement {
  const e = document.createElement(tag);
  e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

function swatch(id: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'swatch';
  s.style.background = css(speciesColor(id).body);
  return s;
}

function dl(rows: [string, string][]): HTMLElement {
  const d = document.createElement('dl');
  d.className = 'archive-data';
  for (const [k, v] of rows) d.append(textEl('dt', k), textEl('dd', v));
  return d;
}

const fmt = (x: number): string => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const mass = (kg: number): string => (kg < 1 ? `${Math.round(kg * 1000)} 克` : `${fmt(kg)} 千克`);
const days = (d: number): string => (d >= 365 ? `${fmt(d / 365)} 年` : `${d} 天`);
