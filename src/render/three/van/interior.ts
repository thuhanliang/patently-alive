import { CatmullRomCurve3, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PointLight, SphereGeometry, SpotLight, Vector2, Vector3, type Material, type Object3D } from 'three';
import { paperMaterial } from '../paper';
import {
  C,
  Pendulum,
  Rivets,
  Spring,
  V3,
  block,
  brassDark,
  brassMat,
  canvasTex,
  card,
  cardBox,
  copperMat,
  dogOutline,
  flat,
  gold,
  hang,
  hinge,
  hook,
  mesh,
  ngon,
  put,
  rng,
  rolled,
  slab,
  slices,
  stackRound,
  strip,
  tack,
  tape,
  twine,
} from '../craft';
import { XR } from './body';
import { bake } from './bake';

/**
 * 勾勾的车厢里（2026-11-25 第二版）：按 docs/research/craft.md 的纸艺标准件重做——
 * 圆的东西是一圈圈纸叠出来或卷出来的，块是灰纸板一层层粘的，门和盖子挂在合页上，绳子是两股拧的麻绳，纸用胶带和图钉固定。
 * 每一件能碰的东西登记在 items 里：act 是点它时它自己做的动作（抽屉拉开、盖子翻开……），inspect 表示能拿起来细看。
 */

export interface InteriorItem {
  id: string;
  name: string;
  hint: string;
  obj: Object3D;
  act?: () => void;
  inspect?: boolean;
}

export interface Interior {
  items: InteriorItem[];
  /** 工作台上装岛的托盘的中心：外面把岛的 A4 纸雕放进来（托盘内框 0.42 × 0.29 米）。 */
  islandSlot: Group;
  lamp: SpotLight;
  bulb: PointLight;
  /** 站着走动时挡路的东西（x0, z0, x1, z1）。 */
  obstacles: Array<[number, number, number, number]>;
  /** 坐在工作台前的椅子上：眼睛的位置和看的方向。 */
  seat: { eye: Vector3; look: Vector3 };
  /** 车开动 / 被碰时给挂着的东西一下。 */
  jostle(v: number): void;
  update(dt: number, t: number): void;
}

const Y0 = 0.565; // 地板面
const ZW = 0.955; // 远墙内面
export const TABLE_Y = 1.3;

/** 一只动物的剪影画进卡片（狗、兔、鸟、鼬，轮流）。 */
function drawAnimal(g: CanvasRenderingContext2D, kind: number, cx: number, cy: number, s: number): void {
  g.beginPath();
  if (kind % 4 === 0) {
    dogOutline().forEach((p, i) => (i ? g.lineTo(cx + p.x * s, cy - p.y * s) : g.moveTo(cx + p.x * s, cy - p.y * s)));
  } else if (kind % 4 === 1) {
    g.ellipse(cx - 0.05 * s, cy - 0.22 * s, 0.32 * s, 0.2 * s, 0, 0, Math.PI * 2);
    g.ellipse(cx + 0.28 * s, cy - 0.38 * s, 0.13 * s, 0.11 * s, 0, 0, Math.PI * 2);
    g.ellipse(cx + 0.26 * s, cy - 0.66 * s, 0.04 * s, 0.18 * s, -0.2, 0, Math.PI * 2);
    g.ellipse(cx + 0.34 * s, cy - 0.64 * s, 0.04 * s, 0.17 * s, 0.2, 0, Math.PI * 2);
  } else if (kind % 4 === 2) {
    g.ellipse(cx, cy - 0.32 * s, 0.26 * s, 0.17 * s, -0.2, 0, Math.PI * 2);
    g.ellipse(cx + 0.24 * s, cy - 0.5 * s, 0.11 * s, 0.1 * s, 0, 0, Math.PI * 2);
    g.moveTo(cx + 0.34 * s, cy - 0.52 * s);
    g.lineTo(cx + 0.48 * s, cy - 0.48 * s);
    g.lineTo(cx + 0.34 * s, cy - 0.46 * s);
    g.fillRect(cx - 0.04 * s, cy - 0.18 * s, 0.03 * s, 0.18 * s);
    g.fillRect(cx + 0.06 * s, cy - 0.18 * s, 0.03 * s, 0.18 * s);
  } else {
    g.ellipse(cx, cy - 0.2 * s, 0.42 * s, 0.1 * s, 0, 0, Math.PI * 2);
    g.ellipse(cx + 0.44 * s, cy - 0.26 * s, 0.1 * s, 0.08 * s, 0, 0, Math.PI * 2);
    g.ellipse(cx - 0.5 * s, cy - 0.3 * s, 0.2 * s, 0.05 * s, -0.5, 0, Math.PI * 2);
  }
  g.fill();
}

function cardFace(kind: number, tint: string): MeshStandardMaterial {
  const tex = canvasTex(256, 320, (g) => {
    g.fillStyle = tint;
    g.fillRect(0, 0, 256, 320);
    g.strokeStyle = 'rgba(90,60,30,0.35)';
    g.lineWidth = 3;
    g.strokeRect(14, 14, 228, 292);
    g.fillStyle = '#8a6a44';
    drawAnimal(g, kind, 128, 190, 160);
    g.fillStyle = 'rgba(90,60,30,0.45)';
    for (let i = 0; i < 3; i++) g.fillRect(40, 226 + i * 18, 176 - i * 40, 5);
    g.fillStyle = '#b8452f';
    g.beginPath();
    g.arc(200, 274, 14, 0, Math.PI * 2);
    g.fill();
  });
  return new MeshStandardMaterial({ map: tex, roughness: 0.95 });
}

