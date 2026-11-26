import { BoxGeometry, ExtrudeGeometry, Group, Mesh, Shape, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { card, flat, ngon } from '../../render/three/craft';
import { buildNose } from '../../render/three/parts/nose';
import { buildVan } from '../../render/three/parts/van';
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
 * 共享镜头（2026-11-26 重做）：平行（轴测）投影——偏转 49°、俯视 12°，由车身上的长直边定
 * （自动检测的直线族 48.3°/11.1°、用户手画三轴 49.4°/12.6°、灯是正八边形 50° 三个来源一致；
 * scripts/lab/fit-ortho.py、lines-vp.py）。用一台离得很远（80 米）、视场角很小的透视相机模拟，
 * 取景范围 = 整张效果图（2000 × 1500 像素）里的一块（?crop=x,y,w,h，单位像素），和效果图是同一个镜头。
 * 比例：整图 236.7 像素 / 米；世界坐标：x 车宽、y 向上、z 向车头，车头正面在 z = 0.05。
 */
const CAM = { pos: [60.647, 17.756, 49.145] as [number, number, number], target: [1.59, 1.123, -2.192] as [number, number, number], fov: 4.536 };
const FILM = { w: 2000, h: 1500 };
/** 引擎盖 + 下面的车身：侧面轮廓是一个楔形（前脸顶 → 斜着抬到窗台 → 往下到底），整块挤出，没有缝。 */
function hoodWedge(): Mesh {
  const zFront = 0.0;
  const zBack = -1.2;
  const yBottom = 0.52;
  // 轮廓放在 (a = -z, b = y) 平面里；挤出后绕 y 转 90°，让挤出方向对上 x。
  const sh = new Shape();
  sh.moveTo(-zFront, yBottom);
  sh.lineTo(-zFront, 1.44); // 车鼻子顶
  sh.lineTo(1.1, 1.79); // 窗台下沿（斜着抬高，约 17°）
  sh.lineTo(-zBack, 1.79);
  sh.lineTo(-zBack, yBottom);
  const w = 1.56;
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
  for (const s of [-1, 1]) add(0.06, 2.0, 1.7, s * 0.8, 1.55, -1.95); // 驾驶室两侧
  add(1.66, 0.06, 1.9, 0, 2.58, -2.0); // 车顶
  // 驾驶室里面：深色的后壁和仪表台（透过玻璃看进去是暗的，帘片才显得出来）。
  add(1.5, 0.95, 0.04, 0, 2.1, -2.8, 0x5c4a3a);
  add(1.5, 0.12, 0.4, 0, 1.78, -1.5, 0x6a5440);
  return g;
}
const PARTS: Record<string, PartDef> = {
  nose: {
    // 车头正面朝着左前方的太阳（效果图里车头是亮的）。
    sun: [-2.5, 9, 3.5],
    build: () => cabContext(),
    ref: './lab/ref-nose.jpg',
    cam: { pos: CAM.pos, target: CAM.target, fov: CAM.fov },
    crop: (q.get('crop')?.split(',').map(Number) as [number, number, number, number] | undefined) ?? [170, 650, 350, 250],
  },
  van: {
    sun: [-2.5, 9, 3.5],
    build: () => buildVan(),
    ref: './lab/ref-nose.jpg',
    cam: { pos: CAM.pos, target: CAM.target, fov: CAM.fov },
    crop: (q.get('crop')?.split(',').map(Number) as [number, number, number, number] | undefined) ?? [80, 60, 1760, 1320],
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
if (part === 'nose' || part === 'windshield' || part === 'van') {
  // 太阳强一点、天光弱一点：零件下面要有清楚的投影（审核意见：没有投影，零件像贴在墙上）。
  st.sun.intensity = 3.0;
  st.sky.intensity = 0.4;
  st.renderer.toneMappingExposure = part === 'van' ? 0.72 : 0.9;
}
st.camera.fov = def.cam.fov;
st.camera.position.set(...def.cam.pos);
const target = new Vector3(...def.cam.target);
st.camera.lookAt(target);
if (def.crop && !q.get('cam')) {
  const [cx, cy, cw, ch] = def.crop;
  st.camera.aspect = FILM.w / FILM.h;
  st.camera.setViewOffset(FILM.w, FILM.h, cx, cy, cw, ch);
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
