"""Procedural synthesis primitives (numpy/scipy only, no samples). Deterministic."""
from functools import lru_cache
import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
NOISE = np.random.default_rng(7).standard_normal(SR * 12).astype(np.float64)


def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def noise(n, off=0):
    off = (off * 7919) % (len(NOISE) - n - 1)
    return NOISE[off:off + n].copy()


def tail_fade(x, ms=4):
    n = min(len(x), int(SR * ms / 1000))
    if n > 0:
        x[-n:] *= np.linspace(1, 0, n)
    return x


@lru_cache(None)
def _sos(kind, lo, hi, order=2):
    if kind == 'bp':
        return signal.butter(order, [lo, hi], 'bandpass', fs=SR, output='sos')
    return signal.butter(order, lo, kind, fs=SR, output='sos')


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos('bp', lo, hi, order), x)


def lp(x, f, order=2):
    return signal.sosfilt(_sos('lowpass', f, 0, order), x)


def hp(x, f, order=2):
    return signal.sosfilt(_sos('highpass', f, 0, order), x)


def _norm(x):
    p = np.max(np.abs(x))
    return x / p if p > 0 else x


@lru_cache(None)
def pluck(m, dur, bright=1.0, det=0.0, decay=2.2):
    """Additive plucked/mallet tone, stereo (2,n), peak-normalised."""
    f = mtof(m)
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    voices = [(0.0, 1.0, 1.0)] if det == 0 else [(-det, 1.0, 0.35), (det, 0.35, 1.0)]
    for cents, gl, gr in voices:
        fv = f * 2 ** (cents / 1200.0)
        s = np.zeros(n)
        for k in range(1, 18):
            fk = fv * k
            if fk > 9000:
                break
            a = k ** -1.2 * np.exp(-(k - 1) / (3.0 * bright))
            s += a * np.sin(2 * np.pi * fk * t) * np.exp(-decay * (1 + 0.8 * (k - 1)) * t)
        out[0] += s * gl
        out[1] += s * gr
    out *= np.minimum(1.0, t / 0.002)
    out[:, -int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    return (_norm(out)).astype(np.float32)


@lru_cache(None)
def pad(m, dur, cutoff=1800.0, det=9.0, attack=0.5, release=0.6, decay=0.0):
    """Detuned band-limited saw stack (additive, soft rolloff), stereo, peak-normalised."""
    f = mtof(m)
    n = int(dur * SR)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    rng = np.random.default_rng(int(m) * 31 + 5)
    for cents, gl, gr in ((-det, 0.85, 0.3), (0.0, 0.6, 0.6), (det, 0.3, 0.85)):
        fv = f * 2 ** (cents / 1200.0)
        s = np.zeros(n)
        for k in range(1, 40):
            fk = fv * k
            if fk > min(cutoff * 3, 12000):
                break
            a = (1.0 / k) / np.sqrt(1 + (fk / cutoff) ** 4)
            s += a * np.sin(2 * np.pi * fk * t + rng.uniform(0, 6.28))
        out[0] += s * gl
        out[1] += s * gr
    env = np.ones(n)
    na = max(1, int(attack * SR))
    env[:na] = np.sin(0.5 * np.pi * np.arange(na) / na) ** 2
    nr = min(n, int(release * SR))
    env[-nr:] *= np.cos(0.5 * np.pi * np.arange(nr) / nr) ** 2
    if decay > 0:
        env *= np.exp(-t / decay)
    out *= env * (1 + 0.04 * np.sin(2 * np.pi * 0.33 * t))
    return _norm(out).astype(np.float32)


@lru_cache(None)
def bass(m, dur, bright=1.0):
    f = mtof(m)
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.sin(2 * np.pi * f * t) + 0.32 * bright * np.sin(4 * np.pi * f * t) + 0.12 * bright * np.sin(6 * np.pi * f * t)
    s = np.tanh(1.6 * s) / np.tanh(1.6)
    env = np.minimum(1.0, t / 0.005) * (0.55 + 0.45 * np.exp(-t * 5))
    r = min(n, int(0.03 * SR))
    env[-r:] *= np.linspace(1, 0, r)
    return _norm(s * env).astype(np.float32)


@lru_cache(None)
def kick(f_end=46.0, dur=0.38, punch=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    phase = 2 * np.pi * (f_end * t + 95 * (1 - np.exp(-26 * t)) / 26)
    s = np.sin(phase) * np.exp(-t * 8.5)
    click = lp(noise(n, 11), 2500) * np.exp(-t * 400) * 0.35 * punch
    s = np.tanh(1.3 * (s + click))
    s[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    return _norm(s).astype(np.float32)


@lru_cache(None)
def clap(variant=0):
    n = int(0.28 * SR)
    t = np.arange(n) / SR
    nz = bp(noise(n, 21 + variant), 900, 3600)
    env = np.exp(-t * 22) * 0.5
    for d in (0.0, 0.011, 0.022):
        i = int(d * SR)
        env[i:] += np.exp(-np.arange(n - i) / SR * 120)
    s = nz * env
    s[-int(0.01 * SR):] *= np.linspace(1, 0, int(0.01 * SR))
    return _norm(s).astype(np.float32)


@lru_cache(None)
def hat(open_=False, variant=0):
    d = 0.22 if open_ else 0.07
    n = int(d * SR)
    t = np.arange(n) / SR
    s = hp(noise(n, 31 + variant), 6500) * np.exp(-t * (14 if open_ else 55)) * np.minimum(1, t / 0.0015)
    s[-int(0.005 * SR):] *= np.linspace(1, 0, int(0.005 * SR))
    return _norm(s).astype(np.float32)


@lru_cache(None)
def shaker(variant=0):
    n = int(0.12 * SR)
    t = np.arange(n) / SR
    s = bp(noise(n, 41 + variant), 4200, 9500) * np.minimum(1, t / 0.012) * np.exp(-t * 38)
    s[-int(0.005 * SR):] *= np.linspace(1, 0, int(0.005 * SR))
    return _norm(s).astype(np.float32)


@lru_cache(None)
def rim(f=1900.0):
    n = int(0.08 * SR)
    t = np.arange(n) / SR
    s = (np.sin(2 * np.pi * f * t) * np.exp(-t * 90) + 0.5 * bp(noise(n, 51), 2500, 6000) * np.exp(-t * 160))
    s[-int(0.005 * SR):] *= np.linspace(1, 0, int(0.005 * SR))
    return _norm(s).astype(np.float32)


@lru_cache(None)
def sweep_noise(dur, f0, f1, nb=14, rising=True):
    """Noise whose band centre sweeps f0->f1 (smooth, built from fixed band-pass layers)."""
    n = int(dur * SR)
    u = np.arange(n) / n
    if not rising:
        u = u[::-1]
    out = np.zeros(n)
    centres = f0 * (f1 / f0) ** (np.arange(nb) / (nb - 1))
    for i, c in enumerate(centres):
        layer = bp(noise(n, 60 + i), c / 1.3, min(c * 1.3, SR / 2 - 100))
        pos = i / (nb - 1)
        out += layer * np.exp(-(((u - pos) * 3.2) ** 2))
    return _norm(out).astype(np.float32)


def stereoize(x, pan=0.0):
    """mono (n,) -> (2,n) equal-power pan, pan in [-1,1]."""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)]).astype(np.float32)


