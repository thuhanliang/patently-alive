/**
 * "引进 / 投放 N 只"的一栏：数量框（夹在 1–max 之间，离开时改回实际用的数）、按钮、花费说明。
 * 档案馆的引进和设计台的投放共用。
 */
export function countPicker(o: {
  verb: string;
  button: string;
  title: string;
  max: number;
  initial: number;
  /** 数量变了（已夹好）。 */
  onCount: (n: number) => void;
  /** 点了按钮（已夹好的数量）。 */
  onGo: (n: number) => void;
}): { row: HTMLElement; note: HTMLElement; button: HTMLButtonElement } {
  const row = document.createElement('div');
  row.className = 'bar archive-introduce';
  const count = document.createElement('input');
  count.type = 'number';
  count.min = '1';
  count.max = String(o.max);
  count.value = String(o.initial);
  count.style.width = '5em';
  const chosen = (): number => Math.max(1, Math.min(o.max, Math.floor(Number(count.value) || 1)));
  count.addEventListener('input', () => o.onCount(chosen()));
  count.addEventListener('change', () => (count.value = String(chosen())));
  const button = document.createElement('button');
  button.textContent = o.button;
  button.title = o.title;
  button.addEventListener('click', () => o.onGo(chosen()));
  const note = document.createElement('span');
  note.className = 'note';
  const label = document.createElement('label');
  label.append(`${o.verb} `, count, ' 只');
  row.append(label, button, note);
  return { row, note, button };
}
