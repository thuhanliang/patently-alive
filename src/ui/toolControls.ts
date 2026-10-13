export interface ToolCallbacks {
  reseed(seed: number): void;
  /** 导出存档文件：文件名和内容。 */
  exportFile(): { name: string; text: string };
  /** 只导出操作日志（小，可以从头回放；交流、报 bug 用）。 */
  exportLog(): { name: string; text: string };
  /** 载入的文件原文（存档或操作日志）；解析和校验由回调负责，出错时在状态栏说明。 */
  importFile(text: string): void;
  /** 快速存档 / 读档（浏览器里的一个存档位）。 */
  quickSave(): void;
  quickLoad(): void;
}

/**
 * 工具栏：投放（选物种和数量，打开投放模式后点地图）、改种子、存档 / 读档、导出 / 载入存档文件。
 * 返回的 isReleasing() 告诉地图点击该不该当成投放。
 */
export function bindToolControls(
  bar: HTMLElement,
  species: ReadonlyArray<{ id: string; name: string }>,
  cb: ToolCallbacks,
  /** 能不能投放（情景里的管理员身份不能，见 Rules.allowRelease）；不能就不显示投放的控件。 */
  allowRelease = true,
  /** 打开投放模式时调用（关掉别的点击模式）。 */
  onReleaseStart: () => void = () => {},
): { isReleasing: () => boolean; stopReleasing: () => void; releaseChoice: () => { id: string; count: number } } {
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
    if (!releasing) onReleaseStart();
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
  const download = ({ name, text }: { name: string; text: string }): void => {
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    // 有的浏览器异步开始下载，立刻释放链接会让下载失败。
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };
  exportBtn.textContent = '导出存档';
  exportBtn.addEventListener('click', () => download(cb.exportFile()));
  const exportLogBtn = document.createElement('button');
  exportLogBtn.textContent = '导出日志';
  exportLogBtn.addEventListener('click', () => download(cb.exportLog()));

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.style.display = 'none';
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (!f) return;
    try {
      cb.importFile(await f.text());
    } finally {
      // 清空，下次选同一个文件也能触发。
      file.value = '';
    }
  });
  const importBtn = document.createElement('button');
  importBtn.textContent = '载入存档或日志';
  importBtn.addEventListener('click', () => file.click());

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '存档';
  saveBtn.addEventListener('click', () => cb.quickSave());
  const loadBtn = document.createElement('button');
  loadBtn.textContent = '读档';
  loadBtn.addEventListener('click', () => cb.quickLoad());

  const row1 = document.createElement('div');
  row1.className = 'bar';
  row1.append(select, count, toggle);
  const row2 = document.createElement('div');
  row2.className = 'bar';
  row2.append(seed, reseed);
  const row3 = document.createElement('div');
  row3.className = 'bar';
  row3.append(saveBtn, loadBtn, exportBtn, exportLogBtn, importBtn, file);
  bar.append(...(allowRelease ? [row1] : []), row2, row3);

  return {
    isReleasing: () => releasing,
    stopReleasing: () => {
      releasing = false;
      toggle.classList.remove('active');
    },
    releaseChoice: () => ({ id: select.value, count: Math.max(1, Math.min(10_000, Math.floor(Number(count.value) || 1))) }),
  };
}
