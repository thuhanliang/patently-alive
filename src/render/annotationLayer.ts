import { Container, Graphics, Text } from 'pixi.js';
import type { Tools } from '../data';
import type { SimState } from '../sim';
import { BLUEPRINT, VERMILION } from './palette';
import { CELL_PX } from './projection';

/**
 * 玩家干预的批注（蓝图蓝，见 CLAUDE.md「美术」）：陷阱方形、搜捕范围实线圈、采样虚线圈、找尸体的圆圈加十字、围栏线。
 * 进行中的工作旁边写剩几晚（几天）；完工的围栏画实线，在建的画淡线。
 * 只读推演状态（state.jobs、state.fences）。
 */
export class AnnotationLayer {
  readonly container = new Container();
  private readonly marks = new Graphics();
  /** 警报圈单独一层：放大到地块档时它比屏幕还大，由 MapView 藏起来。 */
  readonly alertRing = new Graphics();
  private readonly labels = new Container();
  private key = '';

  constructor(private readonly tools: Tools | undefined) {
    this.container.addChild(this.alertRing, this.marks, this.labels);
  }

  /** 正在画的围栏的起点（格角坐标），没在画时为 null。 */
  fenceStart: { x: number; y: number } | null = null;
  /** 最响的警报的位置（格子坐标）；朱红圈，同一时间只有一处。 */
  alertAt: { x: number; y: number } | null = null;

  draw(state: Readonly<SimState>): void {
    const start = this.fenceStart;
    const key =
      state.jobs.map((j) => `${j.kind}${j.id}@${j.x},${j.y}:${j.nightsLeft}`).join(',') +
      '|' +
      state.fences.map((f) => f.id).join(',') +
      '|' +
      (start ? `${start.x},${start.y}` : '') +
      '|' +
      (this.alertAt ? `${this.alertAt.x},${this.alertAt.y}` : '');
    if (key === this.key) return;
    this.key = key;
    this.marks.clear();
    for (const l of this.labels.removeChildren()) l.destroy();

    this.alertRing.clear();
    if (this.alertAt) {
      // 警报：朱红的双圈，圈住这一片（区块约 8 格）。
      const ax = (this.alertAt.x + 0.5) * CELL_PX;
      const ay = (this.alertAt.y + 0.5) * CELL_PX;
      this.alertRing.circle(ax, ay, CELL_PX * 6).stroke({ width: 3, color: VERMILION });
      this.alertRing.circle(ax, ay, CELL_PX * 7.2).stroke({ width: 1.5, color: VERMILION, alpha: 0.6 });
    }
    if (start) {
      // 围栏起点：蓝图蓝的小圆点加圈。
      const sx = start.x * CELL_PX;
      const sy = start.y * CELL_PX;
      this.marks.circle(sx, sy, CELL_PX * 0.6).fill({ color: BLUEPRINT });
      this.marks.circle(sx, sy, CELL_PX * 1.6).stroke({ width: 1.5, color: BLUEPRINT });
    }
    for (const f of state.fences) {
      this.marks.moveTo(f.x0 * CELL_PX, f.y0 * CELL_PX).lineTo(f.x1 * CELL_PX, f.y1 * CELL_PX).stroke({ width: 3, color: BLUEPRINT });
    }
    for (const job of state.jobs) {
      const cx = (job.x + 0.5) * CELL_PX;
      const cy = (job.y + 0.5) * CELL_PX;
      let unit = '晚';
      if (job.kind === 'trap') {
        // 方框是笼子摊开的范围（单点的陷阱画 3×3 格）。
        const half = CELL_PX * (1.5 + (this.tools?.traps[job.trap]?.spreadCells ?? 0));
        this.marks.rect(cx - half, cy - half, half * 2, half * 2).stroke({ width: 2, color: BLUEPRINT });
        this.marks.rect(cx - half / 3, cy - half / 3, (half * 2) / 3, (half * 2) / 3).fill({ color: BLUEPRINT, alpha: 0.6 });
      } else if (job.kind === 'cull') {
        this.marks.circle(cx, cy, (this.tools?.cull.radiusCells ?? 1) * CELL_PX).stroke({ width: 2, color: BLUEPRINT });
      } else if (job.kind === 'sample') {
        // 采样圆圈：虚线圈，和搜捕的实线圈区分开。
        unit = '天';
        const r = (this.tools?.sample.radiusCells ?? 1) * CELL_PX;
        const dashes = 16;
        for (let k = 0; k < dashes; k++) {
          const a0 = (k / dashes) * Math.PI * 2;
          const a1 = a0 + (Math.PI * 2) / dashes / 2;
          this.marks.moveTo(cx + r * Math.cos(a0), cy + r * Math.sin(a0)).arc(cx, cy, r, a0, a1);
        }
        this.marks.stroke({ width: 2, color: BLUEPRINT });
      } else if (job.kind === 'necropsy') {
        unit = '天';
        this.marks.circle(cx, cy, (this.tools?.necropsy.radiusCells ?? 1) * CELL_PX).stroke({ width: 1.5, color: BLUEPRINT, alpha: 0.7 });
        const arm = CELL_PX;
        this.marks.moveTo(cx - arm, cy).lineTo(cx + arm, cy).moveTo(cx, cy - arm).lineTo(cx, cy + arm).stroke({ width: 2, color: BLUEPRINT });
      } else {
        unit = '天';
        const f = job.fence;
        this.marks.moveTo(f.x0 * CELL_PX, f.y0 * CELL_PX).lineTo(f.x1 * CELL_PX, f.y1 * CELL_PX).stroke({ width: 2, color: BLUEPRINT, alpha: 0.4 });
      }
      const label = job.kind === 'fence' ? `架设中，${job.nightsLeft} ${unit}` : `${job.nightsLeft} ${unit}`;
      const t = new Text({
        text: label,
        style: { fill: BLUEPRINT, fontSize: 11, fontFamily: 'sans-serif', fontWeight: '600' },
      });
      if (job.kind === 'fence') {
        // 写在围栏中点旁边（端点可能在地图边上）。
        const f = job.fence;
        t.position.set(((f.x0 + f.x1) / 2) * CELL_PX + 4, ((f.y0 + f.y1) / 2) * CELL_PX + 4);
      } else {
        t.position.set(cx + CELL_PX * 1.8, cy - CELL_PX * 1.8);
      }
      t.resolution = 2;
      this.labels.addChild(t);
    }
  }
}
