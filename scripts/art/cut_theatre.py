"""
纸剧场素材表 → 单件透明图（2026-11-21，handoff/009 第 2 轮）。

用法：python3 -I scripts/art/cut_theatre.py <素材表目录> <输出目录>
读 <素材表目录>/pieces.json（名字 → 素材表和框），输出 <输出目录>/<名字>.webp 和 manifest.json（每件的宽高）。
抠底：底色是偏粉的品红，而且有明暗起伏（拍照的光、暗角），所以先估出每一处的"本地底色"，再按色度和它的距离抠：
背景上的投影只是暗一点的同一种颜色，一起抠掉；被素材围住的品红（台口中间、洞穴里）也抠掉。
"""
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def key(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    s = rgb.sum(axis=2, keepdims=True) + 1e-3
    chroma = rgb / s
    border = np.concatenate([rgb[:6].reshape(-1, 3), rgb[-6:].reshape(-1, 3), rgb[:, :6].reshape(-1, 3), rgb[:, -6:].reshape(-1, 3)])
    bg0 = np.median(border, axis=0)
    d0 = np.sqrt(((chroma - bg0 / bg0.sum()) ** 2).sum(axis=2))
    # 第一遍：大致是底的地方，估出各处的底色（归一化卷积）。
    likely = (d0 < 0.06).astype(np.float32)
    w = ndimage.gaussian_filter(likely, 40) + 1e-4
    local = np.stack([ndimage.gaussian_filter(rgb[..., i] * likely, 40) / w for i in range(3)], axis=-1)
    local = np.where(w[..., None] > 0.02, local, bg0)
    lc = local / (local.sum(axis=2, keepdims=True) + 1e-3)
    d = np.sqrt(((chroma - lc) ** 2).sum(axis=2))
    alpha = np.clip((d - 0.045) / 0.06, 0, 1)
    # 素材在底上的投影：比底色暗，色度往红偏一点。比本地底色暗的像素放宽一些。
    bright = s[..., 0]
    lb = local.sum(axis=2)
    darker = bright < lb * 0.96
    alpha = np.where(darker, np.minimum(alpha, np.clip((d - 0.09) / 0.06, 0, 1)), alpha)
    # 品红到洋红一带的饱和色（底、底上的投影、暗角）一律当底：素材里没有这种颜色。
    mx = rgb.max(axis=2)
    mn = rgb.min(axis=2)
    sat = (mx - mn) / np.maximum(mx, 1)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    magenta_red = (r >= mx - 1) & (b > g) & (sat > 0.35)
    alpha = np.where(magenta_red, np.minimum(alpha, np.clip((0.5 - sat) / 0.15, 0, 1)), alpha)
    alpha[s[..., 0] < 70] = 1
    a3 = alpha[..., None]
    fg = np.clip(np.where(a3 > 0.02, (rgb - (1 - a3) * local) / np.maximum(a3, 0.02), rgb), 0, 255)
    return fg, alpha


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    spec = json.load(open(os.path.join(src, 'pieces.json')))
    scale = spec['scale']
    os.makedirs(out, exist_ok=True)
    cache: dict[str, tuple] = {}
    manifest = {}
    for name, (sheet, x, y, w, h) in spec['pieces'].items():
        if sheet not in cache:
            rgb = np.asarray(Image.open(os.path.join(src, sheet + '.png')).convert('RGB')).astype(np.float32)
            fg, alpha = key(rgb)
            labels, _ = ndimage.label(ndimage.binary_closing(alpha > 0.5, iterations=2))
            cache[sheet] = (fg, alpha, labels)
        fg, alpha, labels = cache[sheet]
        H, W = alpha.shape
        x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
        box = labels[y0:y1, x0:x1]
        keep = np.zeros_like(box, dtype=bool)
        for lab in np.unique(box):
            if lab == 0:
                continue
            inside = (box == lab).sum()
            total = (labels == lab).sum()
            if inside >= 300 and inside >= 0.5 * total:
                keep |= box == lab
        if not keep.any():
            # 这一件和别的件连在一起了（投影、碎屑）：只取框里的部分。
            keep = box > 0
        keep = ndimage.binary_dilation(keep, iterations=3)
        a = alpha[y0:y1, x0:x1] * keep
        ys, xs = np.nonzero(a > 0.05)
        if len(ys) == 0:
            print('空的：', name)
            continue
        cy0, cy1, cx0, cx1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        img = np.dstack([fg[y0:y1, x0:x1][cy0:cy1, cx0:cx1], (a[cy0:cy1, cx0:cx1] * 255)]).astype(np.uint8)
        pil = Image.fromarray(img, 'RGBA')
        size = (max(1, round(pil.width * scale)), max(1, round(pil.height * scale)))
        pil = pil.resize(size, Image.LANCZOS)
        pil.save(os.path.join(out, name + '.webp'), quality=88, method=6)
        manifest[name] = {'w': size[0], 'h': size[1]}
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)
    print(len(manifest), '件')


if __name__ == '__main__':
    main()
