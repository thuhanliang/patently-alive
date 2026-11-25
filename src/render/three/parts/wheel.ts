import { Color, CylinderGeometry, ShapeUtils, Vector3, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector2, type Material } from 'three';
import { bev, ngon, rng } from '../craft';
import { paperMaterial } from '../paper';

/**
 * 车轮（2026-11-26 部件实验台第 1 件，照 art/incoming/lovart/010/5-details/6-overall.jpg 的轮子）：
 * - 轮胎：两圈深灰的"砖"——每块是一小块有倒角的厚纸板，颜色深浅不一，块与块之间留着暗缝；外圈一圈是胎面。
 * - 轮辋：一块厚的米白八角板（倒角接光），上面再叠一圈浅一点的八角框；
 * - 中间：一圈深褐的八角环，里面一颗八角的金色轮毂，轮毂上压一颗八芒星，正中一颗圆钉。
 * 轮子的正面朝 +z，中心在原点，外半径 R。
 */
export function buildWheel(R = 0.42, seed = 3): Group {
  const g = new Group();
  const r = rng(seed);
  const brickCols = [0x45413d, 0x4d4945, 0x55504a, 0x3e3b38, 0x5b554e, 0x494542];
  const brickMats = new Map<number, Material[]>();
  const brick = (c: number): Material[] => {
    let m = brickMats.get(c);
    if (!m) {
      const face = paperMaterial(c, { kind: 'card', scale: 0.1 });
      const side = paperMaterial(new Color(c).lerp(new Color(0x9a948a), 0.25).getHex(), { kind: 'card', scale: 0.1 });
      brickMats.set(c, (m = [face, side]));
    }
    return m;
  };
  const W = R * 0.62; // 轮胎宽
  const SH = R * 0.2; // 胎肩斜面往里收多少（轴向）
  /** 一块贴在曲面上的砖：四个角（顺序绕一圈）、朝外的法线、厚度。 */
  const tile = (c: Vector3[], n: Vector3, depth: number, col: number): void => {
    const ctr = c.reduce((a2, p) => a2.add(p), new Vector3()).multiplyScalar(0.25);
    const u = c[1]!.clone().sub(c[0]!).normalize();
    const v = new Vector3().crossVectors(n, u).normalize();
    const pts = c.map((p) => new Vector2(p.clone().sub(ctr).dot(u), p.clone().sub(ctr).dot(v)));
    if (ShapeUtils.isClockWise(pts)) pts.reverse();
    // col：0 浅、1 深（一圈深浅交替），再加一点点随机的浓淡。
    const base = col ? 0x3e3a37 : 0x56514b;
    const tint = new Color(base).multiplyScalar(0.94 + r() * 0.12).getHex();
    const mm = new Mesh(bev(pts, depth, Math.min(0.007, depth * 0.3), [], 2), brick(tint));
    mm.matrixAutoUpdate = false;
    mm.matrix.makeBasis(u, v, n).setPosition(ctr.clone().addScaledVector(n, -depth));
    mm.castShadow = mm.receiveShadow = true;
    g.add(mm);
  };
  const gap = 0.002;
  // 所有圈都用同一组 16 个角度（k·π/8），和八角轮辋的顶点（奇数 k）、边中点（偶数 k）对齐：
  // 内圈的内沿正好就是轮辋的八条边，一圈一圈之间是同一条折线，没有多出来的缝。
  const N = 16;
  // 量自效果图：白色八边形的高度（对边距 2·rimR·cos(π/8)）约占轮胎直径的 0.62。
  const rimR = R * 0.67;
  const oct = (k: number): number => (k % 2 ? rimR : rimR * Math.cos(Math.PI / 8));
  const ang = (k: number): number => (k * Math.PI) / 8;
  const P = (rr: number, a: number, z: number): Vector3 => new Vector3(Math.cos(a) * rr, Math.sin(a) * rr, z);
  // 沿着两角之间的弦往里缩一点（砖缝），返回 [起点, 终点] 的角度微调。
  const shrink = (k: number, rr: number): [number, number] => [ang(k) + gap / rr, ang(k + 1) - gap / rr];
  const rMid = R * 0.76;
  const rSide = R * 0.86;
  for (let k = 0; k < N; k++) {
    // 内圈：内沿贴着八角轮辋（不留缝），外沿在 rMid。
    const [a0, a1] = shrink(k, rMid);
    tile([P(oct(k) - 0.004, ang(k), 0), P(oct(k + 1) - 0.004, ang(k + 1), 0), P(rMid - gap, a1, 0), P(rMid - gap, a0, 0)], new Vector3(0, 0, 1), 0.04, k % 2);
    // 外圈：rMid 到 rSide。
    const [b0, b1] = shrink(k, rSide);
    tile([P(rMid + gap, b0, 0), P(rMid + gap, b1, 0), P(rSide, b1, 0), P(rSide, b0, 0)], new Vector3(0, 0, 1), 0.042, (k + 1) % 2);
  }
  // 胎肩：同样 16 块，贴在从 rSide（z = 0）到 R（z = −SH）的斜面上。
  for (let k = 0; k < N; k++) {
    const [a0, a1] = shrink(k, R);
    const am = (a0 + a1) / 2;
    const n = new Vector3(Math.cos(am) * SH, Math.sin(am) * SH, R - rSide).normalize();
    tile([P(rSide, a0, 0), P(rSide, a1, 0), P(R, a1, -SH), P(R, a0, -SH)], n, 0.035, k % 2);
  }
  // 胎面：同样 16 块，两排（前后两排对齐，中间一道缝）。
  for (let row = 0; row < 2; row++) {
    const z0 = -SH - gap - row * ((W - SH) / 2);
    const z1 = z0 - (W - SH) / 2 + gap;
    for (let k = 0; k < N; k++) {
      const [a0, a1] = shrink(k, R);
      const am = (a0 + a1) / 2;
      tile([P(R, a0, z0), P(R, a1, z0), P(R, a1, z1), P(R, a0, z1)], new Vector3(Math.cos(am), Math.sin(am), 0), 0.03, (k + row) % 2);
    }
  }
  // 胎体只在胎面后面（不能盖住胎肩的斜面）。
  const core = new Mesh(new CylinderGeometry(R * 0.93, R * 0.93, W - SH, 32), paperMaterial(0x2e2c2a, { scale: 0.2 }));
  core.rotation.x = Math.PI / 2;
  core.position.z = -SH - (W - SH) / 2;
  // 胎肩斜面后面也垫一个锥，免得从缝里看穿。
  const cone = new Mesh(new CylinderGeometry(rSide * 0.98, R * 0.94, SH, 32, 1, true), paperMaterial(0x2e2c2a, { scale: 0.2 }));
  cone.rotation.x = -Math.PI / 2;
  cone.position.z = -SH / 2;
  g.add(cone);
  g.add(core);
  const back = new Mesh(new CylinderGeometry(rSide, rSide, 0.02, 32), paperMaterial(0x2e2c2a, { scale: 0.2 }));
  back.rotation.x = Math.PI / 2;
  back.position.z = -0.045;
  g.add(back);

  // 轮辋：厚的米白八角板 + 一圈浅色八角框（倒角都接光）。
  const cream = [paperMaterial(0xc4ae98, { scale: 0.15 }), paperMaterial(0xd6c4b0, { scale: 0.15 })];
  const plate = new Mesh(bev(ngon(8, rimR, Math.PI / 8), 0.05, 0.018, [ngon(8, rimR * 0.7, Math.PI / 8).reverse()]), cream);
  // 轮辋只比胎侧高一点点（效果图里几乎是平的）。
  plate.position.z = -0.04;
  const frame = new Mesh(bev(ngon(8, rimR * 0.97, Math.PI / 8), 0.026, 0.009, [ngon(8, rimR * 0.74, Math.PI / 8).reverse()]), [paperMaterial(0xd3c0aa, { scale: 0.15 }), paperMaterial(0xe4d6c4, { scale: 0.15 })]);
  frame.position.z = -0.012;
  // 深褐的八角环。
  const brownRing = new Mesh(bev(ngon(8, rimR * 0.72, Math.PI / 8), 0.02, 0.006, [ngon(8, rimR * 0.5, Math.PI / 8).reverse()]), [paperMaterial(0x5e4c3c, { scale: 0.1 }), paperMaterial(0x6e5c4a, { scale: 0.1 })]);
  brownRing.position.z = -0.006;
  // 金色轮毂：八角的金卡纸块，上面一颗八芒星，正中一颗圆钉。
  const gold = new MeshStandardMaterial({ color: 0xe6b552, metalness: 0.6, roughness: 0.32, emissive: 0x3a2508 });
  const goldDark = new MeshStandardMaterial({ color: 0xa97a2c, metalness: 0.7, roughness: 0.45 });
  const hub = new Mesh(bev(ngon(8, rimR * 0.72, Math.PI / 8), 0.02, 0.004), [paperMaterial(0x3a2a1e, { scale: 0.1 }), paperMaterial(0x4a3626, { scale: 0.1 })]);
  hub.position.z = -0.024; // 前面在 -0.004：比瓣、段都低，不共面
  // 轮毂（照效果图放大看）：一块金色八角，被 8 道暗缝分成 8 瓣（每瓣一块倒角的金卡纸），
  // 中间一颗小八角凸台；外面那圈深色环也分成 8 段。
  const wedge = (r0: number, r1: number, k: number, sep: number): Vector2[] => {
    const a0 = Math.PI / 8 + (k / 8) * Math.PI * 2;
    const a1 = a0 + Math.PI / 4;
    const am = (a0 + a1) / 2;
    const off = new Vector2(Math.cos(am), Math.sin(am)).multiplyScalar(sep);
    return [new Vector2(Math.cos(a0) * r0, Math.sin(a0) * r0).add(off), new Vector2(Math.cos(a0) * r1, Math.sin(a0) * r1).add(off), new Vector2(Math.cos(a1) * r1, Math.sin(a1) * r1).add(off), new Vector2(Math.cos(a1) * r0, Math.sin(a1) * r0).add(off)];
  };
  const petals = new Group();
  for (let k = 0; k < 8; k++) {
    const pm = new Mesh(bev(wedge(rimR * 0.09, rimR * 0.42, k, 0.004), 0.014, 0.005), [gold, goldDark]);
    pm.position.z = 0.002;
    petals.add(pm);
    const seg = new Mesh(bev(wedge(rimR * 0.46, rimR * 0.69, k, 0.003), 0.014, 0.004), [paperMaterial(0x5a4634, { scale: 0.1 }), paperMaterial(0x6a5440, { scale: 0.1 })]);
    seg.position.z = -0.006;
    petals.add(seg);
  }
  petals.position.z = 0.0;
  const boss = new Mesh(bev(ngon(8, rimR * 0.1, Math.PI / 8), 0.02, 0.006), [gold, goldDark]);
  boss.position.z = 0.008;
  const dome = new Mesh(new SphereGeometry(rimR * 0.05, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), goldDark);
  dome.rotation.x = Math.PI / 2;
  dome.position.z = 0.028;
  g.add(boss, petals);
  brownRing.visible = false;
  for (const m of [plate, frame, brownRing, hub, dome]) {
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
