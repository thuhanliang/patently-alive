import { BlurFilter, Container, Rectangle, Sprite, type Renderer, type Texture } from 'pixi.js';
import { rotate, type Cam } from './camera';

/** 一张立起来的纸片：按地面坐标登记，镜头一变就统一重排。 */
export interface Bill {
  obj: Container;
  x: number;
  y: number;
  bias: number;
}

/**
 * 剪纸场景的骨架（demo 和游戏画面共用）：root 下面两层。
 * - ground 是地面：先在 spin 里转 r，再竖直压扁 cos t。地形图、地上的投影、地面上的标注都放在 spin 里。
 * - bill 是立起来的纸片（植物、动物、标记）：不压扁、不转，只按转过以后的位置摆、按远近排前后。
 * 坐标单位是剪纸的像素（一格 PX 像素，见 terrain.ts）。
 */
export class PaperScene {
  readonly root = new Container();
  readonly ground = new Container();
  readonly spin = new Container();
  readonly bill = new Container();
  /** 盖在最上面的地面层（和 ground 一样压扁、旋转）：玩家的批注、数据图层，像墨水画在整张图上，不被植物挡住。 */
  readonly top = new Container();
  readonly topSpin = new Container();
  /** 投影层：里面一层模糊（摆好以后烤成贴图，见 bakeShadows），外面一层管透明度。 */
  private shadows = new Container();
  readonly shadowLayer = new Container();
  readonly bills: Bill[] = [];
  /** 镜头的倾斜、旋转变了以后要重画的东西（比如围栏的绳子）。 */
  readonly relayouts: (() => void)[] = [];
  /** 代表单位和数量签：拉远时反向放大，像地图图标一样保持能看清的大小。 */
  readonly iconScaled: Container[] = [];
  /** 代表单位里除第一只以外的同伴：拉远成地图图标时藏起来，只留一只。 */
  readonly companions: Container[] = [];
  private laidT = -1;
  private laidR = NaN;
  /** 这个场景自己生成的贴图（地形图、烤好的投影）；素材图集是共用的，不在这里。 */
  private readonly owned: Texture[] = [];

  constructor() {
    this.ground.addChild(this.spin);
    this.bill.sortableChildren = true;
    this.top.addChild(this.topSpin);
    this.root.addChild(this.ground, this.bill, this.top);
    this.shadows.filters = [new BlurFilter({ strength: 3, quality: 2 })];
    this.shadowLayer.alpha = 0.32;
    this.shadowLayer.addChild(this.shadows);
  }

  /** 地形图铺在最底下，投影层在它上面。 */
  setBase(tex: Texture): Sprite {
    const s = new Sprite(tex);
    this.owned.push(tex);
    this.spin.addChildAt(s, 0);
    if (!this.shadowLayer.parent) this.spin.addChildAt(this.shadowLayer, 1);
    return s;
  }

  place(obj: Container, x: number, y: number, bias = 0): Bill {
    const b = { obj, x, y, bias };
    this.bills.push(b);
    this.bill.addChild(obj);
    this.laidT = -1;
    return b;
  }

  /** 地上的投影（在地面坐标系里，不用重排）。 */
  shadowAt(obj: Container, x: number, y: number): void {
    obj.position.set(x, y);
    this.shadows.addChild(obj);
  }

  /** 贴一张立起来的纸片：底边中点在 (cx, cy) 像素处，宽 widthPx。投影是同一张图压扁、倒向右下，贴在地上。 */
  stick(tex: Texture, cx: number, cy: number, widthPx: number, flip = false, bias = 0, shade = 1): Sprite {
    const s = new Sprite(tex);
    s.anchor.set(0.5, 1);
    if (shade !== 1) {
      const g = Math.round(Math.min(1, shade) * 255);
      s.tint = (g << 16) | (g << 8) | Math.round(g * 0.97);
    }
    const k = widthPx / tex.width;
    s.scale.set(flip ? -k : k, k);
    this.place(s, cx, cy, bias);
    // 光从左上来：影子从脚下往右下方倒在地上（同一张图上下翻过来、压扁、往右斜）。
    const sh = new Sprite(tex);
    sh.anchor.set(0.5, 1);
    sh.tint = 0x241a10;
    sh.scale.set(flip ? -k : k, -k * 0.42);
    sh.skew.x = 0.75;
    this.shadowAt(sh, cx, cy - 1);
    return s;
  }

  /**
   * 地上的投影摆好以后不再变：模糊一次、烤成一张半分辨率的贴图，不用每帧重新模糊整张地图。
   * （cacheAsTexture 在这里会把投影弄丢，所以手动烤。）返回贴图占的字节数。
   */
  bakeShadows(renderer: Renderer, W: number, H: number): number {
    const pad = 48;
    const baked = renderer.generateTexture({ target: this.shadows, frame: new Rectangle(-pad, -pad, W + 2 * pad, H + 2 * pad), resolution: 0.5 });
    this.shadows.destroy({ children: true });
    this.shadows = new Container();
    this.owned.push(baked);
    const s = new Sprite(baked);
    s.position.set(-pad, -pad);
    this.shadowLayer.addChild(s);
    return baked.source.pixelWidth * baked.source.pixelHeight * 4;
  }

  /** 不用了：拆掉场景，释放自己生成的贴图（共用的素材图集不动）。 */
  dispose(): void {
    this.root.destroy({ children: true });
    for (const t of this.owned) t.destroy(true);
  }

  /** 按镜头摆好整个场景。立起来的东西的位置只和倾斜角、旋转角有关，都没变就不重排。 */
  layout(cam: Cam): void {
    this.root.position.set(cam.ox, cam.oy);
    this.ground.scale.set(cam.s, cam.s * Math.cos(cam.t));
    this.spin.rotation = cam.r;
    this.top.scale.copyFrom(this.ground.scale);
    this.topSpin.rotation = cam.r;
    this.bill.scale.set(cam.s);
    const k = Math.max(1, 0.95 / cam.s);
    for (const u of this.iconScaled) u.scale.set(k);
    for (const u of this.companions) u.visible = k < 1.05;
    if (cam.t === this.laidT && cam.r === this.laidR) return;
    this.laidT = cam.t;
    this.laidR = cam.r;
    const ct = Math.cos(cam.t);
    for (const b of this.bills) {
      const [x, ry] = rotate(cam, b.x, b.y);
      const y = ry * ct;
      b.obj.position.set(x, y);
      b.obj.zIndex = y + b.bias;
    }
    for (const f of this.relayouts) f();
  }
}
