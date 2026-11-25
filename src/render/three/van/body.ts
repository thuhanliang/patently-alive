import { BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, Matrix4, type Quaternion, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector2, Vector3, CatmullRomCurve3, TubeGeometry, type Material } from 'three';
import { paperMaterial } from '../paper';
import { C, Rivets, V3, brassDark, brassMat, canvasTex, card, cardBox, dogOutline, flat, gold, hang, hex, hinge, merge, mesh, ngon, put, rng, rod, rolled, slab, stackRound, strip, twine } from '../craft';

/**
 * 「勾勾」的车身（2026-11-25）：照 art/incoming/lovart/010 的设定图，一辆圆头圆脑的厢式车做成的卡纸模型。
 * x 朝车头，y 朝上，z 朝车的右侧（+z 是"有花窗、徽章、雕花板"的那一侧，-z 是剖开看里面的那一侧）。
 */

export const XR = -2.05; // 车尾
export const XC = 1.2; // 车顶从这里开始往前低下去
export const XF = 2.2; // 车头（最下沿）
export const FLOOR = 0.52; // 车底
export const WALL_TOP = 2.3; // 车厢墙的上沿（再往上是斜的倒角）
export const ROOF = 2.68;
export const FRONT_TOP = 1.94; // 车头墙的上沿
export const FRONT_ROOF = 2.32;
const SLANT = 0.14;
export const WHEEL_R = 0.42;
export const WHEELS: Array<[number, number]> = [
  [-1.25, 1],
  [1.45, 1],
  [-1.25, -1],
  [1.45, -1],
];
const ARCH = 0.56;

/** 车头那一面往后仰：高度 y 处的 x。 */
export const frontX = (y: number): number => XF - (SLANT * (y - FLOOR)) / 1.8;
/** 车厢墙在 x 处的上沿。 */
const wallTop = (x: number): number => (x <= XC ? WALL_TOP : WALL_TOP - ((x - XC) / (frontX(FRONT_TOP) - XC)) * (WALL_TOP - FRONT_TOP));

export interface VanParts {
  root: Group;
  /** 剖开的那一侧（-z）：在"家"的视角里藏起来。 */
  nearSide: Group;
  lids: Mesh[];
  smallLids: Mesh[];
  ears: Group[];
  doors: Group[];
  flap: Group;
  awning: Group;
  awningRoll: Group;
  tail: Mesh;
  tailCurve: CatmullRomCurve3;
  vane: Group;
  letter: Mesh;
  bell: Group;
  smoke: Mesh[];
  badges: Group;
  eyeGlow: MeshStandardMaterial;
  /** 车里的灯光照得到的那部分（地板、内壁），给内饰挂东西用。 */
  interior: Group;
}

/** 车厢墙的轮廓（x, y），底下按轮拱挖掉；top 给了就只到那个高度（画下面那条蓝色的带子）。 */
function wallOutline(top?: number): Vector2[] {
  const pts: Vector2[] = [new Vector2(XR, 0.64)];
  for (const wx of [-1.25, 1.45]) {
    for (let k = 0; k <= 6; k++) {
      const a = ((157 - k * 22.33) * Math.PI) / 180;
      pts.push(new Vector2(wx + Math.cos(a) * ARCH, Math.max(0.64, WHEEL_R + Math.sin(a) * ARCH)));
    }
  }
  pts.push(new Vector2(frontX(0.64), 0.64));
  if (top !== undefined) {
    pts.push(new Vector2(frontX(top), top), new Vector2(XR, top));
    return pts;
  }
  pts.push(new Vector2(frontX(FRONT_TOP), FRONT_TOP), new Vector2(XC, WALL_TOP), new Vector2(XR, WALL_TOP));
  return pts;
}

const at = (pts: Vector2[], z: number): Vector3[] => pts.map((p) => V3(p.x, p.y, z));

/** 条纹帆布（米白、灰蓝相间）。 */
function stripeTex(): ReturnType<typeof canvasTex> {
  return canvasTex(
    256,
    64,
    (g) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#a9bcbc' : '#efe7d4';
        g.fillRect(i * 32, 0, 32, 64);
      }
      g.globalAlpha = 0.08;
      for (let i = 0; i < 400; i++) {
        g.fillStyle = i % 2 ? '#000' : '#fff';
        g.fillRect(Math.random() * 256, Math.random() * 64, 1, 3);
      }
    },
    true,
  );
}

