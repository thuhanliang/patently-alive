import { Container, Graphics, Particle, ParticleContainer, Texture } from 'pixi.js';
import { TICKS_PER_DAY, isJuvenileAt, type DerivedSpecies, type SimState } from '../sim';
import { CELL_PX } from './projection';

/** 灰盒：每个物种一个灰度，按体重给大小（格的比例）。幼体小一圈。 */
const SPECIES_GRAYS = [0xf0f0f0, 0xb0b0b0, 0x202020, 0x707070];
const JUVENILE_SCALE = 0.65;

function sizeInCells(massKg: number): number {
  // 30 克 ≈ 0.2 格，250 克 ≈ 0.27 格，1.6 千克 ≈ 0.37 格；越重越大，但不超过半格。
  return Math.min(0.5, 0.14 + 0.2 * Math.cbrt(massKg));
}

/**
 * 关注区里的个体：一只一个小方块。用粒子容器，几万只也画得动。
 * 只读推演状态。
 */
export class IndividualLayer {
  readonly container = new Container();
  private readonly particles = new ParticleContainer({
    dynamicProperties: { position: true, scale: true, color: true },
  });
  private readonly pool: Particle[] = [];
  private readonly outline = new Graphics();
  private outlineKey = '';

  constructor(private readonly species: readonly DerivedSpecies[]) {
    this.container.addChild(this.particles, this.outline);
  }

  draw(state: Readonly<SimState>): void {
    const ind = state.individuals;
    const n = ind.count;
    const day = Math.floor(state.tick / TICKS_PER_DAY);
    while (this.pool.length < n) {
      const p = new Particle({ texture: Texture.WHITE, anchorX: 0.5, anchorY: 0.5 });
      this.pool.push(p);
      this.particles.addParticle(p);
    }
    if (this.particles.particleChildren.length > n) {
      this.particles.removeParticles(n, this.particles.particleChildren.length);
      this.pool.length = n;
    }
    for (let i = 0; i < n; i++) {
      const s = ind.species[i]!;
      const sp = this.species[s]!;
      const p = this.pool[i]!;
      const juvenile = isJuvenileAt(sp, ind.age[i]!, day);
      // 按贴图的实际宽度换算成世界坐标里的边长。
      const px = (sizeInCells(sp.params.bodyMassKg) * (juvenile ? JUVENILE_SCALE : 1) * CELL_PX) / Texture.WHITE.width;
      p.x = ind.x[i]! * CELL_PX;
      p.y = ind.y[i]! * CELL_PX;
      p.scaleX = px;
      p.scaleY = px;
      p.tint = SPECIES_GRAYS[s % SPECIES_GRAYS.length]!;
    }
    this.particles.update();

    // 关注区边框：哪里是"展开成个体"的区域，一眼看得出来。
    const f = state.focus;
    const key = f ? `${f.x0},${f.y0},${f.x1},${f.y1}` : '';
    if (key !== this.outlineKey) {
      this.outlineKey = key;
      this.outline.clear();
      if (f) {
        this.outline
          .rect(f.x0 * CELL_PX, f.y0 * CELL_PX, (f.x1 - f.x0) * CELL_PX, (f.y1 - f.y0) * CELL_PX)
          .stroke({ width: 2, pixelLine: false, color: 0xffffff, alpha: 0.5 });
      }
    }
  }
}
