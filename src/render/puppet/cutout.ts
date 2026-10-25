import { Container, Graphics, TilingSprite, type Texture } from 'pixi.js';
import { BRAD, RIM } from '../paper/tokens';

/**
 * 从 AI 成品图切出来的矢量纸偶（scripts/art/cut_parts.py → vectorize_parts.py 产出的 vector.json）。
 *
 * 每片零件：一条轮廓 + 三档色区（主色 / 条纹 / 浅色，像无限暖暖的染色区），颜色由 Dye 给；
 * 上面用“正片叠底”铺一层从成品图里取的纸纹；白边、影子、铆钉都由代码按轮廓重画（原图上的不要）。
 * 单位是成品图的像素；每片零件的坐标以它的转轴为原点、骨头朝 +x。
 */

export interface CutPart {
  id: string;
  parent: string | null;
  z: number;
  /** 转轴在成品图里的位置（像素）。 */
  pivot: [number, number];
  /** 图上没有铆钉、转轴是估的：不画铆钉。 */
  pivotEstimated: boolean;
  /** 摆成成品图的样子时，零件的转角（弧度，PixiJS 的 y 朝下）。 */
  angle: number;
  lapR: number;
  outline: number[];
  stripe: number[][];
  pale: number[][];
}

export interface CutData {
  /** 成品图的文件名。 */
  source: string;
  size: [number, number];
  palette: { main: string; stripe: string; pale: string };
  parts: CutPart[];
  rig: CutRig;
}

/** 骨架绑定（种子.json 的 rig）：哪几片是腿、头、尾，趾尖在哪，地面多高（都是成品图的像素）。 */
export interface CutRig {
  ground: number;
  hind: string;
  chest: string;
  head: string;
  jaw: string;
  ears: string[];
  tail: string[];
  legs: Record<'nearHind' | 'farHind' | 'nearFore' | 'farFore', { parts: [string, string, string]; toe: [number, number] }>;
}

/** 染色：三档色区各一种颜色。 */
export interface Dye {
  main: number;
  stripe: number;
  pale: number;
}

const RIM_W = 2.6;
const SHADOW = { x: 2.5, y: 4, alpha: 0.32 };

interface Piece {
  part: CutPart;
  view: Container;
  shadow: Graphics;
}

export class Cutout {
  readonly view = new Container();
  private readonly pieces = new Map<string, Piece>();
  private readonly byZ: Piece[] = [];

  constructor(
    readonly data: CutData,
    paper: Texture,
    dye: Dye,
  ) {
    const parts = [...data.parts].sort((a, b) => a.z - b.z);
    const byId = new Map(parts.map((p) => [p.id, p]));
    // 铆钉画在关节处上层的那片上（图上本来有铆钉的关节才画）。
    const rivets = new Map<string, [number, number, number][]>();
    for (const p of parts) {
      if (!p.parent || p.pivotEstimated) continue;
      const par = byId.get(p.parent)!;
      const top = p.z > par.z ? p : par;
      const list = rivets.get(top.id) ?? [];
      // 铆钉大小跟着关节：大关节（髋、肩、躯干）大号，腕、踝、尾节、耳、下颌小号。
      list.push([...toLocal(top, p.pivot), Math.max(6, Math.min(11, p.lapR * 0.32))]);
      rivets.set(top.id, list);
    }
    // 影子单独一层，放在所有零件下面（纸片投在桌上的影子不会盖住别的纸片）。
    const shadows = new Container();
    this.view.addChild(shadows);
    for (const part of parts) {
      const view = new Container();
      const shadow = new Graphics().poly(part.outline).fill({ color: 0x000000, alpha: SHADOW.alpha });
      shadows.addChild(shadow);
      // 白边：轮廓描粗。
      view.addChild(new Graphics().poly(part.outline).fill(RIM).stroke({ width: RIM_W * 2, color: RIM, join: 'round' }));
      const body = new Graphics().poly(part.outline).fill(dye.main);
      for (const s of part.stripe) body.poly(s).fill(dye.stripe);
      for (const s of part.pale) body.poly(s).fill(dye.pale);
      view.addChild(body);
      // 纸纹：正片叠底，裁到轮廓里。
      const b = body.getLocalBounds();
      const grain = new TilingSprite({ texture: paper, width: b.width + 4, height: b.height + 4 });
      grain.position.set(b.x - 2, b.y - 2);
      grain.tilePosition.set((part.pivot[0] * 0.7) % 128, (part.pivot[1] * 0.7) % 128);
      grain.blendMode = 'multiply';
      grain.alpha = 0.4;
      const mask = new Graphics().poly(part.outline).fill(0xffffff);
      grain.mask = mask;
      view.addChild(grain, mask);
      for (const [x, y, r] of rivets.get(part.id) ?? []) view.addChild(rivet(x, y, r));
      this.view.addChild(view);
      const piece = { part, view, shadow };
      this.pieces.set(part.id, piece);
      this.byZ.push(piece);
    }
    this.pose({});
  }

