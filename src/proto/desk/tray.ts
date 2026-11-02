import type { Design, Morph } from '../../data';
import { earDroop, earShape, type EarModel } from '../../render/puppet/ear';

/**
 * 部件托盘（设计台第 2 步 c，`docs/feel/desk.md`）：每个部位一排卡片，点一下或拖到纸偶身上就扣上。
 *
 * 卡分两种，手感一样：
 * - 部件卡：推演里的部件（嘴、腿、尾、体表、消化），扣上就是换这个槽的部件；
 * - 形状卡（parts.json 的 morphs，现在只有耳）：参数空间里一个有名字的点，扣上就是把那一组参数整组写进设计，之后照样能微调。
 *
 * 手机上卡片一排可以左右滑；按住卡片往上拖才是"拖到纸偶身上"，所以左右滑不会误扣。
 */

export interface TrayItem {
  key: string;
  name: string;
  blurb: string;
  /** 卡面的小图（没有就只写名字）。 */
  icon?: (c: HTMLCanvasElement) => void;
  /** 现在的设计是不是就是这张卡。 */
  isOn: () => boolean;
}

export interface TrayTab {
  id: string;
  name: string;
  items: TrayItem[];
}

export interface TrayHooks {
  /** 扣上一张卡：点一下时 at 是 null（扣在纸偶的中间），拖过去时是松手的地方（屏幕坐标），不在纸偶身上就不扣。 */
  drop(tab: TrayTab, item: TrayItem, at: { x: number; y: number } | null): void;
  /** 拖着卡片走的时候：手指在哪（null = 松手了或取消了），用来给纸偶描一圈"可以扣在这里"。 */
  drag(at: { x: number; y: number } | null): void;
}

/** 按下以后挪多远才算拖（像素）；手机上要往上拖，左右滑是翻卡片。 */
const DRAG_PX = 10;

export class Tray {
  readonly el: HTMLElement;
  private readonly row: HTMLElement;
  private readonly blurb: HTMLElement;
  private readonly tabButtons = new Map<string, HTMLButtonElement>();
  private cards: { item: TrayItem; el: HTMLElement }[] = [];
  private tab: TrayTab;

  constructor(
    private readonly tabs: TrayTab[],
    private readonly hooks: TrayHooks,
  ) {
    this.el = document.createElement('div');
    this.el.id = 'tray';
    const bar = document.createElement('div');
    bar.className = 'tabs';
    for (const t of tabs) {
      const b = document.createElement('button');
      b.textContent = t.name;
      b.addEventListener('click', () => this.show(t));
      this.tabButtons.set(t.id, b);
      bar.append(b);
    }
    this.row = document.createElement('div');
    this.row.className = 'cards';
    this.blurb = document.createElement('div');
    this.blurb.className = 'blurb';
    this.el.append(bar, this.row, this.blurb);
    this.tab = tabs[0]!;
    this.show(this.tab);
  }

  show(tab: TrayTab): void {
    this.tab = tab;
    for (const [id, b] of this.tabButtons) b.classList.toggle('on', id === tab.id);
    this.row.replaceChildren();
    this.cards = tab.items.map((item) => {
      const card = document.createElement('div');
      card.className = 'pcard';
      card.title = item.blurb;
      if (item.icon) {
        const c = document.createElement('canvas');
        c.width = 112;
        c.height = 72;
        item.icon(c);
        card.append(c);
      }
      const name = document.createElement('span');
      name.textContent = item.name;
      card.append(name);
      this.bindCard(card, item);
      this.row.append(card);
      return { item, el: card };
    });
    this.refresh();
  }

  /** 设计变了：重新标出哪张卡是现在的。 */
  refresh(): void {
    let on: TrayItem | null = null;
    for (const c of this.cards) {
      const yes = c.item.isOn();
      c.el.classList.toggle('on', yes);
      if (yes) on = c.item;
    }
    this.blurb.textContent = on ? `${on.name}：${on.blurb}` : '现在的样子是微调过的，不是哪一张卡。';
  }

