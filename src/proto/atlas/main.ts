import { Application, Assets, Container, Graphics, Text, type Texture } from 'pixi.js';
import 'lxgw-wenkai-screen-webfont/style.css';
import { designTemplates, gaitRules, hintTemplates, partLibrary, plantLibrary, scalingLaws, viabilityRules, type Design } from '../../data';
import { compileDesign, makeDesignKit, partsOf } from '../../sim';
import type { CutData } from '../../render/puppet/cutout';
import { CutoutPuppet } from '../../render/puppet/cutoutPuppet';
import { COATS, coatFor } from '../../render/puppet/coats';
import { bodyPlan, type BodyPlan } from '../../render/puppet/plan';
import { standPose } from '../../render/puppet/pose';

/**
 * 纸偶图集（给 Lovart 做设计加工用，2026-11-27）：
 * - ?sheet=gallery：各种各样拼好的纸偶（现有技术 + 用形状参数拼的动物）；
 * - ?sheet=<部位>：一个部位一张，同一个部位按参数取几档，每档上面是拼好的样子、下面是炸开的零件（看每片零件的形状怎么随参数变）。
 * 部位：neck、snout、horn、body、leg、ear、tail。
 * 每只纸偶按自己的大小缩放到格子里（体重写在名字里）。
 */
const q = new URLSearchParams(location.search);
const SHEET = q.get('sheet') ?? 'gallery';
const CUT_DATA = import.meta.glob<unknown>('../../../art/incoming/lovart/paper/cuts/*/vector.json', { import: 'default' });
const CUT_PAPER = import.meta.glob<string>('../../../art/incoming/lovart/paper/cuts/*/paper.png', { query: '?url', import: 'default' });
const kit = makeDesignKit(partLibrary, scalingLaws, hintTemplates, viabilityRules, [...plantLibrary.values()], designTemplates.map((t) => t.design));
const template = (id: string): Design => structuredClone(designTemplates.find((t) => t.species === id)!.design);
const planOf = (d: Design): BodyPlan => bodyPlan(d, partsOf(d, kit), compileDesign(d, kit).bird, viabilityRules, gaitRules);

