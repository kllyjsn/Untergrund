// PRACTICE core: learn a REPERTOIRE piano piece note by note. Pure (no DOM, no audio), so the
// scoring can be tested headlessly. js/practice-ui.js draws it and wires it to the piano.
//
// Times here are score seconds at full speed ("pos"). The clock runs at `speed` score seconds per
// real second, so at 50% everything falls twice as slowly; timing errors are reported in real ms.

const EPS = 0.02;
export const TOGETHER = 0.06; // score seconds: onsets this close sound as one chord
export const SKIM = 1.5; // Wait mode skims silent gaps down to this many seconds before your next note
export const HANDS = { right: [0], left: [1], both: [0, 1] };

// Seconds at full speed for every step of the written score (written tempo changes, no rubato).
export function clockOf(raw) {
  const barLen = raw.barLen || 16, total = raw.bars * barLen, base = 60 / raw.bpm / 4;
  const mult = new Array(total).fill(1), written = raw.tempo || [];
  for (let i = 0, k = 0, w = 1; i < total; i++) {
    while (k < written.length && written[k][0] <= i) w = written[k++][1];
    mult[i] = w;
  }
  const cum = new Float64Array(total + 1);
  for (let i = 0; i < total; i++) cum[i + 1] = cum[i] + base * mult[i];
  return (s) => {
    const i = Math.max(0, Math.min(total - 1, Math.floor(s + 1e-9)));
    return cum[i] + (Math.max(0, Math.min(total, s)) - i) * base * mult[i];
  };
}

// Group the written piano notes into events (one chord or note onset each). `hands` picks which
// notes you play; the rest belong to the other hand. Bars are 0-based, `to` is exclusive.
export function timeline(raw, { hands = [0, 1], from = 0, to = raw.bars } = {}) {
  const barLen = raw.barLen || 16, secOf = clockOf(raw);
  from = Math.max(0, Math.min(raw.bars - 1, from | 0));
  to = Math.max(from + 1, Math.min(raw.bars, to | 0));
  const byStep = new Map();
  for (const [s, m, d, v, part, hand = 0] of raw.notes) {
    if (part !== 'pno') continue;
    const bar = Math.floor(s / barLen + 1e-9);
    if (bar < from || bar >= to) continue;
    const key = Math.round(s / EPS);
    if (!byStep.has(key)) byStep.set(key, { step: s, bar, t: secOf(s), notes: [] });
    byStep.get(key).notes.push({ m, hand, v, t: secOf(s), d: Math.max(0.05, secOf(s + d) - secOf(s)), target: hands.includes(hand) });
  }
  const events = [...byStep.values()].sort((a, b) => a.step - b.step);
  events.forEach((e, i) => {
    e.i = i;
    e.notes.sort((a, b) => a.m - b.m);
    e.want = [...new Set(e.notes.filter((n) => n.target).map((n) => n.m))];
  });
  const sections = (raw.sections || [{ at: 0, name: 'I' }]).map((x, i, a) => ({ ...x, len: (a[i + 1]?.at ?? raw.bars) - x.at }));
  return { events, notes: events.flatMap((e) => e.notes.map((n) => Object.assign(n, { bar: e.bar, ev: e }))), from, to,
    start: secOf(from * barLen), end: secOf(to * barLen), bars: raw.bars, barLen, sections, secOf, hands };
}

// Lowest and highest key the piece needs, widened to white keys so the keyboard starts and ends cleanly.
const BLACK = new Set([1, 3, 6, 8, 10]);
export function keyRange(raw) {
  let lo = 127, hi = 0;
  for (const n of raw.notes) if (n[4] === 'pno') { lo = Math.min(lo, n[1]); hi = Math.max(hi, n[1]); }
  if (lo > hi) return [48, 72];
  if (BLACK.has(lo % 12)) lo--;
  if (BLACK.has(hi % 12)) hi++;
  return [lo, hi];
}

// The computer keys cover 18 semitones from octave*12: pick the octave that reaches the most notes you play.
export function bestOctave(tl) {
  let best = 4, most = -1;
  for (let o = 1; o <= 6; o++) {
    const n = tl.notes.filter((x) => x.target && x.m >= o * 12 && x.m < o * 12 + 18).length;
    if (n > most) { most = n; best = o; }
  }
  return best;
}

