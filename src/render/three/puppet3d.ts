import { BufferGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, type Material } from 'three';
import type { Cutout, Dye } from '../puppet/cutout';
import { brass, paperMaterial, thinPiece } from './paper';

/**
 * 3D 纸偶（2026-11-22）：照着 2D 的切图纸偶（Cutout）摆——每一片零件是一张真的薄纸片，前后相隔一点点，
 * 用黄铜铆钉钉在一起。姿态、步态、变形全部沿用 2D 那一套（它只算数、不画），这里每帧读每片零件的位置和转角。
 * 零件的形状变了（贴骨头、踩地压扁）时，Cutout 会通知（onPaint），这里重建那一片的几何。
 *
 * 坐标：零件在成品图的像素里，y 朝下；这一组按 metersPerPx 缩到米，并把 y 翻过来（three 的 y 朝上）。
 */

/** 零件之间前后隔多远、纸多厚（成品图像素；1 像素约 1 毫米）。 */
const GAP = 1.6;
const THICK = 1.1;
/** 色区（条纹、浅色）贴在零件正面，比正面高出多少。 */
const LIFT = 0.12;

interface PieceMesh {
  group: Group;
  body: Mesh;
  marks: Mesh[];
  rivets: Mesh[];
  shade: number;
}

const rivetGeom = new CylinderGeometry(1, 1, 1, 18);

export class Puppet3D {
  /** 脚底中点大致在原点（和 2D 纸偶一样），单位是米。 */
  readonly root = new Group();
  private readonly inner = new Group();
  private readonly pieces = new Map<string, PieceMesh>();

  constructor(
    private readonly cut: Cutout,
    metersPerPx: number,
    /** 远看（岛上的演员）：不做铆钉，绘制次数少一大半。 */
    private readonly lite = false,
  ) {
    this.inner.scale.set(metersPerPx, -metersPerPx, metersPerPx);
    this.root.add(this.inner);
    cut.onPaint = (id, outline, stripe, pale, shade, dye) => this.paint(id, outline, stripe, pale, shade, dye);
    cut.repaintAll();
  }

  private materials(shade: number, d: Dye): { main: Material[]; stripe: Material[]; pale: Material[] } {
    const dk = (c: number): number => {
      const k = shade;
      return (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);
    };
    // 纸纹按成品图像素算：一块纹理约 260 像素（一只猫的半个身子）。
    const mk = (c: number): Material[] => [paperMaterial(dk(c), { scale: 260 }), paperMaterial(dk(c), { scale: 260, edge: true })];
    return { main: mk(d.main), stripe: mk(d.stripe), pale: mk(d.pale) };
  }

  private paint(id: string, outline: number[], stripe: number[][], pale: number[][], shade: number, dye: Dye): void {
    let p = this.pieces.get(id);
    const mats = this.materials(shade, dye);
    if (!p) {
      const group = new Group();
      const body = new Mesh(new BufferGeometry(), mats.main);
      body.castShadow = true;
      body.receiveShadow = true;
      group.add(body);
      p = { group, body, marks: [], rivets: [], shade };
      this.pieces.set(id, p);
      this.inner.add(group);
    }
    thinPiece(outline, THICK, p.body.geometry);
    p.body.material = mats.main;
    // 色区：每一块是一小片更薄的纸，贴在正面上。
    const polys = [...stripe.map((q) => [q, mats.stripe] as const), ...pale.map((q) => [q, mats.pale] as const)].filter(([q]) => q.length >= 6);
    while (p.marks.length < polys.length) {
      const m = new Mesh(new BufferGeometry(), mats.stripe);
      m.receiveShadow = true;
      p.group.add(m);
      p.marks.push(m);
    }
    p.marks.forEach((m, i) => {
      const it = polys[i];
      m.visible = !!it;
      if (!it) return;
      thinPiece(it[0], 0.05, m.geometry);
      m.material = it[1];
      m.position.z = THICK + LIFT;
    });
    // 铆钉。
    const spots = this.lite ? [] : this.cut.rivetsOf(id);
    while (p.rivets.length < spots.length) {
      const r = new Mesh(rivetGeom, brass);
      r.rotation.x = Math.PI / 2;
      r.castShadow = true;
      p.group.add(r);
      p.rivets.push(r);
    }
    p.rivets.forEach((r, i) => {
      const sp = spots[i];
      r.visible = !!sp;
      if (!sp) return;
      const rad = sp[2] * 0.55;
      r.scale.set(rad, 2.2, rad);
      r.position.set(sp[0], sp[1], THICK + 1.2);
    });
    p.shade = shade;
  }

  /** 每帧：照 2D 纸偶的零件摆。 */
  sync(): void {
    for (const st of this.cut.pieceStates()) {
      const p = this.pieces.get(st.id);
      if (!p) continue;
      p.group.visible = st.visible;
      p.group.position.set(st.x, st.y, st.z * GAP);
      p.group.rotation.z = st.rotation;
      p.group.scale.set(st.sx, st.sy, 1);
    }
  }

  dispose(): void {
    this.cut.onPaint = null;
    for (const p of this.pieces.values()) {
      p.body.geometry.dispose();
      for (const m of p.marks) m.geometry.dispose();
    }
    this.root.removeFromParent();
  }
}

/** 给纸偶换一种颜色以后，旧的材质还在缓存里，不用释放（同色共用）。 */
export type { MeshStandardMaterial };
