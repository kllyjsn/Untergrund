// Local bar-1-origin Trap renders and comparable low-end/balance measurements. Requires Chrome and ffmpeg.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fft, lowpass } from '../js/audio-quality.js';
import { integratedLoudness } from '../js/loudness.js';

const FS = 48000;
export const energyDB = (channels) => {
  let sum = 0, n = 0;
  for (const ch of channels) for (const x of ch) { sum += x * x; n++; }
  return n ? 10 * Math.log10(sum / n) : -Infinity;
};

export function bandEnergy(channels, fs = FS, cutoff = 200) {
  const length = channels[0]?.length;
  if (!length || channels.some((ch) => ch.length !== length)) throw new Error('Expected nonempty equal-length channels');
  const n = 2 ** Math.ceil(Math.log2(length));
  let power = 0;
  for (const ch of channels) {
    const re = new Float64Array(n), im = new Float64Array(n);
    re.set(ch); fft(re, im);
    for (let k = 0; k <= n / 2 && k * fs / n < cutoff; k++) power += (re[k] ** 2 + im[k] ** 2) * (k === 0 || k === n / 2 ? 1 : 2);
  }
  return 10 * Math.log10(power / (n * length * channels.length));
}

export function filtered(channels, fs = FS) {
  const { b, a } = lowpass(fs, 200);
  return channels.map((ch) => {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    return Float32Array.from(ch, (x) => {
      const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y; return y;
    });
  });
}

export function activeBalance(lead, bed, fs = FS) {
  if (!lead[0]?.length || lead[0].length !== bed[0]?.length) throw new Error('Expected aligned nonempty signals');
  const hop = Math.round(fs / 10), frames = Math.floor(lead[0].length / hop), powers = [];
  for (let f = 0; f < frames; f++) {
    const power = (channels) => {
      let p = 0;
      for (const ch of channels) for (let i = f * hop; i < (f + 1) * hop; i++) p += ch[i] ** 2;
      return p / (hop * channels.length);
    };
    powers.push([power(lead), power(bed)]);
  }
  const max = Math.max(0, ...powers.map(([p]) => p));
  const active = powers.filter(([p]) => max > 0 && p >= max * .01);
  if (!active.length) return { frames: 0, differenceDB: null };
  return { frames: active.length, differenceDB: 10 * Math.log10(active.reduce((s, p) => s + p[0], 0) / active.reduce((s, p) => s + p[1], 0)) };
}

export function measure(channels, mixLUFS, fs = FS, fullSongLUFS = mixLUFS) {
  const lufs = integratedLoudness(channels, fs), lp = filtered(channels, fs);
  const mono = Float32Array.from(channels[0], (_, i) => channels.reduce((sum, ch) => sum + ch[i], 0) / channels.length);
  const raw = { fftDBFS: bandEnergy(channels, fs), monoFFTDBFS: bandEnergy([mono], fs), filteredRMSDBFS: energyDB(lp), filteredLUFS: integratedLoudness(lp, fs), lufs };
  const match = (gain) => Number.isFinite(gain) ? Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v + gain])) : null;
  return { raw, mixMatched: match(-14 - mixLUFS), fullSongMatched: match(-14 - fullSongLUFS), independentlyMatched: match(-14 - lufs) };
}

function load(file) {
  const raw = execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-f', 'f32le', '-ac', '2', '-ar', String(FS), 'pipe:1'], { maxBuffer: 256 * 1024 * 1024 });
  if (!raw.length) throw new Error(`Empty audio: ${file}`);
  const channels = [new Float32Array(raw.length / 8), new Float32Array(raw.length / 8)];
  for (let i = 0; i < channels[0].length; i++) for (let c = 0; c < 2; c++) channels[c][i] = raw.readFloatLE(8 * i + 4 * c);
  return channels;
}

