# contact sheet: python scripts/qa/sheet.py <dir> <out.png> <cols> <thumbW> <frame>...  (reads <dir>/f<N>.png|jpg)
import sys, os
from PIL import Image, ImageDraw, ImageFont
d, out, cols, tw = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
frames = [int(x) for x in sys.argv[5:]]
def load(n):
    for ext in ('png', 'jpg', 'jpeg'):
        p = os.path.join(d, f'f{n}.{ext}')
        if os.path.exists(p):
            return Image.open(p).convert('RGB')
    return None
ims = [(n, load(n)) for n in frames]
ims = [(n, im) for n, im in ims if im is not None]
th = round(tw * 9 / 16)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * th), (20, 20, 20))
try:
    font = ImageFont.truetype('C:/Windows/Fonts/malgun.ttf', max(14, tw // 22))
except Exception:
    font = ImageFont.load_default()
for i, (n, im) in enumerate(ims):
    t = im.resize((tw, th), Image.LANCZOS)
    dr = ImageDraw.Draw(t)
    dr.rectangle((0, 0, tw // 7, tw // 20), fill=(0, 0, 0))
    dr.text((4, 1), f'f{n}', fill=(255, 255, 0), font=font)
    sheet.paste(t, ((i % cols) * tw, (i // cols) * th))
sheet.save(out)
print(out, sheet.size, len(ims))
