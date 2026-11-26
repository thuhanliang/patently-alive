import { CanvasTexture, CylinderGeometry, Group, Mesh, MeshStandardMaterial, ShapeUtils, SphereGeometry, SRGBColorSpace, Vector2, Vector3, type BufferGeometry, type Material } from 'three';
import { bev, rng } from '../craft';
import { paperMaterial } from '../paper';

/**
 * 车鼻子正面（2026-11-26 部件实验台第 2 件，照 6-overall.jpg 的车头）。
 * 大的尺寸：在效果图上量点、和镜头一起拟合；细节：按独立审核员（子 agent，只看左右对比和放大图）的意见改，
 * 设计图（AI 画的）里含糊或不合理的地方按好看、合理来做。
 * - 面板宽 1.28、高 0.89：一块块有厚度的卡纸拼到边（灰白、米白、浅灰），切边露浅色纸芯，底排有的块凸出一点；不做整圈金框，只在上两角各一片 L 形金角片；
 * - 大灯：中心 ±0.44、高 1.124；八角高宽比约 1.3，斜边约为竖边的 0.8；灯筒浅（伸出 0.09），侧壁金棕色，根部略大、侧壁垂直于面板；
 *   金框一圈（宽约灯宽 1/8，内沿一道斜面）→ 深紫褐内框一圈 → 细金压边 → 暖黄灯玻璃（宽约灯宽一半，放射细线）；两侧金铰链耳片钉在面板上；
 * - 雨檐：一整张折过两道的金卡纸（截面 /‾‾\），罩住灯的顶边和上斜边的上半段，离灯筒一道缝，后端立在面板上、后沿折出粘贴舌，前沿探出灯面 8 厘米；
 *   金框外侧两个顶点上各一颗黄铜圆钉；
 * - 格栅：7 根浅牛皮纸条（条:缝约 0.6:1），缝是深褐，顶上一根横档压住条头；外框是一整块 U 形厚纸板、上两角切斜角；
 * - 方鼻头是个信箱：横长（0.44 × 0.25），伸出 0.15，折痕级小倒角，背后一圈和面板同色的窄压边；前脸一道投信口（金翻盖挂在细卷轴上）、一块小金名牌；
 * - 胡须：黄铜八棱卷纸管（悬臂），每侧三根近乎平行、往外略上扬，根部各一个圆座钉在面板上，外端多面纸珠，伸出车身轮廓外约 0.1。
 * 所有倒角都是单段的（一条干净的折痕）——多段倒角在墨线里会描成一圈圈"等高线"。
 * 正面朝 +z，原点在面板正中的地面高度上（y 是离地高度）。
 */

// 金卡纸：浅香槟金（背光、朝下的面用 goldDark 深铜褐）；金属感不强——是印了金的卡纸，不是镜面铜。
export const gold = new MeshStandardMaterial({ color: 0xeec676, metalness: 0.3, roughness: 0.42, emissive: 0x3e2a0a });
export const goldDark = new MeshStandardMaterial({ color: 0xc28838, metalness: 0.3, roughness: 0.5, emissive: 0x2a1806 });
// 黄铜：胡须用，和金件同族，略暗、偏橙；平面着色——胡须是卷纸管和多面纸珠，不是光滑的金属杆。
export const brass = new MeshStandardMaterial({ color: 0xd9a050, metalness: 0.35, roughness: 0.45, emissive: 0x3a2206, flatShading: true });
const boltDot = new MeshStandardMaterial({ color: 0x4a3018, roughness: 0.8 });

/** 单段倒角的挤出（一条干净的折痕）。 */
const pb = (pts: Vector2[], depth: number, bevel: number, holes: Vector2[][] = []): BufferGeometry => bev(pts, depth, bevel, holes, 1);

