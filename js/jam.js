// Jam together: in a live Club room each person can take one part of the song (drums, bass, lead) and play it
// on the room's clock. A change lands on a downbeat everyone computes from the set's startsAt, so the whole room
// hears it on the same bar. Pure (Node + browser): the room service and every client share these rules.
import { sanitize, clone, generate, arrangement, mutate, STYLES } from './state.js';
import { SCALES } from './params.js';
import { handoffStep } from './handoff.js';
import { roomTransportPosition } from './room-sync.js';

export const PARTS = {
  drums: { label: 'DRUMS', tracks: ['kick', 'clap', 'snare', 'ch', 'oh', 'ride', 'perc'] },
  bass: { label: 'BASS', tracks: ['acid'] },
  lead: { label: 'LEAD', tracks: ['stab'], hook: true },
};
export const PART_IDS = Object.keys(PARTS);
// A change needs this long to reach every client (they poll about every 0.7 s), so it lands on the bar after.
export const JAM_LEAD = 1.5;
// The phrase (every 4 bars of the set) is the nicer place to change, if it is this close.
export const JAM_PHRASE_WAIT = 3;
const MAX_LAYER = 60000;

export function extractPart(state, part) {
  const { tracks, hook } = PARTS[part];
  return {
    patterns: state.patterns.map((p) => {
      const out = { steps: {}, len: {} };
      for (const id of tracks) { out.steps[id] = clone(p.steps[id]); out.len[id] = p.len[id]; }
      if (hook && p.hook) { out.hook = clone(p.hook); out.hm = p.hm ?? 2; }
      return out;
    }),
    params: Object.fromEntries(tracks.map((id) => [id, clone(state.params[id])])),
    mutes: Object.fromEntries(tracks.map((id) => [id, !!state.mutes?.[id]])),
  };
}

// Writes one part's layer into a whole song, in place; the other parts are untouched.
export function applyPart(state, part, layer) {
  const { tracks, hook } = PARTS[part];
  state.patterns.forEach((p, i) => {
    const l = layer.patterns[i];
    if (!l) return;
    for (const id of tracks) { p.steps[id] = clone(l.steps[id]); p.len[id] = l.len[id]; }
    if (hook) {
      delete p.hook; delete p.hm;
      if (l.hook) { p.hook = clone(l.hook); p.hm = l.hm ?? 2; }
    }
  });
  for (const id of tracks) {
    if (layer.params?.[id]) Object.assign(state.params[id], clone(layer.params[id]));
    state.mutes[id] = !!layer.mutes?.[id];
  }
  return state;
}

// Untrusted layer -> a clean one holding only that part's tracks (same rules as a whole saved song).
export function normalizeLayer(part, layer) {
  if (!PARTS[part] || !layer || typeof layer !== 'object' || !Array.isArray(layer.patterns)) return null;
  if (JSON.stringify(layer).length > MAX_LAYER) return null;
  return extractPart(sanitize({ patterns: layer.patterns.slice(0, 8), params: layer.params, mutes: layer.mutes }), part);
}

export const jamKey = (part, layer) => JSON.stringify([part, layer]);

// The room step (16ths since set.startsAt) a change sent now lands on: a downbeat at least minLead away,
// moved to the phrase when that is close.
export function jamStep(set, now = Date.now(), { minLead = JAM_LEAD, phraseWait = JAM_PHRASE_WAIT } = {}) {
  const bpm = set.bpm || set.state?.bpm || 132;
  const { step, delay } = roomTransportPosition(set.startsAt, bpm, now);
  return handoffStep({ abs: step, lead: delay, stepSec: 15 / bpm, origin: 0, minLead, phraseWait }).step;
}
export const stepWall = (set, step) => +set.startsAt + step * (15000 / (set.bpm || set.state?.bpm || 132));
export const barsUntil = (set, step, now = Date.now()) => Math.max(0, Math.ceil((stepWall(set, step) - now) / (60000 / (set.bpm || 132) * 4)));

export const jammable = (set) => !!set?.state?.patterns && !set.replay && !set.state.patterns.some((p) => p?.score);

export function emptyJam(setVersion = 0) {
  return { setVersion, open: true, rev: 0, parts: Object.fromEntries(PART_IDS.map((p) => [p, { owner: null, layer: null, step: 0, rev: 0 }])) };
}

