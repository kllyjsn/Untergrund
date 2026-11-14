"""Measurements of a sung stem against its score (local evaluation only; numpy). Used by voice_survey.py and evaluate.py.

    pitch_err_c   median |sung - score| in cents at the middle of notes of 0.2 s or more (octave folded)
    pitch_wobble  median std (cents) of the pitch over the middle half of notes of 0.3 s or more: how steady a held
                  note is (vibrato adds to it on purpose)
    vibrato_c     median depth (+/- cents, detrended) over the part of notes of 0.8 s or more from 0.45 s in
    hnr_db        median harmonics-to-noise ratio of voiced 40 ms frames (autocorrelation at the pitch period)
    centroid_hz   median spectral centroid of voiced frames (brightness)
    onset_db      spectral flux within 40 ms of the score's word onsets over the flux elsewhere: crisp, well placed
                  articulation scores higher
    phrase_ms     phrase starts: first voiced, loud onset minus the phrase's first note (signed ms; median, p90 of |x|)
"""
from __future__ import annotations

import re

import numpy as np

NOTE = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


def midi(name: str) -> int:
    m = re.match(r"([A-G])(#|b)?(-?\d)", name)
    return 12 * (int(m.group(3)) + 1) + NOTE[m.group(1)] + (1 if m.group(2) == "#" else -1 if m.group(2) == "b" else 0)


def timeline(score: dict):
    """(label, midi|None, start s, end s, word onset?, phrase start?) per score row."""
    out, t, prev_rest = [], 0.0, True
    sp = 60.0 / score["bpm"]
    for label, name, b in score["notes"]:
        d = b * sp
        rest = label == "-"
        word = not rest and not re.search(r"~([2-9]|\d\d)$", label)
        out.append((label, None if rest else midi(name), t, t + d, word, (not rest) and prev_rest))
        prev_rest = rest if rest else False
        t += d
    return out


