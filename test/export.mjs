// EXPORT MIDI + stems zip: the .mid parses back (tracks, metas, note counts), the zip passes `unzip -t`.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultState, generate, applyOverrides, arrangement, songChain } from '../js/state.js';
import { songMidi, capture, GM_DRUMS, PPQ, keySignature, parseKeyName } from '../js/midi.js';
import { compose } from '../js/classical.js';
import { registerPiece, PIECE } from '../js/repertoire.js';
import { ZipWriter, crc32 } from '../js/zip.js';
import { exportName } from '../js/stems.js';

// A minimal Standard MIDI File reader.
function parseMidi(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o, n) => String.fromCharCode(...bytes.slice(o, o + n));
  assert.equal(str(0, 4), 'MThd');
  const format = v.getUint16(8), ntrks = v.getUint16(10), ppq = v.getUint16(12);
  let o = 14;
  const tracks = [];
  for (let k = 0; k < ntrks; k++) {
    assert.equal(str(o, 4), 'MTrk');
    const len = v.getUint32(o + 4), end = o + 8 + len;
    o += 8;
    const tr = { name: '', notes: [], metas: [], programs: [], channels: new Set() };
    let tick = 0, running = 0;
    const open = new Map();
    const vlq = () => { let n = 0, b; do { b = bytes[o++]; n = (n << 7) | (b & 127); } while (b & 128); return n; };
    while (o < end) {
      tick += vlq();
      let st = bytes[o];
      if (st < 0x80) st = running; else o++;
      if (st === 0xff) {
        const type = bytes[o++], n = vlq(), data = bytes.slice(o, o + n); o += n;
        if (type === 0x03) tr.name = new TextDecoder().decode(data);
        tr.metas.push({ tick, type, data: [...data] });
        if (type === 0x2f) break;
        continue;
      }
      running = st;
      const kind = st & 0xf0, ch = st & 15;
      if (kind === 0xc0) { tr.programs.push(bytes[o++]); continue; }
      const a = bytes[o++], b = bytes[o++];
      tr.channels.add(ch);
      if (kind === 0x90 && b > 0) { const n = { tick, m: a, vel: b, ch }; tr.notes.push(n); open.set(ch * 128 + a, n); }
      else if (kind === 0x80 || (kind === 0x90 && b === 0)) { const n = open.get(ch * 128 + a); if (n) { n.dur = tick - n.tick; open.delete(ch * 128 + a); } }
    }
    assert.equal(o, end, 'track length matches its chunk');
    assert.equal(open.size, 0, `${tr.name}: every note-on has a note-off`);
    tracks.push(tr);
  }
  assert.equal(o, bytes.length);
  return { format, ppq, tracks };
}

function song(style, seed) {
  const s = defaultState(), g = generate(style, seed);
  applyOverrides(s, g); s.key = g.key;
  s.patterns = arrangement(g.pattern, seed); s.chainOn = true; s.chain = songChain(style, seed);
  s.artist = { title: 'Night Bus', style, seed };
  return s;
}

// Loop genres: one track per instrument, drums on channel 10 with the GM map, counts and timing as played.
for (const [style, seed] of [['neosoul', 42], ['deephouse', 7], ['hypnotic', 3]]) {
  const s = song(style, seed), r = songMidi(s), m = parseMidi(r.bytes);
  assert.equal(m.format, 1); assert.equal(m.ppq, PPQ);
  assert.equal(m.tracks.length, r.tracks.length + 1, `${style}: conductor + one track per instrument`);
  const cond = m.tracks[0], tempo = cond.metas.find((x) => x.type === 0x51), sig = cond.metas.find((x) => x.type === 0x58), key = cond.metas.find((x) => x.type === 0x59);
  assert.equal(Math.round(60e6 / ((tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2])), s.bpm, `${style} tempo`);
  assert.deepEqual(sig.data.slice(0, 2), [4, 2], `${style} 4/4`);
  const ks = keySignature(s.key, s.scale !== 'major');
  assert.deepEqual(key.data, [ks.sf & 255, ks.mi]);
  assert.equal(cond.metas.filter((x) => x.type === 0x06).length, r.bars, `${style}: one chord marker per bar`);
  const c = capture(s);
  r.tracks.forEach((t, i) => {
    const tr = m.tracks[i + 1];
    assert.equal(tr.name, t.name);
    assert.equal(tr.notes.length, t.notes, `${style} ${t.name} note count`);
    assert(t.notes > 0);
    const raw = c.notes[t.id].length;
    assert(t.notes <= raw && t.notes >= raw * 0.9, `${style} ${t.name}: ${t.notes} of ${raw} captured notes survive`);
    if (GM_DRUMS[t.id] != null) {
      assert.deepEqual([...tr.channels], [9], `${t.name} on channel 10`);
      assert(tr.notes.every((n) => n.m === GM_DRUMS[t.id]), `${t.name} GM note`);
    } else assert(!tr.channels.has(9), `${t.name} not on the drum channel`);
  });
  // Microtiming survives: humanized/pocketed hits fall off the 16th grid, velocities vary.
  const hats = m.tracks.find((t) => t.name === 'Hats');
  if (s.master.humanize > 0.1) assert(hats.notes.some((n) => n.tick % (PPQ / 4)), `${style}: hats keep their microtiming`);
  assert(new Set(hats.notes.map((n) => n.vel)).size > 3, `${style}: hat velocities preserved`);
  console.log(`${style} ${seed}: ${r.tracks.map((t) => `${t.name} ${t.notes}`).join(', ')}`);
}

