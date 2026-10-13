import type { DataLayer } from '../render/gridLayer';

/** 数据图层切换：植被 / 各物种密度，一次只开一层。 */
export function bindLayerControls(
  bar: HTMLElement,
  speciesNames: readonly string[],
  onChange: (layer: DataLayer) => void,
): void {
  const options: Array<[string, DataLayer]> = [
    ['植被', { kind: 'vegetation' }],
    ...speciesNames.map((name, index) => [name, { kind: 'species', index }] as [string, DataLayer]),
  ];
  const buttons: HTMLButtonElement[] = [];
  options.forEach(([label, layer], i) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => {
      buttons.forEach((x, k) => x.classList.toggle('active', k === i));
      onChange(layer);
    });
    bar.appendChild(b);
    buttons.push(b);
  });
  buttons[0]?.classList.add('active');
}
