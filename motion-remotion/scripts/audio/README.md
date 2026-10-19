# Ensemble v5 audio (fully procedural)

All music and SFX are synthesized in code (numpy/scipy). No samples, loops or external audio.

Regenerate (deterministic, ~20 s, byte-identical output):

    cd motion-remotion
    pip install --user numpy scipy      # once
    python scripts/audio/generate.py

Files: `synth.py` (instruments, reverb, BS.1770 loudness, limiter), `arrange.py` (score engine),
`scores.py` (28-bar main film + 9-bar teaser), `sfx.py` (7 SFX), `generate.py` (render, measure, timing.json).

Outputs in `public/audio/`: `music-v5.wav` (56.000 s), `music-v5-teaser.wav` (18.000 s), `sfx/*.wav`,
`music-v5-preview.mp3` (via ffmpeg; falls back to Remotion's bundled ffmpeg), `timing.json`.
48 kHz / 16-bit stereo (seeded TPDF dither). 120 BPM, 4/4, D major; 1 bar = 96000 samples = 60 frames @30fps.

Loudness: own BS.1770-4 integrated-LUFS measurement + linear gain + look-ahead peak limiter, target -14 LUFS,
true peak <= -1 dBTP (4x oversampled). Cross-checked with ffmpeg loudnorm pass-1 (input_i). SFX are peak-normalized
(see timing.json), not LUFS-normalized.

timing.json accent frames: `measuredPeakFrame` = max of 1 ms RMS envelope; `measuredOnsetFrame` = first rise.
Kick/pluck bodies peak ~0.8 frame (~27 ms) after the downbeat sample; onset equals the planned frame.
To retime, edit bar numbers in `scores.py` (everything snaps to the 16th-note sample grid) and rerun.
