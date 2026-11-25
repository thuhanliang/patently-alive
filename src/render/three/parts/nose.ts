import { CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, SRGBColorSpace, Vector2, Vector3, type BufferGeometry, type Material } from 'three';
import { bev, rng } from '../craft';
import { paperMaterial } from '../paper';

/**
 * 车鼻子正面（2026-11-26 部件实验台第 2 件，照 6-overall.jpg 的车头）。
 * 比例：在效果图上量 14 个点，和镜头一起最小二乘拟合（平均误差约 3 像素），以灯玻璃高 0.25 定尺度：
 * - 面板宽 1.18、高 0.89；两只灯中心在 ±0.467、高 1.124，灯的外框略探出面板边，胡须也伸到面板外；
 * - 大灯是瘦高的八角：外框 0.28 × 0.40，玻璃 0.15 × 0.25；灯筒浅（伸出 0.11）；金框、深色内框都是斜面，玻璃几乎齐平；
 * - 雨檐：一片平的金帽檐（宽 0.23 ≈ 0.8 灯宽），在灯顶上方约 4 厘米，后沿折下来钉在面板上，伸出灯面约 0.08，前沿略低、一道小折边；
 * - 格栅：开口 0.40 宽，顶在 1.356（比灯顶略高）；边框是很窄（2.7 厘米）的一圈切角米色边，几乎和面板齐平；八根圆金棍；
 * - 方鼻头：棱台，背面 0.34 × 0.29，正面 0.30 × 0.25，伸出 0.235；背后一圈底板；
 * - 胡须：每侧三根，从 x = ±0.3 伸到 ±0.64，外端间距 0.12（往外略张开）；
 * - 面板是一块块瓷砖样的卡纸拼成（米色、浅灰绿深浅不一），四周是圆润的包边，转角处有金色包角。
 * 正面朝 +z，原点在面板正中的地面高度上（y 是离地高度）。
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

/** 瘦高的八角（上下、左右的平边各占一半）。 */
function oct(hw: number, hh: number): Vector2[] {
  return chamfered(-hw, -hh, hw, hh, hw / 2, hh / 2);
}

/**
 * 一只大灯：中心在原点，正面朝 +z，外框半宽 hw、半高 hh（瘦高的八角），灯筒从面板伸出 depth（浅）。
 * 效果图量的：外框 0.28 × 0.40，玻璃 0.15 × 0.25；金框和深色内框都是斜面，玻璃几乎齐平。
 */
export function headlamp(hw = 0.14, hh = 0.2, depth = 0.11): Group {
  const g = new Group();
  const mauve = [paperMaterial(0x7c6158, { scale: 0.1 }), paperMaterial(0x6a5048, { scale: 0.1 })];
  const k = (f: number): Vector2[] => oct(hw * f, hh * f);
  const gi = (hw - 0.04) / hw; // 金框内沿（金框宽 4 厘米）
  const giy = (hh - 0.042) / hh;
  // 灯筒：八角金筒，背光的侧面。
  g.add(m(bev(k(0.97), depth - 0.02, 0.005, [oct(hw * gi, hh * giy).reverse()]), [goldDark, goldDark], 0));
  // 正面金框：斜面（像画框），从外沿往里斜下去。
  g.add(m(bev(k(1), 0.03, 0.02, [oct(hw * gi, hh * giy).reverse()]), [gold, goldDark], depth - 0.026));
  // 深色内框：斜面，退后一点。
  g.add(m(bev(oct(hw * gi + 0.004, hh * giy + 0.004), 0.02, 0.012, [oct(0.075, 0.125).reverse()]), mauve, depth - 0.032));
  // 灯玻璃：几乎齐平。
  const glass = new Mesh(bev(oct(0.077, 0.127), 0.008, 0.002), [lampGlass(), goldDark]);
  const uv = glass.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.154 + 0.5, uv.getY(i) / 0.254 + 0.5);
  glass.position.z = depth - 0.028;
  g.add(glass);
  // 灯左侧两颗金铰钉（灯像一扇小门）。
  for (const y of [0.1, -0.1]) {
    const kn = new Mesh(new SphereGeometry(0.018, 12, 8), gold);
    kn.position.set(-hw - 0.004, y, depth * 0.55);
    g.add(kn);
  }
  // 雨檐：一片平的金帽檐，搭在灯筒顶上往前伸出灯面约 0.1，前沿略低、往下折一道小边。
  // （效果图里雨檐右边那块棕色的斜面不是雨檐，是八角灯筒右上的斜侧面，背光所以发棕。）
  const t = 0.012;
  const D = depth + 0.08;
  const visor = new Group();
  visor.position.set(0, hh + 0.045, 0);
  visor.rotation.x = 0.07;
  const brim = m(bev(rect(-0.115, -D, 0.115, 0), t, 0.004), [gold, goldDark]);
  brim.rotation.x = -Math.PI / 2;
  const lip = m(bev(rect(-0.115, -0.028, 0.115, t), t, 0.003), [gold, goldDark], D - t);
  // 后沿一条竖的折边贴在面板上（帽檐是钉在车头上的，不是浮着的）。
  const back = m(bev(rect(-0.115, -0.07, 0.115, 0), t, 0.003), [gold, goldDark], 0);
  visor.add(brim, lip, back);
  g.add(visor);
  // 金框右上、左上的斜角上各一片带铆钉的小金片。
  for (const s of [-1, 1]) {
    const tab = m(bev(rect(-0.02, -0.016, 0.02, 0.016), 0.01, 0.003), [gold, goldDark], depth);
    tab.position.x = s * hw * 0.82;
    tab.position.y = hh * 0.68;
    tab.rotation.z = s * -0.9;
    g.add(tab);
    const rv = new Mesh(new SphereGeometry(0.007, 8, 6), goldDark);
    rv.position.set(s * hw * 0.82, hh * 0.68, depth + 0.012);
    g.add(rv);
  }
  return g;
}

