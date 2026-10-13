import type { Camera, ZoomPreset } from '../render/camera';

/**
 * 镜头操作：拖拽平移、滚轮缩放、按键或按钮切换"全图 / 地块"两档。
 * 镜头只影响画面，不进操作日志。
 */
export function bindCameraControls(canvas: HTMLCanvasElement, camera: Camera, toolbar: HTMLElement): () => void {
  let dragging: { x: number; y: number } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = { x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    camera.panBy(e.clientX - dragging.x, e.clientY - dragging.y);
    dragging = { x: e.clientX, y: e.clientY };
  });
  const endDrag = (e: PointerEvent): void => {
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
      camera.zoomAt({ x: e.clientX - rect.left, y: e.clientY - rect.top }, Math.pow(1.0015, -e.deltaY));
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
    ['plot', '地块 [2]'],
  ] as const) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => goTo(preset));
    toolbar.appendChild(b);
    buttons.set(preset, b);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === '1') goTo('map');
    if (e.key === '2') goTo('plot');
  });

  /** 每帧调用，高亮当前更接近的那一档。 */
  return () => {
    const near = camera.nearestPreset;
    for (const [p, b] of buttons) b.classList.toggle('active', p === near);
  };
}
