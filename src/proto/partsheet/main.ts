import { Application, Container, Graphics, Text } from 'pixi.js';
import { designTemplates, gaitRules, partLibrary, viabilityRules, type Design } from '../../data';
import { partsOf } from '../../sim';
import { speciesColor } from '../../render/palette';
import { bodyPlan, type BodyPlan } from '../../render/puppet/plan';
import { standPose } from '../../render/puppet/pose';
import { Puppet } from '../../render/puppet/puppet';
import { NEUTRAL, anchors, drawChest, drawEar, drawHead, drawHind, drawJaw, drawLegSegment, drawNeck, drawTailSegment, lookOf, partCtx, type Look, type PartCtx } from '../../render/puppet/parts';
import { drawBirdBill, drawBirdBody, drawBirdHead, drawBirdLeg, drawBirdNeck, drawBirdTail, drawFoldedWing, drawSpreadWing } from '../../render/puppet/birdParts';

/**
 * 零件参考图（handoff/007）：用代码画的纸偶零件排成一张 2048×2048 的表，给 Lovart 当参考。只在开发时用，不进 build。
 * 品红底；第一行是拼好的组合，下面每行一类零件，零件之间留 60 像素以上；同一张表里所有东西同一个比例。
 * 参数：?sheet=B0|B1|B2|B3|B4|B4P|B5|B5P|B6&labels=1（labels=1 在零件下面写名字、在转轴上画蓝圈，给人看；不带的版本发给 Lovart）。
 * 导出：scripts/art/part-refs.cjs。
 */

const SIZE = 2048;
const MARGIN = 60;
const GAP = 64;
const BLUE = 0x2f5d8a;
const q = new URLSearchParams(location.search);
const SHEET = q.get('sheet') ?? 'B1';
const LABELS = q.get('labels') === '1';

interface Item {
  view: Container;
  label: string;
  /** 零件自己的转轴（原点）要不要画蓝圈；组合图不画。 */
  pivot: boolean;
}
type Row = Item[];

const template = (id: string): Design => structuredClone(designTemplates.find((t) => t.species === id)!.design);
/** 标准身体：猫的模板，4 千克。 */
const base = (): Design => ({ ...template('cat'), bodyMassKg: 4 });
const planOf = (d: Design): BodyPlan => bodyPlan(d, partsOf(d, { parts: partLibrary }), d.parts.coat === 'feathers', viabilityRules, gaitRules);
const withParts = (d: Design, parts: Partial<Design['parts']>): Design => ({ ...d, parts: { ...d.parts, ...parts } as Design['parts'] });
const name = (id: string): string => partLibrary.get(id)?.name ?? id;

function part(draw: (g: Graphics) => void, label: string): Item {
  const view = new Container();
  const g = new Graphics();
  draw(g);
  view.addChild(g);
  return { view, label, pivot: true };
}

/** 拼好的整只（站姿）。 */
function puppet(d: Design, look: Look, label: string): Item {
  const plan = planOf(d);
  const p = new Puppet(plan, look);
  p.shadow.visible = false;
  p.apply(standPose(plan), 0);
  p.view.scale.set(1);
  // 不同体重的身体都按头体长 = 100 画，所以同一行里大小一样；真实大小差别写在名字里。
  return { view: p.view, label, pivot: false };
}

/** 只有头：头片 + 下颌 + 耳朵，拼在一起（口器那张的第一行）。 */
function headAssembly(c: PartCtx, label: string): Item {
  const a = anchors(c);
  const view = new Container();
  const add = (draw: (g: Graphics) => void, x = 0, y = 0): void => {
    const g = new Graphics();
    draw(g);
    g.position.set(x, y);
    view.addChild(g);
  };
  add((g) => drawEar(g, c, true), ...a.farEar);
  add((g) => drawJaw(g, c), ...a.jaw);
  add((g) => drawHead(g, c));
  add((g) => drawEar(g, c, false), ...a.nearEar);
  return { view, label, pivot: false };
}

function legParts(c: PartCtx, prefix: string): Item[] {
  const names = [
    ['上臂', '前臂', '前掌'],
    ['大腿', '小腿', '后掌'],
  ];
  const out: Item[] = [];
  for (const hind of [false, true]) for (const i of [0, 1, 2] as const) out.push(part((g) => drawLegSegment(g, c, hind, i), `${prefix}${names[hind ? 1 : 0]![i]}`));
  return out;
}

function tailParts(c: PartCtx, prefix: string): Item[] {
  return Array.from({ length: c.plan.tailSegs }, (_, i) => part((g) => drawTailSegment(g, c, i), `${prefix}${i + 1}`));
}

const COATS = [
  ['short_fur', '短毛'],
  ['dense_fur', '厚绒毛'],
  ['feathers', '羽毛'],
] as const;
const MOUTHS = ['carnassials', 'gnawing_incisors', 'grinding_molars', 'mixed_teeth', 'pointed_snout', 'seed_beak', 'probe_bill', 'hooked_beak', 'stout_bill'];
const LIMBS = ['walking_legs', 'running_legs', 'climbing_claws', 'digging_claws', 'short_legs'];
const TAILS = ['balance_tail', 'bushy_tail', 'short_tail', 'fat_tail'];

