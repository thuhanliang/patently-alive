import type { Scenario } from '../data';
import { postageStamp, sleepingCat, svgEl } from './paperArt';
import { patentCard, readPatents, showPatent } from './patent';
import { sound } from './sound';

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
  const scene = document.createElement('div');
  scene.className = 'office-scene';
  const sign = document.createElement('div');
  sign.className = 'office-sign';
  const h1 = document.createElement('h1');
  h1.textContent = '生生事务所';
  const sub = document.createElement('p');
  sub.textContent = '设计一种动物，看世界怎么验收它';
  sign.append(h1, sub);
  const desk = document.createElement('div');
  desk.className = 'office-desk';
  scenarios.forEach((s, i) => {
    const letter = document.createElement('button');
    letter.className = 'envelope';
    letter.style.setProperty('--tilt', `${i % 2 === 0 ? -1.6 : 1.3}deg`);
    letter.style.setProperty('--delay', `${0.12 + i * 0.12}s`);
    const to = document.createElement('span');
    to.className = 'to';
    to.textContent = `${s.name} 寄来`;
    const from = document.createElement('span');
    from.className = 'from';
    from.textContent = s.client.name;
    const excerpt = document.createElement('span');
    excerpt.className = 'excerpt';
    excerpt.textContent = `${s.client.letter.slice(1, 3).join('').slice(0, 58)}……`;
    const rec = document.createElement('span');
    rec.className = 'rec';
    const r = records[s.id];
    if (r) {
      const b = document.createElement('b');
      b.textContent = `${RECORD_TEXT[r.reply] ?? '上次办过'}${r.count > 0 ? `（${r.count} 只）` : ''}`;
      rec.append(b);
    } else rec.textContent = i === 0 ? '第一份委托，从这里开始' : s.goal.establish ? '' : '大一些的委托：兽医的工具都在这里';
    const go = document.createElement('span');
    go.className = 'open';
    go.textContent = '拆开 →';
    letter.append(svgEl(postageStamp(s.goal.establish ? 'island' : 'bird')), to, from, excerpt, rec, go);
    letter.addEventListener('pointerenter', () => sound.play('paper'));
    letter.addEventListener('click', () => open(s.id));
    desk.append(letter);
  });
  const foot = document.createElement('div');
  foot.className = 'office-foot';
  const cat = document.createElement('div');
  cat.className = 'cat-line';
  cat.textContent = '糖饼趴在桌角，尾巴压着今天的信。';
  const toy = document.createElement('a');
  toy.href = `${import.meta.env.BASE_URL}desk.html?cut=P11-cat`;
  toy.textContent = '不接委托，只想在设计台上摆弄一会儿 →';
  foot.append(cat, toy);
  // 墙上的证书：办过的委托留下来的，点一张看全文。
  const patents = readPatents();
  const wallTitle = document.createElement('div');
  wallTitle.className = 'office-wall-title';
  wallTitle.textContent = patents.length ? '墙 上 的 证 书' : '';
  const wall = document.createElement('div');
  wall.className = 'office-wall';
  patents.slice(-6).forEach((p, i) => {
    const c = patentCard(p, true);
    c.style.setProperty('--tilt', `${[-2, 1.5, -1, 2.2, -1.6, 0.8][i % 6]}deg`);
    c.addEventListener('click', () => showPatent(p));
    wall.append(c);
  });
  scene.append(sign, wallTitle, wall, desk, foot, svgEl(sleepingCat()));
  el.replaceChildren(scene);
  el.style.display = '';
}