// Independent kick count: with variation and the drop build off, every written kick in the chain plays once.
{
  const s = song('hypnotic', 3);
  s.master.vary = 0; s.master.arr = 0;
  const chain = s.chain.replace(/[^A-H]/g, '').split('').map((x) => x.charCodeAt(0) - 65);
  const expected = chain.reduce((a, p) => a + s.patterns[p].steps.kick.slice(0, s.patterns[p].len.kick || 16).filter(Boolean).length * (16 / (s.patterns[p].len.kick || 16)), 0);
  const m = parseMidi(songMidi(s).bytes), kick = m.tracks.find((t) => t.name === 'Kick');
  assert.equal(kick.notes.length, expected, 'kick count = written kicks across the chain');
  console.log(`independent kick count ${expected} passed`);
}

// CLASSICAL: one track per orchestra part, every written note exported once, metre from the score.
for (const spec of [{ form: 'symphony', seed: 5, mode: 'M' }, { form: 'nocturne', seed: 9, mode: 'm' }]) {
  const g = generate(spec.form, spec.seed), s = defaultState();
  applyOverrides(s, g); s.key = g.key;
  s.patterns = arrangement({ ...g.pattern, score: spec }, spec.seed); s.chainOn = true; s.chain = 'A';
  // A part can't strike one pitch twice at once, so unisons written twice in a part export as one note.
  const sc = compose(spec), want = {}, seen = new Set();
  for (const n of sc.notes) { const k = `${n[4]}|${n[0]}|${n[1]}|${n[5] || 0}`; if (seen.has(k)) continue; seen.add(k); want[n[4]] = (want[n[4]] || 0) + 1; }
  const r = songMidi(s), m = parseMidi(r.bytes);
  assert.equal(r.bars, sc.bars);
  assert.deepEqual(Object.fromEntries(r.tracks.map((t) => [t.id, t.notes])), Object.fromEntries(Object.entries(want).filter(([, n]) => n)), `${spec.form}: notes per part`);
  assert(m.tracks[0].metas.filter((x) => x.type === 0x51).length > 10, `${spec.form}: rubato written as tempo changes`);
  assert.equal(new Set(m.tracks.slice(1).map((t) => [...t.channels][0])).size, r.tracks.length, 'one channel per part');
  assert(!m.tracks.slice(1).some((t) => t.channels.has(9)));
  console.log(`${spec.form}: ${r.tracks.map((t) => `${t.name} ${t.notes}`).join(', ')}`);
}

// REPERTOIRE: a real masterwork, its own key and metre.
{
  const id = 'beethoven-fur-elise', raw = JSON.parse(readFileSync(`data/repertoire/${id}.json`, 'utf8'));
  const sc = registerPiece(raw), s = defaultState();
  s.bpm = PIECE[id].bpm; s.key = 0; s.chainOn = true; s.chain = 'A';
  s.patterns = arrangement({ ...s.patterns[0], score: { piece: id } }, 1);
  const r = songMidi(s), m = parseMidi(r.bytes);
  const total = sc.notes.length, got = r.tracks.reduce((a, t) => a + t.notes, 0);
  assert(got <= total && got >= total * 0.99, `${id}: ${got} of ${total} notes`);
  const barLen = sc.barLen || 16, sig = m.tracks[0].metas.find((x) => x.type === 0x58).data;
  assert.equal(sig[0] * (16 / 2 ** sig[1]), barLen, `${id}: metre`);
  const k = parseKeyName(PIECE[id].key), ks = keySignature(k.pc, k.minor);
  assert.deepEqual(m.tracks[0].metas.find((x) => x.type === 0x59).data, [ks.sf & 255, 1]);
  assert.equal(ks.sf, 0, 'A minor has no sharps or flats');
  console.log(`${id}: ${got} notes, ${sig[0]}/${2 ** sig[1]}`);
}
assert.deepEqual(parseKeyName('E-flat major'), { pc: 3, minor: false });
assert.deepEqual(parseKeyName('C# minor'), { pc: 1, minor: true });
assert.equal(keySignature(4, true).sf, 1, 'E minor: one sharp');
assert.equal(keySignature(5, false).sf, -1, 'F major: one flat');

// Store-only zip: CRCs, names, and (when available) `unzip -t`.
{
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const s = song('deephouse', 7), dir = exportName(s, '-stems');
  assert.equal(dir, `night-bus-${s.bpm}bpm-${['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][s.key]}m-stems`);
  const zip = new ZipWriter(), files = { [`${dir}/01-kick.wav`]: new Uint8Array(70001).map((_, i) => (i * 31) & 255), [`${dir}/README.txt`]: 'stems\n' };
  for (const [n, d] of Object.entries(files)) await zip.add(n, d);
  const bytes = new Uint8Array(await zip.blob().arrayBuffer());
  const tmp = mkdtempSync(join(tmpdir(), 'ug-zip-')), path = join(tmp, 'stems.zip');
  writeFileSync(path, bytes);
  let unzip = true;
  try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { unzip = false; }
  if (unzip) {
    const out = execFileSync('unzip', ['-t', path]).toString();
    assert.match(out, /No errors detected/);
    for (const n of Object.keys(files)) assert(out.includes(n), n);
    const back = execFileSync('unzip', ['-p', path, `${dir}/01-kick.wav`]);
    assert.deepEqual(new Uint8Array(back), files[`${dir}/01-kick.wav`]);
    console.log('zip passes unzip -t');
  } else console.log('unzip not installed; zip structure check only');
  assert.equal(new DataView(bytes.buffer).getUint32(bytes.length - 22, true), 0x06054b50);
  rmSync(tmp, { recursive: true, force: true });
}
console.log('export tests passed');
