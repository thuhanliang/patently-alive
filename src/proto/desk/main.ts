import { Application, Assets, Container, Graphics, Text, type Texture } from 'pixi.js';
import { designTemplates, gaitRules, hintTemplates, partLibrary, plantLibrary, scalingLaws, speciesLibrary, viabilityRules, type Design } from '../../data';
import { BODY_SYSTEMS, type BodySystem } from '../../data/schema/viability';
import { compileDesign, makeDesignKit, partsOf, type CompiledDesign } from '../../sim';
import { speciesColor } from '../../render/palette';
import { breathsPerMin, chewHz, gaitOf, heartPerMin, speedAtFroude, topSpeed, walkSpeed, type Gait } from '../../render/puppet/gait';
import { bodyPlan, type BodyPlan } from '../../render/puppet/plan';
import { blendPose, eatPose, gaitPose, liePose, standPose, type Pose } from '../../render/puppet/pose';
import { Puppet, lookOf, type Look } from '../../render/puppet/puppet';
import type { CutData } from '../../render/puppet/cutout';
import { CutoutPuppet } from '../../render/puppet/cutoutPuppet';
import { bracket, drawReference, referenceHead, referenceHeightM, referenceLabel } from '../../render/puppet/ruler';

/**
 * 设计台玩具 · 第 1 步（M1-1）：纸偶骨架 v0。独立页面，只在画面里，不接推演的操作。
 *
 * 一只代码画的剪纸纸偶站在桌上，自己待着（站、走、吃、趴、偶尔小跑）。改体重、体重分配、腿长、尾长、部件，
 * 它的身材马上跟着变，动作的快慢按缩放律变：把猫拖到 200 千克，它走得又慢又沉；同样每秒 2 米，猫在跑，虎在走。
 * 身后叠着同体重上下的真实动物剪影（体型标尺）；脚下是一条往后拉的纸带尺，看得出它走得多快。
 *
 * 参数（录屏、发链接用）：?t=cat&mass=200&mode=auto|stand|walk|run|eat|lie&speed=2&leg=0.1&tail=0.2
 * 也可以在控制台里 desk.set({ mass: 200, mode: 'walk' })；desk.step(1 / 30) 停掉实时时钟、按固定步长走一帧（录屏用）。
 */

type Mode = 'auto' | 'stand' | 'walk' | 'run' | 'eat' | 'lie';
type Behavior = 'stand' | 'move' | 'eat' | 'lie';

const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
/** 第 1 步只有四足兽的骨架：长羽毛的现有技术（鸻、秧鸡、几维、鸮鹦鹉）是两足的鸟，下一步再做。 */
const MAMMALS = designTemplates.filter((t) => t.design.parts.coat !== 'feathers');
const SYSTEM_NAMES: Record<BodySystem, string> = { skeleton: '骨骼', muscle: '肌肉', gut: '消化道', heart: '心血管', fat: '脂肪' };
const GAIT_NAMES: Record<Gait, string> = { stand: '站着', walk: '走', trot: '小跑', gallop: '奔跑' };
const SHOWN_SLOTS = ['coat', 'mouth', 'limbs', 'tail', 'digestion'] as const;

// ---- 状态 ----
let templateId = 'cat';
let design: Design = structuredClone(MAMMALS.find((t) => t.species === templateId)!.design);
let look: Look = lookOf(speciesColor(templateId).body);
let compiled: CompiledDesign = compileDesign(design, kit);
let plan: BodyPlan = planOf(design, compiled);
let mode: Mode = 'auto';
let behavior: Behavior = 'stand';
let targetSpeed = 0;
let speed = 0;
/** 用户在速度滑块上拖出来的速度（"跑"用它）；没拖过就按体型给一个奔跑的速度。 */
let chosenRunSpeed: number | null = null;
let phase = 0;
let time = 0;
let distance = 0;
let breathPhase = 0;
let autoLeft = 2;
let seed = 12345;
const rand = (): number => ((seed = (seed * 1103515245 + 12345) >>> 0) / 0x1_0000_0000);

