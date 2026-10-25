import { Application, Assets, Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import { Cutout, type CutData, type Dye } from '../../render/puppet/cutout';

/**
 * 试验页：AI 成品图切出来的矢量纸偶（handoff/007 的新路线）。只在开发时用，不进 build。
 * 一张 2048×2048 的对比图，六格：原图 | 白模重建 | 炸开 | 三个试验动作（看关节转起来会不会露缝）。
 * 参数：?cut=P11-cat
 */

const SIZE = 2048;
const CUT = new URLSearchParams(location.search).get('cut') ?? 'P11-cat';
const DIR = `/art/incoming/lovart/paper/cuts/${CUT}`;

/** 白模：三档色区同一种中性纸色（花纹以后再说）。 */
const WHITE: Dye = { main: 0xe6d8bd, stripe: 0xe6d8bd, pale: 0xe6d8bd };

/** 试验动作（每片零件相对成品图多转的角度，弧度，正 = 顺时针）。 */
const POSES: Record<string, Record<string, number>> = {
  // 走：近侧后腿往前、前腿往后，远侧反过来；腕、踝跟着弯。
  walk: {
    thigh: 0.35, shank: -0.45, hindPaw: 0.25, farThigh: -0.3, farShank: 0.35, farHindPaw: -0.2,
    upperArm: -0.35, forearm: 0.45, forePaw: -0.3, farUpperArm: 0.3, farForearm: -0.3, farForePaw: 0.25,
    tail1: 0.1, tail2: 0.15, tail3: 0.15, tail4: 0.15, tail5: 0.15,
  },
  // 低头吃：胸片往前压、头低下、嘴张开、耳朵往后。
  eat: {
    chest: 0.12, head: 0.55, jaw: 0.35, nearEar: -0.35, farEar: -0.3,
    upperArm: -0.12, forearm: 0.0, forePaw: 0.12, farUpperArm: -0.12, farForePaw: 0.12,
    tail1: -0.2, tail2: -0.15, tail3: -0.1,
  },
  // 伸展：前腿往前伸、后腿往后蹬、尾巴翘起、抬头。
  stretch: {
    upperArm: -0.6, forearm: -0.15, forePaw: 0.35, farUpperArm: -0.5, farForearm: -0.15, farForePaw: 0.3,
    thigh: -0.45, shank: -0.2, hindPaw: 0.5, farThigh: -0.4, farShank: -0.2, farHindPaw: 0.45,
    tail1: 0.6, tail2: 0.3, tail3: 0.25, tail4: 0.2, tail5: 0.2, head: -0.25, jaw: 0.1,
  },
};

async function main(): Promise<void> {
  const app = new Application();
  await app.init({ width: SIZE, height: SIZE, background: 0x111111, antialias: true, resolution: 1, preserveDrawingBuffer: true });
  document.body.appendChild(app.canvas);
  const data = (await (await fetch(`${DIR}/vector.json`)).json()) as CutData;
  const manifest = (await (await fetch(`${DIR}/manifest.json`)).json()) as { parts: Record<string, { offset: [number, number] }> };
  const paper = (await Assets.load(`${DIR}/paper.png`)) as Texture;
  paper.source.addressMode = 'repeat';
  const source = (await Assets.load(`/art/incoming/lovart/paper/raw/${data.source}`)) as Texture;
  const explode = Object.fromEntries(Object.entries(manifest.parts).map(([k, v]) => [k, v.offset]));

  const PW = SIZE / 2;
  const PH = SIZE / 3;
    const posed = (pose: Record<string, number>) => (): Container => {
    const c = new Cutout(data, paper, WHITE);
    c.pose(pose);
    return c.view;
  };
  const panels: [string, () => Container][] = [
    ['原图（AI 成品）', () => new Sprite(source)],
    ['白模重建（23 片，铆钉按关节重新定位）', () => new Cutout(data, paper, WHITE).view],
    ['炸开（角度不变，补全了被盖住的部分）', () => {
      const c = new Cutout(data, paper, WHITE);
      c.pose({}, explode);
      return c.view;
    }],
    ['动作：走', posed(POSES.walk!)],
    ['动作：低头吃（张嘴）', posed(POSES.eat!)],
    ['动作：伸展（尾巴翘起）', posed(POSES.stretch!)],
  ];
  // 原图和重建用同一个比例、同一个位置，方便逐像素对比。
  const fitTo = (w: number, h: number): number => Math.min((PW - 40) / w, (PH - 70) / h);
  const base = fitTo(data.size[0], 640);
  panels.forEach(([title, make], i) => {
    const px = (i % 2) * PW;
    const py = Math.floor(i / 2) * PH;
    const view = make();
    const holder = new Container();
    holder.addChild(view);
    app.stage.addChild(holder);
    if (i === 2) {
      const b = view.getLocalBounds();
      const s = fitTo(b.width, b.height);
      holder.scale.set(s);
      holder.position.set(px + (PW - b.width * s) / 2 - b.x * s, py + 50 + (PH - 60 - b.height * s) / 2 - b.y * s);
    } else {
      // 成品图里猫大约在 y 160–800 之间。
      holder.scale.set(base);
      holder.position.set(px + (PW - data.size[0] * base) / 2, py + 50 - 160 * base);
    }
    const mask = new Graphics().rect(px, py, PW, PH).fill(0xffffff);
    app.stage.addChild(mask);
    holder.mask = mask;
    const t = new Text({ text: title, style: { fontFamily: 'system-ui, sans-serif', fontSize: 26, fill: 0xeeeeee } });
    t.position.set(px + 24, py + 14);
    app.stage.addChild(t);
  });
  const grid = new Graphics();
  for (let i = 1; i < 3; i++) grid.moveTo(0, PH * i).lineTo(SIZE, PH * i);
  grid.moveTo(PW, 0).lineTo(PW, SIZE).stroke({ width: 2, color: 0x444444 });
  app.stage.addChild(grid);
  app.render();
  document.body.dataset.ready = '1';
}

void main();
