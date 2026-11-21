import { Assets, BlurFilter, Container, Graphics, Sprite, Text, Texture, type Application, type FederatedPointerEvent } from 'pixi.js';
import type { GaitRules } from '../../data/schema/gait';
import { HAND } from '../font';
import { PuppetActor, type RigKit } from '../puppet/actor';
import { makeAnimal, puppetKindOf } from '../paper/animals';
import type { Sheet } from '../paper/assets';
import type { RigSpec } from '../paper/liveLayer';

/**
 * 纸剧场（2026-11-21，handoff/009）：现场的近景。地图上点一处，镜头落下去，是一座摆在工作台上的手工纸剧场——
 * 台口里一层层立着剪纸的天、海、远山、灌丛、地面和前景的草，那一带的动物在台上走（设计的动物是会动的纸偶）。
 *
 * 做法是"多层摄影机"：每一层纸放在一个深度上，镜头随鼠标（和一点点自己的呼吸）微微移动，层与层就错开，看得出纵深；
 * 远处的层模糊一点，每一层在后面那层上投一点影子；台口外是夜里的工作室，一盏灯。
 * 天光跟着一天的时间走（时间走得快的时候固定在傍晚），四季圆盘的指针跟着一年走，手摇把可以摇——摇得越快时间走得越快。
 *
 * 素材是 Lovart 出的素材表切开的（public/theatre/，scripts/art/cut_theatre.py）。只是画面：不读也不改推演，
 * 要演什么（这一带有哪些动物、各多少只、窝里有几只、草有多高）由外面每帧给（TheatreCast）。
 */

/** 这一带现在有什么（外面按推演的状态算好给进来）。 */
export interface TheatreCast {
  /** 地方的名字（台座的铜牌上写）。 */
  place: string;
  species: { id: string; name: string; count: number; massKg: number; bodyLenM: number }[];
  /** 洞里窝着的幼崽（事务所设计的那一种），只数。 */
  kits: number;
  /** 这一带的草有多高（0–1，占上限的比例）。 */
  grass: number;
  /** 一年里的第几天（0–359）、一天里的第几个小时（0–23）。 */
  dayOfYear: number;
  hour: number;
  /** 时间在走吗、走多快（倍速）。 */
  speed: number;
}

export interface TheatreHooks {
  /** 摇手摇把：想要的倍速（停手时给 null，回到原来的倍速）。 */
  crank(speed: number | null): void;
  /** 回到地图。 */
  close(): void;
}

const NAMES = [
  'frame', 'valance', 'base', 'wheel', 'crank', 'pointer',
  'sky-day', 'sky-dusk', 'sky-night', 'cloud-1', 'cloud-2', 'cloud-3', 'cloud-4', 'sun', 'moon',
  'sea-1', 'sea-2', 'sea-3', 'sea-4', 'hills', 'islet', 'rock-1', 'rock-2', 'rock-3',
  'ground', 'ground-burrow', 'leaves-2', 'leaf-3',
  'bush-1', 'bush-2', 'bush-3', 'bush-4', 'bush-5',
  'grass-long-1', 'grass-long-2', 'grass-long-3', 'grass-mid-1', 'grass-mid-2', 'grass-gold-1', 'grass-gold-2', 'grass-gold-3', 'grass-bitten',
] as const;
type Name = (typeof NAMES)[number];

/** 台口框贴图里开口的位置（像素，见 frame.webp）。整个剧场的坐标就用框贴图的像素。 */
const OPEN = { x: 92, y: 53, w: 1256, h: 534 };
/** 一米在台上是多少（台口开口高 534 ≈ 1.8 米）。 */
const PX_PER_M = 520;
/** 动物站的两条"线"：后面一条、前面一条（脚底的 y）和远近的缩放。 */
const LANES = [
  { y: 448, k: 0.82, depth: 0.32 },
  { y: 478, k: 1, depth: 0.27 },
];
/** 一种动物在台上最多几只。 */
const CAST_CAP = { mine: 6, other: 4 };
/** 摇一圈让时间走多少天。 */
const DAYS_PER_TURN = 30;

interface Layer {
  view: Container;
  /** 深度：0 是台口那一层，1 是最远的天；负的在台口前面。 */
  depth: number;
  /** 摆放的基准位置（不算镜头）。 */
  x: number;
  y: number;
}

