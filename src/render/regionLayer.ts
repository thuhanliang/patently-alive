import { Container, Sprite, type Texture } from 'pixi.js';
import type { SimState } from '../sim';
import { CROWDING_BLOCK_CELLS } from '../sim/physiology';
import { crowdingBlocks } from '../sim/population';
import { speciesCellCounts } from './gridLayer';
import { CELL_PX } from './projection';

/** 一个区块里每个物种最多画几个图标。 */
const MAX_ICONS = 3;
/** 不到这个物种最密那一片的这个比例，就不画（免得满岛都是图标，看不出哪里多）。 */
const MIN_SHARE = 0.2;
/** 两个、三个图标的门槛（占最密那一片的比例）。 */
const TIER_TWO = 0.5;
const TIER_THREE = 0.8;
/** 图标的边长（格）。 */
const ICON_CELLS = 1.6;

/**
 * 区域档的群落图标：每个区块（8×8 格，和死因账本、拥挤程度同一套）里每个物种画 1–3 个主色小图标，
 * 个数按这一片的数量占这个物种最密那一片的比例分三档（不到 MIN_SHARE 的不画）。一个区块按物种数分成
 * k×k 个小格（k = ⌈√物种数⌉，四个物种就是四角），每个物种占一个（按物种顺序），不会叠在一起。
 * 每天更新一次；只读推演状态。
 */
export class RegionLayer {
  readonly container = new Container();
  private readonly pool: Sprite[] = [];

  constructor(
    /** 按物种下标排；引进新物种后由 MapView.setSpecies 换掉。 */
    public textures: readonly Texture[],
    public colors: readonly number[],
  ) {}

  private blocks: { width: number; blockOf: Int32Array; blocks: number } | null = null;
  private cells = new Int32Array(0);

  draw(state: Readonly<SimState>): void {
    const { width, height, terrain } = state.grid;
    if (this.blocks?.width !== width || this.blocks.blockOf.length !== width * height) {
      const b = crowdingBlocks(width, height, terrain);
      this.blocks = { width, blockOf: b.blockOf, blocks: b.cellsIn.length };
      this.cells = new Int32Array(width * height);
    }
    const { blockOf, blocks } = this.blocks;
    const bw = Math.ceil(width / CROWDING_BLOCK_CELLS);
    const species = state.populations.length;
    const k = Math.ceil(Math.sqrt(species));
    const slotPx = (CROWDING_BLOCK_CELLS * CELL_PX) / k;
    const icon = Math.min(ICON_CELLS * CELL_PX, slotPx / 2.2);
    const counts = new Float64Array(blocks);

    let used = 0;
    for (let s = 0; s < species; s++) {
      counts.fill(0);
      const cells = speciesCellCounts(state, s, this.cells);
      for (let c = 0; c < cells.length; c++) if (cells[c]! > 0) counts[blockOf[c]!] = counts[blockOf[c]!]! + cells[c]!;
      let max = 0;
      for (const n of counts) max = Math.max(max, n);
      if (max === 0) continue;
      for (let b = 0; b < blocks; b++) {
        const share = counts[b]! / max;
        if (share < MIN_SHARE) continue;
        const icons = share >= TIER_THREE ? MAX_ICONS : share >= TIER_TWO ? 2 : 1;
        const ox = (b % bw) * CROWDING_BLOCK_CELLS * CELL_PX + (s % k) * slotPx + icon * 0.6;
        const oy = Math.floor(b / bw) * CROWDING_BLOCK_CELLS * CELL_PX + Math.floor(s / k) * slotPx + icon * 0.6;
        for (let n = 0; n < icons; n++) {
          const sp = this.sprite(used++);
          sp.texture = this.textures[s]!;
          sp.tint = this.colors[s]!;
          sp.width = icon;
          sp.height = icon;
          sp.position.set(ox + (n % 2) * icon * 1.1, oy + Math.floor(n / 2) * icon * 1.1);
          sp.visible = true;
        }
      }
    }
    for (let n = used; n < this.pool.length; n++) this.pool[n]!.visible = false;
  }

  private sprite(k: number): Sprite {
    while (this.pool.length <= k) {
      const sp = new Sprite();
      sp.anchor.set(0.5);
      this.pool.push(sp);
      this.container.addChild(sp);
    }
    return this.pool[k]!;
  }
}