  /** 直接摆一片零件：转轴放在 (x, y)，零件转到 rotation（弧度，PixiJS 的 y 朝下）。sy 是竖直方向的缩放（胸片呼吸用）。 */
  place(id: string, x: number, y: number, rotation: number, sy = 1): void {
    const piece = this.pieces.get(id);
    if (!piece) return;
    piece.view.position.set(x, y);
    piece.view.rotation = rotation;
    piece.view.scale.set(1, sy);
    piece.shadow.position.set(x + SHADOW.x, y + SHADOW.y);
    piece.shadow.rotation = rotation;
  }

  /** 零件的数据。 */
  part(id: string): CutPart | undefined {
    return this.pieces.get(id)?.part;
  }

  /**
   * 摆姿态：delta 是每片零件绕自己转轴相对成品图多转的角度（弧度，子零件跟着转）；
   * explode 给了的话，每片按成品图摆好再平移这么多（炸开图，不转）。
   */
  pose(delta: Record<string, number>, explode?: Record<string, [number, number]>): void {
    const world = new Map<string, { x: number; y: number; acc: number }>();
    const place = (p: CutPart): { x: number; y: number; acc: number } => {
      const hit = world.get(p.id);
      if (hit) return hit;
      let w: { x: number; y: number; acc: number };
      if (explode || !p.parent) {
        const o = explode?.[p.id] ?? [0, 0];
        w = { x: p.pivot[0] + o[0], y: p.pivot[1] + o[1], acc: explode ? 0 : (delta[p.id] ?? 0) };
      } else {
        const par = this.pieces.get(p.parent)!.part;
        const pw = place(par);
        const dx = p.pivot[0] - par.pivot[0];
        const dy = p.pivot[1] - par.pivot[1];
        const c = Math.cos(pw.acc);
        const s = Math.sin(pw.acc);
        w = { x: pw.x + dx * c - dy * s, y: pw.y + dx * s + dy * c, acc: pw.acc + (delta[p.id] ?? 0) };
      }
      world.set(p.id, w);
      return w;
    };
    for (const piece of this.byZ) {
      const w = place(piece.part);
      const rot = piece.part.angle + w.acc;
      piece.view.position.set(w.x, w.y);
      piece.view.rotation = rot;
      piece.shadow.position.set(w.x + SHADOW.x, w.y + SHADOW.y);
      piece.shadow.rotation = rot;
    }
  }
}

/** 成品图坐标 → 零件自己的坐标。 */
function toLocal(p: CutPart, q: [number, number]): [number, number] {
  const dx = q[0] - p.pivot[0];
  const dy = q[1] - p.pivot[1];
  const c = Math.cos(-p.angle);
  const s = Math.sin(-p.angle);
  return [dx * c - dy * s, dx * s + dy * c];
}

/** 黄铜铆钉：铜圈 + 白色的钉头高光。r 是铜圈的半径。 */
function rivet(x: number, y: number, r: number): Graphics {
  return new Graphics()
    .circle(x + 1, y + 1.5, r)
    .fill({ color: 0x000000, alpha: 0.3 })
    .circle(x, y, r)
    .fill(BRAD)
    .stroke({ width: 1.5, color: 0x6b5222 })
    .circle(x, y, r * 0.45)
    .fill(0xfbf8f0)
    .stroke({ width: 1, color: 0x8a6d2e });
}