interface Actor {
  id: string;
  box: Container;
  inner: Container;
  rig: PuppetActor | null;
  lane: number;
  x: number;
  tx: number;
  v: number;
  face: number;
  doing: 'stand' | 'eat' | 'lie' | 'go';
  timer: number;
  /** 正在退场（淡掉）。 */
  leaving: number | null;
  /** 刚上场（淡入）。 */
  age: number;
  /** 身长（台上的像素）和走路的速度（台上的像素/秒）。 */
  len: number;
  speed: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const ease = (from: number, to: number, dt: number, tau: number): number => from + (to - from) * (1 - Math.exp(-dt / tau));
const mixColor = (a: number, b: number, t: number): number => {
  const c = (s: number): number => Math.round(lerp((a >> s) & 255, (b >> s) & 255, t));
  return (c(16) << 16) | (c(8) << 8) | c(0);
};

export class PaperTheatre {
  readonly root = new Container();
  /** 台口里的东西（被开口裁掉）。 */
  private readonly inside = new Container();
  private readonly tex = new Map<Name, Texture>();
  private readonly layers: Layer[] = [];
  private readonly actors: Actor[] = [];
  private readonly actorLayer = new Container();
  private readonly kitLayer = new Container();
  private kitActors: Container[] = [];
  private skies: Sprite[] = [];
  private sun!: Sprite;
  private moon!: Sprite;
  private starGlow!: Graphics;
  private clouds: { s: Sprite; x: number; y: number; v: number }[] = [];
  private seas: { c: Container; base: number; phase: number; amp: number }[] = [];
  private sway: { s: Sprite; phase: number; amp: number }[] = [];
  /** 草：长的、啃短的，按草的高度换着显示。 */
  private grassLong: Sprite[] = [];
  private grassShort: Sprite[] = [];
  private tinted: Container[] = [];
  private wheel!: Sprite;
  private crank!: Container;
  private crankAngle = 0;
  private crankGrab: { last: number; t: number; omega: number } | null = null;
  private plaque!: Text;
  private plaqueKey = '';
  private cam = { x: 0, y: 0, tx: 0, ty: 0 };
  /** 这一次打开了多久（秒）。 */
  private openedFor = 0;
  private time = 0;
  private hour = 17;
  private open = false;
  private fade = 0;
  private cast: TheatreCast | null = null;
  private rnd = 12345;
  private readonly spare = new Map<string, PuppetActor[]>();
  private ready = false;
  /** 外面那一圈：夜里的工作室和灯。 */
  private readonly room = new Container();

  constructor(
    private readonly app: Application,
    private readonly hooks: TheatreHooks,
    private readonly rules: GaitRules,
    private readonly P7: Sheet | null,
  ) {
    this.root.visible = false;
    this.root.eventMode = 'static';
    // 整个屏幕都接事件（台口外面的暗处也挡住地图）。
    this.root.hitArea = app.screen;
    app.stage.addChild(this.root);
  }

  private random(): number {
    this.rnd = (Math.imul(this.rnd, 1103515245) + 12345) >>> 0;
    return this.rnd / 0x1_0000_0000;
  }

  get isOpen(): boolean {
    return this.open;
  }

  private kit: RigKit | null = null;
  private rigs = new Map<string, RigSpec>();

  setKit(kit: RigKit): void {
    this.kit = kit;
  }

  setRig(id: string, spec: RigSpec): void {
    this.rigs.set(id, spec);
  }

  /** 开局以后在后台先载好素材、搭好布景（第一次打开就不用等）。 */
  preload(): void {
    void this.load();
  }

  private loading: Promise<void> | null = null;

  /** 第一次打开时才载入素材、搭布景。 */
  private load(): Promise<void> {
    this.loading ??= this.loadOnce();
    return this.loading;
  }

  private async loadOnce(): Promise<void> {
    if (this.ready) return;
    const base = `${import.meta.env.BASE_URL}theatre/`;
    const all = await Promise.all(NAMES.map((n) => Assets.load<Texture>(`${base}${n}.webp`)));
    NAMES.forEach((n, i) => this.tex.set(n, all[i]!));
    this.build();
    this.ready = true;
  }

  private t(n: Name): Texture {
    return this.tex.get(n)!;
  }

  /** 一张纸：锚在底边中点。shadow：在后面那层上投的影子（偏右下）。 */
  private paper(n: Name, x: number, y: number, k: number, shadow = 0, flip = false): Container {
    const c = new Container();
    if (shadow > 0) {
      const sh = new Sprite(this.t(n));
      sh.anchor.set(0.5, 1);
      sh.tint = 0x0d0a14;
      sh.alpha = 0.32;
      sh.scale.set(flip ? -k : k, k);
      sh.position.set(shadow * 0.8, shadow);
      c.addChild(sh);
    }
    const s = new Sprite(this.t(n));
    s.anchor.set(0.5, 1);
    s.scale.set(flip ? -k : k, k);
    c.addChild(s);
    c.position.set(x, y);
    return c;
  }

  /** 一条能横着接起来的长条：正、反、正……镜像着铺，接缝就对上了。 */
  private strip(n: Name, top: number, k: number, from: number, to: number, shadow = 0): Container {
    const c = new Container();
    const tex = this.t(n);
    const w = tex.width * k;
    let i = 0;
    for (let x = from; x < to; x += w - 2, i++) {
      const flip = i % 2 === 1;
      if (shadow > 0) {
        const sh = new Sprite(tex);
        sh.tint = 0x0d0a14;
        sh.alpha = 0.3;
        sh.scale.set(flip ? -k : k, k);
        sh.position.set((flip ? x + w : x) + shadow * 0.6, top - shadow);
        c.addChild(sh);
      }
      const s = new Sprite(tex);
      s.scale.set(flip ? -k : k, k);
      s.position.set(flip ? x + w : x, top);
      c.addChild(s);
    }
    return c;
  }

