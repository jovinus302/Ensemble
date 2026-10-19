"""Score + arrangement for the Ensemble pitch film (D major, 120 BPM, 4/4)."""
import numpy as np
from synth import *  # noqa

BPM, FPS = 120, 30
BAR = 96000            # 2.0 s
S16 = BAR // 16        # 6000 samples
FRAME = SR // FPS      # 1600 samples

PAD = {  # voicings (midi)
    'D': [50, 57, 62, 66], 'A': [52, 57, 61, 64], 'Bm': [50, 54, 59, 62], 'G': [50, 55, 59, 62],
    'Bdim': [50, 53, 59, 62], 'Gm': [50, 55, 58, 62], 'A7': [52, 55, 57, 61],
    'Gmaj7': [50, 55, 59, 66], 'DF': [50, 54, 57, 62], 'Bm7': [50, 54, 57, 59], 'Dmaj7': [50, 57, 61, 66],
}
ROOT = {'D': 38, 'A': 45, 'Bm': 47, 'G': 43, 'Bdim': 47, 'Gm': 43, 'A7': 45,
        'Gmaj7': 43, 'DF': 42, 'Bm7': 47, 'Dmaj7': 38}

# the "thread" motif (pos16, midi, len16); phrases over D / A / Bm / G, and the tonic resolution
PH_A = [(0, 74, 2), (2, 78, 2), (4, 81, 4), (8, 83, 2), (10, 81, 2), (12, 78, 4)]
PH_B = [(0, 76, 2), (2, 81, 2), (4, 85, 4), (8, 83, 2), (10, 81, 2), (12, 76, 4)]
PH_C = [(0, 74, 2), (2, 78, 2), (4, 83, 4), (8, 81, 2), (10, 78, 2), (12, 74, 4)]
PH_D = [(0, 79, 2), (2, 83, 2), (4, 86, 4), (8, 83, 2), (10, 79, 2), (12, 74, 4)]
PH_R = [(0, 76, 2), (2, 78, 2), (4, 81, 2), (6, 78, 2), (8, 74, 8)]   # resolves on D


def chord_tones(ch, lo, n=5):
    pcs = sorted({m % 12 for m in PAD[ch]})
    out, m = [], lo
    while len(out) < n:
        if m % 12 in pcs:
            out.append(m)
        m += 1
    return out


def T(bar, pos=0.0):
    return int(round((bar - 1) * BAR + pos * S16))


STEMS = ['kick', 'drums', 'bass', 'pad', 'arp', 'lead', 'fx', 'hit']
SEND = {'kick': 0, 'drums': 0.10, 'bass': 0, 'pad': 0.30, 'arp': 0.26, 'lead': 0.34, 'fx': 0.45, 'hit': 0.42}
GAIN = {'kick': 0.95, 'drums': 0.55, 'bass': 0.62, 'pad': 0.30, 'arp': 0.26, 'lead': 0.34, 'fx': 0.30, 'hit': 0.55}


