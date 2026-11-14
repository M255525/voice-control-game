# 產生 PWA 圖示（麥克風＋聲波），python tools/make_icons.py
from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'icons')
def icon(size, pad=0.0):
    s = 4 * size
    im = Image.new('RGBA', (s, s), (29, 34, 87, 255))
    d = ImageDraw.Draw(im)
    c = s / 2; k = s * (1 - 2 * pad) / 512
    # 背景圓光
    d.ellipse([c - 230*k, c - 230*k, c + 230*k, c + 230*k], fill=(45, 52, 130, 255))
    # 聲波
    for i, (r, col) in enumerate([(185, (94, 242, 214, 255)), (225, (255, 79, 139, 255))]):
        w = int(18 * k)
        for sgn in (-1, 1):
            box = [c - r*k, c - 40*k - r*k, c + r*k, c - 40*k + r*k]
            start, end = (150, 210) if sgn < 0 else (-30, 30)
            d.arc(box, start, end, fill=col, width=w)
    # 麥克風頭
    d.rounded_rectangle([c - 62*k, c - 175*k, c + 62*k, c + 40*k], radius=62*k, fill=(255, 216, 77, 255))
    for yy in (-120, -80, -40):
        d.line([c - 40*k, c + yy*k, c + 40*k, c + yy*k], fill=(220, 170, 30, 255), width=int(8*k))
    # 支架
    d.arc([c - 100*k, c - 120*k, c + 100*k, c + 90*k], 0, 180, fill=(255, 255, 255, 255), width=int(16*k))
    d.rectangle([c - 8*k, c + 88*k, c + 8*k, c + 150*k], fill=(255, 255, 255, 255))
    d.rounded_rectangle([c - 70*k, c + 145*k, c + 70*k, c + 165*k], radius=10*k, fill=(255, 255, 255, 255))
    return im.resize((size, size), Image.LANCZOS)
icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))
icon(512, pad=0.1).save(os.path.join(OUT, 'icon-maskable-512.png'))
icon(180).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'))
print('ok')
