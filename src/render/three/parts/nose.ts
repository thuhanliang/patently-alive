import { CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, SRGBColorSpace, Vector2, Vector3, type Material } from 'three';
import { bev, ngon, rng } from '../craft';
import { paperMaterial } from '../paper';

/**
 * 车鼻子正面（2026-11-26 部件实验台第 2 件，照 6-overall.jpg 的车头）：
 * 米白的厚纸板面板（倒角接光），金卡纸包边；两只大灯（三层八角金框、一圈深色内框、放射状的暖黄灯玻璃、
 * 上面一片折出来的金色小雨檐）；中间一扇竖条格栅；格栅下一个方鼻头（带金搭扣）；每只灯下三根铜胡须。
 * 正面朝 +z，原点在面板正中的地面高度上（y 是离地高度），宽约 1.9 米。
 */

// 金卡纸：效果图里的金是亮的黄金色（受光面接近 #e7b86d），金属感不强——是印了金的卡纸，不是镜面铜。
export const gold = new MeshStandardMaterial({ color: 0xf0bb55, metalness: 0.3, roughness: 0.42, emissive: 0x4a2e08 });
export const goldDark = new MeshStandardMaterial({ color: 0xc08c3c, metalness: 0.3, roughness: 0.5, emissive: 0x2a1a06 });

function m(g: ReturnType<typeof bev>, mats: Material | Material[], z = 0): Mesh {
  const x = new Mesh(g, mats);
  x.position.z = z;
  x.castShadow = x.receiveShadow = true;
  return x;
}
const rect = (x0: number, y0: number, x1: number, y1: number): Vector2[] => [new Vector2(x0, y0), new Vector2(x1, y0), new Vector2(x1, y1), new Vector2(x0, y1)];

let glassTex: CanvasTexture | null = null;
function lampGlass(): MeshStandardMaterial {
  glassTex ??= (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
    gr.addColorStop(0, '#fff2b0');
    gr.addColorStop(0.5, '#f6d16a');
    gr.addColorStop(1, '#b7832f');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(150,100,40,0.55)';
    g.lineWidth = 3;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      g.beginPath();
      g.moveTo(128, 128);
      g.lineTo(128 + Math.cos(a) * 130, 128 + Math.sin(a) * 130);
      g.stroke();
    }
    g.beginPath();
    g.arc(128, 128, 46, 0, Math.PI * 2);
    g.stroke();
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  return new MeshStandardMaterial({ map: glassTex, emissiveMap: glassTex, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.3 });
}

