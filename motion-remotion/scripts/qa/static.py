# QA: static stretches. w[n] = mean |frame n - frame n-8| (8f > half a beat); lists runs where w < thr (nothing perceptibly moves for > half a beat).
import sys, os
import numpy as np
from PIL import Image
d, a, b = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
thr = float(sys.argv[4]) if len(sys.argv) > 4 else 0.25
L = lambda n: np.asarray(Image.open(os.path.join(d, f'f{n}.png')).convert('L'), dtype=np.float32)
cache = {}
def g(n):
    if n not in cache:
        cache[n] = L(n)
    return cache[n]
w = {}
for n in range(a + 8, b + 1):
    w[n] = float(np.abs(g(n) - g(n - 8)).mean())
    cache.pop(n - 9, None)
runs, start = [], None
for n in range(a + 8, b + 1):
    if w[n] < thr and start is None:
        start = n
    if (w[n] >= thr or n == b) and start is not None:
        runs.append((start - 8, n - 1))
        start = None
print(f'8f-window motion (thr {thr}): min {min(w.values()):.3f}, mean {np.mean(list(w.values())):.3f}')
print('low-motion runs (frames):', runs if runs else 'none')
