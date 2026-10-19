"""Bar-by-bar scores: main film (28 bars) and teaser (9 bars)."""
from arrange import *  # noqa

HOOK = [(0, 0, 1.0), (2, 1, .85), (4, 2, .9), (6, 3, 1.0), (8, 4, .7), (10, 3, .6), (12, 2, .6), (14, 1, .5)]
SPARSE = [(0, 0, .8), (3, 2, .55), (6, 1, .55), (10, 3, .5), (12, 2, .45)]
THIN = [(0, 0, .6), (6, 2, .4), (12, 1, .4)]
MID = [(p, i, 0.75 if p % 4 == 0 else 0.55) for p, i in zip(range(0, 16, 2), [0, 2, 1, 3, 2, 4, 3, 2])]
DRIVE = [(p, i, 0.8 if p % 4 == 0 else 0.5) for p, i in zip(range(16), [0, 1, 2, 3, 4, 3, 2, 1] * 2)]
SOFTARP = [(p, i, 0.6 if p % 8 == 0 else 0.4) for p, i in zip(range(0, 16, 4), [0, 2, 1, 3])]


def groove(A, bar, ch, kind, v=1.0):
    if kind == 'light':
        A.duck = 0.15
        A.kick(bar, 0, 0.65 * v); A.kick(bar, 8, 0.4 * v)
        for p in range(0, 16, 2):
            A.shk(bar, p, (0.55 if p % 4 == 0 else 0.35) * v, var=p)
        A.rim(bar, 12, 0.4 * v)
        A.bass_groove(bar, ch, 'sparse', 0.7 * v)
    elif kind == 'tense':
        A.duck = 0.0
        A.kick(bar, 0, 0.45 * v)
        A.hat(bar, 6, 0.3 * v, var=1); A.hat(bar, 14, 0.3 * v, var=2)
        if bar % 2 == 1:
            A.rim(bar, 10, 0.3 * v, 1500)
    elif kind == 'full' or kind == 'drive':
        A.duck = 0.34
        for p, vv in ((0, 1.0), (4, .85), (8, .95), (12, .85)):
            A.kick(bar, p, vv * v)
        if kind == 'drive':
            A.kick(bar, 14, 0.5 * v)
        A.clap(bar, 4, 0.8 * v, 0); A.clap(bar, 12, 0.85 * v, 1)
        for p in (2, 6, 10, 14):
            A.hat(bar, p, 0.7 * v, open_=(p == 14 and kind == 'full'), var=p)
        for p in range(16):
            if kind == 'full' and p % 2:
                continue
            A.shk(bar, p, (0.55 if p % 4 == 0 else 0.35) * v, var=p)
        if kind == 'drive':
            for p in (1, 5, 9, 13):
                A.hat(bar, p, 0.3 * v, var=p + 3)
        A.bass_groove(bar, ch, 'full' if kind == 'full' else 'drive', 1.0 * v)
    elif kind == 'mem':
        A.duck = 0.12
        A.kick(bar, 0, 0.55 * v)
        A.rim(bar, 4, 0.35 * v, 1500); A.rim(bar, 12, 0.3 * v, 1500)
        for p in (0, 4, 8, 12):
            A.shk(bar, p, 0.3 * v, var=p)
        A.bass_groove(bar, ch, 'half', 0.7 * v, 0.7)