/** 一根铜胡须：从 a 到 b 的圆杆，两头各一颗铜珠。 */
function whisker(g: Group, a: Vector3, b: Vector3): void {
  const len = a.distanceTo(b);
  const rod = new Mesh(new CylinderGeometry(0.014, 0.014, len, 12), gold);
  rod.position.copy(a).add(b).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
  rod.castShadow = true;
  g.add(rod);
  for (const [p, rr] of [
    [a, 0.024],
    [b, 0.03],
  ] as const) {
    const ball = new Mesh(new SphereGeometry(rr, 12, 8), gold);
    ball.position.copy(p);
    ball.castShadow = true;
    g.add(ball);
  }
}

/** 倒角的盒子往前收成棱台：z = 0 处是原尺寸，z = depth 处横向按 kx、竖向按 ky 缩（绕中心）。 */
function frustum(x0: number, y0: number, x1: number, y1: number, depth: number, bevel: number, kx: number, ky: number): BufferGeometry {
  const geo = bev(rect(x0, y0, x1, y1), depth, bevel);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) / depth;
    p.setXY(i, cx + (p.getX(i) - cx) * (1 + (kx - 1) * z), cy + (p.getY(i) - cy) * (1 + (ky - 1) * z));
  }
  geo.computeVertexNormals();
  return geo;
}

/** 切角的矩形（八角形的矩形版）：横向切 cx，竖向切 cy。 */
function chamfered(x0: number, y0: number, x1: number, y1: number, cx: number, cy = cx): Vector2[] {
  return [
    new Vector2(x0 + cx, y0), new Vector2(x1 - cx, y0), new Vector2(x1, y0 + cy), new Vector2(x1, y1 - cy),
    new Vector2(x1 - cx, y1), new Vector2(x0 + cx, y1), new Vector2(x0, y1 - cy), new Vector2(x0, y0 + cy),
  ];
}

