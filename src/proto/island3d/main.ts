import { scenarioLibrary, speciesFor, tools, worldFor } from '../../data';
import { createInitialState, herbIndex, woodyIndex } from '../../sim';
import { Island3D } from '../../render/three/island3d';
import '../../ui/style/theme.css';

/**
 * 纸雕岛的原型页（2026-11-22）：花园岛的真实地形（推演的第 0 天）切成纸雕。
 * ?scenario=bird-island 换一座岛；?manual=1 不自己跑，给截图脚本一帧一帧地推（window.isl.step）。
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

const host = document.getElementById('stage')!;
const isl = new Island3D(host, { width: g.width, height: g.height, terrain: g.terrain, herb, shrub, seed: scenario.seed });
document.getElementById('hud')!.innerHTML = `<b>${scenario.name}</b>　拖动挪岛 · 滚轮或双指推近 · 右键或双指转`;
const veil = document.getElementById('veil')!;
console.log('island build ms', Math.round(isl.buildMs));

if (q.get('manual') === '1') {
  (window as unknown as { isl: unknown }).isl = {
    step(dt: number, k: number, render = true): void {
      for (let i = 0; i < k; i++) isl.update(dt);
      if (render) isl.update(0);
    },
    look(x: number, z: number, dist: number, yaw = 0, tilt = 0): void {
      isl.cam.set(x, z, dist, yaw, tilt);
    },
    buildMs: isl.buildMs,
    debug(k: string, v: unknown): void {
      isl.debug(k, v);
    },
  };
  veil.style.opacity = '0';
} else {
  let last = performance.now();
  const loop = (t: number): void => {
    isl.update(Math.min(0.05, (t - last) / 1000));
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame((t) => {
    last = t;
    loop(t);
    veil.style.opacity = '0';
    setTimeout(() => veil.remove(), 900);
  });
}
