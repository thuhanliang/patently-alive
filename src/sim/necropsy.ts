import { detPow } from './detmath';
import { decodeCause } from './ledger';
import type { Carcass } from './jobs';
import type { DerivedSpecies } from './physiology';

/**
 * 尸检所见：从一具尸体（死因由引擎记账）推出兽医能看到的证据。报告的措辞在数据里（src/data/reports），
 * 这里只给证据，不直接写"被猫吃了"：所见只描述咬痕的样子和大小；结论里列出这片地方齿距相符的吃肉物种，
 * 是兽医按证据做的推断（几种动物齿距相近时会一起列出，玩家要自己判断）。
 *
 * 咬痕由捕食者的性状推出（铁律 5）：
 * - 以吃脊椎动物为主的（carnivore，见 physiology.ts）留下成对的犬齿穿刺伤，间距 ≈ CANINE_SPACING_MM × 体重^(1/3)；
 * - 其余的（杂食、以植物为主）留下细小的成对切齿痕，宽 ≈ INCISOR_WIDTH_MM × 体重^(1/3)。
 * 体重的立方根和体长成正比，所以齿距跟着体长走。系数取家猫犬齿间距约 20 毫米、船鼠门齿宽约 2–3 毫米。
 */
export const CANINE_SPACING_MM = 12.6;
export const INCISOR_WIDTH_MM = 4;
/** 两个物种的齿痕大小相差在这个比例以内，就算"体型相符"。 */
export const BITE_MATCH_TOLERANCE = 0.25;

export type Decomposition = 'fresh' | 'early' | 'advanced';
export type Teeth = 'canine' | 'incisor';

export interface Bite {
  teeth: Teeth;
  /** 犬齿间距或切齿宽（毫米）。 */
  sizeMm: number;
  /** 这片世界里吃脊椎动物、齿痕和它相符的物种（下标），给玩家的提示；按物种顺序。 */
  matches: number[];
}

export interface NecropsyFindings {
  species: number;
  /** nest：巢里的蛋、雏或幼崽被吃。 */
  kind: BodyKind | 'starvation' | 'other' | 'predation' | 'nest';
  decomposition: Decomposition;
  bcs: number;
  /** 被捕食或巢被吃时的咬痕。 */
  bite: Bite | null;
  /** 被谁吃的（引擎知道，报告里不直接写；测试和以后的纪录片用）。 */
  predator: number;
}

/** 身体撑不住的死因（阶段 3.5）：没有咬痕，所见和结论各有一句。 */
export type BodyKind = 'malnutrition' | 'fracture' | 'dystocia';

export function teethOf(sp: DerivedSpecies): Teeth {
  return sp.carnivore ? 'canine' : 'incisor';
}

export function biteSizeMm(sp: DerivedSpecies): number {
  const k = teethOf(sp) === 'canine' ? CANINE_SPACING_MM : INCISOR_WIDTH_MM;
  return Math.round(k * detPow(sp.params.bodyMassKg, 1 / 3) * 10) / 10;
}

export function necropsyFindings(carcass: Carcass, species: readonly DerivedSpecies[]): NecropsyFindings {
  const decomposition: Decomposition = carcass.daysDead === 0 ? 'fresh' : carcass.daysDead <= 2 ? 'early' : 'advanced';
  const base = { species: carcass.species, decomposition, bcs: carcass.bcs };
  const d = decodeCause(carcass.cause, species.length);
  if (d.kind === 'starvation' || d.kind === 'malnutrition' || d.kind === 'fracture' || d.kind === 'dystocia') return { ...base, kind: d.kind, bite: null, predator: -1 };
  if (d.kind === 'other' || d.kind === 'removed') return { ...base, kind: 'other', bite: null, predator: -1 };
  const pred = species[d.predator]!;
  const teeth = teethOf(pred);
  const sizeMm = biteSizeMm(pred);
  const matches = species
    .map((sp, i) => ({ sp, i }))
    .filter(({ sp }) => sp.params.diet.vertebrate > 0 && teethOf(sp) === teeth && Math.abs(biteSizeMm(sp) - sizeMm) <= BITE_MATCH_TOLERANCE * sizeMm)
    .map(({ i }) => i);
  return { ...base, kind: d.kind, bite: { teeth, sizeMm, matches }, predator: d.predator };
}
