import { z } from 'zod';

/**
 * 自然档案馆的一条现有技术：一种真实动物。
 * 推演用的数值在 species/ 里同名的物种文件（每条现有技术都必须能推演）；这里只写档案信息：分类、产地、知识卡。
 * 知识卡是开发时从公开资料改写的真实知识，带出处（运行时不联网，铁律 6）。
 */
export const ArchiveEntrySchema = z.object({
  /** 对应的物种 id（species/<id>.json）。 */
  species: z.string(),
  taxonomy: z.object({
    /** 纲，例如"哺乳纲""鸟纲"。 */
    class: z.string(),
    /** 目。 */
    order: z.string(),
    /** 科。 */
    family: z.string(),
  }),
  /** 原产地，以及被人带到过哪里。 */
  range: z.string(),
  /** 知识卡：几句真实知识。 */
  card: z.array(z.string()).min(1).max(4),
  /** 知识卡的出处。 */
  cardSource: z.string(),
});

export type ArchiveEntry = z.infer<typeof ArchiveEntrySchema>;
