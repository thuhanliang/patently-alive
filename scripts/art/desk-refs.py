"""handoff/008 的现状拼图：把 desk-matrix.cjs 截的原图拼成每轮要发给设计 AI 的图。

用法：python3 scripts/art/desk-refs.py <截图目录> art/incoming/refs/008
"""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

src, dst = sys.argv[1:3]
os.makedirs(f'{dst}/all', exist_ok=True)
FONT = ImageFont.truetype('/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', 30)
STAGE = (0.26, 0.36, 0.80, 0.76)  # 纸偶所在的舞台（按截图宽高的比例）


def crop(name, box=STAGE):
    im = Image.open(f'{src}/{name}.png').convert('RGB')
    w, h = im.size
    return im.crop((int(w * box[0]), int(h * box[1]), int(w * box[2]), int(h * box[3])))


def grid(items, cols, cw, out):
    """每格宽 cw，高按裁出来的那块的宽高比算（不拉伸）；一行里取最高的那格。"""
    tiles = []
    for name, label, box in items:
        c = crop(name, box)
        tiles.append((c.resize((cw, round(cw * c.height / c.width)), Image.LANCZOS), label))
    rows = [tiles[i:i + cols] for i in range(0, len(tiles), cols)]
    heights = [max(t.height for t, _ in r) + 44 for r in rows]
    sheet = Image.new('RGB', (cols * cw + (cols - 1) * 8, sum(heights) + 8 * (len(rows) - 1)), (233, 220, 192))
    d = ImageDraw.Draw(sheet)
    y = 0
    for r, h in zip(rows, heights):
        for i, (t, label) in enumerate(r):
            x = i * (cw + 8)
            sheet.paste(t, (x, y))
            d.text((x + 12, y + t.height + 6), label, fill=(90, 70, 50), font=FONT)
        y += h + 8
    sheet.save(out, quality=90)


B = STAGE
X = (0.32, 0.40, 0.79, 0.76)  # X 光只要纸偶本身
grid([('A02-cat-handles', '现在：鼠标移上去，亮出六个蓝点', (0.30, 0.38, 0.78, 0.76)), ('A03-cat-dragging-mass', '现在：正在拖背改体重', (0.34, 0.10, 0.82, 0.76))], 2, 1300, f'{dst}/H-now.jpg')
grid([('X01-xray-cat', '默认', X), ('X02-xray-bone-heavy', '骨骼多给（骨头粗）', X), ('X03-xray-muscle-heavy', '肌肉多给（肌肉鼓）', X)], 3, 1000, f'{dst}/X-now.jpg')
grid([('A01-cat-stand', '1 默认 4 千克', B), ('E01-mass-0.01kg', '2 10 克', B), ('E02-mass-1000kg', '3 1000 千克', B), ('E03-legs-long', '4 腿最长', B), ('E04-legs-short', '5 腿最短', B),
      ('E06-fur-max', '6 毛最长', B), ('E07-fur-bare', '7 裸', B), ('E08-ears-huge-floppy', '8 大垂耳', B), ('E10-combo-giant', '9 1000 千克 + 腿、毛、尾最长', B), ('E11-combo-tiny-odd', '10 10 克 + 短腿 + 钩喙 + 掘土爪 + 大尾', B)], 5, 760, f'{dst}/E-now.jpg')
Image.open(f'{src}/A01-cat-stand.png').convert('RGB').resize((1600, 1000)).save(f'{dst}/D-now-desk.jpg', quality=88)
Image.open(f'{src}/P04-cold-shiver.png').convert('RGB').save(f'{dst}/D-now-phone.jpg', quality=88)
for f in sorted(glob.glob(f'{src}/*.png')):
    im = Image.open(f).convert('RGB')
    w, h = im.size
    im.resize((w // 2, h // 2)).save(f'{dst}/all/' + os.path.basename(f)[:-4] + '.jpg', quality=80)
