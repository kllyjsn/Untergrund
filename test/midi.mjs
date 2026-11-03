import assert from 'node:assert/strict';
import {
  parseMessage, sourceOf, sourceLabel, targetKind, targetLabel, defaultMap, MappingStore, createSmoother, createTakeover,
  createClockFollower, createTimebase, createClockSender, stepTicks, createMidiHub, TICKS_PER_STEP,
} from '../js/midi-core.js';

const near = (a, b, tol, msg) => assert(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };

// A fake Web MIDI: inputs fire 'midimessage', outputs record send(bytes, ts).
function fakeAccess(inNames = ['Pad Ctl'], outNames = ['TR-8']) {
  const mkIn = (name) => { const ls = []; return { name, id: name, addEventListener: (t, f) => t === 'midimessage' && ls.push(f), emit: (data, timeStamp = 0) => ls.forEach((f) => f({ data, timeStamp })) }; };
  const mkOut = (name) => ({ name, id: name, sent: [], send(b, ts) { this.sent.push([[...b], ts]); } });
  const inputs = new Map(inNames.map((n) => [n, mkIn(n)])), outputs = new Map(outNames.map((n) => [n, mkOut(n)]));
  const sl = [];
  return { inputs, outputs, addEventListener: (t, f) => t === 'statechange' && sl.push(f), plug(name) { inputs.set(name, mkIn(name)); sl.forEach((f) => f()); return inputs.get(name); } };
}

// Messages
{
  assert.deepEqual(parseMessage([0xb3, 74, 100]), { type: 'cc', ch: 3, num: 74, val: 100 });
  assert.deepEqual(parseMessage([0x99, 36, 0]), { type: 'noteoff', ch: 9, num: 36, val: 0 }, 'note-on velocity 0 is a note-off');
  assert.equal(parseMessage([0xf8]).type, 'clock');
  assert.deepEqual(parseMessage([0xf2, 0x10, 0x01]), { type: 'spp', pos: 0x90 });
  assert.equal(parseMessage([0xfe]), null, 'active sensing is ignored');
  assert.equal(sourceOf(parseMessage([0x90, 60, 90])), 'note:0:60');
  assert.equal(sourceLabel('cc:*:74'), 'CC 74');
  assert.equal(sourceLabel('note:9:36'), 'NOTE C2 · CH 10');
  assert.equal(targetKind('master:dj'), 'range');
  assert.equal(targetKind('track:kick:decay'), 'range');
  assert.equal(targetKind('pad:R'), 'hold');
  assert.equal(targetKind('pattern:2'), 'press');
  assert.equal(targetKind('track:kick:nope'), null);
  assert.equal(targetLabel('track:kick:decay'), 'KICK · DECAY');
  assert.equal(targetLabel('pattern:2'), 'PATTERN C');
}

// Mapping store: defaults, learn replaces, per-device persistence, clear vs reset
{
  const s = memStorage();
  const a = new MappingStore(s, 'Launchkey');
  assert.equal(a.custom, false);
  assert.equal(a.get('cc:0:21'), 'master:dj', 'generic knob bank on any channel');
  assert.equal(a.get('cc:5:70'), 'master:dj');
  assert.equal(a.get('note:9:36'), 'pad:R', 'channel-10 pads');
  assert.equal(a.get('note:0:36'), null, 'keyboard notes stay free for the piano');
  for (const t of Object.values(defaultMap())) assert(targetKind(t), `default target ${t} is valid`);
  a.learn('cc:0:30', 'master:dj');
  assert.equal(a.get('cc:0:30'), 'master:dj');
  assert.equal(a.get('cc:0:21'), null, 'learning a control again replaces its old sources');
  assert.deepEqual(a.sourcesFor('master:dj'), ['cc:0:30']);
  a.learn('cc:0:30', 'track:kick:decay');
  assert.deepEqual(a.sourcesFor('master:dj'), [], 'a source drives one control');
  const again = new MappingStore(s, 'Launchkey');
  assert.equal(again.get('cc:0:30'), 'track:kick:decay', 'persists per device');
  assert.equal(new MappingStore(s, 'nanoKONTROL').get('cc:0:30'), null, 'other devices keep their own map');
  again.remove('cc:0:30');
  assert.equal(new MappingStore(s, 'Launchkey').get('cc:0:30'), null);
  again.clear();
  assert.equal(new MappingStore(s, 'Launchkey').list().length, 0, 'cleared stays cleared (not back to defaults)');
  again.reset();
  assert.equal(new MappingStore(s, 'Launchkey').get('cc:0:21'), 'master:dj', 'reset restores defaults');
  assert(again.list().every((r) => r.label && r.source));
  const bad = memStorage(); bad.setItem('untergrund.midi.map:X', '{oops');
  assert.equal(new MappingStore(bad, 'X').get('cc:0:21'), 'master:dj', 'corrupt storage falls back to defaults');
}

