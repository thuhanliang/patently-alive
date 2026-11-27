import { z } from 'zod';

/** 植物在岛上长的地带（docs/research/flora.md 第二节）。 */
export const FLORA_ZONES = ['dune', 'coastRock', 'coastScrub', 'grassland', 'wetland', 'gully', 'coastForest', 'subantarctic'] as const;
export const FLORA_FORMS = ['fan', 'pompom', 'canopy', 'fineShrub', 'broadShrub', 'tussock', 'sedge', 'spinifex', 'bracken', 'treeFern', 'palm', 'vineMat', 'reed', 'gorse', 'pasture', 'megaherb'] as const;
const Hex = z.string().regex(/^#[0-9a-f]{6}$/);
const Month = z.number().int().min(0).max(11);

/** 植物图鉴的一种（src/data/plants/flora.json）：只决定画面。 */
export const FloraSpeciesSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9]*$/),
  name: z.string(),
  maori: z.string(),
  latin: z.string(),
  zone: z.array(z.enum(FLORA_ZONES)).min(1),
  /** 演替里的位置：先锋、早期、晚期。 */
  stage: z.enum(['pioneer', 'early', 'late']),
  introduced: z.boolean().optional(),
  look: z.strictObject({
    form: z.enum(FLORA_FORMS),
    height: z.number().positive().max(40),
    aspect: z.number().positive(),
    leaf: Hex,
    leafDark: Hex,
    stem: Hex,
    flower: Hex.optional(),
    fruit: Hex.optional(),
    density: z.number().min(0).max(1).optional(),
  }),
  /** 游戏的月份（0 = 春季第一个月 = 南半球 9 月）。 */
  flowerMonths: z.array(Month),
  fruitMonths: z.array(Month),
  source: z.string().min(1),
});
export type FloraSpecies = z.infer<typeof FloraSpeciesSchema>;

export const FloraFileSchema = z.strictObject({ 说明: z.string(), species: z.array(FloraSpeciesSchema) }).superRefine((f, ctx) => {
  const ids = new Set<string>();
  for (const s of f.species) {
    if (ids.has(s.id)) ctx.addIssue({ code: 'custom', message: `植物 id 重复：${s.id}` });
    ids.add(s.id);
  }
});
