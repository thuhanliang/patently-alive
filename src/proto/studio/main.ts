import { Raycaster, Vector2, Vector3, type Object3D } from 'three';
import { Island3D } from '../../render/three/island3d';
import { islandOf } from '../../render/three/van/islandData';
import { VanScene } from '../../render/three/van/scene';
import { Van } from '../../render/three/van/van';
import type { InteriorItem } from '../../render/three/van/interior';
import '../../ui/style/theme.css';

/**
 * 家（2026-11-25）：事务所的车「阿宝」，剖开来看里面（docs/research/studio.md）。
 * 鼠标停在一件东西上，它亮一下、旁边飘出纸签；点托盘里的岛，镜头扎进去换成全屏的岛；
 * 在岛上，阿宝支着篷子停在岸边打盹，点它就倒着飞回车里。
 * ?scenario=… 换岛；?manual=1 给截图脚本一帧一帧地推（window.st）。
 */
const q = new URLSearchParams(location.search);
const isl = islandOf(q.get('scenario') ?? 'garden-island');
const sc = new VanScene(document.getElementById('studio')!, { island: isl });
sc.setView('inside', true);
const mapHost = document.getElementById('map')!;
const tag = document.getElementById('tag')!;
const hint = document.getElementById('hint')!;
let island: Island3D | null = null;
let campVan: Van | null = null;
let mode: 'home' | 'diving' | 'map' | 'leaving' = 'home';

// ———— 悬停和点击 ————
const ray = new Raycaster();
const items = sc.van.inside.items;
let hovered: InteriorItem | null = null;
function itemAt(x: number, y: number): InteriorItem | null {
  const r = sc.renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), sc.camera);
  const hits = ray.intersectObjects(
    items.map((i) => i.obj),
    true,
  );
  for (const h of hits) {
    let o: Object3D | null = h.object;
    while (o) {
      const it = items.find((i) => i.obj === o);
      if (it) return it;
      o = o.parent;
    }
  }
  return null;
}
function setHover(it: InteriorItem | null, x: number, y: number): void {
  hovered = it;
  sc.renderer.domElement.style.cursor = it ? 'pointer' : 'default';
  if (!it) {
    tag.style.opacity = '0';
    return;
  }
  tag.innerHTML = `<b>${it.name}</b>${it.hint}`;
  tag.style.left = `${x}px`;
  tag.style.top = `${y}px`;
  tag.style.opacity = '1';
}
sc.renderer.domElement.addEventListener('pointermove', (e) => {
  if (mode !== 'home' || sc.flying) return;
  setHover(itemAt(e.clientX, e.clientY), e.clientX, e.clientY);
});
sc.renderer.domElement.addEventListener('click', (e) => {
  if (mode !== 'home' || sc.flying) return;
  const it = itemAt(e.clientX, e.clientY);
  if (!it) return;
  act(it.id);
});
function act(id: string): void {
  if (id === 'island') dive();
  else if (id === 'lamp') sc.van.inside.lamp.visible = !sc.van.inside.lamp.visible;
  else if (id === 'mail') sc.van.ping();
}

// ———— 走进岛、回来 ————
/** 地图一进来时的镜头（岛的坐标）。 */
const MAP_START = { x: 0, z: 4, dist: 46 };
function dive(): void {
  if (mode !== 'home' || !sc.islandInner) return;
  mode = 'diving';
  setHover(null, 0, 0);
  hint.style.opacity = '0';
  if (!island) {
    island = new Island3D(mapHost, isl.input, isl.field);
    campVan = new Van();
    campVan.setCamp(true);
    campVan.setEyes(0.05);
    island.placeCamp(campVan.root, 0.32);
    island.campPick = leave;
  }
  island.cam.set(MAP_START.x, MAP_START.z, MAP_START.dist);
  island.update(0, false);
  const inner = sc.islandInner;
  inner.updateWorldMatrix(true, false);
  const pos = inner.localToWorld(island.camera.position.clone());
  const target = inner.localToWorld(island.cam.lookTarget());
  sc.flyTo({ pos, target, fov: island.camera.fov }, 1900, () => {
    mapHost.classList.add('on');
    window.setTimeout(() => (mode = 'map'), 700);
  });
}
function leave(): void {
  if (mode !== 'map' || !island || !sc.islandInner) return;
  mode = 'leaving';
  const inner = sc.islandInner;
  inner.updateWorldMatrix(true, false);
  const pos = inner.localToWorld(island.camera.position.clone());
  const target = inner.localToWorld(island.cam.lookTarget());
  sc.flyTo({ pos, target, fov: island.camera.fov }, 0);
  mapHost.classList.remove('on');
  window.setTimeout(
    () =>
      sc.flyTo(VanScene.pose('inside'), 1700, () => {
        mode = 'home';
        hint.style.opacity = '1';
      }),
    450,
  );
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') leave();
});

function frame(dt: number, render = true): void {
  if (mode !== 'map') sc.update(dt, render);
  if (island && mode !== 'home') {
    campVan?.update(dt);
    island.update(dt, render && (mode === 'map' || mapHost.classList.contains('on')));
  }
}

const veil = document.getElementById('veil')!;
if (q.get('manual') === '1') {
  (window as unknown as { st: unknown }).st = {
    step(dt: number, k: number): void {
      for (let i = 0; i < k; i++) frame(dt, i === k - 1);
    },
    dive,
    leave,
    hover(id: string, x = 900, y = 420): void {
      setHover(items.find((i) => i.id === id) ?? null, x, y);
    },
    act,
    look(x: number, z: number, d: number, yaw = 0, tilt = 0): void {
      island?.cam.set(x, z, d, yaw, tilt);
    },
    campAt(): number[] {
      return island ? [island.camp.position.x, island.camp.position.z] : [];
    },
    get mode(): string {
      return mode;
    },
  };
  veil.remove();
} else {
  let last = performance.now();
  const loop = (t: number): void => {
    frame(Math.min(0.05, (t - last) / 1000));
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame((t) => {
    last = t;
    loop(t);
    veil.style.opacity = '0';
    window.setTimeout(() => veil.remove(), 1000);
  });
}
void Vector3;
