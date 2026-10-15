import { z } from 'zod';

/**
 * 尸检报告的模板（临床口吻）。引擎给出证据（src/sim/necropsy.ts），界面按这里的句子拼报告，不用 AI（铁律 6）。
 * 句子里的 {名字} 是占位符，能用哪些见 src/ui/necropsyReport.ts。
 */
const text = z.string().min(1);

export const NecropsyTemplatesSchema = z.object({
  title: text,
  /** 报告四节的标题。 */
  headings: z.object({ intro: text, appearance: text, findings: text, conclusion: text }),
  intro: text,
  /** 死了多久：当天死的、死了 {n} 天的。 */
  days: z.object({ today: text, ago: text }),
  /** 送检的是什么：一具尸体，或巢里的蛋壳、幼崽残骸。 */
  subject: z.object({ carcass: text, nestEgg: text, nestYoung: text }),
  decomposition: z.object({ fresh: text, early: text, advanced: text }),
  /** 蛋壳和残巢的"腐败程度"。 */
  decompositionNest: z.object({ fresh: text, early: text, advanced: text }),
  condition: z.object({ thin: text, normal: text, good: text }),
  findings: z.object({
    starvation: text,
    other: text,
    malnutrition: text,
    fracture: text,
    dystocia: text,
    predation_canine: text,
    predation_incisor: text,
    nest_canine: text,
    nest_incisor: text,
  }),
  remains: z.object({ egg: text, young: text }),
  conclusion: z.object({ starvation: text, other: text, malnutrition: text, fracture: text, dystocia: text, predation: text, nest: text }),
  teeth: z.object({ canine: text, incisor: text }),
  sizeMatch: text,
  sizeMatchNone: text,
  listSeparator: text,
});

export type NecropsyTemplates = z.infer<typeof NecropsyTemplatesSchema>;
