import { Group, Mesh, SphereGeometry, type Object3D } from 'three';
import { designTemplates, gaitRules, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules, type Design } from '../../data';
import { compileDesign, makeDesignKit, partsOf, withRelativeLitter } from '../../sim';
import { PuppetActor, loadRigKit } from '../../render/puppet/actor';
import { COATS, coatFor } from '../../render/puppet/coats';
import { bodyPlan } from '../../render/puppet/plan';
import { Diorama } from '../../render/three/diorama';
import { paperMaterial } from '../../render/three/paper';
import { Puppet3D } from '../../render/three/puppet3d';
import '../../ui/style/theme.css';

/**
 * 3D 纸剧场的原型页（2026-11-22）：新渲染架构的竖切片。
 * 布景全部由代码生成；台上是两种设计的纸偶（和设计台同一个身体、同一套步态），在台上走、吃、趴。
 * ?hour=17 固定钟点；?speed=1 每秒走几个小时（默认 0.5）。
 */
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const q = new URLSearchParams(location.search);
const fixedHour = q.has('hour') ? Number(q.get('hour')) : null;
const hoursPerSec = q.has('speed') ? Number(q.get('speed')) : 0.5;

const tpl = (id: string): Design => withRelativeLitter(designTemplates.find((t) => t.species === id)!.design, kit);
const planOf = (d: Design) => bodyPlan(d, partsOf(d, kit), compileDesign(d, kit).bird, viabilityRules, gaitRules);

interface Walker {
  actor: PuppetActor;
  p3: Puppet3D;
  x: number;
  tx: number;
  z: number;
  face: number;
  v: number;
  doing: 'go' | 'stand' | 'eat' | 'lie';
  timer: number;
}

async function main(): Promise<void> {
  const host = document.getElementById('stage')!;
  const d = new Diorama(host);
  const rig = await loadRigKit('P11-cat', (t) => planOf(tpl(t)));
  let seed = 7;
  const rnd = (): number => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 0x1_0000_0000);
  const walkers: Walker[] = [];
  const cast: Array<[Design, number]> = [
    [tpl('rabbit'), 3],
    [tpl('cat'), 1],
  ];
  for (const [design, n] of cast) {
    const plan = planOf(design);
    for (let i = 0; i < n; i++) {
      const coat = i === 2 ? COATS[5]! : coatFor(design.name === '穴兔' ? 'rabbit' : 'cat');
      const actor = new PuppetActor(rig, plan, coat, gaitRules, compileDesign(design, kit).params.body?.speed ?? 1, rnd());
      actor.setLength(100);
      const p3 = new Puppet3D(actor.rig.cutout, actor.rig.metersPerPx * Diorama.PUPPET_SCALE);
      const z = Diorama.LANES[(walkers.length + i) % 3]!;
      p3.root.position.set(-1.6 + rnd() * 3.2, Diorama.FLOOR, z);
      d.stage.add(p3.root);
      walkers.push({ actor, p3, x: p3.root.position.x, tx: p3.root.position.x, z, face: rnd() < 0.5 ? -1 : 1, v: 0, doing: 'stand', timer: rnd() * 3 });
    }
  }
  // 洞里窝着两只幼崽：缩小的兔子纸偶，趴着。
  const kits: Object3D[] = [];
  for (let i = 0; i < 2; i++) {
    const a = new PuppetActor(rig, planOf(tpl('rabbit')), coatFor('rabbit'), gaitRules, 1, i * 0.4);
    a.setMode('lie');
    a.step(3);
    const p = new Puppet3D(a.rig.cutout, a.rig.metersPerPx * Diorama.PUPPET_SCALE * 0.4);
    p.sync();
    const g = new Group();
    g.add(p.root);
    if (i) g.scale.x = -1;
    kits.push(g);
  }
  d.setKits(kits);
  void Mesh;
  void SphereGeometry;
  void paperMaterial;

  const hud = document.getElementById('hud')!;
  let hour = fixedHour ?? 16.2;
  let last = performance.now();
  const veil = document.getElementById('veil')!;
  let frames = 0;
  const loop = (): void => {
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (fixedHour === null) hour = (hour + dt * hoursPerSec) % 24;
    for (const w of walkers) step(w, dt);
    d.update(dt, { hour, grass: 0.8, kits: kits.length });
    if (++frames === 3) {
      veil.style.opacity = '0';
      window.setTimeout(() => veil.remove(), 900);
    }
    hud.innerHTML = `纸剧场 · 3D 原型　<b>${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.floor((hour % 1) * 60)).padStart(2, '0')}</b>　移动鼠标看纵深`;
    requestAnimationFrame(loop);
  };
  const step = (w: Walker, dt: number): void => {
    w.timer -= dt;
    const dx = w.tx - w.x;
    const going = w.doing === 'go' && Math.abs(dx) > 0.02;
    if (w.doing === 'go' && Math.abs(dx) > 0.01) w.face = dx < 0 ? -1 : 1;
    w.v += Math.sign((going ? 1 : 0) - w.v) * Math.min(Math.abs((going ? 1 : 0) - w.v), dt / 0.45);
    const speed = w.actor.walkMs * Diorama.PUPPET_SCALE;
    if (w.v > 0) w.x += Math.sign(dx) * Math.min(Math.abs(dx), w.v * speed * dt);
    if ((w.doing === 'go' && !going && w.v < 0.05) || (w.doing !== 'go' && w.timer <= 0)) {
      const r = rnd();
      if (w.doing === 'go') {
        w.doing = r < 0.5 ? 'eat' : r < 0.8 ? 'stand' : 'lie';
        w.timer = 2 + rnd() * 4;
      } else {
        w.doing = 'go';
        w.tx = Math.max(-1.8, Math.min(1.8, w.x + (rnd() - 0.5) * 2.4));
      }
    }
    w.actor.setMode(w.doing === 'go' ? 'stand' : w.doing);
    w.actor.setSpeed(w.v * speed);
    w.actor.step(dt);
    w.p3.sync();
    w.p3.root.position.x = w.x;
    w.p3.root.scale.x = w.face;
  };
  // ?manual=1：不自己跑，外面一帧一帧地推（无头浏览器截图用：软件渲染一帧要好几秒）。
  if (q.has('manual')) {
    (window as unknown as { dio: { step: (dt: number, n: number, render?: boolean) => void } }).dio = {
      step: (dt, n, render = true) => {
        for (let i = 0; i < n; i++) {
          if (fixedHour === null) hour = (hour + dt * hoursPerSec) % 24;
          for (const w of walkers) step(w, dt);
          if (render || i === n - 1) d.update(dt, { hour, grass: 0.8, kits: kits.length });
        }
        veil.remove();
      },
    };
    return;
  }
  requestAnimationFrame(loop);
}

void main();