interface Cell {
  label: string;
  design: Design;
  coat?: string;
  /** 现有技术的 id（用它的毛色）。 */
  tid?: string;
}
const cat = (mass: number, form: Record<string, number>, extra: Partial<Design> = {}): Design => ({ ...template('cat'), bodyMassKg: mass, form, ...extra });
const ROWS: Record<string, Cell[]> = {
  gallery: [
    { label: '家猫 4 千克（基准）', design: template('cat'), tid: 'cat' },
    { label: '穴兔', design: template('rabbit'), tid: 'rabbit' },
    { label: '褐家鼠', design: template('brownrat'), tid: 'brownrat' },
    { label: '赤狐', design: template('fox'), tid: 'fox' },
    { label: '白鼬', design: template('stoat'), tid: 'stoat' },
    { label: '长颈（800 千克）', coat: 'sand', design: cat(800, { 'neck.length': 2.2, 'neck.raise': 1, 'leg.distal': 1, 'leg.stance': 1, 'horn.count': 2, 'horn.length': -1.2, 'horn.curve': 0, 'head.size': 0.3, 'body.length': -0.2 }, { shape: { leg: 0.2 } }) },
    { label: '鼻角（2000 千克）', coat: 'slate', design: cat(2000, { 'horn.count': 2, 'horn.pos': 1, 'horn.length': 0.4, 'horn.curve': 0.15, 'neck.length': -1, 'body.length': -0.4, 'head.size': 0.4, 'leg.stance': 0.2 }) },
    { label: '卷角（80 千克）', coat: 'snow', design: cat(80, { 'horn.count': 2, 'horn.curve': 0.85, 'horn.length': 1.2, 'leg.stance': 1, 'leg.distal': 0.6 }) },
    { label: '鹿形（100 千克）', coat: 'ochre', design: cat(100, { 'leg.distal': 1, 'leg.stance': 1, 'neck.length': 0.6, 'neck.raise': 0.5, 'horn.count': 2, 'horn.length': 0.5, 'horn.curve': 0.3 }, { shape: { leg: 0.12 } }) },
    { label: '长吻（30 千克）', coat: 'charcoal', design: cat(30, { 'snout.length': 2, 'snout.depth': -0.6, 'head.size': -0.2 }) },
    { label: '长身（0.2 千克）', coat: 'ochre', design: cat(0.2, { 'body.length': 1.1 }, { shape: { leg: -0.15 } }) },
    { label: '驼形（500 千克）', coat: 'sand', design: cat(500, { 'neck.length': 1.3, 'neck.raise': 0.7, 'leg.distal': 0.5, 'leg.stance': 0.3 }, { shape: { leg: 0.15 } }) },
    { label: '熊形（300 千克）', coat: 'charcoal', design: cat(300, { 'leg.stance': 0, 'snout.depth': 0.5, 'snout.tip': 0, 'head.size': 0.3, 'body.length': -0.3 }, { shape: { leg: -0.1 } }) },
    { label: '大耳（1 千克）', coat: 'sand', design: { ...cat(1, {}), appearance: { earLen: 2.6, earWide: 1.8, earTip: 0.4 } } },
    { label: '垂耳（3 千克）', coat: 'snow', design: { ...cat(3, { 'snout.length': -0.6 }), appearance: { earLen: 1.8, earStiff: 0, earTip: 0.1 } } },
  ],
  neck: [-2, -1, 0, 1, 1.6, 2.2].map((v) => ({ label: `颈长 ${v}`, design: cat(200, { 'neck.length': v, 'neck.raise': v > 1 ? 0.8 : 0.2 }) })),
  snout: [
    ...[-1.5, -0.5, 0, 1, 2].map((v) => ({ label: `吻长 ${v}`, design: cat(10, { 'snout.length': v }) })),
    { label: '吻粗 0.7、钝', design: cat(10, { 'snout.depth': 0.7, 'snout.tip': 0 }) },
    { label: '吻细 −0.7、尖', design: cat(10, { 'snout.depth': -0.7, 'snout.tip': 1 }) },
  ],
  horn: [
    { label: '额角 短直', design: cat(100, { 'horn.count': 2, 'horn.length': -0.8, 'horn.curve': 0 }) },
    { label: '额角 弯', design: cat(100, { 'horn.count': 2, 'horn.length': 0.4, 'horn.curve': 0.35 }) },
    { label: '额角 卷', design: cat(100, { 'horn.count': 2, 'horn.length': 1.2, 'horn.curve': 0.85 }) },
    { label: '四只角', design: cat(100, { 'horn.count': 4, 'horn.length': 0, 'horn.curve': 0.2 }) },
    { label: '鼻角 一只', design: cat(1000, { 'horn.count': 1, 'horn.pos': 1, 'horn.length': 0.3, 'horn.curve': 0.1 }) },
    { label: '鼻角 两只', design: cat(1000, { 'horn.count': 2, 'horn.pos': 1, 'horn.length': 0.4, 'horn.curve': 0.15 }) },
  ],
  body: [-0.7, -0.35, 0, 0.5, 1, 1.2].map((v) => ({ label: `躯干长短 ${v}`, design: cat(5, { 'body.length': v }) })).concat([
    { label: '胸深 −0.5', design: cat(5, { 'body.depth': -0.5 }) },
    { label: '胸深 0.6', design: cat(5, { 'body.depth': 0.6 }) },
  ]),
  leg: [
    { label: '跖行', design: cat(50, { 'leg.stance': 0 }) },
    { label: '趾行', design: cat(50, { 'leg.stance': 0.5 }) },
    { label: '蹄行', design: cat(50, { 'leg.stance': 1 }) },
    { label: '远端 −0.8', design: cat(50, { 'leg.distal': -0.8 }) },
    { label: '远端 1.2 + 蹄行', design: cat(50, { 'leg.distal': 1.2, 'leg.stance': 1 }) },
    { label: '腿短', design: cat(50, {}, { shape: { leg: -0.2 } }) },
    { label: '腿长', design: cat(50, {}, { shape: { leg: 0.2 } }) },
  ],
  ear: [
    { label: '没有耳廓', design: { ...cat(4, {}), appearance: { earLen: 0 } } },
    { label: '小圆耳', design: { ...cat(4, {}), appearance: { earLen: 0.5, earTip: 0 } } },
    { label: '一般', design: cat(4, {}) },
    { label: '长尖耳', design: { ...cat(4, {}), appearance: { earLen: 2.2, earTip: 1 } } },
    { label: '大宽耳', design: { ...cat(4, {}), appearance: { earLen: 2.5, earWide: 2 } } },
    { label: '半垂', design: { ...cat(4, {}), appearance: { earLen: 1.6, earStiff: 0.45 } } },
    { label: '垂耳', design: { ...cat(4, {}), appearance: { earLen: 1.8, earStiff: 0 } } },
    { label: '耳在两侧', design: { ...cat(4, {}), appearance: { earPos: 1 } } },
  ],
  tail: [-0.3, -0.15, 0, 0.15, 0.3].map((v) => ({ label: `尾长 ${v}`, design: cat(4, {}, { shape: { tail: v } }) })),
};