  private addLayer(view: Container, depth: number, tint = true): Layer {
    const l = { view, depth, x: view.x, y: view.y };
    this.layers.push(l);
    if (tint) this.tinted.push(view);
    return l;
  }

  private build(): void {
    const O = OPEN;
    const L = O.x - 120;
    const R = O.x + O.w + 120;
    // ---- 外面：夜里的工作室 ----
    const bgTex = Texture.from(roomCanvas());
    const bg = new Sprite(bgTex);
    bg.anchor.set(0.5);
    this.room.addChild(bg);
    this.root.addChild(this.room);

    // ---- 台口里面，由远到近 ----
    this.inside.addChild(this.buildSky(L, R));
    const hills = this.strip('hills', 205, 1, L, R);
    this.inside.addChild(hills);
    this.addLayer(hills, 0.85);
    const islet = this.paper('islet', 980, 296, 0.42);
    this.inside.addChild(islet);
    this.addLayer(islet, 0.8);
    const seaTops = [282, 300, 322, 350];
    (['sea-1', 'sea-2', 'sea-3', 'sea-4'] as const).forEach((n, i) => {
      const c = this.strip(n, seaTops[i]!, 0.95 + i * 0.05, L - 40, R + 40, 3 + i);
      this.inside.addChild(c);
      this.addLayer(c, 0.75 - i * 0.07);
      this.seas.push({ c, base: c.y, phase: i * 1.3, amp: 1.2 + i * 0.8 });
    });
    const rock = this.paper('rock-3', 230, 400, 0.38, 6);
    this.inside.addChild(rock);
    this.addLayer(rock, 0.5);
    // 后面一排灌丛。
    const bushes = new Container();
    for (const [n, x, k] of [
      ['bush-1', 150, 0.62],
      ['bush-3', 420, 0.55],
      ['bush-4', 840, 0.6],
      ['bush-2', 1010, 0.7],
      ['bush-5', 1230, 0.58],
    ] as const) bushes.addChild(this.paper(n, x, 432, k, 7));
    this.inside.addChild(bushes);
    this.addLayer(bushes, 0.42);

    // 地面：中间一段带洞穴，两边是普通的地面（镜像接）。
    const ground = new Container();
    const gk = 0.78;
    const bw = this.t('ground-burrow').width * gk;
    const gw = this.t('ground').width * gk;
    const bx = 760 - bw / 2;
    const gTop = 404;
    // 洞里的暗处和一点暖光（洞是镂空的，透出后面这一块）。
    const hole = new Graphics();
    const hx = bx + bw * 0.505;
    const hy = gTop + this.t('ground-burrow').height * gk * 0.5;
    hole.ellipse(hx, hy, 62, 46).fill(0x2a170c);
    hole.ellipse(hx, hy + 8, 44, 26).fill({ color: 0xffb860, alpha: 0.35 });
    ground.addChild(hole);
    this.kitLayer.position.set(hx, hy + 22);
    ground.addChild(this.kitLayer);
    for (let x = bx - gw, i = 0; x > L - gw; x -= gw - 2, i++) {
      const s = new Sprite(this.t('ground'));
      s.scale.set(i % 2 === 0 ? -gk : gk, gk);
      s.position.set(i % 2 === 0 ? x + gw : x, gTop + 6);
      ground.addChild(s);
    }
    for (let x = bx + bw - 2, i = 0; x < R; x += gw - 2, i++) {
      const s = new Sprite(this.t('ground'));
      s.scale.set(i % 2 === 1 ? -gk : gk, gk);
      s.position.set(i % 2 === 1 ? x + gw : x, gTop + 6);
      ground.addChild(s);
    }
    const burrow = new Sprite(this.t('ground-burrow'));
    burrow.scale.set(gk);
    burrow.position.set(bx, gTop);
    ground.addChild(burrow);
    this.inside.addChild(ground);
    this.addLayer(ground, 0.3);

    // 台上的动物。
    this.actorLayer.sortableChildren = true;
    this.inside.addChild(this.actorLayer);
    this.addLayer(this.actorLayer, 0.28);

    // 前景的草：长的和啃短的两套，按草的高度换。
    const front = new Container();
    const spots: Array<[number, number]> = [
      [110, 0.62],
      [330, 0.5],
      [560, 0.46],
      [980, 0.5],
      [1200, 0.58],
      [1330, 0.66],
    ];
    const longs: Name[] = ['grass-long-1', 'grass-gold-1', 'grass-long-2', 'grass-gold-2', 'grass-long-3', 'grass-gold-3'];
    const shorts: Name[] = ['grass-bitten', 'grass-mid-1', 'grass-bitten', 'grass-mid-2', 'grass-bitten', 'grass-mid-1'];
    spots.forEach(([x, k], i) => {
      const a = this.paper(longs[i]!, x, 600, k, 8, i % 2 === 1);
      const b = this.paper(shorts[i]!, x, 600, k * 0.95, 8, i % 2 === 0);
      front.addChild(a, b);
      this.grassLong.push(a.children[1] as Sprite);
      this.grassShort.push(b.children[1] as Sprite);
      this.sway.push({ s: a.children[1] as Sprite, phase: i * 0.9, amp: 0.025 });
      b.visible = false;
    });
    this.inside.addChild(front);
    this.addLayer(front, 0.12);

    // 开口：台口里面的东西只在开口里看得见。
    const mask = new Graphics().rect(O.x, O.y, O.w, O.h).fill(0xffffff);
    this.inside.mask = mask;
    // 台口上沿垂下来的帷幕在天上投一道影子。
    const valShadow = new Graphics();
    for (let i = 0; i < 6; i++) valShadow.rect(O.x, O.y + i * 9, O.w, 9).fill({ color: 0x0d0a14, alpha: 0.18 - i * 0.03 });
    // 舞台的灯：上面亮、下面和两边暗一点（乘上去）。
    const light = new Sprite(Texture.from(stageLightCanvas()));
    light.blendMode = 'multiply';
    light.position.set(O.x, O.y);
    light.width = O.w;
    light.height = O.h;

    const stage = new Container();
    stage.addChild(this.inside, mask, valShadow, light);
    // 台口框、帷幕、台座。
    const frame = new Sprite(this.t('frame'));
    const frameShadow = new Sprite(this.t('frame'));
    frameShadow.tint = 0x000000;
    frameShadow.alpha = 0.45;
    frameShadow.position.set(10, 16);
    frameShadow.filters = [new BlurFilter({ strength: 8, quality: 2 })];
    const base = new Sprite(this.t('base'));
    base.anchor.set(0.5, 0);
    base.position.set(725, 600);
    base.scale.set(1.02, 1.1);
    const valance = new Sprite(this.t('valance'));
    valance.anchor.set(0.5, 0);
    valance.position.set(725, 34);
    valance.scale.set(0.98, 0.62);
    stage.addChild(frameShadow, base, frame, valance);

    // 台口前面的大草叶（比台口还近，镜头一动错得最多）。
    const leaves = new Container();
    const l1 = this.paper('leaves-2', 30, 690, 0.42, 10);
    const l2 = this.paper('leaf-3', 1440, 680, 0.62, 10, true);
    leaves.addChild(l1, l2);
    this.sway.push({ s: l1.children[1] as Sprite, phase: 0.4, amp: 0.018 }, { s: l2.children[1] as Sprite, phase: 2.2, amp: 0.02 });
    stage.addChild(leaves);
    this.addLayer(leaves, -0.25);

    // 铜牌：台座上写着这是哪儿、有什么。
    this.plaque = new Text({ text: '', style: { fontFamily: HAND, fontSize: 22, fill: 0xf3e2b4, align: 'center', letterSpacing: 2, dropShadow: { color: 0x000000, alpha: 0.6, distance: 1, blur: 1, angle: Math.PI / 2 } }, resolution: 2 });
    this.plaque.anchor.set(0.5, 0.5);
    this.plaque.position.set(725, 643);
    stage.addChild(this.plaque);

    // 四季圆盘和手摇把（台口右边）。
    const dial = new Container();
    dial.position.set(1540, 300);
    this.wheel = new Sprite(this.t('wheel'));
    this.wheel.anchor.set(0.5);
    this.wheel.scale.set(0.5);
    const wheelShadow = new Sprite(this.t('wheel'));
    wheelShadow.anchor.set(0.5);
    wheelShadow.scale.set(0.5);
    wheelShadow.tint = 0x000000;
    wheelShadow.alpha = 0.4;
    wheelShadow.position.set(8, 12);
    const pointer = new Sprite(this.t('pointer'));
    pointer.anchor.set(0.5, 0.86);
    pointer.scale.set(0.34);
    pointer.position.set(0, -78);
    pointer.rotation = Math.PI;
    this.crank = new Container();
    const crankSprite = new Sprite(this.t('crank'));
    // 手摇把贴图：左端的圆环是轴，右上是木柄。
    crankSprite.anchor.set(0.06, 0.78);
    crankSprite.scale.set(0.42);
    this.crank.addChild(crankSprite);
    this.crank.eventMode = 'static';
    this.crank.cursor = 'grab';
    dial.addChild(wheelShadow, this.wheel, this.crank, pointer);
    dial.eventMode = 'static';
    dial.on('pointerdown', (e: FederatedPointerEvent) => this.grabCrank(e, dial));
    stage.addChild(dial);
    this.addLayer(dial, 0, false);

    // 回到地图：台座左边一张纸签。
    const back = new Container();
    const bgk = new Graphics().roundRect(-78, -22, 156, 44, 6).fill(0xf2e6c9).stroke({ color: 0x4a3a28, width: 1.5, alpha: 0.5 });
    const label = new Text({ text: '← 回到地图', style: { fontFamily: HAND, fontSize: 20, fill: 0x4a3a28 }, resolution: 2 });
    label.anchor.set(0.5);
    back.addChild(bgk, label);
    back.position.set(150, 728);
    back.rotation = -0.03;
    back.eventMode = 'static';
    back.cursor = 'pointer';
    back.on('pointertap', () => this.hooks.close());
    stage.addChild(back);

    this.root.addChild(stage);
    this.stage = stage;
    this.root.on('globalpointermove', (e: FederatedPointerEvent) => {
      const s = this.app.screen;
      this.cam.tx = (e.global.x / s.width - 0.5) * 2;
      this.cam.ty = (e.global.y / s.height - 0.5) * 2;
    });
  }

