import type { P } from './fit';

/**
 * 长在纸偶身上的把手（设计台第 2 步，`docs/feel/desk.md`）。纸偶每帧摆好姿势以后报出把手在哪，设计台负责画和拖。
 *
 * - back：背（躯干中间的铆钉）。上下拖改体重；from 是它正下方的地面。
 * - toe：近侧前脚的趾尖。上下拖改腿长；from 是肩。
 * - tail：尾尖。离尾根远近改尾长；from 是尾根。
 * - earTip：近侧耳的耳尖。离耳根（露出头的地方）远近改耳长；from 是耳根的中点。
 * - earWide：近侧耳的耳根后缘。离耳根中点远近改耳宽；from 是耳根的中点。
 * - fur：肚子底下的毛尖（第 3 步 b）。往下拖毛长、往上推毛短；from 是不长毛边时的轮廓，unit 是毛长倍数每多 1 把手挪多远。
 *
 * 坐标都在纸偶的 view 里（view.toGlobal 换成屏幕）。
 */
export type HandleId = 'back' | 'toe' | 'tail' | 'earTip' | 'earWide' | 'fur';

export interface HandleSpot {
  id: HandleId;
  at: P;
  from: P;
  /** 耳长的把手：耳长 = 1 时露出头那一截有多长（view 里），耳长拖到 0 以后再拖出来时按它算。毛长的把手见上。 */
  unit?: number;
}
