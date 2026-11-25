import { Euler, Object3D, Plane, Quaternion, Raycaster, Vector2, Vector3 } from 'three';
import { scenarioLibrary } from '../../data';
import { Island3D } from '../../render/three/island3d';
import { islandOf } from '../../render/three/van/islandData';
import type { InteriorItem } from '../../render/three/van/interior';
import { VanScene } from '../../render/three/van/scene';
import { Van } from '../../render/three/van/van';
import { Walker } from '../../render/three/van/walker';
import '../../ui/style/theme.css';

/**
 * 家（2026-11-25 第二版）：事务所的车「勾勾」，第一人称在车里走、在车外绕（docs/research/studio.md）。
 * 车里的东西点了会自己动：抽屉拉开、皮箱盖翻开、灯开关、方向盘一转勾勾摇铃；卡片、草图、来信能拿起来细看；
 * 点椅子坐下；点零件盘打开设计台；点托盘里的岛走进全屏的岛，岛上点岸边的勾勾回来。
 * ?scenario=… 换岛；?manual=1 给截图脚本一帧一帧地推（window.st）。
 */
const q = new URLSearchParams(location.search);
const scenarioId = q.get('scenario') ?? 'garden-island';
const scenario = scenarioLibrary.get(scenarioId) ?? scenarioLibrary.get('garden-island')!;
const isl = islandOf(scenario.id);
const sc = new VanScene(document.getElementById('studio')!, { island: isl });
const van = sc.van;
van.setDoors(true);
const items = van.inside.items;
const tag = document.getElementById('tag')!;
const bar = document.getElementById('bar')!;
const dot = document.getElementById('dot')!;
const mapHost = document.getElementById('map')!;
const letterEl = document.getElementById('letter')!;
const desk = document.getElementById('desk')!;
let island: Island3D | null = null;
let campVan: Van | null = null;
let mode: 'walk' | 'overview' | 'diving' | 'map' | 'leaving' | 'overlay' = 'walk';

// ———— 第一人称 ————
const walker = new Walker(sc.camera, sc.renderer.domElement, {
  obstacles: van.inside.obstacles,
  doorsOpen: () => van.doorsOpen,
  groundY: () => sc.groundLevel,
});
const enterWalk = (): void => {
  sc.external = true;
  van.setCutaway(false);
  sc.camera.fov = 64;
  sc.camera.updateProjectionMatrix();
  walker.enabled = true;
  dot.style.display = '';
  (document.getElementById('view') as HTMLButtonElement).textContent = '俯瞰车厢';
};
enterWalk();
document.getElementById('view')!.addEventListener('click', () => {
  if (mode === 'walk') {
    mode = 'overview';
    walker.enabled = false;
    sc.external = false;
    dot.style.display = 'none';
    sc.setView('inside');
    van.setDoors(true);
    (document.getElementById('view') as HTMLButtonElement).textContent = '回到车里';
  } else if (mode === 'overview') {
    const back = walkPose();
    sc.flyTo(back, 1200, () => {
      mode = 'walk';
      enterWalk();
    });
  }
});
/** 第一人称此刻的镜头（世界坐标）。 */
function walkPose(): { pos: Vector3; target: Vector3; fov: number } {
  const gy = sc.groundLevel;
  const p = new Vector3(walker.pos.x, (walker.inside ? 1.62 : 1.5) + gy, walker.pos.z);
  const d = new Vector3(Math.cos(walker.pitch) * Math.cos(walker.yaw), Math.sin(walker.pitch), -Math.cos(walker.pitch) * Math.sin(walker.yaw));
  return { pos: p, target: p.clone().add(d), fov: 64 };
}

