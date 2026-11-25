import { Vector3 } from 'three';
import { VanScene, type VanView } from '../../render/three/van/scene';
import { islandOf } from '../../render/three/van/islandData';
import '../../ui/style/theme.css';

/**
 * 「勾勾」的看车页（2026-11-25）：转着看车，切几个视角；?view=front|side|back|top|inside|camp；?manual=1 给截图脚本一帧一帧地推。
 */
const q = new URLSearchParams(location.search);
const sc = new VanScene(document.getElementById('stage')!, { orbit: true, island: islandOf('garden-island') });
const views: Array<[VanView, string]> = [
  ['hero', '四分之三'],
  ['front', '正面'],
  ['side', '侧面'],
  ['back', '背面'],
  ['top', '俯视'],
  ['inside', '剖开看里面'],
  ['camp', '营地'],
];
const bar = document.getElementById('bar')!;
for (const [v, name] of views) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => sc.setView(v);
  bar.appendChild(b);
}
const mood = document.createElement('button');
mood.textContent = '来信';
mood.onclick = () => sc.van.ping();
bar.appendChild(mood);
sc.setView((q.get('view') as VanView) ?? 'hero', true);
if (q.get('manual') === '1') {
  (window as unknown as { vs: unknown }).vs = {
    step(dt: number, k: number): void {
      for (let i = 0; i < k; i++) sc.update(dt, i === k - 1);
    },
    pose(px: number, py: number, pz: number, tx: number, ty: number, tz: number, fov = 30): void {
      sc.flyTo({ pos: new Vector3(px, py, pz), target: new Vector3(tx, ty, tz), fov }, 0);
    },
    view(v: VanView): void {
      sc.setView(v, true);
    },
    ping(): void {
      sc.van.ping();
    },
    count(): string {
      const c = new Map<string, number>();
      sc.scene.traverse((o) => {
        if (!(o as { isMesh?: boolean }).isMesh) return;
        const path: string[] = [];
        let q: typeof o | null = o;
        while (q && q !== sc.scene) {
          if (q.name) path.push(q.name);
          q = q.parent;
        }
        const k = `${path.reverse().slice(0, 2).join('/')}|${o.parent?.type}|${(o as { geometry?: { type: string } }).geometry?.type}`;
        c.set(k, (c.get(k) ?? 0) + 1);
      });
      return [...c].sort((a, b) => b[1] - a[1]).slice(0, 15).map((x) => x.join(' ')).join('\n');
    },
    info(): unknown {
      const info = sc.renderer.info;
      info.autoReset = false;
      info.reset();
      sc.update(0);
      const r = { calls: info.render.calls, triangles: info.render.triangles };
      info.autoReset = true;
      let meshes = 0;
      sc.scene.traverse((o) => {
        if ((o as { isMesh?: boolean }).isMesh) meshes++;
      });
      const top: Array<[string, number]> = [];
      sc.scene.traverse((o) => {
        const m = o as unknown as { isMesh?: boolean; geometry?: { index: { count: number } | null; attributes: { position: { count: number } } }; count?: number; name: string; parent: { name: string; type: string } | null; type: string };
        if (!m.isMesh || !m.geometry) return;
        const tri = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
        let pn = '';
        let q = m.parent as { name: string; parent: unknown } | null;
        while (q && !pn) {
          pn = q.name;
          q = q.parent as { name: string; parent: unknown } | null;
        }
        top.push([`${m.type}:${m.name}<${pn}`, Math.round(tri * (m.count ?? 1))]);
      });
      top.sort((a, b) => b[1] - a[1]);
      return { calls: r.calls, triangles: r.triangles, meshes, top: top.slice(0, 12) };
    },
  };
} else {
  let last = performance.now();
  const loop = (t: number): void => {
    sc.update(Math.min(0.05, (t - last) / 1000));
    last = t;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
