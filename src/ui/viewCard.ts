import type { Camera } from '../render/camera';
import type { ViewAngles } from '../render/view';

/**
 * 右上角的视角卡：三档缩放的纸签（按钮由 cameraControls 放进 presets 这一行），下面三根滑块——缩放、俯仰、旋转。
 * 俯仰默认跟着缩放（拉远俯视、拉近斜看）；拖了俯仰滑块就固定下来，勾回"自动"恢复。旋转也可以按 Q / E。
 * 只影响画面，不进操作日志。
 */
export function bindViewCard(card: HTMLElement, camera: Camera, angles: ViewAngles | undefined): { presets: HTMLElement; sync: () => void } {
  const presets = document.createElement('div');
  presets.className = 'bar';
  card.append(presets);
  const deg = 180 / Math.PI;

  const slider = (label: string, min: number, max: number, step: number): { row: HTMLElement; input: HTMLInputElement; value: HTMLSpanElement } => {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    const value = document.createElement('span');
    value.className = 'value';
    row.append(name, input, value);
    card.append(row);
    return { row, input, value };
  };

  // 缩放：滑块是对数刻度（0 = 最远，1 = 最近），以画面中心为准缩放。
  const zoom = slider('缩放', 0, 1, 0.001);
  const zoomOf = (t: number): number => camera.minZoom * Math.pow(camera.maxZoom / camera.minZoom, t);
  const tOf = (z: number): number => Math.log(z / camera.minZoom) / Math.log(camera.maxZoom / camera.minZoom);
  zoom.input.addEventListener('input', () => {
    const s = camera.screenSize;
    camera.zoomAt({ x: s.x / 2, y: s.y / 2 }, zoomOf(Number(zoom.input.value)) / camera.zoom);
  });

  let pitchSync = (): void => {};
  if (angles) {
    const pitch = slider('俯仰', 0, Math.round(angles.pitchLimit * deg), 1);
    const auto = document.createElement('label');
    const autoBox = document.createElement('input');
    autoBox.type = 'checkbox';
    autoBox.checked = camera.autoTilt !== null;
    auto.append(autoBox, '自动');
    auto.className = 'note';
    auto.title = '俯仰跟着缩放：拉远俯视，拉近斜看';
    pitch.row.append(auto);
    pitch.input.addEventListener('input', () => {
      camera.autoTilt = null;
      autoBox.checked = false;
      camera.tilt = Number(pitch.input.value) / deg;
    });
    autoBox.addEventListener('change', () => {
      camera.autoTilt = autoBox.checked ? angles.autoTilt : null;
      if (autoBox.checked) camera.tilt = angles.autoTilt(camera.zoom);
    });

    const yaw = slider('旋转', -Math.round(angles.yawLimit * deg), Math.round(angles.yawLimit * deg), 1);
    yaw.input.title = '也可以按 Q / E';
    yaw.input.addEventListener('input', () => (camera.yaw = Number(yaw.input.value) / deg));
    // 双击滑块回正。
    yaw.input.addEventListener('dblclick', () => (camera.yaw = 0));
    pitch.input.addEventListener('dblclick', () => {
      autoBox.checked = true;
      autoBox.dispatchEvent(new Event('change'));
    });

    pitchSync = (): void => {
      const p = Math.round(camera.tilt * deg);
      const y = Math.round(camera.yaw * deg);
      if (document.activeElement !== pitch.input) pitch.input.value = String(p);
      if (document.activeElement !== yaw.input) yaw.input.value = String(y);
      pitch.value.textContent = `${p}°`;
      yaw.value.textContent = `${y > 0 ? '+' : ''}${y}°`;
    };
  }

  return {
    presets,
    /** 每帧调用：滑块跟着镜头（滚轮、拖拽、按键改了镜头时）。 */
    sync: () => {
      if (document.activeElement !== zoom.input) zoom.input.value = String(tOf(camera.zoom));
      zoom.value.textContent = `${camera.zoom >= 1 ? camera.zoom.toFixed(1) : camera.zoom.toFixed(2)}×`;
      pitchSync();
    },
  };
}