  private stage!: Container;

  private buildSky(L: number, R: number): Container {
    const sky = new Container();
    // 星孔后面的一层亮：夜里的天是一张扎了孔的纸，孔里透出光。
    this.starGlow = new Graphics().rect(L, OPEN.y - 20, R - L, 300).fill(0xffe9b8);
    sky.addChild(this.starGlow);
    for (const n of ['sky-day', 'sky-dusk', 'sky-night'] as const) {
      const tex = this.t(n);
      const k = (R - L) / tex.width;
      const s = new Sprite(tex);
      s.scale.set(k, Math.max(k, 300 / tex.height));
      s.position.set(L, OPEN.y - 20);
      sky.addChild(s);
      this.skies.push(s);
    }
    this.sun = new Sprite(this.t('sun'));
    this.sun.anchor.set(0.5);
    this.sun.scale.set(0.34);
    this.moon = new Sprite(this.t('moon'));
    this.moon.anchor.set(0.5);
    this.moon.scale.set(0.3);
    sky.addChild(this.sun, this.moon);
    const cl: Array<[Name, number, number, number]> = [
      ['cloud-1', 260, 120, 0.42],
      ['cloud-2', 640, 92, 0.38],
      ['cloud-3', 1050, 140, 0.4],
      ['cloud-4', 1320, 105, 0.36],
    ];
    for (const [n, x, y, k] of cl) {
      const s = new Sprite(this.t(n));
      s.anchor.set(0.5, 1);
      s.scale.set(k);
      sky.addChild(s);
      this.clouds.push({ s, x, y, v: 4 + this.random() * 5 });
    }
    this.addLayer(sky, 1);
    // 远处的天、海模糊一点（景深）。
    sky.filters = [new BlurFilter({ strength: 1.2, quality: 2 })];
    return sky;
  }

