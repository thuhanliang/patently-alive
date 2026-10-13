import type { FixedStepClock } from '../sim';

const SPEEDS = [1, 10, 100] as const;

/**
 * 时间控制：暂停 / 继续（空格）、单步一天（.）、倍速 1 / 10 / 100（[ ] 切换）。
 * 只影响"多快看到"，不影响推演结果；第 5 步改成走统一操作接口、写进操作日志。
 */
export function bindTimeControls(
  bar: HTMLElement,
  clock: FixedStepClock,
  stepOneDay: () => void,
): () => void {
  let resumeSpeed = clock.speed > 0 ? clock.speed : 1;

  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', onClick);
    bar.appendChild(b);
    return b;
  };

  const togglePause = (): void => {
    if (clock.speed > 0) {
      resumeSpeed = clock.speed;
      clock.speed = 0;
    } else {
      clock.speed = resumeSpeed;
    }
    clock.reset();
  };
  const setSpeed = (s: number): void => {
    resumeSpeed = s;
    clock.speed = s;
  };

  const pauseBtn = button('暂停 [空格]', togglePause);
  button('单步一天 [.]', () => {
    if (clock.speed > 0) togglePause();
    stepOneDay();
  });
  const speedBtns = SPEEDS.map((s) => [s, button(`${s}x`, () => setSpeed(s))] as const);

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      togglePause();
    } else if (e.key === '.') {
      if (clock.speed > 0) togglePause();
      stepOneDay();
    } else if (e.key === ']' || e.key === '[') {
      const i = SPEEDS.indexOf(resumeSpeed as (typeof SPEEDS)[number]);
      const next = SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, (i < 0 ? 0 : i) + (e.key === ']' ? 1 : -1)))]!;
      setSpeed(next);
    }
  });

  return () => {
    pauseBtn.textContent = clock.speed > 0 ? '暂停 [空格]' : '继续 [空格]';
    pauseBtn.classList.toggle('active', clock.speed === 0);
    for (const [s, b] of speedBtns) b.classList.toggle('active', clock.speed > 0 && clock.speed === s);
  };
}
