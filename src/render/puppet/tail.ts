import { G } from './gait';

/**
 * 尾巴的动力学（纯函数 + 一点状态，不碰 PixiJS，可以单测）。单位米、弧度，y 朝上。
 *
 * 尾巴是一串刚性的节（n 节摆，拉格朗日方程按节的绝对角度写），关节是阻尼的扭转弹簧：
 * - 姿态给出"想要的"尾巴：每节的绝对方向 D_i（身体的角度 + pose.tail + 画好的弯）；
 * - 弹簧把每个关节的相对角拉向"想要的"相对角（尾根这一节拉向 D_0，挂在身体上）；
 * - 每节的质量 ∝ 粗² × 长，集中在节的中点（再加一根杆自己的转动惯量）：粗尾根稳、细尾尖甩得开；
 * - 尾根跟着身体动：尾根的线加速度变成每一节的惯性力；身体一抬、一停，外侧跟不上，一节晚一节传到尾尖；
 * - 重力：肌肉按"想要的"形状预先把重力抵消掉（所以静止时尾巴正好是画的样子），只有偏离了才多出重力矩。
 * 关节 i 的固有角频率 = stiffness × √(g ÷ 外侧长度)：同样的形状，大动物的尾巴晃得慢（动力相似）。
 *
 * 每帧只拿到姿态：尾根在一帧里按直线匀速走，两帧之间速度的变化 Δv 当成一次冲量加给尾巴（M·Δφ̇ = −J^T·m·Δv，
 * 对折线运动是准的），所以不用把位置差两次求加速度，帧率不同结果也接近；D 在一帧里线性插值。
 * 一帧里尾根的速度变得太多（瞬移、拖滑块）或者掉帧（dt 很大）就当成重新开始。按 1/240 秒切小步积分，没有随机数。
 */

export interface TailOptions {
  /** 固有角频率的系数（gait.json 的 tail.stiffness）。 */
  stiffness: number;
  /** 阻尼比。 */
  damping: number;
}

/** 每节偏离"想要的"方向最多这么多（弧度）。 */
const MAX_DEV = 1.4;
/** 一帧里尾根的速度最多变这么多（米/秒）：再大当成瞬移，重新开始。 */
const MAX_DV = 3;
/** 一帧超过这么长就当成"重新开始"：不算这一帧的惯性。 */
const MAX_DT = 0.08;
const SUBSTEP = 1 / 240;

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** 解 n × n 的线性方程组（高斯消元，选主元）。n 很小（≤ 6）。 */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    [b[c], b[p]] = [b[p]!, b[c]!];
    for (let r = c + 1; r < n; r++) {
      const f = A[r]![c]! / A[c]![c]!;
      for (let k = c; k < n; k++) A[r]![k] = A[r]![k]! - f * A[c]![k]!;
      b[r] = b[r]! - f * b[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let k = r + 1; k < n; k++) s -= A[r]![k]! * x[k]!;
    x[r] = s / A[r]![r]!;
  }
  return x;
}

export class TailChain {
  /** 每个关节的相对角比"想要的"多转了多少（尾根那个关节相对身体）。累加起来就是每节绝对方向的偏差。 */
  readonly dev: number[];
  private phi: number[];
  private dphi: number[];
  private readonly mass: number[];
  private readonly inertia: number[];
  /** a[i][j]：节 i、j 的耦合系数（∑ 质量 × 力臂 × 力臂），乘 cos(φi − φj) 就是质量矩阵。 */
  private readonly a: number[][];
  /** 节 i 对节 k 质心的力臂：k > i 时是 l_i，k = i 时是 l_i / 2。 */
  private readonly lever: number[][];
  private readonly k: number[];
  private readonly c: number[];
  private lastRoot: [number, number] | null = null;
  private lastDirs: number[] | null = null;
  private rootVel: [number, number] | null = null;

