// Full-song jazz renders and an audit of the notes dispatched by the real sequencer.
import { mkdirSync, existsSync, readFileSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { withChrome } from '../test/chrome.mjs';
import { freshSong } from '../js/state.js';
import { Recorder } from '../js/midi.js';
import { Sequencer } from '../js/engine.js';
import { CHORDS } from '../js/params.js';

const pc = (n) => ((n % 12) + 12) % 12;
const dir = resolve('test/out/jazz'); mkdirSync(dir, { recursive: true });
const selectedAt = process.argv.indexOf('--styles');
const selected = selectedAt < 0 ? ['swing', 'modal', 'neosoul'] : process.argv[selectedAt + 1].split(',');
if (selected.some((s) => !['swing', 'modal', 'neosoul'].includes(s))) throw new Error('Expected swing, modal or neosoul');
const previousFile = resolve(dir, 'measurements.json');
const previous = existsSync(previousFile) ? JSON.parse(readFileSync(previousFile, 'utf8')) : { audit: [], measurements: [] };
const audit = previous.audit.filter((r) => !selected.includes(r.style));
for (const style of ['swing', 'modal'].filter((s) => selected.includes(s))) for (const seed of [11, 42]) {
  const s = freshSong(style, seed), e = new Recorder(s), seq = new Sequencer(e, s), rows = [];
  let strong = 0, outside = 0;
  for (const name of ['acid', 'hook']) {
    const original = e[name].bind(e);
    e[name] = (...a) => {
      const before = e.notes[name]?.length || 0;
      original(...a);
      const note = e.notes[name]?.[before];
      if (!note) return;
      const abs = e.step, bar = Math.floor(abs / 16), step = abs % 16, h = e.harm;
      if (step % 8 === 0) { strong++; if (!CHORDS[h.c].iv.some((n) => pc(s.key + h.r + n) === pc(note.m))) outside++; }
      if (name === 'acid' && bar < 4) rows.push({ bar: bar + 1, chord: `${pc(s.key + h.r)} ${CHORDS[h.c].name}`, step, midi: note.m });
    };
  }
  for (let i = 0; i < s.chain.length * 16; i++) seq.tick(i, 0.05 + i * e.stepDur);
  const r = { style, seed, strong, outside, bass: rows };
  if (outside) throw new Error(JSON.stringify(r));
  audit.push(r); console.log(`${style}/${seed}: ${outside}/${strong} out-of-chord strong-beat lead/bass notes`);
  if (style === 'swing' && seed === 42) for (let bar = 1; bar <= 4; bar++) console.log(`bar ${bar}: ${rows.find((x) => x.bar === bar).chord}; upright MIDI ${rows.filter((x) => x.bar === bar).map((x) => x.midi).join(', ')}`);
}
const measurements = await withChrome(async (run) => {
  await run(`(async () => {
    const state = await import('/js/state.js'), { render } = await import('/test/audio-quality-page.js');
    const { loudness, truePeak } = await import('/js/loudness.js');
    const { spectrum } = await import('/js/audio-quality.js');
    const { encodeWav } = await import('/js/dsp.js');
    const { windowLoudness } = await import('/test/loudness-page.js');
    window.jazzRender = async (style, seed) => {
      const s = state.freshSong(style, seed);
      s.artist = { style, seed };
      const buf = await render(s, 0, s.chain.length, { sampleRate: 44100, tail: 8 });
      const ch = [buf.getChannelData(0), buf.getChannelData(1)];
      const spec = spectrum(ch[0], ch[1], buf.sampleRate);
      const r = { style, seed, bars: s.chain.length, bpm: s.bpm, seconds: buf.duration, lufs: loudness(ch, buf.sampleRate).integrated, dbtp: 20 * Math.log10(truePeak(ch)), window: seed === 42 ? await windowLoudness(style) : null, spectrum: spec };
      const blob = encodeWav(ch, buf.sampleRate); window.jazzWav = new Uint8Array(await blob.arrayBuffer());
      return { ...r, bytes: window.jazzWav.length };
    };
  })()`);
  const out = previous.measurements.filter((r) => !selected.includes(r.style));
  for (const style of selected) for (const seed of style === 'neosoul' ? [42] : [11, 42, 77]) {
    const r = await run(`window.jazzRender(${JSON.stringify(style)}, ${seed})`);
    if (style !== 'neosoul' && seed !== 77) {
      const fd = openSync(resolve(dir, `${style}-${seed}.wav`), 'w');
      try {
        for (let offset = 0; offset < r.bytes; offset += 49152) {
          const chunk = await run(`btoa(String.fromCharCode(...window.jazzWav.subarray(${offset}, ${offset + 49152})))`);
          writeSync(fd, Buffer.from(chunk, 'base64'));
        }
      } finally { closeSync(fd); }
    }
    console.log(`${style}/${seed}: ${r.bars} bars, ${r.seconds.toFixed(1)} s, ${r.lufs.toFixed(2)} LUFS, ${r.dbtp.toFixed(2)} dBTP`);
    out.push(r);
  }
  return out;
});
if (!measurements) throw new Error('Chrome unavailable; full-song measurements not performed');
writeFileSync(resolve(dir, 'measurements.json'), JSON.stringify({ audit, measurements }, null, 2) + '\n');
if (process.argv.includes('--write-baseline')) {
  const file = resolve('test/loudness-baseline.json'), base = JSON.parse(readFileSync(file, 'utf8'));
  for (const style of ['swing', 'modal'].filter((s) => selected.includes(s))) {
    const rs = measurements.filter((r) => r.style === style), ls = rs.map((r) => r.lufs), round = (n) => +n.toFixed(2);
    base.styles[style] = { lufs: round(ls.reduce((a, b) => a + b, 0) / ls.length), spread: round(Math.max(...ls) - Math.min(...ls)), tp: round(Math.max(...rs.map((r) => r.dbtp))), window: round(rs.find((r) => r.seed === 42).window) };
  }
  writeFileSync(file, JSON.stringify(base, null, 1) + '\n');
  console.log('wrote swing/modal loudness baselines only (three full-song seeds, 44.1 kHz)');
}
const ref = measurements.find((r) => r.style === 'neosoul')?.spectrum;
for (const r of measurements.filter((r) => r.style !== 'neosoul')) {
  console.log(`${r.style}/${r.seed} spectral balance vs neosoul/42: ${JSON.stringify(r.spectrum)}; neosoul ${JSON.stringify(ref)}`);
  if (r.dbtp > -1) throw new Error(`${r.style}/${r.seed} exceeds -1 dBTP`);
}
