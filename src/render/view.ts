/** 画面能调的俯仰、旋转（剪纸画面 PaperView 给出，镜头卡片用）。 */
export interface ViewAngles {
  /** 俯仰、旋转的上限（弧度）；旋转是正负这么多。 */
  pitchLimit: number;
  yawLimit: number;
  /** 默认的俯仰：拉远俯视、拉近斜看。 */
  autoTilt: (zoom: number) => number;
}