  /** 打开：在地图的 (sx, sy) 屏幕位置，镜头"落下去"。 */
  async show(): Promise<void> {
    await this.load();
    this.open = true;
    this.root.visible = true;
    this.fade = 0;
    this.openedFor = 0;
    for (const a of this.actors) this.dropActor(a);
    this.actors.length = 0;
  }

  close(): void {
    this.open = false;
  }

  /** 每帧：外面给这一带的情况；dt 是真实的秒数。返回地图还要不要画（剧场完全盖住时不用）。 */
  update(cast: TheatreCast, dt: number): boolean {
    if (!this.ready) return true;
    this.cast = cast;
    this.time += dt;
    this.openedFor += dt;
    this.fade = this.open ? Math.min(1, this.fade + dt / 0.45) : Math.max(0, this.fade - dt / 0.35);
    this.root.visible = this.fade > 0;
    if (!this.root.visible) return true;
    const f = this.fade * this.fade * (3 - 2 * this.fade);
    this.root.alpha = f;
    this.layout(f);
    this.animate(cast, dt);
    this.castActors(cast, dt);
    return f < 1;
  }

  private layout(f: number): void {
    const s = this.app.screen;
    // 整个剧场（含右边的圆盘、下面的台座）放进屏幕，留一点边。
    const W = 1700;
    const H = 780;
    const k = Math.min(s.width / W, s.height / H) * 0.96 * (1.06 - 0.06 * f);
    this.stage.scale.set(k);
    this.stage.position.set(s.width / 2 - (W / 2 - 40) * k, s.height / 2 - (H / 2 - 10) * k);
    const bg = this.room.children[0] as Sprite;
    bg.position.set(s.width / 2, s.height / 2);
    bg.width = Math.max(s.width, s.height * 1.6) * 1.1;
    bg.height = Math.max(s.height, s.width / 1.6) * 1.1;
    // 镜头：跟着鼠标慢慢挪，自己也轻轻呼吸。
    const breath = { x: Math.sin(this.time * 0.21) * 0.25, y: Math.sin(this.time * 0.17 + 1) * 0.15 };
    this.cam.x = ease(this.cam.x, this.cam.tx + breath.x, 1 / 60, 0.35);
    this.cam.y = ease(this.cam.y, this.cam.ty + breath.y, 1 / 60, 0.35);
    for (const l of this.layers) {
      // 远的层跟着镜头走得多（看起来几乎不动），近的层错开得多；台口前面的层反方向。
      const px = -this.cam.x * 26 * (1 - l.depth);
      const py = -this.cam.y * 12 * (1 - l.depth);
      l.view.position.set(l.x + px, l.y + py);
    }
  }