def main_film():
    A = Arr(28)
    CH = {1: 'D', 2: 'A', 3: 'Bm', 4: 'Bdim', 5: 'Gm', 6: 'A7',
          7: 'D', 8: 'A', 9: 'Bm', 10: 'G', 11: 'A',
          12: 'Bm', 13: 'G', 14: 'A', 15: 'G',
          16: 'D', 17: 'A', 18: 'Bm',
          19: 'Gmaj7', 20: 'DF', 21: 'Bm7', 22: 'A',
          23: 'Bm', 24: 'G', 25: 'A',
          26: 'D', 27: 'D', 28: 'D'}
    # ---- B1 (bars 1-3): sparse but moving from frame 0
    for b in (1, 2, 3):
        groove(A, b, CH[b], 'light')
        A.arp(b, CH[b], HOOK if b == 1 else SPARSE, v=0.95 if b == 1 else 0.8, lo=74, bright=1.0, decay=2.6)
        A.padc(b, 1, CH[b], v=0.55 + 0.1 * b, cutoff=1300, det=8, attack=0.25 if b == 1 else 0.6, release=0.5)
    A.revswell(3, 12, 78, 4, 0.5)  # into B2
    # ---- B2 (bars 4-6): context breaks - detuned, filtered, rhythm partly out
    for b in (4, 5, 6):
        groove(A, b, CH[b], 'tense')
        A.arp(b, CH[b], THIN, v=0.8, lo=70, bright=0.35, det=22, decay=3.2, pan=0.4)
        A.padc(b, 1, CH[b], v=0.85, cutoff=700, det=26, attack=0.9, release=0.7)
        A.bassn(b, 0, ROOT[CH[b]], 14, 0.55, 0.3)
    A.riser(6, 0, 16, 0.55, 400, 6500)
    for i, p in enumerate(range(10, 16)):
        A.hat(6, p, 0.25 + 0.12 * i, var=i)
    A.fill(6, 0.9, 12)
    # ---- B3 (bars 7-11): PM Agent connects - full groove, thread motif
    phr = {7: PH_A, 8: PH_B, 9: PH_C, 10: PH_D}
    for b in range(7, 12):
        groove(A, b, CH[b], 'full')
        A.arp(b, CH[b], MID, v=0.7, lo=62, bright=1.0, decay=3.0, pan=0.3)
        A.padc(b, 1, CH[b], v=1.0, cutoff=2200, det=10, attack=0.35, release=0.5)
        if b in phr:
            A.phrase(b, phr[b], v=1.0)
    A.phrase(11, PH_B[:3] + [(8, 85, 2), (10, 83, 2), (12, 81, 4)], v=0.9)  # lead-in variant over A
    A.fill(11, 0.7, 12)
    # ---- B4 (bars 12-15): decision moment - breakdown, click accent on bar 14 beat 3 (f810)
    A.duck = 0.1
    A.kick(12, 0, 0.5); A.kick(12, 8, 0.35)
    A.padc(12, 1, 'Bm', 0.9, 1400, 9, 0.4, 0.5)
    A.bass_groove(12, 'Bm', 'half', 0.6, 0.6)
    A.arp(12, 'Bm', SOFTARP, 0.7, 70, 0.7, 4, 2.6)
    A.phrase(12, PH_C[:3], v=0.7, shift=0, bright=0.6)
    A.padc(13, 1, 'G', 0.8, 1000, 9, 0.5, 0.6)
    A.bassn(13, 0, 43, 14, 0.5, 0.5)
    A.arp(13, 'G', [(0, 0, .5), (8, 2, .4)], 0.6, 70, 0.5, 4, 2.8)
    A.rim(13, 8, 0.25, 1500)
    A.padc(14, 1, 'A', 0.85, 1100, 9, 0.5, 0.15, extra=0.0)
    A.arp(14, 'A', [(0, 0, .6), (2, 1, .6), (4, 2, .7), (6, 3, .8)], 0.8, 74, 0.9, 0, 3.0, pan=0.3)
    A.bassn(14, 0, 45, 6.5, 0.6, 0.6)
    A.riser(14, 0, 8, 0.4, 600, 5000)
    A.gaps.append((T(14, 7), T(14, 8)))                     # stop-time breath before the hit
    A.hit(14, 8, 'click', 1.0)
    A.arp(14, 'D', [(10, 2, .5), (12, 3, .5), (14, 4, .45)], 0.6, 74, 1.0, 0, 3.0)  # tones come from D chord
    A.padc(15, 1, 'G', 0.9, 1600, 9, 0.7, 0.5)
    A.duck = 0.25
    A.kick(15, 0, 0.8); A.kick(15, 8, 0.7); A.kick(15, 12, 0.7)
    A.bass_groove(15, 'G', 'half', 0.9)
    for p in range(0, 16, 2):
        A.shk(15, p, 0.4 + 0.02 * p, var=p)
    A.arp(15, 'G', MID, 0.65, 62, 1.0, 0, 3.0)
    A.fill(15, 0.6, 12)
    A.riser(15, 0, 16, 0.35, 500, 7000)
    # ---- B5 (bars 16-18): steady drive
    for b in (16, 17, 18):
        groove(A, b, CH[b], 'drive')
        A.arp(b, CH[b], DRIVE, v=0.62, lo=62, bright=1.1, decay=3.4, pan=0.35)
        A.padc(b, 1, CH[b], v=1.0, cutoff=2600, det=10, attack=0.3, release=0.5)
    A.phrase(16, PH_A, 0.9); A.phrase(17, PH_B, 0.9); A.phrase(18, PH_C, 0.9)
    A.fill(18, 0.9, 12)
    # ---- B6 (bars 19-22): "2 weeks later" - softer, motif reversed & lower register
    for b in (19, 20, 21, 22):
        groove(A, b, CH[b], 'mem')
        A.padc(b, 1, CH[b], v=1.15, cutoff=1500, det=7, attack=0.8, release=0.8)
    A.revswell(18, 12, 74, 4, 0.55)
    A.phrase(19, PH_A, 0.85, shift=-12, bright=0.5, det=4, decay=1.4, rev=True)
    A.phrase(20, PH_B, 0.8, shift=-12, bright=0.5, det=4, decay=1.4, rev=True)
    A.phrase(21, PH_C, 0.8, shift=-12, bright=0.5, det=4, decay=1.4, rev=True)
    A.phrase(22, PH_D, 0.8, shift=-12, bright=0.5, det=4, decay=1.4, rev=True)
    A.arp(19, 'Gmaj7', SOFTARP, 0.4, 74, 0.5, 6, 1.6, 0.5)
    A.arp(21, 'Bm7', SOFTARP, 0.4, 74, 0.5, 6, 1.6, 0.5)
    A.riser(22, 0, 16, 0.5, 400, 7000)
    A.revswell(22, 12, 74, 4, 0.8)
    # ---- B7 (bars 23-25): widening
    for b in (23, 24, 25):
        groove(A, b, CH[b], 'drive')
        A.arp(b, CH[b], DRIVE, v=0.6, lo=62, bright=1.2, decay=3.4, pan=0.55)
        A.padc(b, 1, CH[b], v=1.15, cutoff=4200, det=14, attack=0.25, release=0.5, wide=True)
    A.phrase(23, PH_C, 0.95); A.phrase(24, PH_D, 0.95)
    A.phrase(25, PH_B, 0.95)
    A.fill(25, 1.0, 8)
    A.riser(25, 8, 8, 0.7, 500, 8000)
    # ---- Closing (bars 26-28): resolve on tonic, wordmark hit at bar 27 downbeat (f1560)
    A.duck = 0.1
    A.padc(26, 1, 'D', 1.1, 2200, 9, 0.4, 0.25, wide=True, extra=0.05)
    A.phrase(26, PH_R, 1.0, bright=1.0, decay=1.5)
    A.arp(26, 'D', SOFTARP, 0.45, 74, 0.8, 0, 2.2, 0.4)
    A.kick(26, 0, 0.7)
    A.bassn(26, 0, 38, 15, 0.8, 0.8)
    for p in (0, 4, 8, 12):
        A.shk(26, p, 0.3, var=p)
    A.revswell(26, 10, 86, 6, 0.9)
    A.revswell(26, 8, 74, 8, 0.6)
    A.hit(27, 0, 'final', 1.0)
    A.phrase(27, [(10, 86, 6)], 0.4, bright=0.7, decay=1.2)
    return A, CH


