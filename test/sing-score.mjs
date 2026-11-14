// The neural singer's score (js/sing-score.js) and the env-gated /api/sing proxy (api/_lib/sing.js). No model runs here:
// the singer is a mock fetch.
import assert from 'node:assert/strict';
import { rulePlan, planLyrics } from '../js/song-plan.js';
import { localSpec, songState } from '../js/song-spec.js';
import { defaultState, sanitize } from '../js/state.js';
import { lineSlots } from '../js/lyrics.js';
import { singScore, sungNotes, validateSing, noteName, SING_VOICES, SING_FORMAT } from '../js/sing-score.js';
import { handleSing, memorySingStore, blobSingStore, singHash, SING_PER_HOUR } from '../api/_lib/sing.js';
import { memoryKv } from '../api/_lib/events.js';

let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const LYRICS = `[Verse]\nStreetlights hum along the avenue\nI keep the window open just for you\n[Chorus]\nStay with me tonight\nHold on till the morning light\n[Bridge]\nEven when the city sleeps\nI keep your secret deep`;
const song = (prompt, seed = 7) => { const st = songState(localSpec(prompt, {}), seed, defaultState()).state; st.lyrics = planLyrics(rulePlan(prompt, LYRICS), prompt); return st; };
const SONGS = { pop: 'upbeat pop song about summer nights, female vocal', rnb: 'smooth rnb love song, male vocal', folk: 'folk singer-songwriter song about an old river town' };
const beats = (rows) => rows.reduce((a, r) => a + r[2], 0);

for (const [id, prompt] of Object.entries(SONGS)) {
  await t(`${id}: a valid, deterministic score on the song's grid`, () => {
    const st = song(prompt), a = singScore(st), b = singScore(song(prompt));
    assert.equal(a.format, SING_FORMAT);
    assert.deepEqual(a, b, 'same song, same score and seed');
    assert.ok(validateSing(a), 'passes the server check');
    assert.equal(a.score.bpm, st.bpm);
    assert.equal(a.score.style, id === 'folk' || st.bpm < 84 ? 'ballad' : 'pop');
    assert.equal(a.voice, { pop: 'gwen', rnb: 'rex', folk: 'ariadne' }[id]);
    // Every sung note starts where the engine plays it: the score's clock is the Sequencer's.
    const sung = sungNotes(st), starts = new Set(sung.map((x) => x.at / 4));
    let at = 0, hits = 0, notes = 0;
    for (const [label, , d] of a.score.notes) { if (label !== '-') { notes++; if ([...starts].some((s) => Math.abs(s - at) < 1e-3) || !Number.isInteger(at * 4)) hits++; } at += d; }
    assert.ok(hits / notes > 0.9, `${id}: ${hits}/${notes} notes on the melody's onsets`);
    assert.ok(beats(a.score.notes) <= (st.chain.length * 4) + 1e-6, 'never longer than the song');
    // Words are the lyrics, in order, and the text is exactly the score's words.
    const words = a.score.notes.filter(([l]) => l !== '-' && !/~([2-9]|\d\d)$/.test(l)).map(([l]) => l.split('~')[0]);
    assert.equal(words.join(' '), a.score.text);
    assert.ok(a.score.text.includes('streetlights hum along the avenue') && a.score.text.includes('stay with me tonight'), a.score.text.slice(0, 60));
    assert.ok(a.phrases.some((p) => p.part === 'b' && p.text.includes('city sleeps')), 'the bridge sings the bridge');
    assert.ok(a.score.notes.some(([l]) => l === '-'), 'breathes between phrases');
  });
}

await t('melismas number their parts without a rest between them', () => {
  const rows = singScore(song(SONGS.rnb)).score.notes;
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i][0].match(/^(.+)~(\d+)$/);
    if (m && +m[2] > 1) assert.equal(rows[i - 1][0], `${m[1]}~${+m[2] - 1}`, `${rows[i - 1][0]} -> ${rows[i][0]}`);
  }
  assert.ok(rows.some(([l]) => /~2$/.test(l)), 'has multi-note words');
});

await t('no lyrics, no melody or no chain: nothing to sing', () => {
  const st = song(SONGS.pop);
  assert.equal(singScore({ ...st, lyrics: null }), null);
  assert.equal(singScore({ ...st, chainOn: false }), null);
  assert.equal(singScore(defaultState()), null);
});

