import type { NecropsyTemplates, Tools } from '../data';
import {
  calendar,
  necropsyFindings,
  summarize,
  TICKS_PER_DAY,
  THIN_BCS,
  type Capture,
  type Carcass,
  type DerivedSpecies,
  type Proportion,
  type SimState,
} from '../sim';
import { ageText, bcsText, massText, stomachText } from './examText';
import { necropsyReport } from './necropsyReport';

/** 抽样推断看最近多少天的记录。 */
const INFERENCE_WINDOW_DAYS = 90;

/**
 * 左侧的"野外记录"：
 * - 找尸体带回了什么，点一具打开尸检报告（临床口吻，按模板拼）；
 * - 最近抓到、检查过的动物，点一条打开检查卡；
 * - 抽样推断：选一个物种，最近 90 天的检查记录汇总成比例和 95% 置信区间。
 */
export class FieldLog {
  // 推演在 Worker 里，每帧送来的是新拷贝：记录按内容比，不按对象比。
  private lastCapture = '';
  private lastSearch = '';
  private lastDay = -1;
  private drawn = false;
  private state: Readonly<SimState> | null = null;
  private selected: string | null = null;
  /** 玩家没选过推断哪个物种时，跟着最近一条检查记录走。 */
  private userChose = false;
  private readonly log = document.createElement('div');
  private readonly inference = document.createElement('div');
  private readonly inferSpecies = document.createElement('select');

  constructor(
    private readonly el: HTMLElement,
    private readonly card: HTMLElement,
    private readonly species: readonly DerivedSpecies[],
    private readonly tools: Tools | undefined,
    private readonly templates: NecropsyTemplates,
  ) {
    for (const [s, sp] of species.entries()) this.inferSpecies.add(new Option(sp.params.name, String(s)));
    this.inferSpecies.addEventListener('change', () => {
      this.userChose = true;
      this.renderInference();
    });
    const head = document.createElement('div');
    head.className = 'log-head';
    head.append('抽样推断：', this.inferSpecies);
    el.append(this.log, head, this.inference);
  }

  private get names(): string[] {
    return this.species.map((s) => s.params.name);
  }

  reset(): void {
    this.drawn = false;
    this.userChose = false;
    this.selected = null;
    this.card.style.display = 'none';
  }

  update(state: Readonly<SimState>): void {
    this.state = state;
    const caps = state.captures;
    const nec = state.necropsies;
    const lastCapture = `${caps.length}:${captureKey(caps[caps.length - 1])}`;
    const lastSearch = `${nec.length}:${nec[nec.length - 1]?.job ?? ''}`;
    // 有新记录时重画；换天时也重画推断（90 天的窗口往前挪了）。
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    if (this.drawn && lastCapture === this.lastCapture && lastSearch === this.lastSearch) {
      if (day !== this.lastDay) {
        this.lastDay = day;
        this.renderInference();
      }
      return;
    }
    this.lastDay = day;
    this.drawn = true;
    this.lastCapture = lastCapture;
    this.lastSearch = lastSearch;
    this.el.style.display = caps.length + nec.length > 0 ? '' : 'none';
    const newest = caps[caps.length - 1];
    if (!this.userChose && newest) this.inferSpecies.value = String(newest.species);
    this.renderLog();
    this.renderInference();
  }

  private renderLog(): void {
    const state = this.state!;
    const names = this.names;
    const rows: HTMLElement[] = [];
    if (state.necropsies.length > 0) {
      rows.push(heading('找尸体（点一具看尸检报告）'));
      for (const n of state.necropsies.slice(-3).reverse()) {
        if (n.found.length === 0) {
          const want = n.species >= 0 ? `${names[n.species]}的` : '';
          rows.push(line(`${date(n.day)} #${n.job}：没找到${want}新鲜尸体`));
          continue;
        }
        n.found.forEach((c, k) => {
          const key = `n${n.job}-${k}`;
          const b = document.createElement('button');
          b.className = 'log-row';
          b.textContent = `${date(n.day)} #${n.job}-${k + 1}：${names[c.species]}，${c.daysDead === 0 ? '当天死亡' : `死后约 ${c.daysDead} 天`}`;
          b.classList.toggle('active', key === this.selected);
          b.addEventListener('click', () => this.openReport(c, key));
          rows.push(b);
        });
      }
    }
    if (state.captures.length > 0) {
      rows.push(heading('抓到、检查过的（点一条看检查卡）'));
      for (const c of state.captures.slice(-8).reverse()) {
        const how = c.trap >= 0 ? `${this.tools?.traps[c.trap]?.name ?? '陷阱'}#${c.job}` : `采样#${c.job}`;
        const who = `${names[c.species]}（${c.juvenile ? '幼' : '成年'}${c.female ? '雌' : '雄'}，体况 ${c.bcs.toFixed(1)}）`;
        const b = document.createElement('button');
        b.className = 'log-row';
        b.textContent = `${date(c.day)} ${how}：${who} → ${c.removed ? '移除' : '放生'}`;
        const key = captureKey(c);
        b.classList.toggle('active', key === this.selected);
        b.addEventListener('click', () => this.open(c, key));
        rows.push(b);
      }
    }
    this.log.replaceChildren(...rows);
  }

