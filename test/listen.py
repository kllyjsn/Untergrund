"""Measure a song rendered by test/listen.html: tuning, clashes, harmony and playing, per stem.

usage: python3 test/listen.py test/out/L_<tag>   (reads L_<tag>_notes.json + L_<tag>_<stem>.wav,
writes L_<tag>_report.md and L_<tag>_report.png). Each section prints what a player would hear.
"""
import sys, json, glob, os, wave
import numpy as np
from scipy.signal import find_peaks

NAMES = 'C C# D D# E F F# G G# A A# B'.split()
N_FFT, HOP = 16384, 2048
FAMILY = {'gtr': 'stab', 'piano': 'stab', 'pianosoft': 'stab', 'horn': 'stab', 'str': 'stab', 'bass': 'acid', 'synthbass': 'acid'}


def nn(m):
    m = int(round(m)); return f'{NAMES[m % 12]}{m // 12 - 1}'


def hz(m): return 440 * 2 ** ((m - 69) / 12)


def load(f):
    w = wave.open(f); n, sr, ch, bw = w.getnframes(), w.getframerate(), w.getnchannels(), w.getsampwidth()
    raw = w.readframes(n)
    if bw == 3:
        b = np.frombuffer(raw, np.uint8).reshape(-1, 3).astype(np.int32)
        x = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16); x = np.where(x >= 1 << 23, x - (1 << 24), x) / 8388607.0
    else:
        x = np.frombuffer(raw, np.int16) / 32767.0
    return x.reshape(-1, ch).mean(1), sr