// Smoothing: a 0→127 jump glides monotonically instead of zippering, then settles
{
  const sm = createSmoother({ tau: 0.03 });
  sm.set('k', 1, 0);
  const vals = [];
  for (let i = 0; i < 40 && sm.active; i++) vals.push(sm.step(1 / 60)[0][1]);
  assert(vals.length > 5, 'takes several frames');
  assert(vals[0] > 0 && vals[0] < 0.6, `first frame moves part way (${vals[0]})`);
  for (let i = 1; i < vals.length; i++) assert(vals[i] >= vals[i - 1], 'monotonic');
  assert.equal(vals.at(-1), 1, 'lands exactly on the target');
  assert.equal(sm.active, false);
  sm.set('k', 0.5, 0.2); sm.step(0.016); sm.set('k', 0.6);
  assert(sm.step(0.016)[0][1] > 0.2, 'retargets without restarting from the old value');
}

// Soft takeover: no jump until the knob reaches the control; on-screen edits release it
{
  const tk = createTakeover();
  assert.equal(tk.accept('f', 0.0, 0.5), false, 'far below: ignored');
  assert.equal(tk.accept('f', 0.3, 0.5), false);
  assert.equal(tk.accept('f', 0.6, 0.5), true, 'crossing the current value picks it up');
  tk.wrote('f', 0.6);
  assert.equal(tk.accept('f', 0.7, 0.6), true, 'stays engaged');
  tk.wrote('f', 0.7);
  assert.equal(tk.accept('f', 0.72, 0.1), false, 'someone moved it on screen: wait for pickup again');
  assert.equal(tk.accept('f', 0.12, 0.1), true, 'within the window picks up');
}

// Clock in: tempo from jittery ticks, smoothing, tempo change, transport events
{
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const f = createClockFollower();
  let t = 1000, evs = [];
  const tick = (bpm, jitter = 1.5) => { const iv = 60000 / bpm / 24; t += iv; evs.push(...f.message({ type: 'clock' }, t + (rnd() - 0.5) * 2 * jitter)); };
  evs.push(...f.message({ type: 'start' }, t));
  for (let i = 0; i < 24 * 8; i++) tick(120);
  assert.equal(evs[0].type, 'start', 'start lands on the first clock after FA');
  assert.equal(evs[0].step, 0);
  near(f.bpm, 120, 0.3, '120 BPM through ±1.5 ms jitter');
  const tempos = evs.filter((e) => e.type === 'tempo');
  assert(tempos.length < 20, `smoothed, not chattering (${tempos.length} updates)`);
  const steps = evs.filter((e) => e.type === 'step');
  assert.equal(steps.length, 8 * 4 - 1, 'a step event every 6 ticks after the start');
  assert.equal(steps[0].step, 1); assert.equal(steps.at(-1).step, 31);
  for (let i = 0; i < 24 * 4; i++) tick(128);
  near(f.bpm, 128, 0.3, 'follows a tempo change within a bar');
  evs = []; evs.push(...f.message({ type: 'stop' }, t));
  assert.deepEqual(evs, [{ type: 'stop' }]);
  assert.equal(f.running, false);
  f.message({ type: 'spp', pos: 64 }, t);
  f.message({ type: 'continue' }, t);
  evs = []; tick(128);
  assert.deepEqual(evs.map((e) => [e.type, e.step]), [['continue', 64]], 'SPP + continue resumes at bar 5');
  evs = []; t += 1000; evs.push(...f.message({ type: 'clock' }, t));
  assert(!evs.some((e) => e.type === 'tempo'), 'a long gap does not produce a bogus tempo');
}

// Clock out: timebase smoothing, 6 even ticks per step, start/SPP/continue/stop
{
  const tb = createTimebase();
  let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 200; i++) tb.update(i * 0.01, 5000 + i * 10 + (rnd() - 0.5) * 4);
  near(tb.offset, 5000, 0.6, 'offset smooths out ±2 ms timestamp noise');
  near(tb.toPerf(2), 7000, 0.6, 'audio seconds → performance.now ms');
  assert.deepEqual(stepTicks(100, 120), [100, 120, 140, 160, 180, 200]);

  const sent = [], cs = createClockSender((b, ts) => sent.push([b, ts]));
  cs.step(0, 1000, 125);
  assert.equal(sent.length, 0, 'no ticks before start');
  cs.start(0, 1000);
  cs.step(0, 1000, 125); cs.step(1, 1125, 125); cs.step(1, 1125, 125);
  assert.deepEqual(sent[0], [[0xfa], 999], 'Start just before the first tick');
  assert.equal(sent.filter(([b]) => b[0] === 0xf8).length, 12, 'duplicate steps are not re-sent');
  const ts = sent.filter(([b]) => b[0] === 0xf8).map(([, t]) => t);
  for (let i = 1; i < ts.length; i++) near(ts[i] - ts[i - 1], 125 / TICKS_PER_STEP, 1e-9, 'even tick spacing');
  cs.stop(1300);
  assert.deepEqual(sent.at(-1), [[0xfc], 1300]);
  sent.length = 0;
  cs.start(130, 2000);
  assert.deepEqual(sent.map(([b]) => b), [[0xf2, 130 & 0x7f, 130 >> 7], [0xfb]], 'mid-song: SPP then Continue');
}

