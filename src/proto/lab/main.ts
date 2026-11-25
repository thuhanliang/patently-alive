import { BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { card, flat, ngon } from '../../render/three/craft';
import { buildNose } from '../../render/three/parts/nose';
import { buildWheel } from '../../render/three/parts/wheel';
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
}
const PARTS: Record<string, PartDef> = {
  nose: {
    // 车头正面朝着左前方的太阳（效果图里车头是亮的）。
    sun: [-5, 6, 7],
    build: () => {
      const g = new Group();
      const n = buildNose();
      g.add(n);
      // 车鼻子顶面（一块倾斜的厚板）和后面的车身，让轮廓完整。
      const hood = new Mesh(new BoxGeometry(1.45, 0.08, 0.9), card(0xe3d4b6, 0.6));
      hood.position.set(0, 1.46, -0.4);
      hood.castShadow = hood.receiveShadow = true;
      const body = new Mesh(new BoxGeometry(1.45, 1.5, 0.2), card(0xe3d4b6, 0.6));
      body.position.set(0, 1.0, -0.6);
      g.add(hood, body);
      return g;
    },
    ref: './lab/ref-nose.jpg',
    cam: { pos: [-1.35, 1.42, 1.95], target: [0.04, 0.98, 0.05], fov: 26 },
  },
  wheel: {
    build: () => {
      const g = new Group();
      const w = buildWheel(0.42);
      w.position.set(0, 0.42, 0);
      g.add(w);
      // 车身：轮子上方一块（挡住太阳，轮子在车身的影子里），轮拱。
      const body = new Mesh(new BoxGeometry(2.4, 1.4, 1.6), card(0xdccbad, 0.6));
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
if (part === 'nose') {
  st.sun.intensity = 2.1;
  st.renderer.toneMappingExposure = 0.88;
}
st.camera.fov = def.cam.fov;
st.camera.position.set(...def.cam.pos);
st.camera.updateProjectionMatrix();
const target = new Vector3(...def.cam.target);
st.camera.lookAt(target);
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
