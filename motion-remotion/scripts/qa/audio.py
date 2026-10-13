# QA: audio sanity of the rendered mp4: integrated RMS per beat and a music-only vs mixed difference around each SFX
# usage: audio.py <mix.wav> <music-v5.wav>   (mix.wav = ffmpeg -i mp4 -ac 2 -ar 48000 mix.wav)
import sys, wave
import numpy as np
def load(p):
    w = wave.open(p)
    n = w.getnframes()
    raw = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768
    return raw.reshape(-1, w.getnchannels()).mean(axis=1), w.getframerate()
mix, sr = load(sys.argv[1])
mus, sr2 = load(sys.argv[2])
n = min(len(mix), len(mus))
mix, mus = mix[:n], mus[:n]
db = lambda x: 20 * np.log10(np.sqrt((x ** 2).mean()) + 1e-9)
print(f'duration {n/sr:.2f}s  mix RMS {db(mix):.1f} dBFS  music RMS {db(mus):.1f} dBFS  mix peak {np.abs(mix).max():.3f}')
diff = mix - mus
events = [('typing', 66), ('chip-morph', 180), ('chip-morph', 195), ('chip-morph', 210), ('click', 275), ('chip-morph', 374), ('capsule-arrive', 390), ('thread-draw', 390), ('click', 420), ('thread-draw', 465), ('chip-morph', 495), ('thread-draw', 510), ('capsule-arrive', 540)]
for name, f in events:
    a, b = int(f / 30 * sr), int((f + 20) / 30 * sr)
    print(f'  {name:15s} f{f:4d}: sfx RMS {db(diff[a:b]):6.1f} dB vs music {db(mus[a:b]):6.1f} dB  (sfx peak {np.abs(diff[a:b]).max():.3f})')
