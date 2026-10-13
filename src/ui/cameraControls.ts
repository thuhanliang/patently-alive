import type { Camera, ZoomPreset } from '../render/camera';

/**
 * 镜头操作：拖拽平移、滚轮缩放、按键或按钮切换"全图 / 区域 / 地块"三档。
 * 镜头只影响画面，不进操作日志。
 */
export function bindCameraControls(
  canvas: HTMLCanvasElement,
  camera: Camera,
  toolbar: HTMLElement,
  /** 按下又松开、几乎没拖动时算一次点击，传回屏幕坐标（相对画布）。 */
  onClick?: (screen: { x: number; y: number }) => void,
): () => void {
  let dragging: { x: number; y: number } | null = null;
  let moved = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY };
    moved = 0;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved += Math.abs(e.clientX - dragging.x) + Math.abs(e.clientY - dragging.y);
    camera.panBy(e.clientX - dragging.x, e.clientY - dragging.y);
    dragging = { x: e.clientX, y: e.clientY };
  });
  const endDrag = (e: PointerEvent): void => {
    if (dragging && e.type === 'pointerup' && moved < 4 && onClick) {
      const rect = canvas.getBoundingClientRect();
      onClick({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    dragging = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      // Firefox 的鼠标滚轮按"行"报告（deltaMode = 1），换算成像素再用。
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? rect.height : 1;
      camera.zoomAt({ x: e.clientX - rect.left, y: e.clientY - rect.top }, Math.pow(1.0015, -e.deltaY * unit));
    },
    { passive: false },
  );

  const centerOfScreen = (): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return camera.screenToWorld({ x: rect.width / 2, y: rect.height / 2 });
  };
  const goTo = (p: ZoomPreset): void => camera.preset(p, centerOfScreen());

  const buttons = new Map<ZoomPreset, HTMLButtonElement>();
  for (const [preset, label] of [
    ['map', '全图 [1]'],
    ['region', '区域 [2]'],
    ['plot', '地块 [3]'],
  ] as const) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => goTo(preset));
    toolbar.appendChild(b);
    buttons.set(preset, b);
  }

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === '1') goTo('map');
    if (e.key === '2') goTo('region');
    if (e.key === '3') goTo('plot');
  });

  /** 每帧调用，高亮当前更接近的那一档。 */
  return () => {
    const near = camera.nearestPreset;
    for (const [p, b] of buttons) b.classList.toggle('active', p === near);
  };
}
