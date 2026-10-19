"""One-command generator: python scripts/audio/generate.py  (deterministic, no external audio)."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.ndimage import uniform_filter1d

sys.path.insert(0, str(Path(__file__).resolve().parent))
from synth import SR, lufs, true_peak_db, normalize_to_lufs  # noqa: E402
from scores import main_film, teaser  # noqa: E402
from arrange import BAR, FRAME, FPS, BPM  # noqa: E402
import sfx as sfxmod  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public' / 'audio'
(OUT / 'sfx').mkdir(parents=True, exist_ok=True)


def find_ffmpeg():
    p = shutil.which('ffmpeg')
    if p:
        return p
    c = ROOT / 'node_modules' / '@remotion' / 'compositor-win32-x64-msvc' / 'ffmpeg.exe'
    return str(c) if c.exists() else None


def write_wav(path, x, seed=1):
    """x: (2,N) float [-1,1] -> 16-bit stereo with seeded TPDF dither."""
    rng = np.random.default_rng(seed)
    d = (rng.random(x.shape) - rng.random(x.shape)) / 32768.0
    y = np.clip(x + d, -1, 1)
    wavfile.write(str(path), SR, np.round(y.T * 32767).astype(np.int16))


def env_1ms(x, hp_hz=None):
    m = x.mean(axis=0)
    if hp_hz:
        from synth import hp
        m = hp(m, hp_hz, 4)
    return np.sqrt(np.maximum(uniform_filter1d(m ** 2, 48), 0))


def measure(env, planned_f, lo_f=-1, hi_f=2, henv=None):
    """peak = max of the 1 ms full-band envelope in the window; onset = first sample exceeding 12% of the
    window's rise above its floor (same envelope). Window is +-1..2 frames around the planned frame."""
    a = max(0, (planned_f + lo_f) * FRAME)
    b = min(len(env), (planned_f + hi_f) * FRAME)
    pk = a + int(np.argmax(env[a:b]))
    e = env[a:b]
    d = e - e[:48].min()
    on = a + int(np.argmax(d > 0.12 * d.max()))
    return pk, on


def section_rms(x, secs):
    out = {}
    for s in secs:
        seg = x[:, s['startFrame'] * FRAME: s['endFrame'] * FRAME]
        out[s['id']] = round(float(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9)), 2)
    return out


