import type { Goal } from '../data';
import { decodeCause, type Quarter, type SpeciesQuarter } from '../sim';

/**
 * 验收单（2026-11-10）：世界怎么"验收"一种动物，用一季的账目说清楚——季初多少、生了多少、死了多少、各是怎么死的。
 * 数都是引擎记的（Session 的 Quarter.species），这里只管措辞；委托人的几条要求做没做到，也只读引擎的评分明细（铁律 4）。
 */

/** 死因的说法（验收单上用，比死因页的短，并且带一句为什么）。 */
export function causeText(cause: number, names: readonly string[]): string {
  const d = decodeCause(cause, names.length);
  switch (d.kind) {
    case 'starvation':
      return '饿死';
    case 'other':
      return '老死、生病、意外';
    case 'removed':
      return '被移走';
    case 'malnutrition':
      return '营养不良';
    case 'fracture':
      return '骨折';
    case 'dystocia':
      return '难产';
    case 'predation':
      return `被${names[d.predator]}吃掉`;
    case 'nest':
      return `窝被${names[d.predator]}端掉`;
  }
}

/** 死因后面那句"为什么"（只有身体或食物的原因才有；没有就是空的）。 */
export function causeWhy(cause: number, names: readonly string[]): string {
  switch (decodeCause(cause, names.length).kind) {
    case 'starvation':
      return '这里找不到足够它吃的东西';
    case 'malnutrition':
      return '吃得到，但它的肠胃取不出足够的营养';
    case 'fracture':
      return '骨头撑不住它的体重';
    case 'dystocia':
      return '崽太大，生不下来';
    default:
      return '';
  }
}

export const deadOf = (q: SpeciesQuarter): number => q.deaths.reduce((a, [, n]) => a + n, 0);

/** 死得最多的那一种死因；没有死的为 null。 */
export function mainCause(q: SpeciesQuarter): number | null {
  let best: [number, number] | null = null;
  for (const d of q.deaths) if (!best || d[1] > best[1]) best = d;
  return best ? best[0] : null;
}

/** 一种动物这一季的一句话结论。 */
export function oneLine(q: SpeciesQuarter, names: readonly string[]): string {
  const dead = deadOf(q);
  const cause = mainCause(q);
  const why = cause === null ? '' : causeWhy(cause, names);
  const mostly = cause === null ? '' : `，多半是${causeText(cause, names)}${why ? `（${why}）` : ''}`;
  if (q.end === 0 && q.start + q.released > 0) return `一只都不剩了${mostly}。`;
  if (q.start === 0 && q.released > 0) {
    if (dead === 0) return `放上岛 ${q.released} 只，都还在${q.births > 0 ? `，还生了 ${q.births} 只` : ''}。`;
    if (q.end >= q.released) return `放上岛 ${q.released} 只，生了 ${q.births} 只，死了 ${dead} 只，季末有 ${q.end} 只。`;
    return `放上岛 ${q.released} 只，季末剩 ${q.end} 只${mostly}。`;
  }
  if (q.births === 0 && dead === 0) return '这一季没有生，也没有死。';
  if (q.births === 0) return `这一季没有生小的（不在繁殖季，或者还没长大），死了 ${dead} 只${mostly}。`;
  if (q.births > dead) return `生的比死的多（生 ${q.births}，死 ${dead}），在变多。`;
  if (q.births === dead) return `生的和死的一样多（各 ${dead} 只），不多不少。`;
  // 死的几乎都是老死、生病、意外：不是这里活不了，是生得不够快。
  const other = q.deaths.find(([c]) => decodeCause(c, names.length).kind === 'other')?.[1] ?? 0;
  if (other >= 0.8 * dead) return `死的比生的多（生 ${q.births}，死 ${dead}）。没有饿着，也没被吃：这一季生的补不上老死病死的。`;
  return `死的比生的多（生 ${q.births}，死 ${dead}）${mostly}。`;
}