function planOf(d: Design, c: CompiledDesign): BodyPlan {
  return bodyPlan(d, partsOf(d, kit), c.bird, viabilityRules, gaitRules);
}
const speedFactor = (): number => compiled.params.body?.speed ?? 1;
const top = (): number => topSpeed(gaitRules, design.bodyMassKg, speedFactor());
const runSpeed = (): number => Math.min(top(), chosenRunSpeed ?? Math.min(top() * 0.55, speedAtFroude(3, plan.legLen)));

// ---- 姿态的生成和插值 ----
interface Gen {
  key: string;
  f: () => Pose;
}
let gen: Gen = makeGen('stand');
let prev: { f: () => Pose; w: number } | null = null;

function makeGen(key: string): Gen {
  if (key.startsWith('move:')) {
    const g = key.slice(5) as Exclude<Gait, 'stand'>;
    // 步态换了也先按原来的步态摆完这一段插值：四条腿的先后顺序不会一下子跳掉。
    return { key, f: () => gaitPose(plan, { ...gaitOf(gaitRules, Math.max(speed, 1e-3), plan.legLen), gait: g, duty: gaitRules.duty[g].value }, phase) };
  }
  if (key === 'eat') return { key, f: () => eatPose(plan, time, chewHz(gaitRules, design.bodyMassKg)) };
  if (key === 'lie') return { key, f: () => liePose(plan) };
  // 站：偶尔转转头、低一下头。
  return {
    key,
    f: () => {
      const p = standPose(plan);
      return { ...p, head: p.head + 0.18 * Math.sin(time * 0.7) * Math.sin(time * 0.23), neck: p.neck + 0.08 * Math.sin(time * 0.31) };
    },
  };
}

/** 状态之间插值多久：大动物换姿势慢一些（按 √腿长）。 */
const blendSeconds = (): number => Math.min(1.2, Math.max(0.3, 0.45 * Math.sqrt(plan.legLen / 0.25)));

function setBehavior(b: Behavior): void {
  behavior = b;
  targetSpeed = b === 'move' ? targetSpeed : 0;
}

function applyMode(m: Mode): void {
  mode = m;
  if (m === 'auto') {
    autoLeft = 0;
    return;
  }
  if (m === 'walk') {
    behavior = 'move';
    targetSpeed = walkSpeed(gaitRules, plan.legLen);
  } else if (m === 'run') {
    behavior = 'move';
    targetSpeed = runSpeed();
  } else setBehavior(m);
}

/** "自己待着"：站一会儿、走几步、低头吃、趴下歇着，偶尔小跑一段。 */
function autoStep(dt: number): void {
  autoLeft -= dt;
  if (autoLeft > 0) return;
  const r = rand();
  const L = plan.legLen;
  if (behavior === 'lie') {
    setBehavior('stand');
    autoLeft = 2 + 2 * rand();
  } else if (behavior === 'move') {
    if (r < 0.5) {
      setBehavior('eat');
      autoLeft = 4 + 3 * rand();
    } else {
      setBehavior('stand');
      autoLeft = 2 + 3 * rand();
    }
  } else if (behavior === 'eat') {
    if (r < 0.4) {
      setBehavior('lie');
      autoLeft = 6 + 4 * rand();
    } else {
      behavior = 'move';
      targetSpeed = walkSpeed(gaitRules, L) * (0.8 + 0.4 * rand());
      autoLeft = 4 + 4 * rand();
    }
  } else {
    behavior = 'move';
    targetSpeed = r < 0.2 ? speedAtFroude(1.2, L) : walkSpeed(gaitRules, L) * (0.8 + 0.4 * rand());
    autoLeft = r < 0.2 ? 2.5 + rand() : 5 + 4 * rand();
  }
}