def teaser():
    A = Arr(9)
    CH = {1: 'D', 2: 'A', 3: 'Bm', 4: 'G', 5: 'D', 6: 'A', 7: 'G', 8: 'D', 9: 'D'}
    # bars 1-2: hook from frame 0
    groove(A, 1, 'D', 'light', 1.3)
    A.arp(1, 'D', HOOK, 0.95, 74, 1.0, 0, 2.6)
    A.padc(1, 1, 'D', 0.6, 1400, 8, 0.2, 0.4)
    A.phrase(1, PH_A, 0.6)
    groove(A, 2, 'A', 'light', 1.4)
    A.arp(2, 'A', MID, 0.8, 74, 1.0, 0, 2.8)
    A.padc(2, 1, 'A', 0.8, 1600, 9, 0.3, 0.4)
    A.phrase(2, PH_B, 0.8)
    A.hat(2, 14, 0.4); A.fill(2, 0.7, 12)
    A.riser(2, 4, 12, 0.35, 500, 7000)
    # bars 3-6: lift
    ph = {3: PH_C, 4: PH_D, 5: PH_A, 6: PH_B}
    for b in (3, 4, 5, 6):
        groove(A, b, CH[b], 'full' if b < 5 else 'drive')
        A.arp(b, CH[b], MID if b < 5 else DRIVE, 0.65, 62, 1.1, 0, 3.2, 0.35)
        A.padc(b, 1, CH[b], 1.0, 2800, 10, 0.3, 0.5, wide=(b >= 5))
        A.phrase(b, ph[b], 1.0)
    A.revswell(2, 12, 74, 4, 0.7)
    # bar 7: pre-resolve fill
    groove(A, 7, 'G', 'drive')
    A.arp(7, 'G', DRIVE, 0.6, 62, 1.1, 0, 3.2, 0.4)
    A.padc(7, 1, 'G', 1.0, 3000, 10, 0.3, 0.3, wide=True, extra=0.05)
    A.phrase(7, PH_D, 1.0)
    A.fill(7, 1.0, 8)
    A.riser(7, 8, 8, 0.7, 500, 8000)
    # bar 8: resolve + hit; bar 9 ring-out
    A.duck = 0.1
    A.hit(8, 0, 'final', 1.0)
    A.phrase(8, [(p + 0, m, l) for p, m, l in PH_R], 0.95, bright=1.0, decay=1.5)
    A.bassn(8, 0, 38, 8, 0.0, 0.8)
    return A, CH
