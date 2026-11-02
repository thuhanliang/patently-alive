import { AlphaFilter, Application, Assets, Container, Graphics, Text, type Texture } from 'pixi.js';
import { designTemplates, gaitRules, hintTemplates, morphLibrary, partLibrary, plantLibrary, scalingLaws, speciesLibrary, viabilityRules, type Design } from '../../data';
import { BODY_SYSTEMS, type BodySystem } from '../../data/schema/viability';
import { compileDesign, makeDesignKit, partsOf, type CompiledDesign, type EnvironmentProfile } from '../../sim';
import { requestedOf } from '../../sim/body';
import { AllocPie, requestFor } from './pie';
import { FoodPile, dailyFood, type DailyFood } from './food';
import { drawXray } from './xray';
import { CHECK_NAMES, GRADE_NAMES, cannotStand, limpOf, signsOf, thermalOf, thinOf, type Sign } from './signs';
import { Tray, appearanceFor, drawEarIcon, isMorph, type TrayItem, type TrayTab } from './tray';
import { BLUEPRINT, speciesColor } from '../../render/palette';
import { breathsPerMin, chewHz, gaitOf, heartPerMin, speedAtFroude, topSpeed, walkSpeed, type Gait } from '../../render/puppet/gait';
import { EAR_ABSENT, EAR_TIP_CAT, bodyPlan, intermembralOf, type BodyPlan } from '../../render/puppet/plan';
import { blendPose, eatPose, gaitPose, liePose, standPose, type Pose } from '../../render/puppet/pose';
import { Puppet, lookOf, type Look } from '../../render/puppet/puppet';
import type { CutData } from '../../render/puppet/cutout';
import { CutoutPuppet } from '../../render/puppet/cutoutPuppet';
import type { HandleId, HandleSpot, XrayBones } from '../../render/puppet/handles';
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
const GAIT_NAMES: Record<Gait, string> = { stand: '站着', walk: '走', trot: '小跑', gallop: '奔跑', hop: '跳' };
/** 托盘里的部件槽（按托盘的顺序）。 */
const SHOWN_SLOTS = ['mouth', 'limbs', 'tail', 'coat', 'digestion'] as const;
const SLOT_NAMES: Record<(typeof SHOWN_SLOTS)[number], string> = { mouth: '嘴', limbs: '腿', tail: '尾', coat: '体表', digestion: '消化' };
/** 比这窄、或者比这矮（横着拿的手机）就是手机的排法（和 desk.html 的 @media 一致）。 */
const NARROW = 720;
const SHORT = 500;
const isPhone = (W: number, H: number): boolean => W < NARROW || H < SHORT;