/** 一张有图案的纸（正面贴图、断面是纸芯）。w×h，躺在 xz 平面（朝 +y）或立在 xy 平面（朝 +z）。 */
function printed(w: number, h: number, t: number, mat: Material, edgeColor: number, upright = false): Mesh {
  const pts = upright ? [V3(-w / 2, 0, t), V3(w / 2, 0, t), V3(w / 2, h, t), V3(-w / 2, h, t)] : [V3(-w / 2, t, h / 2), V3(w / 2, t, h / 2), V3(w / 2, t, -h / 2), V3(-w / 2, t, -h / 2)];
  const m = new Mesh(slab(pts, t, [], true), [mat, paperMaterial(edgeColor, { edge: true })]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export function buildInterior(parent: Group, seed: number): Interior {
  const g = new Group();
  parent.add(g);
  const items: InteriorItem[] = [];
  const rv = new Rivets();
  const rnd = rng(seed + 5);
  const springs: Array<{ s: Spring; apply: (x: number) => void; lo: number; hi: number }> = [];
  const swings: Array<{ p: Pendulum; o: Object3D; axis: 'x' | 'z' }> = [];
  const add = (...o: Object3D[]): void => {
    for (const x of o) g.add(x);
  };
  const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, kind: 'card' | 'wood' | 'kraft' = 'card', scale = 0.35): Mesh => {
    const m = cardBox(w, h, d, c, scale, kind);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };
  /** 一个会被弹簧带着走的东西（抽屉、盖子、门）。 */
  const sprung = (x0: number, apply: (x: number) => void, lo: number, hi: number, k = 120, c = 13): Spring => {
    const s = new Spring(x0, x0, k, c);
    springs.push({ s, apply, lo, hi });
    apply(x0);
    return s;
  };

  // ———— 地板：木纹纸板一条条拼，缝看得见；条纹地毯（毛毡） ————
  const boards = 13;
  for (let i = 0; i < boards; i++) {
    const z = -0.93 + (i + 0.5) * (1.86 / boards);
    const tone = [C.woodLight, 0xb98a5a, 0xc8a070, 0xad7f52][i % 4]!;
    box(3.3 - (i % 3) * 0.02, 0.02, 1.86 / boards - 0.01, tone, -0.4 + (i % 2) * 0.01, Y0 - 0.01, z, 'wood', 0.5);
  }
  const rugTex = canvasTex(256, 256, (c) => {
    const cols = ['#c9b796', '#9fb3b4', '#e8dcc3', '#b78f6a'];
    for (let y = 0; y < 256; y += 16) {
      c.fillStyle = cols[(y / 16) % 4]!;
      c.fillRect(0, y, 256, 16);
    }
    c.globalAlpha = 0.15;
    for (let i = 0; i < 3000; i++) {
      c.fillStyle = i % 2 ? '#000' : '#fff';
      c.fillRect(Math.random() * 256, Math.random() * 256, 2, 1);
    }
  });
  const rug = new Mesh(slab([V3(-0.75, Y0 + 0.008, 0.25), V3(0.35, Y0 + 0.008, 0.25), V3(0.35, Y0 + 0.008, -0.55), V3(-0.75, Y0 + 0.008, -0.55)], 0.008, [], true), [new MeshStandardMaterial({ map: rugTex, roughness: 1 }), paperMaterial(0xc9b796, { edge: true })]);
  rug.receiveShadow = true;
  add(rug);

  // 轮拱在车里鼓起来的盒子。
  box(1.05, 0.3, 0.26, C.creamDark, -1.25, Y0 + 0.15, 0.82);

  // ———— 木肋（灰纸板叠的方条）、车顶的板条 ————
  for (const x of [-1.7, -0.9, 0.0, 0.95]) {
    const path = [V3(x, Y0, ZW - 0.002), V3(x, 2.27, ZW - 0.002), V3(x, 2.635, 0.71), V3(x, 2.635, -0.71)];
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i]!;
      const b = path[i + 1]!;
      const len = a.distanceTo(b);
      const rib = cardBox(0.05, len, 0.04, C.wood, 0.4, 'wood');
      rib.position.copy(a).add(b).multiplyScalar(0.5);
      rib.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
      add(rib);
    }
  }
  for (const z of [-0.45, 0, 0.45]) box(3.2, 0.03, 0.05, C.wood, -0.45, 2.62, z, 'wood', 0.6);
  for (let i = 0; i < 20; i++) {
    const x = XR + 0.08 + i * 0.165;
    if (x > 1.15) break;
    box(0.155, 0.7, 0.015, i % 3 ? C.woodLight : 0xb98a5a, x + 0.08, Y0 + 0.35, ZW - 0.008, 'wood', 0.5);
  }

  // ———— 工作台 ————
  const tx0 = -0.62;
  const tx1 = 0.98;
  const tz0 = 0.3;
  box(tx1 - tx0, 0.05, ZW - tz0, C.woodLight, (tx0 + tx1) / 2, TABLE_Y - 0.025, (tz0 + ZW) / 2, 'wood', 0.6);
  add(strip([V3(tx0, TABLE_Y - 0.045, tz0), V3(tx1, TABLE_Y - 0.045, tz0)], V3(0, 0, -1), 0.04, 0.006));
  // 左边一组灰蓝的抽屉柜：两列三行，每只都能拉开（弹簧带着走，拉到底顿一下）。
  const dx0 = 0.32;
  box(tx1 - dx0, TABLE_Y - 0.05 - Y0, ZW - tz0 - 0.04, C.drawer, (dx0 + tx1) / 2, (Y0 + TABLE_Y - 0.05) / 2, (tz0 + ZW) / 2 + 0.02, 'card', 0.4);
  const dw = (tx1 - dx0) / 2;
  const dh = (TABLE_Y - 0.05 - Y0) / 3;
  for (let c = 0; c < 2; c++)
    for (let r = 0; r < 3; r++) {
      const dr = new Group();
      const fx = dx0 + dw * (c + 0.5);
      const fy = Y0 + dh * (r + 0.5);
      dr.add(put(cardBox(dw - 0.02, dh - 0.02, 0.022, r === 2 ? C.blue : C.drawer, 0.4), { position: V3(0, 0, 0.011) }));
      // 抽屉的盒身（拉出来才看得见）：底、两侧、后板。
      dr.add(put(cardBox(dw - 0.05, 0.012, 0.42, 0xd9c7a0, 0.3, 'kraft'), { position: V3(0, -dh / 2 + 0.03, 0.23) }));
      for (const sx of [-1, 1]) dr.add(put(cardBox(0.012, dh * 0.55, 0.42, 0xd9c7a0, 0.3, 'kraft'), { position: V3(sx * (dw / 2 - 0.03), -dh / 2 + 0.03 + dh * 0.27, 0.23) }));
      // 把手：一个铜丝弯的半环，两颗钉。
      const pull = new Mesh(new CylinderGeometry(0.005, 0.005, 0.06, 6), brassMat);
      pull.rotation.z = Math.PI / 2;
      pull.position.set(0, 0.012, -0.018);
      dr.add(pull, put(tack(0.007), { position: V3(-0.03, 0.012, -0.002), rotation: { x: Math.PI } }), put(tack(0.007), { position: V3(0.03, 0.012, -0.002), rotation: { x: Math.PI } }));
      dr.position.set(fx, fy, tz0);
      g.add(dr);
      const s = sprung(0, (x) => (dr.position.z = tz0 - x), 0, 0.3);
      items.push({ id: `tdrawer${c}${r}`, name: '抽屉', hint: '拉开看看', obj: dr, act: () => (s.target = s.target > 0.1 ? 0 : 0.26) });
    }
  // 右边：两只木箱、一摞纸。
  for (const [x, y, w, h] of [
    [-0.42, Y0 + 0.13, 0.32, 0.26],
    [-0.08, Y0 + 0.11, 0.26, 0.22],
  ] as const)
    add(put(crateMesh(w, h, 0.36), { position: V3(x, y, 0.72) }));
  for (let i = 0; i < 6; i++) {
    const sheet = cardBox(0.3, 0.004, 0.22, i % 2 ? 0xf2ead8 : 0xe9dfc8, 0.3);
    sheet.position.set(-0.4 + rnd() * 0.01, Y0 + 0.27 + i * 0.005, 0.72 + rnd() * 0.01);
    sheet.rotation.y = (rnd() - 0.5) * 0.12;
    add(sheet);
  }
  for (const z of [tz0 + 0.04, ZW - 0.04]) box(0.05, TABLE_Y - 0.05 - Y0, 0.05, C.wood, tx0 + 0.03, (Y0 + TABLE_Y - 0.05) / 2, z, 'wood', 0.4);

  // ———— 台面上 ————
  // 零件盘：木框、毛毡底，三乘三的格子，每格里几片纸偶零件（每片带一颗铆钉孔）。
  const tray = new Group();
  tray.position.set(-0.22, TABLE_Y, 0.62);
  const TW = 0.46;
  const TD = 0.32;
  tray.add(put(cardBox(TW, 0.012, TD, C.felt, 0.3, 'kraft'), { position: V3(0, 0.006, 0) }));
  for (const [x, z, w, d] of [
    [0, -TD / 2, TW + 0.02, 0.02],
    [0, TD / 2, TW + 0.02, 0.02],
    [-TW / 2 - 0.0, 0, 0.02, TD - 0.02],
    [TW / 2, 0, 0.02, TD - 0.02],
    [-TW / 6, 0, 0.008, TD - 0.02],
    [TW / 6, 0, 0.008, TD - 0.02],
    [0, -TD / 6, TW - 0.02, 0.008],
    [0, TD / 6, TW - 0.02, 0.008],
  ] as const)
    tray.add(put(cardBox(w, 0.04, d, C.wood, 0.4, 'wood'), { position: V3(x, 0.02, z) }));
  const partCol = [0xd98c4a, 0xe8c9a0, 0xc97a3e, 0xf0e2c4];
  const partShapes: Vector2[][] = [capsule(0.035, 0.012), capsule(0.05, 0.01), [new Vector2(-0.015, 0), new Vector2(0.015, 0), new Vector2(0, 0.035)], ellipse(0.05, 0.03), ellipse(0.03, 0.025)];
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++) {
      const sh = partShapes[(c * 3 + r) % partShapes.length]!;
      for (let k = 0; k < 2 + ((c + r) % 2); k++) {
        const pm = mesh(flat(sh, 0.0035), card(partCol[(c + r + k) % partCol.length]!, 0.1));
        pm.rotation.x = -Math.PI / 2;
        pm.rotation.z = rnd() * Math.PI * 2;
        pm.position.set(-TW / 3 + c * (TW / 3) + (rnd() - 0.5) * 0.05, 0.013 + k * 0.0036, -TD / 3 + r * (TD / 3) + (rnd() - 0.5) * 0.04);
        tray.add(pm);
      }
    }
  g.add(tray);
  items.push({ id: 'parts', name: '零件盘', hint: '拼一只动物：纸片、铆钉，都在这里（点一下打开设计台）', obj: tray });
  // 铆钉碗：一圈圈铜色卡纸叠成的浅碗，里面一把开口铆钉。
  const rbowl = stackRound(
    [
      [0, 0.045],
      [0.012, 0.055],
      [0.03, 0.062],
    ],
    0.004,
    C.copper,
    { hole: (y) => (y > 0.006 ? 0.055 - (0.03 - y) * 0.2 : 0), mats: [copperMat, paperMaterial(0xe6c9a8, { edge: true })] },
  );
  rbowl.position.set(0.09, TABLE_Y, 0.42);
  add(rbowl);
  for (let i = 0; i < 14; i++) {
    const r = tack(0.007);
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 0.035;
    r.position.set(0.09 + Math.cos(a) * d, TABLE_Y + 0.008 + rnd() * 0.01, 0.42 + Math.sin(a) * d);
    r.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    add(r);
  }
  // 两张草图，角上用纸胶带贴住；能拿起来看。
  const sketch = canvasTex(512, 384, (c) => {
    c.fillStyle = '#f4ecd9';
    c.fillRect(0, 0, 512, 384);
    c.strokeStyle = 'rgba(60,40,30,0.75)';
    c.lineWidth = 3;
    c.beginPath();
    c.ellipse(240, 200, 120, 64, 0, 0, Math.PI * 2);
    c.moveTo(352, 176);
    c.arc(380, 160, 36, Math.PI, Math.PI * 3);
    for (const x of [160, 200, 280, 320]) {
      c.moveTo(x, 250);
      c.lineTo(x - 8, 340);
    }
    c.moveTo(120, 190);
    c.quadraticCurveTo(60, 120, 80, 80);
    c.stroke();
    c.strokeStyle = 'rgba(60,40,30,0.3)';
    c.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      c.beginPath();
      c.moveTo(40, 40 + i * 8);
      c.lineTo(220, 40 + i * 8);
      c.stroke();
    }
  });
  const sketchMat = new MeshStandardMaterial({ map: sketch, roughness: 1 });
  for (const [x, z, r] of [
    [0.14, 0.64, 0.15],
    [0.2, 0.55, -0.12],
  ] as const) {
    const sg = new Group();
    sg.position.set(x, TABLE_Y + (r > 0 ? 0 : 0.0015), z);
    sg.rotation.y = r;
    sg.add(printed(0.22, 0.16, 0.0015, sketchMat, 0xf4ecd9));
    for (const [tx, tz] of [
      [-0.1, -0.07],
      [0.1, 0.07],
    ] as const)
      sg.add(tape(V3(tx - 0.025, 0.0016, tz), V3(tx + 0.025, 0.0016, tz), V3(0, 1, 0), 0.02, Math.round(tx * 100 + tz * 7)));
    sg.userData['view'] = [Math.PI / 2, 0, 0];
    g.add(sg);
    items.push({ id: `sketch${x}`, name: '草图', hint: '拿起来看看', obj: sg, inspect: true });
  }
  // 尺（木纹卡纸，刻度是印的）、剪刀（两片铁皮卡纸 + 一颗铆钉）、笔筒（卷筒）。
  const ruler = cardBox(0.32, 0.006, 0.03, 0xd9b46a, 0.3, 'wood');
  ruler.position.set(0.08, TABLE_Y + 0.003, 0.8);
  ruler.rotation.y = 0.08;
  add(ruler);
  const scissors = new Group();
  scissors.position.set(0.0, TABLE_Y + 0.003, 0.42);
  scissors.rotation.y = 0.6;
  for (const s of [1, -1]) {
    const blade = mesh(flat([new Vector2(0, 0.004 * s), new Vector2(0.11, 0.002 * s), new Vector2(0.12, 0), new Vector2(0, -0.006 * s), new Vector2(-0.02, -0.012 * s), new Vector2(-0.05, -0.03 * s), new Vector2(-0.06, -0.012 * s)], 0.003, [ngon(10, 0.008).map((p) => new Vector2(p.x - 0.045, p.y - 0.018 * s))]), card(0x9aa0a0, 0.1));
    blade.rotation.set(-Math.PI / 2, 0, s * 0.12);
    blade.position.y = s > 0 ? 0.003 : 0;
    scissors.add(blade);
  }
  scissors.add(put(tack(0.006), { position: V3(0, 0.007, 0), rotation: { x: -Math.PI / 2 } }));
  add(scissors);
  const penJar = rolled(0.035, 0.035, 0.1, 0.003, 0x8aa0a0, 20);
  penJar.position.set(-0.52, TABLE_Y, 0.86);
  add(penJar);
  for (let i = 0; i < 5; i++) {
    const c = [0xb8452f, 0x2f5a8a, 0x3e6b3a, 0xd9b46a, 0x5a3e28][i]!;
    const p = rolled(0.0045, 0.0045, 0.16, 0.0015, c, 6);
    p.position.set(-0.52 + (i - 2) * 0.01, TABLE_Y + 0.01, 0.86 + ((i % 2) - 0.5) * 0.015);
    p.rotation.set(((i % 2) - 0.5) * 0.3, 0, (i - 2) * 0.12);
    add(p);
  }

  // 装岛的托盘：木框（四根斜接的框条），框边一只小水平仪；铜包角用小钉钉住。
  const islandTray = new Group();
  islandTray.position.set(0.58, TABLE_Y, 0.64);
  const IW = 0.46;
  const ID = 0.33;
  islandTray.add(put(cardBox(IW, 0.012, ID, C.woodDark, 0.4, 'wood'), { position: V3(0, 0.006, 0) }));
  const frameIn = [V3(-IW / 2, 0.012, ID / 2), V3(IW / 2, 0.012, ID / 2), V3(IW / 2, 0.012, -ID / 2), V3(-IW / 2, 0.012, -ID / 2)];
  islandTray.add(strip(frameIn, V3(0, 1, 0), 0.026, 0.036, true, card(C.wood, 0.4, 'wood')));
  for (const p of frameIn) {
    const corner = strip([p.clone().add(V3(Math.sign(p.x) * -0.03, 0.036, 0)), p.clone().setY(0.048), p.clone().add(V3(0, 0.036, Math.sign(p.z) * -0.03))], V3(0, 1, 0), 0.028, 0.002);
    islandTray.add(corner);
    rv.add(p.clone().add(islandTray.position).setY(TABLE_Y + 0.05), V3(0, 1, 0), 0.005);
  }
  const level = new Group();
  level.position.set(0, 0.048, -ID / 2);
  level.add(put(cardBox(0.08, 0.016, 0.022, C.wood, 0.1), { material: gold }));
  const bubble = new Mesh(new CylinderGeometry(0.006, 0.006, 0.05, 10), new MeshStandardMaterial({ color: 0xd8e86a, emissive: 0x506010, transparent: true, opacity: 0.85 }));
  bubble.rotation.z = Math.PI / 2;
  bubble.position.y = 0.01;
  level.add(bubble);
  islandTray.add(level);
  g.add(islandTray);
  const islandSlot = new Group();
  islandSlot.position.set(0, 0.012, 0);
  islandTray.add(islandSlot);
  items.push({ id: 'island', name: '窗外的那座岛', hint: '点一下，走进去', obj: islandTray });

  // 台灯：叠圈的底座、两节灰纸板条的臂（关节是铆钉）、卷锥的灯罩。
  const lampG = new Group();
  lampG.position.set(0.88, TABLE_Y, 0.86);
  lampG.add(
    stackRound(
      [
        [0, 0.07],
        [0.012, 0.065],
        [0.02, 0.03],
        [0.03, 0.018],
      ],
      0.005,
      0xc99d4e,
      { mats: gold },
    ),
  );
  const arm = (a: Vector3, b: Vector3): Mesh => {
    const m = cardBox(0.016, a.distanceTo(b), 0.01, 0xc99d4e, 0.2);
    m.material = gold;
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(V3(0, 1, 0), b.clone().sub(a).normalize());
    return m;
  };
  const j1 = V3(0, 0.03, 0);
  const j2 = V3(-0.04, 0.32, -0.05);
  const j3 = V3(-0.2, 0.42, -0.18);
  lampG.add(arm(j1, j2), arm(j2, j3));
  for (const j of [j1, j2, j3]) lampG.add(put(tack(0.01), { position: j.clone().add(V3(0, 0, 0.007)) }));
  const head = new Group();
  head.position.copy(j3);
  const shade = rolled(0.08, 0.03, 0.1, 0.003, 0xc99d4e, 22);
  (shade.children[0] as Mesh).material = gold[0]!;
  shade.rotation.set(Math.PI + 0.5, 0, -0.35);
  shade.position.y = 0.02;
  head.add(shade);
  const bulbM = new Mesh(new SphereGeometry(0.025, 12, 8), new MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffd49a, emissiveIntensity: 2 }));
  bulbM.position.set(0.01, -0.06, 0.02);
  head.add(bulbM);
  lampG.add(head);
  const lamp = new SpotLight(0xffcf94, 2.2, 3, 0.9, 0.7, 1.6);
  lamp.position.copy(j3).add(V3(0.01, -0.06, 0.02));
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0005;
  lamp.shadow.normalBias = 0.01;
  lampG.add(lamp);
  lamp.target.position.set(0.88 - 0.55, TABLE_Y, 0.86 - 0.25);
  g.add(lampG, lamp.target);
  const nod = new Pendulum(0.12, 3);
  swings.push({ p: nod, o: head, axis: 'z' });
  items.push({
    id: 'lamp',
    name: '台灯',
    hint: '点一下开、关',
    obj: lampG,
    act: () => {
      lamp.visible = !lamp.visible;
      (bulbM.material as MeshStandardMaterial).emissiveIntensity = lamp.visible ? 2 : 0.05;
      nod.kick(2.5);
    },
  });

  // ———— 抽屉墙（前人的设计）：每只抽屉都能拉出来，里面竖着一排卡 ————
  const wx0 = -0.58;
  const wx1 = 0.3;
  const wy0 = 1.55;
  const wy1 = 2.22;
  const wd = 0.26;
  box(wx1 - wx0 + 0.04, wy1 - wy0 + 0.04, wd, C.wood, (wx0 + wx1) / 2, (wy0 + wy1) / 2, ZW - wd / 2, 'wood', 0.5);
  const cols = 4;
  const rows = 3;
  const cw = (wx1 - wx0) / cols;
  const ch = (wy1 - wy0) / rows;
  const labelTex = canvasTex(128, 64, (c) => {
    c.fillStyle = '#f2ead8';
    c.fillRect(0, 0, 128, 64);
    c.fillStyle = 'rgba(60,40,30,0.6)';
    c.fillRect(20, 26, 88, 6);
    c.fillRect(20, 38, 60, 6);
  });
  const labelMat = new MeshStandardMaterial({ map: labelTex, roughness: 1 });
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      const dr = new Group();
      const fx = wx0 + cw * (c + 0.5);
      const fy = wy0 + ch * (r + 0.5);
      dr.add(put(cardBox(cw - 0.016, ch - 0.016, 0.02, [C.woodLight, 0xb98a5a, 0xc8a070][(c + r) % 3]!, 0.4, 'wood'), { position: V3(0, 0, -0.01) }));
      // 抽屉的盒身（卡纸折的）和里面竖着的一排卡。
      dr.add(put(cardBox(cw - 0.03, 0.01, wd - 0.03, 0xd9b48a, 0.3, 'kraft'), { position: V3(0, -ch * 0.35, (wd - 0.03) / 2) }));
      for (const sx of [-1, 1]) dr.add(put(cardBox(0.008, ch * 0.5, wd - 0.03, 0xd9b48a, 0.3, 'kraft'), { position: V3(sx * (cw / 2 - 0.02), -ch * 0.12, (wd - 0.03) / 2) }));
      for (let k = 0; k < 6; k++) {
        const cm = printed(0.14, 0.11, 0.0015, cardFace(k + c + r, k % 2 ? '#efe6cf' : '#e6d9bc'), 0xefe6cf, true);
        cm.scale.setScalar(0.85);
        cm.position.set(0, -ch * 0.33, 0.03 + k * 0.03);
        cm.rotation.x = -0.15 - k * 0.02;
        dr.add(cm);
      }
      // 铜的标签框（金卡纸框）、标签、一颗圆把手。
      const frameZ = -0.022;
      dr.add(strip([V3(-0.035, 0.015, frameZ), V3(0.035, 0.015, frameZ), V3(0.035, 0.045, frameZ), V3(-0.035, 0.045, frameZ)], V3(0, 0, -1), 0.008, 0.003, true));
      const label = new Mesh(slab([V3(0.031, 0.019, frameZ - 0.0005), V3(-0.031, 0.019, frameZ - 0.0005), V3(-0.031, 0.041, frameZ - 0.0005), V3(0.031, 0.041, frameZ - 0.0005)], 0.0005, [], true), [labelMat, paperMaterial(0xf2ead8, { edge: true })]);
      dr.add(label);
      dr.add(put(tack(0.011), { position: V3(0, -0.02, frameZ), rotation: { x: Math.PI } }));
      dr.position.set(fx, fy, ZW - wd);
      g.add(dr);
      const s = sprung(0, (x) => (dr.position.z = ZW - wd - x), 0, 0.22);
      items.push({ id: `wdrawer${c}${r}`, name: '抽屉', hint: '前人设计过的动物：拉开看看', obj: dr, act: () => (s.target = s.target > 0.05 ? 0 : 0.17) });
      if ((c === 1 && r === 0) || (c === 2 && r === 1)) s.target = s.x = 0.15;
    }

  // 八角花窗在车里的一圈木框（两层纸板，叠出来的框）。
  for (const [rOut, rIn, z] of [
    [0.34, 0.27, 0],
    [0.31, 0.27, -0.012],
  ] as const) {
    const fr = mesh(flat(ngon(8, rOut, Math.PI / 8), 0.012, [ngon(8, rIn, Math.PI / 8)]), card(C.wood, 0.4, 'wood'));
    fr.rotation.y = Math.PI;
    fr.position.set(0.62, 1.86, ZW + z);
    add(fr);
  }

  // ———— 晾绳和专利卡：一根麻绳两头挂在铜钩上，卡片用木夹子夹着，会晃 ————
  const pins: Group[] = [];
  {
    const a = V3(XR + 0.18, 2.46, 0.55);
    const b = V3(1.08, 2.46, 0.55);
    const curve = hang(a, b, 0.12, 24);
    add(twine(curve, 0.006));
    for (const p of [a, b]) add(put(hook(V3(0, 0, -0.05)), { position: p.clone().add(V3(0, 0, 0.05)) }));
    const n = 11;
    for (let i = 0; i < n; i++) {
      const t = 0.06 + (i / (n - 1)) * 0.88;
      const p = curve.getPoint(t);
      const cg = new Group();
      cg.position.copy(p);
      const tint = ['#efe6cf', '#e8dcbf', '#f2ead8'][i % 3]!;
      const c = printed(0.12, 0.16, 0.0015, cardFace(i, tint), 0xefe6cf, true);
      c.rotation.y = Math.PI;
      c.position.y = -0.17;
      // 木夹子：两片小木条夹着，一圈铜丝弹簧。
      const pin = new Group();
      for (const s of [-1, 1]) pin.add(put(cardBox(0.012, 0.05, 0.005, C.woodLight, 0.2, 'wood'), { position: V3(0, -0.01, s * 0.004) }));
      pin.add(put(new Mesh(new CylinderGeometry(0.004, 0.004, 0.014, 8), brassMat), { rotation: { x: Math.PI / 2 }, position: V3(0, -0.005, 0) }));
      cg.add(c, pin);
      cg.rotation.y = (rnd() - 0.5) * 0.3;
      cg.userData['view'] = [0, Math.PI, 0];
      cg.userData['center'] = [0, -0.09, 0];
      g.add(cg);
      pins.push(cg);
      const pen = new Pendulum(0.17, 0.9);
      pen.kick((rnd() - 0.5) * 1.5);
      swings.push({ p: pen, o: cg, axis: 'z' });
      items.push({ id: `patent${i}`, name: '专利卡', hint: '你拿到的专利：拿下来看看', obj: cg, inspect: true, act: () => pen.kick(3) });
    }
  }

  // ———— 驾驶室 ————
  for (const s of [1, -1]) {
    const seat = new Group();
    seat.position.set(1.58, Y0, s * 0.46);
    seat.add(put(cardBox(0.4, 0.3, 0.42, C.chassis, 0.3), { position: V3(0, 0.15, 0) }));
    // 坐垫和靠背：灰绿的毛毡一层层叠，边上收圆，几颗包扣（铆钉）。
    seat.add(put(block(0.46, 0.1, 0.46, 0x7f948e, 6, 0.03, 'kraft'), { position: V3(0, 0.35, 0) }));
    const back = new Group();
    back.position.set(-0.2, 0.4, 0);
    back.rotation.z = 0.16;
    const cushion = block(0.5, 0.09, 0.44, 0x7f948e, 6, 0.03, 'kraft');
    cushion.rotation.z = Math.PI / 2;
    cushion.position.set(0, 0.27, 0);
    back.add(cushion);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) back.add(put(tack(0.012), { position: V3(0.046, 0.17 + r * 0.2, -0.1 + c * 0.2), rotation: { y: Math.PI / 2 } }));
    seat.add(back);
    g.add(seat);
  }
  // 方向盘：两层金卡纸圆环叠起来、四根辐条，中间一颗大铆钉；能转。
  const wheel = new Group();
  wheel.position.set(1.86, 1.42, 0.46);
  wheel.rotation.z = -0.9;
  wheel.rotation.y = Math.PI / 2;
  const wheelSpin = new Group();
  wheel.add(wheelSpin);
  for (const z of [0, 0.008]) wheelSpin.add(put(mesh(flat(ngon(24, 0.18, 0), 0.008, [ngon(24, 0.15, 0)]), gold), { position: V3(0, 0, z) }));
  for (let k = 0; k < 4; k++) {
    const sp = cardBox(0.15, 0.022, 0.008, 0xc99d4e);
    sp.material = gold;
    sp.position.set(Math.cos((k * Math.PI) / 2 + Math.PI / 4) * 0.075, Math.sin((k * Math.PI) / 2 + Math.PI / 4) * 0.075, 0.004);
    sp.rotation.z = (k * Math.PI) / 2 + Math.PI / 4;
    wheelSpin.add(sp);
  }
  wheelSpin.add(put(tack(0.03), { position: V3(0, 0, 0.01) }));
  add(wheel, put(rolled(0.015, 0.015, 0.3, 0.003, 0x5b544d, 10), { position: V3(1.86, 1.42, 0.46), rotation: { z: 2.4 } }));
  const steer = sprung(0, (x) => (wheelSpin.rotation.z = x), -4, 4, 30, 5);
  const dash = cardBox(0.16, 0.2, 1.8, C.woodDark, 0.5, 'wood');
  dash.position.set(2.0, 1.28, 0);
  add(dash);
  const gaugeTex = canvasTex(128, 128, (c) => {
    c.fillStyle = '#f4ecd8';
    c.fillRect(0, 0, 128, 128);
    c.strokeStyle = '#3a2618';
    c.lineWidth = 4;
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.8 + (i / 8) * Math.PI * 1.4;
      c.beginPath();
      c.moveTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44);
      c.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56);
      c.stroke();
    }
    c.strokeStyle = '#b8452f';
    c.beginPath();
    c.moveTo(64, 64);
    c.lineTo(96, 40);
    c.stroke();
  });
  const gaugeMat = new MeshStandardMaterial({ map: gaugeTex, roughness: 0.7 });
  for (const z of [0.3, 0.6, -0.25]) {
    const gg = new Group();
    gg.position.set(1.915, 1.33, z);
    gg.rotation.set(0, -Math.PI / 2, 0);
    gg.rotateX(-0.4);
    gg.add(new Mesh(slab([V3(-0.045, -0.045, 0.002), V3(0.045, -0.045, 0.002), V3(0.045, 0.045, 0.002), V3(-0.045, 0.045, 0.002)], 0.002, [], true), [gaugeMat, gaugeMat]));
    gg.add(mesh(flat(ngon(20, 0.052, 0), 0.006, [ngon(20, 0.043, 0)]), gold));
    add(gg);
  }
  items.push({
    id: 'wheel',
    name: '方向盘',
    hint: '转一转（勾勾会摇铃）',
    obj: wheel,
    act: () => {
      steer.target = steer.target > 0 ? -2.2 : 2.2;
      window.setTimeout(() => (steer.target = 0), 700);
    },
  });

  // ———— 车尾 ————
  // 工具挂袋：一块帆布用四颗图钉钉在墙上，六个口袋（纸胶带贴的口袋边）。
  const org = new Group();
  org.position.set(-1.68, 1.72, ZW - 0.012);
  org.add(put(cardBox(0.56, 0.72, 0.006, C.canvas, 0.4, 'kraft'), { position: V3(0, 0, 0) }));
  for (const [x, y] of [
    [-0.25, 0.33],
    [0.25, 0.33],
    [-0.25, -0.33],
    [0.25, -0.33],
  ] as const)
    org.add(put(tack(0.012, 0xb8452f), { position: V3(x, y, -0.003), rotation: { x: Math.PI } }));
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) {
      const px = -0.18 + c * 0.18;
      const py = -0.22 + r * 0.32;
      const pocket = mesh(flat([new Vector2(-0.075, -0.09), new Vector2(0.075, -0.09), new Vector2(0.08, 0.06), new Vector2(-0.08, 0.06)], 0.004), card(0xd9ccb0, 0.3, 'kraft'));
      pocket.rotation.y = Math.PI;
      pocket.position.set(px, py, -0.004);
      org.add(pocket);
      org.add(tape(V3(px - 0.08, py + 0.058, -0.009), V3(px + 0.08, py + 0.058, -0.009), V3(0, 0, -1), 0.018, c * 3 + r));
      const k = (c + r * 3) % 4;
      const handle = rolled(0.011, 0.011, 0.1, 0.003, [0xb8452f, C.woodLight, 0x2f5a8a, 0x3e6b3a][k]!, 8, k === 1 ? 'wood' : 'card');
      handle.position.set(px - 0.025, py + 0.02, -0.03);
      handle.rotation.z = 0.08;
      org.add(handle);
      const tip = rolled(0.004, 0.001, 0.08, 0.001, 0x8a9090, 6);
      tip.position.set(px + 0.03, py + 0.0, -0.03);
      org.add(tip);
    }
  g.add(org);
  items.push({ id: 'tools', name: '工具挂袋', hint: '剪刀、锥子、镊子……拼装用的', obj: org });
  // 两只铜钩：一只帆布包（提手是麻绳）、一卷麻绳。
  for (const [x, kind] of [
    [-1.28, 0],
    [-1.08, 1],
  ] as const) {
    add(put(hook(V3(0, 0, -0.06)), { position: V3(x, 2.15, ZW) }));
    if (kind === 0) {
      const bag = new Group();
      bag.position.set(x, 1.82, ZW - 0.07);
      bag.add(block(0.2, 0.24, 0.06, 0xb79c74, 5, 0.008, 'kraft'));
      bag.children[0]!.rotation.x = Math.PI / 2;
      bag.add(put(cardBox(0.2, 0.1, 0.004, 0xa88c64, 0.3, 'kraft'), { position: V3(0, 0.08, -0.034) }));
      bag.add(twine(new CatmullRomCurve3([V3(-0.08, 0.11, -0.01), V3(-0.03, 0.3, -0.01), V3(0.03, 0.3, -0.01), V3(0.08, 0.11, -0.01)]), 0.007));
      bag.add(put(tack(0.01), { position: V3(0, 0.05, -0.036), rotation: { x: Math.PI } }));
      g.add(bag);
      const sw = new Pendulum(0.33, 1.1);
      swings.push({ p: sw, o: bag, axis: 'x' });
      items.push({ id: 'bag', name: '帆布包', hint: '碰一下', obj: bag, act: () => sw.kick(2) });
    } else {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 180; i++) {
        const a = (i / 180) * Math.PI * 2 * 5;
        const rr = 0.07 + (i % 36) * 0.0004;
        pts.push(V3(x + Math.cos(a) * rr * 0.9, 1.98 + Math.sin(a) * rr * 1.3, ZW - 0.05 - (i / 180) * 0.04));
      }
      add(twine(new CatmullRomCurve3(pts), 0.008, 40));
    }
  }
  // 搁板：两只三角托（纸板），水壶、两只杯子、两只罐子。
  box(0.5, 0.025, 0.2, C.woodLight, -0.95, 1.38, ZW - 0.1, 'wood', 0.5);
  for (const x of [-1.15, -0.75]) {
    const brk = mesh(flat([new Vector2(0, 0), new Vector2(0.16, 0), new Vector2(0, -0.14)], 0.015), card(C.wood, 0.3, 'wood'));
    brk.rotation.y = Math.PI / 2;
    brk.position.set(x, 1.367, ZW);
    add(brk);
  }
  // 水壶：灰卡纸叠圈的壶身、卷锥的壶嘴、一片剪出来的把手、叠圈的壶盖钮；点它烧水，冒热气。
  const kettle = new Group();
  kettle.position.set(-1.08, 1.393, ZW - 0.1);
  kettle.add(
    stackRound(
      [
        [0, 0.06],
        [0.02, 0.072],
        [0.05, 0.075],
        [0.08, 0.066],
        [0.1, 0.045],
        [0.115, 0.02],
        [0.125, 0.012],
        [0.135, 0.006],
      ],
      0.005,
      0xa9b0ad,
      { mats: [new MeshStandardMaterial({ color: 0xa9b0ad, metalness: 0.5, roughness: 0.45 }), paperMaterial(0xdedad0, { edge: true })] },
    ),
  );
  const spout = rolled(0.016, 0.007, 0.09, 0.002, 0xa9b0ad, 10);
  spout.position.set(0.06, 0.04, 0);
  spout.rotation.z = -0.8;
  kettle.add(spout);
  const handleCut = mesh(
    flat(
      (() => {
        const o: Vector2[] = [];
        for (let i = 0; i <= 12; i++) {
          const a = Math.PI * (i / 12);
          o.push(new Vector2(Math.cos(a) * 0.05, Math.sin(a) * 0.045));
        }
        for (let i = 12; i >= 0; i--) {
          const a = Math.PI * (i / 12);
          o.push(new Vector2(Math.cos(a) * 0.04, Math.sin(a) * 0.035));
        }
        return o;
      })(),
      0.006,
    ),
    card(0x2a2420, 0.2),
  );
  handleCut.position.set(0, 0.11, -0.003);
  kettle.add(handleCut);
  add(kettle);
  let boiling = true;
  items.push({ id: 'kettle', name: '水壶', hint: '烧一壶水（点一下开、关）', obj: kettle, act: () => (boiling = !boiling) });
  for (const [x, c] of [
    [-0.92, 0xf2ead8],
    [-0.84, 0x9fb5b8],
  ] as const) {
    const mug = rolled(0.03, 0.032, 0.07, 0.004, c, 18);
    mug.position.set(x, 1.393, ZW - 0.12);
    mug.add(put(mesh(flat(ngon(18, 0.03), 0.004), card(c, 0.2)), { rotation: { x: -Math.PI / 2 }, position: V3(0, 0.002, 0) }));
    const hc = mesh(flat([...ngon(12, 0.022).filter((p) => p.x > -0.005)], 0.006, []), card(c, 0.2));
    hc.position.set(0.03, 0.035, 0);
    mug.add(hc);
    add(mug);
  }
  for (let i = 0; i < 2; i++) {
    const jar = rolled(0.028, 0.028, 0.09, 0.003, i ? 0x8a6a44 : 0xc9a34a, 16, 'kraft');
    jar.position.set(-0.78, 1.393, ZW - 0.04 - i * 0.07);
    jar.add(
      put(
        stackRound(
          [
            [0, 0.03],
            [0.012, 0.03],
            [0.016, 0.02],
          ],
          0.004,
          0xb48a5a,
          { kind: 'kraft' },
        ),
        { position: V3(0, 0.09, 0) },
      ),
    );
    add(jar);
  }
  // 车尾地上：叠起来的木箱。
  for (const [x, y, z, w, h, d] of [
    [-1.82, Y0 + 0.16, 0.7, 0.36, 0.32, 0.4],
    [-1.82, Y0 + 0.44, 0.72, 0.3, 0.24, 0.34],
    [-1.45, Y0 + 0.12, 0.72, 0.26, 0.24, 0.3],
  ] as const)
    add(put(crateMesh(w, h, d), { position: V3(x, y, z) }));

  // 出诊皮箱：灰纸板拼的箱子（皮色的纸裱面），铜合页、两根皮带、搭扣；点它，盖子绕合页翻开，里面是兽医的东西。
  const suitcase = new Group();
  suitcase.position.set(-1.55, Y0, -0.35);
  suitcase.rotation.y = 0.35;
  const SW = 0.5;
  const SD = 0.32;
  const SH = 0.16;
  const leather = (w: number, h: number, d: number, x: number, y: number, z: number): Mesh => put(cardBox(w, h, d, C.leather, 0.25, 'kraft'), { position: V3(x, y, z) });
  suitcase.add(leather(SW, 0.012, SD, 0, 0.006, 0), leather(SW, SH, 0.012, 0, SH / 2, SD / 2 - 0.006), leather(SW, SH, 0.012, 0, SH / 2, -SD / 2 + 0.006), leather(0.012, SH, SD - 0.024, SW / 2 - 0.006, SH / 2, 0), leather(0.012, SH, SD - 0.024, -SW / 2 + 0.006, SH / 2, 0));
  // 箱里：一卷绷带（卷筒）、两只药瓶（叠圈）、一把镊子、几块纱布。
  suitcase.add(put(rolled(0.04, 0.04, 0.1, 0.03, 0xf2ece0, 16), { position: V3(-0.12, 0.05, 0.02), rotation: { z: Math.PI / 2 } }));
  for (const [x, c] of [
    [0.05, 0x8a5a3a],
    [0.12, 0x5a7a8a],
  ] as const)
    suitcase.add(
      put(
        stackRound(
          [
            [0, 0.025],
            [0.06, 0.025],
            [0.07, 0.012],
            [0.09, 0.012],
          ],
          0.006,
          c,
        ),
        { position: V3(x, 0.012, -0.04) },
      ),
    );
  for (let i = 0; i < 3; i++) suitcase.add(put(cardBox(0.09, 0.006, 0.09, 0xf4f0e6, 0.2), { position: V3(0.1, 0.015 + i * 0.006, 0.07), rotation: { y: i * 0.3 } }));
  const lid = new Group();
  lid.position.set(0, SH, -SD / 2);
  lid.add(leather(SW, 0.012, SD, 0, 0.006 + 0.0, SD / 2), leather(SW, 0.05, 0.012, 0, -0.019, SD - 0.006), leather(0.012, 0.05, SD, SW / 2 - 0.006, -0.019, SD / 2), leather(0.012, 0.05, SD, -SW / 2 + 0.006, -0.019, SD / 2));
  for (const sx of [-0.15, 0.15]) {
    lid.add(strip([V3(sx, 0.012, 0.0), V3(sx, 0.012, SD)], V3(0, 1, 0), 0.03, 0.003, false, card(0x5a3220, 0.2, 'kraft')));
    lid.add(put(cardBox(0.034, 0.03, 0.008, 0, 0.1), { material: gold, position: V3(sx, -0.01, SD + 0.004) }));
  }
  // 箱盖上一块铜牌，刻一只小狗。
  lid.add(put(mesh(flat(dogOutline().map((p) => new Vector2(p.x * 0.07, p.y * 0.07)), 0.003), [brassMat, brassDark]), { rotation: { x: -Math.PI / 2 }, position: V3(0, 0.013, SD / 2) }));
  suitcase.add(lid);
  for (const sx of [-0.16, 0.16]) suitcase.add(put(hinge(0.07, 0.025, 0.003), { position: V3(sx, SH, -SD / 2 - 0.004), rotation: { z: Math.PI / 2 } }));
  // 提手：一段皮带弯成的拱，两头钉在箱盖的前沿。
  lid.add(put(strip([V3(-0.07, 0.012, SD + 0.0), V3(-0.06, 0.06, SD + 0.0), V3(0.06, 0.06, SD + 0.0), V3(0.07, 0.012, SD + 0.0)], V3(0, 0, 1), 0.02, 0.006, false, card(0x5a3220, 0.2, 'kraft')), {}));
  const lidS = sprung(0, (x) => (lid.rotation.x = -x), 0, 1.95, 70, 9);
  g.add(suitcase);
  items.push({ id: 'vet', name: '出诊皮箱', hint: '兽医的东西：打开看看', obj: suitcase, act: () => (lidS.target = lidS.target > 0.5 ? 0 : 1.85) });

  // 门边一只碟子，一叠信（勾勾从嘴里叼进来的）；最上面那封能拿起来拆。
  const mail = new Group();
  mail.position.set(-1.78, Y0, -0.72);
  mail.add(
    stackRound(
      [
        [0, 0.1],
        [0.012, 0.13],
        [0.02, 0.135],
      ],
      0.004,
      0xe9ecea,
      { hole: (y) => (y > 0.006 ? 0.12 : 0) },
    ),
  );
  const envTex = canvasTex(256, 160, (c) => {
    c.fillStyle = '#f6efdc';
    c.fillRect(0, 0, 256, 160);
    c.strokeStyle = '#c9b48a';
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(128, 92);
    c.lineTo(256, 0);
    c.stroke();
    c.fillStyle = '#b8452f';
    c.beginPath();
    c.arc(128, 92, 16, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#d9cdb3';
    c.fillRect(196, 16, 40, 48);
  });
  const envMat = new MeshStandardMaterial({ map: envTex, roughness: 0.95 });
  let topLetter: Group | null = null;
  for (let i = 0; i < 4; i++) {
    const e = new Group();
    e.add(printed(0.18, 0.12, 0.003, envMat, 0xf6efdc));
    e.position.set((rnd() - 0.5) * 0.03, 0.012 + i * 0.004, (rnd() - 0.5) * 0.03);
    e.rotation.y = (rnd() - 0.5) * 0.6;
    e.userData['view'] = [Math.PI / 2, 0, 0];
    mail.add(e);
    topLetter = e;
  }
  g.add(mail);
  items.push({ id: 'mail', name: '一封来信', hint: '有人求助：拿起来拆开', obj: topLetter!, inspect: true });

  // 地上：一只靴子（切片叠出来的）、一只铜水碗（给来串门的动物）、几个泥爪印。
  const bootOutline: Vector2[] = [new Vector2(-0.08, 0), new Vector2(0.14, 0), new Vector2(0.16, 0.03), new Vector2(0.12, 0.07), new Vector2(0.04, 0.09), new Vector2(0.03, 0.3), new Vector2(-0.08, 0.3), new Vector2(-0.09, 0.06)];
  const boot = slices(bootOutline, 7, 0.014, 0x6a4a32, (k) => 1 - Math.pow(Math.abs(k), 3) * 0.25, 'kraft');
  boot.position.set(-0.95, Y0, -0.1);
  boot.rotation.y = 0.7;
  add(boot);
  const wbowl = stackRound(
    [
      [0, 0.08],
      [0.025, 0.1],
      [0.05, 0.115],
    ],
    0.005,
    C.copper,
    { hole: (y) => (y > 0.008 ? 0.095 + y * 0.3 : 0), mats: [copperMat, paperMaterial(0xe6c9a8, { edge: true })] },
  );
  wbowl.position.set(-0.6, Y0, -0.42);
  add(wbowl);
  add(put(new Mesh(new CylinderGeometry(0.098, 0.098, 0.002, 24), new MeshStandardMaterial({ color: 0x9fc2c4, roughness: 0.05, metalness: 0.2 })), { position: V3(-0.6, Y0 + 0.038, -0.42) }));
  const pawMat = new MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const paw = new Group();
    paw.position.set(-1.85 + i * 0.2, Y0 + 0.002, -0.62 + (i % 2) * 0.12);
    paw.add(new Mesh(new CylinderGeometry(0.022, 0.022, 0.001, 10), pawMat));
    for (let k = 0; k < 4; k++) {
      const a = -0.9 + k * 0.6;
      paw.add(put(new Mesh(new CylinderGeometry(0.009, 0.009, 0.001, 8), pawMat), { position: V3(Math.cos(a) * 0.035, 0, Math.sin(a) * 0.035) }));
    }
    paw.rotation.y = -Math.PI / 2;
    add(paw);
  }

  // 椅子：厚纸板条做的四条方腿、叠层的座板、靠背两根立柱和三根横条；点它坐下。
  const chair = new Group();
  chair.position.set(0.15, Y0, 0.0);
  chair.rotation.y = 0.0;
  chair.add(put(block(0.42, 0.04, 0.4, C.wood, 3, 0.004, 'wood'), { position: V3(0, 0.46, 0) }));
  for (const [x, z] of [
    [-0.18, -0.17],
    [0.18, -0.17],
    [-0.18, 0.17],
    [0.18, 0.17],
  ] as const)
    chair.add(put(cardBox(0.034, 0.44, 0.034, C.wood, 0.4, 'wood'), { position: V3(x, 0.22, z) }));
  for (const x of [-0.18, 0.18]) chair.add(put(cardBox(0.034, 0.52, 0.03, C.wood, 0.4, 'wood'), { position: V3(x, 0.74, -0.18), rotation: { x: -0.08 } }));
  for (const y of [0.66, 0.8, 0.94]) chair.add(put(cardBox(0.36, 0.05, 0.016, C.woodLight, 0.4, 'wood'), { position: V3(0, y, -0.2 - (y - 0.48) * 0.08) }));
  for (const z of [-0.17, 0.17]) chair.add(put(cardBox(0.34, 0.025, 0.02, C.wood, 0.4, 'wood'), { position: V3(0, 0.15, z) }));
  g.add(chair);
  items.push({ id: 'chair', name: '椅子', hint: '坐下来，在工作台前干活', obj: chair });

  // 顶灯：一根麻绳吊着卷筒的灯座、一颗灯泡；旁边一根拉绳，拉一下开、关，灯会晃。
  const bulbL = new PointLight(0xffd7a0, 0.9, 4, 1.6);
  const bulbG = new Group();
  bulbG.position.set(-0.75, 2.63, 0.1);
  bulbG.add(twine(hang(V3(0, 0, 0), V3(0, -0.33, 0), 0, 4), 0.004));
  bulbG.add(put(rolled(0.026, 0.02, 0.06, 0.003, 0xc99d4e, 14), { position: V3(0, -0.39, 0) }));
  const bulbMesh = new Mesh(new SphereGeometry(0.04, 14, 10), new MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffcf8a, emissiveIntensity: 1.6 }));
  bulbMesh.position.set(0, -0.42, 0);
  bulbL.position.set(0, -0.47, 0);
  bulbG.add(bulbMesh, bulbL);
  bulbG.add(twine(hang(V3(0.02, -0.38, 0), V3(0.03, -0.75, 0), 0, 4), 0.0025));
  bulbG.add(put(stackRound([[0, 0.012], [0.02, 0.012], [0.03, 0.004]], 0.005, 0xc99d4e, { mats: gold }), { position: V3(0.03, -0.78, 0) }));
  g.add(bulbG);
  const bulbSwing = new Pendulum(0.45, 0.6);
  swings.push({ p: bulbSwing, o: bulbG, axis: 'x' });
  items.push({
    id: 'bulb',
    name: '顶灯的拉绳',
    hint: '拉一下开、关',
    obj: bulbG,
    act: () => {
      bulbL.visible = !bulbL.visible;
      (bulbMesh.material as MeshStandardMaterial).emissiveIntensity = bulbL.visible ? 1.6 : 0.05;
      bulbSwing.kick(1.2);
    },
  });

  g.add(rv.build());
  // 合批：能点的东西各自一组；会晃、会动的不合进去。
  for (const it of items) it.obj.userData['noBake'] = true;
  bake(g);
  for (const it of items) if (!it.inspect && !it.act) bake(it.obj);

  // 热气。
  const steam: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new Mesh(new SphereGeometry(0.02, 8, 6), new MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }));
    s.userData['ph'] = i / 3;
    steam.push(s);
    add(s);
  }
  return {
    items,
    islandSlot,
    lamp,
    bulb: bulbL,
    obstacles: [
      [tx0 - 0.04, tz0 - 0.02, tx1, 1.0],
      [-2.05, 0.45, -1.25, 1.0],
      [-1.8, -0.55, -1.3, -0.15],
      [-1.8, 0.62, -0.7, 1.0],
      [1.3, -0.75, 2.2, 0.75],
      [-0.32, -0.25, 0.35, 0.25],
      [-1.8, 0.6, -0.8, 1.0],
    ],
    seat: { eye: V3(0.15, 1.36, 0.08), look: V3(0.12, 1.12, 0.75) },
    jostle(v: number): void {
      for (const s of swings) s.p.kick(v * (0.5 + Math.random()));
    },
    update(dt: number, t: number): void {
      for (const sp of springs) {
        sp.s.step(dt);
        sp.apply(sp.s.clamp(sp.lo, sp.hi));
      }
      for (const s of swings) {
        const a = s.p.step(dt);
        if (s.axis === 'z') s.o.rotation.z = a;
        else s.o.rotation.x = a;
      }
      for (const s of steam) {
        const ph = (t * 0.35 + (s.userData['ph'] as number)) % 1;
        s.visible = boiling;
        s.position.set(-0.96 + ph * 0.05, 1.5 + ph * 0.25, ZW - 0.1);
        s.scale.setScalar(0.6 + ph * 2);
        (s.material as MeshStandardMaterial).opacity = Math.sin(ph * Math.PI) * 0.35;
      }
    },
  };
}

