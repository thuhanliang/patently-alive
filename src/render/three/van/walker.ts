import { MathUtils, Vector3, type PerspectiveCamera } from 'three';
import { XF, XR } from './body';

/**
 * 第一人称（2026-11-25）：在勾勾的车厢里自由走动、转头看；后门开着就能走出去，在车外的草地上绕一圈。
 * 拖动转头；WASD / 方向键 / 滚轮走；点地板走过去（iPad 上一根手指就够了）；点椅子坐下，一走动就站起来。
 * 坐标是车的局部坐标（米），地面在 y = 0，车厢地板在 y = 0.565。
 */
const R = 0.2; // 人的半径
const IN = { x0: XR + 0.22, x1: 1.28, z0: -0.74, z1: 0.74 };
const VAN = { x0: XR - 0.12, x1: XF + 0.2, z0: -1.12, z1: 1.12 };
const EYE_IN = 1.62;
const EYE_OUT = 1.5;

export class Walker {
  readonly pos = new Vector3(-1.45, EYE_IN, -0.25);
  yaw = -0.35; // 0 = 朝 +x（车头）
  pitch = -0.12;
  private eye = EYE_IN;
  private goal: { x: number; z: number } | null = null;
  private seat: { eye: Vector3; look: Vector3 } | null = null;
  private seatT = 0;
  private readonly keys = new Set<string>();
  private drag: { x: number; y: number; moved: boolean; id: number } | null = null;
  private wheelV = 0;
  enabled = true;
  /** 点了一下（没有拖）：外面决定是点了东西、还是走过去。 */
  onTap: ((x: number, y: number) => void) | null = null;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly el: HTMLElement,
    private readonly world: { obstacles: Array<[number, number, number, number]>; doorsOpen: () => boolean; groundY: () => number },
  ) {
    el.style.touchAction = 'none';
    el.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.drag = { x: e.clientX, y: e.clientY, moved: false, id: e.pointerId };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.enabled || !this.drag || this.drag.id !== e.pointerId) return;
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 6) return;
      this.drag.moved = true;
      el.style.cursor = 'grabbing';
      this.yaw -= dx * 0.0042;
      this.pitch = MathUtils.clamp(this.pitch - dy * 0.0034, -1.25, 1.1);
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    el.addEventListener('pointerup', (e) => {
      const d = this.drag;
      this.drag = null;
      el.style.cursor = '';
      if (this.enabled && d && !d.moved) this.onTap?.(e.clientX, e.clientY);
    });
    el.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.wheelV -= e.deltaY * 0.004;
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.enabled && this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }

  get inside(): boolean {
    return this.pos.x > XR;
  }

  get seated(): boolean {
    return this.seat !== null;
  }

  /** 这一点能不能站：车厢里（不撞家具）、门口（门开着）、或车外的草地上（不撞车）。 */
  free(x: number, z: number): boolean {
    const doorway = x > XR - 0.4 && x < IN.x0 + 0.05 && Math.abs(z) < 0.55;
    if (doorway) return this.world.doorsOpen();
    if (x >= IN.x0 && x <= IN.x1 && z >= IN.z0 && z <= IN.z1) {
      for (const [x0, z0, x1, z1] of this.world.obstacles) if (x > x0 - R && x < x1 + R && z > z0 - R && z < z1 + R) return false;
      return true;
    }
    if (x > VAN.x0 - R && x < VAN.x1 + R && z > VAN.z0 - R && z < VAN.z1 + R) return false;
    return Math.hypot(x / 1.25, z) < 4.6;
  }

  walkTo(x: number, z: number): void {
    this.goal = { x, z };
    this.seat = null;
  }

  sit(seat: { eye: Vector3; look: Vector3 }): void {
    this.seat = seat;
    this.seatT = 0;
    this.goal = null;
  }

  /** 摆好镜头（外面在飞行结束后、或回到第一人称时调用）。 */
  place(x: number, z: number, yaw: number, pitch: number): void {
    this.pos.set(x, this.inside ? EYE_IN : EYE_OUT, z);
    this.yaw = yaw;
    this.pitch = pitch;
  }

  update(dt: number): void {
    // 走：键盘、滚轮、点地板走过去。坐着的时候一动就站起来。
    let fx = 0;
    let sx = 0;
    const k = this.keys;
    if (k.has('w') || k.has('arrowup')) fx += 1;
    if (k.has('s') || k.has('arrowdown')) fx -= 1;
    if (k.has('a') || k.has('arrowleft')) sx -= 1;
    if (k.has('d') || k.has('arrowright')) sx += 1;
    fx += this.wheelV;
    this.wheelV *= Math.exp(-dt * 6);
    if (Math.abs(this.wheelV) < 0.02) this.wheelV = 0;
    const speed = 1.3;
    let vx = 0;
    let vz = 0;
    if (fx || sx) {
      this.goal = null;
      if (this.seat) this.seat = null;
      const cy = Math.cos(this.yaw);
      const sy = Math.sin(this.yaw);
      vx = (cy * fx - sy * sx) * speed;
      vz = (-sy * fx - cy * sx) * speed;
    } else if (this.goal) {
      const dx = this.goal.x - this.pos.x;
      const dz = this.goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) this.goal = null;
      else {
        const s = Math.min(speed, d * 3);
        vx = (dx / d) * s;
        vz = (dz / d) * s;
        // 走过去时慢慢转向前进的方向（不要猛地一扭头）。
        const want = Math.atan2(-dz, dx);
        let diff = want - this.yaw;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.yaw += diff * Math.min(1, dt * 2.5);
      }
    }
    if (vx || vz) {
      const nx = this.pos.x + vx * dt;
      const nz = this.pos.z + vz * dt;
      // 站在不该站的地方（刚从椅子上起来）：怎么走都行，先走出来。
      if (!this.free(this.pos.x, this.pos.z) || this.free(nx, nz)) {
        this.pos.x = nx;
        this.pos.z = nz;
      } else if (this.free(nx, this.pos.z)) this.pos.x = nx;
      else if (this.free(this.pos.x, nz)) this.pos.z = nz;
      else this.goal = null;
    }
    // 坐下：一秒钟里把人挪到椅子上、低头看着台面；坐好以后照样能转头看。
    if (this.seat && this.seatT < 1) {
      this.seatT = Math.min(1, this.seatT + dt * 1.2);
      const e = Math.min(1, dt * 4);
      const look = this.seat.look.clone().sub(this.seat.eye).normalize();
      this.pos.x += (this.seat.eye.x - this.pos.x) * e;
      this.pos.z += (this.seat.eye.z - this.pos.z) * e;
      let dy = Math.atan2(-look.z, look.x) - this.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      this.yaw += dy * e;
      this.pitch += (Math.asin(look.y) - this.pitch) * e;
    }
    // 眼睛的高度：车里高一点（地板垫高了），走下踏板时慢慢降下来，坐下更低；走路时轻轻起伏。
    const moving = Math.hypot(vx, vz);
    const eyeGoal = this.seat ? this.seat.eye.y : this.inside ? EYE_IN : EYE_OUT;
    this.eye += (eyeGoal - this.eye) * Math.min(1, dt * 5);
    const bob = Math.sin(performance.now() * 0.011) * 0.012 * Math.min(1, moving);
    const px = this.pos.x;
    const py = this.eye + bob;
    const pz = this.pos.z;
    const dirX = Math.cos(this.pitch) * Math.cos(this.yaw);
    const dirY = Math.sin(this.pitch);
    const dirZ = -Math.cos(this.pitch) * Math.sin(this.yaw);
    const gy = this.world.groundY();
    this.camera.position.set(px, py + gy, pz);
    this.camera.lookAt(px + dirX, py + gy + dirY, pz + dirZ);
  }
}