// ---- 状态 ----
let templateId = 'cat';
let design: Design = structuredClone(MAMMALS.find((t) => t.species === templateId)!.design);
let look: Look = lookOf(speciesColor(templateId).body);
/** 冷热试验的气温（°C）；null 是不试（默认）：不给气候，冷热这一项检查跳过，和以前一模一样。 */
let climateC: number | null = null;
const envOf = (): EnvironmentProfile | undefined => (climateC === null ? undefined : { climate: { temperatureC: climateC } });
let compiled: CompiledDesign = compileDesign(design, kit);
let plan: BodyPlan = deskPlanOf(design, compiled);
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
/** 设计台上的纸偶：体征（第 3 步 a）让它瘦一点——躯干的纸片变薄、肚子收进去。只是画面，推演不读。 */
function deskPlanOf(d: Design, c: CompiledDesign): BodyPlan {
  const p = planOf(d, c);
  const k = thinOf(c.viability);
  return k === 1 ? p : { ...p, chestH: p.chestH * k, hindH: p.hindH * k, belly: p.belly * k * k };
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
    return { key, f: () => gaitPose(plan, { ...gaitOf(gaitRules, Math.max(speed, 1e-3), plan.legLen, intermembralOf(plan)), gait: g, duty: gaitRules.duty[g].value }, phase) };
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

// 切图零件（?cut=<名字>）：按需加载，打包时一起带上（GitHub Pages 上也能用）。
const CUT_DATA = import.meta.glob<unknown>('../../../art/incoming/lovart/paper/cuts/*/vector.json', { import: 'default' });
const CUT_PAPER = import.meta.glob<string>('../../../art/incoming/lovart/paper/cuts/*/paper.png', { query: '?url', import: 'default' });

// ---- 画面 ----
async function main(): Promise<void> {
  const app = new Application();
  await app.init({ resizeTo: window, background: 0xe9dcc0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
  document.body.prepend(app.canvas);

  const refLayer = new Container();
  const ground = new Graphics();
  const tapeLabels = new Container();
  const puppetLayer = new Container();
  /** 长在纸偶身上的把手（蓝图蓝的墨点）和拖动时的标注。 */
  const handleInk = new Graphics();
  /** 卡片扣上时的"咔"（一圈蓝图蓝的墨圈）和拖着卡片时纸偶四角的裁切角。 */
  const snapInk = new Graphics();
  const handleLabel = new Text({ text: '', style: { fontFamily: 'system-ui, sans-serif', fontSize: 13, fill: BLUEPRINT, fontWeight: '600' } });
  handleLabel.visible = false;
  /** 体重分配纸饼（第 2 步 b）：画在屏幕上，不随镜头缩放。 */
  const pie = new AllocPie(SYSTEM_NAMES);
  // 一天的饭量（第 3 步 c）：按纸偶的比例尺堆在它前脚前面。
  const foodPile = new FoodPile();
  let food: DailyFood = dailyFood(compiled, partsOf(design, kit).mouth.selective === true, gaitRules.food);
  // X 光层（第 3 步 c）：纸偶淡下去，画骨头和肌肉。只有切图纸偶报得出骨架。
  const xrayInk = new Graphics();
  let xrayOn = false;
  app.stage.addChild(refLayer, ground, tapeLabels, foodPile.view, puppetLayer, xrayInk, handleInk, snapInk, handleLabel, pie.view);
  // ?cut=<名字>：用成品图切出来的零件（白模）代替代码画的纸偶，检验真零件演同一套动作的效果（开发用）。
  const cut = new URLSearchParams(location.search).get('cut');
  let puppet: { view: Container; build(plan: BodyPlan, look: Look): void; apply(pose: Pose, dt: number, breath?: number): void; setScale(pxPerM: number): void; handles(): HandleSpot[]; skeleton?(): XrayBones | null };
  /** 切图零件（参照动物也用它拼）。 */
  let cutKit: { data: CutData; paper: Texture; ref: BodyPlan } | null = null;
  if (cut) {
    const dir = `../../../art/incoming/lovart/paper/cuts/${cut}`;
    const data = (await CUT_DATA[`${dir}/vector.json`]!()) as CutData;
    const paper = (await Assets.load(await CUT_PAPER[`${dir}/paper.png`]!())) as Texture;
    paper.source.addressMode = 'repeat';
    // 成品图画的是哪条现有技术：按它的身体算“原样”，其他身体按比例贴。
    const refDesign = MAMMALS.find((t) => t.species === data.rig.template)!.design;
    cutKit = { data, paper, ref: planOf(refDesign, compileDesign(refDesign, kit)) };
    puppet = new CutoutPuppet(data, paper, { main: 0xe6d8bd, stripe: 0xe6d8bd, pale: 0xe6d8bd }, cutKit.ref, plan);
  } else {
    puppet = new Puppet(plan, look);
  }
  puppetLayer.addChild(puppet.view);
  const labelPool: Text[] = [];

  let zoom = 0; // 每米多少像素，平滑地追目标
  /** 舞台上纸偶站的位置（屏幕像素），平滑地追空地的中间。 */
  let stageX = NaN;
  let stageY = NaN;
  /** 手指 / 滚轮叠上去的缩放（k 倍）和拖动（x、y 像素）。 */
  const view = { k: 1, x: 0, y: 0 };
  let refKey = '';
  let refs: { view: Container; label: Text; head: { x: number; y: number }; earM: number; setZoom(z: number): void }[] = [];

  function rebuild(): void {
    compiled = compileDesign(design, kit, envOf());
    food = dailyFood(compiled, partsOf(design, kit).mouth.selective === true, gaitRules.food);
    plan = deskPlanOf(design, compiled);
    puppet.build(plan, look);
    signs = signsOf(compiled.viability);
    renderSigns();
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
      const color = i === 0 ? 0x9c8467 : 0x7d6a54;
      const alpha = i === 0 ? 0.22 : 0.16;
      const label = referenceLabel(r, 0x8a7458);
      if (cutKit) {
        // 切图零件拼的参照动物：按 look 拿现有技术的设计当底子，体重换成参照的，站着不动，画成影子纸。
        const base = MAMMALS.find((t) => t.species === r.look.template)!.design;
        const d: Design = structuredClone(base);
        d.bodyMassKg = r.massKg;
        d.parts = { ...d.parts, ...r.look.parts } as Design['parts'];
        d.appearance = { ...d.appearance, ...r.look.appearance };
        const p = planOf(d, compileDesign(d, kit));
        const ref = new CutoutPuppet(cutKit.data, cutKit.paper, { main: color, stripe: color, pale: color }, cutKit.ref, p, true);
        ref.apply(standPose(p), 0);
        // 整只一起半透明（零件叠在一起的地方不会更深）。
        ref.view.filters = [new AlphaFilter({ alpha: alpha * 1.6 })];
        ref.setScale(1);
        const b = ref.view.getLocalBounds();
        const k = ref.view.scale.x;
        refLayer.addChild(ref.view, label);
        return { view: ref.view, label, head: { x: (b.x + b.width * 0.8) * k, y: -b.y * k }, earM: 0, setZoom: (z: number) => ref.setScale(z) };
      }
      const view = drawReference(r, color, alpha);
      refLayer.addChild(view, label);
      return { view, label, head: referenceHead(r), earM: referenceHeightM(r) - referenceHead(r).y, setZoom: (z: number) => view.scale.set(z / 1000) };
    });
  }

  /** 纸偶和参照动物都放得下的缩放（W、H 是舞台的空地：宽屏去掉左边的参数面板，手机去掉上面的读数和底下的抽屉）。 */
  function targetZoom(W: number, H: number, narrow: boolean): number {
    const lenM = plan.bodyLen + plan.tailLen * 0.7 + plan.snout + plan.headR * 2;
    const hM = plan.legLen + plan.chestH * 2 + plan.neckLen + plan.headR * 2;
    let refLen = 0;
    let refH = 0;
    for (const r of bracket(gaitRules.references.animals, design.bodyMassKg)) {
      refLen = Math.max(refLen, r.bodyLengthM * (1.6 + r.tail));
      refH = Math.max(refH, referenceHeightM(r));
    }
    // 手机：纸偶占得满一些，参照动物的剪影可以出一点画面。
    const fill = narrow ? 0.8 : 0.5;
    const refFill = narrow ? 1.1 : 0.85;
    return Math.min((W * fill) / lenM, (H * 0.45) / hM, (W * refFill) / Math.max(refLen, 1e-3), (H * 0.6) / Math.max(refH, 1e-3));
  }

  function drawGround(W: number, gy: number, px: number, zoom: number): void {
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
    // 体征：骨头撑不起这身体重，只能趴着。
    if (cannotStand(compiled.viability)) {
      targetSpeed = 0;
      behavior = 'lie';
    }

    // 速度平滑地追目标（大动物加减速慢一点）。
    const tau = 0.5 * Math.sqrt(plan.legLen / 0.25);
    speed += (targetSpeed - speed) * (1 - Math.exp(-dt / tau));
    if (targetSpeed === 0 && speed < 0.01 * Math.sqrt(plan.legLen)) speed = 0;
    const gs = gaitOf(gaitRules, speed, plan.legLen, intermembralOf(plan));
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

    // 体征：跛。前腿（近侧）着地时头往上一扬、肩往下一沉，抬起来时恢复（前肢跛行的样子）。只是画面。
    const lame = limpOf(compiled.viability, gs.gait === 'trot' || gs.gait === 'gallop' || gs.gait === 'hop', gs.gait !== 'stand');
    if (lame > 0) {
      const lift = Math.min(1, pose.feet.nearFore.y / Math.max(1e-6, 0.06 * plan.legLen));
      const load = 1 - lift;
      pose = { ...pose, neck: pose.neck + lame * (0.5 * load - 0.18), head: pose.head + lame * 0.2 * load, shoulderY: pose.shoulderY - lame * 0.08 * plan.legLen * load };
    }

    // 冷热试验（第 3 步 b）：冷了缩着脖子发抖（时间按帧的 dt 走，逐帧截图也一样）；热了张着嘴喘，呼吸快很多。只是画面。
    const th = thermalOf(compiled.viability);
    if (th.shiver > 0) {
      const q = th.shiver * Math.sin(time * Math.PI * 2 * 11);
      pose = { ...pose, neck: pose.neck - 0.15 * th.shiver, shoulderY: pose.shoulderY + q * 0.008 * plan.legLen, hipY: pose.hipY - q * 0.006 * plan.legLen, head: pose.head + q * 0.04 };
    }

    // 呼吸：静息按体重；走、跑时加快；奔跑时一步一口气（跑步和呼吸同步，Bramble & Carrier 1983，未核对）。喘的时候快到三倍。
    const rest = breathsPerMin(gaitRules, design.bodyMassKg) / 60;
    const bHz0 = gs.gait === 'gallop' || gs.gait === 'hop' ? gs.strideHz : gs.gait === 'trot' ? rest * 2.5 : gs.gait === 'walk' ? rest * 1.5 : behavior === 'lie' ? rest * 0.85 : rest;
    const bHz = bHz0 * (1 + 2 * th.pant);
    breathPhase += bHz * dt;
    if (th.pant > 0) pose = { ...pose, jaw: Math.max(pose.jaw, th.pant * 0.3 * (0.75 + 0.25 * Math.sin(breathPhase * Math.PI * 2))) };
    puppet.apply(pose, dt, Math.sin(breathPhase * Math.PI * 2));

    // 舞台的空地：宽屏左边让给参数面板；手机上参数在底部的抽屉里，上面是一条读数。
    const narrow = isPhone(W, H);
    const left = narrow ? 0 : 320;
    const top = narrow ? readout.getBoundingClientRect().bottom : 0;
    const bottom = narrow ? panel.getBoundingClientRect().top : H;
    const stageH = Math.max(80, bottom - top);
    // 缩放：慢慢追，体重一变先看到它长大，再看到镜头往后拉。抽屉开合时舞台也慢慢挪过去。
    const tz = targetZoom(W - left, stageH, narrow);
    const ease = (from: number, to: number, tau: number): number => from + (to - from) * (1 - Math.exp(-dt / tau));
    zoom = zoom === 0 ? tz : Math.exp(ease(Math.log(zoom), Math.log(tz), 0.8));
    const sx = left + (W - left) * 0.5;
    const sy = top + stageH * 0.72;
    stageX = Number.isNaN(stageX) || dt === 0 ? sx : ease(stageX, sx, 0.25);
    stageY = Number.isNaN(stageY) || dt === 0 ? sy : ease(stageY, sy, 0.25);
    stageBox = { top, h: stageH };
    // 拖耳上的把手时镜头推近（松手退回）。
    if (focus) {
      const f = focus;
      view.k = Math.exp(ease(Math.log(view.k), Math.log(f.k), 0.18));
      view.x = ease(view.x, f.x, 0.18);
      view.y = ease(view.y, f.y, 0.18);
      if (!grab && Math.abs(Math.log(view.k / f.k)) < 0.002 && Math.hypot(view.x - f.x, view.y - f.y) < 0.5) {
        Object.assign(view, { k: f.k, x: f.x, y: f.y });
        focus = null;
      }
      if (grab) resetBtn.hidden = true;
    }
    // 再叠上手指 / 滚轮的缩放和拖动（view）。
    const z = zoom * view.k;
    const gy = Math.round(stageY + view.y);
    const px = stageX + view.x;
    puppet.setScale(z);
    puppet.view.position.set(px, gy);
    rebuildRefs();
    let prevLabel: Text | null = null;
    for (const r of refs) {
      r.setZoom(z);
      r.view.position.set(px, gy);
      // 名字签挂在剪影的头上方；和前一张的签挤在一起时往上挪。
      let y = gy - (r.head.y + r.earM) * z - 18;
      const x = px + r.head.x * z - r.label.width / 2;
      if (prevLabel && Math.abs(prevLabel.y - y) < 16 && Math.abs(prevLabel.x - x) < prevLabel.width) y = prevLabel.y - 16;
      r.label.position.set(x, y);
      prevLabel = r.label;
    }
    drawGround(W, gy, px, z);
    foodPile.draw(food, px + 0.62 * plan.bodyLen * z, gy, z);
    // 卡片扣上的"咔"：纸偶从地面往上一弹（约 1 秒，下一次扣卡从头开始）；停下以后正好是 1，不影响截图。
    snapT += dt;
    if (snapT < 1.2) {
      const a = 0.08 * Math.exp(-4.5 * snapT) * Math.cos(15 * snapT);
      puppet.view.scale.x *= 1 - 0.5 * a;
      puppet.view.scale.y *= 1 + a;
    }
    const bones = xrayOn ? (puppet.skeleton?.() ?? null) : null;
    puppetLayer.alpha = bones ? 0.28 : 1;
    if (bones) {
      const sc = (q: [number, number]): [number, number] => {
        const g = puppet.view.toGlobal({ x: q[0], y: q[1] });
        return [g.x, g.y];
      };
      drawXray(xrayInk, { legs: { nearHind: bones.legs.nearHind.map(sc), nearFore: bones.legs.nearFore.map(sc), farHind: bones.legs.farHind.map(sc), farFore: bones.legs.farFore.map(sc) }, spine: [sc(bones.spine[0]), sc(bones.spine[1])], neck: [sc(bones.neck[0]), sc(bones.neck[1])], tail: bones.tail.map(sc) }, plan, z);
    } else xrayInk.clear();
    drawHandles(dt);
    drawSnap();
    placeSigns();
    // 纸饼：宽屏放在右上（提示条下面），手机放在读数下面的右上角（纸偶在空地的下半部分）。
    if (narrow && H < SHORT) {
      // 横着拿：空地矮，纸饼放在左边的空处（纸偶站在中间）。
      pie.r0 = 24;
      pie.cx = 70;
      pie.cy = top + stageH * 0.45;
    } else if (narrow) {
      pie.r0 = 31;
      pie.cx = W - 80;
      pie.cy = top + 84;
    } else {
      pie.r0 = 50;
      pie.cx = W - 130;
      pie.cy = 185;
    }
    pie.draw(compiled.body, design.bodyMassKg, pieGrab?.sys ?? pieHover, kgText);
    if (!resetBtn.hidden) resetBtn.style.top = `${Math.round(top + 12)}px`;
    // 手机：提示条贴在抽屉上面（抽屉的高度随托盘、横竖屏变）。
    note.style.bottom = narrow ? `${Math.round(H - bottom + 8)}px` : '';

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
  const resetBtn = document.getElementById('viewReset') as HTMLButtonElement;

  // 手机：参数收在底部的抽屉里，一开始收着（先看到纸偶）；读数只显示两行，点一下看全部。
  const sheet = document.getElementById('sheet')!;
  const setSheet = (open: boolean): void => {
    panel.classList.toggle('collapsed', !open);
    sheet.textContent = open ? '▼ 收起' : '▲ 更多：动作、全部滑块';
  };
  setSheet(!isPhone(window.innerWidth, window.innerHeight));
  sheet.addEventListener('click', () => setSheet(panel.classList.contains('collapsed')));
  readout.addEventListener('click', () => readout.classList.toggle('open'));

  // 舞台的手势：双指捏合缩放、单指拖动（看细节用），双击复位；桌面上滚轮缩放、拖动。只改画面，不碰设计。
  const canvas = app.canvas;
  const pointers = new Map<number, { x: number; y: number }>();
  let lastTap = { t: 0, x: 0, y: 0 };
  /** 一次点按：从哪儿按下、最远挪了多少（分辨"点一下"和"拖"）。 */
  let tapStart: { t: number; x: number; y: number; moved: number } | null = null;
  /** 以屏幕上的点 (cx, cy) 为中心缩放 f 倍：那一点下面的东西不动。 */
  const zoomAt = (cx: number, cy: number, f: number): void => {
    const k = Math.min(12, Math.max(0.5, view.k * f));
    const g = k / view.k;
    view.x = cx - stageX - (cx - stageX - view.x) * g;
    view.y = cy - stageY - (cy - stageY - view.y) * g;
    view.k = k;
    focus = null;
    resetBtn.hidden = false;
  };
  const resetView = (): void => {
    focus = null;
    view.k = 1;
    view.x = 0;
    view.y = 0;
    resetBtn.hidden = true;
  };
  resetBtn.addEventListener('click', resetView);
  const local = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener('pointerdown', (e) => {
    const p = local(e);
    // 手指先按到纸饼或把手就归它们；拖着的时候别的手指不管。没按到才是拖动、缩放画面。
    if (grab || pieGrab) return;
    if (pointers.size === 0) {
      const sys = pie.hit(p.x, p.y);
      if (sys) {
        const r = pie.r0 * Math.sqrt(compiled.body.relative[sys]);
        pieGrab = { pointerId: e.pointerId, sys, d0: Math.hypot(p.x - pie.cx, p.y - pie.cy), r0: r };
        canvas.style.cursor = 'grabbing';
        canvas.setPointerCapture(e.pointerId);
        return;
      }
      const hit = pickHandle(p, e.pointerType);
      if (hit) {
        startGrab(hit, e.pointerId, p);
        canvas.setPointerCapture(e.pointerId);
        return;
      }
    }
    pointers.set(e.pointerId, p);
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 1) {
      tapStart = { t: performance.now(), ...p, moved: 0 };
      const now = performance.now();
      if (now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
        resetView();
        lastTap = { t: 0, x: 0, y: 0 };
      } else lastTap = { t: now, ...p };
    } else tapStart = null;
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (pieGrab) {
      if (e.pointerId === pieGrab.pointerId) dragPie(p);
      return;
    }
    if (grab) {
      if (e.pointerId === grab.pointerId) dragHandle(p);
      return;
    }
    const old = pointers.get(e.pointerId);
    if (!old) {
      // 鼠标悬停：指到纸偶身上，把手显出来；指到把手上，换成手的光标。
      if (e.pointerType === 'mouse') hoverAt(p);
      return;
    }
    if (tapStart) tapStart.moved = Math.max(tapStart.moved, Math.hypot(p.x - tapStart.x, p.y - tapStart.y));
    if (pointers.size === 1) {
      view.x += p.x - old.x;
      view.y += p.y - old.y;
      if (Math.hypot(view.x, view.y) > 2) resetBtn.hidden = false;
    } else if (pointers.size === 2) {
      const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
      const d0 = Math.hypot(old.x - other.x, old.y - other.y);
      const d1 = Math.hypot(p.x - other.x, p.y - other.y);
      // 两指的中点跟着走（拖动），两指的距离决定缩放。
      view.x += (p.x - old.x) / 2;
      view.y += (p.y - old.y) / 2;
      if (d0 > 1) zoomAt((p.x + other.x) / 2, (p.y + other.y) / 2, d1 / d0);
    }
    pointers.set(e.pointerId, p);
  });
  const up = (e: PointerEvent): void => {
    if (pieGrab && e.pointerId === pieGrab.pointerId) {
      pieGrab = null;
      canvas.style.cursor = '';
      refreshControls();
      return;
    }
    if (grab && e.pointerId === grab.pointerId) {
      endGrab();
      return;
    }
    pointers.delete(e.pointerId);
    // 触屏没有悬停：点一下纸偶，把手亮出来，一会儿不动就淡掉。
    const t = tapStart;
    tapStart = null;
    if (t && e.type === 'pointerup' && e.pointerType !== 'mouse' && t.moved < 10 && performance.now() - t.t < 400 && onPuppet(local(e), 12)) showHandles(4000);
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !grab) {
      mouseInside = false;
      hoverId = null;
      pieHover = null;
      canvas.style.cursor = '';
    }
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    },
    { passive: false },
  );
  // iOS Safari 的整页捏合缩放：在画布上不要（画布自己缩放）。
  canvas.addEventListener('gesturestart', (e) => e.preventDefault());


  // ---- 长在纸偶身上的把手（第 2 步；docs/feel/desk.md）----
  // 背 → 体重，脚 → 腿长，尾尖 → 尾长，耳尖 → 耳长，耳根后缘 → 耳宽，肚子底下的毛尖 → 毛长。每个把手只改一件事。
  const HANDLE_NAMES: Record<HandleId, string> = { back: '体重', toe: '腿长', tail: '尾长', earTip: '耳长', earWide: '耳宽', fur: '毛长' };
  type Pt = { x: number; y: number };
  /** 这一帧的把手（屏幕坐标）。 */
  let spots: { id: HandleId; at: Pt; from: Pt; unit: number }[] = [];
  /** 把手显到什么时候（performance.now()），现在的不透明度。 */
  let handlesUntil = 0;
  let handleAlpha = 0;
  let hoverId: HandleId | null = null;
  /** 鼠标停在纸偶身上：把手一直亮着（瞄准的时候不动，也不该淡掉）。 */
  let mouseInside = false;
  interface Grab {
    id: HandleId;
    pointerId: number;
    /**
     * 按下时手指、把手、参照点。back/toe/tail 用屏幕坐标（体重一变镜头会退，按按下时的画面算才稳）；
     * 耳用纸偶的 view 坐标：镜头推近时手指不动耳就不变，手指挪多少像素、把手在当时的画面里就挪多少。
     */
    p0: Pt;
    /** 耳：上一次手指在屏幕上的位置、把手现在被拖到哪（view 坐标）。 */
    last: Pt;
    cur: Pt;
    at0: Pt;
    from0: Pt;
    unit: number;
    /** 按下时的值。 */
    v0: number;
  }
  let grab: Grab | null = null;
  /** 拖耳上的把手时镜头推近到头部：要去的视图，和松手以后退回的视图。 */
  let focus: { k: number; x: number; y: number } | null = null;
  let focusBack: { k: number; x: number; y: number; hidden: boolean } | null = null;
  /** 上一帧舞台的空地（推近时把耳放到空地中间偏上）。 */
  let stageBox = { top: 0, h: 1 };
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const showHandles = (ms: number): void => {
    handlesUntil = Math.max(handlesUntil, performance.now() + ms);
  };
  const isEar = (id: HandleId): boolean => id === 'earTip' || id === 'earWide';
  /** 拖的时候镜头推近、按纸偶的 view 坐标拖的把手：耳（推近到头）和毛长（推近到肚子）。 */
  const isLocal = (id: HandleId): boolean => isEar(id) || id === 'fur';
  const toView = (q: Pt): Pt => puppet.view.toLocal(q);
  const onPuppet = (p: Pt, pad: number): boolean => {
    const b = puppet.view.getBounds();
    return p.x > b.x - pad && p.x < b.x + b.width + pad && p.y > b.y - pad && p.y < b.y + b.height + pad;
  };
  /** 离手指最近、够得着的把手（触屏的手指粗，够得远一些）；把手没显出来时不算。 */
  const pickHandle = (p: Pt, pointerType: string): (typeof spots)[number] | null => {
    if (handleAlpha < 0.3 && performance.now() > handlesUntil) return null;
    const reach = pointerType === 'mouse' ? 14 : 26;
    let best: (typeof spots)[number] | null = null;
    let bd = reach;
    for (const sp of spots) {
      const d = Math.hypot(sp.at.x - p.x, sp.at.y - p.y);
      if (d < bd) {
        bd = d;
        best = sp;
      }
    }
    return best;
  };
  const hoverAt = (p: Pt): void => {
    pieHover = pie.hit(p.x, p.y);
    mouseInside = !pieHover && onPuppet(p, 24);
    if (mouseInside) showHandles(1200);
    hoverId = pieHover ? null : (pickHandle(p, 'mouse')?.id ?? null);
    canvas.style.cursor = hoverId || pieHover ? 'grab' : '';
  };
  // ---- 体重分配纸饼（第 2 步 b）：按住一瓣往外拖，多给它；总量不变，别的瓣一起缩。 ----
  /** 按下时手指离中心多远、那一瓣多大（拖的时候保持手指和瓣边的距离）。 */
  let pieGrab: { pointerId: number; sys: BodySystem; d0: number; r0: number } | null = null;
  let pieHover: BodySystem | null = null;
  function dragPie(p: Pt): void {
    const g = pieGrab!;
    const r = Math.max(1, g.r0 + Math.hypot(p.x - pie.cx, p.y - pie.cy) - g.d0);
    const target = Math.min(4, Math.max(0.2, (r / pie.r0) ** 2));
    const lo = viabilityRules.body.minRelative.value;
    const hi = viabilityRules.body.maxRelative.value;
    const v = requestFor(g.sys, target, compiled.body.base, requestedOf(design, viabilityRules), lo, hi);
    design.allocation = { ...design.allocation, [g.sys]: Math.round(v * 100) / 100 };
    rebuild();
  }
  const valueOf = (id: HandleId): number => {
    if (id === 'back') return design.bodyMassKg;
    if (id === 'toe') return design.shape?.leg ?? 0;
    if (id === 'tail') return design.shape?.tail ?? 0;
    if (id === 'fur') return furNow();
    if (id === 'earTip') return design.appearance?.earLen ?? 1;
    return design.appearance?.earWide ?? 1;
  };
  const valueText = (id: HandleId): string => {
    const v = valueOf(id);
    if (id === 'back') return kgText(v);
    if (id === 'toe' || id === 'tail') return times(Math.pow(10, v));
    if (id === 'fur') return furText(v);
    if (id === 'earTip' && v <= EAR_ABSENT) return '没有';
    return times(v);
  };
  function startGrab(sp: (typeof spots)[number], pointerId: number, p: Pt): void {
    const ear = isLocal(sp.id);
    // 耳、毛长在纸偶的坐标里拖：推近镜头的时候手指和把手的关系不变。
    const conv = ear ? toView : (q: Pt): Pt => q;
    const at0 = conv(sp.at);
    grab = { id: sp.id, pointerId, p0: conv(p), last: p, cur: at0, at0, from0: conv(sp.from), unit: ear ? sp.unit / puppet.view.scale.x : sp.unit, v0: valueOf(sp.id) };
    canvas.style.cursor = 'grabbing';
    showHandles(2500);
    if (ear) {
      // 局部放大：耳——把耳根放到空地中间偏上，放大到头的半径约占空地高的 18%；
      // 毛长——把肚子放到空地中间偏下，放大到体长约占空地高的六成（整个身子的毛边都看得见，手指拖得开）。已经够大就不再放大。
      const fur = sp.id === 'fur';
      const want = fur ? (stageBox.h * 0.6) / Math.max(1e-6, plan.bodyLen * zoom) : (stageBox.h * 0.18) / Math.max(1e-6, plan.headR * zoom);
      const g = Math.min(12, Math.max(view.k, want)) / view.k;
      const cx = stageX;
      const cy = stageBox.top + stageBox.h * (fur ? 0.6 : 0.42);
      focusBack = { ...view, hidden: resetBtn.hidden === true };
      focus = { k: view.k * g, x: cx - stageX - (sp.from.x - stageX - view.x) * g, y: cy - stageY - (sp.from.y - stageY - view.y) * g };
    }
  }
  function endGrab(): void {
    grab = null;
    canvas.style.cursor = '';
    showHandles(2500);
    if (focusBack) {
      focus = { k: focusBack.k, x: focusBack.x, y: focusBack.y };
      resetBtn.hidden = focusBack.hidden;
      focusBack = null;
    }
    refreshControls();
  }
  function dragHandle(p: Pt): void {
    const g = grab!;
    const ear = isLocal(g.id);
    // 把手跟着手指走到哪（按下时手指和把手中心的偏差保留）。
    let q: Pt;
    if (ear) {
      const k = puppet.view.scale.x;
      g.cur = { x: g.cur.x + (p.x - g.last.x) / k, y: g.cur.y + (p.y - g.last.y) / k };
      g.last = p;
      q = g.cur;
    } else q = { x: g.at0.x + p.x - g.p0.x, y: g.at0.y + p.y - g.p0.y };
    const dist = Math.hypot(q.x - g.from0.x, q.y - g.from0.y);
    const d0 = Math.max(1e-6, Math.hypot(g.at0.x - g.from0.x, g.at0.y - g.from0.y));
    const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    switch (g.id) {
      case 'back': {
        // 背往上拖：背离地多高 ∝ 体重的立方根（先当场长大，镜头慢一点再往后拉）。
        const h0 = Math.max(10, g.from0.y - g.at0.y);
        const h = Math.max(h0 * 0.05, g.from0.y - q.y);
        design.bodyMassKg = Math.round(clamp(g.v0 * Math.pow(h / h0, 3), 0.01, 1000) * 1000) / 1000;
        note.textContent = '';
        break;
      }
      case 'toe': {
        // 脚往下拖：肩到脚的高度变长多少倍，腿就长多少倍（腿长是对数刻度）。
        const h0 = Math.max(10, g.at0.y - g.from0.y);
        const h = Math.max(1, q.y - g.from0.y);
        design.shape = { ...design.shape, leg: r2(clamp(g.v0 + Math.log10(h / h0), -0.2, 0.2)) };
        break;
      }
      case 'tail':
        design.shape = { ...design.shape, tail: r2(clamp(g.v0 + Math.log10(Math.max(1e-3, dist / d0)), -0.3, 0.3)) };
        break;
      case 'earTip': {
        // 耳长拖到没有以后，再拖出来按"耳长 = 1 有多长"算。
        const v = g.v0 > EAR_ABSENT ? (g.v0 * dist) / d0 : dist / Math.max(1e-6, g.unit);
        design.appearance = { ...design.appearance, earLen: r2(clamp(v, 0, 3)) };
        break;
      }
      case 'earWide':
        design.appearance = { ...design.appearance, earWide: r2(clamp((g.v0 * dist) / d0, 0.5, 2)) };
        break;
      case 'fur': {
        // 毛尖往下拖：毛长倍数和把手离轮廓多远成正比（倍数 1 时把手在轮廓上，往上推进身体里是毛短）。
        const k = 1 + (q.y - g.from0.y) / Math.max(1e-6, g.unit);
        design.shape = { ...design.shape, fur: r2(clamp(Math.log10(Math.max(1e-3, k)), FUR_MIN, FUR_MAX)) };
        break;
      }
    }
    showHandles(2500);
    rebuild();
  }
  /** 每帧：读把手的位置、淡入淡出、画墨点和拖动时的标注。 */
  function drawHandles(dt: number): void {
    const toScreen = (q: [number, number]): Pt => {
      const g = puppet.view.toGlobal({ x: q[0], y: q[1] });
      return { x: g.x, y: g.y };
    };
    const sc = puppet.view.scale.x;
    spots = puppet.handles().map((h) => ({ id: h.id, at: toScreen(h.at), from: toScreen(h.from), unit: (h.unit ?? 0) * sc }));
    const want = grab || mouseInside || performance.now() < handlesUntil ? 1 : 0;
    handleAlpha += (want - handleAlpha) * (1 - Math.exp(-dt / (want ? 0.08 : 0.35)));
    if (handleAlpha < 0.01) handleAlpha = want ? handleAlpha : 0;
    handleInk.clear();
    handleLabel.visible = false;
    if (handleAlpha <= 0.01) return;
    const a = handleAlpha;
    const lead = grab?.id ?? hoverId;
    for (const sp of spots) {
      const on = sp.id === lead;
      if (on && grab) {
        // 拖着的时候：从参照点到把手画一条蓝图蓝的量线（背是离地多高，脚是腿多长，尾、耳是多长、多宽）。
        handleInk.moveTo(sp.from.x, sp.from.y).lineTo(sp.at.x, sp.at.y).stroke({ color: BLUEPRINT, width: 1.5, alpha: 0.7 * a });
        handleInk.circle(sp.from.x, sp.from.y, 2.5).fill({ color: BLUEPRINT, alpha: 0.7 * a });
      }
      // 触屏上大一点（手指比鼠标粗）。
      const r = (on ? 7 : 5) + (coarse ? 2 : 0);
      handleInk.circle(sp.at.x, sp.at.y, r + 3).fill({ color: 0xfbf6ea, alpha: 0.75 * a });
      handleInk.circle(sp.at.x, sp.at.y, r).fill({ color: BLUEPRINT, alpha: a });
    }
    const ls = lead ? spots.find((sp) => sp.id === lead) : undefined;
    if (ls) {
      handleLabel.text = grab ? `${HANDLE_NAMES[ls.id]} ${valueText(ls.id)}` : `拖：${HANDLE_NAMES[ls.id]}`;
      handleLabel.alpha = a;
      handleLabel.position.set(Math.round(ls.at.x + 12), Math.round(ls.at.y - 22));
      handleLabel.visible = true;
    }
  }

  // ---- 体征（第 3 步 a）：可行性检查的结果长在身上，挂一张小纸签；点签看是哪一项检查、余量多少。 ----
  let signs: Sign[] = [];
  const signLayer = document.getElementById('signs')!;
  const signCard = document.getElementById('signCard')!;
  const signTags = new Map<string, HTMLButtonElement>();
  function renderSigns(): void {
    signLayer.replaceChildren();
    signTags.clear();
    for (const sg of signs) {
      const b = document.createElement('button');
      b.className = `sign${sg.loudest ? ' loud' : ''}`;
      b.textContent = sg.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openSign(sg, b);
      });
      signTags.set(sg.id, b);
      signLayer.append(b);
    }
    if (!signs.some((sg) => signCard.dataset.id === sg.id)) signCard.hidden = true;
  }
  function openSign(sg: Sign, tag: HTMLElement): void {
    const texts = compiled.hints.filter((h) => sg.hintIds.includes(h.id)).map((h) => h.text);
    const margin = Number.isFinite(sg.margin) ? `余量 ×${sg.margin.toFixed(2)}（1 以上才够用）` : '';
    signCard.replaceChildren();
    const h = document.createElement('b');
    h.textContent = `${CHECK_NAMES[sg.id]}：${GRADE_NAMES[sg.grade]}`;
    signCard.append(h);
    for (const t of texts) {
      const p = document.createElement('p');
      p.textContent = t;
      signCard.append(p);
    }
    if (margin) {
      const m = document.createElement('div');
      m.className = 'margin';
      m.textContent = margin;
      signCard.append(m);
    }
    signCard.dataset.id = sg.id;
    signCard.classList.toggle('loud', sg.loudest);
    signCard.hidden = false;
    const r = tag.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 16);
    signCard.style.width = `${w}px`;
    signCard.style.left = `${Math.round(Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)))}px`;
    signCard.style.top = `${Math.round(Math.max(8, r.top - signCard.offsetHeight - 8))}px`;
  }
  document.addEventListener('pointerdown', (e) => {
    if (!signCard.hidden && !signCard.contains(e.target as Node) && !(e.target as HTMLElement).classList?.contains('sign')) signCard.hidden = true;
  });
  /** 每帧：纸签挂在对应的部位旁边（骨骼在前腿上，消化在肚子上，繁殖在后腹，冷热在背上方）。 */
  function placeSigns(): void {
    if (!signs.length) return;
    const at = (id: HandleId): (typeof spots)[number] | undefined => spots.find((sp) => sp.id === id);
    const back = at('back');
    const toe = at('toe');
    const tail = at('tail');
    if (!back || !toe) return;
    const ground = toe.at.y;
    // 骨骼挂在肩下（前腿的上端，走路时不跟着脚甩），消化挂在肚子上，繁殖挂在后腹。
    const pos: Record<Sign['id'], Pt> = {
      skeleton: { x: toe.from.x, y: toe.from.y + (ground - toe.from.y) * 0.35 },
      digestion: { x: back.at.x, y: back.at.y + (ground - back.at.y) * 0.3 },
      reproduction: { x: tail ? (tail.from.x + back.at.x) / 2 : back.at.x - 30, y: back.at.y + (ground - back.at.y) * 0.2 },
      // 冷热是整个身子的事（发抖、喘）：挂在背上方。
      thermal: { x: back.at.x, y: back.at.y - (ground - back.at.y) * 0.7 },
    };
    // 挤在一起的签错开：后一张往下挪，直到不和前面的重叠。
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    for (const [id, b] of signTags) {
      const q = { ...pos[id as Sign['id']] };
      const w = b.offsetWidth + 6;
      const h = b.offsetHeight + 4;
      for (let k = 0; k < 4; k++) {
        const hit = placed.find((o) => Math.abs(o.x - q.x) < (o.w + w) / 2 && Math.abs(o.y - q.y) < (o.h + h) / 2);
        if (!hit) break;
        q.y = hit.y + (hit.h + h) / 2;
      }
      placed.push({ x: q.x, y: q.y, w, h });
      b.style.left = `${Math.round(q.x)}px`;
      b.style.top = `${Math.round(q.y)}px`;
    }
  }

  /** 卡片扣上以后过了多久、扣在哪（画布坐标）。 */
  let snapT = Infinity;
  let snapPt: Pt = { x: 0, y: 0 };
  function drawSnap(): void {
    snapInk.clear();
    if (snapT < 0.6) {
      const t = snapT / 0.6;
      snapInk.circle(snapPt.x, snapPt.y, 14 + 56 * t).stroke({ color: BLUEPRINT, width: 2.5 * (1 - t) + 0.5, alpha: 0.85 * (1 - t) });
    }
    if (cardOver) {
      // 纸偶四角的裁切角：手指到了纸偶身上，墨色变深，松手就扣上。
      const b = puppet.view.getBounds();
      const on = onPuppet(cardOver, 30);
      const p = 10;
      const L = Math.min(22, b.width / 4, b.height / 4);
      const [x0, y0, x1, y1] = [b.x - p, b.y - p, b.x + b.width + p, b.y + b.height + p];
      for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]] as const)
        snapInk.moveTo(x + sx * L, y).lineTo(x, y).lineTo(x, y + sy * L);
      snapInk.stroke({ color: BLUEPRINT, width: on ? 2.5 : 1.5, alpha: on ? 0.95 : 0.4 });
    }
  }

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
    adv.append(el('label', {}, name, input, v));
    return sync;
  };
  const kgText = (kg: number): string => (kg < 1 ? `${Math.round(kg * 1000)} 克` : kg < 10 ? `${kg.toFixed(1)} 千克` : `${Math.round(kg)} 千克`);
  const times = (x: number): string => `×${x.toFixed(2)}`;
  // 毛长（第 3 步 b）：设计写了用设计的，不写用体表卡的点（短毛 0、厚绒毛 0.301）。
  const FUR_MIN = viabilityRules.shape.furMin.value;
  const FUR_MAX = viabilityRules.shape.furMax.value;
  const furNow = (): number => design.shape?.fur ?? partLibrary.get(design.parts.coat)?.fur ?? 0;
  const furText = (v: number): string => (v <= FUR_MIN + 0.05 ? '裸' : times(Math.pow(10, v)));

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

  // ---- 部件托盘（第 2 步 c）：每个部位一排卡片，点一下或拖到纸偶身上扣上。 ----
  const tabs: TrayTab[] = [];
  // 代码画的纸偶不认新的耳朵参数：没有切图零件时不放耳卡。
  if (cutKit)
    tabs.push({
      id: 'ear',
      name: '耳',
      items: morphLibrary
        .filter((m) => m.region === 'ear')
        .map((m) => ({
          key: m.id,
          name: m.name,
          blurb: m.blurb,
          icon: (c) => drawEarIcon(c, m.appearance, EAR_TIP_CAT),
          isOn: () => isMorph(design, m, EAR_TIP_CAT),
        })),
    });
  for (const slot of SHOWN_SLOTS)
    tabs.push({
      id: slot,
      name: SLOT_NAMES[slot],
      items: [...partLibrary.values()].filter((p) => p.slot === slot && p.id !== 'wings').map((p) => ({ key: p.id, name: p.name, blurb: p.blurb, isOn: () => design.parts[slot] === p.id })),
    });
  /** 扣上一张卡：形状卡把五个数整组写进设计（和默认一样的不写，设计的写法和以前一样）；部件卡换这个槽的部件。 */
  function applyCard(tab: TrayTab, item: TrayItem): void {
    if (tab.id === 'ear') {
      const a = appearanceFor(morphLibrary.find((x) => x.id === item.key)!, EAR_TIP_CAT);
      const d = { ...design };
      if (a) d.appearance = a;
      else delete d.appearance;
      design = d;
    } else {
      design.parts = { ...design.parts, [tab.id]: item.key } as Design['parts'];
      // 体表卡是毛长轴上的预设点：扣上去就是卡的毛长，之前拖出来的毛长清掉（腿长、尾长是相对部件的，换卡以后还在）。
      if (tab.id === 'coat' && design.shape?.fur !== undefined) {
        const { fur: _, ...rest } = design.shape;
        const d = { ...design };
        if (Object.keys(rest).length) d.shape = rest;
        else delete d.shape;
        design = d;
      }
    }
    rebuild();
  }
  /** 拖着卡片时手指在哪（画布坐标）。 */
  let cardOver: Pt | null = null;
  const toCanvas = (q: Pt): Pt => {
    const r = canvas.getBoundingClientRect();
    return { x: q.x - r.left, y: q.y - r.top };
  };
  const tray = new Tray(tabs, {
    drop(tab, item, at) {
      let pt: Pt;
      if (at) {
        pt = toCanvas(at);
        if (!onPuppet(pt, 30)) return;
      } else {
        const b = puppet.view.getBounds();
        pt = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      }
      applyCard(tab, item);
      snapT = 0;
      snapPt = pt;
    },
    drag(at) {
      cardOver = at ? toCanvas(at) : null;
    },
  });
  panel.append(tray.el);
  const modeBox = el('div', { className: 'sect' });
  panel.append(modeBox);
  // 滑块收进"高级"：卡片是形状，身上的把手是尺寸，这里是剩下的细节（body-params 第十节）。
  const adv = el('details', { id: 'adv' }, el('summary', {}, '高级：全部滑块'));
  panel.append(adv);

  adv.append(el('h3', {}, '身体'));
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
  syncs.push(slider('毛长', FUR_MIN, FUR_MAX, 0.01, furNow, (v) => ((design.shape = { ...design.shape, fur: v }), rebuild()), furText));

  // 外观：只影响画面（DECISIONS"外观参数"）。
  adv.append(el('h3', {}, '外观（只影响画面）'));
  const setLook = (k: 'earLen' | 'earWide' | 'earTip' | 'earStiff' | 'earPos', v: number): void => {
    design.appearance = { ...design.appearance, [k]: v };
    rebuild();
  };
  const ends = (lo: string, hi: string) => (v: number): string => (v < 0.05 ? lo : v > 0.95 ? hi : `${lo} → ${hi} ${Math.round(v * 100)}%`);
  syncs.push(slider('耳长', 0, 3, 0.05, () => design.appearance?.earLen ?? 1, (v) => setLook('earLen', v), (v) => (v <= EAR_ABSENT ? '没有（只剩耳孔）' : times(v))));
  syncs.push(slider('耳宽', 0.5, 2, 0.05, () => design.appearance?.earWide ?? 1, (v) => setLook('earWide', v), times));
  syncs.push(slider('耳尖', 0, 1, 0.01, () => design.appearance?.earTip ?? EAR_TIP_CAT, (v) => setLook('earTip', v), ends('圆', '尖')));
  syncs.push(slider('耳软硬', 0, 1, 0.01, () => design.appearance?.earStiff ?? 1, (v) => setLook('earStiff', v), ends('垂', '立')));
  syncs.push(slider('耳位置', 0, 1, 0.01, () => design.appearance?.earPos ?? 0, (v) => setLook('earPos', v), ends('头顶', '两侧')));

  adv.append(el('h3', {}, '体重分配（倍数，总量不变）'));
  for (const s of BODY_SYSTEMS) {
    syncs.push(
      slider(SYSTEM_NAMES[s], -1, 1, 0.05, () => Math.log2(design.allocation?.[s] ?? 1), (v) => {
        design.allocation = { ...design.allocation, [s]: Math.round(Math.pow(2, v) * 100) / 100 };
        rebuild();
      }, (v) => times(Math.pow(2, v))),
    );
  }

  modeBox.append(el('h3', {}, '它在干什么'));
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
  modeBox.append(modeRow);
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
  modeBox.append(el('label', {}, '速度', speedInput, speedV));
  // X 光（第 3 步 c）：看里面的骨头和肌肉，粗细按体重分配。
  const xrayBtn = el('button', { textContent: 'X 光：看骨头和肌肉' });
  xrayBtn.addEventListener('click', () => {
    xrayOn = !xrayOn;
    refreshControls();
  });
  if (puppet.skeleton) modeBox.append(el('div', { className: 'row' }, xrayBtn));
  // 冷热试验（第 3 步 b）：拖一下气温就开始试，只给设计台预览（EnvironmentProfile.climate），不进情景。
  const climateInput = el('input', { type: 'range', min: '-40', max: '45', step: '1', value: '20' });
  const climateV = el('span', { className: 'v' });
  const climateOff = el('button', { textContent: '不试', className: 'mini' });
  climateInput.addEventListener('input', () => {
    climateC = Number(climateInput.value);
    rebuild();
    refreshControls();
  });
  climateOff.addEventListener('click', () => {
    climateC = null;
    rebuild();
    refreshControls();
  });
  modeBox.append(el('label', { className: 'climate' }, '气温', climateInput, climateV, climateOff));

  function refreshControls(): void {
    for (const s of syncs) s();
    xrayBtn.classList.toggle('on', xrayOn);
    climateV.textContent = climateC === null ? '不试（拖一下开始）' : `${climateC} °C`;
    climateOff.hidden = climateC === null;
    if (climateC !== null) climateInput.value = String(climateC);
    tray.refresh();
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
    // 手机上只显示前两行（.more 收着，点读数展开）。
    readout.innerHTML = `${rows.slice(0, 2).join('<br>')}<span class="more"><br>${rows.slice(2).join('<br>')}</span>`;
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
    fur?: number;
    /** 冷热试验的气温（°C），null 不试。 */
    climate?: number | null;
    xray?: boolean;
    parts?: Partial<Design['parts']>;
    allocation?: Partial<Record<BodySystem, number>>;
    appearance?: Design['appearance'];
  }
  function set(p: DeskParams): void {
    if (p.template) loadTemplate(p.template);
    if (p.mass !== undefined) design.bodyMassKg = p.mass;
    if (p.leg !== undefined || p.tail !== undefined) design.shape = { ...design.shape, ...(p.leg !== undefined ? { leg: p.leg } : {}), ...(p.tail !== undefined ? { tail: p.tail } : {}) };
    if (p.parts) design.parts = { ...design.parts, ...p.parts } as Design['parts'];
    if (p.fur !== undefined) design.shape = { ...design.shape, fur: p.fur };
    if (p.climate !== undefined) climateC = p.climate;
    if (p.xray !== undefined) xrayOn = p.xray;
    if (p.allocation) design.allocation = { ...design.allocation, ...p.allocation };
    if (p.appearance) design.appearance = { ...design.appearance, ...p.appearance };
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
  /** 测试用：这一帧的把手（屏幕坐标）。 */
  const handles = (): typeof spots => spots;
  const signList = (): Sign[] => signs;
  (window as unknown as { desk: { set: typeof set; step: typeof step; handles: typeof handles; signs: typeof signList } }).desk = { set, step, handles, signs: signList };

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