await t('voices are the built-in ones only; seeds and formats pass through', () => {
  const st = song(SONGS.pop);
  assert.equal(singScore(st, { voice: 'tuesday', seed: 42, format: 'mp3' }).voice, 'tuesday');
  assert.equal(singScore(st, { voice: 'my-ex.wav' }).voice, 'gwen');
  assert.equal(singScore(st, { seed: 42 }).seed, 42);
  assert.equal(SING_VOICES.length, 14);
  assert.equal(noteName(60), 'C4'); assert.equal(noteName(61), 'C#4'); assert.equal(noteName(47), 'B2');
});

await t('validateSing rejects hostile or oversized requests', () => {
  const ok = singScore(song(SONGS.pop));
  const bad = (f) => { const r = JSON.parse(JSON.stringify(ok)); f(r); return validateSing(r); };
  assert.equal(bad((r) => { r.voice = 'https://evil/ref.wav'; }), null);
  assert.equal(bad((r) => { r.reference = 'x'; r.voice = 'clone'; }), null);
  assert.equal(bad((r) => { r.score.text += ' extra'; }), null);
  assert.equal(bad((r) => { r.score.notes[1][1] = 'C9'; }), null);
  assert.equal(bad((r) => { r.score.notes[1][0] = '<script>'; }), null);
  assert.equal(bad((r) => { r.score.bpm = 1e6; }), null);
  assert.equal(bad((r) => { r.score.style = 'rap'; }), null);
  assert.equal(bad((r) => { r.score.notes = Array(2000).fill(['-', 'rest', 1]); }), null);
  assert.equal(bad((r) => { r.score.notes.push(['-', 'rest', 64], ['-', 'rest', 64], ['-', 'rest', 64], ['-', 'rest', 64], ['-', 'rest', 64], ['-', 'rest', 64], ['-', 'rest', 64], ['-', 'rest', 64]); }), null, 'too long');
  assert.equal(bad((r) => { r.seed = -1; }), null);
  assert.equal(validateSing(null), null);
  const clean = validateSing({ ...ok, extra: 'dropped' });
  assert.deepEqual(Object.keys(clean).sort(), ['audio', 'expr', 'format', 'score', 'seed', 'voice']);
  // Expression knobs: known names only, clamped to their ranges; none at all leaves the runtime's own singing.
  const x = validateSing({ ...ok, expr: { vib_cents: 900, scoop: -4, lead: 0.5, align: true, eval: 'x', breath: NaN } }).expr;
  assert.deepEqual(x, { scoop: 0, vib_cents: 80, lead: 0.5, align: 1 });
  assert.equal('expr' in validateSing({ ...ok, expr: { nope: 1 } }), false);
});

await t('old projects and share links still load; sing settings survive sanitize', () => {
  const st = song(SONGS.folk), old = sanitize(JSON.parse(JSON.stringify({ ...st, sing: undefined })));
  assert.equal(old.sing, undefined);
  const s = sanitize({ ...st, sing: { on: true, voice: 'max', db: 40, ms: -9999, x: 1 } });
  assert.deepEqual(s.sing, { on: true, voice: 'max', db: 6, ms: -250 });
  assert.equal(sanitize({ ...st, sing: { voice: 'clone:me' } }).sing?.voice, undefined);
});

// /api/sing with a mock singer.
const AUDIO = Buffer.from('OggS fake opus');
function mockSinger({ pending = 1 } = {}) {
  const calls = [];
  let left = pending;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.headers.Authorization, 'Bearer s3cret');
    if (url.endsWith('/submit')) return new Response(JSON.stringify({ id: 'fc-01ABC' }), { status: 202 });
    if (url.includes('/result?id=fc-01ABC')) return left-- > 0 ? new Response('{"status":"pending"}', { status: 202 }) : new Response(AUDIO, { status: 200, headers: { 'Content-Type': 'audio/ogg' } });
    return new Response('{}', { status: 404 });
  };
  return { calls, fetchImpl };
}
const ENV = { url: 'https://singer.example', secret: 's3cret' };

await t('/api/sing is off without SINGER_URL and SINGER_SECRET', async () => {
  const store = memorySingStore();
  assert.deepEqual((await handleSing({ method: 'GET', store })).json, { enabled: false });
  assert.equal((await handleSing({ method: 'POST', body: '{}', store, url: ENV.url })).status, 501);
  assert.deepEqual((await handleSing({ method: 'GET', store, ...ENV })).json, { enabled: true });
});