class Spec:
    def __init__(self, x, sr):
        self.sr = sr; win = np.hanning(N_FFT)
        x = np.concatenate([np.zeros(N_FFT // 2), x, np.zeros(N_FFT // 2)])
        idx = np.arange(0, len(x) - N_FFT, HOP)
        fr = np.lib.stride_tricks.sliding_window_view(x, N_FFT)[idx] * win
        self.mag = np.abs(np.fft.rfft(fr, axis=1)) * 2 / win.sum()
        self.t = idx / sr
        self.f = np.fft.rfftfreq(N_FFT, 1 / sr)
        self.db = 20 * np.log10(self.mag + 1e-9)
        self._peaks = {}

    def frames(self, a, b): return np.where((self.t >= a) & (self.t < b))[0]

    def peaks(self, i, fmin=55, fmax=4000, rel=40):
        if i in self._peaks: return self._peaks[i]
        d = self.db[i]; lo, hi = np.searchsorted(self.f, [fmin, fmax])
        top = d[lo:hi].max()
        if top < -70: self._peaks[i] = (np.zeros(0), np.zeros(0)); return self._peaks[i]
        k, _ = find_peaks(d[lo:hi], height=top - rel, prominence=6); k = k + lo
        a, b, c = d[k - 1], d[k], d[k + 1]; p = 0.5 * (a - c) / (a - 2 * b + c)
        f = (k + p) * self.sr / N_FFT; amp = 10 ** ((b - 0.25 * (a - c) * p) / 20)
        o = np.argsort(-amp)[:40]
        self._peaks[i] = (f[o], amp[o]); return self._peaks[i]


def cents_off_grid(f): c = 1200 * np.log2(f / 440); return (c + 50) % 100 - 50


def sethares(f1, a1, f2, a2):
    if not len(f1) or not len(f2): return 0.0
    F1, F2 = np.meshgrid(f1, f2); A1, A2 = np.meshgrid(a1, a2)
    s = 0.24 / (0.0207 * np.minimum(F1, F2) + 18.96); df = np.abs(F1 - F2)
    return float((np.minimum(A1, A2) * (np.exp(-3.5 * s * df) - np.exp(-5.75 * s * df))).sum())


def main(prefix):
    meta = json.load(open(prefix + '_notes.json'))
    stems = {os.path.basename(p)[len(os.path.basename(prefix)) + 1:-4]: p for p in glob.glob(prefix + '_*.wav')}
    spec = {k: Spec(*load(p)) for k, p in stems.items()}
    notes, bars, sd = meta['notes'], meta['bars'], meta['stepDur']
    out = []; P = out.append
    P(f"# Listening report: {meta['style']} seed {meta['seed']}  ({meta['bpm']} BPM, key {NAMES[meta['key'] % 12]}, swing {meta['swing']:.2f}, stab voice {meta['stabVoice']})\n")
    P('Bars: ' + ' | '.join(f"{NAMES[b['root']]}{b['chord']}" for b in bars) + '\n')

    def chord_at(t):
        b = [x for x in bars if x['t'] <= t + 1e-6]; return b[-1] if b else bars[0]

    def pcs(b): return {(b['root'] + i) % 12 for i in b['iv']}

    def stem_for(n): return FAMILY.get(n['kind'], 'full') if FAMILY.get(n['kind']) in spec else 'full'

    # 1. Tuning of everything the stems actually sound.
    P('## 1. Tuning (all spectral peaks 80-1200 Hz vs A440 equal temperament)\n')
    P('| stem | energy-weighted mean offset | energy >15 cents off the grid | energy >25 cents off |\n|---|---|---|---|')
    for k, S in spec.items():
        cs, ws = [], []
        for i in range(len(S.t)):
            f, a = S.peaks(i, 80, 1200); cs += list(cents_off_grid(f)); ws += list(a ** 2)
        cs, ws = np.array(cs), np.array(ws)
        if not ws.sum(): continue
        mean = np.degrees(np.angle((ws * np.exp(1j * np.radians(cs * 3.6))).sum())) / 3.6
        P(f'| {k} | {mean:+.1f} c | {100 * ws[np.abs(cs) > 15].sum() / ws.sum():.0f}% | {100 * ws[np.abs(cs) > 25].sum() / ws.sum():.0f}% |')

    # 2. Each played note: is the sound at the pitch the engine asked for?
    P('\n## 2. Per-note intonation (partials 1-4 near the scheduled pitch, 60-350 ms after the attack)\n')
    rows = {}
    for n in notes:
        S = spec[stem_for(n)]; fr = S.frames(n['t'] + 0.06, n['t'] + 0.35)
        if not len(fr): continue
        avg = S.mag[fr].mean(0); f0 = hz(n['midi']); devs, w = [], []
        for h in (1, 2, 3, 4):
            lo, hi = np.searchsorted(S.f, [h * f0 * 2 ** (-35 / 1200), h * f0 * 2 ** (35 / 1200)])
            if hi - lo < 3 or lo < 2: continue
            k = lo + int(np.argmax(avg[lo:hi]))
            if k in (lo, hi - 1) or avg[k] < 10 ** (-60 / 20): continue
            a, b, c = np.log(avg[k - 1:k + 2] + 1e-12); p = 0.5 * (a - c) / (a - 2 * b + c)
            devs.append(1200 * np.log2((k + p) * S.sr / N_FFT / (h * f0))); w.append(avg[k] / h)
        if devs: rows.setdefault(f"{n['kind']}/{n['src']}", []).append((float(np.average(devs, weights=w)), n))
    P('| part | notes measured | median abs offset | notes >15 c off | worst |\n|---|---|---|---|---|')
    for k, r in rows.items():
        d = np.array([x for x, _ in r]); worst = sorted(r, key=lambda x: -abs(x[0]))[:3]
        P(f"| {k} | {len(d)} | {np.median(np.abs(d)):.1f} c | {(np.abs(d) > 15).sum()} | " + ', '.join(f"{nn(n['midi'])}@{n['t']:.2f}s {x:+.0f}c" for x, n in worst) + ' |')

    # 3. Roughness: beating between partials (Sethares), inside each part and between parts.
    P('\n## 3. Roughness (beating partials; Sethares model, per unit energy)\n')
    parts = [k for k in ('stab', 'acid') if k in spec]
    ref = spec[parts[0]] if parts else spec['full']
    rough = {}
    for k in parts + (['full'] if 'full' in spec else []):
        S = spec[k]; r = []; gate = S.db.max() - 40
        for i in range(len(S.t)):
            f, a = S.peaks(i)
            r.append(sethares(f, a, f, a) / 2 / a.sum() ** 2 if len(a) and S.db[i].max() > gate else 0)
        rough[k] = np.array(r)
    if len(parts) == 2:
        A, B = spec[parts[0]], spec[parts[1]]; r = []; ga, gb = A.db.max() - 40, B.db.max() - 40
        for i in range(min(len(A.t), len(B.t))):
            fa, aa = A.peaks(i); fb, ab = B.peaks(i)
            ok = len(aa) and len(ab) and A.db[i].max() > ga and B.db[i].max() > gb
            r.append(sethares(fa, aa, fb, ab) / (aa.sum() * ab.sum()) if ok else 0)
        rough['stab x acid'] = np.array(r)
    for k, r in rough.items():
        act = r[r > 0]
        if not len(act): continue
        P(f'- **{k}**: mean {act.mean():.3f}, 90th pct {np.percentile(act, 90):.3f}')
        for i in np.argsort(-r)[:3]:
            t = ref.t[i]; on = [n for n in notes if n['t'] <= t < n['t'] + max(n['dur'], 0.2) and n['src'] != 'drum']
            b = chord_at(t)
            P(f"  - {t:.2f}s over {NAMES[b['root']]}{b['chord']}: " + ' '.join(sorted({f"{nn(n['midi'])}({n['src']})" for n in on})))

    # 4. Harmony as heard: chroma of the chord stem against the bar's chord.
    P("\n## 4. Pitch classes outside the bar's chord (audio chroma from partials < 1 kHz)\n")
    for k in parts:
        S = spec[k]; outside, early = [], []; gate = S.db.max() - 40
        for i, t in enumerate(S.t):
            f, a = S.peaks(i, 55, 1000)
            if not len(f) or S.db[i].max() < gate: continue
            b = chord_at(t); pc = np.round(12 * np.log2(f / 440) + 69).astype(int) % 12
            ok = np.isin(pc, list(pcs(b))); e = a ** 2
            frac = e[~ok].sum() / e.sum(); outside.append(frac)
            if 0 < t - b['t'] < 0.3 and b['t'] > 0.1: early.append((frac, t, [NAMES[x] for x in sorted(set(pc[~ok]))]))
        if outside:
            P(f'- **{k}**: {100 * np.mean(outside):.0f}% of energy outside the chord overall; first 300 ms after a chord change: '
              f"{100 * np.mean([x for x, *_ in early]) if early else 0:.0f}%" + ''.join(f"\n  - {t:.2f}s {100 * x:.0f}% outside: {' '.join(p)}" for x, t, p in sorted(early, key=lambda z: -z[0])[:3]))

    # 5. What was played (from the engine's own note log).
    P('\n## 5. Playing (engine note log)\n')
    by = {}
    for n in notes: by.setdefault(n['src'], []).append(n)
    for src, ns in by.items():
        ns.sort(key=lambda n: n['t']); m = np.array([n['midi'] for n in ns]); lv = np.array([n.get('level', 1) for n in ns])
        stretch = np.abs([n['midi'] - n.get('center', n['midi']) for n in ns])
        nct = [n for n in ns if round(n['midi']) % 12 not in pcs(chord_at(n['t']))]
        P(f"- **{src}** ({ns[0]['kind']}): {len(ns)} notes, range {nn(m.min())}-{nn(m.max())}, level spread (CV) {lv.std() / max(lv.mean(), 1e-9):.2f}, "
          f"sample stretch max {stretch.max():.1f} st, notes not in the bar's chord {100 * len(nct) / len(ns):.0f}%")
        # Grid timing: 16th grid with swing on the off-16ths.
        dev = []
        for n in ns:
            x = (n['t'] - 0.05) / sd; k = round(x); g = k + (meta['swing'] * 0.5 if k % 2 else 0)
            dev.append((x - g) * sd * 1000)
        P(f'  - timing vs swung grid: median {np.median(dev):+.0f} ms, spread (sd) {np.std(dev):.0f} ms')
        if src == 'chord':
            groups, cur = [], [ns[0]]
            for n in ns[1:]:
                if n['t'] - cur[0]['t'] < 0.08: cur.append(n)
                else: groups.append(cur); cur = [n]
            groups.append(cur)
            spread = [1000 * (g[-1]['t'] - g[0]['t']) for g in groups if len(g) > 1]
            # Where the chords fall in each bar (digit = strings struck, on the 16th grid).
            rows = {}
            for g in groups:
                k = round((g[0]['t'] - 0.05) / sd); rows.setdefault(k // 16, ['.'] * 16)[k % 16] = str(min(len(g), 9))
            P('  - rhythm per bar: ' + ' | '.join(''.join(r) for _, r in sorted(rows.items())))
            P(f"  - {len(groups)} chords, {np.mean([len(g) for g in groups]):.1f} strings each, strum spread {np.mean(spread) if spread else 0:.0f} ms (max {max(spread) if spread else 0:.0f}); shapes: "
              + ', '.join(' '.join(nn(n['midi']) for n in sorted(g, key=lambda n: n['midi'])) for g in groups[:4]))
        # Sounding at once: physically a guitar has six strings.
        if ns[0]['kind'] == 'gtr':
            tl = sorted({n['t'] for n in ns}); poly = [sum(1 for o in ns if o['t'] <= t < o['t'] + o['dur']) for t in tl]
            P(f'  - notes ringing at once: median {int(np.median(poly))}, max {max(poly)} (a guitar has 6 strings)')
    # Clashes between notes ringing together (half step / flat nine), within and across parts.
    clash = []
    for n in notes:
        for o in notes:
            # Overlaps under 70 ms are the strum or the damper, not two notes held together.
            if o is n or not (o['t'] < n['t'] and n['t'] + 0.07 <= o['t'] + o['dur']): continue
            d = abs(round(n['midi']) - round(o['midi']))
            if d in (1, 13):
                b = chord_at(n['t']); ch = pcs(b)
                if round(n['midi']) % 12 not in ch or round(o['midi']) % 12 not in ch:
                    clash.append((n['t'], f"{nn(n['midi'])}({n['src']}) vs {nn(o['midi'])}({o['src']}) over {NAMES[b['root']]}{b['chord']}"))
    P(f'\n- **half-step / flat-nine rubs between ringing notes (one of them outside the chord)**: {len(clash)}' + ''.join(f'\n  - {t:.2f}s {s}' for t, s in clash[:8]))
    # Notes still ringing after the chord changed under them.
    hang = []
    for b in bars[1:]:
        for n in notes:
            if n['t'] < b['t'] - 0.05 and n['t'] + n['dur'] > b['t'] + 0.15 and round(n['midi']) % 12 not in pcs(b):
                hang.append(f"{b['t']:.2f}s {nn(n['midi'])}({n['src']}) into {NAMES[b['root']]}{b['chord']}")
    P(f'- **notes that ring on into a chord they do not belong to**: {len(hang)}' + ''.join(f'\n  - {h}' for h in hang[:8]))

    rep = '\n'.join(out); open(prefix + '_report.md', 'w').write(rep + '\n'); print(rep)
    plot(prefix, spec, notes, bars, rough, ref, meta)


def plot(prefix, spec, notes, bars, rough, ref, meta):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    key = 'stab' if 'stab' in spec else 'full'; S = spec[key]
    fig, ax = plt.subplots(3, 1, figsize=(16, 11), sharex=True, gridspec_kw={'height_ratios': [4, 1.3, 1.3]})
    lo, hi = np.searchsorted(S.f, [60, 1600])
    ax[0].pcolormesh(S.t, S.f[lo:hi], S.db[:, lo:hi].T, vmin=S.db[:, lo:hi].max() - 60, shading='auto', cmap='magma')
    ax[0].set_yscale('log'); ax[0].set_ylim(60, 1600); ax[0].set_ylabel(f'{key} Hz')
    col = {'chord': 'cyan', 'hook': 'lime', 'bass': 'white', 'note': 'yellow'}
    for n in notes:
        ax[0].plot([n['t'], n['t'] + n['dur']], [hz(n['midi'])] * 2, color=col.get(n['src'], 'gray'), lw=0.8, alpha=0.8)
    for b in bars:
        for a in ax: a.axvline(b['t'], color='w' if a is ax[0] else 'k', lw=0.6, alpha=0.5)
        ax[0].text(b['t'] + 0.05, 1450, f"{NAMES[b['root']]}{b['chord']}", color='w', fontsize=9)
    for k, r in rough.items(): ax[1].plot(ref.t[:len(r)], r, label=k, lw=0.8)
    ax[1].set_ylabel('roughness'); ax[1].legend(fontsize=8)
    for k in ('stab', 'acid'):
        if k not in spec: continue
        T = spec[k]; fr = []; gate = T.db.max() - 40
        for i, t in enumerate(T.t):
            f, a = T.peaks(i, 55, 1000)
            if T.db[i].max() < gate: f = []
            b = [x for x in bars if x['t'] <= t + 1e-6]; b = b[-1] if b else bars[0]
            if not len(f): fr.append(np.nan); continue
            pc = np.round(12 * np.log2(f / 440) + 69).astype(int) % 12; ok = np.isin(pc, [(b['root'] + i) % 12 for i in b['iv']])
            fr.append((a[~ok] ** 2).sum() / (a ** 2).sum())
        ax[2].plot(T.t, fr, label=k, lw=0.8)
    ax[2].set_ylabel('outside chord'); ax[2].legend(fontsize=8); ax[2].set_xlabel('s')
    fig.suptitle(f"{meta['style']} seed {meta['seed']}: cyan chords, lime hook, white bass (scheduled pitches)")
    fig.tight_layout(); fig.savefig(prefix + '_report.png', dpi=80)


if __name__ == '__main__':
    main(sys.argv[1])