// ---- 画面 ----
async function main(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0xe9dcc0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
  document.body.prepend(app.canvas);

  const refLayer = new Container();
  const ground = new Graphics();
  const tapeLabels = new Container();
  const puppetLayer = new Container();
  app.stage.addChild(refLayer, ground, tapeLabels, puppetLayer);
  // ?cut=<名字>：用成品图切出来的零件（白模）代替代码画的纸偶，检验真零件演同一套动作的效果（开发用）。
  const cut = new URLSearchParams(location.search).get('cut');
  let puppet: { view: Container; build(plan: BodyPlan, look: Look): void; apply(pose: Pose, dt: number, breath?: number): void; setScale(pxPerM: number): void };
  if (cut) {
    const dir = `/art/incoming/lovart/paper/cuts/${cut}`;
    const data = (await (await fetch(`${dir}/vector.json`)).json()) as CutData;
    const paper = (await Assets.load(`${dir}/paper.png`)) as Texture;
    paper.source.addressMode = 'repeat';
    puppet = new CutoutPuppet(data, paper, { main: 0xe6d8bd, stripe: 0xe6d8bd, pale: 0xe6d8bd }, plan);
  } else {
    puppet = new Puppet(plan, look);
  }
  puppetLayer.addChild(puppet.view);
  const labelPool: Text[] = [];

  let zoom = 0; // 每米多少像素，平滑地追目标
  let refKey = '';
  let refs: { view: Container; label: Text; head: { x: number; y: number }; earM: number }[] = [];

  function rebuild(): void {
    compiled = compileDesign(design, kit);
    plan = planOf(design, compiled);
    puppet.build(plan, look);
    gen = makeGen(gen.key);
    prev = null;
    if (mode === 'run') targetSpeed = runSpeed();
    if (mode === 'walk') targetSpeed = walkSpeed(gaitRules, plan.legLen);
    refreshControls();
  }

  function rebuildRefs(): void {
    const near = bracket(gaitRules.references.animals, design.bodyMassKg);
    const key = near.map((r) => r.id).join(',');
    if (key === refKey) return;
    refKey = key;
    for (const r of refs) {
      r.view.destroy({ children: true });
      r.label.destroy();
    }
    refs = near.map((r, i) => {
      const view = drawReference(r, i === 0 ? 0x9c8467 : 0x7d6a54, i === 0 ? 0.22 : 0.16);
      const label = referenceLabel(r, 0x8a7458);
      refLayer.addChild(view, label);
      return { view, label, head: referenceHead(r), earM: referenceHeightM(r) - referenceHead(r).y };
    });
  }

  function targetZoom(W: number, H: number): number {
    const lenM = plan.bodyLen + plan.tailLen * 0.7 + plan.snout + plan.headR * 2;
    const hM = plan.legLen + plan.chestH * 2 + plan.neckLen + plan.headR * 2;
    let refLen = 0;
    let refH = 0;
    for (const r of bracket(gaitRules.references.animals, design.bodyMassKg)) {
      refLen = Math.max(refLen, r.bodyLengthM * (1.6 + r.tail));
      refH = Math.max(refH, referenceHeightM(r));
    }
    const usableW = W - 320;
    return Math.min((usableW * 0.5) / lenM, (H * 0.45) / hM, (usableW * 0.85) / Math.max(refLen, 1e-3), (H * 0.6) / Math.max(refH, 1e-3));
  }

  function drawGround(W: number, gy: number, px: number): void {
    ground.clear();
    ground.rect(0, gy, W, 30).fill(0xf4ead3);
    ground.rect(0, gy, W, 1.5).fill(0x8a7458);
    // 纸带尺：刻度按缩放选（最小的格至少 10 像素），随着走过的路往后拉。
    const steps = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20];
    const step = steps.find((s) => s * zoom >= 10) ?? 20;
    const major = step * (String(step).includes('2') ? 5 : 10);
    const first = Math.floor((distance - (px / zoom)) / step);
    const last = Math.ceil((distance + (W - px) / zoom) / step);
    let li = 0;
    for (let i = first; i <= last; i++) {
      const m = i * step;
      const x = px + (m - distance) * zoom;
      const isMajor = Math.abs(m / major - Math.round(m / major)) < 1e-6;
      ground.rect(x, gy, 1, isMajor ? 12 : 6).fill(0x8a7458);
      if (isMajor) {
        let t = labelPool[li];
        if (!t) {
          t = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 11, fill: 0x8a7458 } });
          labelPool.push(t);
          tapeLabels.addChild(t);
        }
        t.visible = true;
        // 像一截截的卷尺：厘米刻度每满一米从头数，米刻度每满一百米从头数。
        const span = major >= 1 ? 100 : 1;
        const r = Math.round((((m % span) + span) % span) * 1000) / 1000;
        t.text = major >= 1 ? `${Math.round(r)} 米` : r === 0 ? '1 米' : `${Math.round(r * 100)} 厘米`;
        t.position.set(x + 3, gy + 12);
        li++;
      }
    }
    for (let i = li; i < labelPool.length; i++) labelPool[i]!.visible = false;
  }

  let readoutLeft = 0;
  app.ticker.add((tk) => frame(Math.min(0.1, tk.deltaMS / 1000)));
  // ?manual=1：一开始就不走实时时钟，只靠 desk.step 推进（截图对比、录屏用，结果可复现）。
  if (new URLSearchParams(location.search).has('manual')) app.ticker.stop();
  function frame(dt: number): void {
    time += dt;
    const W = app.screen.width;
    const H = app.screen.height;
    if (mode === 'auto') autoStep(dt);

    // 速度平滑地追目标（大动物加减速慢一点）。
    const tau = 0.5 * Math.sqrt(plan.legLen / 0.25);
    speed += (targetSpeed - speed) * (1 - Math.exp(-dt / tau));
    if (targetSpeed === 0 && speed < 0.01 * Math.sqrt(plan.legLen)) speed = 0;
    const gs = gaitOf(gaitRules, speed, plan.legLen);
    phase += gs.strideHz * dt;
    distance += speed * dt;

    const key = gs.gait !== 'stand' ? `move:${gs.gait}` : behavior === 'move' ? 'stand' : behavior;
    if (key !== gen.key) {
      prev = { f: gen.f, w: 1 };
      gen = makeGen(key);
    }
    let pose = gen.f();
    if (prev) {
      pose = blendPose(prev.f(), pose, 1 - prev.w);
      prev.w -= dt / blendSeconds();
      if (prev.w <= 0) prev = null;
    }

    // 呼吸：静息按体重；走、跑时加快；奔跑时一步一口气（跑步和呼吸同步，Bramble & Carrier 1983，未核对）。
    const rest = breathsPerMin(gaitRules, design.bodyMassKg) / 60;
    const bHz = gs.gait === 'gallop' ? gs.strideHz : gs.gait === 'trot' ? rest * 2.5 : gs.gait === 'walk' ? rest * 1.5 : behavior === 'lie' ? rest * 0.85 : rest;
    breathPhase += bHz * dt;
    puppet.apply(pose, dt, Math.sin(breathPhase * Math.PI * 2));

    // 缩放：慢慢追，体重一变先看到它长大，再看到镜头往后拉。
    const tz = targetZoom(W, H);
    zoom = zoom === 0 ? tz : Math.exp(Math.log(zoom) + (Math.log(tz) - Math.log(zoom)) * (1 - Math.exp(-dt / 0.8)));
    const gy = Math.round(H * 0.72);
    const px = 320 + (W - 320) * 0.5;
    puppet.setScale(zoom);
    puppet.view.position.set(px, gy);
    rebuildRefs();
    let prevLabel: Text | null = null;
    for (const r of refs) {
      r.view.scale.set(zoom / 1000);
      r.view.position.set(px, gy);
      // 名字签挂在剪影的头上方；和前一张的签挤在一起时往上挪。
      let y = gy - (r.head.y + r.earM) * zoom - 18;
      const x = px + r.head.x * zoom - r.label.width / 2;
      if (prevLabel && Math.abs(prevLabel.y - y) < 16 && Math.abs(prevLabel.x - x) < prevLabel.width) y = prevLabel.y - 16;
      r.label.position.set(x, y);
      prevLabel = r.label;
    }
    drawGround(W, gy, px);

    readoutLeft -= dt;
    if (readoutLeft <= 0) {
      readoutLeft = 0.2;
      updateReadout(gs);
    }
  }

  // ---- 控件（第 1 步的临时控件，第 2 步换成身上的把手） ----
  const panel = document.getElementById('controls')!;
  const readout = document.getElementById('readout')!;
  const note = document.getElementById('note')!;

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
    const e = Object.assign(document.createElement(tag), attrs);
    e.append(...kids);
    return e;
  };
  const slider = (name: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, fmt: (v: number) => string) => {
    const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
    const v = el('span', { className: 'v' });
    input.addEventListener('input', () => {
      set(Number(input.value));
      v.textContent = fmt(Number(input.value));
    });
    const sync = (): void => {
      input.value = String(get());
      v.textContent = fmt(get());
    };
    panel.append(el('label', {}, name, input, v));
    return sync;
  };
  const kgText = (kg: number): string => (kg < 1 ? `${Math.round(kg * 1000)} 克` : kg < 10 ? `${kg.toFixed(1)} 千克` : `${Math.round(kg)} 千克`);
  const times = (x: number): string => `×${x.toFixed(2)}`;

  panel.append(el('h3', {}, '从现有技术开始'));
  const tplRow = el('div', { className: 'row' });
  const tplButtons = new Map<string, HTMLButtonElement>();
  for (const t of MAMMALS) {
    const b = el('button', { textContent: speciesLibrary.get(t.species)?.name ?? t.species });
    b.addEventListener('click', () => loadTemplate(t.species));
    tplButtons.set(t.species, b);
    tplRow.append(b);
  }
  panel.append(tplRow);

  panel.append(el('h3', {}, '身体'));
  const syncs: (() => void)[] = [];
  syncs.push(
    slider('体重', -2, 3, 0.01, () => Math.log10(design.bodyMassKg), (v) => {
      design.bodyMassKg = Math.round(Math.pow(10, v) * 1000) / 1000;
      note.textContent = '';
      rebuild();
    }, (v) => kgText(Math.pow(10, v))),
  );
  syncs.push(slider('腿长', -0.2, 0.2, 0.01, () => design.shape?.leg ?? 0, (v) => ((design.shape = { ...design.shape, leg: v }), rebuild()), (v) => times(Math.pow(10, v))));
  syncs.push(slider('尾长', -0.3, 0.3, 0.01, () => design.shape?.tail ?? 0, (v) => ((design.shape = { ...design.shape, tail: v }), rebuild()), (v) => times(Math.pow(10, v))));

  panel.append(el('h3', {}, '体重分配（倍数，总量不变）'));
  for (const s of BODY_SYSTEMS) {
    syncs.push(
      slider(SYSTEM_NAMES[s], -1, 1, 0.05, () => Math.log2(design.allocation?.[s] ?? 1), (v) => {
        design.allocation = { ...design.allocation, [s]: Math.round(Math.pow(2, v) * 100) / 100 };
        rebuild();
      }, (v) => times(Math.pow(2, v))),
    );
  }

  panel.append(el('h3', {}, '部件'));
  const selects = new Map<(typeof SHOWN_SLOTS)[number], HTMLSelectElement>();
  for (const slot of SHOWN_SLOTS) {
    const sel = el('select');
    for (const p of partLibrary.values()) {
      if (p.slot !== slot || p.id === 'wings') continue;
      sel.append(el('option', { value: p.id, textContent: p.name }));
    }
    sel.addEventListener('change', () => {
      design.parts = { ...design.parts, [slot]: sel.value };
      rebuild();
    });
    selects.set(slot, sel);
    panel.append(el('label', {}, slot === 'mouth' ? '口器' : slot === 'coat' ? '体表' : slot === 'limbs' ? '腿' : slot === 'tail' ? '尾' : '消化', sel, el('span')));
  }

  panel.append(el('h3', {}, '它在干什么'));
  const modeRow = el('div', { className: 'row' });
  const modeButtons = new Map<Mode, HTMLButtonElement>();
  for (const [m, name] of [['auto', '自己待着'], ['stand', '站'], ['walk', '走'], ['run', '跑'], ['eat', '吃'], ['lie', '趴']] as const) {
    const b = el('button', { textContent: name });
    b.addEventListener('click', () => {
      applyMode(m);
      refreshControls();
    });
    modeButtons.set(m, b);
    modeRow.append(b);
  }
  panel.append(modeRow);
  const speedInput = el('input', { type: 'range', min: '0', max: '1', step: '0.001' });
  const speedV = el('span', { className: 'v' });
  speedInput.addEventListener('input', () => {
    // 滑块按 √ 刻度：慢速那一段更细。
    const v = Math.pow(Number(speedInput.value), 2) * top();
    chosenRunSpeed = v;
    mode = 'run';
    behavior = 'move';
    targetSpeed = v;
    refreshControls();
  });
  panel.append(el('label', {}, '速度', speedInput, speedV));

  function refreshControls(): void {
    for (const s of syncs) s();
    for (const [slot, sel] of selects) sel.value = design.parts[slot];
    for (const [id, b] of tplButtons) b.classList.toggle('on', id === templateId);
    for (const [m, b] of modeButtons) b.classList.toggle('on', m === mode);
    const t = top();
    speedInput.value = String(Math.sqrt(Math.min(1, targetSpeed / t)));
    speedV.textContent = `${targetSpeed.toFixed(1)} 米/秒`;
    note.textContent =
      design.parts.coat === 'feathers' ? '长了羽毛：推演里按鸟的公式算。画面先用兽的骨架，鸟的骨架下一步做。' : note.textContent && note.textContent.startsWith('长了羽毛') ? '' : note.textContent;
  }

  function updateReadout(gs: ReturnType<typeof gaitOf>): void {
    const M = design.bodyMassKg;
    const rows = [
      `<b>${kgText(M)}</b> · 头体长 ${plan.bodyLen.toFixed(2)} 米 · 腿 ${plan.legLen.toFixed(2)} 米`,
      `速度 ${speed.toFixed(1)} 米/秒（${(speed * 3.6).toFixed(0)} 千米/时）`,
      `弗劳德数 ${gs.froude.toFixed(2)} → <b>${behavior === 'eat' && gs.gait === 'stand' ? '吃' : behavior === 'lie' && gs.gait === 'stand' ? '趴着' : GAIT_NAMES[gs.gait]}</b>`,
      gs.gait === 'stand' ? '步频 —' : `步频 ${gs.strideHz.toFixed(2)} 赫兹 · 步长 ${gs.strideM.toFixed(2)} 米`,
      `呼吸 ${Math.round(breathsPerMin(gaitRules, M))} 次/分 · 心跳 ${Math.round(heartPerMin(gaitRules, M))} 次/分（静息）`,
      `最快 ${(top() * 3.6).toFixed(0)} 千米/时`,
    ];
    readout.innerHTML = rows.join('<br>');
  }

  function loadTemplate(id: string): void {
    const t = MAMMALS.find((x) => x.species === id);
    if (!t) return;
    templateId = id;
    design = structuredClone(t.design);
    look = lookOf(speciesColor(id).body);
    chosenRunSpeed = null;
    rebuild();
  }

  interface DeskParams {
    template?: string;
    mass?: number;
    mode?: Mode;
    speed?: number;
    leg?: number;
    tail?: number;
    parts?: Partial<Design['parts']>;
    allocation?: Partial<Record<BodySystem, number>>;
  }
  function set(p: DeskParams): void {
    if (p.template) loadTemplate(p.template);
    if (p.mass !== undefined) design.bodyMassKg = p.mass;
    if (p.leg !== undefined || p.tail !== undefined) design.shape = { ...design.shape, ...(p.leg !== undefined ? { leg: p.leg } : {}), ...(p.tail !== undefined ? { tail: p.tail } : {}) };
    if (p.parts) design.parts = { ...design.parts, ...p.parts } as Design['parts'];
    if (p.allocation) design.allocation = { ...design.allocation, ...p.allocation };
    if (p.speed !== undefined) chosenRunSpeed = p.speed;
    rebuild();
    if (p.mode) applyMode(p.mode);
    refreshControls();
  }
  /** 录屏用：停掉实时时钟，按固定步长一帧一帧地走（无头浏览器帧率低时，录出来的节奏仍是真实的）。 */
  function step(dt: number): void {
    app.ticker.stop();
    frame(dt);
    app.render();
  }
  (window as unknown as { desk: { set: typeof set; step: typeof step } }).desk = { set, step };

  const q = new URLSearchParams(location.search);
  const num = (k: string): number | undefined => (q.has(k) ? Number(q.get(k)) : undefined);
  const initial: DeskParams = {};
  if (q.has('t')) initial.template = q.get('t')!;
  const qMass = num('mass');
  if (qMass !== undefined) initial.mass = qMass;
  if (q.has('mode')) initial.mode = q.get('mode') as Mode;
  const qSpeed = num('speed');
  if (qSpeed !== undefined) initial.speed = qSpeed;
  const qLeg = num('leg');
  if (qLeg !== undefined) initial.leg = qLeg;
  const qTail = num('tail');
  if (qTail !== undefined) initial.tail = qTail;
  set(initial);
  if (!q.has('mass')) note.textContent = '试试：把体重拖到 200 千克。再按"跑"，拖速度。';
}

void main();