/** 拼好的鸟：站姿翅膀收起，或者展翅。 */
function birdAssembly(look: Look, spread: boolean, label: string): Item {
  const view = new Container();
  const at = (draw: (g: Graphics) => void, x: number, y: number, rot: number, parent: Container = view): Container => {
    const c = new Container();
    c.position.set(x, y);
    c.rotation = rot;
    const g = new Graphics();
    draw(g);
    c.addChild(g);
    parent.addChild(c);
    return c;
  };
  at((g) => drawBirdTail(g, look), -30, -8, Math.PI + 0.2);
  if (spread) {
    const inner = at((g) => drawSpreadWing(g, look, false), 18, -16, -2.1);
    at((g) => drawSpreadWing(g, look, true), 32, 4, 0.35, inner);
  }
  at((g) => drawBirdBody(g, look), 0, 0, 0);
  const neck = at((g) => drawBirdNeck(g, look), 28, -18, -1.1);
  const head = at((g) => drawBirdHead(g, look), 14, 0, 1.1, neck);
  at((g) => drawBirdBill(g, false), 17, 0, 0.05, head);
  at((g) => drawBirdBill(g, true), 17, -1, 0, head);
  if (!spread) at((g) => drawFoldedWing(g, look), 22, -12, 0);
  const thigh = at((g) => drawBirdLeg(g, look, 0), 0, 4, 1.2);
  const shank = at((g) => drawBirdLeg(g, look, 1), 14, 0, 0.7, thigh);
  const tarsus = at((g) => drawBirdLeg(g, look, 2), 20, 0, -0.55, shank);
  at((g) => drawBirdLeg(g, look, 3), 19, 0, -1.35, tarsus);
  return { view, label, pivot: false };
}