def track(x: np.ndarray, sr: int, hop: float = 0.01, win: float = 0.04, lo: float = 70, hi: float = 900):
    """YIN pitch (Hz, 0 unvoiced) and periodicity (1 - aperiodicity) per hop."""
    if sr > 16000:
        k = sr // 12000
        x, sr = x[::k], sr // k
    W, H = int(win * sr), int(hop * sr)
    n = max(0, (x.size - 2 * W) // H)
    t0, t1 = int(sr / hi), int(sr / lo)
    f0, per = np.zeros(n), np.zeros(n)
    rms = np.zeros(n)
    for i in range(n):
        a = x[i * H: i * H + 2 * W].astype(np.float64)
        rms[i] = np.sqrt(np.mean(a[:W] ** 2))
        if rms[i] < 1e-4:
            continue
        fa = np.fft.rfft(a, 4 * W)
        r = np.fft.irfft(fa[:] * np.conj(np.fft.rfft(a[:W], 4 * W)), 4 * W)[: t1 + 1]
        c = np.cumsum(a ** 2)
        e0 = c[W - 1]
        et = np.array([c[t + W - 1] - (c[t - 1] if t else 0) for t in range(t1 + 1)])
        d = e0 + et - 2 * r
        d[0] = 0
        cm = d[1:] * np.arange(1, t1 + 1) / np.maximum(np.cumsum(d[1:]), 1e-12)
        cm = np.concatenate([[1], cm])
        cand = np.where(cm[t0:t1] < 0.2)[0]
        if not cand.size:
            continue
        j = cand[0] + t0
        while j + 1 < t1 and cm[j + 1] < cm[j]:
            j += 1
        if 1 <= j < t1:
            a_, b_, c_ = cm[j - 1], cm[j], cm[j + 1]
            den = a_ - 2 * b_ + c_
            jj = j + (0.5 * (a_ - c_) / den if den > 1e-12 else 0)
        else:
            jj = j
        f0[i] = sr / jj
        per[i] = max(0.0, 1 - cm[j])
    return f0, per, rms


def measure(voc: np.ndarray, sr: int, score: dict) -> dict:
    voc = np.asarray(voc, np.float64).reshape(-1)
    f0, per, rms = track(voc, sr)
    cents = np.where(f0 > 0, 1200 * np.log2(np.maximum(f0, 1) / 440) + 6900, np.nan)
    tl = timeline(score)
    errs, wob, vib = [], [], []
    for label, m, s, e, _, _ in tl:
        if m is None:
            continue
        d = e - s
        a, z = int(s * 100), int(e * 100)
        seg = cents[a:z]
        if d >= 0.2:
            mid = cents[int((s + d * 0.4) * 100): int((s + d * 0.6) * 100) + 1]
            mid = mid[~np.isnan(mid)]
            if mid.size:
                er = np.median(mid) - m * 100
                er = er - 1200 * round(er / 1200)
                errs.append(abs(er))
        if d >= 0.3:
            mid = cents[int((s + d * 0.25) * 100): int((s + d * 0.75) * 100)]
            mid = mid[~np.isnan(mid)]
            if mid.size >= 5:
                wob.append(np.std(mid))
        if d >= 0.8:
            tail = cents[int((s + 0.45) * 100): int((e - 0.05) * 100)]
            ok = ~np.isnan(tail)
            if ok.sum() >= 15:
                tt = np.arange(tail.size)[ok]
                y = tail[ok] - np.polyval(np.polyfit(tt, tail[ok], 1), tt)
                vib.append(np.sqrt(2) * np.std(y))
    voiced = (per > 0.5) & (f0 > 0)
    r = np.clip(per[voiced], 1e-3, 1 - 1e-3)
    hnr = float(np.median(10 * np.log10(r / (1 - r)))) if r.size else float("nan")
    # spectrum: 2048-point frames every 10 ms
    N, H = 1024 if sr <= 24000 else 2048, sr // 100
    nf = max(0, (voc.size - N) // H)
    win = np.hanning(N)
    mags = np.array([np.abs(np.fft.rfft(voc[i * H: i * H + N] * win)) for i in range(nf)]) if nf else np.zeros((0, N // 2 + 1))
    freqs = np.fft.rfftfreq(N, 1 / sr)
    k = min(nf, voiced.size)
    cen = (mags[:k] * freqs).sum(1) / np.maximum(mags[:k].sum(1), 1e-12)
    vv = voiced[:k] & (mags[:k].sum(1) > 0)
    centroid = float(np.median(cen[vv])) if vv.any() else float("nan")
    lm = np.log(mags + 1e-6)
    flux = np.r_[0, np.maximum(0, np.diff(lm, axis=0)).sum(1)] if nf else np.zeros(0)
    near = np.zeros(flux.size, bool)
    for _, m, s, _, w, _ in tl:
        if w:
            near[max(0, int((s - 0.04) * 100)): int((s + 0.04) * 100) + 1] = True
    near = near[: flux.size]
    sung = flux > 0
    onset = float(10 * np.log10(np.mean(flux[near & sung]) / np.mean(flux[~near & sung]))) if (near & sung).any() and (~near & sung).any() else float("nan")
    # phrase starts: first frame (10 ms) that is voiced and within 15 dB of the loud voiced level, near the first note
    db = 20 * np.log10(rms + 1e-9)
    ref = np.percentile(db[voiced], 90) if voiced.any() else db.max()
    errs_p = []
    for _, m, s, _, _, p in tl:
        if not p:
            continue
        for i in range(max(0, int((s - 0.15) * 100)), min(f0.size - 1, int((s + 0.15) * 100))):
            if voiced[i] and voiced[i + 1] and db[i] > ref - 15:
                errs_p.append((i * 0.01 + 0.02) - s)  # frame i covers i*10 ms .. +40 ms: its centre
                break
    ep = np.array(errs_p) * 1000
    q = lambda v, f=np.median: round(float(f(v)), 1) if len(v) else None
    return dict(pitch_err_c=q(errs), pitch_wobble=q(wob), vibrato_c=q(vib), hnr_db=round(hnr, 1), centroid_hz=round(centroid),
                onset_db=round(onset, 2), phrase_ms=q(ep), phrase_abs_ms=q(np.abs(ep)), phrase_p90_ms=q(np.abs(ep), lambda v: np.percentile(v, 90)),
                phrases=int(ep.size))