async function main(args) {
  const mode = args.shift(), options = {};
  while (args.length) {
    const key = args.shift(), value = args.shift();
    if (!['--out', '--seed', '--from'].includes(key) || value == null) throw new Error('Expected --out DIR [--seed N] [--from ZERO_BASED_BAR]');
    options[key.slice(2)] = value;
  }
  if (!['render', 'measure'].includes(mode) || !options.out) throw new Error('Usage: node scripts/trap-festival-notes.mjs render|measure --out DIR [--seed N --from BAR]');
  const out = resolve(options.out);
  if (mode === 'render') {
    const seed = Number(options.seed), from = options.from == null ? null : Number(options.from);
    if (!Number.isInteger(seed) || seed < 0 || (from != null && (!Number.isInteger(from) || from < 0))) throw new Error('Seed/from must be nonnegative integers');
    mkdirSync(out, { recursive: true });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const { withChrome } = await import(pathToFileURL(resolve('test/chrome.mjs')));
    let rendered = false;
    await withChrome(async (run) => {
      const meta = await run(`(async()=>{window.q=await import('/test/audio-quality-page.js');window.st=await import('/js/stems.js');window.dsp=await import('/js/dsp.js');window.loud=await import('/js/loudness.js');window.s=q.song('trap',${seed});window.p=q.plan(s,8);window.starts=${from == null ? `Array.from(new Set([p.peakBar,...p.sections.filter(x=>x.label==='G'&&x.to-x.from>=7).map(x=>x.from)])).filter(x=>x+8<=p.bars)` : `[${from}]`};if(starts.some(x=>x+8>p.bars))throw Error('Window exceeds song');window.wav=async(ch)=>{const n=ch[0].length,nc=ch.length,buf=new ArrayBuffer(44+n*nc*4),v=new DataView(buf),str=(o,t)=>{for(let i=0;i<t.length;i++)v.setUint8(o+i,t.charCodeAt(i))};str(0,'RIFF');v.setUint32(4,36+n*nc*4,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,3,true);v.setUint16(22,nc,true);v.setUint32(24,48000,true);v.setUint32(28,48000*nc*4,true);v.setUint16(32,nc*4,true);v.setUint16(34,32,true);str(36,'data');v.setUint32(40,n*nc*4,true);for(let i=0,o=44;i<n;i++)for(let c=0;c<nc;c++,o+=4)v.setFloat32(o,ch[c][i],true);const a=new Uint8Array(buf);let b='';for(let i=0;i<a.length;i+=32768)b+=String.fromCharCode(...a.subarray(i,i+32768));return btoa(b)};return {bpm:s.bpm,voice:s.params.stab.voice,bars:p.bars,starts,sections:p.sections}})()`);
      const result = { sha, seed, ...meta, windows: [] };
      const full = await run(`(async()=>{window.mix=await q.render(s,0,p.bars,{tail:8});const ch=[mix.getChannelData(0),mix.getChannelData(1)];return {dbtp:loud.dbtp(ch),lufs:loud.integratedLoudness(ch,48000)}})()`);
      result.fullSongDBTP = full.dbtp; result.fullSongLUFS = full.lufs;
      for (const start of meta.starts) {
        const file = `${start}-mix.wav`;
        const wav = await run(`wav([0,1].map(c=>mix.getChannelData(c).slice(Math.round((.05+${start}*240/s.bpm)*48000),Math.round((.05+${start + 8}*240/s.bpm)*48000))))`);
        writeFileSync(resolve(out, file), Buffer.from(wav, 'base64'));
        result.windows.push({ from: start, to: start + 8, files: { mix: file } });
      }
      await run(`(async()=>{window.mix=null;window.route=st.router(['stab','hook','acid']);try{window.stems=await q.render(s,0,p.bars,{tail:.5,channels:6,onContext:route.onContext,onEngine:route.onEngine})}finally{route.restore()}})()`);
      for (const win of result.windows) for (const [k, role] of ['stab', 'hook', 'acid'].entries()) {
        const file = `${win.from}-${role}.wav`;
        const wav = await run(`wav([${2 * k},${2 * k + 1}].map(c=>stems.getChannelData(c).slice(Math.round((.05+${win.from}*240/s.bpm)*48000),Math.round((.05+${win.to}*240/s.bpm)*48000))))`);
        writeFileSync(resolve(out, file), Buffer.from(wav, 'base64')); win.files[role] = file;
      }
      writeFileSync(resolve(out, 'render.json'), JSON.stringify(result, null, 2)+'\n'); rendered = true;
    });
    if (!rendered) throw new Error('Chrome unavailable: no render performed');
  }
  const report = JSON.parse(readFileSync(resolve(out, 'render.json'), 'utf8'));
  report.method = { window: 'Render from bar 1; crop at 0.05 + bar*240/bpm seconds; eight bars, no tail in crop.', fft: 'Stereo mean-square, 0 <= f < 200 Hz, rectangular whole crop, zero-padded radix-2 FFT with Parseval normalization.', filter: 'RBJ 200 Hz lowpass, Q sqrt(1/2), 12 dB/oct, zero state at crop start; RMS and BS.1770 gated LUFS.', matching: 'Constant gain to -14 LUFS; mixMatched uses the chorus mix gain on every stem; fullSongMatched uses the full-song mix gain before cropping; independentlyMatched normalizes each signal separately. No limiter.', active: '100 ms frames within 20 dB of lead maximum, same frames for both signals.' };
  for (const win of report.windows) {
    const signals = Object.fromEntries(Object.entries(win.files).map(([role, file]) => [role, load(resolve(out, file))]));
    const mixLUFS = integratedLoudness(signals.mix, FS);
    win.measurements = Object.fromEntries(Object.entries(signals).map(([role, channels]) => [role, measure(channels, mixLUFS, FS, report.fullSongLUFS)]));
    win.hookToPAD = activeBalance(signals.hook, signals.stab);
    win.padToBass = activeBalance(filtered(signals.acid), filtered(signals.stab));
    if (win.padToBass.differenceDB != null) win.padToBass.differenceDB *= -1;
    console.log(report.seed, win.from, JSON.stringify({ measurements: win.measurements, hookToPAD: win.hookToPAD, padToBass: win.padToBass }));
  }
  writeFileSync(resolve(out, 'measurements.json'), JSON.stringify(report, null, 2)+'\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