def sections(spec, fpb=BAR // FRAME):
    return [{'id': i, 'bars': [a, b], 'startFrame': (a - 1) * fpb, 'endFrame': b * fpb} for i, a, b in spec]


def accents(x, plan):
    env, henv = env_1ms(x), env_1ms(x, 1500)
    res = []
    for label, f, note in plan:
        pk, on = measure(env, f, henv=henv)
        res.append({'label': label, 'plannedFrame': f, 'measuredPeakSample': pk, 'measuredPeakFrame': round(pk / FRAME, 2),
                    'measuredOnsetSample': on, 'measuredOnsetFrame': round(on / FRAME, 2), 'note': note})
    return res


def ffmpeg_measure(ff, path):
    if not ff:
        return None
    r = subprocess.run([ff, '-hide_banner', '-nostats', '-i', str(path), '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
                        '-f', 'null', '-'], capture_output=True, text=True)
    m = re.search(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr, re.S)
    return json.loads(m.group(0)) if m else None


def main():
    ff = find_ffmpeg()
    info = {}
    # ---------- main film
    A, CH = main_film()
    x = A.render()
    assert x.shape[1] == 56 * SR
    x = normalize_to_lufs(x, -14.0, -1.0)
    write_wav(OUT / 'music-v5.wav', x, 11)
    main_secs = sections([('B1', 1, 3), ('B2', 4, 6), ('B3', 7, 11), ('B4', 12, 15), ('B5', 16, 18),
                          ('B6', 19, 22), ('B7', 23, 25), ('Closing', 26, 28)])
    plan = [('hook-first-pluck', 0, 'first note, no silent intro'),
            ('b3-motif-entry+full-groove', 360, 'bar 7 downbeat: kick + thread motif'),
            ('b4-click-accent', 810, 'bar 14 beat 3 (stop-time gap one 16th before)'),
            ('b5-drive-downbeat', 900, 'bar 16 downbeat'),
            ('b6-reversed-motif', 1080, 'bar 19 downbeat, lower register reversed motif'),
            ('b7-widening', 1320, 'bar 23 downbeat'),
            ('motif-resolve', 1500, 'bar 26 downbeat, phrase resolves on D'),
            ('final-hit-wordmark', 1560, 'bar 27 downbeat')]
    acc = accents(x, plan)
    # sample-accurate bar alignment: every downbeat kick in the (pre-master) kick stem starts exactly at (bar-1)*96000
    ks = A.s['kick'][0]
    downs = [st for st, _ in A.kicks if st % BAR == 0]  # downbeat kicks
    exact = all(st % 6000 == 0 and (abs(ks[st + 1]) > 0 or st in (13 * BAR + 8 * 6000, 26 * BAR)) for st, _ in A.kicks)  # last two = 'hit' stem kicks   # all kick starts on the 16th-note sample grid
    devs = [0.0]
    # ---------- teaser
    At, CHt = teaser()
    xt = At.render()
    assert xt.shape[1] == 18 * SR
    xt = normalize_to_lufs(xt, -14.0, -1.0)
    write_wav(OUT / 'music-v5-teaser.wav', xt, 12)
    t_secs = sections([('hook', 1, 2), ('lift', 3, 6), ('resolve', 7, 8), ('ringout', 9, 9)])
    t_acc = accents(xt, [('hook-first-pluck', 0, 'bar 1'), ('lift', 120, 'bar 3 downbeat: full groove + motif'),
                         ('drive', 240, 'bar 5 downbeat'), ('final-hit-resolve', 420, 'bar 8 downbeat')])
    # ---------- sfx
    sfx_list = []
    for name, (fn, desc, peak_db) in sfxmod.SFX.items():
        y = fn().astype(np.float64)
        y = y / np.max(np.abs(y)) * 10 ** (peak_db / 20)
        st = np.stack([y, y])
        if name in ('thread-draw', 'wordmark-land'):  # tiny haas widening for air
            k = int(0.0007 * SR)
            st[1] = np.concatenate([np.zeros(k), y[:-k]])
        write_wav(OUT / 'sfx' / f'{name}.wav', st, 20)
        sfx_list.append({'file': f'audio/sfx/{name}.wav', 'durationSec': round(len(y) / SR, 3),
                         'peakDb': peak_db, 'description': desc})
    # ---------- preview + cross-check
    ff_main = ffmpeg_measure(ff, OUT / 'music-v5.wav')
    if ff:
        subprocess.run([ff, '-y', '-hide_banner', '-loglevel', 'error', '-i', str(OUT / 'music-v5.wav'), '-codec:a', 'libmp3lame',
                        '-b:a', '192k', str(OUT / 'music-v5-preview.mp3')], check=True)
    timing = {
        'bpm': BPM, 'fps': FPS, 'sampleRate': SR, 'key': 'D major', 'framesPerBar': BAR // FRAME,
        'totalFrames': 1680, 'durationSec': 56.0,
        'file': 'audio/music-v5.wav',
        'sections': main_secs,
        'downbeats': [i * 60 for i in range(28)],
        'accents': acc,
        'chords': {str(k): v for k, v in CH.items()},
        'teaser': {'file': 'audio/music-v5-teaser.wav', 'totalFrames': 540, 'durationSec': 18.0, 'sections': t_secs,
                   'downbeats': [i * 60 for i in range(9)], 'accents': t_acc},
        'sfx': sfx_list,
        'loudness': {
            'main': {'integratedLUFS': round(lufs(x), 2), 'truePeakDBTP': round(true_peak_db(x), 2),
                     'samplePeakDBFS': round(float(20 * np.log10(np.abs(x).max())), 2), 'sectionRmsDB': section_rms(x, main_secs),
                     'ffmpegLoudnormInput': ff_main},
            'teaser': {'integratedLUFS': round(lufs(xt), 2), 'truePeakDBTP': round(true_peak_db(xt), 2),
                       'sectionRmsDB': section_rms(xt, t_secs)},
        },
        'verification': {'allKickStartsOnSixteenthSampleGrid': bool(exact), 'downbeatKickCount': len(downs), 'barSamples': BAR,
                         'mainSamples': int(x.shape[1]), 'teaserSamples': int(xt.shape[1])},
    }
    (OUT / 'timing.json').write_text(json.dumps(timing, indent=2, ensure_ascii=False), encoding='utf8')
    print(json.dumps({k: timing[k] for k in ('loudness', 'verification')}, indent=1, ensure_ascii=False))
    for a in acc + t_acc:
        print(a['label'], a['plannedFrame'], a['measuredPeakFrame'], a['measuredOnsetFrame'])


if __name__ == '__main__':
    main()
