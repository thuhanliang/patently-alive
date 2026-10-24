import type { Graphics } from 'pixi.js';
import { HORN, Pen, brad, type Look } from './parts';

/**
 * 鸟的零件（代码画的占位，目前只用来出零件参考图 handoff/007；鸟的骨架和动作以后做）。
 * 和兽的零件一样：每片在自己的坐标里画，转轴（铆钉）在原点，骨头朝 +x；单位是身长 = 100。
 * 嘴（喙）是口器槽的部件，和兽共用 B3 那一套，挂在头的同一个位置。
 */

const LEG_W = 3.2;

/** 身体：蛋形，转轴在髋（腿的挂点）。 */
export function drawBirdBody(g: Graphics, look: Look): void {
  new Pen(g, 'feather').blob(4, -6, 34, 21, look.main, { rot: -0.12 });
  brad(g);
}

/** 颈：转轴在颈根。 */
export function drawBirdNeck(g: Graphics, look: Look): void {
  new Pen(g, 'feather').capsule(14, 15, 12, look.main);
  brad(g);
}

/** 头（不含喙）：转轴在头颈之间。 */
export function drawBirdHead(g: Graphics, look: Look): void {
  const p = new Pen(g, 'feather');
  p.blob(7, -3, 12, 11, look.main);
  p.dot(11, -5, 1.8, 0x141414);
  p.dot(11.6, -5.6, 0.6, 0xf4f1ea);
  brad(g);
}

/** 上喙、下喙（短直的鸻嘴，示意挂点；正式的喙是口器部件）：转轴在嘴角。 */
export function drawBirdBill(g: Graphics, upper: boolean): void {
  new Pen(g, 'smooth').poly(upper ? [0, -2.6, 13, -0.2, 0, 0.6] : [0, -0.4, 11.5, 0.2, 0, 2.2], HORN);
  brad(g);
}

/** 腿四节：0 大腿（带羽毛，短）、1 胫、2 跗跖、3 脚（三趾朝前、一趾朝后）。转轴在近端。 */
export function drawBirdLeg(g: Graphics, look: Look, i: 0 | 1 | 2 | 3): void {
  const p = new Pen(g, i === 0 ? 'feather' : 'smooth');
  if (i === 0) p.blob(6, 0, 10, 6.5, look.main);
  else if (i === 1) p.capsule(20, LEG_W, LEG_W * 0.85, HORN);
  else if (i === 2) p.capsule(19, LEG_W * 0.85, LEG_W * 0.8, HORN);
  else {
    p.capsule(9, 2.2, 1.6, HORN);
    p.g.poly([0, -1, 8, -3.5, 8.6, -2.2, 0, 1]).fill(HORN);
    p.g.poly([0, -1, 8, 3.5, 7.4, 4.6, 0, 1]).fill(HORN);
    p.g.poly([0, -0.8, -4.5, -1.6, -4.5, -0.4, 0, 0.8]).fill(HORN);
  }
  brad(g);
}

/** 收起的翅膀：一片，转轴在肩，往后收成水滴形，后缘一片片的羽毛。 */
export function drawFoldedWing(g: Graphics, look: Look): void {
  new Pen(g, 'feather').blob(-22, 2, 27, 10, look.dark, { rot: 0.08 });
  brad(g);
}

/** 展开的翅膀两节：内侧（肩到腕）、外侧（腕到翼尖的飞羽）。转轴在近端。 */
export function drawSpreadWing(g: Graphics, look: Look, outer: boolean): void {
  const p = new Pen(g, 'feather');
  if (!outer) {
    p.blob(16, 6, 18, 11, look.main);
  } else {
    // 飞羽：几根长羽毛排成扇形。
    for (let f = 0; f < 6; f++) {
      const a = -0.18 + f * 0.11;
      p.blob(18 * Math.cos(a), 18 * Math.sin(a) + 3, 20 - f * 1.2, 3.4, look.dark, { rot: a, edge: 'smooth' });
    }
  }
  brad(g);
}

/** 尾羽：一片扇形，转轴在尾根。 */
export function drawBirdTail(g: Graphics, look: Look): void {
  new Pen(g, 'feather').poly([0, -4, 22, -7, 24, 3, 0, 4], look.dark);
  brad(g);
}
