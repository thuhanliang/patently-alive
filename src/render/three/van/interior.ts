import { CatmullRomCurve3, CylinderGeometry, DoubleSide, Group, LatheGeometry, Mesh, MeshStandardMaterial, PointLight, SphereGeometry, SpotLight, TorusGeometry, TubeGeometry, Vector2, type Material, type Object3D } from 'three';
import { paperMaterial } from '../paper';
import { C, Rivets, V3, put, brassDark, brassMat, canvasTex, card, cardBox, copperMat, dogOutline, flat, mesh, rng, rod, slab } from './kit';
import { XR } from './body';
import { bake } from './bake';

/**
 * 「阿宝」的里面（2026-11-25）：照 art/incoming/lovart/010/3-mobile/B1-caravan-inside.jpg 的布局。
 * 远墙（+z）：工作台、上面一面抽屉墙、八角花窗；车顶下一根晾绳夹着专利卡；车尾一面帆布工具挂袋、木箱、一只皮箱、门边一碟信。
 * 每一件能碰的东西都登记在 items 里（名字、一句话、对象），外面拿去做悬停和点击。
 */

export interface InteriorItem {
  id: string;
  name: string;
  hint: string;
  obj: Object3D;
}

export interface Interior {
  items: InteriorItem[];
  /** 工作台上装岛的托盘的中心：外面把岛的 A4 纸雕放进来（托盘内框 0.42 × 0.29 米）。 */
  islandSlot: Group;
  /** 台灯和顶灯（夜里更亮）。 */
  lamp: SpotLight;
  bulb: PointLight;
  update(dt: number, t: number): void;
}

const Y0 = 0.565; // 地板面
const ZW = 0.955; // 远墙内面
const TABLE_Y = 1.3;

function wood(c: number, scale = 0.25): Material[] {
  return card(c, scale, 'wood');
}

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
    g.moveTo(cx - 0.22 * s, cy - 0.34 * s);
    g.lineTo(cx - 0.46 * s, cy - 0.46 * s);
    g.lineTo(cx - 0.4 * s, cy - 0.28 * s);
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
  const tex = canvasTex(128, 160, (g) => {
    g.fillStyle = tint;
    g.fillRect(0, 0, 128, 160);
    g.strokeStyle = 'rgba(90,60,30,0.35)';
    g.lineWidth = 2;
    g.strokeRect(8, 8, 112, 144);
    g.fillStyle = '#8a6a44';
    drawAnimal(g, kind, 64, 96, 80);
    g.fillStyle = 'rgba(90,60,30,0.45)';
    for (let i = 0; i < 3; i++) g.fillRect(20, 112 + i * 9, 88 - i * 20, 3);
    g.fillStyle = '#b8452f';
    g.beginPath();
    g.arc(100, 136, 7, 0, Math.PI * 2);
    g.fill();
  });
  return new MeshStandardMaterial({ map: tex, roughness: 0.95 });
}

