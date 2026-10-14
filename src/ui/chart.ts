import { DAYS_PER_YEAR } from '../sim';
import { INK, PAPER, TERRAIN_COLORS, css, cssAlpha } from '../render/palette';
import type { PopulationHistory } from './history';

/** 植被：淡水彩绿的虚线，不和物种抢眼。 */
const VEG_STYLE = { color: css(TERRAIN_COLORS.shrubLush), dash: [4, 3] as number[] };
const INK_SOFT = cssAlpha(INK, 0.55);
const RULE = cssAlpha(INK, 0.08);
/** 两个物种主色相同（或都没定主色）时，后一个换虚线区分。 */
const DASHES: number[][] = [[], [6, 3], [2, 2], [10, 3, 2, 3]];

/**
 * 纵轴的两种看法：
 * - relative：每个物种按自己在图里的最高值缩放（0–100%），起伏一眼就能看出来；
 * - log：对数纵轴，田鼠几十万、白鼬几百只放在同一把尺子上比。
 */
export type ChartScale = 'relative' | 'log';

/**
 * 种群曲线：横轴是最近几年，纵轴见 ChartScale。植被单独用右侧线性刻度。
 */
export class PopulationChart {
  private readonly ctx: CanvasRenderingContext2D;
  private drawnKey = '';
  scale: ChartScale = 'relative';

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly history: PopulationHistory,
    private readonly vegMax: number,
    /** 各物种线的颜色（物种主色，见 palette.ts）；引进新物种后换掉。 */
    public colors: readonly number[],
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建 2D 画布');
    this.ctx = ctx;
  }

  draw(): void {
    const { canvas, ctx, history } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    // 只有记录或尺寸变了才重画（暂停时不白画）。
    const n0 = history.length;
    const key = `${n0}:${n0 > 0 ? history.day(n0 - 1) : -1}:${w}x${h}:${dpr}:${this.scale}:${history.labels.length}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = css(PAPER);
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = cssAlpha(INK, 0.25);
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

    const pad = { l: 44, r: 40, t: 22, b: 18 };
    const pw = w - pad.l - pad.r;
    const ph = h - pad.t - pad.b;
    const n = history.length;
    const species = history.labels.length - 1;

    // 纵轴。相对模式下每个物种各有一把尺子（自己在图里的最高值 = 100%）。
    const maxOf = Array.from({ length: species }, (_, s) => {
      let m = 0;
      for (let i = 0; i < n; i++) m = Math.max(m, history.value(s, i));
      return m;
    });
    const maxVal = Math.max(10, ...maxOf);
    const decades = Math.ceil(Math.log10(maxVal));
    const yLog = (v: number): number => pad.t + ph - (Math.log10(Math.max(1, v)) / decades) * ph;
    const yRel = (s: number) => (v: number): number => pad.t + ph - (maxOf[s]! > 0 ? v / maxOf[s]! : 0) * ph;

    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    const ticks: Array<[number, string]> =
      this.scale === 'log'
        ? Array.from({ length: decades + 1 }, (_, d) => [yLog(10 ** d), d === 0 ? '1' : `1e${d}`])
        : [0, 0.25, 0.5, 0.75, 1].map((f) => [pad.t + ph - f * ph, `${f * 100}%`]);
    for (const [y, label] of ticks) {
      ctx.strokeStyle = RULE;
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + pw, y);
      ctx.stroke();
      ctx.fillStyle = INK_SOFT;
      ctx.textAlign = 'right';
      ctx.fillText(label, pad.l - 4, y + 3);
    }

    // 横轴：最近 window 天，按年画刻度。
    const spanDays = Math.max(DAYS_PER_YEAR * 2, n);
    const lastDay = n > 0 ? history.day(n - 1) : 0;
    const firstDay = lastDay - spanDays + 1;
    const xOf = (day: number): number => pad.l + ((day - firstDay) / (spanDays - 1)) * pw;
    ctx.textAlign = 'center';
    for (let y = Math.ceil(firstDay / DAYS_PER_YEAR); y * DAYS_PER_YEAR <= lastDay; y++) {
      if (y < 0) continue;
      const x = xOf(y * DAYS_PER_YEAR);
      ctx.strokeStyle = RULE;
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + ph);
      ctx.stroke();
      ctx.fillStyle = INK_SOFT;
      ctx.fillText(`第 ${y + 1} 年`, x + 22, h - 5);
    }

    const line = (series: number, style: { color: string; dash: number[] }, y: (v: number) => number): void => {
      if (n < 2) return;
      ctx.strokeStyle = style.color;
      ctx.setLineDash(style.dash);
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const px = xOf(history.day(i));
        const py = y(history.value(series, i));
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };

    // 植被：右侧线性刻度。
    const yVeg = (v: number): number => pad.t + ph - (v / this.vegMax) * ph;
    line(species, VEG_STYLE, yVeg);
    ctx.setLineDash([]);
    ctx.fillStyle = INK_SOFT;
    ctx.textAlign = 'left';
    ctx.fillText(`${this.vegMax}`, pad.l + pw + 4, pad.t + 3);
    ctx.fillText('g/m²', pad.l + pw + 4, pad.t + 14);
    ctx.fillText('0', pad.l + pw + 4, pad.t + ph + 3);

    for (let s = 0; s < species; s++) line(s, this.style(s), this.scale === 'log' ? yLog : yRel(s));

    // 图例：名字 + 当前数量。
    ctx.setLineDash([]);
    let lx = pad.l;
    const legend = (label: string, style: { color: string; dash: number[] }): void => {
      ctx.strokeStyle = style.color;
      ctx.setLineDash(style.dash);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(lx, 10);
      ctx.lineTo(lx + 18, 10);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = css(INK);
      ctx.textAlign = 'left';
      ctx.fillText(label, lx + 22, 13);
      lx += 30 + ctx.measureText(label).width;
    };
    for (let s = 0; s < species; s++) {
      const now = n > 0 ? Math.round(history.value(s, n - 1)) : 0;
      legend(`${history.labels[s]} ${now}`, this.style(s));
    }
    legend(history.labels[species]!, VEG_STYLE);
    // 纵轴说明放在图例右边；放不下（窄屏）就放到右下角。
    const hint = this.scale === 'log' ? '对数纵轴（点图切换）' : '各自最高值 = 100%（点图切换）';
    ctx.fillStyle = INK_SOFT;
    ctx.textAlign = 'right';
    const fits = lx + ctx.measureText(hint).width < pad.l + pw;
    ctx.fillText(hint, pad.l + pw, fits ? 13 : pad.t + ph - 4);
  }

  private style(s: number): { color: string; dash: number[] } {
    const color = this.colors[s] ?? INK;
    let same = 0;
    for (let k = 0; k < s; k++) if ((this.colors[k] ?? INK) === color) same += 1;
    return { color: css(color), dash: DASHES[same % DASHES.length]! };
  }
}
