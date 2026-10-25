import { Container, Graphics, TilingSprite, type Texture } from 'pixi.js';
import { BRAD, RIM } from '../paper/tokens';
import type { Shape } from './fit';

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
  /** 成品图画的是哪条现有技术（按它的 BodyPlan 算"原样"的比例，其他身体按比例贴）。 */
  template: string;
  /** 吻从哪里开始、朝哪边（换嘴型时只拉这一段）。 */
  snout: { from: [number, number]; dir: [number, number] };
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
  rim: Graphics;
  body: Graphics;
  mask: Graphics;
  grain: TilingSprite;
  rivets: Graphics;
  /** 现在的形状（零件自己的坐标）：一开始是成品图上的样子，贴骨头以后换成 setShape 给的。 */
  shape: Shape;
  /** 颜色的明暗（远侧的腿调暗）。 */
  shade: number;
  /** 轮廓上离转轴最远的距离：先用它粗判这片零件够不够得着地面。 */
  reach: number;
  /** 弯折（view 坐标里的点 → 点），见 setWarp。 */
  warp: ((X: number, Y: number) => [number, number]) | null;
  /** 上一帧有没有变形过（变形过的，不再变形时要画回原样）。 */
  deformed: boolean;
}

export class Cutout {
  readonly view = new Container();
  private readonly pieces = new Map<string, Piece>();
  private readonly byZ: Piece[] = [];

  constructor(
    readonly data: CutData,
    paper: Texture,
    private readonly dye: Dye,
    /** 影子纸（体型标尺身后的参照动物）：只有平涂的剪影，不画白边、影子、纸纹和铆钉。 */
    private readonly flat = false,
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
    shadows.visible = !flat;
    this.view.addChild(shadows);
    for (const part of parts) {
      const view = new Container();
      const shadow = new Graphics();
      shadows.addChild(shadow);
      const rim = new Graphics();
      const body = new Graphics();
      const mask = new Graphics();
      view.addChild(rim, body);
      // 纸纹：正片叠底，裁到轮廓里（四周多留一圈，压扁时轮廓往两边鼓也盖得住）。
      const grain = new TilingSprite({ texture: paper, width: 1, height: 1 });
      grain.tilePosition.set((part.pivot[0] * 0.7) % 128, (part.pivot[1] * 0.7) % 128);
      grain.blendMode = 'multiply';
      grain.alpha = 0.4;
      grain.mask = mask;
      grain.visible = !flat;
      const rivetLayer = new Graphics();
      view.addChild(grain, mask, rivetLayer);
      const shape: Shape = { outline: part.outline, stripe: part.stripe, pale: part.pale };
      const piece: Piece = { part, view, shadow, rim, body, mask, grain, rivets: rivetLayer, shape, shade: 1, reach: 0, warp: null, deformed: false };
      this.setShape(part.id, shape, rivets.get(part.id) ?? [], piece);
      this.view.addChild(view);
      this.pieces.set(part.id, piece);
      this.byZ.push(piece);
    }
    this.pose({});
  }

  /**
   * 换一片零件的形状（贴骨头以后）和它身上的铆钉（零件自己的坐标，[x, y, 半径]）。
   * 变形（deform）以这个形状为准。
   */
  setShape(id: string, shape: Shape, rivets: [number, number, number][], target?: Piece): void {
    const piece = target ?? this.pieces.get(id);
    if (!piece) return;
    piece.shape = shape;
    let reach = 0;
    for (let i = 0; i < shape.outline.length; i += 2) reach = Math.max(reach, Math.hypot(shape.outline[i]!, shape.outline[i + 1]!));
    piece.reach = reach;
    this.paint(piece, shape.outline, shape.stripe, shape.pale);
    piece.deformed = false;
    const b = piece.body.getLocalBounds();
    piece.grain.width = b.width + 40;
    piece.grain.height = b.height + 40;
    piece.grain.position.set(b.x - 20, b.y - 20);
    piece.rivets.clear();
    if (!this.flat) for (const [x, y, r] of rivets) drawRivet(piece.rivets, x, y, r);
  }

  /** 显示或藏起一片零件（尾巴节数比成品图少时，多出来的藏起来）。 */
  setVisible(id: string, on: boolean): void {
    const piece = this.pieces.get(id);
    if (!piece) return;
    piece.view.visible = on;
    piece.shadow.visible = on;
  }

  /** 颜色调暗（远侧的腿用，约 0.85）。 */
  setShade(id: string, shade: number): void {
    const piece = this.pieces.get(id);
    if (!piece || piece.shade === shade) return;
    piece.shade = shade;
    this.paint(piece, piece.shape.outline, piece.shape.stripe, piece.shape.pale);
  }