  /** 点同一条再点一次就关掉；返回是不是打开了。 */
  private toggle(key: string): boolean {
    this.selected = this.selected === key ? null : key;
    this.renderLog();
    if (!this.selected) this.card.style.display = 'none';
    return this.selected !== null;
  }

  private cardFrame(titleText: string, key: string): HTMLElement[] {
    const title = document.createElement('div');
    title.className = 'panel-title';
    title.textContent = titleText;
    const close = document.createElement('button');
    close.className = 'card-close';
    close.textContent = '×';
    close.addEventListener('click', () => this.toggle(key));
    return [close, title];
  }

  private openReport(c: Carcass, key: string): void {
    if (!this.toggle(key)) return;
    const sections = necropsyReport(this.templates, c, necropsyFindings(c, this.species), this.species);
    const table = document.createElement('dl');
    for (const sec of sections) {
      const dt = document.createElement('dt');
      dt.textContent = sec.heading;
      const dd = document.createElement('dd');
      dd.textContent = sec.text;
      table.append(dt, dd);
    }
    this.card.replaceChildren(...this.cardFrame(this.templates.title, key), table);
    this.card.style.display = '';
  }

  private open(c: Capture, key: string): void {
    if (!this.toggle(key)) return;
    const sp = this.species[c.species]!;
    const how = c.trap >= 0 ? `${this.tools?.traps[c.trap]?.name ?? '陷阱'}（#${c.job}）` : `体检采样（#${c.job}）`;
    const rows: [string, string][] = [
      ['物种', sp.params.name],
      ['性别', c.female ? '雌' : '雄'],
      ['年龄', ageText(sp, c)],
      ['体重', `${massText(c.massKg)}（同种成体典型 ${massText(sp.params.bodyMassKg)}）`],
      ['体况评分', bcsText(c.bcs)],
      ['胃内容物', stomachText(c, this.species)],
      ['来源', how],
      ['地点', `(${c.x}, ${c.y})`],
      ['日期', date(c.day)],
      ['处理', c.removed ? '移除' : '检查后原地放生'],
    ];
    const table = document.createElement('dl');
    for (const [k, v] of rows) {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      table.append(dt, dd);
    }
    this.card.replaceChildren(...this.cardFrame('检查卡', key), table);
    this.card.style.display = '';
  }

  private renderInference(): void {
    const state = this.state;
    if (!state) return;
    const s = Number(this.inferSpecies.value);
    const today = Math.floor(state.tick / TICKS_PER_DAY);
    const sum = summarize(state.captures, s, today - INFERENCE_WINDOW_DAYS);
    const names = this.names;
    if (sum.n === 0) {
      this.inference.textContent = `最近 ${INFERENCE_WINDOW_DAYS} 天没有检查过${names[s]}。用"体检采样"或陷阱抓几只。`;
      return;
    }
    const lines = [
      `最近 ${INFERENCE_WINDOW_DAYS} 天检查了 ${sum.n} 只（陷阱 ${sum.fromTraps}，采样 ${sum.fromSampling}）。括号里是 95% 置信区间：`,
      `偏瘦（体况 ≤ ${THIN_BCS}）${pct(sum.thin)}`,
      `幼体 ${pct(sum.juvenile)}　雌性 ${pct(sum.female)}`,
    ];
    if (sum.adultMassKg.n > 0) {
      const m = sum.adultMassKg;
      lines.push(`成体平均体重 ${massText(m.mean)}（${massText(Math.max(0, m.lo))} – ${massText(m.hi)}）`);
    }
    for (const p of sum.stomachPrey) {
      const name = names[p.prey];
      if (p.nest.k > 0) lines.push(`胃里有${name}的蛋或幼雏 ${pct(p.nest)}`);
      if (p.mobile.k > 0) lines.push(`胃里有${name}的残骸 ${pct(p.mobile)}`);
    }
    if (sum.fromTraps > 0) lines.push('注意：陷阱抓到的偏向被诱饵吸引、体重合适的个体。');
    if (sum.n < 10) lines.push('样本还少，区间很宽。');
    this.inference.textContent = lines.join('\n');
  }
}

function pct(p: Proportion): string {
  const f = (v: number): string => `${Math.round(v * 100)}%`;
  return `${f(p.p)}（${f(p.lo)}–${f(p.hi)}）`;
}

function heading(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'log-head';
  d.textContent = text;
  return d;
}

function line(text: string): HTMLElement {
  const d = document.createElement('div');
  d.textContent = text;
  return d;
}

function date(day: number): string {
  const d = calendar(day * TICKS_PER_DAY);
  return `第${d.year + 1}年${d.month + 1}月${d.dayOfMonth + 1}日`;
}

/** 一条捕获记录的键：推演在 Worker 里，每帧送来的是新拷贝，按这几样认出是同一条。 */
function captureKey(c: Capture | undefined): string {
  return c ? `c${c.day}-${c.job}-${c.trap}-${c.species}-${c.x},${c.y}-${c.ageDays}-${c.massKg}` : '';
}
