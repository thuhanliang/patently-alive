import type { Dye } from './cutout';

/**
 * 毛色（2026-11-11；11-14 搬到设计台上选）：主色、条纹、浅色（肚子、吻）三档，纸偶零件上的染色区照它上色。
 * 只是外观，不进推演。
 */
export interface Coat extends Dye {
  id: string;
  name: string;
}

export const COATS: readonly Coat[] = [
  { id: 'ochre', name: '赭', main: 0xb0805c, stripe: 0x8a5f42, pale: 0xead9bf },
  { id: 'orange', name: '橘', main: 0xd98b3f, stripe: 0xb3642a, pale: 0xf3e2c4 },
  { id: 'sand', name: '沙', main: 0xcbb084, stripe: 0xa88f66, pale: 0xf1e6cf },
  { id: 'slate', name: '灰蓝', main: 0x8493a3, stripe: 0x5f6d7c, pale: 0xdfe3e2 },
  { id: 'charcoal', name: '炭', main: 0x4f4a48, stripe: 0x2f2b2a, pale: 0xcfc6b8 },
  { id: 'snow', name: '雪', main: 0xefe8da, stripe: 0xcfc4ad, pale: 0xfbf7ee },
];

/** 从哪条现有技术开始，就先给它那种动物常见的毛色（之后随便换）。 */
const TEMPLATE_COAT: Record<string, string> = {
  cat: 'orange',
  fox: 'orange',
  rabbit: 'sand',
  mongoose: 'sand',
  rat: 'slate',
  brownrat: 'ochre',
  kiore: 'ochre',
  mouse: 'slate',
  vole: 'ochre',
  possum: 'charcoal',
  stoat: 'ochre',
  weasel: 'ochre',
  ferret: 'sand',
};

export function coatFor(template: string): Coat {
  return COATS.find((c) => c.id === TEMPLATE_COAT[template]) ?? COATS[0]!;
}

export function coatById(id: string | undefined): Coat {
  return COATS.find((c) => c.id === id) ?? COATS[0]!;
}