function m(geo: BufferGeometry, mats: Material | Material[], z = 0): Mesh {
  const x = new Mesh(geo, mats);
  x.position.z = z;
  x.castShadow = x.receiveShadow = true;
  return x;
}
const rect = (x0: number, y0: number, x1: number, y1: number): Vector2[] => [new Vector2(x0, y0), new Vector2(x1, y0), new Vector2(x1, y1), new Vector2(x0, y1)];

/** 切角的矩形（八角形的矩形版）：横向切 cx，竖向切 cy。 */
function chamfered(x0: number, y0: number, x1: number, y1: number, cx: number, cy = cx): Vector2[] {
  return [
    new Vector2(x0 + cx, y0), new Vector2(x1 - cx, y0), new Vector2(x1, y0 + cy), new Vector2(x1, y1 - cy),
    new Vector2(x1 - cx, y1), new Vector2(x0 + cx, y1), new Vector2(x0, y1 - cy), new Vector2(x0, y0 + cy),
  ];
}

/** 空间里一块平的四边形卡纸（四个角 c，朝 n 那面是正面，厚 t 往背面长）。 */
function plate(c: Vector3[], n: Vector3, t: number, mats: Material[]): Mesh {
  const ctr = c.reduce((a, p) => a.add(p), new Vector3()).multiplyScalar(1 / c.length);
  const u = c[1]!.clone().sub(c[0]!).normalize();
  const v = new Vector3().crossVectors(n, u).normalize();
  const pts = c.map((p) => new Vector2(p.clone().sub(ctr).dot(u), p.clone().sub(ctr).dot(v)));
  if (ShapeUtils.isClockWise(pts)) pts.reverse();
  const x = new Mesh(pb(pts, t, Math.min(0.002, t * 0.3)), mats);
  x.matrixAutoUpdate = false;
  x.matrix.makeBasis(u, v, n).setPosition(ctr.clone().addScaledVector(n, -t));
  x.castShadow = x.receiveShadow = true;
  return x;
}

/** 大螺栓：一圈垫圈 + 扁圆帽 + 中心一个深色凹点，贴在 z 朝外的面上。 */
function bolt(g: Group, x: number, y: number, z: number, r = 0.014): void {
  const washer = new Mesh(new CylinderGeometry(r * 1.6, r * 1.6, 0.003, 24), goldDark);
  washer.rotation.x = Math.PI / 2;
  washer.position.set(x, y, z + 0.0015);
  const cap = new Mesh(new SphereGeometry(r, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), gold);
  cap.rotation.x = Math.PI / 2;
  cap.scale.set(1, 0.4, 1);
  cap.position.set(x, y, z + 0.003);
  const dot = new Mesh(new CylinderGeometry(r * 0.3, r * 0.3, 0.002, 12), boltDot);
  dot.rotation.x = Math.PI / 2;
  dot.position.set(x, y, z + 0.003 + r * 0.4);
  washer.castShadow = cap.castShadow = true;
  g.add(washer, cap, dot);
}

let glassTex: CanvasTexture | null = null;
function lampGlass(): MeshStandardMaterial {
  glassTex ??= (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    // 暖黄，中心只亮一点（不发白），往边上略暗。
    const gr = g.createRadialGradient(128, 128, 8, 128, 128, 140);
    gr.addColorStop(0, '#ffe7a0');
    gr.addColorStop(0.55, '#f6cf6c');
    gr.addColorStop(1, '#dca246');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    // 12 条放射细线（菲涅耳灯罩的感觉），黄褐色，看得清。
    g.strokeStyle = 'rgba(150,95,35,0.55)';
    g.lineWidth = 2.5;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath();
      g.moveTo(128 + Math.cos(a) * 8, 128 + Math.sin(a) * 8);
      g.lineTo(128 + Math.cos(a) * 150, 128 + Math.sin(a) * 150);
      g.stroke();
    }
    const t = new CanvasTexture(c);
    t.colorSpace = SRGBColorSpace;
    return t;
  })();
  return new MeshStandardMaterial({ map: glassTex, emissiveMap: glassTex, emissive: 0xffffff, emissiveIntensity: 0.22, roughness: 0.35 });
}