await t('/api/sing: submit, poll, cache by content hash', async () => {
  const store = memorySingStore(), kv = memoryKv(), { calls, fetchImpl } = mockSinger(), req = singScore(song(SONGS.pop));
  const a = await handleSing({ method: 'POST', body: JSON.stringify(req), store, kv, fetchImpl, ...ENV });
  assert.equal(a.status, 202);
  assert.equal(a.json.hash, singHash(validateSing(req)));
  assert.equal(JSON.parse(calls[0].init.body).voice, 'gwen');
  const poll = (job = a.json.job, hash = a.json.hash) => handleSing({ method: 'POST', body: JSON.stringify({ job, hash }), store, kv, fetchImpl, ...ENV });
  assert.equal((await poll()).status, 202);
  const b = await poll();
  assert.equal(b.status, 200); assert.equal(b.type, 'audio/ogg'); assert.deepEqual(b.body, AUDIO);
  assert.equal((await poll('fc-other')).status, 404, 'a job only answers for its own hash');
  assert.equal((await poll(a.json.job, 'f'.repeat(64))).status, 404);
  const before = calls.length, c = await handleSing({ method: 'POST', body: JSON.stringify(req), store, kv, fetchImpl, ...ENV });
  assert.equal(c.status, 200); assert.deepEqual(c.body, AUDIO); assert.equal(calls.length, before, 'cached: the singer is not called again');
});

await t('/api/sing: validation, rate limit, timeouts and upstream failures', async () => {
  const kv = memoryKv(), req = singScore(song(SONGS.rnb));
  assert.equal((await handleSing({ method: 'POST', body: '{"format":"x"}', store: memorySingStore(), kv, ...ENV })).status, 400);
  assert.equal((await handleSing({ method: 'POST', body: 'x'.repeat(300 * 1024), store: memorySingStore(), kv, ...ENV })).status, 413);
  for (let i = 0; i < SING_PER_HOUR; i++) {
    const r = singScore(song(SONGS.rnb), { seed: i });
    assert.equal((await handleSing({ method: 'POST', body: JSON.stringify(r), store: memorySingStore(), kv, client: 'a', ...mockSinger(), ...ENV })).status, 202);
  }
  assert.equal((await handleSing({ method: 'POST', body: JSON.stringify(req), store: memorySingStore(), kv, client: 'a', ...mockSinger(), ...ENV })).status, 429);
  const hang = (u, init) => new Promise((_, no) => init.signal.addEventListener('abort', () => no(new Error('aborted'))));
  assert.equal((await handleSing({ method: 'POST', body: JSON.stringify(req), store: memorySingStore(), kv, client: 'b', fetchImpl: hang, timeout: 20, ...ENV })).status, 502);
  const down = async () => new Response('nope', { status: 500 });
  assert.equal((await handleSing({ method: 'POST', body: JSON.stringify(req), store: memorySingStore(), kv, client: 'c', fetchImpl: down, ...ENV })).status, 502);
  const html = async (u) => (u.endsWith('/submit') ? new Response('{"id":"fc-1"}', { status: 202 }) : new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
  const store = memorySingStore(), s = await handleSing({ method: 'POST', body: JSON.stringify(req), store, kv, client: 'd', fetchImpl: html, ...ENV });
  assert.equal((await handleSing({ method: 'POST', body: JSON.stringify({ job: s.json.job, hash: s.json.hash }), store, kv, fetchImpl: html, ...ENV })).status, 502, 'only audio is passed on');
});

await t('/api/sing with Blob: the stem is stored once and served by URL', async () => {
  const kv = memoryKv(), puts = [];
  const store = blobSingStore(kv, { token: 'tok', putImpl: async (path, bytes, opts) => { puts.push({ path, opts }); return { url: `https://blob.example/${path}` }; } });
  const { fetchImpl } = mockSinger({ pending: 0 }), req = singScore(song(SONGS.folk));
  const a = await handleSing({ method: 'POST', body: JSON.stringify(req), store, kv, fetchImpl, ...ENV });
  const b = await handleSing({ method: 'POST', body: JSON.stringify({ job: a.json.job, hash: a.json.hash }), store, kv, fetchImpl, ...ENV });
  assert.equal(b.json.url, `https://blob.example/sing/${a.json.hash}.ogg`);
  assert.equal(puts[0].opts.access, 'public'); assert.equal(puts[0].opts.addRandomSuffix, false);
  const c = await handleSing({ method: 'POST', body: JSON.stringify(req), store, kv, fetchImpl, ...ENV });
  assert.equal(c.json.url, b.json.url); assert.equal(puts.length, 1);
  assert.equal(blobSingStore(kv, { token: '' }), null);
});

await t('lineSlots and the score agree on syllables', () => {
  const sc = singScore(song(SONGS.pop)), first = sc.phrases[0];
  assert.equal(lineSlots(first.text).length <= sc.score.notes.filter(([l]) => l !== '-').length, true);
});

await t('Engine.vocal: the stem plays from the song position, once across consecutive bars, into the mix', async () => {
  const { OfflineAudioContext, installGlobals } = await import('./offline-audio.mjs');
  installGlobals();
  const { Engine, Sequencer } = await import('../js/engine.js');
  const st = song(SONGS.pop), SR = 16000, sd = 60 / st.bpm / 4, len = Math.ceil((0.05 + 32 * sd + 0.2) * SR);
  const run = async (vocal) => {
    const ctx = new OfflineAudioContext(1, len, SR), buf = ctx.createBuffer(1, len, SR);
    buf.getChannelData(0).fill(0.25);
    let starts = 0;
    const e = new Engine(ctx, JSON.parse(JSON.stringify(st)), { realtime: false, vocal: vocal ? (s) => (s?.bpm ? { buf, gain: 1, ms: 0 } : null) : null });
    const make = ctx.createBufferSource.bind(ctx);
    ctx.createBufferSource = () => { const src = make(), go = src.start.bind(src); src.start = (...a) => { starts++; return go(...a); }; return src; };
    for (const k of Object.keys(st.mutes)) e.state.mutes[k] = true;
    const q = new Sequencer(e, e.state);
    for (let i = 0, at = 0.05; i < 32; i++) { q.tick(i, at); at += e.stepDur; }
    const d = (await ctx.startRendering(e.preMaster)).getChannelData(0);
    return { starts, rms: Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length) };
  };
  const off = await run(false), on = await run(true);
  assert.ok(on.rms > off.rms + 0.05, `vocal reaches the mix (${off.rms.toFixed(3)} -> ${on.rms.toFixed(3)})`);
  assert.equal(on.starts - off.starts, 1, 'one source for two consecutive bars');
});