function capsule(len: number, r: number): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI;
    out.push(new Vector2(len / 2 + Math.cos(a) * r, Math.sin(a) * r));
  }
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI / 2 + (i / 8) * Math.PI;
    out.push(new Vector2(-len / 2 + Math.cos(a) * r, Math.sin(a) * r));
  }
  return out;
}

function ellipse(rx: number, ry: number): Vector2[] {
  const out: Vector2[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    out.push(new Vector2(Math.cos(a) * rx, Math.sin(a) * ry));
  }
  return out;
}

/** 木箱：几块横板、四根角柱、一块底板，角上钉着小钉。 */
function crateMesh(w: number, h: number, d: number): Group {
  const g = new Group();
  const slats = 3;
  for (let i = 0; i < slats; i++) {
    const y = -h / 2 + (i + 0.5) * (h / slats);
    for (const [x, z, sw, sd] of [
      [0, -d / 2, w - 0.03, 0.015],
      [0, d / 2, w - 0.03, 0.015],
      [-w / 2, 0, 0.015, d - 0.03],
      [w / 2, 0, 0.015, d - 0.03],
    ] as const)
      g.add(put(cardBox(sw, h / slats - 0.015, sd, i % 2 ? C.woodLight : 0xc8a070, 0.4, 'wood'), { position: V3(x, y, z) }));
  }
  for (const [x, z] of [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ] as const) {
    g.add(put(cardBox(0.03, h, 0.03, C.wood, 0.4, 'wood'), { position: V3(x, 0, z) }));
  }
  g.add(put(cardBox(w, 0.012, d, C.woodDark, 0.4, 'wood'), { position: V3(0, -h / 2 + 0.006, 0) }));
  return g;
}
