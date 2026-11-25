import { Color, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector2, type Material } from 'three';
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
  const brickCols = [0x55524e, 0x5f5b56, 0x6a655e, 0x4c4946, 0x736d65, 0x5a5652];
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
  // 一圈砖：r0–r1 之间，n 块，每块是一个梯形（中间留缝），正面在 zf。
  const ring = (r0: number, r1: number, n: number, z: number, depth: number, rot: number, gap = 0.006): void => {
    for (let i = 0; i < n; i++) {
      const a0 = rot + (i / n) * Math.PI * 2 + gap / r1;
      const a1 = rot + ((i + 1) / n) * Math.PI * 2 - gap / r1;
      const rr0 = r0 + gap * 0.6;
      const rr1 = r1 - gap * 0.6 - r() * 0.006;
      const pts: Vector2[] = [];
      const k = 3;
      for (let j = 0; j <= k; j++) pts.push(new Vector2(Math.cos(a0 + ((a1 - a0) * j) / k) * rr1, Math.sin(a0 + ((a1 - a0) * j) / k) * rr1));
      for (let j = k; j >= 0; j--) pts.push(new Vector2(Math.cos(a0 + ((a1 - a0) * j) / k) * rr0, Math.sin(a0 + ((a1 - a0) * j) / k) * rr0));
      const d = depth * (0.97 + r() * 0.06);
      const m = new Mesh(bev(pts, d, Math.min(0.006, (r1 - r0) * 0.1), [], 2), brick(brickCols[Math.floor(r() * brickCols.length)]!));
      m.position.z = z - d;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }
  };
  // 胎面：外圈一圈长砖，沿着轮宽方向排两排（从侧面看是一圈，从正面能看到胎面上的砖缝）。
  for (let row = 0; row < 3; row++) ring(R * 0.8, R, 24, -row * (W / 3), W / 3 - 0.004, row * (Math.PI / 24));
  // 胎侧：内圈一圈小一点的砖，比胎面略凹进去。
  ring(R * 0.65, R * 0.8, 20, -0.006, W * 0.5, 0.11);
  ring(R * 0.5, R * 0.65, 14, -0.012, W * 0.5, 0.3);
  // 胎体（砖后面的实心，防止看穿）。
  const core = new Mesh(new CylinderGeometry(R * 0.79, R * 0.79, W * 0.9, 24), paperMaterial(0x2e2c2a, { scale: 0.2 }));
  core.rotation.x = Math.PI / 2;
  core.position.z = -W / 2 - 0.03;
  g.add(core);

  // 轮辋：厚的米白八角板 + 一圈浅色八角框（倒角都接光）。
  const cream = [paperMaterial(0xbfa98a, { scale: 0.15 }), paperMaterial(0xd2c0a2, { scale: 0.15 })];
  const rimR = R * 0.5;
  const plate = new Mesh(bev(ngon(8, rimR, Math.PI / 8), 0.05, 0.018), cream);
  plate.position.z = -0.02;
  const frame = new Mesh(bev(ngon(8, rimR * 0.97, Math.PI / 8), 0.026, 0.009, [ngon(8, rimR * 0.74, Math.PI / 8).reverse()]), [paperMaterial(0xcfbb9e, { scale: 0.15 }), paperMaterial(0xe2d2b8, { scale: 0.15 })]);
  frame.position.z = 0.03;
  // 深褐的八角环。
  const brownRing = new Mesh(bev(ngon(8, rimR * 0.72, Math.PI / 8), 0.02, 0.006, [ngon(8, rimR * 0.5, Math.PI / 8).reverse()]), [paperMaterial(0x5e4c3c, { scale: 0.1 }), paperMaterial(0x6e5c4a, { scale: 0.1 })]);
  brownRing.position.z = 0.032;
  // 金色轮毂：八角的金卡纸块，上面一颗八芒星，正中一颗圆钉。
  const gold = new MeshStandardMaterial({ color: 0xe6b552, metalness: 0.6, roughness: 0.32, emissive: 0x3a2508 });
  const goldDark = new MeshStandardMaterial({ color: 0xa97a2c, metalness: 0.7, roughness: 0.45 });
  const hub = new Mesh(bev(ngon(8, rimR * 0.5, Math.PI / 8), 0.03, 0.008), [gold, goldDark]);
  hub.position.z = 0.03;
  const star: Vector2[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rr = i % 2 ? rimR * 0.16 : rimR * 0.42;
    star.push(new Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  const starM = new Mesh(bev(star, 0.016, 0.005), [gold, goldDark]);
  starM.position.z = 0.058;
  const dome = new Mesh(new SphereGeometry(rimR * 0.11, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  dome.rotation.x = Math.PI / 2;
  dome.position.z = 0.072;
  for (const m of [plate, frame, brownRing, hub, starM, dome]) {
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  return g;
}
