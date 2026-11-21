import { MathUtils, Plane, Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';

/**
 * 看纸雕岛的镜头（2026-11-22）：手感照桌上一件模型来做。
 * - 拖：抓住地面上按下的那一点，松手时带一点惯性滑开（像推一张纸）。
 * - 滚轮 / 双指捏：朝指着的那一点推近拉远；越近镜头越低（随缩放倾斜，美术规定）。
 * - 右键拖 / 双指转：转（±45°）、调俯仰（0–60°，从正上方算）。
 * 所有目标值都平滑地追过去，不会一下跳到位。
 */
export class MapCamera {
  /** 看的点（地面上）、离多远、转角、俯仰在自动值上加的量。 */
  private target = new Vector3();
  private dist = 70;
  private yaw = 0;
  private tiltAdd = 0;
  private goal = { x: 0, z: 0, dist: 70, yaw: 0, tiltAdd: 0 };
  private vel = new Vector2();
  private readonly ray = new Raycaster();
  private readonly ground = new Plane(new Vector3(0, 1, 0), -0.6);
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private grab: Vector3 | null = null;
  private lastMove = 0;
  private pinch: { d: number; a: number; my: number } | null = null;
  private rotating = false;
  /** 外部可读：镜头离地多远的 0（最远）–1（最近），和当前从水平算的仰角（弧度）。 */
  near = 0;
  elevation = 1;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly el: HTMLElement,
    private readonly bounds: { r: number; minDist: number; maxDist: number },
  ) {
    this.goal.dist = this.dist = bounds.maxDist * 0.62;
    el.style.cursor = 'grab';
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', this.down);
    el.addEventListener('pointermove', this.move);
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.apply(0);
  }

  /** 自动的俯仰：远时 22°（接近俯视），近时 58°（从正上方算）。 */
  private tilt(): number {
    const t = MathUtils.clamp((this.bounds.maxDist - this.dist) / (this.bounds.maxDist - this.bounds.minDist), 0, 1);
    this.near = t;
    return MathUtils.clamp(22 + Math.pow(t, 1.4) * 36 + this.tiltAdd, 2, 60);
  }

  private ndc(x: number, y: number): Vector2 {
    const r = this.el.getBoundingClientRect();
    return new Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  }

  private hit(x: number, y: number): Vector3 | null {
    this.ray.setFromCamera(this.ndc(x, y), this.camera);
    const p = new Vector3();
    return this.ray.ray.intersectPlane(this.ground, p) ? p : null;
  }

  private readonly down = (e: PointerEvent): void => {
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.vel.set(0, 0);
    if (this.pointers.size === 2) {
      this.grab = null;
      this.pinch = this.pinchState();
    } else if (e.button === 2 || e.shiftKey) {
      this.rotating = true;
    } else {
      this.grab = this.hit(e.clientX, e.clientY);
      this.el.style.cursor = 'grabbing';
    }
    this.lastMove = performance.now();
  };

  private pinchState(): { d: number; a: number; my: number } {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), a: Math.atan2(b!.y - a!.y, b!.x - a!.x), my: (a!.y + b!.y) / 2 };
  }

  private readonly move = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pinch && this.pointers.size === 2) {
      const now = this.pinchState();
      this.goal.dist = MathUtils.clamp((this.goal.dist * this.pinch.d) / Math.max(1, now.d), this.bounds.minDist, this.bounds.maxDist);
      this.goal.yaw = MathUtils.clamp(this.goal.yaw - (now.a - this.pinch.a), -Math.PI / 4, Math.PI / 4);
      this.goal.tiltAdd = MathUtils.clamp(this.goal.tiltAdd + (now.my - this.pinch.my) * 0.15, -40, 40);
      this.pinch = now;
      return;
    }
    if (this.rotating) {
      this.goal.yaw = MathUtils.clamp(this.goal.yaw - dx * 0.005, -Math.PI / 4, Math.PI / 4);
      this.goal.tiltAdd = MathUtils.clamp(this.goal.tiltAdd + dy * 0.15, -40, 40);
      return;
    }
    if (this.grab) {
      // 抓住的那一点留在手指下：按现在的镜头算手指指着哪儿，把看的点挪过去。
      this.apply(0, true);
      const p = this.hit(e.clientX, e.clientY);
      if (!p) return;
      const mx = this.grab.x - p.x;
      const mz = this.grab.z - p.z;
      this.goal.x += mx;
      this.goal.z += mz;
      this.target.x += mx;
      this.target.z += mz;
      const t = performance.now();
      const dt = Math.max(8, t - this.lastMove) / 1000;
      this.vel.set(this.vel.x * 0.4 + (mx / dt) * 0.6, this.vel.y * 0.4 + (mz / dt) * 0.6);
      this.lastMove = t;
      this.clampGoal();
    }
  };

  private readonly up = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (this.pointers.size === 0) {
      if (performance.now() - this.lastMove > 90) this.vel.set(0, 0);
      this.grab = null;
      this.rotating = false;
      this.el.style.cursor = 'grab';
    }
  };

  private readonly wheel = (e: WheelEvent): void => {
    e.preventDefault();
    const k = Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const before = this.hit(e.clientX, e.clientY);
    const nd = MathUtils.clamp(this.goal.dist * k, this.bounds.minDist, this.bounds.maxDist);
    const f = nd / this.goal.dist;
    // 朝指着的那一点推：看的点往那一点挪同样的比例。
    if (before) {
      this.goal.x = before.x + (this.goal.x - before.x) * f;
      this.goal.z = before.z + (this.goal.z - before.z) * f;
    }
    this.goal.dist = nd;
    this.clampGoal();
  };

  private clampGoal(): void {
    const r = Math.hypot(this.goal.x, this.goal.z);
    if (r > this.bounds.r) {
      this.goal.x *= this.bounds.r / r;
      this.goal.z *= this.bounds.r / r;
    }
  }

  /** 设定看哪儿（立刻到位）。 */
  set(x: number, z: number, dist: number, yaw = 0, tiltAdd = 0): void {
    this.goal.tiltAdd = this.tiltAdd = tiltAdd;
    this.goal.x = this.target.x = x;
    this.goal.z = this.target.z = z;
    this.goal.dist = this.dist = dist;
    this.goal.yaw = this.yaw = yaw;
    this.apply(0);
  }

  /** 每帧：追目标、惯性、摆镜头。 */
  apply(dt: number, keep = false): void {
    if (!keep) {
      const k = 1 - Math.exp(-dt * 9);
      if (!this.grab && this.vel.lengthSq() > 1e-4) {
        this.goal.x += this.vel.x * dt;
        this.goal.z += this.vel.y * dt;
        this.vel.multiplyScalar(Math.exp(-dt * 4.2));
        this.clampGoal();
      }
      this.target.x += (this.goal.x - this.target.x) * (this.grab ? 1 : k);
      this.target.z += (this.goal.z - this.target.z) * (this.grab ? 1 : k);
      this.dist += (this.goal.dist - this.dist) * k;
      this.yaw += (this.goal.yaw - this.yaw) * k;
      this.tiltAdd += (this.goal.tiltAdd - this.tiltAdd) * k;
    }
    const tilt = MathUtils.degToRad(this.tilt());
    this.elevation = Math.PI / 2 - tilt;
    const h = Math.cos(tilt) * this.dist;
    const r = Math.sin(tilt) * this.dist;
    this.camera.position.set(this.target.x + Math.sin(this.yaw) * r, this.target.y + h, this.target.z + Math.cos(this.yaw) * r);
    this.camera.lookAt(this.target);
  }
}