/** 点在 oct(hw, hh) 里面吗？ */
function insideOct(x: number, y: number, hw: number, hh: number): boolean {
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  if (ax > hw + 1e-6 || ay > hh + 1e-6) return false;
  const cx = hw * 0.5;
  const cy = hh * 0.56;
  return Math.max(0, ax - (hw - cx)) / cx + Math.max(0, ay - (hh - cy)) / cy <= 1 + 1e-6;
}

/** 斜面框：外沿竖直、正面从外沿往内沿斜下去 drop（像画框；外沿不往里收）。 */
function slopeRing(ohw: number, ohh: number, ihw: number, ihh: number, thick: number, drop: number, mats: Material[]): Mesh {
  const geo = pb(oct(ohw, ohh), thick, 0.001, [oct(ihw, ihh).reverse()]);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getZ(i) > thick * 0.5 && insideOct(p.getX(i), p.getY(i), ihw + 0.003, ihh + 0.003)) p.setZ(i, p.getZ(i) - drop);
  geo.computeVertexNormals();
  return m(geo, mats);
}

/** 大灯的八角：高宽比约 1.3，斜边约为竖边的 0.8。 */
function oct(hw: number, hh: number): Vector2[] {
  return chamfered(-hw, -hh, hw, hh, hw * 0.5, hh * 0.56);
}

/** 一只大灯：中心在原点，正面朝 +z，外框半宽 hw、半高 hh，灯筒从面板伸出 depth。 */
export function headlamp(hw = 0.15, hh = 0.195, depth = 0.09, out = 1): Group {
  const g = new Group();
  const o = (d: number): Vector2[] => oct(hw - d, hh - d);
  const side = [paperMaterial(0x7a5530, { scale: 0.15 }), paperMaterial(0x6c4a2a, { scale: 0.15 })];
  const mauve = [paperMaterial(0x93807f, { scale: 0.1 }), paperMaterial(0x7d6b6b, { scale: 0.1 })];
  // 灯筒：暖深褐（比正面的金暗一半，深度才看得出来），侧壁垂直于面板；根部贴面板一圈略大的底边（同色）。
  g.add(m(pb(o(-0.012), 0.012, 0.0015, [o(0.03).reverse()]), side, 0));
  g.add(m(pb(o(0), depth - 0.03, 0.001, [o(0.04).reverse()]), side, 0.006));
  // 金框：一圈斜面框（宽约灯宽 1/8），外沿竖直，正面往里斜下去约 20°，按朝向分出明暗。
  const fr = slopeRing(hw, hh, hw - 0.038, hh - 0.038, 0.024, 0.008, [gold, goldDark]);
  fr.position.z = depth - 0.024;
  g.add(fr);
  // 灰粉褐内框：一圈较平的台阶环（约灯宽 1/7），只有一道窄斜面。
  const mr = slopeRing(hw - 0.036, hh - 0.036, hw - 0.078, hh - 0.078, 0.014, 0.004, mauve);
  mr.position.z = depth - 0.022;
  g.add(mr);
  // 一道很细的浅色斜边 + 灯玻璃（宽约灯宽的 0.45）。
  const gw = hw - 0.0825;
  const gh = hh - 0.0825;
  g.add(m(pb(oct(gw + 0.008, gh + 0.008), 0.01, 0.0015, [oct(gw, gh).reverse()]), [paperMaterial(0xe9d6b0, { scale: 0.1 }), paperMaterial(0xcdb68e, { scale: 0.1 })], depth - 0.026));
  const glass = new Mesh(pb(oct(gw, gh), 0.008, 0.002), [lampGlass(), goldDark]);
  const uv = glass.geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (2 * gw) + 0.5, uv.getY(i) / (2 * gh) + 0.5);
  glass.position.z = depth - 0.03;
  glass.castShadow = glass.receiveShadow = true;
  g.add(glass);
  // 雨檐：一整张折过两道的金卡纸（截面 /‾‾\，顶面和两个斜面是同一块料，没有拼接、不会互相穿插）。
  // 内表面紧贴灯筒的顶边和两条上斜边，后端顶在根部那圈底边上，往前一直伸到灯面前 6 厘米。
  // 两翼只罩住上斜边的上半段（斜边下半露出来）；离灯筒留一道缝（让开根部底边），后端直接立在面板上，
  // 后沿往外折出一圈粘贴舌贴在面板上——一眼看得出它是粘在车头上的。前沿探出灯面 8 厘米。
  const t = 0.006;
  const gap = 0.02; // 离根部底边至少 8 毫米（程序算过，不穿插）
  const half = (q: Vector2[], i: number, j: number): Vector2 => q[i]!.clone().add(q[j]!).multiplyScalar(0.5);
  const ring = (d: number): Vector2[] => {
    const q = oct(hw + d, hh + d);
    return [half(q, 3, 4), q[4]!, q[5]!, half(q, 5, 6)];
  };
  const inner = ring(gap);
  const outer = ring(gap + t);
  g.add(m(pb([...inner, ...outer.reverse()], depth + 0.08, 0.0008), [gold, goldDark], 0));
  const tabIn = ring(gap + t);
  const tabOut = ring(gap + t + 0.016);
  g.add(m(pb([...tabIn, ...tabOut.reverse()], 0.003, 0.0005), [gold, goldDark], 0));
  // 金框外侧的两个顶点上各一颗黄铜圆钉（钉穿金框，把灯钉在车上）。
  const ov = oct(hw - 0.012, hh - 0.012);
  for (const k of [2, 3]) {
    const kn = new Mesh(new SphereGeometry(0.011, 10, 6), brass);
    kn.position.set(out * ov[k]!.x, ov[k]!.y, depth + 0.004);
    kn.castShadow = true;
    g.add(kn);
  }
  return g;
}