  /** lens、widths：每节的长度和粗细（米）。 */
  constructor(
    readonly lens: readonly number[],
    widths: readonly number[],
    readonly opts: TailOptions,
  ) {
    const n = lens.length;
    this.dev = new Array<number>(n).fill(0);
    this.phi = new Array<number>(n).fill(0);
    this.dphi = new Array<number>(n).fill(0);
    this.mass = lens.map((l, i) => Math.max(1e-9, widths[i]! * widths[i]! * l));
    this.inertia = lens.map((l, i) => (this.mass[i]! * l * l) / 12);
    this.lever = lens.map((l, i) => lens.map((_, k) => (k > i ? l : k === i ? l / 2 : 0)));
    this.a = lens.map((_, i) => lens.map((_, j) => lens.reduce((s, _, k) => s + this.mass[k]! * this.lever[i]![k]! * this.lever[j]![k]!, 0)));
    // 弹簧：按外侧那一截（尾巴伸直时）绕关节的转动惯量定刚度，让固有频率 = stiffness × √(g / 外侧长度)。
    this.k = [];
    this.c = [];
    for (let i = 0; i < n; i++) {
      let out = 0;
      let I = 0;
      let r = 0;
      for (let j = i; j < n; j++) {
        I += this.mass[j]! * (r + lens[j]! / 2) ** 2 + this.inertia[j]!;
        r += lens[j]!;
        out += lens[j]!;
      }
      const w = opts.stiffness * Math.sqrt(G / Math.max(1e-3, out));
      this.k.push(I * w * w);
      this.c.push(2 * opts.damping * I * w);
    }
  }

  /** 姿态跳变（换身体、拖滑块）以后：回到"想要的"形状，下一帧不算惯性。 */
  reset(): void {
    this.lastRoot = null;
    this.lastDirs = null;
    this.rootVel = null;
  }

  /**
   * 走一帧。root：尾根的位置；dirs：每节"想要的"绝对方向；idle：加在尾根和中段关节上的慢摆目标（弧度，
   * 由调用的人按时间算）。返回每个关节的偏差（同 dev）。
   */
  step(dt: number, root: readonly [number, number], dirs: readonly number[], idle = 0): readonly number[] {
    const n = this.lens.length;
    if (n === 0) return this.dev;
    if (!this.lastRoot || !this.lastDirs || dt > MAX_DT || dt <= 0) {
      // 重新开始：就是"想要的"形状，不动。
      this.phi = dirs.slice();
      this.dphi.fill(0);
      this.rootVel = null;
      this.lastRoot = [root[0], root[1]];
      this.lastDirs = dirs.slice();
      this.updateDev(dirs);
      return this.dev;
    }
    const phi = this.phi;
    const dphi = this.dphi;
    // 尾根这一帧的速度；和上一帧的差是一次冲量：尾巴的每一节按惯性"留在原地"，角速度跟着变。
    const v: [number, number] = [(root[0] - this.lastRoot[0]) / dt, (root[1] - this.lastRoot[1]) / dt];
    if (this.rootVel) {
      const dv = [v[0] - this.rootVel[0], v[1] - this.rootVel[1]] as const;
      if (Math.hypot(dv[0], dv[1]) > MAX_DV) {
        this.rootVel = null;
        this.lastRoot = null;
        return this.step(dt, root, dirs, idle);
      }
      const A = this.massMatrix();
      const b = this.lens.map((_, i) => {
        let sumM = 0;
        for (let k = 0; k < n; k++) sumM += this.mass[k]! * this.lever[i]![k]!;
        return -sumM * (-Math.sin(phi[i]!) * dv[0] + Math.cos(phi[i]!) * dv[1]);
      });
      const kick = solve(A, b);
      for (let i = 0; i < n; i++) dphi[i] = dphi[i]! + kick[i]!;
    }
    this.rootVel = v;
    const from = this.lastDirs;
    const dD = dirs.map((d, i) => wrap(d - from[i]!));
    this.lastRoot = [root[0], root[1]];
    this.lastDirs = dirs.slice();

    const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / steps;
    // 一帧里尾根匀速，只剩重力：每节质心受 m·g，g = (0, −G)。
    const mid = Math.floor(n / 2);
    for (let s = 1; s <= steps; s++) {
      const D = from.map((d, i) => d + dD[i]! * (s / steps));
      const dDdt = dD.map((x) => x / dt);
      // 弹簧、阻尼用隐式（向后欧拉）：(M + h·C + h²·K)·φ̈ = F − h·K·(φ̇ − Ḋ)。尾尖很轻、关节很硬，显式积分会炸。
      const A = this.massMatrix();
      const b: number[] = [];
      // 关节 j 的相对角（减去"想要的"和慢摆目标）、相对角速度。
      const rel: number[] = [];
      const drel: number[] = [];
      for (let j = 0; j < n; j++) {
        rel.push((j === 0 ? phi[0]! - D[0]! : phi[j]! - phi[j - 1]! - (D[j]! - D[j - 1]!)) - (j === 0 || j === mid ? idle : 0));
        drel.push(j === 0 ? dphi[0]! - dDdt[0]! : dphi[j]! - dphi[j - 1]! - (dDdt[j]! - dDdt[j - 1]!));
      }
      // 关节 j 连着节 j − 1 和节 j：力矩正着作用在节 j 上、反着作用在节 j − 1 上。
      const joint = (j: number): number => (j < n ? -this.k[j]! * (rel[j]! + h * drel[j]!) - this.c[j]! * drel[j]! : 0);
      for (let i = 0; i < n; i++) {
        let q = 0;
        for (let j = 0; j < n; j++) q -= this.a[i]![j]! * Math.sin(phi[i]! - phi[j]!) * dphi[j]! * dphi[j]!;
        // 重力的广义力：∑ 质量 × 力臂 × (−sin φ, cos φ)·(0, −G)；减去"想要的"形状下的那一份（肌肉预先抵消）。
        let sumM = 0;
        for (let k = 0; k < n; k++) sumM += this.mass[k]! * this.lever[i]![k]!;
        q += sumM * -G * (Math.cos(phi[i]!) - Math.cos(D[i]!));
        q += joint(i) - joint(i + 1);
        b.push(q);
        // 弹簧、阻尼对 φ̈ 的刚度：K_φ = Tᵀ·diag(k)·T（T 把绝对角变成相对角）。
        const kc = (j: number): number => (j < n ? h * this.c[j]! + h * h * this.k[j]! : 0);
        A[i]![i] = A[i]![i]! + kc(i) + kc(i + 1);
        if (i + 1 < n) {
          A[i]![i + 1] = A[i]![i + 1]! - kc(i + 1);
          A[i + 1]![i] = A[i + 1]![i]! - kc(i + 1);
        }
      }
      const dd = solve(A, b);
      for (let i = 0; i < n; i++) dphi[i] = dphi[i]! + dd[i]! * h;
      for (let i = 0; i < n; i++) {
        phi[i] = phi[i]! + dphi[i]! * h;
        // 偏得太远（不该发生）就夹回去，速度清零。
        const off = wrap(phi[i]! - D[i]!);
        if (Math.abs(off) > MAX_DEV) {
          phi[i] = D[i]! + clamp(off, -MAX_DEV, MAX_DEV);
          dphi[i] = dDdt[i]!;
        }
      }
    }
    this.updateDev(dirs);
    return this.dev;
  }

