import type { Graphics } from 'pixi.js';
import type { P } from '../../render/puppet/fit';
import type { XrayBones } from '../../render/puppet/handles';
import type { BodyPlan } from '../../render/puppet/plan';
import { SYSTEM_COLORS } from './pie';

/**
 * X 光层（设计台第 3 步 c，`docs/feel/desk.md`）：纸偶淡下去，画出里面的骨头和肌肉，粗细按体重分配。只是画面。
 *
 * - 骨头：沿着纸偶这一帧的骨架画粗线，粗细 ∝ 腿的粗细（BodyPlan.legW，已经按骨骼的份额开过方）；关节画小圆；
 * - 肌肉：大腿、上臂各一块纺锤形，小腿、前臂的小一些；宽 ∝ 肌肉份额的平方根（截面 ∝ 份额、长度不变）；
 * - 颜色和体重分配纸饼一致（骨米白、肌肉肉粉），墨线勾边；远侧的腿淡一些。
 * 骨头多给一倍，骨头就粗一圈；肌肉多给，腿上的肉就鼓起来——拖纸饼的时候打开它看。
 */

const INK = 0x5a4632;

/** 一块纺锤形的肌肉：从 a 到 b，最宽 w（像素）。 */
function spindle(g: Graphics, a: P, b: P, w: number, alpha: number): void {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const N = 10;
  const pts: number[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const h = (w / 2) * Math.sin(Math.PI * t) ** 0.8;
    pts.push(a[0] + dx * t + nx * h, a[1] + dy * t + ny * h);
  }
  for (let i = N - 1; i > 0; i--) {
    const t = i / N;
    const h = (w / 2) * Math.sin(Math.PI * t) ** 0.8;
    pts.push(a[0] + dx * t - nx * h, a[1] + dy * t - ny * h);
  }
  g.poly(pts).fill({ color: SYSTEM_COLORS.muscle, alpha: 0.9 * alpha }).stroke({ color: INK, width: 1, alpha: 0.7 * alpha });
}

/** 一根骨头：墨线的边、米白的芯，两头圆。 */
function bone(g: Graphics, pts: readonly P[], w: number, alpha: number): void {
  if (pts.length < 2) return;
  const path = (): Graphics => {
    g.moveTo(pts[0]![0], pts[0]![1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0], pts[i]![1]);
    return g;
  };
  path().stroke({ color: INK, width: w + 2, alpha: 0.8 * alpha, cap: 'round', join: 'round' });
  path().stroke({ color: SYSTEM_COLORS.skeleton, width: w, alpha, cap: 'round', join: 'round' });
}

/** 画 X 光：bones 已经换成屏幕坐标；z 是每米多少像素。 */
export function drawXray(g: Graphics, b: XrayBones, plan: BodyPlan, z: number): void {
  g.clear();
  const boneW = Math.max(1.5, plan.legW * z * 0.42);
  // 肌肉的截面 ∝ 肌肉的份额（长度不变），宽 ∝ 它的平方根；和骨头的粗细分开算。
  const m = Math.sqrt(plan.relative.muscle);
  const thigh = Math.max(3, 0.1 * plan.bodyLen * z * m);
  const shank = Math.max(2, 0.055 * plan.bodyLen * z * m);
  for (const k of ['farHind', 'farFore', 'nearHind', 'nearFore'] as const) {
    const j = b.legs[k];
    const a = k.startsWith('far') ? 0.45 : 1;
    if (j.length < 4) continue;
    spindle(g, j[0]!, j[1]!, thigh, a);
    spindle(g, j[1]!, j[2]!, shank, a);
    bone(g, j, boneW, a);
    for (const q of j.slice(0, 3)) g.circle(q[0], q[1], boneW * 0.75).fill({ color: SYSTEM_COLORS.skeleton, alpha: a }).stroke({ color: INK, width: 1, alpha: 0.8 * a });
  }
  // 脊柱和颈比腿骨粗一点，尾骨越往后越细。
  bone(g, [b.spine[0], b.spine[1], b.neck[1]], boneW * 1.3, 1);
  for (let i = 0; i + 1 < b.tail.length; i++) bone(g, [b.tail[i]!, b.tail[i + 1]!], Math.max(1, boneW * 0.9 * (1 - (0.6 * i) / Math.max(1, b.tail.length - 1))), 1);
}
