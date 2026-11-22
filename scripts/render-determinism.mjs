// Whole-song export nulls across independent Chrome processes.
// node scripts/render-determinism.mjs --style lofihiphop --seed 1234 --runs 4 --stems master,stab
import { withChrome } from '../test/chrome.mjs';
import { TRACK_IDS } from '../js/params.js';
import { STYLES } from '../js/state.js';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const db = x => 20 * Math.log10(x || 1e-30);
const THRESHOLDS = ['0.000001', '0.001'];
export function nullMetrics(a, b, rate, times, start = 0, beatsPerBar = 4) {
  if (a.length !== b.length) throw Error('Render length changed');
  if (!a.length) throw Error('Empty render');
  if (!Number.isFinite(rate) || !(rate > 0) || !Number.isFinite(beatsPerBar) || !(beatsPerBar > 0) || times.length < 2 || times.some((t, i) => !Number.isFinite(t) || t < 0 || (i && t <= times[i - 1]))) throw Error('Invalid render timeline');
  const windows = [];
  const first = { '0.000001': null, '0.001': null };
  let energy = 0, error = 0, peak = 0;
  for (let w = 0; w < times.length - 1; w++) {
    const from = Math.floor(times[w] * rate) * 2, to = w === times.length - 2 ? a.length : Math.min(a.length, Math.floor(times[w + 1] * rate) * 2);
    let e = 0, d = 0, p = 0;
    for (let i = from; i < to; i++) {
      if (!Number.isFinite(a[i]) || !Number.isFinite(b[i])) throw Error(`Nonfinite PCM sample at ${i}`);
      e += a[i] ** 2; const v = a[i] - b[i]; d += v * v; p = Math.max(p, Math.abs(v));
      for (const threshold of THRESHOLDS) if (first[threshold] === null && Math.abs(v) > +threshold) {
        const frame = Math.floor(i / 2), seconds = frame / rate;
        const tail = w === times.length - 2, origin = Math.max(start, times[w]);
        first[threshold] = { sample: i, frame, channel: i % 2, seconds, bar: tail ? null : w + 1, beat: tail ? null : 1 + beatsPerBar * (seconds - origin) / (times[w + 1] - origin), tail };
      }
    }
    windows.push({ window: w, from: times[w], to: times[w + 1], energy: d, dBr: db(Math.sqrt(d / (e || 1))), rms: Math.sqrt(d / Math.max(1, to - from)), peak: p });
    energy += e; error += d; peak = Math.max(peak, p);
  }
  return { dBr: db(Math.sqrt(error / (energy || 1))), rms: Math.sqrt(error / a.length), peak, signalRms: Math.sqrt(energy / a.length), silent: energy === 0, first, windows: windows.map(w => ({ ...w, share: w.energy / (error || 1) })) };
}

export async function measure({ style, seed, prompt = '', runs = 4, stems = ['master'], save, compare, bars = 0, report }) {
  if (!Number.isInteger(runs) || runs < 3) throw Error('Use at least three independent launches');
  if (!stems.length) throw Error('Select at least one stem');
  if (stems.some(s => s !== 'master' && !TRACK_IDS.includes(s))) throw Error('Unknown TRACK_ID');
  if (prompt && prompt !== 'minor') throw Error('Supported prompt: minor (generated scale)');
  if (!Object.hasOwn(STYLES, style)) throw Error('Unknown style');
  if (!Number.isSafeInteger(seed)) throw Error('Use an integer seed');
  if (!Number.isInteger(bars) || bars < 0) throw Error('Use a nonnegative integer bar count');
  const refs = new Map(), rows = [];
  for (let repeat = 0; repeat < runs; repeat++) {
    const result = await withChrome(async run => {
      await run(`(async () => {
        const { song, plan } = await import('/test/audio-quality-page.js');
        const { renderBars } = await import('/js/render.js');
        const { loadPiece } = await import('/js/repertoire.js');
        const style = ${JSON.stringify(style)}, seed = ${seed}, prompt = ${JSON.stringify(prompt)};
        const s = song(style, seed);
        if (prompt && s.scale !== prompt) throw Error('Generated scale does not match prompt');
        const piece = s.patterns.find(p => p.score)?.score?.piece;
        if (piece) await loadPiece(piece);
        const p = plan(s);
        if (${bars} > 0) { p.bars = Math.min(p.bars, ${bars}); p.barTimes = p.barTimes.slice(0, p.bars + 1); }
        window.renderOne = async stem => {
          s.solos = stem === 'master' ? {} : { [stem]: true };
          const b = await renderBars(s, p.bars, { tail: 8 });
          window.pcm = new Float32Array(b.length * 2);
          const l = b.getChannelData(0), r = b.getChannelData(1);
          for (let i = 0; i < b.length; i++) { pcm[i * 2] = l[i]; pcm[i * 2 + 1] = r[i]; }
          return { rate: b.sampleRate, length: pcm.length, start: 0.05, bpm: s.bpm, beatsPerBar: p.per / 4, bars: p.bars, times: [0, ...p.barTimes.slice(1).map(t => t + 0.05), b.duration] };
        };
      })()`);
      for (const stem of stems) {
        const meta = await run(`renderOne(${JSON.stringify(stem)})`);
        const pcm = new Float32Array(meta.length);
        for (let at = 0; at < pcm.length; at += 262144) {
          const encoded = await run(`(() => { const bytes = new Uint8Array(pcm.buffer, ${at * 4}, ${Math.min(262144, pcm.length - at) * 4}); let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(s); })()`);
          Buffer.from(pcm.buffer).set(Buffer.from(encoded, 'base64'), at * 4);
        }
        if (save) {
          writeFileSync(`${save}-${stem}-r${repeat}.f32`, Buffer.from(pcm.buffer));
          writeFileSync(`${save}-${stem}-r${repeat}.json`, JSON.stringify(meta, null, 2) + '\n');
        }
        if (!repeat) {
          refs.set(stem, pcm);
          if (save) writeFileSync(`${save}-${stem}.f32`, Buffer.from(pcm.buffer));
          if (compare) { const bytes = readFileSync(`${compare}-${stem}.f32`); rows.push({ stem, repeat: 'comparison', ...nullMetrics(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), pcm, meta.rate, meta.times, meta.start, meta.beatsPerBar) }); }
        } else rows.push({ stem, repeat, ...nullMetrics(refs.get(stem), pcm, meta.rate, meta.times, meta.start, meta.beatsPerBar) });
        console.error(`${style}/${seed} ${stem} launch ${repeat + 1}/${runs}${repeat ? ': ' + rows.at(-1).dBr.toFixed(2) + ' dBr' : ''}`);
        if (report) writeFileSync(report, JSON.stringify({ style, seed, prompt, runs, completed: repeat + 1, rows }, null, 2) + '\n');
      }
      return true;
    });
    if (!result) throw Error('Chrome unavailable');
  }
  return { style, seed, prompt, runs, rows };
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
  const stems = arg('stems', 'master');
  const result = await measure({ style: arg('style', 'lofihiphop'), seed: +arg('seed', 1234), prompt: arg('prompt', ''), runs: +arg('runs', 4), stems: stems === 'all' ? ['master', ...TRACK_IDS] : stems.split(','), save: arg('save'), compare: arg('compare'), bars: +arg('bars', 0), report: arg('json') });
  if (arg('json')) writeFileSync(arg('json'), JSON.stringify(result, null, 2) + '\n');
  for (const row of result.rows) console.log(JSON.stringify(row));
}