  private bindCard(card: HTMLElement, item: TrayItem): void {
    let start: { x: number; y: number; id: number; mouse: boolean } | null = null;
    let ghost: HTMLElement | null = null;
    const end = (e: PointerEvent, cancel: boolean): void => {
      if (!start || e.pointerId !== start.id) return;
      if (ghost) {
        ghost.remove();
        ghost = null;
        this.hooks.drag(null);
        if (!cancel) this.hooks.drop(this.tab, item, { x: e.clientX, y: e.clientY });
      } else if (!cancel) this.hooks.drop(this.tab, item, null);
      start = null;
    };
    card.addEventListener('pointerdown', (e) => {
      start = { x: e.clientX, y: e.clientY, id: e.pointerId, mouse: e.pointerType === 'mouse' };
      // 鼠标一下就能拖出卡片外面：按下就抓住指针（触屏本来就是按在哪个元素上就归它）。
      if (start.mouse) card.setPointerCapture(e.pointerId);
    });
    card.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!ghost) {
        // 鼠标往哪拖都行；手指要往上拖（左右是翻卡片，交给浏览器）。
        const go = start.mouse ? Math.hypot(dx, dy) > DRAG_PX : -dy > DRAG_PX && -dy > Math.abs(dx);
        if (!go) return;
        if (!card.hasPointerCapture(e.pointerId)) card.setPointerCapture(e.pointerId);
        ghost = card.cloneNode(true) as HTMLElement;
        const src = card.querySelector('canvas');
        const dst = ghost.querySelector('canvas');
        if (src && dst) dst.getContext('2d')!.drawImage(src, 0, 0);
        ghost.classList.add('ghost');
        document.body.append(ghost);
      }
      ghost.style.left = `${e.clientX - ghost.offsetWidth / 2}px`;
      ghost.style.top = `${e.clientY - ghost.offsetHeight / 2}px`;
      this.hooks.drag({ x: e.clientX, y: e.clientY });
    });
    card.addEventListener('pointerup', (e) => end(e, false));
    card.addEventListener('pointercancel', (e) => end(e, true));
  }
}

type Ear = Morph['appearance'];
const EAR_KEYS = ['earLen', 'earWide', 'earTip', 'earStiff', 'earPos'] as const;
/** 不写时的耳（猫的耳；earTip 的默认值见 plan.ts 的 EAR_TIP_CAT）。 */
export const earDefault = (tipCat: number): Ear => ({ earLen: 1, earWide: 1, earTip: tipCat, earStiff: 1, earPos: 0 });
/** 设计现在的耳（没写的按默认）。 */
export function earOf(design: Design, tipCat: number): Ear {
  const e = earDefault(tipCat);
  for (const k of EAR_KEYS) e[k] = design.appearance?.[k] ?? e[k];
  return e;
}
/**
 * 扣上一张形状卡以后设计的 appearance：五个数整组换成卡上的（前一张卡留下的值不会混进来），
 * 和默认一样的不写——扣上"小三角立耳"的猫和没动过的猫写法一样。全是默认就是 undefined（不写 appearance）。
 */
export function appearanceFor(m: Morph, tipCat: number): Design['appearance'] {
  const d = earDefault(tipCat);
  const a: NonNullable<Design['appearance']> = {};
  for (const k of EAR_KEYS) if (Math.abs(m.appearance[k] - d[k]) > 1e-9) a[k] = m.appearance[k];
  return Object.keys(a).length ? a : undefined;
}
/** 现在的设计是不是就是这张形状卡（滑块、把手会舍入，差 0.01 以内算一样）。 */
export function isMorph(design: Design, m: Morph, tipCat: number): boolean {
  const e = earOf(design, tipCat);
  return EAR_KEYS.every((k) => Math.abs(e[k] - m.appearance[k]) < 0.011);
}

/** 耳卡的小图用的耳：和原画的猫耳差不多的比例（铆钉到耳尖 36、埋在头里 8、耳根半宽 9），头的半径 22。 */
const ICON_EAR: EarModel = { ax: [0, -1], len: 36, base: 8, R: 9 };
const ICON_HEAD = 22;
/** 耳在头上的位置：0 头顶，1 滑到头的后侧（和纸偶的 earSlide 一样往后，脸朝右）。 */
const ICON_SLIDE = 1.2;