export function buildVan(seed = 11): VanParts {
  const root = new Group();
  root.name = 'van';
  const nearSide = new Group();
  nearSide.name = 'near';
  const interior = new Group();
  interior.name = 'interior';
  root.add(nearSide, interior);
  const rv = new Rivets();
  const rvNear = new Rivets();
  const rnd = rng(seed);
  const T = 0.035;
  const cream = card(C.cream, 0.5);

  // ———— 车厢壳 ————
  for (const side of [1, -1]) {
    const g = side > 0 ? root : nearSide;
    const R = side > 0 ? rv : rvNear;
    const z = side;
    const outline = at(wallOutline(), z);
    // 洞：+z 侧是八角花窗和驾驶室侧窗；-z 侧是驾驶室侧窗和一扇圆舷窗。
    const holes: Vector3[][] = [];
    const cabWin = [V3(1.32, 1.5, z), V3(1.86, 1.5, z), V3(1.8, 1.88, z), V3(1.32, 1.88, z)];
    holes.push(cabWin);
    if (side > 0) holes.push(at(ngon(8, 0.27, Math.PI / 8).map((p) => p.add(new Vector2(0.62, 1.86))), z));
    else holes.push(at(ngon(12, 0.17).map((p) => p.add(new Vector2(-0.95, 1.85))), z));
    // 墙往车里长厚度：+z 侧的法线朝 +z，所以点的顺序让法线朝外。
    const wall = mesh(slab(side > 0 ? outline : [...outline].reverse(), T, side > 0 ? holes : holes.map((h) => [...h].reverse())), cream);
    g.add(wall);
    // 下半截的灰蓝色带子，和几块颜色深浅不一的补丁纸（纸模型拼出来的样子）。
    // 层次：墙面 → 补丁纸和灰蓝带子（一层卡纸，平贴）→ 金卡纸条（压在上面）。
    const off = 0.006 * side;
    const band = mesh(slab(side > 0 ? at(wallOutline(1.08), z + off) : at(wallOutline(1.08), z + off).reverse(), 0.006, [], false, 0.006), card(C.blue, 0.5));
    g.add(band);
    const patches: Array<[number, number, number, number, number]> = [
      [-1.97, 1.12, -1.66, 1.66, C.creamLight],
      [-1.58, 1.7, -0.86, 2.26, C.peach],
      [-1.58, 1.12, -1.2, 1.5, C.creamDark],
      [-0.78, 1.12, -0.08, 1.26, C.creamDark],
      [0.09, 1.12, 0.3, 1.52, C.peach],
      [0.09, 1.56, 0.3, 2.26, C.creamLight],
      [0.95, 1.12, 1.17, 1.44, C.peach],
      [1.24, 1.12, 1.95, 1.46, C.creamLight],
      [-1.97, 1.7, -1.66, 2.26, C.creamDark],
    ];
    for (const [x0, y0, x1, y1, col] of patches) {
      const p = [V3(x0, y0, z + off), V3(x1, y0, z + off), V3(x1, y1, z + off), V3(x0, y1, z + off)];
      g.add(mesh(slab(side > 0 ? p : p.reverse(), 0.006, [], false, 0.006), card(col, 0.4)));
      for (const [x, y] of [[x0 + 0.04, y0 + 0.04], [x1 - 0.04, y0 + 0.04], [x1 - 0.04, y1 - 0.04], [x0 + 0.04, y1 - 0.04]] as const) R.add(V3(x, y, z + off), V3(0, 0, side), 0.008);
    }
    // 黄铜包边：腰线、墙的上沿、竖缝、轮拱、窗框。
    const n = V3(0, 0, side);
    const zz = z + off;
    const TH = 0.01;
    const zt = z + side * (0.006 + TH);
    // 车尾那一竖条最先贴；腰线、上沿从它的边上开始（对接，不叠在一起）。
    g.add(strip([V3(XR + 0.01, 0.64, zz), V3(XR + 0.01, WALL_TOP + 0.025, zz)], n, 0.05, TH));
    g.add(strip([V3(XR + 0.035, 1.08, zz), V3(frontX(1.08), 1.08, zz)], n, 0.04, TH));
    g.add(strip([V3(XR + 0.035, WALL_TOP, zz), V3(XC, WALL_TOP, zz), V3(frontX(FRONT_TOP), FRONT_TOP, zz)], n, 0.05, TH));
    for (const x of [-1.62, -0.82, 0.05, 1.2]) {
      const top = wallTop(x);
      g.add(strip([V3(x, 1.1, zz), V3(x, top - 0.025, zz)], n, 0.03, TH * 0.8));
      R.along(V3(x, 1.14, zt), V3(x, top - 0.06, zt), n, 0.2, 0.009);
    }
    R.along(V3(XR + 0.06, 1.08, zt), V3(frontX(1.08) - 0.05, 1.08, zt), n, 0.24, 0.011);
    R.along(V3(XR + 0.06, WALL_TOP, zt), V3(XC, WALL_TOP, zt), n, 0.24, 0.011);
    for (const wx of [-1.25, 1.45]) {
      const arc: Vector3[] = [];
      for (let k = 0; k <= 6; k++) {
        const a = ((157 - k * 22.33) * Math.PI) / 180;
        arc.push(V3(wx + Math.cos(a) * (ARCH + 0.02), WHEEL_R + Math.sin(a) * (ARCH + 0.02), zz));
      }
      g.add(strip(arc, n, 0.06, TH));
      for (const p of arc.slice(1, -1)) R.add(p.clone().setZ(zt), n, 0.012);
    }
    g.add(strip(cabWin.map((p) => p.clone().setZ(zz)), n, 0.045, TH, true));
    g.add(mesh(slab(side > 0 ? cabWin.map((p) => p.clone().setZ(z - 0.01)) : cabWin.map((p) => p.clone().setZ(z + 0.01)).reverse(), 0.004), [glassMat, glassMat], false));
    if (side < 0) {
      const port = at(ngon(12, 0.17).map((p) => p.add(new Vector2(-0.95, 1.85))), zz);
      g.add(strip(port, n, 0.05, TH, true));
      g.add(mesh(slab(at(ngon(12, 0.17).map((p) => p.add(new Vector2(-0.95, 1.85))), z + 0.01).reverse(), 0.004), [glassMat, glassMat], false));
      // 侧拉门的门缝和把手。
      g.add(strip([V3(-0.55, 1.1, zz), V3(-0.55, 2.2, zz), V3(0.55, 2.2, zz), V3(0.55, 1.1, zz)], n, 0.018, 0.006));
      g.add(rod(V3(0.4, 1.35, zz - 0.05), V3(0.4, 1.6, zz - 0.05), 0.014, brassMat));
    }
  }

  // ———— 车顶、倒角、车底 ————
  const sec = (x: number): Array<[number, number]> => {
    const top = x <= XC ? ROOF : ROOF - ((x - XC) / (frontX(FRONT_ROOF) - XC)) * (ROOF - FRONT_ROOF);
    return [
      [1, wallTop(x)],
      [0.74, top],
      [-0.74, top],
      [-1, wallTop(x)],
    ];
  };
  const roofXs = [XR, XC, frontX(FRONT_ROOF)];
  for (let i = 0; i < 2; i++) {
    const xa = roofXs[i]!;
    const xb = i === 0 ? XC : frontX(FRONT_TOP);
    const xbTop = roofXs[i + 1]!;
    const sa = sec(xa);
    const sb = sec(i === 0 ? XC : frontX(FRONT_TOP));
    // 右倒角、车顶、左倒角。
    const quads: Vector3[][] = [
      [V3(xa, sa[0]![1], 1), V3(xb, sb[0]![1], 1), V3(xbTop, sb[1]![1], 0.74), V3(xa, sa[1]![1], 0.74)],
      [V3(xa, sa[1]![1], 0.74), V3(xbTop, sb[1]![1], 0.74), V3(xbTop, sb[2]![1], -0.74), V3(xa, sa[2]![1], -0.74)],
      [V3(xa, sa[2]![1], -0.74), V3(xbTop, sb[2]![1], -0.74), V3(xb, sb[3]![1], -1), V3(xa, sa[3]![1], -1)],
    ];
    quads.forEach((q, k) => {
      const m = mesh(slab(q, T), card(k === 1 ? C.creamLight : C.cream, 0.5));
      (k === 2 ? nearSide : root).add(m);
    });
    root.add(strip([quads[0]![3]!, quads[0]![2]!], V3(0, 1, 0.3).normalize(), 0.045));
    nearSide.add(strip([quads[2]![0]!, quads[2]![1]!], V3(0, 1, -0.3).normalize(), 0.045));
  }
  // 车底、下倒角（轮拱处断开）。
  root.add(mesh(slab([V3(XR, FLOOR, -0.88), V3(XR, FLOOR, 0.88), V3(frontX(FLOOR), FLOOR, 0.88), V3(frontX(FLOOR), FLOOR, -0.88)], T), card(C.chassis, 0.5)));
  for (const side of [1, -1]) {
    const xs = [XR, -1.25 - ARCH, -1.25 + ARCH, 1.45 - ARCH, 1.45 + ARCH, frontX(0.64)];
    for (let i = 0; i < xs.length; i += 2) {
      const q = [V3(xs[i]!, 0.64, side), V3(xs[i + 1]!, 0.64, side), V3(xs[i + 1]!, FLOOR, side * 0.88), V3(xs[i]!, FLOOR, side * 0.88)];
      (side > 0 ? root : nearSide).add(mesh(slab(side > 0 ? q : q.reverse(), T), card(C.blueDark, 0.5)));
    }
  }

  // ———— 车尾：门框一圈，两扇门 ————
  const rearSec = [V3(XR, FLOOR, 0.88), V3(XR, 0.64, 1), V3(XR, WALL_TOP, 1), V3(XR, ROOF, 0.74), V3(XR, ROOF, -0.74), V3(XR, WALL_TOP, -1), V3(XR, 0.64, -1), V3(XR, FLOOR, -0.88)];
  const doorHole = [V3(XR, 0.62, 0.78), V3(XR, 0.62, -0.78), V3(XR, 2.3, -0.78), V3(XR, 2.3, 0.78)];
  root.add(mesh(slab([...rearSec].reverse(), T, [doorHole.reverse()]), cream));
  root.add(strip([V3(XR - 0.004, 0.62, 0.8), V3(XR - 0.004, 2.32, 0.8), V3(XR - 0.004, 2.32, -0.8), V3(XR - 0.004, 0.62, -0.8)], V3(-1, 0, 0), 0.05));
  const doors: Group[] = [];
  for (const s of [1, -1]) {
    const d = new Group();
    d.position.set(XR - 0.02, 0, s * 0.78);
    const w = 0.77;
    const leaf = mesh(slab([V3(0, 0.63, 0), V3(0, 0.63, -s * w), V3(0, 2.29, -s * w), V3(0, 2.29, 0)].map((p) => (s > 0 ? p : p)), 0.03), card(C.creamLight, 0.5));
    d.add(leaf);
    const n = V3(-1, 0, 0);
    const fr = [V3(-0.004, 0.68, -s * 0.05), V3(-0.004, 2.24, -s * 0.05), V3(-0.004, 2.24, -s * (w - 0.05)), V3(-0.004, 0.68, -s * (w - 0.05))];
    d.add(strip(fr, n, 0.04, 0.01, true));
    d.add(strip([V3(-0.004, 1.42, -s * 0.05), V3(-0.004, 1.42, -s * (w - 0.05))], n, 0.035, 0.01));
    // 门上的小窗。
    const win = [V3(-0.006, 1.6, -s * 0.18), V3(-0.006, 2.1, -s * 0.18), V3(-0.006, 2.1, -s * 0.6), V3(-0.006, 1.6, -s * 0.6)];
    d.add(mesh(slab(win, 0.004), card(0x9fb5b8, 0.3), false));
    d.add(strip(win, n, 0.03, 0.008, true));
    // 铰链、门把手。
    // 门挂在三只合页上：合页的轴就是门的转轴（门这一组的原点）。
    for (const y of [0.85, 1.5, 2.1]) d.add(put(hinge(0.14, 0.05, 0.005), { position: V3(-0.034, y, 0), rotation: { y: (s * Math.PI) / 2 } }));
    const handle = cardBox(0.04, 0.05, 0.14, C.cream);
    handle.material = [brassMat, brassMat];
    handle.position.set(-0.04, 1.42, -s * (w - 0.1));
    d.add(handle);
    for (const p of fr) rv.add(p.clone().add(V3(-0.012, 0, 0)), n, 0.01);
    root.add(d);
    doors.push(d);
  }
  // 车尾灯（六角，红色），踏板。
  for (const s of [1, -1]) {
    const lamp = mesh(flat(ngon(6, 0.08, 0), 0.04), [new MeshStandardMaterial({ color: C.red, emissive: 0x501008, roughness: 0.4 }), brassMat]);
    lamp.rotation.y = -Math.PI / 2;
    lamp.position.set(XR - 0.03, 0.95, s * 0.9);
    root.add(lamp);
    const ring = mesh(flat(ngon(6, 0.105, 0), 0.02, [ngon(6, 0.08, 0)]), [brassMat, brassMat]);
    ring.rotation.y = -Math.PI / 2;
    ring.position.set(XR - 0.035, 0.95, s * 0.9);
    root.add(ring);
  }
  const step = cardBox(0.22, 0.04, 1.2, C.woodDark, 0.3, 'wood');
  step.position.set(XR - 0.14, 0.4, 0);
  root.add(step);
  root.add(rod(V3(XR - 0.05, 0.4, 0.5), V3(XR - 0.05, 0.52, 0.5), 0.012, ironMat()), rod(V3(XR - 0.05, 0.4, -0.5), V3(XR - 0.05, 0.52, -0.5), 0.012, ironMat()));

  // ———— 车头：脸 ————
  const fp = (z: number, y: number, out = 0): Vector3 => V3(frontX(y) + out, y, z);
  const faceN = V3(1.8, SLANT, 0).normalize();
  const faceSec = [fp(0.88, FLOOR), fp(1, 0.64), fp(1, FRONT_TOP), fp(0.74, FRONT_ROOF), fp(-0.74, FRONT_ROOF), fp(-1, FRONT_TOP), fp(-1, 0.64), fp(-0.88, FLOOR)];
  const eyeC: Array<[number, number]> = [
    [0.42, 1.78],
    [-0.42, 1.78],
  ];
  const eyeHoles = eyeC.map(([z, y]) => ngon(8, 0.25, Math.PI / 8).map((p) => fp(z + p.x, y + p.y)));
  const grille = [fp(-0.36, 0.8), fp(0.36, 0.8), fp(0.36, 1.24), fp(-0.36, 1.24)];
  root.add(mesh(slab(faceSec, T, [...eyeHoles, grille]), cream));
  // 脸上的灰蓝下半、补丁。
  root.add(mesh(slab([fp(0.88, FLOOR, 0.006), fp(1, 0.64, 0.006), fp(1, 1.08, 0.006), fp(-1, 1.08, 0.006), fp(-1, 0.64, 0.006), fp(-0.88, FLOOR, 0.006)], 0.006, [grille.map((p) => p.clone().add(V3(0.006, 0, 0)))], false, 0.006), card(C.blue, 0.5)));
  root.add(strip(faceSec.map((p) => p.clone().addScaledVector(faceN, 0.006)), faceN, 0.05, 0.01, true));
  // 脸上的几块补丁纸、颧骨两块浅一点的纸、眼睛下面一道黄铜条。
  for (const [z0, y0, z1, y1, col] of [
    [-0.95, 1.12, -0.72, 1.62, C.peach],
    [0.72, 1.12, 0.95, 1.62, C.creamLight],
    [-0.2, 1.3, 0.2, 1.58, C.creamLight],
    [-0.62, 2.08, 0.62, 2.26, C.creamDark],
  ] as const) {
    const q = [fp(z1, y0, 0.006), fp(z0, y0, 0.006), fp(z0, y1, 0.006), fp(z1, y1, 0.006)];
    root.add(mesh(slab(q, 0.006, [], false, 0.006), card(col, 0.4)));
    for (const p of q) rv.add(p.clone().add(V3(0, p.y > (y0 + y1) / 2 ? -0.035 : 0.035, p.z > (z0 + z1) / 2 ? -0.035 : 0.035)), faceN, 0.009);
  }
  root.add(strip([fp(-0.7, 1.47, 0.006), fp(-0.12, 1.47, 0.006)], faceN, 0.03, 0.008), strip([fp(0.12, 1.47, 0.006), fp(0.7, 1.47, 0.006)], faceN, 0.03, 0.008));
  root.add(strip([fp(-0.975, 1.08, 0.012), fp(0.975, 1.08, 0.012)], faceN, 0.04, 0.01));
  rv.along(fp(-0.95, FRONT_TOP, 0.02), fp(0.95, FRONT_TOP, 0.02), faceN, 0.2, 0.011);
  // 眼睛：八角的车灯也是车里的前窗，外面一圈黄铜框，上面一片能合上的黄铜眼皮。
  const lids: Mesh[] = [];
  for (const [z, y] of eyeC) {
    const ring = mesh(flat(ngon(8, 0.3, Math.PI / 8), 0.04, [ngon(8, 0.245, Math.PI / 8)]), [brassMat, brassDark]);
    placeOnFace(ring, fp(z, y, 0.032), faceN);
    root.add(ring);
    const glass = mesh(flat(ngon(8, 0.25, Math.PI / 8), 0.01), [eyeGlass, eyeGlass], false);
    placeOnFace(glass, fp(z, y, -0.01), faceN);
    root.add(glass);
    // 眼皮：铰链在上沿，往外翻开；半闭是默认。
    const lidMount = new Group();
    placeOnFace(lidMount, fp(z, y, 0.035), faceN);
    const lidPivot = new Group();
    lidPivot.position.y = 0.25;
    lidMount.add(lidPivot);
    // 眼皮：上半个八角（直的下沿），挂在眼睛的上沿；往下拉就是闭眼（按高度缩放）。
    const lidShape = halfOct(0.255).map((p) => new Vector2(p.x, p.y - 0.255));
    const lid = mesh(flat(lidShape, 0.022), [brassMat, brassDark]);
    // 眼皮上一道压出来的线，铰链一根。
    lidPivot.add(lid);
    lidMount.add(rod(V3(-0.12, 0.27, 0.02), V3(0.12, 0.27, 0.02), 0.016, brassDark));
    root.add(lidMount);
    lids.push(lid);
    (lid as Mesh & { pivot?: Group }).userData['pivot'] = lidPivot;
    for (const k of [0, 2, 4, 6]) {
      const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
      rv.add(fp(z + Math.cos(a) * 0.275, y + Math.sin(a) * 0.275, 0.05), faceN, 0.012);
    }
  }
  // 鼻子：两眼之间、下面一点的小铜块。
  const nose = cardBox(0.14, 0.09, 0.07, C.cream);
  nose.material = [brassMat, brassDark];
  placeOnFace(nose, fp(0, 1.47, 0.04), faceN);
  root.add(nose);
  // 嘴：格栅，竖的铜条；嘴里叼着一封信。
  root.add(strip(grille.map((p) => p.clone().addScaledVector(faceN, 0.01)), faceN, 0.06, 0.02, true));
  for (let i = 1; i < 9; i++) {
    const z = -0.36 + (i * 0.72) / 9;
    root.add(rod(fp(z, 0.82, 0.01), fp(z, 1.22, 0.01), 0.013, brassMat, 8));
  }
  const grilleBack = mesh(slab([fp(-0.36, 0.8, -0.12), fp(0.36, 0.8, -0.12), fp(0.36, 1.24, -0.12), fp(-0.36, 1.24, -0.12)], 0.01), card(0x2f2a26, 0.4), false);
  root.add(grilleBack);
  const letterTex = canvasTex(256, 160, (g) => {
    g.fillStyle = '#f6efdc';
    g.fillRect(0, 0, 256, 160);
    g.strokeStyle = '#c9b48a';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(128, 90);
    g.lineTo(256, 0);
    g.stroke();
    g.fillStyle = '#b8452f';
    g.beginPath();
    g.arc(128, 92, 16, 0, Math.PI * 2);
    g.fill();
  });
  const letter = mesh(flat([new Vector2(-0.17, -0.11), new Vector2(0.17, -0.11), new Vector2(0.17, 0.11), new Vector2(-0.17, 0.11)], 0.008, [], true), [new MeshStandardMaterial({ map: letterTex, roughness: 0.95 }), paperMaterial(0xf6efdc, { edge: true })]);
  letter.position.copy(fp(0.12, 0.98, 0.06));
  letter.rotation.set(0, Math.PI / 2 - 0.35, -0.18);
  root.add(letter);
  // 腮边的小灯（六角，也有眼皮）、胡须。
  const smallLids: Mesh[] = [];
  for (const s of [1, -1]) {
    const lampRing = mesh(flat(ngon(6, 0.12, 0), 0.04, [ngon(6, 0.085, 0)]), [brassMat, brassDark]);
    placeOnFace(lampRing, fp(s * 0.66, 1.2, 0.032), faceN);
    root.add(lampRing);
    const lampGlass = mesh(flat(ngon(6, 0.088, 0), 0.02), [eyeGlass, eyeGlass], false);
    placeOnFace(lampGlass, fp(s * 0.66, 1.2, 0.012), faceN);
    root.add(lampGlass);
    const mount = new Group();
    placeOnFace(mount, fp(s * 0.66, 1.2, 0.04), faceN);
    const pv = new Group();
    pv.position.y = 0.088;
    mount.add(pv);
    const sl = mesh(flat(halfHex(0.09).map((p) => new Vector2(p.x, p.y - 0.09)), 0.016), [brassMat, brassDark]);
    pv.add(sl);
    sl.userData['pivot'] = pv;
    root.add(mount);
    smallLids.push(sl);
    for (let k = 0; k < 3; k++) {
      const a = fp(s * 0.48, 0.98 + k * 0.05, 0.03);
      const b = a.clone().add(V3(0.08 - k * 0.02, 0.06 - k * 0.07, s * (0.34 + k * 0.04)));
      root.add(rod(a, b, 0.006, brassMat, 6));
      const tip = new Mesh(new SphereGeometry(0.012, 8, 6), brassMat);
      tip.position.copy(b);
      root.add(tip);
    }
  }
  // 保险杠和铃铛。
  const bumper = cardBox(0.12, 0.13, 2.12, C.cream);
  bumper.position.set(XF + 0.05, 0.62, 0);
  root.add(bumper);
  root.add(strip([V3(XF + 0.112, 0.67, -1.04), V3(XF + 0.112, 0.67, 1.04)], V3(1, 0, 0), 0.05));
  for (const s of [1, -1]) {
    const cap = cardBox(0.13, 0.15, 0.1, C.cream);
    cap.material = [brassMat, brassDark];
    cap.position.set(XF + 0.05, 0.62, s * 1.03);
    root.add(cap);
  }
  const bell = new Group();
  bell.position.set(XF + 0.12, 0.55, 0);
  // 铃铛：一圈圈金卡纸叠出来的钟形（空心）。
  const bellMesh = stackRound(
    [
      [0, 0.066],
      [0.02, 0.058],
      [0.05, 0.045],
      [0.08, 0.034],
      [0.095, 0.018],
    ],
    0.006,
    0xc99d4e,
    { hole: (y) => (y < 0.06 ? 0.05 - y * 0.4 : 0), mats: gold },
  );
  bellMesh.position.y = -0.14;
  const bellTop = new Mesh(new SphereGeometry(0.031, 12, 8), brassMat);
  bellTop.position.y = -0.045;
  const clapper = new Mesh(new SphereGeometry(0.015, 8, 6), brassDark);
  clapper.position.y = -0.135;
  bell.add(rod(V3(0, 0, 0), V3(0, -0.04, 0), 0.006, brassDark), bellTop, bellMesh, clapper);
  root.add(bell);
  // 耳朵：叶片形（六角）的后视镜，装在铜杆上。
  const ears: Group[] = [];
  for (const s of [1, -1]) {
    const ear = new Group();
    ear.position.copy(fp(s * 1.0, 1.82, -0.04));
    const arm = rod(V3(0, 0, 0), V3(0, 0.02, s * 0.2), 0.012, brassMat);
    const plate = new Group();
    plate.position.set(0, 0.03, s * 0.24);
    const back = mesh(flat(ngon(6, 0.13, Math.PI / 6).map((p) => new Vector2(p.x * 0.85, p.y * 1.15)), 0.03), card(C.peach, 0.3));
    back.rotation.y = Math.PI / 2;
    const rim = mesh(flat(ngon(6, 0.14, Math.PI / 6).map((p) => new Vector2(p.x * 0.85, p.y * 1.15)), 0.02, [ngon(6, 0.11, Math.PI / 6).map((p) => new Vector2(p.x * 0.85, p.y * 1.15))]), [brassMat, brassDark]);
    rim.rotation.y = Math.PI / 2;
    rim.position.x = 0.018;
    const mirror = mesh(flat(ngon(6, 0.11, Math.PI / 6).map((p) => new Vector2(p.x * 0.85, p.y * 1.15)), 0.005), [mirrorMat, mirrorMat], false);
    mirror.rotation.y = Math.PI / 2;
    mirror.position.x = 0.022;
    plate.add(back, rim, mirror);
    ear.add(arm, plate);
    root.add(ear);
    ears.push(ear);
  }

  // ———— 车轮：八角的卡纸轮子，黄铜轮毂 ————
  for (const [x, s] of WHEELS) {
    const w = new Group();
    w.position.set(x, WHEEL_R, s * 0.98);
    // 轮胎：八片八角的深色卡纸叠起来，中间几片大、两边收一点，侧面看得见一层层纸。
    const tireGeos = [];
    const TL = 8;
    for (let k = 0; k < TL; k++) {
      const u = (k + 0.5) / TL - 0.5;
      const r = WHEEL_R * (1 - Math.pow(Math.abs(u) * 2, 3) * 0.08);
      const gk = flat(ngon(8, r, Math.PI / 8), 0.26 / TL);
      gk.translate(0, 0, u * 0.26 - 0.26 / TL / 2);
      tireGeos.push(gk);
    }
    const tire = mesh(merge(tireGeos), card(C.tire, 0.3));
    w.add(tire);
    // 胎面的一圈纹：八块深色的纸片贴在每一面上。
    for (let k = 0; k < 8; k++) {
      // 胎面：每一面贴一块更深的纸，用两颗小钉钉住。
      const a = (k / 8) * Math.PI * 2 + Math.PI / 4;
      const tread = cardBox(0.008, 0.2, 0.22, C.tireDark, 0.3);
      tread.position.set(Math.cos(a) * WHEEL_R * 0.927, Math.sin(a) * WHEEL_R * 0.927, 0);
      tread.rotation.z = a;
      w.add(tread);
    }
    const rim = mesh(flat(ngon(8, 0.3, Math.PI / 8), 0.04), card(C.creamLight, 0.3));
    rim.position.z = s * 0.13;
    if (s < 0) rim.rotation.y = Math.PI;
    const hubRing = mesh(flat(ngon(8, 0.22, Math.PI / 8), 0.03, [ngon(8, 0.15, Math.PI / 8)]), [brassMat, brassDark]);
    hubRing.position.z = s * 0.15;
    if (s < 0) hubRing.rotation.y = Math.PI;
    const hub = new Mesh(new CylinderGeometry(0.09, 0.1, 0.08, 6), brassMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.z = s * 0.17;
    hub.castShadow = true;
    w.add(rim, hubRing, hub);
    // 脚掌似的四颗大铆钉。
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const pad = new Mesh(new SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), brassMat);
      pad.rotation.x = s * Math.PI / 2;
      pad.position.set(Math.cos(a) * 0.19, Math.sin(a) * 0.19, s * 0.15);
      w.add(pad);
    }
    // 挡泥皮（脚边的一撮毛）。
    const flapM = mesh(flat([new Vector2(-0.1, 0), new Vector2(0.1, 0), new Vector2(0.12, -0.22), new Vector2(0.06, -0.26), new Vector2(0, -0.22), new Vector2(-0.06, -0.27), new Vector2(-0.12, -0.22)], 0.01), card(C.tireDark, 0.2));
    flapM.position.set(x + (x > 0 ? -ARCH + 0.06 : ARCH - 0.06), 0.36, s * 1.0);
    flapM.rotation.y = Math.PI / 2;
    (s > 0 ? root : nearSide).add(w);
    void flapM;
    // 轮子的倾斜的阴影：在车底下一点暗。
  }
  // 车底下的大梁、轴。
  const chassis = cardBox(3.6, 0.14, 1.3, C.chassis, 0.3);
  chassis.position.set(0.1, 0.46, 0);
  root.add(chassis);
  for (const [x] of WHEELS.slice(0, 2)) root.add(rod(V3(x, WHEEL_R, -0.9), V3(x, WHEEL_R, 0.9), 0.04, ironMat()));

  // ———— +z 侧：花窗、雕花板（放下是桌子）、徽章、通风口 ————
  const z = 1.006;
  const glassColors = [0x8fb3c4, 0xb9c98a, 0xe0c47a, 0x9cc0a6, 0xc9a7b8, 0x8fb3c4, 0xb9c98a, 0xe0c47a];
  const wc = new Vector2(0.62, 1.86);
  for (let k = 0; k < 8; k++) {
    const a0 = Math.PI / 8 + (k / 8) * Math.PI * 2;
    const a1 = a0 + Math.PI / 4;
    const r1 = 0.26;
    const r0 = 0.11;
    const pane = [V3(wc.x + Math.cos(a0) * r0, wc.y + Math.sin(a0) * r0, z - 0.02), V3(wc.x + Math.cos(a0) * r1, wc.y + Math.sin(a0) * r1, z - 0.02), V3(wc.x + Math.cos(a1) * r1, wc.y + Math.sin(a1) * r1, z - 0.02), V3(wc.x + Math.cos(a1) * r0, wc.y + Math.sin(a1) * r0, z - 0.02)];
    root.add(mesh(slab(pane, 0.006), [stained(glassColors[k]!), stained(glassColors[k]!)], false));
    root.add(strip([pane[0]!, pane[1]!].map((p) => p.clone().setZ(z)), V3(0, 0, 1), 0.014, 0.006));
  }
  root.add(mesh(slab(at(ngon(8, 0.11, Math.PI / 8).map((p) => p.add(wc)), z - 0.02), 0.006), [stained(0xd98a4a), stained(0xd98a4a)], false));
  root.add(strip(at(ngon(8, 0.115, Math.PI / 8).map((p) => p.add(wc)), z), V3(0, 0, 1), 0.016, 0.006, true));
  root.add(strip(at(ngon(8, 0.29, Math.PI / 8).map((p) => p.add(wc)), z), V3(0, 0, 1), 0.06, 0.016, true));
  for (const p of at(ngon(8, 0.29, Math.PI / 8).map((q) => q.add(wc)), z + 0.02)) rv.add(p, V3(0, 0, 1), 0.012);

  // 雕花板：一块木板，上面浮雕一只小狗，铰链在下沿；营地里放下来是一张桌子。
  const flap = new Group();
  flap.position.set(-0.42, 1.3, z + 0.012);
  const fw = 0.6;
  const fh = 0.62;
  const board = mesh(flat([new Vector2(-fw / 2, 0), new Vector2(fw / 2, 0), new Vector2(fw / 2, fh), new Vector2(-fw / 2, fh)], 0.03), card(C.woodLight, 0.25, 'wood'));
  board.position.z = 0.015;
  flap.add(board);
  const relief = mesh(flat(dogOutline().map((p) => new Vector2(p.x * 0.42, p.y * 0.42 + 0.14)), 0.012), card(C.wood, 0.2, 'wood'));
  relief.position.z = 0.036;
  flap.add(relief);
  flap.add(strip([V3(-fw / 2, 0, 0.032), V3(fw / 2, 0, 0.032), V3(fw / 2, fh, 0.032), V3(-fw / 2, fh, 0.032)], V3(0, 0, 1), 0.03, 0.008, true));
  const latch = cardBox(0.05, 0.06, 0.03, C.cream);
  latch.material = [brassMat, brassDark];
  latch.position.set(0, fh - 0.02, 0.05);
  flap.add(latch);
  for (const x of [-0.2, 0.2]) flap.add(put(hinge(0.1, 0.03, 0.004), { position: V3(x, 0, 0.004), rotation: { z: Math.PI / 2 } }));
  root.add(flap);

  // 徽章：腰线下挂着一排搪瓷小盾牌（一项专利一枚），盾牌上压一只小狗。
  const badges = new Group();
  const badgeTex = canvasTex(128, 160, (g) => {
    g.fillStyle = '#efe6cf';
    g.fillRect(0, 0, 128, 160);
    g.fillStyle = '#b28a4c';
    const d = dogOutline();
    g.beginPath();
    d.forEach((p, i) => (i ? g.lineTo(64 + p.x * 90, 110 - p.y * 90) : g.moveTo(64 + p.x * 90, 110 - p.y * 90)));
    g.closePath();
    g.fill();
  });
  const shield = [new Vector2(-0.065, 0.06), new Vector2(0.065, 0.06), new Vector2(0.065, -0.03), new Vector2(0, -0.09), new Vector2(-0.065, -0.03)];
  for (let i = 0; i < 7; i++) {
    const b = new Group();
    b.position.set(-0.95 + i * 0.22 + (i > 2 ? 0.24 : 0), 1.0, z + 0.03);
    const plate = mesh(flat(shield, 0.012, [], true), [new MeshStandardMaterial({ map: badgeTex, roughness: 0.55, metalness: 0.05 }), brassMat]);
    const rim = mesh(flat(shield.map((p) => p.clone().multiplyScalar(1.12)), 0.008, [shield]), [brassMat, brassDark]);
    rim.position.z = 0.004;
    b.add(plate, rim, rod(V3(0, 0.06, 0), V3(0, 0.1, 0), 0.006, brassMat));
    badges.add(b);
  }
  root.add(badges);
  // 通风口：车尾三道铜条。
  for (let i = 0; i < 3; i++) root.add(rod(V3(-1.85, 1.3 + i * 0.07, z + 0.02), V3(-1.62, 1.3 + i * 0.07, z + 0.02), 0.014, brassMat));

  // ———— 车顶：黄铜花丝的冠、风向标、烟囱、遮阳篷的卷筒 ————
  const crown = new Group();
  const cx0 = -0.35;
  const cx1 = 1.12;
  const cz = 0.6;
  const ry = ROOF + 0.02;
  const H = 0.2;
  for (const [a, b] of [
    [V3(cx0, ry + H, -cz), V3(cx1, ry + H, -cz)],
    [V3(cx0, ry + H, cz), V3(cx1, ry + H, cz)],
    [V3(cx1, ry + H, -cz), V3(cx1, ry + H, cz)],
    [V3(cx0, ry + H, -cz), V3(cx0, ry + H, cz)],
    [V3(cx0, ry + 0.04, -cz), V3(cx1, ry + 0.04, -cz)],
    [V3(cx0, ry + 0.04, cz), V3(cx1, ry + 0.04, cz)],
    [V3(cx1, ry + 0.04, -cz), V3(cx1, ry + 0.04, cz)],
  ] as const)
    crown.add(rod(a, b, 0.016, brassMat, 8));
  const posts: Vector3[] = [];
  for (let i = 0; i <= 5; i++) {
    const x = cx0 + ((cx1 - cx0) * i) / 5;
    posts.push(V3(x, 0, cz), V3(x, 0, -cz));
  }
  for (let i = 0; i <= 3; i++) posts.push(V3(cx1, 0, -cz + (2 * cz * i) / 3));
  for (const p of posts) {
    crown.add(rod(V3(p.x, ry - 0.02, p.z), V3(p.x, ry + H + 0.02, p.z), 0.014, brassMat, 8));
    const knob = new Mesh(new SphereGeometry(0.024, 10, 8), brassMat);
    knob.position.set(p.x, ry + H + 0.03, p.z);
    crown.add(knob);
  }
  // 花丝：每两根柱子之间一对相对卷的涡卷。
  const scroll = (c: Vector3, dir: Vector3, flip: number): Mesh => {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = flip * t * Math.PI * 2.6;
      const r = 0.07 * (1 - t * 0.78);
      pts.push(c.clone().addScaledVector(dir, Math.cos(a) * r * flip).add(V3(0, Math.sin(a) * r, 0)));
    }
    const m = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), 60, 0.006, 5), brassMat);
    m.castShadow = true;
    return m;
  };
  for (let i = 0; i < 5; i++) {
    const xa = cx0 + ((cx1 - cx0) * i) / 5;
    const xb = cx0 + ((cx1 - cx0) * (i + 1)) / 5;
    for (const zz of [cz, -cz]) {
      crown.add(scroll(V3(xa + (xb - xa) * 0.3, ry + 0.12, zz), V3(1, 0, 0), 1));
      crown.add(scroll(V3(xa + (xb - xa) * 0.7, ry + 0.12, zz), V3(1, 0, 0), -1));
    }
  }
  for (let i = 0; i < 3; i++) {
    const za = -cz + (2 * cz * i) / 3;
    const zb = -cz + (2 * cz * (i + 1)) / 3;
    crown.add(scroll(V3(cx1, ry + 0.12, za + (zb - za) * 0.3), V3(0, 0, 1), 1));
    crown.add(scroll(V3(cx1, ry + 0.12, za + (zb - za) * 0.7), V3(0, 0, 1), -1));
  }
  root.add(crown);
  // 风向标：冠的前沿正中，一根杆、一支箭、一只小狗（最新一项专利的动物）。
  const vane = new Group();
  vane.position.set(cx1 - 0.08, ry + H, 0);
  vane.add(rod(V3(0, 0, 0), V3(0, 0.42, 0), 0.012, brassMat));
  const vaneTop = new Group();
  vaneTop.position.y = 0.36;
  const dog = mesh(flat(dogOutline().map((p) => new Vector2(p.x * 0.32, p.y * 0.32 + 0.04)), 0.012), [brassMat, brassDark]);
  vaneTop.add(dog);
  vaneTop.add(rod(V3(-0.2, 0.02, 0), V3(0.2, 0.02, 0), 0.006, brassMat));
  const tip = mesh(flat([new Vector2(0.2, -0.03), new Vector2(0.27, 0.02), new Vector2(0.2, 0.07)], 0.008), [brassMat, brassDark]);
  vaneTop.add(tip);
  const fletch = mesh(flat([new Vector2(-0.2, 0.02), new Vector2(-0.27, 0.07), new Vector2(-0.24, 0.02), new Vector2(-0.27, -0.03)], 0.008), [brassMat, brassDark]);
  vaneTop.add(fletch);
  for (const [i, ax] of [[0, 'x'], [1, 'z']] as const) {
    void i;
    const bar = rod(V3(0, 0.27, 0), ax === 'x' ? V3(0.09, 0.27, 0) : V3(0, 0.27, 0.09), 0.004, brassDark);
    vane.add(bar);
  }
  vane.add(vaneTop);
  vane.userData['top'] = vaneTop;
  root.add(vane);
  // 烟囱：一截铁皮管，顶上一顶小帽。
  const chim = new Group();
  chim.position.set(0.82, ROOF, -0.42);
  // 烟囱：一截深灰卡纸卷的筒，一顶卷锥的帽（三根细条撑着），根上一圈金卡纸箍。
  const pipe = rolled(0.065, 0.06, 0.36, 0.006, 0x57514b, 16);
  const capM = rolled(0.12, 0.02, 0.07, 0.004, 0x57514b, 16);
  capM.position.y = 0.4;
  const collar = strip(ngon(16, 0.066).map((p) => V3(p.x, 0.04, p.y)), V3(0, 1, 0), 0.04, 0.004, true);
  chim.add(pipe, capM, collar);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    chim.add(put(cardBox(0.008, 0.05, 0.004, 0x57514b, 0.1), { position: V3(Math.cos(a) * 0.05, 0.385, Math.sin(a) * 0.05), rotation: { y: -a } }));
  }
  root.add(chim);
  const smoke: Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const puff = new Mesh(new SphereGeometry(0.06, 10, 8), paperMaterial(0xf6f2ea, { kind: 'kraft', scale: 0.1 }));
    puff.position.set(0.82, ROOF + 0.5, -0.42);
    puff.userData['phase'] = i / 4;
    root.add(puff);
    smoke.push(puff);
  }

  // 遮阳篷：平时卷在 +z 侧车顶边上的条纹帆布卷；营地里放下来，两根撑杆。
  const stripes = stripeTex();
  stripes.repeat.set(6, 1);
  const canvasMat = new MeshStandardMaterial({ map: stripes, roughness: 1, side: DoubleSide });
  const awningRoll = new Group();
  const roll = new Mesh(new CylinderGeometry(0.11, 0.11, 2.6, 16), canvasMat);
  roll.rotation.z = Math.PI / 2;
  roll.castShadow = true;
  awningRoll.add(roll);
  for (const x of [-1.3, 1.3]) {
    const capR = new Mesh(new CylinderGeometry(0.125, 0.125, 0.04, 16), brassMat);
    capR.rotation.z = Math.PI / 2;
    capR.position.x = x;
    awningRoll.add(capR);
  }
  for (const x of [-0.8, 0, 0.8]) {
    const strap = new Mesh(new TorusGeometry(0.115, 0.012, 6, 20), new MeshStandardMaterial({ color: C.leather, roughness: 0.8 }));
    strap.rotation.y = Math.PI / 2;
    strap.position.x = x;
    awningRoll.add(strap);
  }
  awningRoll.position.set(-0.6, ROOF - 0.04, 0.9);
  root.add(awningRoll);
  const awning = new Group();
  {
    const ax0 = -1.95;
    const ax1 = 0.75;
    const out = 1.7;
    const drop = 0.32;
    const g = new Group();
    // 篷布：一张略微下垂的布（几行折线），下摆是一圈扇贝边。
    const rows = 6;
    const cols = 24;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let r = 0; r <= rows; r++)
      for (let c = 0; c <= cols; c++) {
        const u = c / cols;
        const v = r / rows;
        const x = ax0 + (ax1 - ax0) * u;
        const zz = 1.0 + out * v;
        const sag = Math.sin(v * Math.PI) * 0.06 + Math.sin(u * Math.PI * 4) * 0.012 * v;
        pos.push(x, WALL_TOP + 0.3 - drop * v - sag, zz);
        uv.push(u, v);
      }
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const a = r * (cols + 1) + c;
        idx.push(a, a + cols + 1, a + 1, a + 1, a + cols + 1, a + cols + 2);
      }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const sheet = new Mesh(geo, canvasMat);
    sheet.castShadow = true;
    sheet.receiveShadow = true;
    g.add(sheet);
    // 扇贝边：一排半圆的布片。
    const n = 12;
    for (let i = 0; i < n; i++) {
      const x0 = ax0 + ((ax1 - ax0) * i) / n;
      const x1 = ax0 + ((ax1 - ax0) * (i + 1)) / n;
      const sc: Vector2[] = [];
      for (let k = 0; k <= 8; k++) {
        const a = Math.PI + (k / 8) * Math.PI;
        sc.push(new Vector2((x0 + x1) / 2 + Math.cos(a) * (x1 - x0) / 2, Math.sin(a) * 0.09));
      }
      const scal = mesh(flat(sc, 0.004), [new MeshStandardMaterial({ color: i % 2 ? 0xa9bcbc : 0xefe7d4, roughness: 1, side: DoubleSide }), brassMat]);
      scal.position.set(0, WALL_TOP + 0.3 - drop, 1.0 + out + 0.002);
      g.add(scal);
    }
    // 前沿一根铜杆，两根撑杆，两根拉绳。
    g.add(rod(V3(ax0, WALL_TOP + 0.3 - drop, 1.0 + out), V3(ax1, WALL_TOP + 0.3 - drop, 1.0 + out), 0.018, brassMat));
    for (const x of [ax0 + 0.15, ax1 - 0.15]) {
      g.add(rod(V3(x, 0, 1.0 + out), V3(x, WALL_TOP + 0.3 - drop, 1.0 + out), 0.022, woodRod()));
      const rope = twine(hang(V3(x, WALL_TOP + 0.3 - drop, 1.0 + out), V3(x, 0.02, 1.0 + out + 0.8), 0.03), 0.008);
      g.add(rope);
      const peg = new Mesh(new CylinderGeometry(0.01, 0.005, 0.12, 6), woodRod());
      peg.position.set(x, 0.04, 1.0 + out + 0.8);
      g.add(peg);
    }
    awning.add(g);
  }
  awning.visible = false;
  root.add(awning);

  // 尾巴：车尾左下角垂下一根编起来的绳子，末端一只流苏。
  const tailCurve = new CatmullRomCurve3([V3(XR - 0.02, 0.8, -0.86), V3(XR - 0.12, 0.62, -0.95), V3(XR - 0.1, 0.42, -1.02), V3(XR - 0.04, 0.3, -1.06)]);
  const tail = new Mesh(new TubeGeometry(tailCurve, 8, 0.001, 3), brassMat);
  tail.visible = false;
  root.add(twine(tailCurve, 0.024, 30));
  const tassel = new Group();
  const tasselCap = new Mesh(new SphereGeometry(0.04, 10, 8), brassMat);
  const tasselBody = new Mesh(new CylinderGeometry(0.03, 0.06, 0.12, 10), new MeshStandardMaterial({ color: 0xc8a45a, roughness: 0.9 }));
  tasselBody.position.y = -0.08;
  tassel.add(tasselCap, tasselBody);
  tassel.position.copy(tailCurve.getPoint(1));
  tail.userData['tassel'] = tassel;
  root.add(tail, tassel);

  // 一盏在车里亮着的眼睛光（夜里眼睛是暖的）。
  const eyeGlow = eyeGlass;

  root.add(rv.build());
  nearSide.add(rvNear.build());
  return {
    root,
    nearSide,
    lids,
    smallLids,
    ears,
    doors,
    flap,
    awning,
    awningRoll,
    tail,
    tailCurve,
    vane,
    letter,
    bell,
    smoke,
    badges,
    eyeGlow,
    interior,
  };
}