/** 委托人的一条要求，以及现在做没做到。 */
export interface Wish {
  key: 'settled' | 'calm' | 'natives' | 'habitat';
  label: string;
  ok: boolean;
  note: string;
}

/** "立足"型委托的四条要求（goal.establish）。只读结算时引擎记下的数。 */
export function wishesOf(q: Pick<Quarter, 'targetCount' | 'detail'>, goal: Goal, names: readonly string[]): Wish[] {
  const est = goal.establish!;
  const low = q.detail.nativesLow.map((s) => names[s]).join('、');
  return [
    { key: 'settled', label: `三年后还在（不少于 ${est.settle} 只）`, ok: q.targetCount >= est.settle, note: `现在 ${q.targetCount} 只` },
    { key: 'calm', label: `没有泛滥（不超过 ${est.ceiling} 只）`, ok: q.targetCount <= est.ceiling, note: `现在 ${q.targetCount} 只` },
    { key: 'natives', label: '没伤着岛上的鸟', ok: q.detail.nativesLow.length === 0, note: low ? `${low}不到开局的一半` : '鸟都还在' },
    { key: 'habitat', label: '没把岛啃秃', ok: q.detail.habitat >= 0.5, note: `灌丛是开局的 ${Math.round(q.detail.habitat * 100)}%` },
  ];
}

export type ReplyKey = 'success' | 'gone' | 'few' | 'swarm' | 'natives' | 'habitat';

/** 委托结束时回哪一封信：一只不剩最要紧，其次是伤了鸟、啃秃了岛、泛滥、不够数。 */
export function replyKeyOf(q: Pick<Quarter, 'targetCount' | 'detail'>, goal: Goal): ReplyKey {
  const est = goal.establish!;
  if (q.targetCount === 0) return 'gone';
  if (q.detail.nativesLow.length > 0) return 'natives';
  if (q.detail.habitat < 0.5) return 'habitat';
  if (q.targetCount > est.ceiling) return 'swarm';
  if (q.targetCount < est.settle) return 'few';
  return 'success';
}

/** 验收单上一种动物的一块：名字、季初 → 季末、生和死的明细、一句话结论。 */
export function speciesBlock(q: SpeciesQuarter, names: readonly string[], name: string, mine: boolean): HTMLElement {
  const box = document.createElement('div');
  box.className = `verdict${mine ? ' mine' : ''}`;
  const head = document.createElement('div');
  head.className = 'verdict-head';
  const nm = document.createElement('b');
  nm.textContent = name;
  const count = document.createElement('span');
  // 这一季才放上岛的：从放上去的只数说起。
  count.textContent = `${q.start === 0 && q.released > 0 ? `放 ${q.released}` : q.start} → ${q.end} 只`;
  head.append(nm, count);
  const rows = document.createElement('div');
  rows.className = 'verdict-rows';
  const row = (label: string, n: number, sign: '+' | '−'): void => {
    if (n <= 0) return;
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('span');
    v.className = sign === '+' ? 'plus' : 'minus';
    v.textContent = `${sign}${n}`;
    rows.append(l, v);
  };
  row('放上岛', q.released, '+');
  row('出生', q.births, '+');
  for (const [cause, n] of [...q.deaths].sort((a, b) => b[1] - a[1])) row(causeText(cause, names), n, '−');
  row('被移走', q.removed, '−');
  const line = document.createElement('p');
  line.className = 'verdict-line';
  line.textContent = oneLine(q, names);
  box.append(head, rows, line);
  return box;
}

/** 委托人的要求清单。 */
export function wishList(wishes: readonly Wish[]): HTMLElement {
  const ul = document.createElement('div');
  ul.className = 'wishes';
  for (const w of wishes) {
    const mark = document.createElement('span');
    mark.className = w.ok ? 'ok' : 'bad';
    mark.textContent = w.ok ? '✓' : '✗';
    const label = document.createElement('span');
    label.textContent = w.label;
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = w.note;
    ul.append(mark, label, note);
  }
  return ul;
}