class Arr:
    def __init__(self, bars):
        self.N = bars * BAR
        self.M = self.N + 4 * SR
        self.s = {k: np.zeros((2, self.M), np.float32) for k in STEMS}
        self.kicks = []          # (sample, vel) for sidechain ducking
        self.gaps = []           # (start, end) stop-time gaps applied to all stems except 'hit'
        self.duck = 0.3          # sidechain depth used by kick() calls (set per section)
        self.markers = []

    def put(self, stem, sig, start, g=1.0, pan=0.0):
        if sig.ndim == 1:
            sig = stereoize(sig, pan)
        elif pan != 0:
            sig = sig * np.array([[np.cos((pan + 1) * np.pi / 4)], [np.sin((pan + 1) * np.pi / 4)]], np.float32) * 1.414
        if start < 0 or start >= self.M:
            return
        n = min(sig.shape[1], self.M - start)
        self.s[stem][:, start:start + n] += sig[:, :n] * g

    # --- drums
    def kick(self, bar, pos, v=1.0):
        st = T(bar, pos)
        self.put('kick', kick(), st, v)
        self.kicks.append((st, v * self.duck))

    def clap(self, bar, pos, v=1.0, var=0):
        self.put('drums', clap(var), T(bar, pos), v * 0.8, 0.05)

    def hat(self, bar, pos, v=1.0, open_=False, var=0):
        self.put('drums', hat(open_, var), T(bar, pos), v * 0.45, -0.25)

    def shk(self, bar, pos, v=1.0, var=0):
        self.put('drums', shaker(var), T(bar, pos), v * 0.55, 0.3)

    def rim(self, bar, pos, v=1.0, f=1900.0):
        self.put('drums', rim(f), T(bar, pos), v * 0.5, 0.15)

    # --- bass
    def bassn(self, bar, pos, midi, l16, v=1.0, bright=1.0):
        d = max(0.08, l16 * S16 / SR)
        self.put('bass', bass(midi, d, bright), T(bar, pos), v)

    def bass_groove(self, bar, ch, style='full', v=1.0, bright=1.0):
        r = ROOT[ch]
        if style == 'full':
            pat = [(0, r, 5.5), (6, r, 1.6), (8, r, 3.6), (12, r + 7, 1.8), (14, r, 1.8)]
        elif style == 'drive':
            pat = [(0, r, 2.6), (3, r, 2), (6, r, 1.6), (8, r, 2.6), (11, r, 2), (14, r + 12, 1.8)]
        elif style == 'half':
            pat = [(0, r, 7.5), (8, r, 7)]
        elif style == 'long':
            pat = [(0, r, 15.5)]
        else:
            pat = [(0, r, 3), (8, r + 7, 3)]
        for p, m, l in pat:
            self.bassn(bar, p, m, l, v, bright)

    # --- harmony
    def padc(self, bar, nbars, ch, v=1.0, cutoff=1800.0, det=9.0, attack=0.5, release=0.6, wide=False, decay=0.0, extra=0.35):
        d = nbars * BAR / SR + extra
        notes = list(PAD[ch])
        if wide:
            notes += [notes[1] + 12, notes[3] + 12, notes[0] - 12]
        for i, m in enumerate(notes):
            vel = v * (0.7 if (wide and i >= 4) else 1.0)
            self.put('pad', pad(m, round(d, 3), cutoff, det, attack, release, decay), T(bar), vel * 0.6)

    def arp(self, bar, ch, pat, v=1.0, lo=74, bright=1.0, det=0.0, decay=2.4, pan=0.25, stem='arp'):
        tones = chord_tones(ch, lo)
        for i, (p, idx, vel) in enumerate(pat):
            m = tones[idx % len(tones)]
            dur = round(min(1.6, 4.5 / decay), 2)
            self.put(stem, pluck(m, dur, bright, det, decay), T(bar, p), v * vel, pan * (1 if i % 2 else -1))

    def phrase(self, bar, notes, v=1.0, shift=0, bright=1.0, det=3.0, decay=1.8, pan=0.08, rev=False, stem='lead'):
        notes = list(notes)
        if rev:
            ps = [n[1] for n in notes][::-1]
            notes = [(n[0], ps[i], n[2]) for i, n in enumerate(notes)]
        for p, m, l in notes:
            self.put(stem, pluck(m + shift, 2.2, bright, det, decay), T(bar, p), v * (1.0 if p % 4 == 0 else 0.8), pan)

    # --- fx
    def riser(self, bar, pos, l16, v=1.0, f0=500, f1=7500):
        d = round(l16 * S16 / SR, 3)
        x = sweep_noise(d, f0, f1).astype(np.float64)
        x = x * (np.arange(len(x)) / len(x)) ** 2.2
        x[-int(0.004 * SR):] *= np.linspace(1, 0, int(0.004 * SR))
        self.put('fx', stereoize(x * 0.5), T(bar, pos), v)

    def revswell(self, bar, pos, midi, l16, v=1.0, bright=0.8):
        """reversed pluck/chord swell ending exactly at bar,pos + l16."""
        d = l16 * S16 / SR
        x = pluck(midi, round(d + 0.3, 3), bright, 5.0, 2.0)[:, ::-1]
        x = x[:, -int(d * SR):] * (np.arange(int(d * SR)) / (d * SR)) ** 1.5
        self.put('fx', x.astype(np.float32), T(bar, pos), v)

    def fill(self, bar, v=1.0, from_pos=8):
        for i, p in enumerate(range(from_pos, 16)):
            self.clap(bar, p, v * (0.3 + 0.7 * i / (16 - from_pos)), var=i % 2)

    def hit(self, bar, pos, kind='final', v=1.0):
        st = T(bar, pos)
        if kind == 'final':
            notes = [38, 50, 57, 62, 66, 69, 74]
            dec = 1.05
            sub = 1.0
        else:  # click accent
            notes = [50, 57, 62, 66, 69, 74]
            dec = 1.5
            sub = 0.55
        for i, m in enumerate(notes):
            self.put('hit', pluck(m, 2.6, 0.9, 6.0, dec), st, v * 0.5 * (1.0 if m < 70 else 0.7), (i - 3) * 0.12)
        for i, m in enumerate([50, 57, 62, 66] if kind == 'final' else [50, 57, 66]):
            self.put('hit', pad(m, 2.9, 1400.0, 7.0, 0.02, 0.9, 0.85 if kind == 'final' else 0.55), st, v * 0.42)
        n = int(1.6 * SR)
        t = np.arange(n) / SR
        boom = np.sin(2 * np.pi * (36.7 * t + 55 * (1 - np.exp(-14 * t)) / 14)) * np.exp(-t * (2.3 if kind == 'final' else 4.5))
        boom[-200:] *= np.linspace(1, 0, 200)
        self.put('hit', boom.astype(np.float32), st, v * 0.8 * sub)
        air = lp(noise(int(0.8 * SR), 77), 1800) * np.exp(-np.arange(int(0.8 * SR)) / SR * 5)
        self.put('hit', stereoize(air * 0.5), st, v * 0.35 * sub)
        self.put('hit', kick(), st, v * 0.8)
        self.kicks.append((st, 0.3))

    # --- render
    def render(self):
        N, M = self.N, self.M
        duck = np.ones(M, np.float32)
        for st, v in self.kicks:
            n = int(0.22 * SR)
            if st + n >= M:
                n = M - st - 1
            t = np.arange(n) / SR
            dep = v
            duck[st:st + n] *= (1 - dep * np.minimum(1, t / 0.004) * np.exp(-t / 0.13)).astype(np.float32)
        gapc = np.ones(M, np.float32)
        for a, b in self.gaps:
            r = int(0.008 * SR)
            gapc[a - r:a] *= np.linspace(1, 0.08, r)
            gapc[a:b] *= 0.08
            gapc[b:b + r] *= np.linspace(0.08, 1, r)
        mix = np.zeros((2, M), np.float64)
        send = np.zeros((2, M), np.float64)
        dsend = np.zeros((2, M), np.float64)
        for k in STEMS:
            x = self.s[k].astype(np.float64) * GAIN[k]
            if k in ('pad', 'bass', 'arp'):
                x *= duck
            if k != 'hit':
                x *= gapc
            mix += x
            send += x * SEND[k]
            if k in ('lead', 'arp'):
                dsend += x * (0.30 if k == 'lead' else 0.16)
        # ping-pong dotted-8th delay
        dl = lp(hp(dsend[0] + dsend[1], 250), 3200)
        dly = np.zeros((2, M))
        for i in range(1, 5):
            off = 3 * S16 * i
            if off < M:
                dly[i % 2, off:] += dl[: M - off] * (0.45 ** i)
        mix += dly
        send += dly * 0.3
        wet = reverb(send, 1.9, 5500)
        mix += wet * 0.9
        mix = signal.sosfilt(signal.butter(2, 28, 'highpass', fs=SR, output='sos'), mix, axis=1)
        mix = mix[:, :N]
        # end: natural ring-out then clean cosine fade
        nf = int(0.45 * SR)
        mix[:, -nf:] *= (np.cos(np.linspace(0, np.pi / 2, nf)) ** 2)
        return mix
