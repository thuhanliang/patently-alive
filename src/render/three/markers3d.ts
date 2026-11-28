import { BoxGeometry, ConeGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, RingGeometry, ShapeGeometry, Shape, type Object3D } from 'three';
import type { SimState } from '../../sim';
import type { Tools as ToolParams } from '../../data/schema/tools';
import { BLUEPRINT, VERMILION } from '../palette';
import type { ReliefField } from './relief';
import { levelTop } from './relief';

/**
 * 纸雕岛上的干预和警报（2026-11-28，A 段）：按美术规定——
 * 干预是蓝图蓝的纸件：陷阱是方笼、采样是圆环、搜捕是一圈、尸检是十字、围栏是木桩加蓝绳；
 * 警报是朱红的纸旗，同一时间只有一处。只读推演的状态（jobs、fences），不改推演。
 */
const blue = new MeshStandardMaterial({ color: BLUEPRINT, roughness: 0.85, side: DoubleSide });
const blueSoft = new MeshStandardMaterial({ color: BLUEPRINT, roughness: 0.85, side: DoubleSide, transparent: true, opacity: 0.55 });
const wood = new MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.9 });
const red = new MeshStandardMaterial({ color: VERMILION, roughness: 0.8, side: DoubleSide });

export class Markers3D {
  readonly root = new Group();
  private sig = '';
  private readonly alert = new Group();
  private alertKey = '';

  constructor(
    private readonly field: ReliefField,
    private readonly W: number,
    private readonly H: number,
    private readonly tools: ToolParams | null,
  ) {
    // 警报的纸旗：一根木杆 + 一面三角旗。
    const pole = new Mesh(new CylinderGeometry(0.03, 0.03, 1.6, 6), wood);
    pole.position.y = 0.8;
    const s = new Shape();
    s.moveTo(0, 0);
    s.lineTo(0.7, -0.22);
    s.lineTo(0, -0.44);
    const flag = new Mesh(new ShapeGeometry(s), red);
    flag.position.set(0.03, 1.58, 0);
    this.alert.add(pole, flag);
    this.alert.visible = false;
    this.root.add(this.alert);
  }

  private at(x: number, y: number): [number, number, number] {
    const wx = x - this.W / 2;
    const wz = y - this.H / 2;
    return [wx, levelTop(Math.max(0, this.field.levelAt(wx, wz))), wz];
  }

  setAlert(at: { x: number; y: number } | null): void {
    const key = at ? `${at.x},${at.y}` : '';
    if (key === this.alertKey) return;
    this.alertKey = key;
    this.alert.visible = !!at;
    if (at) this.alert.position.set(...this.at(at.x + 0.5, at.y + 0.5));
  }

  /** 翻一下旗（每帧）。 */
  wave(t: number): void {
    const flag = this.alert.children[1];
    if (flag) flag.rotation.y = Math.sin(t * 2.3) * 0.35;
  }

  update(state: Readonly<SimState>, fenceStart: { x: number; y: number } | null): void {
    const sig = state.jobs.map((j) => `${j.kind}${j.id}@${j.x},${j.y}`).join(',') + '|' + state.fences.map((f) => f.id).join(',') + '|' + (fenceStart ? `${fenceStart.x},${fenceStart.y}` : '');
    if (sig === this.sig) return;
    this.sig = sig;
    for (const c of [...this.root.children]) if (c !== this.alert) this.root.remove(c);
    const add = (o: Object3D, x: number, y: number): void => {
      o.position.set(...this.at(x, y));
      this.root.add(o);
    };
    const fence = (x0: number, y0: number, x1: number, y1: number, soft: boolean): void => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const n = Math.max(1, Math.round(len));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const stake = new Mesh(new CylinderGeometry(0.04, 0.05, 0.5, 6), wood);
        stake.position.y = 0.25;
        const g = new Group();
        g.add(stake);
        add(g, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        if (k < n) {
          const [ax, ay, az] = this.at(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
          const [bx, by, bz] = this.at(x0 + (x1 - x0) * ((k + 1) / n), y0 + (y1 - y0) * ((k + 1) / n));
          const rope = new Mesh(new BoxGeometry(Math.hypot(bx - ax, bz - az), 0.025, 0.025), soft ? blueSoft : blue);
          rope.position.set((ax + bx) / 2, Math.max(ay, by) + 0.38, (az + bz) / 2);
          rope.rotation.y = -Math.atan2(bz - az, bx - ax);
          this.root.add(rope);
        }
      }
    };
    for (const f of state.fences) fence(f.x0, f.y0, f.x1, f.y1, false);
    for (const job of state.jobs) {
      const cx = job.x + 0.5;
      const cy = job.y + 0.5;
      const g = new Group();
      if (job.kind === 'trap') {
        // 方笼：一只蓝纸的笼子，四周的范围画一圈细框。
        const cage = new Mesh(new BoxGeometry(0.4, 0.3, 0.4), blue);
        cage.position.y = 0.15;
        g.add(cage);
        const spread = this.tools?.traps[job.trap]?.spreadCells ?? 0;
        const half = spread > 0 ? spread + 0.5 : 1.5;
        const frame = new Mesh(new RingGeometry(half * 1.38, half * 1.41, 4, 1, Math.PI / 4), blueSoft);
        frame.rotation.x = -Math.PI / 2;
        frame.position.y = 0.04;
        g.add(frame);
      } else if (job.kind === 'sample' || job.kind === 'cull' || job.kind === 'necropsy') {
        const r = job.kind === 'sample' ? (this.tools?.sample.radiusCells ?? 1) : job.kind === 'cull' ? (this.tools?.cull.radiusCells ?? 1) : (this.tools?.necropsy.radiusCells ?? 1);
        const ring = new Mesh(new RingGeometry(r * 0.94, r, 40), job.kind === 'sample' ? blueSoft : blue);
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.04;
        g.add(ring);
        if (job.kind === 'necropsy') {
          for (const rot of [0, Math.PI / 2]) {
            const bar = new Mesh(new BoxGeometry(0.9, 0.03, 0.08), blue);
            bar.rotation.y = rot;
            bar.position.y = 0.05;
            g.add(bar);
          }
        }
        if (job.kind === 'sample') {
          // 采样点中间一个立着的小三角（诱饵/样点的纸签）。
          const tag = new Mesh(new ConeGeometry(0.12, 0.3, 3), blue);
          tag.position.y = 0.15;
          g.add(tag);
        }
      } else if (job.kind === 'fence') {
        fence(job.fence.x0, job.fence.y0, job.fence.x1, job.fence.y1, true);
        continue;
      }
      add(g, cx, cy);
    }
    if (fenceStart) {
      const stake = new Mesh(new CylinderGeometry(0.05, 0.06, 0.6, 6), blue);
      stake.position.y = 0.3;
      const g = new Group();
      g.add(stake);
      add(g, fenceStart.x, fenceStart.y);
    }
  }
}
