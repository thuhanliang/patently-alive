/**
 * 声音（2026-11-15）：纸的声音、铆钉的"咔"、盖章、翻信，岛上的海浪和鸟叫。
 * 全部用 Web Audio 现场合成（噪声加滤波、几个正弦），不带音频文件，也不联网取。
 * 浏览器要等用户第一次点了什么才让出声，所以第一次点击时才真正打开。只是表达层，不影响任何结果。
 */

export type Sfx = 'tap' | 'paper' | 'flip' | 'stamp' | 'brad' | 'pop' | 'sigh' | 'chime' | 'drop';

const MUTE_KEY = 'patently-alive-mute';

class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private amb: { gain: GainNode; timer: number } | null = null;
  private wantAmbience = false;
  private last = new Map<Sfx, number>();
  muted = false;

  constructor() {
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      // 读不到就当没关。
    }
    if (typeof window !== 'undefined') {
      const open = (): void => this.open();
      window.addEventListener('pointerdown', open, { once: true, capture: true });
      window.addEventListener('keydown', open, { once: true, capture: true });
    }
  }

  private open(): void {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    // 两秒白噪声，所有纸的声音都从它上面截。
    const n = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    if (this.wantAmbience) this.startAmbience();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      localStorage.setItem(MUTE_KEY, m ? '1' : '0');
    } catch {
      // 记不住就算了。
    }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  /** 一段噪声：过一个滤波器，按 env 的音量走。env 是 [时刻（秒）, 音量] 的折线。 */
  private hiss(type: BiquadFilterType, f0: number, f1: number, q: number, env: Array<[number, number]>, at = 0): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    const end = env.at(-1)![0];
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (const [dt, v] of env) g.gain.linearRampToValueAtTime(v, t + dt);
    src.connect(filt).connect(g).connect(master);
    src.start(t, Math.random() * 1.5, end + 0.05);
  }

  /** 一个音：频率从 f0 滑到 f1，按 env 的音量走。 */
  private tone(wave: OscillatorType, f0: number, f1: number, env: Array<[number, number]>, at = 0): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t = ctx.currentTime + at;
    const end = env.at(-1)![0];
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + end);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (const [dt, v] of env) g.gain.linearRampToValueAtTime(v, t + dt);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + end + 0.05);
  }

  play(name: Sfx): void {
    if (!this.ctx || this.muted) return;
    // 同一种声音挨得太近就不重复放（岛上一下子很多事的时候）。
    const now = performance.now();
    const gap = name === 'pop' || name === 'sigh' ? 350 : 40;
    if (now - (this.last.get(name) ?? -1e9) < gap) return;
    this.last.set(name, now);
    switch (name) {
      case 'tap': // 指头点在纸上
        this.hiss('bandpass', 2600, 1400, 1.2, [[0.004, 0.22], [0.05, 0]]);
        this.tone('sine', 520, 300, [[0.004, 0.05], [0.05, 0]]);
        break;
      case 'paper': // 一张纸挪了一下
        this.hiss('bandpass', 3200, 5200, 0.8, [[0.02, 0.12], [0.07, 0.03], [0.1, 0.1], [0.2, 0]]);
        break;
      case 'flip': // 翻开一封信
        this.hiss('highpass', 1500, 3800, 0.6, [[0.03, 0.16], [0.12, 0.06], [0.16, 0.14], [0.34, 0]]);
        this.hiss('lowpass', 500, 220, 0.7, [[0.01, 0.1], [0.12, 0]], 0.3);
        break;
      case 'drop': // 放下一样东西
        this.tone('sine', 180, 90, [[0.005, 0.22], [0.14, 0]]);
        this.hiss('lowpass', 900, 300, 0.7, [[0.005, 0.14], [0.1, 0]]);
        break;
      case 'brad': // 铆钉扣上："咔哒"
        this.tone('triangle', 2100, 1500, [[0.002, 0.16], [0.02, 0]]);
        this.tone('triangle', 1250, 900, [[0.002, 0.2], [0.035, 0]], 0.045);
        this.hiss('bandpass', 4200, 3000, 2, [[0.002, 0.12], [0.03, 0]], 0.045);
        break;
      case 'stamp': // 盖章：闷的一下
        this.tone('sine', 130, 55, [[0.006, 0.5], [0.2, 0]]);
        this.hiss('lowpass', 700, 180, 0.8, [[0.006, 0.3], [0.16, 0]]);
        this.hiss('bandpass', 3000, 2000, 1, [[0.01, 0.06], [0.08, 0]], 0.2);
        break;
      case 'pop': // 生了
        this.tone('sine', 560, 840, [[0.01, 0.07], [0.12, 0]]);
        break;
      case 'sigh': // 没了
        this.tone('sine', 300, 196, [[0.03, 0.05], [0.4, 0]]);
        break;
      case 'chime': // 办成了：木琴似的三个音
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          this.tone('sine', f, f, [[0.005, 0.16], [0.5, 0]], i * 0.13);
          this.tone('sine', f * 4, f * 4, [[0.003, 0.03], [0.08, 0]], i * 0.13);
        });
        break;
    }
  }

  /** 岛上的环境声：远处的海浪（很慢地起伏的低噪声）、偶尔几声鸟叫。 */
  ambience(on: boolean): void {
    this.wantAmbience = on;
    if (on) this.startAmbience();
    else if (this.amb && this.ctx) {
      this.amb.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      window.clearTimeout(this.amb.timer);
      this.amb = null;
    }
  }

  private startAmbience(): void {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise || this.amb) return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, ctx.currentTime, 1.5);
    gain.connect(master);
    // 海浪：低通过的噪声，音量被两个很慢的正弦推着起伏。
    const sea = ctx.createBufferSource();
    sea.buffer = noise;
    sea.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const swell = ctx.createGain();
    swell.gain.value = 0.05;
    for (const [hz, depth] of [[0.11, 0.035], [0.07, 0.02]] as const) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = hz;
      const d = ctx.createGain();
      d.gain.value = depth;
      lfo.connect(d).connect(swell.gain);
      lfo.start();
    }
    sea.connect(lp).connect(swell).connect(gain);
    sea.start();
    // 鸟叫：隔几秒两三个上扬的短音。
    const chirp = (): void => {
      if (!this.amb || !this.ctx) return;
      const t0 = this.ctx.currentTime;
      const base = 2300 + Math.random() * 1500;
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        const t = t0 + i * (0.09 + Math.random() * 0.05);
        o.frequency.setValueAtTime(base * (0.9 + Math.random() * 0.2), t);
        o.frequency.exponentialRampToValueAtTime(base * (1.15 + Math.random() * 0.3), t + 0.06);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.018 + Math.random() * 0.012, t + 0.015);
        g.gain.linearRampToValueAtTime(0, t + 0.075);
        o.connect(g).connect(gain);
        o.start(t);
        o.stop(t + 0.1);
      }
      this.amb.timer = window.setTimeout(chirp, 2500 + Math.random() * 7000);
    };
    this.amb = { gain, timer: window.setTimeout(chirp, 1500) };
  }
}

/** 整个页面共用的一份。 */
export const sound = new Sound();

/** 点任何按钮都有一声轻轻的"嗒"。 */
export function bindButtonTaps(root: Document = document): void {
  root.addEventListener(
    'click',
    (e) => {
      if ((e.target as HTMLElement | null)?.closest?.('button, .envelope, .patent.small, summary')) sound.play('tap');
    },
    true,
  );
}

/** 一颗开关声音的小纸钮。 */
export function muteButton(): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'mute';
  const draw = (): void => {
    b.textContent = sound.muted ? '静音' : '有声';
    b.title = sound.muted ? '现在没有声音，点一下打开' : '点一下关掉声音';
    b.classList.toggle('off', sound.muted);
  };
  b.addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    draw();
  });
  draw();
  return b;
}