/** 把一个在自己的 xy 平面里画好、朝 +z 的东西，贴到车头那一面上（法线 n）。 */
function placeOnFace(o: { position: Vector3; quaternion: Quaternion }, p: Vector3, n: Vector3): void {
  o.position.copy(p);
  // 零件的 +z 对准法线、+y 大致朝上；从车外看，零件的 +x 是车的 -z。
  const xAxis = new Vector3().crossVectors(V3(0, 1, 0), n).normalize();
  const yAxis = new Vector3().crossVectors(n, xAxis).normalize();
  o.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(xAxis, yAxis, n));
}

const glassMat = new MeshStandardMaterial({ color: 0xcfe2e4, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false });
const eyeGlass = new MeshStandardMaterial({ color: 0xe9eee6, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.55, emissive: 0xffd9a0, emissiveIntensity: 0.0 });
const mirrorMat = new MeshStandardMaterial({ color: 0xd8e2e2, metalness: 0.9, roughness: 0.12 });
const stainedCache = new Map<number, MeshStandardMaterial>();
function stained(c: number): MeshStandardMaterial {
  let m = stainedCache.get(c);
  if (!m) stainedCache.set(c, (m = new MeshStandardMaterial({ color: c, roughness: 0.2, transparent: true, opacity: 0.78, emissive: c, emissiveIntensity: 0.25 })));
  return m;
}
let iron: MeshStandardMaterial | null = null;
function ironMat(): MeshStandardMaterial {
  return (iron ??= new MeshStandardMaterial({ color: 0x57514b, metalness: 0.5, roughness: 0.6 }));
}
let woodR: Material | null = null;
function woodRod(): Material {
  return (woodR ??= paperMaterial(C.wood, { kind: 'wood', scale: 0.1 }));
}

/** 上半个正八角（平底在 y=0），r 是外接圆半径。 */
function halfOct(r: number): Vector2[] {
  const c1 = Math.cos(Math.PI / 8) * r;
  const s1 = Math.sin(Math.PI / 8) * r;
  return [new Vector2(c1, 0), new Vector2(c1, s1), new Vector2(s1, c1), new Vector2(-s1, c1), new Vector2(-c1, s1), new Vector2(-c1, 0)];
}

/** 上半个正六角（平底在 y=0）。 */
function halfHex(r: number): Vector2[] {
  return [new Vector2(r, 0), new Vector2(r / 2, r * 0.866), new Vector2(-r / 2, r * 0.866), new Vector2(-r, 0)];
}
