import { DAYS_PER_YEAR } from '../sim';
import type { PopulationHistory } from './history';

/** 每条线的灰度和虚线样式：灰盒阶段只用灰色，靠线型区分。 */
const STYLES: Array<{ color: string; dash: number[] }> = [
  { color: '#e8e8e8', dash: [] },
  { color: '#a8a8a8', dash: [6, 3] },
  { color: '#7a7a7a', dash: [2, 2] },
  { color: '#cfcfcf', dash: [10, 3, 2, 3] },
];
const VEG_STYLE = { color: '#666666', dash: [] as number[] };

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
    const key = `${n0}:${n0 > 0 ? history.day(n0 - 1) : -1}:${w}x${h}:${dpr}:${this.scale}`;
    if (key === this.drawnKey) return;
    this.drawnKey = key;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, w, h);

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

    ctx.font = '10px ui-monospace, monospace';
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    const ticks: Array<[number, string]> =
      this.scale === 'log'
        ? Array.from({ length: decades + 1 }, (_, d) => [yLog(10 ** d), d === 0 ? '1' : `1e${d}`])
        : [0, 0.25, 0.5, 0.75, 1].map((f) => [pad.t + ph - f * ph, `${f * 100}%`]);
    for (const [y, label] of ticks) {
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(pad.l + pw, y);
      ctx.stroke();
      ctx.fillStyle = '#888';
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
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, pad.t + ph);
      ctx.stroke();
      ctx.fillStyle = '#888';
      ctx.fillText(`第 ${y + 1} 年`, x + 22, h - 5);
    }

    const line = (series: number, style: { color: string; dash: number[] }, y: (v: number) => number): void => {
      if (n < 2) return;
      ctx.strokeStyle = style.color;
      ctx.setLineDash(style.dash);
      ctx.lineWidth = 1.5;
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
    ctx.fillStyle = '#666';
    ctx.textAlign = 'left';
    ctx.fillText(`${this.vegMax}`, pad.l + pw + 4, pad.t + 3);
    ctx.fillText('g/m²', pad.l + pw + 4, pad.t + 14);
    ctx.fillText('0', pad.l + pw + 4, pad.t + ph + 3);

    for (let s = 0; s < species; s++) line(s, STYLES[s % STYLES.length]!, this.scale === 'log' ? yLog : yRel(s));

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
      ctx.fillStyle = '#ccc';
      ctx.textAlign = 'left';
      ctx.fillText(label, lx + 22, 13);
      lx += 30 + ctx.measureText(label).width;
    };
    for (let s = 0; s < species; s++) {
      const now = n > 0 ? Math.round(history.value(s, n - 1)) : 0;
      legend(`${history.labels[s]} ${now}`, STYLES[s % STYLES.length]!);
    }
    legend(history.labels[species]!, VEG_STYLE);
    // 纵轴说明放在图例右边；放不下（窄屏）就放到右下角。
    const hint = this.scale === 'log' ? '对数纵轴（点图切换）' : '各自最高值 = 100%（点图切换）';
    ctx.fillStyle = '#777';
    ctx.textAlign = 'right';
    const fits = lx + ctx.measureText(hint).width < pad.l + pw;
    ctx.fillText(hint, pad.l + pw, fits ? 13 : pad.t + ph - 4);
  }
}
