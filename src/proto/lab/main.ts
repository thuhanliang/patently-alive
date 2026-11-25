import { BoxGeometry, Group, Mesh, Vector3 } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { card, flat, ngon } from '../../render/three/craft';
import { buildWheel } from '../../render/three/parts/wheel';
import { Stage } from '../../render/three/stage';

/**
 * 部件实验台（2026-11-26）：效果图的一个局部（左）和同一个角度的 3D（右）并排，一件一件做到看不出差别。
 * ?part=wheel；?ref=0 不显示参考；?manual=1 给截图脚本用。
 */
const q = new URLSearchParams(location.search);
const part = q.get('part') ?? 'wheel';
interface PartDef {
  build: () => Group;
  ref: string;
  cam: { pos: [number, number, number]; target: [number, number, number]; fov: number };
}
const PARTS: Record<string, PartDef> = {
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
    cam: { pos: [-1.55, 0.8, 1.75], target: [0.0, 0.4, 0], fov: 26 },
  },
};
const def = PARTS[part] ?? PARTS['wheel']!;
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
