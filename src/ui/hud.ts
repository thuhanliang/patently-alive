import { checksum, type SimState } from '../sim';

/** 左上角的状态读数：种子、tick、状态校验和。 */
export class Hud {
  constructor(private readonly el: HTMLElement) {}

  update(state: Readonly<SimState>, speed: number): void {
    this.el.textContent = [
      `种子   ${state.config.seed}`,
      `tick   ${state.tick}`,
      `倍速   ${speed}x`,
      `校验和 ${checksum(state).toString(16).padStart(8, '0')}`,
    ].join('\n');
  }
}
