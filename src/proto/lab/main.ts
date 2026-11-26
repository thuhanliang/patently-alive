import { BoxGeometry, ExtrudeGeometry, Group, Mesh, Shape, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { card, flat, ngon } from '../../render/three/craft';
import { buildNose } from '../../render/three/parts/nose';
import { buildWheel } from '../../render/three/parts/wheel';
import { buildWindshield } from '../../render/three/parts/windshield';
import { Stage } from '../../render/three/stage';

/**
 * 部件实验台（2026-11-26）：效果图的一个局部（左）和同一个角度的 3D（右）并排，一件一件做到看不出差别。
 * ?part=wheel；?ref=0 不显示参考；?manual=1 给截图脚本用。
 */
const q = new URLSearchParams(location.search);
const part = q.get('part') ?? 'wheel';
interface PartDef {
  sun?: [number, number, number];
  build: () => Group;
  ref: string;
  cam: { pos: [number, number, number]; target: [number, number, number]; fov: number };
  /** 在整张效果图（6-overall.jpg，2000 × 1500）上取景的范围 [x, y, w, h]；用共享镜头 + 偏移取景，和效果图同一个镜头。 */
  crop?: [number, number, number, number];
}
/**
 * 共享镜头（车鼻子、挡风玻璃用同一个）：车鼻子的 14 个点 + 轮毂（正八边形）的屏幕比联合拟合出来
 * （scripts/lab/fit-joint.py）。偏转 40.1°、俯视 16.4°、视场角 9.2°，车鼻子拟合误差 2.9 像素。
 * 车鼻子参考图是整图里 (170, 650) 起 350 × 250 的一块，镜头主点就在它的中心 (345, 775)。
 */
const CAM = { pos: [3.877, 2.901, 4.67] as [number, number, number], target: [2.024, 2.054, 2.467] as [number, number, number], fov: 9.166, cx: 345, cy: 775, h: 250 };
/** 引擎盖 + 下面的车身：侧面轮廓是一个楔形（前脸顶 → 斜着抬到窗台 → 往下到底），整块挤出，没有缝。 */
function hoodWedge(): Mesh {
  const zFront = 0.0;
  const zBack = -1.2;
  const yBottom = 0.583;
  // 轮廓放在 (a = -z, b = y) 平面里；挤出后绕 y 转 90°，让挤出方向对上 x。
  const sh = new Shape();
  sh.moveTo(-zFront, yBottom);
  sh.lineTo(-zFront, 1.435); // 车鼻子顶
  sh.lineTo(1.12, 1.745); // 窗台下沿（斜着抬高，约 15°）
  sh.lineTo(-zBack, 1.745);
  sh.lineTo(-zBack, yBottom);
  const w = 1.52;
  const geo = new ExtrudeGeometry(sh, { depth: w, bevelEnabled: false });
  geo.rotateY(Math.PI / 2); // (a, b, c) -> (c, b, -a)：world z = -a，world x = c
  geo.translate(-w / 2, 0, 0);
  const m = new Mesh(geo, card(0xe6d8c0, 0.6)[0]!);
  m.castShadow = m.receiveShadow = true;
  return m;
}
/** 车头的占位：车鼻子 + 引擎盖楔形 + 驾驶室两侧和车顶（看挡风玻璃时给它一个上下文）。 */
function cabContext(): Group {
  const g = new Group();
  g.add(buildNose());
  g.add(hoodWedge());
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, col = 0xe8dcc6): void => {
    const b = new Mesh(new BoxGeometry(w, h, d), card(col, 0.6)[0]!);
    b.position.set(x, y, z);
    b.castShadow = b.receiveShadow = true;
    g.add(b);
  };
  for (const s of [-1, 1]) add(0.06, 1.9, 1.8, s * 0.79, 1.5, -2.1); // 驾驶室两侧（从 A 柱后面开始）
  add(1.64, 0.06, 1.9, 0, 2.53, -2.2); // 车顶
  // 驾驶室里面：深色的后壁和仪表台（透过玻璃看进去是暗的，帘片才显得出来）。
  add(1.5, 0.95, 0.04, 0, 2.1, -2.9, 0x5c4a3a);
  add(1.5, 0.12, 0.4, 0, 1.7, -1.5, 0x6a5440);
  return g;
}
const PARTS: Record<string, PartDef> = {
  nose: {
    // 车头正面朝着左前方的太阳（效果图里车头是亮的）。
    sun: [-2.5, 9, 3.5],
    build: () => cabContext(),
    ref: './lab/ref-nose.jpg',
    cam: { pos: CAM.pos, target: CAM.target, fov: CAM.fov },
  },
  windshield: {
    sun: [-2.5, 9, 3.5],
    build: () => {
      const g = cabContext();
      const lid = Number(q.get('lid') ?? '0.8');
      const ws = buildWindshield(lid, Number(q.get('lidR') ?? lid));
      g.add(ws.group);
      (window as unknown as { lids: unknown }).lids = ws.setLids;
      return g;
    },
    ref: './lab/ref-windshield.jpg',
    cam: { pos: CAM.pos, target: CAM.target, fov: CAM.fov },
    crop: (q.get('crop')?.split(',').map(Number) as [number, number, number, number] | undefined) ?? [300, 360, 480, 300],
  },
  wheel: {
    build: () => {
      const g = new Group();
      const w = buildWheel(0.42);
      w.position.set(0, 0.42, 0);
      g.add(w);
      // 车身：轮子上方一块（挡住太阳，轮子在车身的影子里），轮拱。
      const body = new Mesh(new BoxGeometry(2.4, 1.4, 1.6), card(0xdccbad, 0.6)[0]!);
      body.position.set(0, 1.62, -0.55);
      body.castShadow = body.receiveShadow = true;
      g.add(body);
      return g;
    },
    ref: './lab/ref-wheel.jpg',
    cam: { pos: [-1.05, 0.85, 2.05], target: [0.02, 0.42, 0], fov: 26 },
  },
};
const def = PARTS[part] ?? PARTS['wheel']!;
// ?cam=px,py,pz,tx,ty,tz,fov：对镜头用（叠图对齐时一轮轮改）。
if (q.get('cam')) {
  const v = q.get('cam')!.split(',').map(Number);
  def.cam = { pos: [v[0]!, v[1]!, v[2]!], target: [v[3]!, v[4]!, v[5]!], fov: v[6] ?? def.cam.fov };
}
const ref = document.getElementById('ref')!;
if (q.get('ref') === '0') ref.classList.add('off');
else ref.style.backgroundImage = `url(${def.ref})`;
const st = new Stage(document.getElementById('stage')!, { extent: 2 });
// 地面：一张浅灰褐的纸。
const ground = new Mesh(flat(ngon(48, 6), 0.01), card(0xcfc6b6, 1.2, 'kraft'));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
st.scene.add(ground);
st.scene.add(def.build());
if (def.sun) st.sun.position.set(...def.sun);
if (part === 'nose' || part === 'windshield') {
  // 太阳强一点、天光弱一点：零件下面要有清楚的投影（审核意见：没有投影，零件像贴在墙上）。
  st.sun.intensity = 3.0;
  st.sky.intensity = 0.5;
  st.renderer.toneMappingExposure = 0.9;
}
st.camera.fov = def.cam.fov;
st.camera.position.set(...def.cam.pos);
const target = new Vector3(...def.cam.target);
st.camera.lookAt(target);
if (def.crop && !q.get('cam')) {
  // 整图取景：虚拟的"整张底片"以镜头主点为中心，取 crop 那一块（宽高比要和画布一致）。
  const Hf = 3000;
  const Wf = 4200;
  st.camera.fov = (2 * Math.atan((Math.tan((CAM.fov * Math.PI) / 360) * Hf) / CAM.h) * 180) / Math.PI;
  st.camera.aspect = Wf / Hf;
  const [cx, cy, cw, ch] = def.crop;
  st.camera.setViewOffset(Wf, Hf, cx - (CAM.cx - Wf / 2), cy - (CAM.cy - Hf / 2), cw, ch);
}
st.camera.updateProjectionMatrix();
const ctl = new OrbitControls(st.camera, st.renderer.domElement);
ctl.target.copy(target);
ctl.update();
if (q.get('manual') === '1') {
  (window as unknown as { lab: unknown }).lab = {
    render(): void {
      st.render(1 / 30);
    },
    set(k: string, v: number): void {
      (st.ao.configuration as unknown as Record<string, number>)[k] = v;
    },
  };
} else {
  const loop = (): void => {
    ctl.update();
    st.render(1 / 60);
    requestAnimationFrame(loop);
  };
  loop();
}