export function buildInterior(parent: Group, seed: number): Interior {
  const g = new Group();
  parent.add(g);
  const items: InteriorItem[] = [];
  const rv = new Rivets();
  const rnd = rng(seed + 5);
  const add = (...o: Object3D[]): void => {
    for (const x of o) g.add(x);
  };
  const box = (w: number, h: number, d: number, c: number, x: number, y: number, z: number, kind: 'card' | 'wood' | 'kraft' = 'card', scale = 0.3): Mesh => {
    const m = cardBox(w, h, d, c, scale, kind);
    m.position.set(x, y, z);
    g.add(m);
    return m;
  };

  // ———— 地板：一条条木板，缝隙看得见；一块条纹地毯 ————
  const boards = 13;
  for (let i = 0; i < boards; i++) {
    const z = -0.93 + (i + 0.5) * (1.86 / boards);
    const tone = [C.woodLight, 0xb98a5a, 0xc8a070, 0xad7f52][i % 4]!;
    const len = 3.3 - (i % 3) * 0.02;
    box(len, 0.02, 1.86 / boards - 0.008, tone, -0.4 + (i % 2) * 0.01, Y0 - 0.01, z, 'wood', 0.18);
  }
  const rugTex = canvasTex(
    256,
    256,
    (c) => {
      const cols = ['#c9b796', '#9fb3b4', '#e8dcc3', '#b78f6a'];
      for (let y = 0; y < 256; y += 16) {
        c.fillStyle = cols[(y / 16) % 4]!;
        c.fillRect(0, y, 256, 16);
      }
      c.globalAlpha = 0.15;
      for (let i = 0; i < 2000; i++) {
        c.fillStyle = i % 2 ? '#000' : '#fff';
        c.fillRect(Math.random() * 256, Math.random() * 256, 2, 1);
      }
    },
    true,
  );
  const rug = new Mesh(slab([V3(-0.75, Y0 + 0.004, -0.55), V3(0.35, Y0 + 0.004, -0.55), V3(0.35, Y0 + 0.004, 0.25), V3(-0.75, Y0 + 0.004, 0.25)].reverse(), 0.006, [], true), [new MeshStandardMaterial({ map: rugTex, roughness: 1 }), paperMaterial(0xc9b796, { edge: true })]);
  rug.receiveShadow = true;
  add(rug);
  // 流苏。
  for (let i = 0; i < 16; i++) {
    for (const x of [-0.75, 0.35]) add(rod(V3(x, Y0 + 0.006, -0.53 + i * 0.05), V3(x + (x < 0 ? -0.04 : 0.04), Y0 + 0.004, -0.53 + i * 0.05), 0.003, paperMaterial(0xe8dcc3, { kind: 'kraft' })));
  }

  // 轮拱在车里鼓起来的两个盒子。
  box(1.05, 0.3, 0.26, C.creamDark, -1.25, Y0 + 0.15, 0.82);

  // ———— 木肋和车顶的板条 ————
  const woodRib = paperMaterial(C.wood, { kind: 'wood', scale: 0.2 });
  for (const x of [-1.7, -0.9, 0.0, 0.95]) {
    const path = [V3(x, Y0, ZW - 0.01), V3(x, 2.27, ZW - 0.01), V3(x, 2.63, 0.71), V3(x, 2.63, -0.71)];
    for (let i = 0; i < path.length - 1; i++) {
      const m = rod(path[i]!, path[i + 1]!, 0.028, woodRib, 4);
      m.rotation.y += Math.PI / 4;
      add(m);
    }
  }
  for (const z of [-0.45, 0, 0.45]) add(rod(V3(XR + 0.05, 2.62, z), V3(1.15, 2.62, z), 0.02, woodRib, 4));
  // 远墙下半截的护墙板。
  for (let i = 0; i < 20; i++) {
    const x = XR + 0.08 + i * 0.165;
    if (x > 1.15) break;
    box(0.155, 0.7, 0.015, i % 3 ? C.woodLight : 0xb98a5a, x + 0.08, Y0 + 0.35, ZW - 0.01, 'wood', 0.15);
  }

  // ———— 工作台 ————
  const table = new Group();
  g.add(table);
  const tx0 = -0.62;
  const tx1 = 0.98;
  const tz0 = 0.3;
  const top = cardBox(tx1 - tx0, 0.05, ZW - tz0, C.woodLight, 0.2, 'wood');
  top.position.set((tx0 + tx1) / 2, TABLE_Y - 0.025, (tz0 + ZW) / 2);
  table.add(top);
  // 台面前沿的一条黄铜包边。
  table.add(rod(V3(tx0, TABLE_Y - 0.01, tz0 - 0.005), V3(tx1, TABLE_Y - 0.01, tz0 - 0.005), 0.008, brassMat, 6));
  // 左边（靠驾驶室）一组灰蓝的抽屉柜：两列三行。
  const dx0 = 0.32;
  table.add(put(cardBox(tx1 - dx0, TABLE_Y - 0.05 - Y0, ZW - tz0 - 0.02, C.drawer, 0.3), { position: V3((dx0 + tx1) / 2, (Y0 + TABLE_Y - 0.05) / 2, (tz0 + ZW) / 2 + 0.01) }));
  const dw = (tx1 - dx0) / 2;
  const dh = (TABLE_Y - 0.05 - Y0) / 3;
  for (let c = 0; c < 2; c++)
    for (let r = 0; r < 3; r++) {
      const fx = dx0 + dw * (c + 0.5);
      const fy = Y0 + dh * (r + 0.5);
      const front = cardBox(dw - 0.025, dh - 0.025, 0.02, r === 2 ? C.blue : C.drawer, 0.3);
      front.position.set(fx, fy, tz0 + 0.005);
      table.add(front);
      const pull = new Mesh(new TorusGeometry(0.022, 0.006, 6, 14, Math.PI), brassMat);
      pull.position.set(fx, fy + 0.01, tz0 - 0.01);
      pull.rotation.z = Math.PI;
      table.add(pull);
      rv.add(V3(fx - 0.025, fy + 0.01, tz0 - 0.006), V3(0, 0, -1), 0.007);
      rv.add(V3(fx + 0.025, fy + 0.01, tz0 - 0.006), V3(0, 0, -1), 0.007);
    }
  // 右边是空的：两只木箱、一摞纸。
  for (const [x, y, w, h] of [
    [-0.42, Y0 + 0.13, 0.32, 0.26],
    [-0.08, Y0 + 0.11, 0.26, 0.22],
  ] as const) {
    const crate = crateMesh(w, h, 0.36);
    crate.position.set(x, y, 0.72);
    table.add(crate);
  }
  for (let i = 0; i < 5; i++) {
    const sheet = cardBox(0.3, 0.006, 0.22, i % 2 ? 0xf2ead8 : 0xe9dfc8, 0.15);
    sheet.position.set(-0.4 + rnd() * 0.01, Y0 + 0.3 + i * 0.007, 0.72 + rnd() * 0.01);
    sheet.rotation.y = (rnd() - 0.5) * 0.1;
    table.add(sheet);
  }
  // 桌腿（右边两根）。
  for (const z of [tz0 + 0.04, ZW - 0.04]) table.add(put(cardBox(0.05, TABLE_Y - 0.05 - Y0, 0.05, C.wood, 0.2, 'wood'), { position: V3(tx0 + 0.03, (Y0 + TABLE_Y - 0.05) / 2, z) }));

  // ———— 台面上的东西 ————
  // 零件盘：木框、毛毡底，三乘三的格子，每格里几片纸偶零件。
  const tray = new Group();
  tray.position.set(-0.22, TABLE_Y, 0.62);
  const TW = 0.46;
  const TD = 0.32;
  tray.add(put(cardBox(TW, 0.012, TD, C.felt, 0.15, 'kraft'), { position: V3(0, 0.006, 0) }));
  for (const [x, z, w, d] of [
    [0, -TD / 2, TW + 0.02, 0.02],
    [0, TD / 2, TW + 0.02, 0.02],
    [-TW / 2, 0, 0.02, TD],
    [TW / 2, 0, 0.02, TD],
    [-TW / 6, 0, 0.008, TD],
    [TW / 6, 0, 0.008, TD],
    [0, -TD / 6, TW, 0.008],
    [0, TD / 6, TW, 0.008],
  ] as const)
    tray.add(put(cardBox(w, 0.04, d, C.wood, 0.15, 'wood'), { position: V3(x, 0.02, z) }));
  const partCol = [0xd98c4a, 0xe8c9a0, 0xc97a3e, 0xf0e2c4];
  const partShapes: Vector2[][] = [
    // 腿、尾、耳、身、头……都是带圆头的小纸片。
    capsule(0.035, 0.012),
    capsule(0.05, 0.01),
    [new Vector2(-0.015, 0), new Vector2(0.015, 0), new Vector2(0, 0.035)],
    ellipse(0.05, 0.03),
    ellipse(0.03, 0.025),
  ];
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++) {
      const sh = partShapes[(c * 3 + r) % partShapes.length]!;
      for (let k = 0; k < 2 + ((c + r) % 2); k++) {
        const pm = mesh(flat(sh, 0.003), card(partCol[(c + r + k) % partCol.length]!, 0.05));
        pm.rotation.x = -Math.PI / 2;
        pm.rotation.z = rnd() * Math.PI * 2;
        pm.position.set(-TW / 3 + c * (TW / 3) + (rnd() - 0.5) * 0.05, 0.015 + k * 0.004, -TD / 3 + r * (TD / 3) + (rnd() - 0.5) * 0.04);
        tray.add(pm);
        rv.add(pm.position.clone().add(V3(0, 0.003, 0)).add(tray.position), V3(0, 1, 0), 0.004);
      }
    }
  g.add(tray);
  items.push({ id: 'parts', name: '零件盘', hint: '拼一只动物：纸片、铆钉，都在这里', obj: tray });
  // 铆钉碗。
  const bowl = new Mesh(new LatheGeometry([new Vector2(0, 0), new Vector2(0.045, 0.002), new Vector2(0.06, 0.03), new Vector2(0.062, 0.036)], 20), copperMat);
  bowl.position.set(0.09, TABLE_Y, 0.42);
  bowl.castShadow = true;
  add(bowl);
  for (let i = 0; i < 14; i++) {
    const r = new Mesh(new CylinderGeometry(0.006, 0.008, 0.006, 8), brassMat);
    const a = rnd() * Math.PI * 2;
    const d = rnd() * 0.035;
    r.position.set(0.09 + Math.cos(a) * d, TABLE_Y + 0.008 + rnd() * 0.012, 0.42 + Math.sin(a) * d);
    r.rotation.set(rnd(), rnd(), rnd());
    add(r);
  }
  // 草图纸两张、尺、剪刀、笔筒。
  const sketch = canvasTex(256, 192, (c) => {
    c.fillStyle = '#f4ecd9';
    c.fillRect(0, 0, 256, 192);
    c.strokeStyle = 'rgba(60,40,30,0.7)';
    c.lineWidth = 1.5;
    c.beginPath();
    c.ellipse(120, 100, 60, 32, 0, 0, Math.PI * 2);
    c.moveTo(176, 88);
    c.arc(190, 80, 18, Math.PI, Math.PI * 3);
    for (const x of [80, 100, 140, 160]) {
      c.moveTo(x, 125);
      c.lineTo(x - 4, 170);
    }
    c.moveTo(60, 95);
    c.quadraticCurveTo(30, 60, 40, 40);
    c.stroke();
    c.strokeStyle = 'rgba(60,40,30,0.3)';
    for (let i = 0; i < 6; i++) {
      c.beginPath();
      c.moveTo(20, 20 + i * 4);
      c.lineTo(110, 20 + i * 4);
      c.stroke();
    }
  });
  for (const [x, z, r] of [
    [0.14, 0.62, 0.15],
    [0.2, 0.55, -0.12],
  ] as const) {
    const sh = new Mesh(slab([V3(-0.11, 0, 0.08), V3(0.11, 0, 0.08), V3(0.11, 0, -0.08), V3(-0.11, 0, -0.08)], 0.002, [], true), [new MeshStandardMaterial({ map: sketch, roughness: 1 }), paperMaterial(0xf4ecd9, { edge: true })]);
    sh.geometry.translate(0, 0.002, 0);
    sh.position.set(x, TABLE_Y + 0.001 + (r > 0 ? 0 : 0.002), z);
    sh.rotation.y = r;
    sh.receiveShadow = true;
    add(sh);
  }
  const ruler = cardBox(0.32, 0.006, 0.03, 0xd9b46a, 0.1, 'wood');
  ruler.position.set(0.08, TABLE_Y + 0.006, 0.8);
  ruler.rotation.y = 0.08;
  add(ruler);
  for (let i = 0; i < 16; i++) add(put(cardBox(0.002, 0.002, i % 4 ? 0.008 : 0.016, 0x5a3e28, 0.1), { position: V3(-0.07 + i * 0.019, TABLE_Y + 0.01, 0.79 + 0.0016 * i) }));
  const scissors = new Group();
  scissors.position.set(0.0, TABLE_Y + 0.004, 0.42);
  scissors.rotation.y = 0.6;
  for (const s of [1, -1]) {
    const blade = mesh(flat([new Vector2(0, 0.004 * s), new Vector2(0.11, 0.002 * s), new Vector2(0.12, 0), new Vector2(0, -0.006 * s)], 0.003), [ironM(), ironM()]);
    blade.rotation.set(-Math.PI / 2, 0, s * 0.12);
    const ring = new Mesh(new TorusGeometry(0.018, 0.005, 6, 16), brassMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(-0.025, 0, s * 0.02);
    scissors.add(blade, ring);
  }
  add(scissors);
  const jar = new Mesh(new CylinderGeometry(0.035, 0.032, 0.1, 16, 1, true), new MeshStandardMaterial({ color: 0x8aa0a0, roughness: 0.6, side: DoubleSide }));
  jar.position.set(-0.52, TABLE_Y + 0.05, 0.86);
  add(jar);
  for (let i = 0; i < 5; i++) {
    const c = [0xb8452f, 0x2f5a8a, 0x3e6b3a, 0xd9b46a, 0x5a3e28][i]!;
    add(rod(V3(-0.52 + (i - 2) * 0.012, TABLE_Y + 0.02, 0.86 + ((i % 2) - 0.5) * 0.02), V3(-0.52 + (i - 2) * 0.03, TABLE_Y + 0.17, 0.86 + ((i % 2) - 0.5) * 0.04), 0.0045, paperMaterial(c, { scale: 0.05 }), 6));
  }

  // 装岛的托盘：一只木框，内框 0.42 × 0.29，框边一只小水平仪。
  const islandTray = new Group();
  islandTray.position.set(0.58, TABLE_Y, 0.64);
  const IW = 0.46;
  const ID = 0.33;
  islandTray.add(put(cardBox(IW, 0.012, ID, C.woodDark, 0.15, 'wood'), { position: V3(0, 0.006, 0) }));
  for (const [x, z, w, d] of [
    [0, -ID / 2, IW + 0.03, 0.022],
    [0, ID / 2, IW + 0.03, 0.022],
    [-IW / 2, 0, 0.022, ID],
    [IW / 2, 0, 0.022, ID],
  ] as const)
    islandTray.add(put(cardBox(w, 0.045, d, C.wood, 0.12, 'wood'), { position: V3(x, 0.0225, z) }));
  for (const [x, z] of [
    [-IW / 2, -ID / 2],
    [IW / 2, -ID / 2],
    [IW / 2, ID / 2],
    [-IW / 2, ID / 2],
  ] as const)
    islandTray.add(put(cardBox(0.035, 0.05, 0.035, C.wood, 0.1), { material: [brassMat, brassDark], position: V3(x, 0.025, z) }));
  const level = new Group();
  level.position.set(0, 0.048, -ID / 2);
  level.add(put(cardBox(0.08, 0.016, 0.022, C.wood, 0.1), { material: [brassMat, brassDark] }));
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

  // 台灯：黄铜底座，两节臂，罩子朝台面；罩里一盏聚光灯。
  const lampG = new Group();
  lampG.position.set(0.88, TABLE_Y, 0.86);
  const base = new Mesh(new CylinderGeometry(0.06, 0.07, 0.02, 24), brassMat);
  base.position.y = 0.01;
  base.castShadow = true;
  const j1 = V3(0, 0.02, 0);
  const j2 = V3(-0.04, 0.32, -0.05);
  const j3 = V3(-0.2, 0.42, -0.18);
  const shade = new Mesh(new CylinderGeometry(0.03, 0.08, 0.1, 20, 1, true), new MeshStandardMaterial({ color: 0xc89a48, metalness: 0.8, roughness: 0.38, side: DoubleSide }));
  shade.position.copy(j3).add(V3(0, -0.04, 0));
  shade.rotation.set(-0.5, 0, 0.35);
  shade.castShadow = true;
  const bulbM = new Mesh(new SphereGeometry(0.025, 12, 8), new MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffd49a, emissiveIntensity: 2 }));
  bulbM.position.copy(j3).add(V3(0.01, -0.07, 0.02));
  lampG.add(base, rod(j1, j2, 0.008), rod(j2, j3, 0.007), shade, bulbM);
  for (const j of [j2, j3]) lampG.add(put(new Mesh(new SphereGeometry(0.014, 10, 8), brassMat), { position: j.clone() }));
  const lamp = new SpotLight(0xffcf94, 2.2, 3, 0.9, 0.7, 1.6);
  lamp.position.copy(bulbM.position);
  lamp.castShadow = true;
  lamp.shadow.mapSize.set(1024, 1024);
  lamp.shadow.bias = -0.0005;
  lamp.shadow.normalBias = 0.01;
  lampG.add(lamp);
  lamp.target.position.set(0.88 - 0.55, TABLE_Y, 0.86 - 0.25);
  g.add(lampG, lamp.target);
  items.push({ id: 'lamp', name: '台灯', hint: '点一下开、关', obj: lampG });

  // ———— 抽屉墙（现有技术：前人的设计） ————
  const wall = new Group();
  const wx0 = -0.58;
  const wx1 = 0.3;
  const wy0 = 1.55;
  const wy1 = 2.22;
  const wd = 0.26;
  wall.add(put(cardBox(wx1 - wx0 + 0.04, wy1 - wy0 + 0.04, wd, C.wood, 0.2, 'wood'), { position: V3((wx0 + wx1) / 2, (wy0 + wy1) / 2, ZW - wd / 2) }));
  const cols = 4;
  const rows = 3;
  const cw = (wx1 - wx0) / cols;
  const ch = (wy1 - wy0) / rows;
  const labelTex = canvasTex(64, 32, (c) => {
    c.fillStyle = '#f2ead8';
    c.fillRect(0, 0, 64, 32);
    c.fillStyle = 'rgba(60,40,30,0.6)';
    c.fillRect(10, 13, 44, 3);
    c.fillRect(10, 19, 30, 3);
  });
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      const out = (c === 1 && r === 0) || (c === 2 && r === 1) ? 0.12 + rnd() * 0.05 : 0;
      const dr = new Group();
      dr.position.set(wx0 + cw * (c + 0.5), wy0 + ch * (r + 0.5), ZW - wd - 0.005 - out);
      const front = cardBox(cw - 0.018, ch - 0.018, 0.02, [C.woodLight, 0xb98a5a, 0xc8a070][(c + r) % 3]!, 0.12, 'wood');
      dr.add(front);
      const frame = mesh(flat([new Vector2(-0.035, -0.015), new Vector2(0.035, -0.015), new Vector2(0.035, 0.015), new Vector2(-0.035, 0.015)], 0.004, [[new Vector2(-0.028, -0.01), new Vector2(0.028, -0.01), new Vector2(0.028, 0.01), new Vector2(-0.028, 0.01)]]), [brassMat, brassDark]);
      frame.rotation.y = Math.PI;
      frame.position.set(0, 0.03, -0.012);
      const label = new Mesh(slab([V3(0.028, 0.02, -0.011), V3(-0.028, 0.02, -0.011), V3(-0.028, 0.04, -0.011), V3(0.028, 0.04, -0.011)], 0.001, [], true), [new MeshStandardMaterial({ map: labelTex, roughness: 1 }), paperMaterial(0xf2ead8, { edge: true })]);
      const pull = new Mesh(new SphereGeometry(0.011, 10, 8), brassMat);
      pull.position.set(0, -0.025, -0.016);
      dr.add(frame, label, pull);
      if (out > 0) {
        // 拉出来的抽屉：盒身和里面竖着的一排卡片（前人的设计）。
        dr.add(put(cardBox(cw - 0.03, ch * 0.7, out + 0.02, 0xd9b48a, 0.1, 'wood'), { position: V3(0, -ch * 0.1, out / 2 + 0.01) }));
        for (let k = 0; k < 6; k++) {
          const cardM = new Mesh(slab([V3(-0.07, 0, 0), V3(0.07, 0, 0), V3(0.07, 0.11, 0), V3(-0.07, 0.11, 0)], 0.002, [], true), [cardFace(k + c, k % 2 ? '#efe6cf' : '#e6d9bc'), paperMaterial(0xefe6cf, { edge: true })]);
          cardM.position.set(0, -ch * 0.05, 0.03 + k * 0.022);
          cardM.rotation.x = -0.18 - k * 0.02;
          dr.add(cardM);
        }
      }
      wall.add(dr);
    }
  g.add(wall);
  items.push({ id: 'archive', name: '抽屉墙', hint: '前人设计过的动物：一张卡一种', obj: wall });

  // 八角花窗在车里的一圈木框。
  {
    const ring: Vector2[] = [];
    const hole: Vector2[] = [];
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
      ring.push(new Vector2(Math.cos(a) * 0.33, Math.sin(a) * 0.33));
      hole.push(new Vector2(Math.cos(a) * 0.27, Math.sin(a) * 0.27));
    }
    const fr = mesh(flat(ring, 0.03, [hole]), wood(C.wood, 0.1));
    fr.rotation.y = Math.PI;
    fr.position.set(0.62, 1.86, ZW - 0.012);
    add(fr);
  }

  // ———— 晾绳和专利卡 ————
  const pins: Group[] = [];
  {
    const a = V3(XR + 0.18, 2.46, 0.55);
    const b = V3(1.08, 2.46, 0.55);
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20;
      pts.push(V3(a.x + (b.x - a.x) * t, a.y - Math.sin(t * Math.PI) * 0.12, a.z));
    }
    const curve = new CatmullRomCurve3(pts);
    add(new Mesh(new TubeGeometry(curve, 60, 0.005, 5), new MeshStandardMaterial({ color: 0xcdb78a, roughness: 1 })));
    for (const p of [a, b]) add(put(new Mesh(new TorusGeometry(0.015, 0.005, 6, 12), brassMat), { position: p.clone() }));
    const n = 11;
    for (let i = 0; i < n; i++) {
      const t = 0.06 + (i / (n - 1)) * 0.88;
      const p = curve.getPoint(t);
      const cg = new Group();
      cg.position.copy(p);
      const tint = ['#efe6cf', '#e8dcbf', '#f2ead8'][i % 3]!;
      const c = new Mesh(slab([V3(-0.06, -0.17, 0), V3(0.06, -0.17, 0), V3(0.06, -0.01, 0), V3(-0.06, -0.01, 0)], 0.002, [], true), [cardFace(i, tint), paperMaterial(0xefe6cf, { edge: true })]);
      c.rotation.y = Math.PI;
      c.castShadow = true;
      const pin = cardBox(0.012, 0.045, 0.01, C.woodLight, 0.05, 'wood');
      pin.position.y = -0.005;
      cg.add(c, pin);
      cg.rotation.y = (rnd() - 0.5) * 0.3;
      cg.userData['ph'] = rnd() * 6;
      g.add(cg);
      pins.push(cg);
    }
    items.push({ id: 'patents', name: '专利卡', hint: '你拿到的专利，一张一只', obj: pins[5]! });
  }

  // ———— 驾驶室 ————
  for (const s of [1, -1]) {
    const seat = new Group();
    seat.position.set(1.58, Y0, s * 0.46);
    // 铁皮的座架、两块坐垫（灰绿的厚纸，几颗包扣），靠背微微后仰。
    seat.add(put(cardBox(0.4, 0.3, 0.42, C.chassis, 0.15), { position: V3(0, 0.15, 0) }));
    seat.add(put(cardBox(0.46, 0.1, 0.46, 0x7f948e, 0.12, 'kraft'), { position: V3(0, 0.35, 0) }));
    const back = new Group();
    back.position.set(-0.2, 0.4, 0);
    back.rotation.z = 0.16;
    back.add(put(cardBox(0.09, 0.5, 0.44, 0x7f948e, 0.12, 'kraft'), { position: V3(0, 0.25, 0) }));
    back.add(put(cardBox(0.1, 0.06, 0.46, C.chassis, 0.15), { position: V3(-0.01, 0.52, 0) }));
    for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) back.add(put(new Mesh(new SphereGeometry(0.012, 8, 6), brassMat), { position: V3(0.047, 0.16 + r * 0.2, -0.1 + c * 0.2) }));
    seat.add(back);
    g.add(seat);
  }
  // 方向盘（黄铜轮、四根辐条）、仪表板（几只表盘）。
  const wheel = new Group();
  wheel.position.set(1.86, 1.42, 0.46);
  wheel.rotation.z = -0.9;
  wheel.rotation.y = Math.PI / 2;
  wheel.add(new Mesh(new TorusGeometry(0.17, 0.014, 8, 28), brassMat));
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    wheel.add(rod(V3(0, 0, 0), V3(Math.cos(a) * 0.17, Math.sin(a) * 0.17, 0), 0.007));
  }
  wheel.add(put(new Mesh(new CylinderGeometry(0.035, 0.035, 0.03, 14), brassDark), { rotation: { x: Math.PI / 2 } }));
  add(wheel, rod(V3(1.86, 1.42, 0.46), V3(2.02, 1.18, 0.46), 0.015, ironM()));
  const dash = cardBox(0.16, 0.2, 1.8, C.woodDark, 0.15, 'wood');
  dash.position.set(2.0, 1.28, 0);
  add(dash);
  const gaugeTex = canvasTex(64, 64, (c) => {
    c.fillStyle = '#f4ecd8';
    c.beginPath();
    c.arc(32, 32, 30, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#3a2618';
    c.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const a = Math.PI * 0.8 + (i / 8) * Math.PI * 1.4;
      c.beginPath();
      c.moveTo(32 + Math.cos(a) * 22, 32 + Math.sin(a) * 22);
      c.lineTo(32 + Math.cos(a) * 27, 32 + Math.sin(a) * 27);
      c.stroke();
    }
    c.strokeStyle = '#b8452f';
    c.beginPath();
    c.moveTo(32, 32);
    c.lineTo(48, 20);
    c.stroke();
  });
  for (const z of [0.3, 0.6, -0.25]) {
    const face = new Mesh(new CylinderGeometry(0.045, 0.045, 0.01, 20), [new MeshStandardMaterial({ color: 0xc89a48, metalness: 0.8, roughness: 0.4 }), new MeshStandardMaterial({ map: gaugeTex, roughness: 0.6 }), brassMat]);
    face.rotation.z = Math.PI / 2 + 0.4;
    face.position.set(1.915, 1.33, z);
    add(face);
    add(put(new Mesh(new TorusGeometry(0.047, 0.008, 6, 20), brassMat), { position: V3(1.912, 1.33, z), rotation: { y: Math.PI / 2, x: 0.4 } }));
  }

  // ———— 车尾：工具挂袋、挂钩上的包和绳、木箱、小搁板（水壶、杯子、罐子） ————
  const org = new Group();
  org.position.set(-1.68, 1.72, ZW - 0.01);
  org.add(put(cardBox(0.56, 0.72, 0.01, C.canvas, 0.2, 'kraft'), { position: V3(0, 0, 0) }));
  const tools: Array<[number, number, number, number]> = [];
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 3; c++) {
      const px = -0.18 + c * 0.18;
      const py = -0.22 + r * 0.32;
      const pocket = mesh(flat([new Vector2(-0.075, -0.09), new Vector2(0.075, -0.09), new Vector2(0.08, 0.06), new Vector2(-0.08, 0.06)], 0.012), card(0xd9ccb0, 0.1, 'kraft'));
      pocket.rotation.y = Math.PI;
      pocket.position.set(px, py, -0.02);
      org.add(pocket);
      tools.push([px, py, c, r]);
      // 口袋缝线：几颗小铆钉。
      for (const sx of [-0.07, 0.07]) rv.add(V3(-1.68 + px + sx, 1.72 + py + 0.05, ZW - 0.045), V3(0, 0, -1), 0.005);
    }
  for (const [px, py, c, r] of tools) {
    const k = (c + r * 3) % 4;
    const mat = [paperMaterial(0xb8452f, { scale: 0.05 }), paperMaterial(C.woodLight, { kind: 'wood', scale: 0.05 }), paperMaterial(0x2f5a8a, { scale: 0.05 }), paperMaterial(0x3e6b3a, { scale: 0.05 })][k]!;
    org.add(rod(V3(px - 0.02, py + 0.02, -0.035), V3(px - 0.03, py + 0.16, -0.04), 0.012, mat, 6));
    org.add(rod(V3(px + 0.025, py + 0.0, -0.035), V3(px + 0.035, py + 0.13, -0.04), 0.006, ironM(), 6));
  }
  g.add(org);
  items.push({ id: 'tools', name: '工具挂袋', hint: '剪刀、锥子、镊子……拼装用的', obj: org });
  // 挂钩：一只帆布包、一卷绳。
  for (const [x, kind] of [
    [-1.28, 0],
    [-1.08, 1],
  ] as const) {
    add(rod(V3(x, 2.15, ZW), V3(x, 2.15, ZW - 0.06), 0.008, brassMat));
    if (kind === 0) {
      const bag = new Group();
      bag.position.set(x, 1.82, ZW - 0.08);
      bag.add(put(cardBox(0.2, 0.24, 0.07, 0xb79c74, 0.1, 'kraft'), { position: V3(0, 0, 0) }));
      bag.add(put(cardBox(0.2, 0.1, 0.075, 0xa88c64, 0.1, 'kraft'), { position: V3(0, 0.08, -0.003) }));
      bag.add(new Mesh(new TubeGeometry(new CatmullRomCurve3([V3(-0.09, 0.12, 0), V3(0, 0.34, 0.02), V3(0.09, 0.12, 0)]), 12, 0.008, 4), new MeshStandardMaterial({ color: C.leather, roughness: 0.8 })));
      bag.add(put(new Mesh(new TorusGeometry(0.014, 0.004, 6, 10), brassMat), { position: V3(0, 0.05, -0.04) }));
      g.add(bag);
    } else {
      const rope = new Mesh(new TorusGeometry(0.09, 0.02, 8, 28), new MeshStandardMaterial({ color: 0xc8b48a, roughness: 1 }));
      rope.position.set(x, 1.98, ZW - 0.06);
      rope.scale.y = 1.3;
      add(rope);
      const rope2 = rope.clone();
      rope2.scale.set(0.9, 1.2, 1);
      rope2.position.z -= 0.015;
      add(rope2);
    }
  }
  // 搁板：水壶、两只杯子、几只罐子。
  const shelf = cardBox(0.5, 0.025, 0.2, C.woodLight, 0.12, 'wood');
  shelf.position.set(-0.95, 1.38, ZW - 0.1);
  add(shelf);
  for (const x of [-1.15, -0.75]) add(put(cardBox(0.02, 0.12, 0.16, C.wood, 0.1, 'wood'), { position: V3(x, 1.31, ZW - 0.09) }));
  const kettle = new Group();
  kettle.position.set(-1.08, 1.393, ZW - 0.1);
  const kb = new Mesh(new LatheGeometry([new Vector2(0, 0), new Vector2(0.06, 0), new Vector2(0.075, 0.04), new Vector2(0.07, 0.08), new Vector2(0.04, 0.11), new Vector2(0.012, 0.12), new Vector2(0, 0.125)], 20), new MeshStandardMaterial({ color: 0xa9b0ad, metalness: 0.7, roughness: 0.35 }));
  kb.castShadow = true;
  const spout = rod(V3(0.06, 0.05, 0), V3(0.12, 0.1, 0), 0.01, new MeshStandardMaterial({ color: 0xa9b0ad, metalness: 0.7, roughness: 0.35 }));
  const handle = new Mesh(new TorusGeometry(0.045, 0.007, 6, 16, Math.PI), new MeshStandardMaterial({ color: 0x2a2420, roughness: 0.6 }));
  handle.position.y = 0.12;
  kettle.add(kb, spout, handle);
  add(kettle);
  for (const [x, c] of [
    [-0.92, 0xf2ead8],
    [-0.84, 0x9fb5b8],
  ] as const) {
    const mug = new Mesh(new CylinderGeometry(0.03, 0.028, 0.07, 16), paperMaterial(c, { scale: 0.05 }));
    mug.position.set(x, 1.428, ZW - 0.12);
    const mh = new Mesh(new TorusGeometry(0.018, 0.005, 6, 12), paperMaterial(c, { scale: 0.05 }));
    mh.position.set(x + 0.032, 1.43, ZW - 0.12);
    add(mug, mh);
  }
  for (let i = 0; i < 2; i++) {
    const j = new Mesh(new CylinderGeometry(0.028, 0.028, 0.09, 14), new MeshStandardMaterial({ color: 0xd8e6e0, roughness: 0.1, transparent: true, opacity: 0.4 }));
    j.position.set(-0.78 + i * 0.0, 1.44, ZW - 0.04 - i * 0.07);
    add(j);
    const fill = new Mesh(new CylinderGeometry(0.024, 0.024, 0.05, 12), paperMaterial(i ? 0x8a6a44 : 0xc9a34a, { kind: 'kraft', scale: 0.03 }));
    fill.position.set(-0.78, 1.42, ZW - 0.04 - i * 0.07);
    add(fill);
  }
  // 车尾地上：叠起来的木箱。
  for (const [x, y, z, w, h, d] of [
    [-1.82, Y0 + 0.16, 0.7, 0.36, 0.32, 0.4],
    [-1.82, Y0 + 0.44, 0.72, 0.3, 0.24, 0.34],
    [-1.45, Y0 + 0.12, 0.72, 0.26, 0.24, 0.3],
  ] as const) {
    const cr = crateMesh(w, h, d);
    cr.position.set(x, y, z);
    add(cr);
  }

  // 出诊的皮箱：门边地上，铜包角、铜扣、一根皮带。
  const suitcase = new Group();
  suitcase.position.set(-1.55, Y0, -0.35);
  suitcase.rotation.y = 0.35;
  suitcase.add(put(cardBox(0.5, 0.22, 0.32, C.leather, 0.08, 'kraft'), { position: V3(0, 0.11, 0) }));
  suitcase.add(put(cardBox(0.51, 0.025, 0.33, 0x6a3e26, 0.08, 'kraft'), { position: V3(0, 0.15, 0) }));
  for (const sx of [-1, 1])
    for (const sz of [-1, 1])
      for (const sy of [0.01, 0.21]) suitcase.add(put(cardBox(0.04, 0.04, 0.04, C.wood), { material: [brassMat, brassDark], position: V3(sx * 0.235, sy, sz * 0.15) }));
  suitcase.add(new Mesh(new TubeGeometry(new CatmullRomCurve3([V3(-0.08, 0.22, 0), V3(-0.06, 0.29, 0), V3(0.06, 0.29, 0), V3(0.08, 0.22, 0)]), 12, 0.012, 6), new MeshStandardMaterial({ color: 0x5a3220, roughness: 0.7 })));
  for (const sx of [-0.15, 0.15]) {
    suitcase.add(put(cardBox(0.03, 0.03, 0.01, C.wood), { material: [brassMat, brassDark], position: V3(sx, 0.17, -0.168) }));
    suitcase.add(put(cardBox(0.035, 0.225, 0.335, 0x5a3220, 0.05, 'kraft'), { position: V3(sx, 0.11, 0) }));
  }
  // 箱盖上一块铜牌，刻一只小狗。
  const plate = mesh(flat(dogOutline().map((p) => new Vector2(p.x * 0.07, p.y * 0.07)), 0.003), [brassMat, brassDark]);
  plate.rotation.x = -Math.PI / 2;
  plate.position.set(0, 0.226, 0);
  suitcase.add(plate);
  g.add(suitcase);
  items.push({ id: 'vet', name: '出诊皮箱', hint: '兽医的东西：带上它，回岛上看动物', obj: suitcase });

  // 门边一只碟子，一叠信（阿宝从嘴里叼进来的）。
  const mail = new Group();
  mail.position.set(-1.78, Y0, -0.72);
  mail.add(new Mesh(new LatheGeometry([new Vector2(0, 0), new Vector2(0.1, 0.002), new Vector2(0.13, 0.02), new Vector2(0.135, 0.024)], 24), new MeshStandardMaterial({ color: 0xe9ecea, roughness: 0.35, metalness: 0.05 })));
  const envTex = canvasTex(128, 80, (c) => {
    c.fillStyle = '#f6efdc';
    c.fillRect(0, 0, 128, 80);
    c.strokeStyle = '#c9b48a';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(64, 46);
    c.lineTo(128, 0);
    c.stroke();
    c.fillStyle = '#b8452f';
    c.beginPath();
    c.arc(64, 46, 8, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#d9cdb3';
    c.fillRect(98, 8, 20, 24);
  });
  for (let i = 0; i < 4; i++) {
    const e = new Mesh(slab([V3(-0.09, 0, 0.06), V3(0.09, 0, 0.06), V3(0.09, 0, -0.06), V3(-0.09, 0, -0.06)], 0.004, [], true), [new MeshStandardMaterial({ map: envTex, roughness: 0.95 }), paperMaterial(0xf6efdc, { edge: true })]);
    e.geometry.translate(0, 0.004, 0);
    e.position.set((rnd() - 0.5) * 0.03, 0.02 + i * 0.006, (rnd() - 0.5) * 0.03);
    e.rotation.y = (rnd() - 0.5) * 0.6;
    e.castShadow = true;
    mail.add(e);
  }
  g.add(mail);
  items.push({ id: 'mail', name: '一碟来信', hint: '有人求助：拆开看看', obj: mail });

  // 地上：一只靴子、一只铜碗（给来串门的动物喝水）、几个泥爪印。
  const boot = new Group();
  boot.position.set(-0.95, Y0, -0.1);
  boot.rotation.y = 0.7;
  boot.add(put(cardBox(0.12, 0.3, 0.1, 0x6a4a32, 0.08, 'kraft'), { position: V3(-0.03, 0.15, 0) }));
  boot.add(put(cardBox(0.26, 0.08, 0.1, 0x6a4a32, 0.08, 'kraft'), { position: V3(0.04, 0.04, 0) }));
  boot.add(put(cardBox(0.27, 0.02, 0.105, 0x3a2a20, 0.08), { position: V3(0.045, 0.01, 0) }));
  for (let k = 0; k < 4; k++) rv.add(V3(-0.95 + Math.cos(0.7) * -0.03, Y0 + 0.12 + k * 0.045, -0.1 - Math.sin(0.7) * -0.03 - 0.052), V3(0, 0, -1), 0.005);
  add(boot);
  const wbowl = new Mesh(new LatheGeometry([new Vector2(0, 0), new Vector2(0.08, 0), new Vector2(0.11, 0.05), new Vector2(0.115, 0.055)], 24), copperMat);
  wbowl.position.set(-0.6, Y0, -0.42);
  wbowl.castShadow = true;
  add(wbowl);
  const water = new Mesh(new CylinderGeometry(0.1, 0.1, 0.002, 24), new MeshStandardMaterial({ color: 0x9fc2c4, roughness: 0.05, metalness: 0.2 }));
  water.position.set(-0.6, Y0 + 0.04, -0.42);
  add(water);
  const pawMat = new MeshStandardMaterial({ color: 0x8a6a4a, roughness: 1, transparent: true, opacity: 0.55, depthWrite: false });
  for (let i = 0; i < 7; i++) {
    const paw = new Group();
    paw.position.set(-1.85 + i * 0.2, Y0 + 0.002, -0.62 + (i % 2) * 0.12);
    paw.add(put(new Mesh(new CylinderGeometry(0.022, 0.022, 0.001, 10), pawMat), {}));
    for (let k = 0; k < 4; k++) {
      const a = -0.9 + k * 0.6;
      paw.add(put(new Mesh(new CylinderGeometry(0.009, 0.009, 0.001, 8), pawMat), { position: V3(Math.cos(a) * 0.035, 0, Math.sin(a) * 0.035) }));
    }
    paw.rotation.y = -Math.PI / 2;
    add(paw);
  }

  // 一把椅子：木座、四条腿、靠背上一排细棍（背对着我们）。
  const chair = new Group();
  chair.position.set(-0.42, Y0, -0.12);
  chair.rotation.y = 0.75;
  chair.add(put(cardBox(0.42, 0.04, 0.4, C.wood, 0.12, 'wood'), { position: V3(0, 0.46, 0) }));
  for (const [x, z] of [
    [-0.18, -0.17],
    [0.18, -0.17],
    [-0.18, 0.17],
    [0.18, 0.17],
  ] as const)
    chair.add(rod(V3(x, 0, z), V3(x, 0.45, z), 0.017, woodM()));
  for (const z of [-0.17]) {
    for (const x of [-0.18, 0.18]) chair.add(rod(V3(x, 0.46, z), V3(x, 0.98, z - 0.03), 0.017, woodM()));
    chair.add(put(cardBox(0.42, 0.07, 0.03, C.wood, 0.12, 'wood'), { position: V3(0, 0.96, z - 0.03) }));
    for (let k = 0; k < 4; k++) chair.add(rod(V3(-0.105 + k * 0.07, 0.48, z), V3(-0.105 + k * 0.07, 0.93, z - 0.025), 0.008, woodM()));
  }
  for (const z of [-0.17, 0.17]) chair.add(rod(V3(-0.18, 0.16, z), V3(0.18, 0.16, z), 0.008, woodM()));
  g.add(chair);

  // 顶灯：一根线吊着一只铜灯座、一颗灯泡。
  const bulbL = new PointLight(0xffd7a0, 0.9, 4, 1.6);
  {
    const x = -0.75;
    add(rod(V3(x, 2.63, 0.1), V3(x, 2.3, 0.1), 0.004, new MeshStandardMaterial({ color: 0x2a2420 })));
    const sock = new Mesh(new CylinderGeometry(0.022, 0.03, 0.06, 12), brassMat);
    sock.position.set(x, 2.27, 0.1);
    const bulbMesh = new Mesh(new SphereGeometry(0.04, 14, 10), new MeshStandardMaterial({ color: 0xfff3dc, emissive: 0xffcf8a, emissiveIntensity: 1.6 }));
    bulbMesh.position.set(x, 2.21, 0.1);
    bulbL.position.set(x, 2.16, 0.1);
    add(sock, bulbMesh, bulbL);
  }

  g.add(rv.build());
  // 合批：能点的东西各自一组（悬停时要认得出是哪一件），晾绳上的卡会晃，不合进去。
  for (const it of items) it.obj.userData['noBake'] = true;
  for (const p of pins) p.userData['noBake'] = true;
  bake(g);
  for (const it of items) if (it.id !== 'patents') bake(it.obj);
  // 几样东西会轻轻晃：专利卡（车在呼吸）、水壶的热气。
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
    update(_dt: number, t: number): void {
      for (const p of pins) p.rotation.z = Math.sin(t * 1.1 + (p.userData['ph'] as number)) * 0.04;
      for (const s of steam) {
        const ph = (t * 0.35 + (s.userData['ph'] as number)) % 1;
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

/** 木箱：几块横板、四根角柱。 */
function crateMesh(w: number, h: number, d: number): Group {
  const g = new Group();
  const slats = 3;
  for (let i = 0; i < slats; i++) {
    const y = -h / 2 + (i + 0.5) * (h / slats);
    for (const [x, z, sw, sd] of [
      [0, -d / 2, w, 0.015],
      [0, d / 2, w, 0.015],
      [-w / 2, 0, 0.015, d],
      [w / 2, 0, 0.015, d],
    ] as const)
      g.add(put(cardBox(sw, h / slats - 0.015, sd, i % 2 ? C.woodLight : 0xc8a070, 0.1, 'wood'), { position: V3(x, y, z) }));
  }
  for (const [x, z] of [
    [-w / 2, -d / 2],
    [w / 2, -d / 2],
    [w / 2, d / 2],
    [-w / 2, d / 2],
  ] as const)
    g.add(put(cardBox(0.03, h, 0.03, C.wood, 0.1, 'wood'), { position: V3(x, 0, z) }));
  g.add(put(cardBox(w, 0.012, d, C.woodDark, 0.1, 'wood'), { position: V3(0, -h / 2 + 0.006, 0) }));
  return g;
}

let iron: MeshStandardMaterial | null = null;
function ironM(): MeshStandardMaterial {
  return (iron ??= new MeshStandardMaterial({ color: 0x6a6660, metalness: 0.7, roughness: 0.35 }));
}
let woodMat: Material | null = null;
function woodM(): Material {
  return (woodMat ??= paperMaterial(C.wood, { kind: 'wood', scale: 0.1 }));
}