// ———— 指着什么 ————
const ray = new Raycaster();
function ndc(x: number, y: number): Vector2 {
  const r = sc.renderer.domElement.getBoundingClientRect();
  return new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
}
function itemAt(x: number, y: number): { it: InteriorItem; d: number } | null {
  ray.setFromCamera(ndc(x, y), sc.camera);
  const hits = ray.intersectObjects([van.root], true);
  for (const h of hits) {
    if (h.distance > 4.5) return null;
    let o: Object3D | null = h.object;
    while (o) {
      const it = items.find((i) => i.obj === o);
      if (it) return { it, d: h.distance };
      o = o.parent;
    }
    // 先打到了墙或者别的不能点的东西：挡住了。
    if (h.object.visible && !(h.object as { isInstancedMesh?: boolean }).isInstancedMesh) return null;
  }
  return null;
}
function showTag(it: InteriorItem | null, x: number, y: number): void {
  sc.renderer.domElement.style.cursor = it ? 'pointer' : '';
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
  if ((mode !== 'walk' && mode !== 'overview') || held) return;
  showTag(itemAt(e.clientX, e.clientY)?.it ?? null, e.clientX, e.clientY);
});

// ———— 拿起来细看 ————
let held: { it: InteriorItem; parent: Object3D; pos: Vector3; quat: Quaternion; t: number; back: boolean } | null = null;
const holdPos = new Vector3();
const holdQuat = new Quaternion();
function pickUp(it: InteriorItem): void {
  const o = it.obj;
  held = { it, parent: o.parent!, pos: o.position.clone(), quat: o.quaternion.clone(), t: 0, back: false };
  sc.scene.attach(o);
  showTag(null, 0, 0);
  if (it.id === 'mail') window.setTimeout(() => openLetter(), 650);
}
function putBack(): void {
  if (!held) return;
  held.back = true;
  held.t = 0;
  letterEl.style.display = 'none';
}
function updateHeld(dt: number): void {
  if (!held) return;
  const o = held.it.obj;
  held.t = Math.min(1, held.t + dt * 2.2);
  const e = held.t * held.t * (3 - 2 * held.t);
  if (!held.back) {
    // 拿到眼前 0.4 米、正对着自己，慢慢转一点点（手里拿着的样子）。
    const v = (o.userData['view'] as number[] | undefined) ?? [0, 0, 0];
    const c = (o.userData['center'] as number[] | undefined) ?? [0, 0, 0];
    holdQuat.copy(sc.camera.quaternion).multiply(new Quaternion().setFromEuler(new Euler(v[0] ?? 0, (v[1] ?? 0) + Math.sin(performance.now() * 0.0012) * 0.12, v[2] ?? 0)));
    holdPos.set(0, -0.02, -0.42).applyQuaternion(sc.camera.quaternion).add(sc.camera.position);
    holdPos.sub(new Vector3(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0).applyQuaternion(holdQuat));
    o.position.lerp(holdPos, Math.max(e, 0.2));
    o.quaternion.slerp(holdQuat, Math.max(e, 0.2));
  } else {
    // 放回原处：先在原来的父节点下算出原位的世界坐标，再飞回去。
    held.parent.updateWorldMatrix(true, false);
    const wp = held.pos.clone().applyMatrix4(held.parent.matrixWorld);
    const wq = held.parent.getWorldQuaternion(new Quaternion()).multiply(held.quat);
    o.position.lerp(wp, e);
    o.quaternion.slerp(wq, e);
    if (held.t >= 1) {
      held.parent.attach(o);
      o.position.copy(held.pos);
      o.quaternion.copy(held.quat);
      held = null;
    }
  }
}

function openLetter(): void {
  const lines = scenario.client.letter;
  letterEl.innerHTML = `${lines.map((l) => `<p>${l}</p>`).join('')}<p class="sign">—— ${scenario.client.name}</p><button>收好</button>`;
  letterEl.style.display = 'block';
  letterEl.querySelector('button')!.addEventListener('click', putBack);
}

