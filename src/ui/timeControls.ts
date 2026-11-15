const SPEEDS = [1, 10, 100] as const;

/**
 * 时间控制：暂停 / 继续（空格）、单步一天（.）、倍速 1 / 10 / 100（[ ] 切换）。
 * 调速和暂停走统一操作接口（写进操作日志）；单步只是推进时间。
 */
export function bindTimeControls(
  bar: HTMLElement,
  getSpeed: () => number,
  setSpeed: (speed: number) => void,
  stepOneDay: () => void,
  /** 不给就是 1 / 10 / 100 倍和单步一天；给了就只有这几档，各带一个名字（不要单步）。 */
  named?: ReadonlyArray<readonly [number, string]>,
): () => void {
  const speeds: readonly number[] = named ? named.map(([s]) => s) : SPEEDS;
  let resumeSpeed = getSpeed() > 0 ? getSpeed() : (named?.[0]?.[0] ?? 1);

  const button = (label: string, title: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };

  const togglePause = (): void => {
    if (getSpeed() > 0) {
      resumeSpeed = getSpeed();
      setSpeed(0);
    } else {
      setSpeed(resumeSpeed);
    }
  };
  const choose = (s: number): void => {
    resumeSpeed = s;
    setSpeed(s);
  };
  const step = (): void => {
    if (getSpeed() > 0) togglePause();
    stepOneDay();
  };

  // 圆纸片按钮：只放符号，说明在 title 里。
  const pauseBtn = button('❚❚', '暂停 / 继续 [空格]', togglePause);
  if (!named) button('+1天', '单步一天 [.]', step).classList.add('wide');
  const speedBtns = named
    ? named.map(([s, label]) => {
        const b = button(label, `${label} [ [ ] 切换 ]`, () => choose(s));
        b.classList.add('wide');
        return [s, b] as const;
      })
    : SPEEDS.map((s) => [s, button(`${s}×`, `${s} 倍速 [ [ ] 切换 ]`, () => choose(s))] as const);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === ' ') {
      e.preventDefault();
      togglePause();
    } else if (e.key === '.' && !named) {
      step();
    } else if (e.key === ']' || e.key === '[') {
      const i = speeds.indexOf(resumeSpeed);
      choose(speeds[Math.max(0, Math.min(speeds.length - 1, (i < 0 ? 0 : i) + (e.key === ']' ? 1 : -1)))]!);
    }
  });

  return () => {
    const speed = getSpeed();
    pauseBtn.textContent = speed > 0 ? '❚❚' : '▶';
    pauseBtn.classList.toggle('active', speed === 0);
    for (const [s, b] of speedBtns) b.classList.toggle('active', speed > 0 && speed === s);
  };
}