  private animate(cast: TheatreCast, dt: number): void {
    // 天光：时间走得快的时候固定在傍晚（不然一秒里天黑天亮好几回），慢的时候跟着真的钟点。
    const target = cast.speed > 1.5 ? 17.2 : cast.hour + 0.5;
    let d = target - this.hour;
    if (d > 12) d -= 24;
    if (d < -12) d += 24;
    this.hour = (this.hour + d * (1 - Math.exp(-dt / 0.6)) + 24) % 24;
    const h = this.hour;
    // 白天 7–16，黄昏 16–20（和清晨 5–7），夜里。
    const day = h >= 7 && h < 16 ? 1 : h >= 5 && h < 7 ? (h - 5) / 2 : h >= 16 && h < 18 ? 1 - (h - 16) / 2 : 0;
    const night = h >= 20 || h < 4 ? 1 : h >= 18 && h < 20 ? (h - 18) / 2 : h >= 4 && h < 5 ? 1 - (h - 4) : 0;
    const dusk = Math.max(0, 1 - day - night);
    this.skies[0]!.alpha = 1;
    this.skies[1]!.alpha = dusk + night;
    this.skies[2]!.alpha = night;
    this.starGlow.alpha = night;
    // 太阳从左边升起、右边落下；月亮反过来。
    const sunT = ((h - 5) / 15) % 1;
    this.sun.visible = h >= 5 && h < 20;
    this.sun.position.set(lerp(OPEN.x + 80, OPEN.x + OPEN.w - 80, sunT), 250 - Math.sin(sunT * Math.PI) * 170);
    const mh = (h + 12) % 24;
    const moonT = ((mh - 5) / 15) % 1;
    this.moon.visible = night > 0.05;
    this.moon.alpha = night;
    this.moon.position.set(lerp(OPEN.x + 120, OPEN.x + OPEN.w - 120, moonT), 240 - Math.sin(moonT * Math.PI) * 150);
    // 整个布景的色调：白天本色，黄昏偏暖，夜里偏蓝暗。
    const tint = mixColor(mixColor(0xfff4e6, 0xffc89a, dusk), 0x8a96c4, night);
    for (const c of this.tinted) c.tint = tint;
    this.actorLayer.tint = mixColor(0xffffff, 0xb4bce0, night * 0.8);
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > OPEN.x + OPEN.w + 200) c.x = OPEN.x - 200;
      c.s.position.set(c.x, c.y);
      c.s.alpha = 1 - night * 0.6;
    }
    for (const s of this.seas) s.c.y = s.base + Math.sin(this.time * 0.6 + s.phase) * s.amp;
    for (const w of this.sway) w.s.skew.x = Math.sin(this.time * 1.1 + w.phase) * w.amp;
    // 草的高度：草少了，长草换成啃短的。
    const shortN = Math.round((1 - Math.min(1, cast.grass / 0.6)) * this.grassLong.length);
    this.grassLong.forEach((g, i) => {
      const short = i < shortN;
      g.parent!.visible = !short;
      this.grassShort[i]!.parent!.visible = short;
    });
    // 四季圆盘：指针固定在上面，盘子转。春绿、夏橙、秋蓝、冬白（盘上四格的颜色）。
    this.wheel.rotation = ((cast.dayOfYear - 90) * Math.PI) / 180;
    if (!this.crankGrab) {
      // 不摇的时候，手摇把跟着时间慢慢转（时间在走）。
      this.crankAngle += (cast.speed / 1.2 / DAYS_PER_TURN) * Math.PI * 2 * dt;
    }
    this.crank.rotation = this.crankAngle;
    const key = `${cast.place}|${cast.species.map((s) => `${s.name}${s.count}`).join('|')}`;
    if (key !== this.plaqueKey) {
      this.plaqueKey = key;
      const who = cast.species.filter((s) => s.count > 0).map((s) => `${s.name} ${s.count} 只`).join('　');
      this.plaque.text = `${cast.place}　${who || '这一带什么也没有'}`;
    }
  }

  private grabCrank(e: FederatedPointerEvent, dial: Container): void {
    const at = (): number => {
      const p = dial.toLocal(e.global);
      return Math.atan2(p.y, p.x);
    };
    this.crankGrab = { last: at(), t: performance.now(), omega: 0 };
    this.crank.cursor = 'grabbing';
    const move = (ev: FederatedPointerEvent): void => {
      if (!this.crankGrab) return;
      const p = dial.toLocal(ev.global);
      const a = Math.atan2(p.y, p.x);
      let da = a - this.crankGrab.last;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      const now = performance.now();
      const dts = Math.max(1, now - this.crankGrab.t) / 1000;
      // 只能往前摇（顺时针）；角速度平滑一下。
      const fwd = Math.max(0, da);
      this.crankGrab.omega = this.crankGrab.omega * 0.7 + (fwd / dts) * 0.3;
      this.crankAngle += fwd;
      this.crankGrab.last = a;
      this.crankGrab.t = now;
      // 摇一圈走 DAYS_PER_TURN 天；1 倍速一天 1.2 秒。
      const turnsPerS = this.crankGrab.omega / (Math.PI * 2);
      this.hooks.crank(Math.min(200, Math.round(turnsPerS * DAYS_PER_TURN * 1.2)));
    };
    const up = (): void => {
      this.crankGrab = null;
      this.crank.cursor = 'grab';
      this.root.off('globalpointermove', move);
      this.root.off('pointerup', up);
      this.root.off('pointerupoutside', up);
      this.hooks.crank(null);
    };
    this.root.on('globalpointermove', move);
    this.root.on('pointerup', up);
    this.root.on('pointerupoutside', up);
  }

  // ---- 台上的动物 ----

  private castActors(cast: TheatreCast, dt: number): void {
    for (const sp of cast.species) {
      const mine = sp.id.startsWith('d_');
      const want = sp.count <= 0 ? 0 : Math.max(1, Math.min(mine ? CAST_CAP.mine : CAST_CAP.other, Math.round(1.4 * Math.pow(sp.count, 0.4))));
      const have = this.actors.filter((a) => a.id === sp.id && a.leaving === null);
      // 刚打开时直接站在台上；之后新来的从两边走上台。
      if (have.length < want) this.enter(sp, mine, this.openedFor < 0.6);
      else if (have.length > want) have[0]!.leaving = 0;
    }
    for (const a of this.actors) if (!cast.species.some((s) => s.id === a.id) && a.leaving === null) a.leaving = 0;
    for (const a of this.actors) this.stepActor(a, dt);
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i]!;
      if (a.leaving !== null && a.leaving > 1.2) {
        this.dropActor(a);
        this.actors.splice(i, 1);
      }
    }
    // 洞里窝着的幼崽：最多三只，蜷着。
    const kits = Math.min(3, cast.kits);
    const mineSp = cast.species.find((s) => s.id.startsWith('d_') && this.rigs.has(s.id));
    if (kits !== this.kitActors.length) {
      for (const k of this.kitActors) k.destroy({ children: true });
      this.kitActors = [];
      if (mineSp && this.kit) {
        const spec = this.rigs.get(mineSp.id)!;
        for (let i = 0; i < kits; i++) {
          const r = new PuppetActor(this.kit, spec.plan, spec.dye, this.rules, 1, i * 0.37, 2.5);
          r.setLength(34);
          r.setMode('lie');
          r.step(2);
          r.view.position.set((i - (kits - 1) / 2) * 30, 0);
          if (i % 2) r.view.scale.x *= -1;
          this.kitLayer.addChild(r.view);
          this.kitActors.push(r.view);
        }
      }
    }
  }

  private enter(sp: TheatreCast['species'][number], mine: boolean, onStage = false): void {
    const lane = this.random() < 0.5 ? 0 : 1;
    const L = LANES[lane]!;
    // 小东西放大一些（台上是近景，鸟和小兽要看得清），大的封顶（不能比台口还高）。
    const len = Math.min(360, Math.max(70, sp.bodyLenM * PX_PER_M)) * L.k;
    const box = new Container();
    const inner = new Container();
    let rig: PuppetActor | null = null;
    const spec = this.rigs.get(sp.id);
    if (spec && this.kit) {
      rig = this.spare.get(sp.id)?.pop() ?? new PuppetActor(this.kit, spec.plan, spec.dye, this.rules, spec.speedFactor, this.random(), 1.6);
      rig.setLength(len);
      inner.addChild(rig.view);
    } else {
      inner.addChild(makeAnimal(this.P7, puppetKindOf(sp.id), len * 1.25, 0, false));
    }
    const shadow = new Graphics().ellipse(len * 0.05, 2, len * 0.42, len * 0.07).fill({ color: 0x1a0f08, alpha: 0.3 });
    box.addChild(shadow, inner);
    // 从左右两边走上台。
    const fromLeft = this.random() < 0.5;
    const x = onStage ? lerp(OPEN.x + 100, OPEN.x + OPEN.w - 100, this.random()) : fromLeft ? OPEN.x - len : OPEN.x + OPEN.w + len;
    const a: Actor = {
      id: sp.id,
      box,
      inner,
      rig,
      lane,
      x,
      tx: lerp(OPEN.x + 120, OPEN.x + OPEN.w - 120, this.random()),
      v: 0,
      face: onStage ? (this.random() < 0.5 ? -1 : 1) : fromLeft ? 1 : -1,
      doing: onStage ? (['stand', 'eat', 'lie'] as const)[Math.floor(this.random() * 3)]! : 'go',
      timer: onStage ? 1 + this.random() * 4 : 12,
      leaving: null,
      age: 0,
      len,
      speed: rig ? (rig.walkMs / rig.plan.bodyLen) * len : len * 1.3,
    };
    box.position.set(x, L.y);
    box.zIndex = L.y + this.random();
    this.actorLayer.addChild(box);
    this.actors.push(a);
  }

  private dropActor(a: Actor): void {
    if (a.rig) {
      a.rig.view.removeFromParent();
      const list = this.spare.get(a.id) ?? [];
      list.push(a.rig);
      this.spare.set(a.id, list);
    }
    a.box.destroy({ children: true });
  }

  private stepActor(a: Actor, dt: number): void {
    a.age += dt;
    if (a.leaving !== null) {
      a.leaving += dt;
      a.box.alpha = Math.max(0, 1 - a.leaving / 1.2);
      a.v = Math.max(0, a.v - dt * 2);
      a.rig?.setSpeed(0);
      a.rig?.setMode('lie');
      a.rig?.step(dt);
      return;
    }
    a.timer -= dt;
    const dx = a.tx - a.x;
    const going = a.doing === 'go' && Math.abs(dx) > 2;
    if (a.doing === 'go' && Math.abs(dx) > 1) a.face = dx < 0 ? -1 : 1;
    const vt = going ? 1 : 0;
    a.v += Math.sign(vt - a.v) * Math.min(Math.abs(vt - a.v), dt / 0.45);
    if (a.v > 0) a.x += Math.sign(dx) * Math.min(Math.abs(dx), a.v * a.speed * dt);
    if ((a.doing === 'go' && Math.abs(dx) <= 2 && a.v < 0.05) || (a.doing !== 'go' && a.timer <= 0) || a.timer < -20) {
      const r = this.random();
      if (a.doing === 'go') {
        a.doing = r < 0.5 ? 'eat' : r < 0.8 ? 'stand' : 'lie';
        a.timer = a.doing === 'eat' ? 3 + this.random() * 3 : a.doing === 'lie' ? 4 + this.random() * 4 : 1.5 + this.random() * 2;
      } else {
        a.doing = 'go';
        a.tx = Math.min(OPEN.x + OPEN.w - 80, Math.max(OPEN.x + 80, a.x + (this.random() - 0.5) * 700));
        a.timer = 14;
      }
    }
    a.inner.scale.x = a.face;
    a.box.alpha = Math.min(1, a.age / 0.4);
    a.box.x = a.x;
    if (a.rig) {
      a.rig.setMode(a.doing === 'go' ? 'stand' : a.doing);
      a.rig.setSpeed(a.v * a.rig.walkMs);
      a.rig.step(dt);
    } else {
      a.inner.y = -Math.abs(Math.sin(a.age * 9)) * a.len * 0.06 * a.v;
    }
  }
}

