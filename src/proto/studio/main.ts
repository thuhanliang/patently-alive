import { designTemplates, gaitRules, hintTemplates, partLibrary, plantLibrary, scalingLaws, scenarioLibrary, speciesFor, tools, viabilityRules, worldFor, type Design } from '../../data';
import { compileDesign, createInitialState, herbIndex, makeDesignKit, partsOf, withRelativeLitter, woodyIndex } from '../../sim';
import { PuppetActor, loadRigKit } from '../../render/puppet/actor';
import { coatFor } from '../../render/puppet/coats';
import { bodyPlan } from '../../render/puppet/plan';
import { Puppet3D } from '../../render/three/puppet3d';
import { Island3D } from '../../render/three/island3d';
import { reliefField } from '../../render/three/relief';
import { Studio, type StudioProp } from '../../render/three/studio';
import '../../ui/style/theme.css';

/**
 * 工作室原型页（2026-11-22）：书桌、台灯、桌上的小东西；正中间是花园岛的 A4 纸雕摆件。
 * 点摆件，镜头扎进去，换成全屏的岛（同一套纸）；"回到桌前"或 Esc 退回来。
 * ?manual=1 给截图脚本一帧一帧地推（window.st）。
 */
const q = new URLSearchParams(location.search);
const scenario = scenarioLibrary.get(q.get('scenario') ?? 'garden-island') ?? scenarioLibrary.get('garden-island')!;
const world = worldFor(scenario);
const state = createInitialState({ seed: scenario.seed, world, species: speciesFor(world), tools });
const g = state.grid;
const hi = herbIndex(world);
const wi = woodyIndex(world);
const n = g.width * g.height;
const herb = new Float64Array(n);
const shrub = new Float64Array(n);
for (let i = 0; i < n; i++) {
  const hp = world.plants[hi];
  if (hp) herb[i] = g.plants[hi]![i]! / Math.max(1, hp.maxBiomass * g.fertility[i]!);
  const wp = wi >= 0 ? world.plants[wi] : undefined;
  if (wp) shrub[i] = g.plants[wi]![i]! / Math.max(1, wp.maxBiomass);
}
const input = { width: g.width, height: g.height, terrain: g.terrain, herb, shrub, seed: scenario.seed };
const field = reliefField(input);

const studio = new Studio(document.getElementById('studio')!, { field, input, name: scenario.name });
const mapHost = document.getElementById('map')!;
let island: Island3D | null = null;
let mode: 'studio' | 'diving' | 'map' | 'leaving' = 'studio';
const tag = document.getElementById('tag')!;
const back = document.getElementById('back')!;

studio.onHover = (p: StudioProp | null, x: number, y: number) => {
  if (!p) {
    tag.style.opacity = '0';
    return;
  }
  tag.innerHTML = `<b>${p.name}</b>${p.hint}`;
  tag.style.left = `${x}px`;
  tag.style.top = `${y}px`;
  tag.style.opacity = '1';
};

/** 地图一进来时的镜头（岛的坐标）：看全岛，略近一点，保证画面里都是摆件裁得到的地方。 */
const MAP_START = { x: 0, z: 2, dist: 46 };

function dive(): void {
  if (mode !== 'studio') return;
  mode = 'diving';
  island ??= new Island3D(mapHost, input, field);
  island.cam.set(MAP_START.x, MAP_START.z, MAP_START.dist);
  island.update(0);
  // 把地图的镜头换算到房间里：镜头扎进摆件，停在和地图一模一样的位置。
  const pos = studio.islandToWorld(island.camera.position);
  const target = studio.islandToWorld(island.cam.lookTarget());
  studio.flyTo({ pos, target, fov: island.camera.fov }, 1700, () => {
    mapHost.classList.add('on');
    back.classList.add('on');
    window.setTimeout(() => (mode = 'map'), 700);
  });
}

function leave(): void {
  if (mode !== 'map' || !island) return;
  mode = 'leaving';
  back.classList.remove('on');
  mapHost.classList.remove('on');
  // 从地图现在的镜头倒着飞回桌前。
  studio.setPose({ pos: studio.islandToWorld(island.camera.position), target: studio.islandToWorld(island.cam.lookTarget()), fov: island.camera.fov });
  window.setTimeout(() => studio.flyTo(studio.home, 1500, () => (mode = 'studio')), 350);
}

// 切割垫上躺着一只拼好的纸偶猫（和设计台同一套零件、同一套铆钉）。
async function puppetOnMat(): Promise<void> {
  const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
  const tpl = (id: string): Design => withRelativeLitter(designTemplates.find((t) => t.species === id)!.design, kit);
  const planOf = (d: Design) => bodyPlan(d, partsOf(d, kit), compileDesign(d, kit).bird, viabilityRules, gaitRules);
  const rig = await loadRigKit('P11-cat', (t) => planOf(tpl(t)));
  const design = tpl('cat');
  const actor = new PuppetActor(rig, planOf(design), coatFor('cat'), gaitRules, 1, 0.3);
  actor.setLength(100);
  actor.step(0.2);
  const p3 = new Puppet3D(actor.rig.cutout, actor.rig.metersPerPx * 0.42);
  p3.sync();
  p3.root.rotation.x = -Math.PI / 2;
  p3.root.position.set(0.0, 0.004, 0.06);
  studio.matGroup?.add(p3.root);
}
const puppetReady = puppetOnMat().catch((e: unknown) => console.warn('纸偶没摆上', e));

const islandProp = studio.props.find((p) => p.id === 'island')!;
islandProp.onClick = dive;
back.addEventListener('click', leave);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') leave();
});

function frame(dt: number, render = true): void {
  if (mode !== 'map') studio.update(dt, render);
  if (island && mode !== 'studio') island.update(dt, render && (mode === 'map' || mapHost.classList.contains('on')));
}

const veil = document.getElementById('veil')!;
if (q.get('manual') === '1') {
  (window as unknown as { st: unknown }).st = {
    step(dt: number, k: number): void {
      for (let i = 0; i < k; i++) frame(dt, i === k - 1);
    },
    dive,
    leave,
    hover(id: string): void {
      const p = studio.props.find((x) => x.id === id) ?? null;
      studio.onHover?.(p, 900, 420);
      (studio as unknown as { hovered: StudioProp | null }).hovered = p;
    },
    click(id: string): void {
      studio.props.find((x) => x.id === id)?.onClick?.();
    },
    ready: puppetReady,
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
