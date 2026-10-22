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
): () => void {
  let resumeSpeed = getSpeed() > 0 ? getSpeed() : 1;

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
  button('+1天', '单步一天 [.]', step).classList.add('wide');
  const speedBtns = SPEEDS.map((s) => [s, button(`${s}×`, `${s} 倍速 [ [ ] 切换 ]`, () => choose(s))] as const);

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === ' ') {
      e.preventDefault();
      togglePause();
    } else if (e.key === '.') {
      step();
    } else if (e.key === ']' || e.key === '[') {
      const i = SPEEDS.indexOf(resumeSpeed as (typeof SPEEDS)[number]);
      choose(SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + (e.key === ']' ? 1 : -1)))]!);
    }
  });

  return () => {
    const speed = getSpeed();
    pauseBtn.textContent = speed > 0 ? '❚❚' : '▶';
    pauseBtn.classList.toggle('active', speed === 0);
    for (const [s, b] of speedBtns) b.classList.toggle('active', speed > 0 && speed === s);
  };
}
