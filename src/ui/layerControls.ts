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
 * 引进了新物种时调 setSpecies：按钮和死亡热力的物种表跟着换，当前开着的图层不变（物种下标只增不改）。
 */
export function bindLayerControls(
  bar: HTMLElement,
  speciesNames: readonly string[],
  onChange: (layer: DataLayer) => void,
): { legend: (text: string) => void; setSpecies: (names: readonly string[]) => void } {
  const deathSpecies = document.createElement('select');
  const deathFilter = document.createElement('select');
  for (const [value, label] of FILTERS) deathFilter.add(new Option(label, value));
  const deathRow = document.createElement('div');
  deathRow.className = 'bar';
  const legend = document.createElement('span');
  legend.className = 'note';
  deathRow.append(legend, deathSpecies, deathFilter);
  deathRow.style.display = 'none';

  const deathLayer = (): DataLayer => ({ kind: 'deaths', index: Number(deathSpecies.value), filter: deathFilter.value as DeathFilter });
  const row = document.createElement('div');
  row.className = 'bar';
  /** 开着的是哪一层：按钮的键（'veg'、物种下标、'deaths'）。 */
  let active: 'veg' | 'deaths' | number = 'veg';

  const setSpecies = (names: readonly string[]): void => {
    const keep = deathSpecies.value;
    deathSpecies.replaceChildren(...names.map((name, i) => new Option(name, String(i))));
    if (keep !== '' && Number(keep) < names.length) deathSpecies.value = keep;
    const options: Array<[typeof active, string, () => DataLayer]> = [
      ['veg', '植被', () => ({ kind: 'vegetation' })],
      ...names.map((name, index) => [index, name, () => ({ kind: 'species', index })] as [typeof active, string, () => DataLayer]),
      ['deaths', '死亡热力', deathLayer],
    ];
    const buttons = options.map(([key, label, make]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.classList.toggle('active', key === active);
      b.addEventListener('click', () => {
        active = key;
        buttons.forEach((x, k) => x.classList.toggle('active', options[k]![0] === key));
        deathRow.style.display = key === 'deaths' ? '' : 'none';
        onChange(make());
      });
      return b;
    });
    row.replaceChildren(...buttons);
  };
  setSpecies(speciesNames);
  for (const sel of [deathSpecies, deathFilter]) sel.addEventListener('change', () => onChange(deathLayer()));
  bar.append(row, deathRow);
  return { legend: (text) => (legend.textContent = text), setSpecies };
}