  /** 外面把第 i 节（和它外侧的节）又转了 d（例如尾巴碰到地面被抬起来）：记进状态，转向地里的速度清零。 */
  push(i: number, d: number): void {
    if (i < 0 || i >= this.phi.length || d === 0 || !this.lastDirs) return;
    for (let j = i; j < this.phi.length; j++) {
      this.phi[j] = this.phi[j]! + d;
      if (Math.sign(this.dphi[j]!) !== Math.sign(d)) this.dphi[j] = 0;
    }
    this.updateDev(this.lastDirs);
  }

  /** 质量矩阵：a[i][j]·cos(φi − φj)，对角线再加每节自己的转动惯量。 */
  private massMatrix(): number[][] {
    const phi = this.phi;
    return this.lens.map((_, i) => this.lens.map((_, j) => this.a[i]![j]! * Math.cos(phi[i]! - phi[j]!) + (i === j ? this.inertia[i]! : 0)));
  }

  private updateDev(dirs: readonly number[]): void {
    let prev = 0;
    for (let i = 0; i < this.phi.length; i++) {
      const off = wrap(this.phi[i]! - dirs[i]!);
      this.dev[i] = off - prev;
      prev = off;
    }
  }
}

/** 站着时尾巴自己慢慢摆的目标（弧度）：一阵一阵的，频率按尾长（单摆的几分之一），确定的。 */
export function idleSwish(time: number, tailLenM: number, amp: number): number {
  const w = 0.3 * Math.sqrt(G / Math.max(0.02, tailLenM));
  const gust = Math.max(0, Math.sin(time * 0.29) * Math.sin(time * 0.11 + 1));
  return amp * gust * Math.sin(time * w);
}