/** 台口外面：夜里的工作室。靛蓝的暗处，左上一盏台灯的暖光，下面一张胡桃木的桌面。 */
function roomCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 1000;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0f1424';
  g.fillRect(0, 0, 1600, 1000);
  // 桌面：下面三成，胡桃木。
  const desk = g.createLinearGradient(0, 640, 0, 1000);
  desk.addColorStop(0, '#2a1810');
  desk.addColorStop(0.15, '#4a2a18');
  desk.addColorStop(1, '#1f120b');
  g.fillStyle = desk;
  g.fillRect(0, 660, 1600, 340);
  // 木纹：几道细的深色线。
  g.globalAlpha = 0.18;
  g.strokeStyle = '#120a05';
  for (let i = 0; i < 26; i++) {
    g.lineWidth = 1 + (i % 3);
    g.beginPath();
    const y = 670 + i * 13 + Math.sin(i) * 4;
    g.moveTo(0, y);
    for (let x = 0; x <= 1600; x += 80) g.lineTo(x, y + Math.sin(x / 210 + i) * 3);
    g.stroke();
  }
  g.globalAlpha = 1;
  // 台灯的光：左上，暖的一大团。
  const lamp = g.createRadialGradient(330, 120, 20, 520, 420, 900);
  lamp.addColorStop(0, 'rgba(255,196,120,0.55)');
  lamp.addColorStop(0.35, 'rgba(214,132,64,0.22)');
  lamp.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = lamp;
  g.fillRect(0, 0, 1600, 1000);
  // 暗角。
  const v = g.createRadialGradient(800, 470, 300, 800, 500, 980);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(4,6,14,0.75)');
  g.fillStyle = v;
  g.fillRect(0, 0, 1600, 1000);
  return c;
}

/** 台口里的灯：上面亮，往下、往两边暗一点（乘到布景上）。 */
function stageLightCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 220;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 220);
  const r = g.createRadialGradient(256, 30, 40, 256, 90, 330);
  r.addColorStop(0, 'rgba(255,255,255,0)');
  r.addColorStop(0.6, 'rgba(120,100,120,0.18)');
  r.addColorStop(1, 'rgba(40,30,60,0.55)');
  g.fillStyle = r;
  g.fillRect(0, 0, 512, 220);
  return c;
}
