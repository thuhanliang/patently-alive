import type { Tools } from '../data';
import { costOf, type Op } from '../sim';

/**
 * 兽医箱：选工具（各种陷阱、夜间搜捕、找尸体、围栏），设好参数，打开"放置"后在地图上点。
 * 围栏要点两下（起点、终点，吸附到最近的格角）；其余点一下。
 * 生成的操作交给统一操作接口；花费按工具数据预先显示，接口那边再校验一遍。
 */
export interface FieldToolsHandle {
  /** 是不是在放置模式（地图点击该当成放置）。 */
  isPlacing(): boolean;
  /** 关掉放置模式（打开别的点击模式时调用）。 */
  stop(): void;
  /**
   * 地图上点了一下：cell 是点中的格子，corner 是最近的格角。
   * 返回要提交的操作；围栏的第一下只记下起点，返回 null。提交成功后调用方应调用 stop()。
   */
  click(cell: Point, corner: Point): Op | null;
  /** 正在画的围栏的起点（没在画时为 null）。 */
  fenceStart(): Point | null;
}

interface Point {
  x: number;
  y: number;
}

export function bindFieldTools(
  host: HTMLElement,
  tools: Tools,
  species: ReadonlyArray<{ id: string; name: string }>,
  cellSizeM: number,
  onStart: () => void,
): FieldToolsHandle {
  const title = document.createElement('div');
  title.className = 'panel-title';
  title.textContent = '兽医箱';

  const tool = document.createElement('select');
  for (const t of tools.traps) tool.add(new Option(t.name, `trap:${t.id}`));
  tool.add(new Option(tools.cull.name, 'cull'));
  tool.add(new Option(tools.necropsy.name, 'necropsy'));
  for (const f of tools.fences) tool.add(new Option(f.name, `fence:${f.id}`));

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

  // 找尸体：要哪个物种的（默认不限）。
  const carcass = document.createElement('select');
  carcass.add(new Option('不限物种', ''));
  for (const s of species) carcass.add(new Option(s.name, s.id));
  const carcassRow = document.createElement('div');
  carcassRow.className = 'bar';
  carcassRow.append(text('找：'), carcass, text('的新鲜尸体'));

  const place = document.createElement('button');
  place.textContent = '放置';
  let placing = false;
  let start: Point | null = null;
  const isFence = (): boolean => tool.value.startsWith('fence:');
  const setPlacing = (on: boolean): void => {
    placing = on;
    start = null;
    place.classList.toggle('active', on);
    place.textContent = on ? (isFence() ? '点起点' : '在地图上点一下') : '放置';
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

  /** 点一下就放置的工具在 (x, y) 的操作。 */
  const pointOp = (x: number, y: number): Op => {
    const [kind, id] = tool.value.split(':');
    if (kind === 'trap') {
      const n = Math.max(1, Math.min(30, Math.floor(Number(nights.value) || 1)));
      const remove = removeBoxes.filter((b) => b.box.checked).map((b) => b.box.value);
      return { type: 'trap', trap: id!, x, y, nights: n, remove };
    }
    if (kind === 'necropsy') return { type: 'necropsy', species: carcass.value === '' ? null : carcass.value, x, y };
    return { type: 'cull', species: target.value, x, y };
  };

  const refresh = (): void => {
    const kind = tool.value.split(':')[0];
    nightsLabel.style.display = kind === 'trap' ? '' : 'none';
    removeRow.style.display = kind === 'trap' ? '' : 'none';
    targetRow.style.display = kind === 'cull' ? '' : 'none';
    carcassRow.style.display = kind === 'necropsy' ? '' : 'none';
    if (kind === 'fence') {
      // 围栏按长度计价，画之前只能报单价。
      const f = tools.fences.find((t) => `fence:${t.id}` === tool.value)!;
      cost.textContent = `每公里 ${f.costPerKm.toLocaleString('zh-CN')} 元，一支队伍一天架 ${f.kmPerDay} 公里；完工后才挡得住`;
      return;
    }
    const c = costOf(pointOp(0, 0), tools, cellSizeM);
    const extra = c.satisfaction < 0 ? `，满意度 ${c.satisfaction}` : '';
    cost.textContent = `${c.budget.toLocaleString('zh-CN')} 元，${c.staff} 支队伍 ${c.days} 天${extra}`;
  };
  tool.addEventListener('change', () => setPlacing(false));
  for (const elm of [tool, nights, target, carcass, ...removeBoxes.map((b) => b.box)]) elm.addEventListener('change', refresh);
  nights.addEventListener('input', refresh);
  // 默认：猫笼抓到猫就移除，搜捕也默认找猫（默认值不该是本地鸟）。
  removeBoxes.find((b) => b.box.value === 'cat')?.box.setAttribute('checked', '');
  if (species.some((s) => s.id === 'cat')) target.value = 'cat';
  refresh();

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.append(title, row1, removeRow, targetRow, carcassRow, cost);
  host.appendChild(panel);

  return {
    isPlacing: () => placing,
    stop: () => setPlacing(false),
    fenceStart: () => start,
    click: (cell, corner) => {
      if (!isFence()) return pointOp(cell.x, cell.y);
      if (!start) {
        start = { ...corner };
        place.textContent = '点终点';
        return null;
      }
      // 起点留到提交成功、放置模式关掉（stop）时才清；被拒绝时可以直接重点终点。
      return { type: 'fence', fence: tool.value.slice('fence:'.length), x0: start.x, y0: start.y, x1: corner.x, y1: corner.y };
    },
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
