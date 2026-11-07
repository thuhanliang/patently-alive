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
STAGE = (0.22, 0.30, 0.80, 0.76)  # 纸偶所在的舞台（按截图宽高的比例）


def crop(name, box=STAGE):
    im = Image.open(f'{src}/{name}.png').convert('RGB')
    w, h = im.size
    return im.crop((int(w * box[0]), int(h * box[1]), int(w * box[2]), int(h * box[3])))


def grid(items, cols, cw, ch, out):
    rows = (len(items) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cw, rows * (ch + 44)), (233, 220, 192))
    d = ImageDraw.Draw(sheet)
    for i, (name, label, box) in enumerate(items):
        x, y = (i % cols) * cw, (i // cols) * (ch + 44)
        sheet.paste(crop(name, box).resize((cw, ch)), (x, y))
        d.text((x + 12, y + ch + 6), label, fill=(90, 70, 50), font=FONT)
    sheet.save(out, quality=88)


B = STAGE
grid([('A02-cat-handles', '现在：鼠标移上去，亮出六个蓝点', B), ('A03-cat-dragging-mass', '现在：正在拖背改体重', (0.22, 0.14, 0.80, 0.76))], 2, 1100, 780, f'{dst}/H-now.jpg')
grid([('X01-xray-cat', '默认', B), ('X02-xray-bone-heavy', '骨骼多给（骨头粗）', B), ('X03-xray-muscle-heavy', '肌肉多给（肌肉鼓）', B)], 3, 900, 640, f'{dst}/X-now.jpg')
grid([('A01-cat-stand', '1 默认 4 千克', B), ('E01-mass-0.01kg', '2 10 克', B), ('E02-mass-1000kg', '3 1000 千克', B), ('E03-legs-long', '4 腿最长', B), ('E04-legs-short', '5 腿最短', B),
      ('E06-fur-max', '6 毛最长', B), ('E07-fur-bare', '7 裸', B), ('E08-ears-huge-floppy', '8 大垂耳', B), ('E10-combo-giant', '9 1000 千克 + 腿、毛、尾最长', B), ('E11-combo-tiny-odd', '10 10 克 + 短腿 + 钩喙 + 掘土爪 + 大尾', B)], 5, 640, 460, f'{dst}/E-now.jpg')
Image.open(f'{src}/A01-cat-stand.png').convert('RGB').resize((1600, 1000)).save(f'{dst}/D-now-desk.jpg', quality=88)
Image.open(f'{src}/P04-cold-shiver.png').convert('RGB').save(f'{dst}/D-now-phone.jpg', quality=88)
for f in sorted(glob.glob(f'{src}/*.png')):
    im = Image.open(f).convert('RGB')
    w, h = im.size
    im.resize((w // 2, h // 2)).save(f'{dst}/all/' + os.path.basename(f)[:-4] + '.jpg', quality=80)