function sheet(id: string): Row[] {
  const d = base();
  const c = partCtx(planOf(d), NEUTRAL);
  switch (id) {
    case 'B1':
      return [
        [puppet(d, NEUTRAL, '拼好的兽（短毛、裂齿、攀爬钩爪、长平衡尾）')],
        [part((g) => drawHead(g, c), '头（带上吻）'), part((g) => drawJaw(g, c), '下颌'), part((g) => drawEar(g, c, false), '耳'), part((g) => drawNeck(g, c), '颈')],
        [part((g) => drawChest(g, c), '胸片'), part((g) => drawHind(g, c), '臀片（带肚子）')],
      ];
    case 'B2': {
      const rows: Row[] = [COATS.map(([coat, n]) => puppet(withParts(d, { coat }), NEUTRAL, n))];
      for (const [coat, n] of COATS.slice(1)) {
        const cc = partCtx(planOf(withParts(d, { coat })), NEUTRAL);
        rows.push([part((g) => drawHead(g, cc), `${n}·头`), part((g) => drawNeck(g, cc), `${n}·颈`), part((g) => drawChest(g, cc), `${n}·胸片`), part((g) => drawHind(g, cc), `${n}·臀片`)]);
      }
      return rows;
    }
    case 'B3': {
      const ctxs = MOUTHS.map((m) => partCtx(planOf(withParts(d, { mouth: m })), NEUTRAL));
      return [ctxs.map((cc, i) => headAssembly(cc, name(MOUTHS[i]!))), ctxs.map((cc, i) => part((g) => drawHead(g, cc), `${name(MOUTHS[i]!)}·头`)), ctxs.map((cc, i) => part((g) => drawJaw(g, cc), `${name(MOUTHS[i]!)}·下`))];
    }
    // 腿和尾的零件很小，和整只放在一张表里会缩得看不清：组合一张（B4、B5），零件一张（B4P、B5P）。
    case 'B4':
      return [LIMBS.map((l) => puppet(withParts(d, { limbs: l }), NEUTRAL, name(l)))];
    case 'B4P':
      return LIMBS.map((l) => legParts(partCtx(planOf(withParts(d, { limbs: l })), NEUTRAL), `${name(l)}·`));
    case 'B5':
      return [TAILS.map((t) => puppet(withParts(d, { tail: t }), NEUTRAL, name(t)))];
    case 'B5P': {
      const rows: Row[] = [];
      for (const t of TAILS) {
        const row: Item[] = [];
        // 蓬松大尾本来就是毛边；其余三种尾，三种体表各一套。
        for (const [coat, n] of t === 'bushy_tail' ? COATS.slice(1, 2) : COATS) row.push(...tailParts(partCtx(planOf(withParts(d, { tail: t, coat })), NEUTRAL), `${name(t)}·${n}·`));
        rows.push(row);
      }
      return rows;
    }
    case 'B6': {
      const look = NEUTRAL;
      return [
        [birdAssembly(look, false, '拼好的鸟（站姿）'), birdAssembly(look, true, '展翅')],
        [part((g) => drawBirdBody(g, look), '身体'), part((g) => drawBirdNeck(g, look), '颈'), part((g) => drawBirdHead(g, look), '头'), part((g) => drawBirdBill(g, true), '上喙'), part((g) => drawBirdBill(g, false), '下喙'), part((g) => drawBirdTail(g, look), '尾羽')],
        [part((g) => drawBirdLeg(g, look, 0), '大腿'), part((g) => drawBirdLeg(g, look, 1), '胫'), part((g) => drawBirdLeg(g, look, 2), '跗跖'), part((g) => drawBirdLeg(g, look, 3), '脚')],
        [part((g) => drawFoldedWing(g, look), '收起的翅膀'), part((g) => drawSpreadWing(g, look, false), '展开·内侧'), part((g) => drawSpreadWing(g, look, true), '展开·外侧（飞羽）')],
      ];
    }
    default: {
      // B0：代码上色以后的样子（只当参考，不切）。
      const tiger = { ...template('cat'), bodyMassKg: 200 };
      const odd = withParts({ ...template('fox'), shape: { leg: 0.2 } }, { mouth: 'hooked_beak', limbs: 'digging_claws', tail: 'bushy_tail', coat: 'dense_fur' });
      return [
        [puppet(template('cat'), lookOf(speciesColor('cat').body), '野猫 3.3 千克'), puppet(template('rabbit'), lookOf(speciesColor('rabbit').body), '穴兔 1.6 千克'), puppet(template('brownrat'), lookOf(speciesColor('brownrat').body), '褐家鼠 0.3 千克')],
        [puppet(tiger, lookOf(speciesColor('cat').body), '放大到 200 千克的猫'), puppet(odd, lookOf(0x6f8f72), '钩喙 + 掘土爪 + 蓬松大尾'), birdAssembly(lookOf(speciesColor('dotterel').body), false, '双斑鸻（鸟的骨架）')],
      ];
    }
  }
}

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ width: SIZE, height: SIZE, background: 0xff00ff, antialias: true, resolution: 1, preserveDrawingBuffer: true });
  document.body.appendChild(app.canvas);
  const rows = sheet(SHEET);
  const labelH = LABELS ? 34 : 0;
  const bounds = rows.map((r) => r.map((it) => it.view.getLocalBounds()));
  const labels = rows.map((r) => r.map((it) => (LABELS ? new Text({ text: it.label, style: { fontFamily: 'system-ui, sans-serif', fontSize: 22, fill: BLUE } }) : null)));
  // 同一张表一个比例。每一组（组合、某类零件）另起一行，一行放不下就折到下一行；
  // 比例取放得下的最大值（二分），这样零件不会因为某一行特别长而缩得很小。
  type Line = { idx: [number, number][]; w: number; h: number };
  const layout = (scale: number): Line[] => {
    const lines: Line[] = [];
    rows.forEach((row, ri) => {
      let line: Line = { idx: [], w: 0, h: 0 };
      row.forEach((_, i) => {
        const bb = bounds[ri]![i]!;
        const w = Math.max(bb.width * scale, labels[ri]![i]?.width ?? 0);
        if (line.idx.length && line.w + GAP + w > SIZE - 2 * MARGIN) {
          lines.push(line);
          line = { idx: [], w: 0, h: 0 };
        }
        line.w += (line.idx.length ? GAP : 0) + w;
        line.h = Math.max(line.h, bb.height * scale);
        line.idx.push([ri, i]);
      });
      lines.push(line);
    });
    return lines;
  };
  const fits = (scale: number): boolean => {
    const lines = layout(scale);
    const h = lines.reduce((s, l) => s + l.h + labelH, 0) + GAP * (lines.length - 1);
    return h <= SIZE - 2 * MARGIN && lines.every((l) => l.w <= SIZE - 2 * MARGIN);
  };
  let lo = 0.1;
  let hi = 40;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid;
    else hi = mid;
  }
  const scale = lo;
  const lines = layout(scale);
  const usedH = lines.reduce((s, l) => s + l.h + labelH, 0) + GAP * (lines.length - 1);
  let y = (SIZE - usedH) / 2;
  for (const line of lines) {
    let x = (SIZE - line.w) / 2;
    for (const [ri, i] of line.idx) {
      const it = rows[ri]![i]!;
      const bb = bounds[ri]![i]!;
      const t = labels[ri]![i];
      const slotW = Math.max(bb.width * scale, t?.width ?? 0);
      const ix = x + (slotW - bb.width * scale) / 2;
      const holder = new Container();
      holder.addChild(it.view);
      holder.scale.set(scale);
      // 底对齐：一行里的东西站在同一条线上。
      holder.position.set(ix - bb.x * scale, y + line.h - (bb.y + bb.height) * scale);
      app.stage.addChild(holder);
      if (t) {
        if (it.pivot) {
          const ring = new Graphics().circle(0, 0, 9).stroke({ color: BLUE, width: 3 });
          ring.position.set(holder.x, holder.y);
          app.stage.addChild(ring);
        }
        t.position.set(x + (slotW - t.width) / 2, y + line.h + 6);
        app.stage.addChild(t);
      }
      x += slotW + GAP;
    }
    y += line.h + GAP + labelH;
  }
  app.render();
  document.body.dataset.ready = '1';
}

void main();
