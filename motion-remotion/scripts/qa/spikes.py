# QA (c): frame-difference spike scan. d[n] = mean |frame n - frame n-1|; a spike is d[n] > 3x max(d[n-1], d[n+1])
# (and above a small absolute floor so near-static noise is not flagged). usage: spikes.py <dir with f<N>.png> <first> <last>
import sys, os
import numpy as np
from PIL import Image
d, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
def load(n):
    return np.asarray(Image.open(os.path.join(d, f'f{n}.png')).convert('L'), dtype=np.float32)
prev = load(a)
diffs = {}
for n in range(a + 1, b + 1):
    cur = load(n)
    diffs[n] = float(np.abs(cur - prev).mean())
    prev = cur
spikes = []
for n in range(a + 2, b):
    nb = max(diffs[n - 1], diffs[n + 1])
    if diffs[n] > 3 * nb and diffs[n] > 0.35:
        spikes.append((n, diffs[n], nb))
print(f'frames {a}..{b}: mean d={np.mean(list(diffs.values())):.3f} max d={max(diffs.values()):.3f} at f{max(diffs, key=diffs.get)}')
if spikes:
    print('SPIKES (n, d, max neighbour):')
    for n, x, y in spikes:
        print(f'  f{n}: {x:.3f} vs {y:.3f}')
else:
    print('no spikes (>3x neighbours, floor 0.35)')
# static runs: stretches where d < 0.02 for > 7 frames (half a beat)
run = 0
for n in range(a + 1, b + 1):
    if diffs[n] < 0.02:
        run += 1
        if run == 8:
            print(f'  static >7f starting f{n-7}')
    else:
        run = 0
import json
json.dump(diffs, open(os.path.join(d, 'diffs.json'), 'w'))