async function main(): Promise<void> {
  await document.fonts.load('20px "LXGW WenKai Screen"');
  const dir = '../../../art/incoming/lovart/paper/cuts/P11-cat';
  const data = (await CUT_DATA[`${dir}/vector.json`]!()) as CutData;
  const paper = (await Assets.load(await CUT_PAPER[`${dir}/paper.png`]!())) as Texture;
  paper.source.addressMode = 'repeat';
  const refDesign = template(data.rig.template);
  const ref = planOf(refDesign);
  const cells = ROWS[SHEET] ?? ROWS.gallery!;
  const exploded = SHEET !== 'gallery';
  const cols = exploded ? Math.min(4, cells.length) : 5;
  const cw = 420;
  const ch = exploded ? 640 : 360;
  const rows = Math.ceil(cells.length / cols);
  const app = new Application();
  await app.init({ width: cols * cw, height: rows * ch + 70, background: 0xefe5cf, antialias: true, resolution: 2, autoDensity: true });
  document.body.append(app.canvas);
  const title = new Text({ text: `纸偶图集 · ${SHEET}`, style: { fontFamily: 'LXGW WenKai Screen', fontSize: 26, fill: 0x4a3527 } });
  title.position.set(20, 16);
  app.stage.addChild(title);
  cells.forEach((cell, i) => {
    const plan = planOf(cell.design);
    const coat = cell.coat ? COATS.find((c) => c.id === cell.coat)! : coatFor(cell.tid ?? 'cat');
    const x0 = (i % cols) * cw;
    const y0 = 70 + Math.floor(i / cols) * ch;
    const make = (explode: boolean): Container => {
      const p = new CutoutPuppet(data, paper, coat, ref, plan);
      p.apply(standPose(plan), 0);
      // 缩放到格子里：按纸偶的外框。
      const b = p.view.getLocalBounds();
      const box = new Container();
      box.addChild(p.view);
      if (explode) {
        // 炸开：每片零件从整只的中心往外挪，挪的距离和它离中心的距离成比例；零件的形状、转角不变。
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        for (const st of p.cutout.pieceStates()) {
          if (!st.visible) continue;
          p.cutout.place(st.id, st.x + (st.x - cx) * 0.8, st.y + (st.y - cy) * 0.8, st.rotation, st.sy);
        }
      }
      const b2 = p.view.getLocalBounds();
      const k = Math.min((cw - 50) / b2.width, (exploded ? 270 : 280) / b2.height);
      p.view.scale.set(k);
      p.view.position.set(-(b2.x + b2.width / 2) * k, -(b2.y + b2.height) * k);
      return box;
    };
    const a = make(false);
    a.position.set(x0 + cw / 2, y0 + (exploded ? 290 : 300));
    app.stage.addChild(a);
    if (exploded) {
      const e = make(true);
      e.position.set(x0 + cw / 2, y0 + 590);
      app.stage.addChild(e);
    }
    const t = new Text({ text: cell.label, style: { fontFamily: 'LXGW WenKai Screen', fontSize: 20, fill: 0x4a3527 } });
    t.anchor.set(0.5, 0);
    t.position.set(x0 + cw / 2, y0 + 4);
    app.stage.addChild(t);
    const line = new Graphics().rect(x0 + 10, y0 + ch - 6, cw - 20, 1).fill({ color: 0x4a3527, alpha: 0.15 });
    app.stage.addChild(line);
  });
  (window as unknown as { atlasReady: boolean }).atlasReady = true;
}
void main();
