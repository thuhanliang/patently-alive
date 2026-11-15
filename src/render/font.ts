/**
 * 界面和画布上的字（2026-11-14）：霞鹜文楷屏幕阅读版（OFL，随游戏打包，不联网取）。
 * 网页字体按字符分了很多小文件，用到才载入；画布上的字（Pixi 的 Text）不会自己去载，
 * 所以往画布上写字以前先 warm 一下要写的那些字，载好了再画（没载好之前先用系统字体顶着）。
 */
export const HAND = '"LXGW WenKai Screen", "Kaiti SC", "STKaiti", "KaiTi", Georgia, "Songti SC", serif';

const warmed = new Set<string>();

/** 让浏览器把 text 里的字载进来。返回的 Promise 在载好（或失败）后结束。 */
export function warm(text: string): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
  const fresh = [...text].filter((ch) => !warmed.has(ch));
  if (fresh.length === 0) return Promise.resolve();
  for (const ch of fresh) warmed.add(ch);
  return document.fonts.load(`16px ${HAND}`, fresh.join('')).then(
    () => undefined,
    () => undefined,
  );
}

/** 画布上常写的字：数字、单位、常见的说法。开场时先载。 */
export const COMMON_GLYPHS = '0123456789.,·:：()（）+-−×→ 千克厘米毫吨只生了死老病饿被吃掉窝端营养不良骨折难产移走一天要这座岛上植物肉虫体重分配脂肪骼肌消化道心血管冷多家猫欧洲兔虎狮象鼠马牛羊狗狐狼熊鹿猪';