// Frees parts held by people who left; a new set clears the layers (it carries the room's mix) but keeps the players.
export function reconcileJam(jam, { setVersion = 0, members = null } = {}) {
  const out = jam && jam.parts ? jam : emptyJam(setVersion);
  for (const id of PART_IDS) out.parts[id] ||= { owner: null, layer: null, step: 0, rev: 0 };
  if (out.setVersion !== setVersion) {
    out.setVersion = setVersion;
    for (const id of PART_IDS) Object.assign(out.parts[id], { layer: null, step: 0 });
    out.rev++;
  }
  if (members) for (const id of PART_IDS) if (out.parts[id].owner && !members.has(out.parts[id].owner)) { out.parts[id].owner = null; out.rev++; }
  return out;
}

// One jam event against the room's jam state (mutated). Returns { payload } for the event log, or { status, error }.
// claim/release a part, play a new layer of the part you hold, and (host only) lock/open the band.
export function jamAction(jam, { clientId, hostId, set, now = Date.now() }, payload = {}) {
  const fail = (status, error) => ({ status, error });
  if (!set) return fail(409, 'not_live');
  if (!jammable(set)) return fail(409, 'not_jammable');
  const action = String(payload.action || '');
  const host = clientId === hostId;
  if (action === 'open' || action === 'lock') {
    if (!host) return fail(403, 'host_only');
    jam.open = action === 'open';
    if (!jam.open) for (const id of PART_IDS) jam.parts[id].owner = null;
    jam.rev++;
    return { payload: { action, open: jam.open } };
  }
  const part = PARTS[payload.part] ? payload.part : null;
  if (!part) return fail(400, 'invalid_part');
  const slot = jam.parts[part];
  if (action === 'claim') {
    if (!jam.open && !host) return fail(423, 'jam_locked');
    if (slot.owner && slot.owner !== clientId) return fail(409, 'part_taken');
    for (const id of PART_IDS) if (jam.parts[id].owner === clientId) jam.parts[id].owner = null;
    slot.owner = clientId;
  } else if (action === 'release') {
    if (slot.owner !== clientId && !host) return fail(403, 'not_yours');
    slot.owner = null;
  } else if (action === 'play') {
    if (slot.owner !== clientId) return fail(403, 'not_yours');
    const layer = normalizeLayer(part, payload.layer);
    if (!layer) return fail(400, 'invalid_layer');
    // A late request still lands on a downbeat the room has not played yet.
    const earliest = jamStep(set, now, { minLead: 0.25, phraseWait: 0 });
    const asked = Number.isFinite(+payload.step) ? Math.ceil(Math.max(0, +payload.step) / 16) * 16 : earliest;
    Object.assign(slot, { layer, step: Math.max(asked, earliest), rev: jam.rev + 1 });
  } else return fail(400, 'invalid_action');
  jam.rev++;
  return { payload: { action, part, owner: slot.owner, step: slot.step } };
}

// A fresh idea for one part, in the song's key and scale: NEW writes the part again from the style,
// VARY reworks what is there, DROP/BRING toggles it out of the mix (a breakdown on the next bar).
export function partIdea(state, style, part, kind, seed = Date.now()) {
  const song = clone(state);
  const now = extractPart(song, part);
  if (kind === 'drop') {
    const out = !PARTS[part].tracks.every((id) => song.mutes[id]);
    for (const id of PARTS[part].tracks) now.mutes[id] = out;
    return now;
  }
  if (kind === 'new') {
    const g = generate(STYLES[style] ? style : 'hypnotic', seed, song.scale);
    const pats = arrangement(g.pattern, seed, g.bpm >= 115);
    const next = { ...song, patterns: song.patterns.map((p, i) => ({ ...p, steps: { ...p.steps, ...pats[i % pats.length].steps }, len: { ...p.len, ...pats[i % pats.length].len }, hook: pats[i % pats.length].hook, hm: pats[i % pats.length].hm })), params: clone(song.params) };
    for (const id of PARTS[part].tracks) if (g.params[id]) Object.assign(next.params[id], g.params[id]);
    const layer = extractPart(sanitize(next), part);
    layer.mutes = now.mutes;
    return layer;
  }
  const notes = SCALES[song.scale]?.notes || SCALES.minor.notes;
  const varied = { ...song, patterns: song.patterns.map((p, i) => mutate(p, seed + i * 31, 0.35, notes)) };
  return { ...extractPart(varied, part), params: now.params, mutes: now.mutes };
}