/** 画一张耳卡的小图：一个圆头 + 按参数剪的耳（和纸偶同一个 earShape），按整体的外框缩放进画布。 */
export function drawEarIcon(c: HTMLCanvasElement, a: Morph['appearance'], tipCat: number): void {
  const ctx = c.getContext('2d')!;
  const round = a.earTip <= tipCat ? (tipCat - a.earTip) / tipCat : -(a.earTip - tipCat) / (1 - tipCat);
  // 铆钉沿头的轮廓往后滑；耳跟着轮廓的朝向转（frame）。
  const th = -Math.PI / 2 - a.earPos * ICON_SLIDE;
  const frame = th + Math.PI / 2;
  const { shape, hinge, sink } = earShape(ICON_EAR, { lenK: a.earLen, wide: a.earWide, round, stiff: a.earStiff, frame });
  const rot = frame + hinge;
  const rr = ICON_HEAD * 0.82 - sink;
  const pivot: [number, number] = [Math.cos(th) * rr, Math.sin(th) * rr];
  const ear: [number, number][] = [];
  for (let i = 0; i < shape.outline.length; i += 2) {
    const x = shape.outline[i]!;
    const y = shape.outline[i + 1]!;
    ear.push([pivot[0] + x * Math.cos(rot) - y * Math.sin(rot), pivot[1] + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  const show = a.earLen > 0.12;
  // 外框：头 + 耳（耳长 0 时只有头）。
  let x0 = -ICON_HEAD;
  let x1 = ICON_HEAD * 1.5;
  let y0 = -ICON_HEAD;
  let y1 = ICON_HEAD;
  if (show) for (const [x, y] of ear) [x0, x1, y0, y1] = [Math.min(x0, x), Math.max(x1, x), Math.min(y0, y), Math.max(y1, y)];
  const pad = 6;
  const k = Math.min((c.width - 2 * pad) / (x1 - x0), (c.height - 2 * pad) / (y1 - y0));
  const ox = (c.width - (x1 - x0) * k) / 2 - x0 * k;
  const oy = (c.height - (y1 - y0) * k) / 2 - y0 * k;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#5a4632';
  ctx.lineWidth = 2;
  const path = (pts: [number, number][]): void => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(ox + x * k, oy + y * k) : ctx.moveTo(ox + x * k, oy + y * k)));
    ctx.closePath();
  };
  // 头：圆 + 往前（右）的一点吻。
  const head: [number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    const snout = Math.max(0, Math.cos(t)) ** 3 * 0.45;
    head.push([Math.cos(t) * ICON_HEAD * (1 + snout), Math.sin(t) * ICON_HEAD * (1 - 0.15 * snout) + snout * 4]);
  }
  // 垂下来的耳在脸侧，画在头的上面；立着的耳画在头的后面（耳根埋在头里）。
  const drooped = earDroop(a.earStiff) > 0.5;
  const drawEar = (): void => {
    if (!show) return;
    path(ear);
    ctx.fillStyle = '#ead9b8';
    ctx.fill();
    ctx.stroke();
  };
  if (!drooped) drawEar();
  path(head);
  ctx.fillStyle = '#f1e6cf';
  ctx.fill();
  ctx.stroke();
  if (drooped) drawEar();
  // 眼睛和鼻尖：分得清哪边是脸。
  ctx.fillStyle = '#5a4632';
  ctx.beginPath();
  ctx.arc(ox + ICON_HEAD * 0.45 * k, oy - ICON_HEAD * 0.1 * k, Math.max(1.5, 2.2 * k), 0, Math.PI * 2);
  ctx.fill();
  if (!show) {
    // 没有耳廓：画一个耳孔。
    ctx.beginPath();
    ctx.arc(ox - ICON_HEAD * 0.25 * k, oy - ICON_HEAD * 0.05 * k, Math.max(1.5, 2 * k), 0, Math.PI * 2);
    ctx.stroke();
  }
}
