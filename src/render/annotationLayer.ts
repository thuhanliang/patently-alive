import { Container, Graphics, Text } from 'pixi.js';
import type { SimState } from '../sim';
import { BLUEPRINT } from './palette';
import { CELL_PX } from './projection';

/**
 * 玩家干预的批注（蓝图蓝，见 CLAUDE.md「美术」）：陷阱方形、搜捕范围圆圈，旁边写剩几晚。
 * 只读推演状态里进行中的工作（state.jobs）。
 */
export class AnnotationLayer {
  readonly container = new Container();
  private readonly marks = new Graphics();
  private readonly labels = new Container();
  private key = '';

  constructor(private readonly cullRadiusCells: number) {
    this.container.addChild(this.marks, this.labels);
  }

  draw(state: Readonly<SimState>): void {
    const key = state.jobs.map((j) => `${j.kind}${j.id}@${j.x},${j.y}:${j.nightsLeft}`).join(',');
    if (key === this.key) return;
    this.key = key;
    this.marks.clear();
    for (const l of this.labels.removeChildren()) l.destroy();
    for (const job of state.jobs) {
      const cx = (job.x + 0.5) * CELL_PX;
      const cy = (job.y + 0.5) * CELL_PX;
      if (job.kind === 'trap') {
        const half = CELL_PX * 1.5;
        this.marks.rect(cx - half, cy - half, half * 2, half * 2).stroke({ width: 2, color: BLUEPRINT });
        this.marks.rect(cx - half / 3, cy - half / 3, (half * 2) / 3, (half * 2) / 3).fill({ color: BLUEPRINT, alpha: 0.6 });
      } else {
        this.marks.circle(cx, cy, this.cullRadiusCells * CELL_PX).stroke({ width: 2, color: BLUEPRINT });
      }
      const t = new Text({
        text: `${job.nightsLeft} 晚`,
        style: { fill: BLUEPRINT, fontSize: 11, fontFamily: 'sans-serif', fontWeight: '600' },
      });
      t.position.set(cx + CELL_PX * 1.8, cy - CELL_PX * 1.8);
      t.resolution = 2;
      this.labels.addChild(t);
    }
  }
}
