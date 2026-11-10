import type { Scenario } from '../data';

/**
 * 事务所（2026-11-10，先是一个很简单的壳）：桌上摆着几封委托信，拆开一封就去那座岛。
 * 办过的委托留一行记录（只存在这个浏览器里，读不到也照常工作）。
 */
const RECORD_KEY = 'patently-alive-records';

export interface Record {
  /** 回信是哪一封（见 verdict.ts 的 ReplyKey）；没有回信的委托记 'done'。 */
  reply: string;
  /** 结束时设计的动物有多少只。 */
  count: number;
}

export function readRecords(): { [id: string]: Record } {
  try {
    return JSON.parse(localStorage.getItem(RECORD_KEY) ?? '{}') as { [id: string]: Record };
  } catch {
    return {};
  }
}

export function writeRecord(id: string, r: Record): void {
  try {
    localStorage.setItem(RECORD_KEY, JSON.stringify({ ...readRecords(), [id]: r }));
  } catch {
    // 存不了就算了。
  }
}

const RECORD_TEXT: { [reply: string]: string } = {
  success: '上次：办成了',
  gone: '上次：一只都没剩下',
  few: '上次：还在，但太少',
  swarm: '上次：泛滥了',
  natives: '上次：伤着了岛上的鸟',
  habitat: '上次：把岛啃秃了',
};

export function showOffice(el: HTMLElement, scenarios: readonly Scenario[], open: (id: string) => void): void {
  const records = readRecords();
  const card = document.createElement('div');
  card.className = 'modal-card office';
  const title = document.createElement('div');
  title.className = 'modal-title';
  title.textContent = '生生事务所';
  const sub = document.createElement('p');
  sub.className = 'note';
  sub.textContent = '设计一种动物，看世界怎么验收它。';
  const cat = document.createElement('p');
  cat.textContent = '糖饼趴在今天的信上。你把信从它肚子底下抽了出来。';
  card.append(title, sub, cat);
  scenarios.forEach((s, i) => {
    const letter = document.createElement('button');
    letter.className = 'office-letter';
    const from = document.createElement('b');
    from.textContent = `${s.name} · ${s.client.name}`;
    const first = document.createElement('span');
    first.textContent = s.client.letter.slice(1, 3).join('');
    const tag = document.createElement('span');
    tag.className = 'note';
    const r = records[s.id];
    tag.textContent = [i === 0 ? '第一份委托，从这里开始' : s.goal.establish ? '' : '大一些的委托：兽医的工具都在这里', r ? `${RECORD_TEXT[r.reply] ?? '上次办过'}${r.count > 0 ? `（${r.count} 只）` : ''}` : '']
      .filter((t) => t)
      .join(' · ');
    letter.append(from, first, tag);
    letter.addEventListener('click', () => open(s.id));
    card.append(letter);
  });
  const toy = document.createElement('a');
  toy.className = 'note';
  toy.href = `${import.meta.env.BASE_URL}desk.html?cut=P11-cat`;
  toy.textContent = '不接委托，只想在设计台上摆弄一会儿 →';
  card.append(toy);
  el.replaceChildren(card);
  el.style.display = '';
}
