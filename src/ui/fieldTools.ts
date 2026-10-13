import type { Tools } from '../data';
import { costOf, type Op } from '../sim';

/**
 * 兽医箱：选工具（各种陷阱、夜间搜捕），设好参数，打开"放置"后在地图上点一下。
 * 生成的操作交给统一操作接口；花费按工具数据预先显示，接口那边再校验一遍。
 */
export interface FieldToolsHandle {
  /** 是不是在放置模式（地图点击该当成放置）。 */
  isPlacing(): boolean;
  /** 关掉放置模式（打开别的点击模式时调用）。 */
  stop(): void;
  /** 在 (x, y) 放置当前工具的操作。 */
  opAt(x: number, y: number): Op;
}

export function bindFieldTools(
  host: HTMLElement,
  tools: Tools,
  species: ReadonlyArray<{ id: string; name: string }>,
  onStart: () => void,
): FieldToolsHandle {
  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = '兽医箱';

  const tool = document.createElement('select');
  for (const t of tools.traps) tool.add(new Option(t.name, `trap:${t.id}`));
  tool.add(new Option(tools.cull.name, 'cull'));

  const nights = document.createElement('input');
  nights.type = 'number';
  nights.min = '1';
  nights.max = '30';
  nights.value = '7';
  nights.style.width = '4em';
  const nightsLabel = label('放', nights, '晚');

  // 陷阱：抓到哪些就移除（其余放生）。搜捕：移除哪一种。
  const removeBoxes = species.map((s) => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = s.id;
    return { box, wrap: label('', box, s.name) };
  });
  const removeRow = document.createElement('div');
  removeRow.className = 'bar';
  removeRow.append(text('抓到就移除：'), ...removeBoxes.map((b) => b.wrap));

  const target = document.createElement('select');
  for (const s of species) target.add(new Option(s.name, s.id));
  const targetRow = document.createElement('div');
  targetRow.className = 'bar';
  targetRow.append(text('移除：'), target);

  const place = document.createElement('button');
  place.textContent = '放置';
  let placing = false;
  const setPlacing = (on: boolean): void => {
    placing = on;
    place.classList.toggle('active', on);
    place.textContent = on ? '在地图上点一下' : '放置';
  };
  place.addEventListener('click', () => {
    if (!placing) onStart();
    setPlacing(!placing);
  });

  const cost = document.createElement('div');
  cost.className = 'note';

  const row1 = document.createElement('div');
  row1.className = 'bar';
  row1.append(tool, nightsLabel, place);

  const current = (): Op => {
    const [kind, id] = tool.value.split(':');
    if (kind === 'trap') {
      const n = Math.max(1, Math.min(30, Math.floor(Number(nights.value) || 1)));
      const remove = removeBoxes.filter((b) => b.box.checked).map((b) => b.box.value);
      return { type: 'trap', trap: id!, x: 0, y: 0, nights: n, remove };
    }
    return { type: 'cull', species: target.value, x: 0, y: 0 };
  };

  const refresh = (): void => {
    const op = current();
    const isTrap = op.type === 'trap';
    nightsLabel.style.display = isTrap ? '' : 'none';
    removeRow.style.display = isTrap ? '' : 'none';
    targetRow.style.display = isTrap ? 'none' : '';
    const c = costOf(op, tools);
    const extra = c.satisfaction < 0 ? `，满意度 ${c.satisfaction}` : '';
    cost.textContent = `${c.budget.toLocaleString('zh-CN')} 元，${c.staff} 支队伍 ${c.days} 天${extra}`;
  };
  for (const elm of [tool, nights, target, ...removeBoxes.map((b) => b.box)]) elm.addEventListener('change', refresh);
  nights.addEventListener('input', refresh);
  // 默认：猫笼抓到猫就移除，搜捕也默认找猫（默认值不该是本地鸟）。
  removeBoxes.find((b) => b.box.value === 'cat')?.box.setAttribute('checked', '');
  if (species.some((s) => s.id === 'cat')) target.value = 'cat';
  refresh();

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.append(title, row1, removeRow, targetRow, cost);
  host.appendChild(panel);

  return {
    isPlacing: () => placing,
    stop: () => setPlacing(false),
    opAt: (x, y) => ({ ...current(), x, y }),
  };
}

function label(before: string, input: HTMLElement, after: string): HTMLLabelElement {
  const l = document.createElement('label');
  l.append(before, input, after);
  return l;
}

function text(t: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.textContent = t;
  return s;
}