// mode 'wait': the clock stops at each chord until you have played all its notes.
// mode 'play': the clock keeps going and each note is judged within `window` real seconds.
export function createSession(tl, { mode = 'wait', speed = 1, window = 0.2, autoOther = true, loop = false, lead = 2, ahead = 0.1 } = {}) {
  const clampSpeed = (x) => Math.max(0.25, Math.min(1, x));
  speed = clampSpeed(speed);
  const s = {
    tl, mode, speed, loop, pass: 1, done: false, started: false,
    pos: tl.start - lead * speed,
    cursor: 0, emitted: 0,
    wrong: [], hits: 0, missed: 0, errs: [],
  };
  const reset = () => {
    for (const e of tl.events) { e.got = new Set(); e.complete = !e.want.length; e.sent = false; }
    for (const n of tl.notes) { n.status = null; n.err = null; }
    s.cursor = 0; s.emitted = 0;
  };
  reset();
  const W = () => window * s.speed;
  s.setSpeed = (x) => { s.speed = clampSpeed(x); };
  const nextBlocking = () => { while (s.cursor < tl.events.length && tl.events[s.cursor].complete) s.cursor++; return tl.events[s.cursor]; };

  s.waiting = () => {
    if (mode !== 'wait') return null;
    const e = nextBlocking();
    return e && s.pos >= e.t - 1e-9 ? e : null;
  };

  // Run the clock forward by `dt` real seconds. Returns the other hand's notes to sound now
  // ({m, v, d, delay} with d and delay in real seconds), notes that went by unplayed, and loop/end flags.
  s.advance = (dt) => {
    const out = { autos: [], missed: [], looped: false, ended: false };
    if (s.done) return out;
    if (dt > 0) s.started = true;
    let next = s.pos + Math.max(0, dt) * s.speed;
    if (mode === 'wait') {
      const e = nextBlocking();
      // Nothing to play for a while and the other hand is silent: skim ahead to your next note.
      if (e && !autoOther && e.t - s.pos > SKIM * s.speed) next = Math.max(next, Math.min(e.t - SKIM * s.speed, s.pos + Math.max(0, dt) * s.speed * 8));
      if (e) next = Math.min(next, e.t);
    }
    s.pos = next;
    emit(out);
    if (mode === 'play') {
      for (const n of tl.notes) if (n.target && !n.status && n.t + W() < s.pos) { n.status = 'missed'; s.missed++; out.missed.push(n); }
    }
    const allDone = mode === 'wait' ? !nextBlocking() : tl.notes.every((n) => !n.target || n.status);
    if (allDone && s.pos >= Math.max(tl.end, (tl.events.at(-1)?.t ?? tl.start) + W())) {
      if (loop) { reset(); s.pos = tl.start - s.speed; s.pass++; out.looped = true; }
      else { s.done = true; out.ended = true; }
    }
    return out;
  };
  function emit(out) {
    for (const e of tl.events) {
      if (e.sent || e.t > s.pos + ahead * s.speed) continue;
      if (mode === 'wait' && !e.complete) continue;
      e.sent = true;
      for (const n of e.notes) if (!n.target && autoOther) out.autos.push({ m: n.m, v: n.v, d: n.d / s.speed, delay: Math.max(0, (n.t - s.pos) / s.speed), hand: n.hand });
    }
  }

  // You played key m now. Returns { ok, note?, err? (real ms, + late), event? }.
  s.press = (m) => {
    if (s.done) return { ok: null };
    s.started = true;
    if (mode === 'wait') {
      const first = nextBlocking();
      if (!first) return { ok: null };
      // Notes that sound together to the ear (e.g. 4 against 3) count in either order.
      let e = first;
      if (!e.want.includes(m) || e.got.has(m)) {
        for (let i = s.cursor + 1; i < tl.events.length && tl.events[i].t - first.t <= TOGETHER; i++) {
          const x = tl.events[i];
          if (x.want.includes(m) && (e === first || !x.got.has(m))) e = x;
          if (!x.complete && x.want.includes(m) && !x.got.has(m)) break;
        }
      }
      if (e.want.includes(m)) {
        if (e.got.has(m)) return { ok: null, event: e };
        e.got.add(m);
        const hit = e.notes.filter((n) => n.target && n.m === m);
        for (const n of hit) n.status = 'hit';
        s.hits += hit.length;
        if (e.want.every((x) => e.got.has(x))) {
          e.complete = true;
          const out = { autos: [], missed: [] };
          emit(out);
          return { ok: true, note: hit[0], event: e, complete: true, autos: out.autos };
        }
        return { ok: true, note: hit[0], event: e };
      }
      s.wrong.push({ m, bar: first.bar, t: s.pos });
      return { ok: false, event: first };
    }
    let best = null;
    for (const n of tl.notes) {
      if (!n.target || n.status || n.m !== m || Math.abs(n.t - s.pos) > W()) continue;
      if (!best || Math.abs(n.t - s.pos) < Math.abs(best.t - s.pos)) best = n;
    }
    if (!best) {
      const near = tl.events.reduce((a, e) => (Math.abs(e.t - s.pos) < Math.abs(a.t - s.pos) ? e : a), tl.events[0] || { bar: tl.from, t: 0 });
      s.wrong.push({ m, bar: near.bar, t: s.pos });
      return { ok: false };
    }
    best.status = 'hit';
    best.err = Math.round(((s.pos - best.t) / s.speed) * 1000);
    s.hits++;
    s.errs.push(best.err);
    return { ok: true, note: best, err: best.err };
  };

  s.summary = () => summarize(s);
  return s;
}

export function summarize(s) {
  const judged = s.hits + s.missed, wrong = s.wrong.length;
  const total = s.tl.notes.filter((n) => n.target).length;
  const errs = s.errs, mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const perBar = new Map();
  for (const n of s.tl.notes) if (n.status === 'missed') perBar.set(n.bar, (perBar.get(n.bar) || 0) + 1);
  for (const w of s.wrong) perBar.set(w.bar, (perBar.get(w.bar) || 0) + 1);
  for (const n of s.tl.notes) if (n.status === 'hit' && Math.abs(n.err ?? 0) > 120) perBar.set(n.bar, (perBar.get(n.bar) || 0) + 0.5);
  const worst = [...perBar].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 3).map(([bar, errors]) => ({ bar, errors }));
  return {
    mode: s.mode, speed: s.speed, pass: s.pass,
    accuracy: judged + wrong ? Math.round((100 * s.hits) / (judged + wrong)) : null,
    hits: s.hits, missed: s.missed, wrong, judged, total,
    timing: s.mode === 'play' && errs.length ? Math.round(mean(errs.map(Math.abs))) : null,
    lean: s.mode === 'play' && errs.length ? Math.round(mean(errs)) : null,
    worst,
  };
}

// Best accuracy per piece, kept only for a real attempt (a dozen notes or more).
export function recordBest(store, id, sum) {
  if (sum.accuracy == null || sum.judged + sum.wrong < 12) return { store, best: false };
  const prev = store[id];
  if (prev && prev.accuracy >= sum.accuracy) return { store, best: false };
  return { store: { ...store, [id]: { accuracy: sum.accuracy, mode: sum.mode, speed: sum.speed } }, best: true };
}
