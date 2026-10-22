/**
 * 左边的笔记本：几张书签纸条（记录、死因、曲线、文件），点一张翻开对应的一页，再点收起。
 * 默认收着：现场只露日期、资源和最响的一处警报，曲线、日志、完整数字收进笔记本（DECISIONS"呈现"）。
 */
export function bindNotebook(tabs: HTMLElement, page: HTMLElement, pages: ReadonlyArray<[label: string, el: HTMLElement]>): { open: (i: number) => void } {
  let open = -1;
  const buttons = pages.map(([label], i) => {
    const b = document.createElement('button');
    // 竖排：一个字一行（书签纸条窄）。
    b.innerHTML = [...label].map((ch) => `<span>${ch}</span>`).join('');
    b.addEventListener('click', () => show(open === i ? -1 : i));
    tabs.append(b);
    return b;
  });
  const show = (i: number): void => {
    open = i;
    page.hidden = i < 0;
    pages.forEach(([, el], k) => (el.style.display = k === i ? '' : 'none'));
    buttons.forEach((b, k) => b.classList.toggle('active', k === i));
  };
  show(-1);
  return { open: show };
}
