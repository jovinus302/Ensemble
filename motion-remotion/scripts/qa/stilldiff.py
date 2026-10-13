# compare two stills: mean abs diff, % pixels differing > 8, and bbox of the differences
import sys
import numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert('RGB')).astype(int)
b = np.asarray(Image.open(sys.argv[2]).convert('RGB')).astype(int)
d = np.abs(a - b).max(axis=2)
mse = ((a - b) ** 2).mean()
psnr = 99 if mse == 0 else 10 * np.log10(255 ** 2 / mse)
mask = d > 12
ys, xs = np.where(mask)
print(f'{sys.argv[1]} vs {sys.argv[2]}: meanAbs={np.abs(a-b).mean():.3f} psnr={psnr:.1f}dB diff>12px={mask.mean()*100:.2f}%', end='')
if mask.any():
    print(f' bbox x[{xs.min()},{xs.max()}] y[{ys.min()},{ys.max()}]')
    # save diff visualisation
    out = (np.clip(d * 4, 0, 255)).astype('uint8')
    Image.fromarray(out).save(sys.argv[3] if len(sys.argv) > 3 else 'out/diff.png')
else:
    print()