def make_ir(rt60=1.9, seed=1, damp=5500, pre=0.014, n_s=None):
    n = int((n_s or rt60 * 1.35) * SR)
    t = np.arange(n) / SR
    rng = np.random.default_rng(seed)
    ir = rng.standard_normal(n) * np.exp(-t * 6.91 / rt60)
    ir = signal.sosfilt(signal.butter(2, damp, 'lowpass', fs=SR, output='sos'), ir)
    ir *= np.minimum(1, t / 0.01)
    ir = np.concatenate([np.zeros(int(pre * SR)), ir])
    return (ir / np.sqrt(np.sum(ir ** 2))).astype(np.float64)


def reverb(x2, rt60=1.9, damp=5500):
    """x2 (2,N) -> wet (2,N)."""
    wet = np.zeros_like(x2, dtype=np.float64)
    for c in range(2):
        ir = make_ir(rt60, seed=100 + c, damp=damp)
        wet[c] = signal.fftconvolve(x2[c], ir)[: x2.shape[1]]
    return wet


# ---------------- loudness (ITU-R BS.1770-4, 48 kHz) ----------------
_K1 = (np.array([1.53512485958697, -2.69169618940638, 1.19839281085285]),
       np.array([1.0, -1.69065929318241, 0.73248077421585]))
_K2 = (np.array([1.0, -2.0, 1.0]), np.array([1.0, -1.99004745483398, 0.99007225036621]))


def lufs(x):
    """Integrated loudness of (2,N) float array."""
    y = np.stack([signal.lfilter(*_K2, signal.lfilter(*_K1, c)) for c in x])
    blk, step = int(0.4 * SR), int(0.1 * SR)
    cs = np.concatenate([np.zeros((2, 1)), np.cumsum(y ** 2, axis=1)], axis=1)
    starts = np.arange(0, y.shape[1] - blk + 1, step)
    ms = (cs[:, starts + blk] - cs[:, starts]) / blk
    z = ms.sum(axis=0)
    l = -0.691 + 10 * np.log10(np.maximum(z, 1e-12))
    g1 = z[l > -70]
    if len(g1) == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(g1.mean()) - 10
    g2 = z[l > rel]
    return float(-0.691 + 10 * np.log10(g2.mean()))


def true_peak_db(x):
    o = signal.resample_poly(x, 4, 1, axis=1)
    return float(20 * np.log10(np.max(np.abs(o)) + 1e-12))


def limiter(x, ceil_db, look_ms=3.0):
    L = int(look_ms * SR / 1000)
    ceil = 10 ** (ceil_db / 20)
    peak = np.max(np.abs(x), axis=0)
    need = np.minimum(1.0, ceil / np.maximum(peak, 1e-9))
    g = minimum_filter1d(need, size=2 * L + 1, mode='nearest')
    g = uniform_filter1d(g, size=2 * L + 1, mode='nearest')
    return x * g


def normalize_to_lufs(x, target=-14.0, tp_max=-1.0):
    ceil = tp_max - 0.25
    y = x
    for _ in range(8):
        g = 10 ** ((target - lufs(y)) / 20)
        y = limiter(y * g, ceil)
        tp = true_peak_db(y)
        if tp > tp_max:
            ceil -= (tp - tp_max) + 0.05
    # final convergence on loudness
    for _ in range(4):
        d = target - lufs(y)
        if abs(d) < 0.02:
            break
        y = limiter(y * 10 ** (d / 20), ceil)
        tp = true_peak_db(y)
        if tp > tp_max:
            ceil -= (tp - tp_max) + 0.05
            y = limiter(y, ceil)
    return y