/** 车鼻子正面：面板正面在 z = F。尺寸见文件开头（从效果图上量点、和镜头一起拟合出来的）。 */
export function buildNose(seed = 5): Group {
  const g = new Group();
  const r = rng(seed);
  const W = 1.18;
  const y0 = 0.52;
  const y1 = 1.41;
  const F = 0.05;
  // 正面一个颜色，侧面（纸板的厚度、倒角）同色略深——侧面不能比正面亮。
  const shade = (c: number, k: number): number => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);
  const cream = (c = 0xead2ae): Material[] => [paperMaterial(c, { scale: 0.25 }), paperMaterial(shade(c, 0.94), { scale: 0.25 })];
  const gx = 0.2;
  const gy0 = 0.9;
  const gy1 = 1.356;
  // 底板：一整块厚纸板，格栅处开口（拼成四块）。
  for (const [a, b, c, d] of [
    [-W / 2, y0, W / 2, gy0],
    [-W / 2, gy1, W / 2, y1],
    [-W / 2, gy0, -gx, gy1],
    [gx, gy0, W / 2, gy1],
  ] as const)
    g.add(m(bev(rect(a, b, c, d), F - 0.012, 0.004), cream(0xe2c9a4), 0));
  // 面上一块块瓷砖样的卡纸（接缝留缝），深浅不一；格栅开口处不贴。
  const tones = [0xe9cba2, 0xe0bd92, 0xefd6b2, 0xd8d0b8, 0xc9cab2, 0xdcbb8e];
  const rows = [y0 + 0.03, 0.74, 0.96, 1.18, y1 - 0.03];
  for (let ri = 0; ri < rows.length - 1; ri++) {
    let x = -W / 2 + 0.03;
    while (x < W / 2 - 0.04) {
      const w = Math.min(0.16 + r() * 0.22, W / 2 - 0.03 - x);
      const a = x + 0.005;
      const c = x + w - 0.005;
      const b = rows[ri]! + 0.005;
      const d = rows[ri + 1]! - 0.005;
      x += w;
      if (c > -gx - 0.03 && a < gx + 0.03 && d > gy0 - 0.03 && b < gy1 + 0.03) continue;
      g.add(m(bev(rect(a, b, c, d), 0.012, 0.004), cream(tones[Math.floor(r() * tones.length)]!), F - 0.012));
    }
  }
  // 包边：四周一圈圆润的米色卷边（倒角大，比面板略凸），四角各一片金包角加铆钉；左右两条竖的金包边条。
  const wrap = 0.04;
  const edge = (a: number, b: number, c: number, d: number): void => {
    g.add(m(bev(rect(a, b, c, d), F + 0.02, 0.018), cream(0xf3e2c4), -0.005));
  };
  edge(-W / 2 - 0.01, y0 - 0.01, W / 2 + 0.01, y0 + wrap);
  edge(-W / 2 - 0.01, y1 - wrap, W / 2 + 0.01, y1 + 0.01);
  edge(-W / 2 - 0.01, y0 + wrap - 0.01, -W / 2 + wrap, y1 - wrap + 0.01);
  edge(W / 2 - wrap, y0 + wrap - 0.01, W / 2 + 0.01, y1 - wrap + 0.01);
  for (const sx of [-1, 1]) {
    g.add(m(bev(rect(sx * W / 2 - 0.011, y0 + 0.05, sx * W / 2 + 0.011, y1 - 0.05), F + 0.028, 0.005), [gold, goldDark], -0.01));
    for (const yy of [y0 + 0.03, y1 - 0.03]) {
      const cap = m(bev(rect(-0.042, -0.042, 0.042, 0.042), 0.012, 0.004), [gold, goldDark]);
      cap.position.set(sx * (W / 2 - 0.03), yy, F + 0.012);
      g.add(cap);
      const rv = new Mesh(new SphereGeometry(0.013, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold);
      rv.rotation.x = Math.PI / 2;
      rv.position.set(cap.position.x, yy, F + 0.024);
      g.add(rv);
    }
  }
  // 格栅：后面一块深色板，八根圆金棍，外面一圈很窄（2.7 厘米）的切角米色边框，几乎齐平；上两角外各一颗金铆钉。
  g.add(m(bev(rect(-gx, gy0, gx, gy1), 0.01, 0.002), [paperMaterial(0x1e150f, { scale: 0.2 }), paperMaterial(0x1e150f, { scale: 0.2 })], -0.01));
  for (let i = 0; i < 8; i++) {
    const x = -gx + ((i + 0.5) / 8) * 2 * gx;
    const rod = new Mesh(new CylinderGeometry(0.015, 0.015, gy1 - gy0, 12), gold);
    rod.position.set(x, (gy0 + gy1) / 2, F - 0.025);
    rod.castShadow = rod.receiveShadow = true;
    g.add(rod);
  }
  g.add(m(bev(chamfered(-gx - 0.027, gy0 - 0.027, gx + 0.027, gy1 + 0.027, 0.03), F + 0.01, 0.006, [rect(-gx, gy0, gx, gy1).reverse()]), cream(0xf1dfc2), 0));
  for (const sx of [-1, 1]) {
    const rv = new Mesh(new SphereGeometry(0.018, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), gold);
    rv.rotation.x = Math.PI / 2;
    rv.position.set(sx * 0.24, 1.385, F + 0.004);
    g.add(rv);
  }
  // 方鼻头：棱台，背面 0.34 × 0.29，正面 0.30 × 0.25，伸出 0.235；背后一圈底板，正面一圈浅色卷边，偏左一个金搭扣。
  const bd = 0.235;
  const bz = F + 0.012;
  g.add(m(bev(rect(-0.195, 0.755, 0.195, 1.095), 0.014, 0.005), cream(0xf1dfc2), F));
  g.add(m(frustum(-0.17, 0.78, 0.17, 1.07, bd, 0.014, 0.88, 0.86), cream(0xd9b088), bz));
  const fz = bz + bd;
  g.add(m(bev(rect(-0.148, 0.802, 0.148, 1.048), 0.006, 0.003, [rect(-0.13, 0.82, 0.13, 1.03).reverse()]), cream(0xf4e4c8), fz - 0.003));
  g.add(m(bev(rect(-0.07, 0.865, 0.03, 0.96), 0.045, 0.01), [gold, goldDark], fz));
  g.add(m(bev(rect(-0.095, 0.88, -0.065, 0.945), 0.028, 0.006), [gold, goldDark], fz));
  // 大灯、胡须。
  for (const s of [-1, 1]) {
    const lamp = headlamp(0.14, 0.2, 0.11);
    lamp.position.set(s * 0.467, 1.124, F);
    g.add(lamp);
    for (let k = 0; k < 3; k++) whisker(g, new Vector3(s * 0.3, 0.86 - k * 0.08, F + 0.06), new Vector3(s * 0.64, 0.89 - k * 0.12, F + 0.1));
  }
  return g;
}