/** 一根黄铜胡须（八棱卷纸管）：从 a（内端，套环）到 b（外端，多面纸珠）。 */
function whisker(g: Group, a: Vector3, b: Vector3): void {
  const len = a.distanceTo(b);
  const r = 0.012;
  const dir = b.clone().sub(a).normalize();
  const rod = new Mesh(new CylinderGeometry(r, r, len, 8), brass);
  rod.position.copy(a).add(b).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
  const ring = new Mesh(new CylinderGeometry(r * 1.6, r * 1.6, r * 2.2, 8), brass);
  ring.quaternion.copy(rod.quaternion);
  ring.position.copy(a).addScaledVector(dir, r * 1.1);
  const ball = new Mesh(new SphereGeometry(r * 1.8, 8, 5), brass);
  ball.position.copy(b);
  rod.castShadow = ring.castShadow = ball.castShadow = true;
  g.add(rod, ring, ball);
}

/** 把一个轮廓挤成盒子再往前收成棱台：z = 0 处是原尺寸，z = depth 处按 k 缩（绕 cx, cy）。 */
function frustum(pts: Vector2[], cx: number, cy: number, depth: number, bevel: number, k: number): BufferGeometry {
  const geo = pb(pts, depth, bevel);
  const p = geo.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const f = 1 + (k - 1) * (p.getZ(i) / depth);
    p.setXY(i, cx + (p.getX(i) - cx) * f, cy + (p.getY(i) - cy) * f);
  }
  geo.computeVertexNormals();
  return geo;
}

export const NOSE_KX = 1.19;
export const NOSE_KY = 0.957;
export const NOSE_KZ = 0.8;
export const NOSE_DY = 0.085;