await t('a sung mix stays on the instrumental\'s loudness: the band dips under the vocal', async () => {
  const { OfflineAudioContext, installGlobals } = await import('./offline-audio.mjs');
  installGlobals();
  const { Engine, Sequencer } = await import('../js/engine.js');
  const { loudness } = await import('../js/loudness.js');
  const { VOCAL_OVER_BAND_DB, VOCAL_DUCK_DB } = await import('../js/sing.js');
  const st = song(SONGS.pop), SR = 16000, bars = 8, sd = 60 / st.bpm / 4, len = Math.ceil((0.05 + bars * 16 * sd + 0.3) * SR);
  const run = async (vocal) => {
    const ctx = new OfflineAudioContext(1, len, SR), e = new Engine(ctx, JSON.parse(JSON.stringify(st)), { realtime: false, vocal });
    const q = new Sequencer(e, e.state);
    let at = 0.05;
    for (let i = 0; i < bars * 16; i++) { q.tick(i, at); at += e.stepDur; }
    e.vocalStop(at);
    return (await ctx.startRendering(e.preMaster)).getChannelData(0);
  };
  // Load the song's recordings and their alternate takes first, as an offline render does, so every run plays the same.
  const { loadSets, withTakes, liveSets } = await import('../js/livekit.js');
  await loadSets(withTakes(liveSets(st)));
  const band = await run(null), at0 = Math.round(0.05 * SR);
  // A mock singer: the band played backwards (its spectrum, uncorrelated with it) in 2.5 s phrases with 1.5 s breaths.
  const gate = (x) => x % (4 * SR) < 2.5 * SR, stem = new AudioBuffer(1, len, SR), d = stem.getChannelData(0);
  let pv = 0, pb = 0;
  for (let x = 0; x + at0 < len; x++) if (gate(x)) { d[x] = band[len - 1 - x]; pv += d[x] * d[x]; pb += band[x + at0] ** 2; }
  const duck = 10 ** (-VOCAL_DUCK_DB / 20), gain = duck * 10 ** (VOCAL_OVER_BAND_DB / 20) * Math.sqrt(pb / pv);
  const lu = (x) => loudness([x], SR).integrated, inst = lu(band);
  const sung = lu(await run((s) => (s?.bpm ? { buf: stem, gain, duck, ms: 0 } : null)));
  const hot = lu(await run((s) => (s?.bpm ? { buf: stem, gain, duck: 1, ms: 0 } : null)));
  assert.ok(Math.abs(sung - inst) < 0.5, `sung ${sung.toFixed(2)} vs instrumental ${inst.toFixed(2)} LUFS`);
  assert.ok(hot - inst > 0.7, `without the dip the vocal would add ${(hot - inst).toFixed(2)} LU`);
});

