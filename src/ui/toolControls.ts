import type { OpLog } from '../sim';

export interface ToolCallbacks {
  reseed(seed: number): void;
  exportLog(): OpLog;
  importLog(json: unknown): void;
}

/**
 * 工具栏：投放（选物种和数量，打开投放模式后点地图）、改种子、导出 / 载入操作日志。
 * 返回的 isReleasing() 告诉地图点击该不该当成投放。
 */
export function bindToolControls(
  bar: HTMLElement,
  species: ReadonlyArray<{ id: string; name: string }>,
  cb: ToolCallbacks,
): { isReleasing: () => boolean; releaseChoice: () => { id: string; count: number } } {
  const select = document.createElement('select');
  for (const s of species) {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.name;
    select.appendChild(o);
  }
  const count = document.createElement('input');
  count.type = 'number';
  count.min = '1';
  count.max = '10000';
  count.value = '10';
  count.style.width = '5em';
  const toggle = document.createElement('button');
  toggle.textContent = '投放模式';
  let releasing = false;
  toggle.addEventListener('click', () => {
    releasing = !releasing;
    toggle.classList.toggle('active', releasing);
  });

  const seed = document.createElement('input');
  seed.type = 'number';
  seed.min = '0';
  seed.placeholder = '种子';
  seed.style.width = '6em';
  const reseed = document.createElement('button');
  reseed.textContent = '换种子重开';
  reseed.addEventListener('click', () => {
    const n = Number(seed.value);
    if (Number.isInteger(n) && n >= 0 && n <= 0xffff_ffff) cb.reseed(n);
  });

  const exportBtn = document.createElement('button');
  exportBtn.textContent = '导出日志';
  exportBtn.addEventListener('click', () => {
    const log = cb.exportLog();
    const blob = new Blob([JSON.stringify(log)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `patently-alive-seed${log.config.seed}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.style.display = 'none';
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    cb.importLog(JSON.parse(await f.text()));
    file.value = '';
  });
  const importBtn = document.createElement('button');
  importBtn.textContent = '载入日志回放';
  importBtn.addEventListener('click', () => file.click());

  const row1 = document.createElement('div');
  row1.className = 'bar';
  row1.append(select, count, toggle);
  const row2 = document.createElement('div');
  row2.className = 'bar';
  row2.append(seed, reseed, exportBtn, importBtn, file);
  bar.append(row1, row2);

  return {
    isReleasing: () => releasing,
    releaseChoice: () => ({ id: select.value, count: Math.max(1, Math.min(10_000, Math.floor(Number(count.value) || 1))) }),
  };
}
