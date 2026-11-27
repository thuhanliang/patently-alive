import { z } from 'zod';

/**
 * 纸偶的形状参数（docs/research/body-params.md 第三节）：一套参数，人人共用；只决定画面，推演不读（铁律 5：以后要升级进推演，一次一个，写进 MODEL.md）。
 * 类型：
 * - L：以 2 为底的对数偏离（0 = 同体重、同大类的一般样子；1 = 两倍；−1 = 一半）；
 * - U：0–1 的程度；P：沿一条路径的位置（0–1）；N：离散的数。
 * 每个参数的两端各对得上一种真实动物（low、high），范围按真实的极端定。
 */
export const FormParamSchema = z.strictObject({
  id: z.string().regex(/^[a-z]+\.[a-zA-Z]+$/),
  name: z.string(),
  region: z.enum(['body', 'neck', 'head', 'snout', 'leg', 'horn']),
  kind: z.enum(['L', 'U', 'P', 'N']),
  min: z.number(),
  max: z.number(),
  /** 不写时的值（一般的样子）。 */
  default: z.number(),
  /** 两端的真实动物。 */
  low: z.string(),
  high: z.string(),
  /** 依据（形态学的数值出处；凭印象的标【未核对】）。 */
  source: z.string(),
});
export type FormParam = z.infer<typeof FormParamSchema>;

export const FormFileSchema = z
  .strictObject({ 说明: z.string(), params: z.array(FormParamSchema) })
  .superRefine((f, ctx) => {
    const ids = new Set<string>();
    for (const p of f.params) {
      if (ids.has(p.id)) ctx.addIssue({ code: 'custom', message: `形状参数重复：${p.id}` });
      ids.add(p.id);
      if (!(p.min <= p.default && p.default <= p.max)) ctx.addIssue({ code: 'custom', message: `${p.id} 的默认值不在范围里` });
      if (p.kind === 'N' && !Number.isInteger(p.default)) ctx.addIssue({ code: 'custom', message: `${p.id} 是离散的，默认值要是整数` });
    }
  });