  /** 按给定的轮廓和色区重画一片零件（白边、颜色、纸纹遮罩、影子）。 */
  private paint(piece: Piece, outline: number[], stripe: number[][], pale: number[][]): void {
    const k = piece.shade;
    const dye = k === 1 ? this.dye : { main: darken(this.dye.main, k), stripe: darken(this.dye.stripe, k), pale: darken(this.dye.pale, k) };
    piece.shadow.clear().poly(outline).fill({ color: 0x000000, alpha: SHADOW.alpha });
    // 白边：轮廓描粗。
    const rim = this.flat ? dye.main : k === 1 ? RIM : darken(RIM, k);
    piece.rim.clear().poly(outline).fill(rim).stroke({ width: RIM_W * 2, color: rim, join: 'round' });
    piece.body.clear().poly(outline).fill(dye.main);
    for (const s of stripe) piece.body.poly(s).fill(dye.stripe);
    for (const s of pale) piece.body.poly(s).fill(dye.pale);
    piece.mask.clear().poly(outline).fill(0xffffff);
  }

  /**
   * 设一片零件的弯折（view 坐标里的点 → 点），下一次 deform 时生效；null 取消。
   * 用来让一片零件的一部分跟着相邻的骨头弯（例如胸片前上方的“脖子”跟着低头）。
   */
  setWarp(id: string, warp: ((X: number, Y: number) => [number, number]) | null): void {
    const piece = this.pieces.get(id);
    if (piece) piece.warp = warp;
  }

  /**
   * 摆好姿态以后调用：先按 setWarp 弯折，再做地面接触。
   * 地面接触：纸片碰到地面（view 坐标 y = groundY，y 朝下）就被压扁，不穿过地面：
   * 离地面 band 以内的点往地面方向平滑地压（越往下压得越狠，永远到不了地面以下），
   * 被压下去的量一部分往两边鼓出来（像软垫子踩在地上），看起来是“踩实了”而不是被切掉一截。
   * 只重画需要变形的零件；不再变形的零件画回原样。
   */
  deform(groundY: number, band: number, spread = 0.35): void {
    const top = groundY - band;
    for (const piece of this.byZ) {
      if (!piece.view.visible) continue;
      const { view, warp, shape } = piece;
      const near = view.position.y + piece.reach * Math.max(1, view.scale.y) > top;
      const c = Math.cos(view.rotation);
      const sn = Math.sin(view.rotation);
      const sy = view.scale.y;
      const { x: px, y: py } = view.position;
      // 零件坐标 → view 坐标，以及反过来。
      const fwd = (x: number, y: number): [number, number] => [px + x * c - y * sy * sn, py + x * sn + y * sy * c];
      const back = (X: number, Y: number): [number, number] => {
        const dx = X - px;
        const dy = Y - py;
        return [dx * c + dy * sn, (-dx * sn + dy * c) / sy];
      };
      const o = shape.outline;
      // 接触的中心（压进 band 的点的平均 x），鼓出来的方向以它为中心往两边。
      let sumX = 0;
      let n = 0;
      if (near) {
        for (let i = 0; i < o.length; i += 2) {
          let [X, Y] = fwd(o[i]!, o[i + 1]!);
          if (warp) [X, Y] = warp(X, Y);
          if (Y > top) {
            sumX += X;
            n++;
          }
        }
      }
      if (!warp && n === 0) {
        if (piece.deformed) {
          this.paint(piece, o, shape.stripe, shape.pale);
          piece.deformed = false;
        }
        continue;
      }
      const cx = n > 0 ? sumX / n : 0;
      const map = (poly: number[]): number[] => {
        const out = new Array<number>(poly.length);
        for (let i = 0; i < poly.length; i += 2) {
          let [X, Y] = fwd(poly[i]!, poly[i + 1]!);
          if (warp) [X, Y] = warp(X, Y);
          if (n > 0 && Y > top) {
            // band 以内：y' = top + band·(1 − e^(−(y − top)/band))，平滑，到不了地面。
            const Y2 = top + band * (1 - Math.exp(-(Y - top) / band));
            // 往两边鼓：以接触中心为界平滑过渡（tanh），中心附近几乎不动，不会在中间撕出缺口。
            X += Math.tanh((X - cx) / band) * Math.min(Y - Y2, band) * spread;
            Y = Y2;
          }
          const [x, y] = back(X, Y);
          out[i] = x;
          out[i + 1] = y;
        }
        return out;
      };
      this.paint(piece, map(o), shape.stripe.map(map), shape.pale.map(map));
      piece.deformed = true;
    }
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

function darken(c: number, k: number): number {
  return (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);
}

/** 黄铜铆钉：铜圈 + 白色的钉头高光。r 是铜圈的半径。 */
function drawRivet(g: Graphics, x: number, y: number, r: number): Graphics {
  return g
    .circle(x + 1, y + 1.5, r)
    .fill({ color: 0x000000, alpha: 0.3 })
    .circle(x, y, r)
    .fill(BRAD)
    .stroke({ width: 1.5, color: 0x6b5222 })
    .circle(x, y, r * 0.45)
    .fill(0xfbf8f0)
    .stroke({ width: 1, color: 0x8a6d2e });
}
