import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';

/** 镜头只管画面，但点击落在哪一格由它换算：倾斜、旋转以后也得点哪儿是哪儿。 */
function camera(tilt: number, yaw: number): Camera {
  const c = new Camera();
  c.setWorld({ x: 800, y: 600 });
  c.setScreen(1600, 900);
  c.preset('region', { x: 300, y: 250 });
  c.tilt = tilt;
  c.yaw = yaw;
  return c;
}

describe('镜头', () => {
  it('不倾斜、不旋转时和原来的正俯视换算完全一样', () => {
    const c = camera(0, 0);
    const p = { x: 123.5, y: 777.25 };
    const old = { x: c.center.x + (p.x - 800) / c.zoom, y: c.center.y + (p.y - 450) / c.zoom };
    expect(c.screenToWorld(p)).toEqual(old);
  });

  it('倾斜、旋转以后，屏幕点 → 地面点 → 屏幕点回到原处', () => {
    for (const [tilt, yaw] of [
      [0.6, 0],
      [0.87, -0.7],
      [1.0, 0.5],
    ] as const) {
      const c = camera(tilt, yaw);
      for (const p of [
        { x: 0, y: 0 },
        { x: 1600, y: 900 },
        { x: 431, y: 77 },
      ]) {
        const back = c.worldToScreen(c.screenToWorld(p));
        expect(back.x).toBeCloseTo(p.x, 6);
        expect(back.y).toBeCloseTo(p.y, 6);
      }
    }
  });

  it('拖动时地面跟着手走；滚轮缩放时鼠标下的地面不动（自动倾斜也一样）', () => {
    const c = camera(0.7, 0.4);
    const grab = { x: 500, y: 300 };
    const ground = c.screenToWorld(grab);
    c.panBy(40, -25);
    const now = c.worldToScreen(ground);
    expect(now.x).toBeCloseTo(540, 6);
    expect(now.y).toBeCloseTo(275, 6);

    c.autoTilt = (z) => Math.min(0.9, z * 0.4);
    const at = { x: 1200, y: 600 };
    const under = c.screenToWorld(at);
    c.zoomAt(at, 1.6);
    expect(c.tilt).toBeCloseTo(Math.min(0.9, c.zoom * 0.4), 9);
    const back = c.worldToScreen(under);
    expect(back.x).toBeCloseTo(at.x, 6);
    expect(back.y).toBeCloseTo(at.y, 6);
  });
});
