import type { Alert } from '../sim';
import { alertKey, alertText } from './alertText';

/** 日志里留几行。 */
const LOG_LINES = 6;

/**
 * 朱红警报：同一时间只显示最响的一条（横幅），点横幅把镜头移到出事的地方；
 * 最响的那条换了（或解除了）就在下面的日志里记一行。可以每帧调用。
 */
export class AlertBanner {
  private key = '';
  private top: Alert | undefined;
  private readonly banner = document.createElement('button');
  private readonly log = document.createElement('div');
  private readonly lines: string[] = [];

  constructor(
    el: HTMLElement,
    /** 物种名，按物种下标排；引进新物种后换掉。 */
    public names: readonly string[],
    onLocate: (at: { x: number; y: number }) => void,
  ) {
    this.banner.className = 'alert-banner';
    this.banner.addEventListener('click', () => {
      if (this.top?.at) onLocate(this.top.at);
    });
    this.log.className = 'alert-log';
    el.append(this.banner, this.log);
    this.render();
  }

  reset(): void {
    this.key = '';
    this.top = undefined;
    this.lines.length = 0;
    this.rendered = '\u0000';
    this.render();
  }

  /** 传入引擎排好序的警报（最响的在前）。 */
  update(day: number, alerts: readonly Alert[]): void {
    const top = alerts[0];
    const key = alertKey(top);
    if (key !== this.key) {
      const before = this.top;
      this.lines.unshift(top ? `第 ${day} 天　${alertText(top, this.names)}` : `第 ${day} 天　警报解除${before ? `（${alertText(before, this.names)}）` : ''}`);
      this.lines.length = Math.min(this.lines.length, LOG_LINES);
      this.key = key;
    }
    this.top = top;
    this.render();
  }

  private rendered = '';

  private render(): void {
    const top = this.top;
    // 每帧都会调用；内容没变就不碰 DOM。
    const sig = `${alertKey(top)}|${top ? alertText(top, this.names) : ''}|${this.lines.length}|${this.lines[0] ?? ''}`;
    if (sig === this.rendered) return;
    this.rendered = sig;
    this.banner.style.display = top ? '' : 'none';
    this.banner.textContent = top ? `⚠ ${alertText(top, this.names)}${top.at ? '　［点击查看］' : ''}` : '';
    this.banner.style.cursor = top?.at ? 'pointer' : 'default';
    this.log.textContent = this.lines.join('\n');
    this.log.style.display = this.lines.length > 0 ? '' : 'none';
  }
}
