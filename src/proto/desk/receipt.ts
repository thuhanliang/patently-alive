import type { CompiledDesign } from '../../sim';
import { FOOD_KINDS, FOOD_NAMES, gramText, type DailyFood } from './food';

/**
 * 能量小票（设计台第 4 步 a，`docs/feel/desk.md`）：脚边的饭堆回答"吃多少"，小票回答"为什么吃这么多"。
 *
 * - 只把编译结果里已经算好的能量分项（`energy.lines`）一行一行打出来，加上冷热试验里冷的那一笔（和饭堆用同一个 extraHeat），
 *   再除以消化率得到要吃进去的，最后是饭堆上写的克数。不发明新的算法，数和饭堆、读数是同一份。
 * - 改了什么，变了的那几行旁边出现 ▲ / ▼ 和变了多少；手停下来 SETTLE_MS 以后记号淡掉，以停下时的数为新的起点。
 * 只读编译结果，不改推演。
 */

export interface ReceiptRow {
  /** 前后两次对得上的键（同一个部件、同一个形状参数，不管现在是"长"还是"短"）。 */
  key: string;
  label: string;
  value: number;
  /** item：一笔开销；total：合计；note：说明（消化率）；food：克数。 */
  kind: 'item' | 'total' | 'note' | 'food';
}

/** 形状参数"长 / 短"两种说法是同一行。 */
const SAME: Record<string, string> = { 毛短: '毛长', 腿短: '腿长', 尾短: '尾长' };
const keyOf = (label: string): string => {
  const k = label.split('：')[0]!;
  return SAME[k] ?? k;
};

/** 小票上的每一行（千焦、百分比、克），顺序就是打出来的顺序。 */
export function receiptRows(c: CompiledDesign, food: DailyFood): ReceiptRow[] {
  const rows: ReceiptRow[] = c.energy.lines.map((l) => ({ key: keyOf(l.label), label: l.label, value: l.kjPerDay, kind: 'item' as const }));
  if (food.cold > 0.005) rows.push({ key: 'cold', label: '冷：发抖多烧', value: c.energy.needKjPerDay * food.cold, kind: 'item' });
  const burn = c.energy.needKjPerDay * (1 + food.cold);
  rows.push({ key: 'burn', label: '一天烧掉', value: burn, kind: 'total' });
  const dig = Math.max(1e-6, c.energy.digestibility);
  rows.push({ key: 'dig', label: `能消化的只有 ${Math.round(dig * 100)}%`, value: dig, kind: 'note' });
  rows.push({ key: 'intake', label: '要吃进去', value: burn / dig, kind: 'total' });
  const all = FOOD_KINDS.reduce((s, k) => s + food.grams[k], 0);
  // 和饭堆一样：份额不到 3% 的不列。
  for (const k of FOOD_KINDS) if (food.grams[k] > 0 && food.grams[k] >= 0.03 * all) rows.push({ key: `food:${k}`, label: FOOD_NAMES[k], value: food.grams[k], kind: 'food' });
  return rows;
}

/** 千焦写成好读的样子：开销带正负号，合计不带。 */
export function kjText(v: number, signed: boolean): string {
  const a = Math.abs(v);
  const s = a >= 10000 ? `${(a / 1000).toFixed(0)} 千` : a >= 100 ? `${Math.round(a)}` : a >= 10 ? a.toFixed(0) : a.toFixed(1);
  return `${signed ? (v < 0 ? '−' : '+') : ''}${s}`;
}

/** 变了多少算"变了"：相对 0.5%，绝对 0.05（千焦、克都是）。 */
const changed = (a: number, b: number): boolean => Math.abs(a - b) > Math.max(0.05, 0.005 * Math.max(Math.abs(a), Math.abs(b)));

/** 手停下来多久以后，▲ ▼ 淡掉、以现在的数为新的起点（毫秒）。 */
export const SETTLE_MS = 1500;

/**
 * 变了多少的记账：baseline 是上一次手停下来时的数；拖着的时候不动它，所以拖完看得出这一下总共变了多少。
 * now 由调用的一方给（毫秒），方便测试。
 */
export class ReceiptDiff {
  private baseline = new Map<string, number>();
  private current = new Map<string, number>();
  private lastChange = -Infinity;

