import { CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, SRGBColorSpace, Vector2, Vector3, type Material } from 'three';
import { bev, ngon, rng } from '../craft';
import { paperMaterial } from '../paper';

/**
 * 车鼻子正面（2026-11-26 部件实验台第 2 件，照 6-overall.jpg 的车头）：
 * 米白的厚纸板面板（倒角接光），金卡纸包边；两只大灯（三层八角金框、一圈深色内框、放射状的暖黄灯玻璃、
 * 上面一片折出来的金色小雨檐）；中间一扇竖条格栅；格栅下一个方鼻头（带金搭扣）；每只灯下三根铜胡须。
 * 正面朝 +z，原点在面板正中的地面高度上（y 是离地高度），宽约 1.9 米。
 */

export const gold = new MeshStandardMaterial({ color: 0xebb44c, metalness: 0.55, roughness: 0.32, emissive: 0x3a2204 });
export const goldDark = new MeshStandardMaterial({ color: 0xb68636, metalness: 0.55, roughness: 0.42, emissive: 0x1c1004 });

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
    gr.addColorStop(0, '#ffe9a6');
    gr.addColorStop(0.5, '#efc463');
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
  return new MeshStandardMaterial({ map: glassTex, emissiveMap: glassTex, emissive: 0xffffff, emissiveIntensity: 0.32, roughness: 0.3 });
}

/** 一只大灯：中心在原点，灯筒从面板往外伸 depth，正面朝 +z，外接圆半径 R。 */
export function headlamp(R = 0.22, depth = 0.16): Group {
  const g = new Group();
  const o = (r: number): Vector2[] => ngon(8, r, Math.PI / 8);
  const bronze = [paperMaterial(0x7a5a34, { scale: 0.1 }), paperMaterial(0x8a6a40, { scale: 0.1 })];
  // 灯筒：一个八角的金色筒（侧面看得见），前面一圈厚金框，再往里一圈深铜色的内框，灯玻璃凹在最里面。
  g.add(m(bev(o(R * 0.96), depth - 0.03, 0.01, [o(R * 0.7).reverse()]), [goldDark, gold], 0));
  g.add(m(bev(o(R), 0.045, 0.014, [o(R * 0.74).reverse()]), [gold, goldDark], depth - 0.045));
  g.add(m(bev(o(R * 0.76), 0.03, 0.006, [o(R * 0.62).reverse()]), bronze, depth - 0.05));
  const glass = new Mesh(bev(o(R * 0.66), 0.01, 0.002), [lampGlass(), goldDark]);
  const uv = glass.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (R * 1.32) + 0.5, uv.getY(i) / (R * 1.32) + 0.5);
  glass.position.z = depth - 0.07;
  g.add(glass);
  for (let k = 0; k < 8; k += 2) {
    const a = Math.PI / 8 + ((k + 0.5) / 8) * Math.PI * 2;
    const r = new Mesh(new SphereGeometry(0.013, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    r.rotation.x = Math.PI / 2;
    r.position.set(Math.cos(a) * R * 0.87, Math.sin(a) * R * 0.87, depth);
    g.add(r);
  }
  // 雨檐：一片金卡纸折成的帽檐，从灯筒上沿往前探、往下斜；两侧各一片三角侧翼，后面一条折边贴在面板上。
  const W = R * 1.5;
  const D = depth * 0.55 + R * 0.35;
  const visor = new Group();
  visor.position.set(0, R * 0.95, depth * 0.45);
  const top = m(bev(rect(-W / 2, 0, W / 2, D), 0.016, 0.005), [gold, goldDark]);
  top.rotation.x = Math.PI / 2 + 0.35;
  visor.add(top);
  for (const s of [-1, 1]) {
    const tri = [new Vector2(0, 0), new Vector2(D * 0.94, -Math.sin(0.35) * D), new Vector2(0, -0.1)];
    const side = m(bev(tri, 0.012, 0.003), [goldDark, gold]);
    side.rotation.y = -Math.PI / 2;
    side.position.x = s * (W / 2 - 0.006);
    visor.add(side);
  }
  g.add(visor);
  return g;
}

/** 一根铜胡须：从 a 到 b 的圆杆，两头各一颗铜珠。 */
function whisker(g: Group, a: Vector3, b: Vector3): void {
  const len = a.distanceTo(b);
  const rod = new Mesh(new CylinderGeometry(0.011, 0.011, len, 10), gold);
  rod.position.copy(a).add(b).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  rod.castShadow = true;
  g.add(rod);
  for (const [p, rr] of [
    [a, 0.02],
    [b, 0.024],
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
  const W = 1.4;
  const y0 = 0.56;
  const y1 = 1.42;
  const F = 0.06;
  const cream = (c = 0xe0c9a2): Material[] => [paperMaterial(c, { scale: 0.25 }), paperMaterial(0xe8d2ab, { scale: 0.25 })];
  // 面板：几块厚纸板拼成，接缝留缝，倒角接光。
  const panels: Array<[number, number, number, number, number]> = [
    [-W / 2, y0, -0.21, y1 - 0.1, 0xcdb084],
    [-0.2, y0, 0.2, y1 - 0.1, 0xd6bd92],
    [0.21, y0, W / 2, y1 - 0.1, 0xc9ab7f],
    [-W / 2, y1 - 0.08, W / 2, y1, 0xd9c19a],
  ];
  const gx = 0.17;
  const gy0 = 0.94;
  const gy1 = 1.28;
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
    const p = m(bev(rect(-0.06 - r() * 0.07, -0.04 - r() * 0.05, 0.06 + r() * 0.07, 0.04 + r() * 0.05), 0.008, 0.002), cream([0xc4a87c, 0xe1cda8, 0xbb9d72][i % 3]));
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
  g.add(m(bev(rect(-gx, gy0, gx, gy1), 0.01, 0.002), [paperMaterial(0x2a1f17, { scale: 0.2 }), paperMaterial(0x2a1f17, { scale: 0.2 })], -0.06));
  g.add(m(bev(rect(-gx - 0.05, gy0 - 0.05, gx + 0.05, gy1 + 0.05), 0.07, 0.014, [rect(-gx, gy0, gx, gy1).reverse()]), [gold, goldDark], F - 0.03));
  for (let i = 0; i < 7; i++) {
    const x = -gx + ((i + 0.5) / 7) * 2 * gx;
    g.add(m(bev(rect(x - 0.014, gy0, x + 0.014, gy1), 0.08, 0.008), [gold, goldDark], -0.04));
  }
  // 方鼻头：一个厚纸板盒子凸出 0.3，倒角大；正面一个大金搭扣。
  g.add(m(bev(rect(-0.2, 0.6, 0.2, 0.9), 0.26, 0.03), cream(0xceb489), F - 0.02));
  g.add(m(bev(rect(-0.06, 0.68, 0.06, 0.82), 0.045, 0.012), [gold, goldDark], F + 0.23));
  g.add(m(bev(rect(-0.035, 0.66, 0.035, 0.7), 0.03, 0.006), [gold, goldDark], F + 0.23));
  // 大灯、胡须。
  for (const s of [-1, 1]) {
    const lamp = headlamp(0.19, 0.15);
    lamp.position.set(s * 0.43, 1.1, F);
    g.add(lamp);
    for (let k = 0; k < 3; k++) {
      const y = 0.64 + k * 0.08;
      whisker(g, new Vector3(s * 0.25, y, F + 0.03), new Vector3(s * (0.66 + k * 0.02), y + 0.02 - k * 0.015, F + 0.15));
    }
  }
  return g;
}