// ———— 点 ————
walker.onTap = (x, y) => {
  if (held) {
    putBack();
    return;
  }
  if (mode !== 'walk') return;
  const hit = itemAt(x, y);
  if (hit) {
    act(hit.it);
    return;
  }
  // 没点到东西：点到的是地面就走过去。
  ray.setFromCamera(ndc(x, y), sc.camera);
  const floorY = (walker.inside ? 0.565 : 0) + sc.groundLevel;
  const p = new Vector3();
  if (ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -floorY), p) && p.distanceTo(sc.camera.position) < 7) {
    if (walker.free(p.x, p.z) || Math.abs(p.x - walker.pos.x) + Math.abs(p.z - walker.pos.z) > 0.2) walker.walkTo(p.x, p.z);
  }
};
sc.renderer.domElement.addEventListener('click', (e) => {
  if (mode !== 'overview') return;
  const hit = itemAt(e.clientX, e.clientY);
  if (hit) act(hit.it);
});
function act(it: InteriorItem): void {
  if (it.id === 'island') return dive();
  if (it.id === 'chair') return walker.sit(van.inside.seat);
  if (it.id === 'parts') return openDesk();
  if (it.id === 'wheel') {
    it.act?.();
    van.jostle(1.2);
    van.ping();
    return;
  }
  if (it.inspect && mode === 'walk') {
    it.act?.();
    pickUp(it);
    return;
  }
  it.act?.();
}

function openDesk(): void {
  mode = 'overlay';
  walker.enabled = false;
  const f = desk.querySelector('iframe')!;
  if (!f.src) f.src = './desk.html?embed=1';
  desk.style.display = 'block';
}
document.getElementById('deskClose')!.addEventListener('click', () => {
  desk.style.display = 'none';
  mode = 'walk';
  walker.enabled = true;
});

// ———— 走进岛、回来 ————
const MAP_START = { x: 0, z: 4, dist: 46 };
let returnPose: { pos: Vector3; target: Vector3; fov: number } | null = null;
function dive(): void {
  if (!sc.islandInner) return;
  const from = mode;
  mode = 'diving';
  showTag(null, 0, 0);
  bar.style.opacity = '0';
  dot.style.display = 'none';
  walker.enabled = false;
  returnPose = from === 'walk' ? walkPose() : VanScene.pose('inside');
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
  sc.flyTo({ pos: inner.localToWorld(island.camera.position.clone()), target: inner.localToWorld(island.cam.lookTarget()), fov: island.camera.fov }, 1900, () => {
    mapHost.classList.add('on');
    window.setTimeout(() => (mode = 'map'), 700);
  });
}
function leave(): void {
  if (mode !== 'map' || !island || !sc.islandInner) return;
  mode = 'leaving';
  const inner = sc.islandInner;
  inner.updateWorldMatrix(true, false);
  sc.flyTo({ pos: inner.localToWorld(island.camera.position.clone()), target: inner.localToWorld(island.cam.lookTarget()), fov: island.camera.fov }, 0);
  mapHost.classList.remove('on');
  window.setTimeout(
    () =>
      sc.flyTo(returnPose ?? walkPose(), 1700, () => {
        bar.style.opacity = '1';
        mode = 'walk';
        enterWalk();
      }),
    450,
  );
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (held) putBack();
    else if (mode === 'map') leave();
  }
});

function frame(dt: number, render = true): void {
  if (mode === 'walk' && !sc.flying) {
    const before = walker.pos.clone();
    walker.update(dt);
    // 拿着东西走开了：放回去。
    if (held && !held.back && walker.pos.distanceTo(before) > 1e-4) putBack();
  }
  updateHeld(dt);
  if (mode !== 'map') sc.update(dt, render);
  if (island && (mode === 'map' || mode === 'diving' || mode === 'leaving')) {
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
    place(x: number, z: number, yaw: number, pitch: number): void {
      walker.place(x, z, yaw, pitch);
    },
    act(id: string): void {
      const it = items.find((i) => i.id === id);
      if (it) act(it);
    },
    hover(id: string, x = 900, y = 420): void {
      showTag(items.find((i) => i.id === id) ?? null, x, y);
    },
    walkTo(x: number, z: number): void {
      walker.walkTo(x, z);
    },
    overview(): void {
      document.getElementById('view')!.click();
    },
    dive,
    leave,
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
