"""Procedural SFX, tuned to D major. Each returns mono float array."""
from synth import *  # noqa

D5, E5, FS5, A5, B5, D6, FS6, A6 = 74, 76, 78, 81, 83, 86, 90, 93


def _env_tail(x, ms=6):
    return tail_fade(x, ms)


def thread_draw():
    d = 0.95
    n = int(d * SR)
    t = np.arange(n) / SR
    u = t / d
    air = sweep_noise(d, 500, 7000).astype(np.float64)
    env = (np.sin(np.pi * u ** 0.8) ** 1.3) * np.minimum(1, (d - t) / 0.12)
    zip_ = np.sin(2 * np.pi * np.cumsum(mtof(D5) * 2 ** (u * 1.0)) / SR)   # glide D5 -> D6
    zip_ += 0.25 * np.sin(4 * np.pi * np.cumsum(mtof(D5) * 2 ** (u * 1.0)) / SR)
    x = 0.55 * air * env + 0.22 * zip_ * env ** 1.6
    x = hp(x, 180)
    return _env_tail(x)


def capsule_arrive():
    n = int(0.7 * SR)
    t = np.arange(n) / SR
    click = bp(noise(n, 3), 2200, 5200) * np.exp(-t * 700) * 0.7
    thump = np.sin(2 * np.pi * 150 * t) * np.exp(-t * 55) * 0.5
    tone = pluck(A5, 0.7, 0.55, 0, 6.5)[0][:n].astype(np.float64) * 0.55
    tone2 = pluck(E5 + 12, 0.7, 0.4, 0, 8.0)[0][:n].astype(np.float64) * 0.22
    return _env_tail(click + thump + tone + tone2, 15)


def chip_morph():
    n = int(0.2 * SR)
    t = np.arange(n) / SR
    a = np.sin(2 * np.pi * mtof(FS6) * t) * np.exp(-t * 70)
    t2 = np.clip(t - 0.045, 0, None)
    b = np.sin(2 * np.pi * mtof(A6) * t2) * np.exp(-t2 * 60) * (t >= 0.045)
    x = 0.6 * a * np.minimum(1, t / 0.001) + 0.5 * b + 0.15 * bp(noise(n, 5), 3000, 7000) * np.exp(-t * 400)
    return _env_tail(x, 20)


def click():
    n = int(0.14 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * (500 + 900 * np.exp(-t * 120)) * t) * np.exp(-t * 85) * 0.7
    ns = bp(noise(n, 9), 1500, 4500) * np.exp(-t * 500) * 0.8
    return _env_tail(body + ns, 20)


def number_roll():
    d = 0.5
    n = int(d * SR)
    x = np.zeros(n)
    scale = [D5, E5, FS5, A5, B5, D6]
    N = 13
    for i in range(N):
        st = 0.40 * (1 - (1 - i / N) ** 1.5)       # ticks accelerate
        s = int(st * SR)
        m = int(0.05 * SR)
        t = np.arange(m) / SR
        tick = np.sin(2 * np.pi * mtof(scale[i % 6]) * t) * np.exp(-t * 110) * (0.28 + 0.5 * i / N)
        tick += bp(noise(m, 20 + i), 2500, 6000) * np.exp(-t * 500) * 0.25
        x[s:s + m] += tick[: n - s]
    return _env_tail(x, 20)


def typing():
    n = SR
    x = np.zeros(n)
    times = [0.02, 0.13, 0.215, 0.37, 0.46, 0.58, 0.66, 0.79, 0.86]
    for i, ts in enumerate(times):
        s = int(ts * SR)
        m = int(0.12 * SR)
        t = np.arange(m) / SR
        f = [230, 280, 250, 310, 260, 290, 240, 270, 300][i]
        tap = np.sin(2 * np.pi * f * t) * np.exp(-t * 90) * 0.5
        tap += bp(noise(m, 70 + i), 1500, 4200) * np.exp(-t * 260) * 0.7
        tap *= 0.7 + 0.3 * ((i * 37) % 10) / 10
        x[s:s + m] += tap[: n - s]
    return _env_tail(x, 5)


def wordmark_land():
    d = 3.0
    n = int(d * SR)
    t = np.arange(n) / SR
    boom = np.sin(2 * np.pi * (mtof(38) * t + 40 * (1 - np.exp(-12 * t)) / 12)) * np.exp(-t * 1.8) * 0.9
    x = boom.copy()
    for i, m in enumerate([50, 57, 62, 66, 69]):
        p = pluck(m, 2.8, 0.45, 5.0, 1.0)[0].astype(np.float64)
        x[: len(p)] += p[:n] * 0.28
    thump = lp(noise(int(0.4 * SR), 4), 900) * np.exp(-np.arange(int(0.4 * SR)) / SR * 14) * 0.7
    x[: len(thump)] += thump
    x = lp(x, 3200)
    ir = make_ir(1.4, 9, 3000)
    wet = signal.fftconvolve(x, ir)[:n]
    x = x + 0.5 * wet
    f = int(0.5 * SR)
    x[-f:] *= np.cos(np.linspace(0, np.pi / 2, f)) ** 2
    return x


SFX = {
    'thread-draw': (thread_draw, 'rising soft whoosh + D5->D6 glide', -9.0),
    'capsule-arrive': (capsule_arrive, 'soft click + A5/E6 tone', -9.0),
    'chip-morph': (chip_morph, 'tiny F#6->A6 blip', -12.0),
    'click': (click, 'UI click', -9.0),
    'number-roll': (number_roll, 'accelerating pentatonic ticks, ~0.5s', -11.0),
    'typing': (typing, 'soft key taps, 1.0s loopable', -14.0),
    'wordmark-land': (wordmark_land, 'warm D impact + dark tail (no shimmer)', -4.0),
}