  update(rows: readonly ReceiptRow[], now: number): void {
    const next = new Map(rows.map((r) => [r.key, r.value]));
    if (this.current.size === 0) this.baseline = new Map(next);
    else if (next.size !== this.current.size || rows.some((r) => !this.current.has(r.key) || changed(this.current.get(r.key)!, r.value))) this.lastChange = now;
    this.current = next;
    this.settle(now);
  }

  /** 手停下来够久了：以现在的数为新的起点。 */
  settle(now: number): void {
    if (now - this.lastChange >= SETTLE_MS) this.baseline = new Map(this.current);
  }

  /** 这一行比起点变了多少（没变是 0；起点上没有这一行是 NaN，画成"新"）。 */
  delta(key: string): number {
    const v = this.current.get(key);
    if (v === undefined) return 0;
    const b = this.baseline.get(key);
    if (b === undefined) return NaN;
    return changed(v, b) ? v - b : 0;
  }

  /** 从头开始记（小票刚打开时）。 */
  reset(): void {
    this.baseline.clear();
    this.current.clear();
    this.lastChange = -Infinity;
  }
}

/** 小票这张纸（DOM）：打开时一行一行打出来，开着时当场重打。 */
export class Receipt {
  private readonly diff = new ReceiptDiff();
  private rows: ReceiptRow[] = [];
  private sig = '';

  constructor(readonly el: HTMLElement) {}

  get open(): boolean {
    return !this.el.hidden;
  }

  show(rows: ReceiptRow[], now: number): void {
    this.diff.reset();
    this.el.hidden = false;
    this.el.classList.remove('printing');
    // 重新触发"打出来"的动画。
    void this.el.offsetWidth;
    this.el.classList.add('printing');
    window.setTimeout(() => this.el.classList.remove('printing'), 700);
    this.sig = '';
    this.update(rows, now);
  }

  hide(): void {
    this.el.hidden = true;
  }

  update(rows: ReceiptRow[], now: number): void {
    this.rows = rows;
    this.diff.update(rows, now);
    this.render();
  }

  /** 每帧：手停下来够久了，▲ ▼ 淡掉。 */
  tick(now: number): void {
    if (!this.open) return;
    this.diff.settle(now);
    this.render();
  }

  private render(): void {
    const cells = this.rows.map((r) => {
      const d = r.kind === 'note' ? 0 : this.diff.delta(r.key);
      const v = r.kind === 'food' ? gramText(r.value) : r.kind === 'note' ? '' : `${kjText(r.value, r.kind === 'item' && r.key !== '日常代谢（兽）' && r.key !== '日常代谢（鸟）')}`;
      const dt = Number.isNaN(d) ? '新' : d === 0 ? '' : r.kind === 'food' ? `${d > 0 ? '▲' : '▼'} ${gramText(Math.abs(d))}` : `${d > 0 ? '▲' : '▼'} ${kjText(Math.abs(d), false)}`;
      return { r, v, dt };
    });
    const sig = cells.map((c) => `${c.r.label}|${c.v}|${c.dt}`).join('\n');
    if (sig === this.sig) return;
    this.sig = sig;
    const out: HTMLElement[] = [];
    const head = document.createElement('div');
    head.className = 'rhead';
    head.textContent = '一天的能量小票　千焦';
    out.push(head);
    let i = 0;
    let foodHead = false;
    for (const { r, v, dt } of cells) {
      if (r.kind === 'total' && r.key === 'burn') out.push(rule());
      if (r.kind === 'food' && !foodHead) {
        out.push(rule());
        const h = document.createElement('div');
        h.className = 'rnote';
        h.textContent = '换成食物（鲜重）';
        out.push(h);
        foodHead = true;
      }
      const row = document.createElement('div');
      row.className = `rrow ${r.kind}${dt ? ' moved' : ''}`;
      row.style.setProperty('--i', String(i++));
      const l = document.createElement('span');
      l.className = 'rl';
      l.textContent = r.label;
      const d = document.createElement('span');
      d.className = 'rd';
      d.textContent = dt;
      const n = document.createElement('span');
      n.className = 'rv';
      n.textContent = v;
      row.append(l, d, n);
      out.push(row);
    }
    this.el.replaceChildren(...out);
  }
}

function rule(): HTMLElement {
  const hr = document.createElement('div');
  hr.className = 'rrule';
  return hr;
}
