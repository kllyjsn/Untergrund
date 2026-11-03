// Every Club set records itself as replayable UNTERGRUND state + timeline; when the DJ stops or hands off the deck,
// one tap saves the cut to the jukebox. Lives outside the Club DOM (which re-renders on every heartbeat).
import { h } from './ui.js';
import { createTimelineRecorder, createReplayer, trimTimeline, stateAt, stepAt, MIN_SET_MS } from './set-timeline.js';
import { sheet, fmtTime, publishReplay, drawPeaks } from './sets.js';
import { track as trackEvent } from './analytics.js';

const PREF = 'untergrund.record-sets';
export const recordingOn = () => localStorage.getItem(PREF) !== '0';
let live = null;

export const liveSetRecording = () => !!live;

export function startLiveSet({ getState, getStyle, isPlaying, isDJ, startsAt, dj, room, title, toast }) {
  if (live || !recordingOn()) return;
  const rec = createTimelineRecorder({ state: getState(), style: getStyle(), startsAt, dj, room, title });
  live = { rec, startsAt, toast };
  live.timer = setInterval(() => {
    const now = Date.now();
    rec.capture(getState(), getStyle(), now);
    if (now > startsAt + 2500 && (!isPlaying() || !isDJ())) endLiveSet();
  }, 500);
}

export function endLiveSet({ offer = true } = {}) {
  if (!live) return null;
  const { rec, toast, timer } = live;
  clearInterval(timer); live = null;
  const timeline = rec.finish(Date.now());
  if (offer && timeline.duration >= MIN_SET_MS) offerSave(timeline, toast);
  return timeline;
}

// Replays a saved set from its timeline in lockstep with startsAt, so every listener in a room hears the same moment.
let replayTimer = 0;
export function stopTimeline() { clearInterval(replayTimer); replayTimer = 0; }
export function playTimeline(timeline, startsAt, { load, apply, play, isPlaying, onEnd }) {
  stopTimeline();
  const now = Date.now(), t = Math.max(0, now - startsAt);
  const at = stateAt(timeline, t);
  load(at.state, at.style);
  const { steps, bpm } = stepAt(timeline, t);
  const wait = Math.max(0, startsAt - now), step = wait ? 0 : Math.floor(steps) + 1;
  play({ step, delay: wait ? wait / 1000 : ((step - steps) * 15) / bpm });
  const rep = createReplayer(timeline, { startsAt, apply, onEnd: () => { stopTimeline(); onEnd?.(); } });
  rep.tick(now);
  replayTimer = setInterval(() => (isPlaying() ? rep.tick(Date.now()) : stopTimeline()), 200);
  return timeline.duration / 1000;
}

// Change density per slice of the set, drawn like a waveform so the DJ can see where the action was.
function activity(timeline, n = 200) {
  const out = new Array(n).fill(0.08), d = Math.max(1, timeline.duration);
  for (const ev of timeline.events) out[Math.min(n - 1, Math.floor((ev.t / d) * n))] += 0.12 * ev.ops.length;
  return out.map((v) => Math.min(1, v));
}

export function offerSave(timeline, toast = () => {}) {
  const dur = timeline.duration / 1000;
  let start = 0, end = dur, saved = false;
  const { body, close } = sheet('SAVE YOUR SET');
  body.closest('.overlay').classList.add('live-set-overlay');
  const canvas = h('canvas', { class: 'set-wave', width: 1000, height: 90 });
  const label = h('div', { class: 'set-range-label' });
  const peaks = activity(timeline);
  const redraw = () => { drawPeaks(canvas, peaks, start, end, dur); label.textContent = `IN ${fmtTime(start)}   OUT ${fmtTime(end)}   LENGTH ${fmtTime(end - start)}`; };
  const range = (v) => h('input', { type: 'range', class: 'set-range', min: 0, max: dur.toFixed(1), step: 0.5, value: v.toFixed(1) });
  const inR = range(0), outR = range(dur);
  inR.oninput = () => { start = Math.min(+inR.value, end - 5); inR.value = start; redraw(); };
  outR.oninput = () => { end = Math.max(+outR.value, start + 5); outR.value = end; redraw(); };
  const title = h('input', { class: 'inp', maxlength: 80, value: timeline.title || `${timeline.dj} live in ${timeline.room}` });
  const keep = h('input', { type: 'checkbox', onchange: () => localStorage.setItem(PREF, keep.checked ? '1' : '0') });
  keep.checked = recordingOn();
  const status = h('div', { class: 'pub-note set-status' });
  const save = h('button', { class: 'btn accent set-save-primary', onclick: async () => {
    if (saved) return close(true);
    save.disabled = true; status.textContent = 'Saving…';
    try {
      const name = title.value.trim() || title.placeholder || 'Live set';
      const cut = trimTimeline(timeline, start * 1000, end * 1000);
      const r = await publishReplay({ timeline: { ...cut, title: name }, title: name, artist: timeline.dj || 'UNTERGRUND', room: timeline.room });
      saved = true; save.textContent = 'DONE'; skip.remove();
      status.textContent = r.public ? 'In the jukebox. Anyone can replay it, or replay it to a room from the Club crate.' : 'Saved to the jukebox in this browser. It goes public once storage is connected.';
      trackEvent('publish', { kind: 'live_set', public: r.public });
      toast(`“${name}” is in the jukebox`);
    } catch (err) { status.textContent = 'Failed: ' + err.message; }
    save.disabled = false;
  } }, 'SAVE TO JUKEBOX');
  const skip = h('button', { class: 'btn ghost', onclick: () => close(true) }, 'NOT THIS ONE');
  body.append(h('div', { class: 'set-cut live-set-save' },
    h('div', { class: 'set-stats' }, h('b', {}, fmtTime(dur)), ` live in ${timeline.room || 'the Club'} · ${timeline.dj || 'UNTERGRUND'}`),
    h('div', { class: 'pub-note' }, 'Every move you made is saved, so it replays exactly as you played it. No audio upload.'),
    canvas,
    h('div', { class: 'set-ranges' }, h('label', { class: 'club-field set-field' }, h('span', {}, 'IN'), inR), h('label', { class: 'club-field set-field' }, h('span', {}, 'OUT'), outR)),
    label,
    h('label', { class: 'club-field set-field' }, h('span', {}, 'TITLE'), title),
    h('div', { class: 'set-actions' }, save, skip),
    h('label', { class: 'live-set-pref' }, keep, h('span', {}, 'Record my live sets')),
    status));
  redraw();
  save.focus();
  return { close };
}