await t('the vocal chain: high-pass, de-ess and compression keep the stem at its sung level', async () => {
  const { processVocal, sungRms } = await import('../js/vocal-chain.js');
  const { VOCAL_FX } = await import('../js/sing.js');
  const SR = 24000, x = new Float32Array(SR * 2), band = (y, f0, f1) => {
    let s = 0; const N = 4096;
    for (let f = f0; f <= f1; f += 25) { let re = 0, im = 0; for (let i = 0; i < N; i++) { const w = (2 * Math.PI * f * i) / SR; re += y[SR + i] * Math.cos(w); im += y[SR + i] * Math.sin(w); } s += re * re + im * im; }
    return 10 * Math.log10(s + 1e-12);
  };
  let r = 1;
  for (let i = 0; i < x.length; i++) { r = (r * 16807) % 2147483647; x[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / SR) + 0.1 * Math.sin((2 * Math.PI * 40 * i) / SR) + (i > SR && i < SR + 4096 ? 0.3 * Math.sin((2 * Math.PI * 8000 * i) / SR) : 0) + 0.002 * (r / 2147483647 - 0.5); }
  const y = processVocal(x, SR, VOCAL_FX.pop);
  assert.ok(Math.abs(20 * Math.log10(sungRms(y, SR) / sungRms(x, SR))) < 0.1, 'sung level kept');
  assert.ok(band(x, 25, 50) - band(y, 25, 50) > 10, 'rumble under the high-pass goes');
  assert.ok(band(x, 7800, 8200) - band(y, 7800, 8200) > 3, 'sibilance is turned down');
  assert.equal(processVocal(x, SR, null), x);
});

await t('while the vocal sings the CHORDS channel dips in the presence band; genres send their own expression', async () => {
  const { OfflineAudioContext, installGlobals } = await import('./offline-audio.mjs');
  installGlobals();
  const { Engine } = await import('../js/engine.js');
  const { VOCAL_FX } = await import('../js/sing.js');
  const { SING_STYLE } = await import('../js/sing-score.js');
  const st = song(SONGS.pop), SR = 16000, ctx = new OfflineAudioContext(1, SR * 4, SR), buf = ctx.createBuffer(1, SR * 4, SR);
  buf.getChannelData(0).fill(0.25, SR, 3 * SR);
  const e = new Engine(ctx, JSON.parse(JSON.stringify(st)), { realtime: false, vocal: () => ({ buf, gain: 1, duck: 1, lift: 1, ms: 0, fx: VOCAL_FX.pop }) });
  e.vocal(0, 0);
  const g = e.ch.stab.carve.gain.events.map((x) => x.v);
  assert.ok(Math.abs(Math.min(...g) + VOCAL_FX.pop.carve.db) < 0.05 && Math.abs(g.at(-1)) < 0.25, `carve ${Math.min(...g)} dB, back to 0`);
  assert.equal(e.ch.stab.carve.frequency.events[0].v, VOCAL_FX.pop.carve.hz);
  for (const style of ['pop', 'rnb', 'folk']) {
    const s2 = song(SONGS[style]), req = singScore(s2);
    assert.deepEqual(req.expr, (SING_STYLE[s2.artist.style] || SING_STYLE.pop).expr);
    assert.deepEqual(validateSing(req).expr, req.expr);
  }
});

console.log(`sing-score: ${n} checks passed`);
