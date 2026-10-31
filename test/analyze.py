import sys, wave, numpy as np
from scipy.signal import butter, sosfilt
for f in sys.argv[1:]:
    w = wave.open(f)
    n, sr, ch = w.getnframes(), w.getframerate(), w.getnchannels()
    raw = np.frombuffer(w.readframes(n), dtype=np.uint8).reshape(-1, 3)
    x = (raw[:,0].astype(np.int32) | (raw[:,1].astype(np.int32)<<8) | (raw[:,2].astype(np.int32)<<16))
    x = np.where(x >= 1<<23, x - (1<<24), x) / 8388607.0
    x = x.reshape(-1, ch)
    m = x.mean(1); s = (x[:,0]-x[:,1])/2
    db = lambda v: 20*np.log10(max(v,1e-9))
    peak = np.abs(x).max(); rms = np.sqrt((x**2).mean())
    # crude short-term loudness: K-ish weighting via HP 60 + shelf skipped
    bands = {'sub<60':(20,60),'bass60-250':(60,250),'mid250-2k':(250,2000),'hi2k-8k':(2000,8000),'air>8k':(8000,20000)}
    out=[]
    for k,(lo,hi) in bands.items():
        sos = butter(4,[lo,min(hi,sr/2-100)],btype='band',fs=sr,output='sos')
        out.append(f"{k}:{db(np.sqrt((sosfilt(sos,m)**2).mean())):.1f}")
    clips = (np.abs(x) > 0.999).sum()
    sos = butter(4,150,btype='low',fs=sr,output='sos'); lows = sosfilt(sos, s)
    print(f"{f}: {n/sr:.1f}s peak {db(peak):.2f}dBFS rms {db(rms):.1f}dB crest {db(peak)-db(rms):.1f} clips {clips} dc {x.mean():.4f} side/mid {db(np.sqrt((s**2).mean()))-db(np.sqrt((m**2).mean())):.1f}dB lowSide {db(np.sqrt((lows**2).mean())):.1f}")
    print('   ', ' '.join(out))
