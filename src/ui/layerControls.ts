import type { DataLayer } from '../render/gridLayer';
import type { DeathFilter } from '../sim';

const FILTERS: Array<[DeathFilter, string]> = [
  ['all', '全部死因'],
  ['predation', '被捕食'],
  ['nest', '巢失败'],
  ['starvation', '饿死'],
  ['other', '其他'],
];

/**
 * 数据图层切换：植被 / 各物种密度 / 死亡热力，一次只开一层。
 * 死亡热力另选物种和死因（默认看第一个物种，岛上就是本地鸟）。
 */
export function bindLayerControls(
  bar: HTMLElement,
  speciesNames: readonly string[],
  onChange: (layer: DataLayer) => void,
): { legend: (text: string) => void } {
  const deathSpecies = document.createElement('select');
  speciesNames.forEach((name, i) => deathSpecies.add(new Option(name, String(i))));
  const deathFilter = document.createElement('select');
  for (const [value, label] of FILTERS) deathFilter.add(new Option(label, value));
  const deathRow = document.createElement('div');
  deathRow.className = 'bar';
  const legend = document.createElement('span');
  legend.className = 'note';
  deathRow.append(legend, deathSpecies, deathFilter);
  deathRow.style.display = 'none';

  const deathLayer = (): DataLayer => ({ kind: 'deaths', index: Number(deathSpecies.value), filter: deathFilter.value as DeathFilter });
  const options: Array<[string, () => DataLayer]> = [
    ['植被', () => ({ kind: 'vegetation' })],
    ...speciesNames.map((name, index) => [name, () => ({ kind: 'species', index })] as [string, () => DataLayer]),
    ['死亡热力', deathLayer],
  ];
  const buttons: HTMLButtonElement[] = [];
  const row = document.createElement('div');
  row.className = 'bar';
  options.forEach(([label, make], i) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      buttons.forEach((x, k) => x.classList.toggle('active', k === i));
      deathRow.style.display = i === options.length - 1 ? '' : 'none';
      onChange(make());
    });
    row.appendChild(b);
    buttons.push(b);
  });
  for (const sel of [deathSpecies, deathFilter]) sel.addEventListener('change', () => onChange(deathLayer()));
  buttons[0]?.classList.add('active');
  bar.append(row, deathRow);
  return { legend: (text) => (legend.textContent = text) };
}