// Hub with a fake MIDIAccess: default map, learn, takeover + glide, pads, clock in/out
{
  const access = fakeAccess(['Pad Ctl', 'DAW'], ['TR-8']);
  const storage = memStorage();
  const vals = { 'master:dj': 0.5, 'track:kick:decay': 0.2 }, presses = [], clocks = [], learned = [];
  let wakes = 0;
  const hub = createMidiHub(access, { storage, now: () => 0, actions: {
    get: (t) => vals[t] ?? 0, set: (t, n) => { vals[t] = n; }, press: (t, d) => presses.push([t, d]),
    learned: (t, s) => learned.push([t, s]), clock: (e) => clocks.push(e), wake: () => wakes++,
  } });
  const pad = access.inputs.get('Pad Ctl');
  pad.emit([0xb0, 21, 0]);
  assert.equal(vals['master:dj'], 0.5, 'default CC 21 → FILTER, but takeover holds it');
  pad.emit([0xb0, 21, 70]);
  assert.equal(wakes, 1, 'crossing picks up and starts the glide');
  for (let i = 0; i < 30 && hub.frame(1 / 60); i++);
  near(vals['master:dj'], 70 / 127, 1e-9, 'glides to the knob');
  pad.emit([0x99, 36, 100]); pad.emit([0x89, 36, 0]); pad.emit([0x99, 44, 90]); pad.emit([0x89, 44, 0]);
  assert.deepEqual(presses, [['pad:R', true], ['pad:R', false], ['pattern:0', true]], 'hold pads release, press targets act once');

  hub.arm('track:kick:decay');
  pad.emit([0xb0, 40, 3]);
  assert.deepEqual(learned, [['track:kick:decay', 'cc:0:40']]);
  assert.equal(hub.armed, null);
  assert.equal(new MappingStore(storage, 'Pad Ctl').get('cc:0:40'), 'track:kick:decay', 'learned map saved under the device name');
  pad.emit([0xb0, 40, 26]); hub.frame(1);
  near(vals['track:kick:decay'], 26 / 127, 1e-9, 'learned CC drives the knob');
  hub.arm('pad:T'); pad.emit([0x90, 60, 0]); assert.equal(hub.armed, 'pad:T', 'note-offs do not learn');
  pad.emit([0x90, 60, 80]); assert.equal(hub.store('Pad Ctl').get('note:0:60'), 'pad:T');

  // Hot-plug: a new controller is bound with its own defaults
  const late = access.plug('MPK mini');
  late.emit([0x99, 39, 100]);
  assert.deepEqual(presses.at(-1), ['transport:play', true]);

  // Clock in only from the followed port
  const daw = access.inputs.get('DAW');
  daw.emit([0xfa], 0); daw.emit([0xf8], 10);
  assert.equal(clocks.length, 0, 'not following yet');
  hub.follow('DAW');
  daw.emit([0xfa], 100);
  for (let i = 0; i < 48; i++) daw.emit([0xf8], 100 + i * 20.8333);
  assert.equal(clocks[0].type, 'start');
  assert(clocks.some((e) => e.type === 'tempo' && Math.abs(e.bpm - 120) < 0.3), 'tempo from incoming clock');
  pad.emit([0xfc]); assert(!clocks.some((e) => e.type === 'stop'), 'stop from other ports is ignored');
  daw.emit([0xfc]); assert.equal(clocks.at(-1).type, 'stop');

  // Clock out to the chosen output, scheduled from audio time
  const tr8 = access.outputs.get('TR-8');
  hub.clockOut('TR-8');
  hub.timebase.update(1, 11000); // audio 1 s == perf 11000 ms
  hub.clockStart(0, 2); hub.clockStep(0, 2, 0.125); hub.clockStep(1, 2.125, 0.125);
  assert.deepEqual(tr8.sent[0], [[0xfa], 11999]);
  assert.equal(tr8.sent.filter(([b]) => b[0] === 0xf8).length, 12);
  near(tr8.sent[1][1], 12000, 1e-9, 'first tick at the step time');
  hub.clockStop(); assert.deepEqual(tr8.sent.at(-1)[0], [0xfc]);
  hub.clockOut(null); hub.clockStart(0, 3); assert.deepEqual(tr8.sent.at(-1)[0], [0xfc], 'clock off sends nothing');
}

// No Web MIDI at all (Safari): the hub still constructs and does nothing
{
  const hub = createMidiHub(null, { storage: memStorage() });
  assert.deepEqual(hub.inputs(), []);
  hub.clockStart(0, 1); hub.clockStop(); hub.follow('x');
}

console.log('midi: ok');