/** 一只大灯：中心在原点，灯筒从面板往外伸 depth，正面朝 +z，外接圆半径 R。 */
export function headlamp(R = 0.22, depth = 0.16): Group {
  const g = new Group();
  const o = (r: number): Vector2[] => ngon(8, r, Math.PI / 8);
  const bronze = [paperMaterial(0x6e5046, { scale: 0.1 }), paperMaterial(0x82604f, { scale: 0.1 })];
  // 灯筒：一个八角的金色筒（侧面看得见），前面一圈厚金框，再往里一圈深铜色的内框，灯玻璃凹在最里面。
  g.add(m(bev(o(R * 0.96), depth - 0.03, 0.01, [o(R * 0.7).reverse()]), [goldDark, gold], 0));
  g.add(m(bev(o(R), 0.045, 0.014, [o(R * 0.8).reverse()]), [gold, goldDark], depth - 0.045));
  // 深色内框：宽的一圈（效果图里玻璃只占灯的一半多一点）。
  g.add(m(bev(o(R * 0.82), 0.03, 0.006, [o(R * 0.56).reverse()]), bronze, depth - 0.05));
  const glass = new Mesh(bev(o(R * 0.6), 0.01, 0.002), [lampGlass(), goldDark]);
  const uv = glass.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (R * 1.2) + 0.5, uv.getY(i) / (R * 1.2) + 0.5);
  glass.position.z = depth - 0.07;
  g.add(glass);
  for (let k = 0; k < 8; k += 2) {
    const a = Math.PI / 8 + ((k + 0.5) / 8) * Math.PI * 2;
    const r = new Mesh(new SphereGeometry(0.013, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    r.rotation.x = Math.PI / 2;
    r.position.set(Math.cos(a) * R * 0.87, Math.sin(a) * R * 0.87, depth);
    g.add(r);
  }
  // 雨檐：一片金卡纸折成 /‾‾\ 的帽檐（顶面平、两边斜下），从灯筒上沿往前探 D，前沿略往下低。
  const W = R * 1.45;
  const w = R * 0.85;
  const h = R * 0.34;
  const t = 0.014;
  const D = depth + R * 0.08;
  const sec = [
    new Vector2(-W / 2, -h), new Vector2(-w / 2, 0), new Vector2(w / 2, 0), new Vector2(W / 2, -h),
    new Vector2(W / 2 - t * 1.4, -h), new Vector2(w / 2 - t * 0.4, -t), new Vector2(-w / 2 + t * 0.4, -t), new Vector2(-W / 2 + t * 1.4, -h),
  ];
  const visor = new Group();
  visor.position.set(0, R * 1.12, 0);
  visor.rotation.x = 0.06;
  visor.add(m(bev(sec, D, 0.004), [gold, goldDark]));
  g.add(visor);
  return g;
}

/** 一根铜胡须：从 a 到 b 的圆杆，两头各一颗铜珠。 */
function whisker(g: Group, a: Vector3, b: Vector3): void {
  const len = a.distanceTo(b);
  const rod = new Mesh(new CylinderGeometry(0.015, 0.015, len, 12), gold);
  rod.position.copy(a).add(b).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  rod.castShadow = true;
  g.add(rod);
  for (const [p, rr] of [
    [a, 0.026],
    [b, 0.03],
  ] as const) {
    const ball = new Mesh(new SphereGeometry(rr, 12, 8), gold);
    ball.position.copy(p);
    ball.castShadow = true;
    g.add(ball);
  }
}

/** 车鼻子正面：宽 W，面板正面在 z = 0.05。 */
export function buildNose(seed = 5): Group {
  const g = new Group();
  const r = rng(seed);
  // 比例（docs/research/craft.md 的比例表，以大灯八角的高 H = 0.4 为单位）。
  const W = 1.76;
  const y0 = 0.56;
  const y1 = 1.58;
  const F = 0.06;
  const cream = (c = 0xe0c9a2): Material[] => [paperMaterial(c, { scale: 0.25 }), paperMaterial(0xe8d2ab, { scale: 0.25 })];
  // 面板：几块厚纸板拼成，接缝留缝，倒角接光。
  const panels: Array<[number, number, number, number, number]> = [
    [-W / 2, y0, -0.35, y1 - 0.1, 0xe6c79c],
    [-0.34, y0, 0.34, y1 - 0.1, 0xeed3ab],
    [0.35, y0, W / 2, y1 - 0.1, 0xe2c399],
    [-W / 2, y1 - 0.08, W / 2, y1, 0xf0d8b2],
  ];
  const gx = 0.27; // 格栅宽 ≈ 1.35 H
  const gy0 = 0.99;
  const gy1 = 1.42; // 高 ≈ 1.1 H，中心比大灯高 ≈ 0.25 H
  panels.forEach(([a, b, c, d, col], i) => {
    if (i !== 1) {
      g.add(m(bev(rect(a + 0.004, b, c - 0.004, d), F, 0.018), cream(col), 0));
      return;
    }
    // 中间那块：格栅的位置空着（拼成格栅四周的几块）。
    for (const [p0, q0, p1, q1] of [
      [a, b, c, gy0],
      [a, gy1, c, d],
      [a, gy0, -gx, gy1],
      [gx, gy0, c, gy1],
    ] as const)
      g.add(m(bev(rect(p0 + 0.004, q0, p1 - 0.004, q1), F, 0.012), cream(col), 0));
  });
  for (let i = 0; i < 6; i++) {
    const x = (r() < 0.5 ? -1 : 1) * (0.25 + r() * 0.38);
    const y = y0 + 0.04 + r() * 0.55;
    const p = m(bev(rect(-0.06 - r() * 0.07, -0.04 - r() * 0.05, 0.06 + r() * 0.07, 0.04 + r() * 0.05), 0.008, 0.002), cream([0xd9bb92, 0xf2dcba, 0xcfc2ad][i % 3]));
    p.position.set(x, y, F - 0.002);
    p.rotation.z = (r() - 0.5) * 0.12;
    g.add(p);
  }
  const bar = (x0: number, yA: number, x1: number, yB: number, w = 0.05): void => {
    g.add(m(bev(rect(Math.min(x0, x1) - (x0 === x1 ? w / 2 : 0), Math.min(yA, yB) - (yA === yB ? w / 2 : 0), Math.max(x0, x1) + (x0 === x1 ? w / 2 : 0), Math.max(yA, yB) + (yA === yB ? w / 2 : 0)), 0.03, 0.01), [gold, goldDark], F - 0.004));
  };
  bar(-W / 2, y1 - 0.09, W / 2, y1 - 0.09);
  bar(-W / 2, y0 + 0.025, W / 2, y0 + 0.025);
  bar(-W / 2 + 0.025, y0, -W / 2 + 0.025, y1);
  bar(W / 2 - 0.025, y0, W / 2 - 0.025, y1);
  // 格栅：深凹下去（后板退到 z = -0.06），厚金框，七根粗金条。
  g.add(m(bev(rect(-gx, gy0, gx, gy1), 0.01, 0.002), [paperMaterial(0x1c140e, { scale: 0.2 }), paperMaterial(0x1c140e, { scale: 0.2 })], -0.03));
  // 边框是一圈米色厚纸板（不是金的），内沿一条细金边，四角各一颗金铆钉。
  g.add(m(bev(rect(-gx - 0.06, gy0 - 0.06, gx + 0.06, gy1 + 0.06), 0.05, 0.016, [rect(-gx, gy0, gx, gy1).reverse()]), cream(0xf2dcb6), F));
  g.add(m(bev(rect(-gx - 0.012, gy0 - 0.012, gx + 0.012, gy1 + 0.012), 0.1, 0.004, [rect(-gx, gy0, gx, gy1).reverse()]), [gold, goldDark], -0.04));
  for (const [x, y] of [[-gx - 0.03, gy1 + 0.03], [gx + 0.03, gy1 + 0.03], [-gx - 0.03, gy0 - 0.03], [gx + 0.03, gy0 - 0.03]] as const) {
    const rv = new Mesh(new SphereGeometry(0.018, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    rv.rotation.x = Math.PI / 2;
    rv.position.set(x, y, F + 0.05);
    g.add(rv);
  }
  for (let i = 0; i < 8; i++) {
    const x = -gx + ((i + 0.5) / 8) * 2 * gx;
    // 扁金条（薄，不挡后面的黑缝）。
    g.add(m(bev(rect(x - 0.013, gy0, x + 0.013, gy1), 0.018, 0.005), [gold, goldDark], F - 0.03));
  }
  // 方鼻头：一个厚纸板盒子凸出 0.3，倒角大；正面一个大金搭扣。
  // 方鼻头：宽 ≈ 格栅宽，高 ≈ 0.8 H，伸出 ≈ 0.7 H。
  g.add(m(bev(rect(-0.25, 0.73, 0.25, 1.05), 0.2, 0.03), cream(0xe7c79c), F - 0.02));
  // 搭扣：一块厚金块，左边贴一片小金合页。
  g.add(m(bev(rect(-0.07, 0.8, 0.05, 0.95), 0.05, 0.012), [gold, goldDark], F + 0.17));
  g.add(m(bev(rect(-0.11, 0.82, -0.065, 0.91), 0.035, 0.008), [gold, goldDark], F + 0.17));
  // 大灯、胡须。
  for (const s of [-1, 1]) {
    // 大灯：八角高 H = 0.4（外接圆半径 0.4 / (2 cos π/8)），离格栅 ≈ 0.15 H。
    const lamp = headlamp(0.216, 0.16);
    lamp.position.set(s * 0.58, 1.11, F);
    g.add(lamp);
    for (let k = 0; k < 3; k++) {
      // 胡须：长 ≈ H，从方鼻头两侧往外。
      const y = 0.68 + k * 0.105;
      whisker(g, new Vector3(s * 0.28, y, F + 0.06), new Vector3(s * (0.92 + k * 0.02), y + 0.01 - k * 0.01, F + 0.12));
    }
  }
  return g;
}