/** 车鼻子正面：面板正面在 z = F。 */
export function buildNose(seed = 5): Group {
  const g = new Group();
  const r = rng(seed);
  const W = 1.28;
  const y0 = 0.52;
  const y1 = 1.41;
  const F = 0.05;
  const shade = (c: number, k: number): number => (Math.round(((c >> 16) & 255) * k) << 16) | (Math.round(((c >> 8) & 255) * k) << 8) | Math.round((c & 255) * k);
  // 厚纸板块：侧面同色略深（体块的侧面不能比正面亮）。
  const block = (c: number): Material[] => [paperMaterial(c, { scale: 0.25 }), paperMaterial(shade(c, 0.78), { scale: 0.25 })];
  // 薄卡纸：切边露浅色纸芯。
  const sheet = (c: number): Material[] => [paperMaterial(c, { scale: 0.25 }), paperMaterial(0xf7efe0, { scale: 0.25 })];
  const gx = 0.2;
  const gy0 = 0.9;
  const gy1 = 1.356;
  // 底板：一整块厚纸板（颜色深一点，拼缝里露出来），格栅处开口。
  for (const [a, b, c, d] of [
    [-W / 2, y0, W / 2, gy0],
    [-W / 2, gy1, W / 2, y1],
    [-W / 2, gy0, -gx, gy1],
    [gx, gy0, W / 2, gy1],
  ] as const)
    g.add(m(pb(rect(a, b, c, d), F - 0.016, 0.0015), block(0xc4ae90), 0));
  // 面上几大块暖奶油色厚卡纸拼到边，每块一样厚（正面都在 z = F）；格栅开口处不贴。
  const tones = [0xf1e2c8, 0xeed8bb, 0xf4e8d4, 0xe9d8c0, 0xe2dccd, 0xf0dcc2];
  const rows = [y0, 0.7, 1.05, y1];
  for (let ri = 0; ri < rows.length - 1; ri++) {
    let x = -W / 2;
    while (x < W / 2 - 0.02) {
      const w = Math.min(0.3 + r() * 0.3, W / 2 - x);
      const a = x + 0.005;
      const c = x + w - 0.005;
      const b = rows[ri]! + 0.005;
      const d = rows[ri + 1]! - 0.005;
      x += w;
      const th = 0.016; // 厚度统一：灯、信箱、胡须座都坐在卡纸正面上，不悬空
      // 底排（灯、信箱、胡须座都不在这一排）有的块凸出 3 毫米，露出白色切边。
      const lift = ri === 0 && r() < 0.4 ? 0.003 : 0;
      const tone = tones[Math.floor(r() * tones.length)]!;
      // 和格栅、信箱那一竖条（|x| < 0.245）重叠的块，切掉中间那段（不整块跳过，免得灯和胡须座底下空着）。
      const band = 0.245;
      const parts: Array<[number, number]> = d > gy0 - 0.04 && b < gy1 + 0.06 ? [[a, Math.min(c, -band)], [Math.max(a, band), c]] : [[a, c]];
      for (const [pa, pc] of parts) if (pc - pa > 0.02) g.add(m(pb(rect(pa, b, pc, d), th + lift, 0.001), sheet(tone), F - 0.016));
    }
  }
  // 金角片：只在上两角各一片 L 形（不做整圈外框，那像画框），各两颗螺栓。
  for (const sx of [-1, 1]) {
    const L = 0.1;
    const wd = 0.024;
    const xa = sx * (W / 2);
    const pts = [new Vector2(xa, y1), new Vector2(xa - sx * L, y1), new Vector2(xa - sx * L, y1 - wd), new Vector2(xa - sx * wd, y1 - wd), new Vector2(xa - sx * wd, y1 - L), new Vector2(xa, y1 - L)];
    if (ShapeUtils.isClockWise(pts)) pts.reverse();
    g.add(m(pb(pts, 0.004, 0.0008), [gold, goldDark], F));
    // 侧面那一边：包过面板的边，贴在侧面上（真正的护角）。
    // 绕 y 转 ±90°：本地厚度方向朝外，本地 x 对应世界 z（0 到 F + 0.004，和正面那片接上）。
    const side = m(pb(sx > 0 ? rect(-F - 0.004, y1 - L, 0, y1) : rect(0, y1 - L, F + 0.004, y1), 0.004, 0.0008), [gold, goldDark]);
    side.rotation.y = (sx * Math.PI) / 2;
    side.position.x = xa;
    g.add(side);
    bolt(g, xa - sx * (L - 0.016), y1 - wd / 2, F + 0.004, 0.008);
    bolt(g, xa - sx * wd / 2, y1 - (L - 0.016), F + 0.004, 0.008);
  }
  // 格栅：后面一块深褐的板；7 根薄金片（侧面暗，免得被看成两根；条:缝约 0.7:1，宽度、角度带一点手裁的随机）；
  // 格栅很浅：金片几乎和外框齐平，后板只退 3 厘米；外框略凸、上两角切斜角（拼成几块，不带洞的多边形三角化才稳）。
  const gb = 1.072; // 信箱衬板的上沿：格栅只做这以上看得见的部分（下面被信箱挡住，也不和衬板穿插）
  g.add(m(pb(rect(-gx, gb + 0.002, gx, gy1), 0.01, 0.002), [paperMaterial(0x3a2618, { scale: 0.2 }), paperMaterial(0x3a2618, { scale: 0.2 })], F - 0.03));
  const pitch = (2 * gx) / 7;
  const barSide = new MeshStandardMaterial({ color: 0x6a4a22, roughness: 0.7 });
  const barMat = [paperMaterial(0xd9bb8c, { scale: 0.15 })];
  for (let i = 0; i < 7; i++) {
    const bw = pitch * 0.375 * (0.97 + r() * 0.06);
    const bh = (gy1 - gb - 0.006) / 2; // 上下各让出 2–4 毫米，不和外框内沿、衬板上沿贴在同一个面上
    const bar = m(pb(rect(-bw / 2, -bh, bw / 2, bh), 0.007, 0.001), [barMat[0]!, barSide]);
    bar.position.set(-gx + (i + 0.5) * pitch, (gb + 0.004 + gy1 - 0.002) / 2, F - 0.012);
    bar.rotation.z = (r() - 0.5) * 0.017;
    g.add(bar);
  }
  // 顶横档：压住条头（交代格栅条是怎么固定的）。
  g.add(m(pb(rect(-gx + 0.002, gy1 - 0.024, gx - 0.002, gy1 - 0.006), 0.006, 0.001), [barMat[0]!, barSide], F - 0.004));
  // 外框：一整块 U 形厚纸板（上两角切斜角），没有拼缝；两条腿立在信箱衬板上沿。
  const fw = 0.034;
  const fc = fw * 1.5;
  const ys = gy1 + fw - fc;
  const frame = [
    new Vector2(-gx - fw, gb), new Vector2(-gx, gb), new Vector2(-gx, gy1), new Vector2(gx, gy1), new Vector2(gx, gb),
    new Vector2(gx + fw, gb), new Vector2(gx + fw, ys), new Vector2(gx + fw - fc, gy1 + fw), new Vector2(-gx - fw + fc, gy1 + fw), new Vector2(-gx - fw, ys),
  ];
  g.add(m(pb(frame, 0.024, 0.0015), block(0xf0e8da), F - 0.016));
  // 方鼻头（信箱）：横长（0.44 × 0.25，比格栅略宽，像外挂上去的盒子），伸出 0.15（约高的 0.6），略呈棱台，折痕级的小倒角；背后一圈和面板同色的窄压边。
  const bw = 0.22;
  const by0 = 0.8;
  const by1 = 1.05;
  const bcy = (by0 + by1) / 2;
  const bd = 0.15;
  const bz = F + 0.01;
  g.add(m(pb(rect(-bw - 0.012, by0 - 0.012, bw + 0.012, by1 + 0.022), 0.026, 0.0015), block(0xf2e6d2), F - 0.016));
  g.add(m(frustum(chamfered(-bw, by0, bw, by1, 0.009), 0, bcy, bd, 0.0015, 0.93), block(0xe0c4a2), bz));
  const fz = bz + bd;
  // 前脸一圈浅色翻边纸条。
  const fx = bw * 0.93;
  const fy0 = bcy - (bcy - by0) * 0.93;
  const fy1 = bcy + (by1 - bcy) * 0.93;
  g.add(m(pb(chamfered(-fx, fy0, fx, fy1, 0.008), 0.005, 0.001, [rect(-fx + 0.014, fy0 + 0.014, fx - 0.014, fy1 - 0.014).reverse()]), sheet(0xf4e9d6), fz - 0.002));
  // 信箱：前脸上部一道横的投信口（深色缝 + 上沿一片金色翻盖），下部一块小金名牌（两颗小钉）。
  const slotW = bw * 0.62;
  const slotY = bcy + 0.03;
  g.add(m(pb(rect(-slotW, slotY - 0.011, slotW, slotY + 0.011), 0.006, 0.001), [paperMaterial(0x2a1a10, { scale: 0.1 }), paperMaterial(0x2a1a10, { scale: 0.1 })], fz - 0.004));
  // 金翻盖：一片薄金卡，上沿挂在一根贯通的细卷轴上，下沿往外翘一点（在投信口上投下影子）。
  const flap = m(pb(rect(-slotW - 0.01, -0.034, slotW + 0.01, 0), 0.004, 0.0008), [gold, goldDark]);
  flap.position.set(0, slotY + 0.018, fz + 0.004);
  flap.rotation.x = -0.14;
  g.add(flap);
  const hg = new Mesh(new CylinderGeometry(0.0045, 0.0045, slotW * 2 + 0.02, 10), goldDark);
  hg.rotation.z = Math.PI / 2;
  hg.position.set(0, slotY + 0.019, fz + 0.0055);
  g.add(hg);
  g.add(m(pb(rect(-0.07, bcy - 0.085, 0.07, bcy - 0.035), 0.004, 0.001), [gold, goldDark], fz + 0.0006));
  for (const sx of [-1, 1]) bolt(g, sx * 0.058, bcy - 0.06, fz + 0.004, 0.005);
  // 大灯、胡须。胡须从鼻头外侧的小黄铜座伸出（和鼻头留一个杆径的空隙），三根扇形张开（相邻约 6°），外端圆球帽。
  for (const s of [-1, 1]) {
    const lamp = headlamp(0.15, 0.195, 0.09, s);
    lamp.position.set(s * 0.44, 1.124, F);
    g.add(lamp);
    // 胡须是悬臂：只在根部的圆座上固定，往外伸出车身轮廓（面板边 ±0.64）外约 0.1。
    const sx = s * (bw + 0.06);
    for (let i = 0; i < 3; i++) {
      // 三根近乎平行、往外略上扬；最上面一根经过灯底时要低于灯（程序算过间隙）。
      const yi = 0.85 - i * 0.06;
      const ang = ((6 - i * 2) * Math.PI) / 180;
      const len = 0.46;
      const seat = new Mesh(new CylinderGeometry(0.02, 0.022, 0.016, 18), goldDark);
      seat.rotation.x = Math.PI / 2;
      seat.position.set(sx, yi, F + 0.008);
      seat.castShadow = true;
      g.add(seat);
      whisker(g, new Vector3(sx, yi, F + 0.02), new Vector3(sx + s * len * Math.cos(ang), yi + len * Math.sin(ang), F + 0.075));
    }
  }
  // 镜头校正（2026-11-26）：这件的尺寸是在"偏转 31°、俯视 23°"的镜头下量的，后来用轮毂（正八边形）重新定镜头，
  // 偏转是 40°、俯视 16°。同一个画面里：横向（x）要放大约 1.19 倍，深度（z）缩到约 0.8 倍，纵向缩到约 0.96 并上移 0.085。
  // 灯因此更接近正八边形，灯筒、信箱更浅。
  g.scale.set(NOSE_KX, NOSE_KY, NOSE_KZ);
  g.position.y = NOSE_DY;
  return g;
}
