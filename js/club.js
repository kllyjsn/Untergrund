import { KEYS, SCALES } from './params.js';
import { STYLES, clone } from './state.js';
import { listCrate, fetchTrack } from './crate.js';
import { h } from './ui.js';
import { createClientCredentials } from './client-id.js';
import { track as trackEvent } from './analytics.js';
import { startLiveSet, endLiveSet, liveSetRecording } from './live-sets.js';
import { listReplays, loadReplay, fmtTime } from './sets.js';
import { PARTS, PART_IDS, extractPart, jamKey, jamStep, stepWall, jammable, partIdea } from './jam.js';
import { SHAPES, COLORS, GEAR, FALLBACK_NAME, generateName, randomLook, migrateAvatar, chatGroups } from './club-identity.js';
import { createStage } from './club-stage.js';

const AVATAR_KEY = 'untergrund.avatar.v1';
const ROOM_KEY = 'untergrund.room.v1';
const REACTIONS = ['HYPE', 'DEEP', 'ACID'];
const JAM_LINES = {
  claim: (part) => `took the ${part}`,
  release: (part) => `let go of the ${part}`,
  lock: () => 'locked the band',
  open: () => 'opened the band: take a part',
};
const JAM_ERRORS = {
  part_taken: 'Someone just took that part', jam_locked: 'The host locked the band', not_yours: 'That part is not yours any more',
  not_live: 'Jam opens when a set is live', not_jammable: 'Replays and scores play as written', offline: 'Lost the room. Try again.',
};

const roomId = () => {
  const query = new URLSearchParams(location.search).get('room');
  const saved = localStorage.getItem(ROOM_KEY);
  return cleanRoom(query || saved || 'the-bunker');
};
const cleanRoom = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'the-bunker';
const clientCredentials = () => {
  let id = sessionStorage.getItem('untergrund.client');
  let secret = sessionStorage.getItem('untergrund.client-secret');
  if (!id || !secret) {
    ({ id, secret } = createClientCredentials());
    sessionStorage.setItem('untergrund.client', id);
    sessionStorage.setItem('untergrund.client-secret', secret);
  }
  return { id, secret };
};
const clientId = () => clientCredentials().id;
const defaultAvatar = () => ({ name: FALLBACK_NAME, shape: 'block', color: 'lime', gear: 'hood' });

// New visitors get a generated name and look; saved avatars keep theirs (see migrateAvatar).
export function loadAvatar() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(AVATAR_KEY)); } catch {}
  const { avatar, changed } = migrateAvatar(saved);
  if (changed) saveAvatar(avatar);
  return avatar;
}

const pick = (value, values, fallback) => values.includes(value) ? value : fallback;

export function normalizeMember(member = {}) {
  const base = defaultAvatar();
  const look = { ...member, ...(member.avatar || {}) };
  const { avatar: _nested, ...rest } = member;
  return {
    ...rest,
    name: String(member.name ?? base.name).slice(0, 28),
    shape: pick(look.shape, SHAPES, base.shape),
    color: pick(look.color, COLORS, base.color),
    gear: pick(look.gear, GEAR, base.gear),
  };
}

function saveAvatar({ name, shape, color, gear }) {
  try { localStorage.setItem(AVATAR_KEY, JSON.stringify({ name, shape, color, gear, v: 2 })); } catch {}
}

const cube = (cls, faces = ['f', 't', 'l', 'r'], front = []) => h('div', { class: `cube ${cls}` },
  faces.map((face) => h('i', { class: face }, face === 'f' ? front : [])));

function avatarNode(avatar, extra = '', style = '') {
  const safe = normalizeMember(avatar);
  const screen = h('span', { class: 'bot-screen' },
    h('i', { class: 'bot-eye left' }), h('i', { class: 'bot-eye right' }), h('i', { class: 'bot-mouth' }), h('i', { class: 'bot-goggles' }));
  const me = safe.id && safe.id === clientId() ? ' me' : '';
  return h('div', { class: `club-person ${safe.shape} ${safe.color} gear-${safe.gear}${me} ${extra}`, style, role: 'img', 'aria-label': safe.name ? `${safe.name} avatar` : 'Crowd silhouette', ...(me && { title: 'You. Tap to change your look' }) },
    h('div', { class: 'club-shadow' }),
    h('div', { class: 'bot' },
      h('div', { class: 'bot-rig' },
        cube('bot-leg left'), cube('bot-leg right'),
        cube('bot-torso', ['f', 't', 'l', 'r'], [h('i', { class: 'bot-led' }), h('i', { class: 'bot-led' }), h('i', { class: 'bot-led' })]),
        cube('bot-arm left'), cube('bot-arm right'),
        h('div', { class: 'bot-head-wrap' },
          cube('bot-head', ['f', 't', 'l', 'r'], [screen]),
          cube('bot-hood', ['t', 'l', 'r']),
          cube('bot-phone left'), cube('bot-phone right'), h('i', { class: 'bot-band' }),
          h('i', { class: 'bot-antenna' })))),
    safe.name ? h('div', { class: 'club-name' }, safe.name) : null);
}

class RoomBus {
  constructor(id, user, onUpdate, onEvent, apiBase = '') {
    this.id = cleanRoom(id);
    this.user = user;
    this.onUpdate = onUpdate;
    this.onEvent = onEvent;
    const credentials = clientCredentials();
    this.clientId = credentials.id;
    this.clientSecret = credentials.secret;
    this.joinedAt = Date.now();
    this.tokenKey = `untergrund.room-token:${this.id}:${this.clientId}`;
    this.token = sessionStorage.getItem(this.tokenKey) || '';
    this.apiBase = String(apiBase || '').replace(/\/$/, '');
    this.serverConnected = false;
    this.seq = 0;
    this.seen = new Set();
    this.lastSignature = '';
    this.hostId = this.clientId;
    this.queue = [];
    this.currentSetKey = '';
    this.localSetVersion = 0;
    this.initiatedSets = new Set();
    this.appliedBroadcasts = new Set();
    this.members = new Map([[this.clientId, normalizeMember({ id: this.clientId, ...user, joinedAt: this.joinedAt, seen: Date.now() })]]);
    this.currentSet = null;
    this.jam = null;
    this.jamHooks = null;
    this.jamFollow = '';
    this.jamApplied = {};
    this.jamSent = {};
    this.jamSeen = {};
    this.jamTimer = setInterval(() => this.jamTick(), 500);
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel(`untergrund:${this.id}`) : null;
    if (this.channel) this.channel.onmessage = (e) => this.handleChannel(e.data);
    this.timer = setInterval(() => this.heartbeat(), 4000);
    this.poller = setInterval(() => this.poll(), 700);
    this.ready = this.heartbeat();
    this.channel?.postMessage({ kind: 'snapshot-request', requester: this.clientId });
    this.poll();
  }

  endpoint(path = '') {
    return `${this.apiBase}/api/rooms/${this.id}${path}`;
  }

  snapshot(extra = {}) {
    return {
      id: this.id,
      members: [...this.members.values()],
      currentSet: this.currentSet,
      hostId: this.hostId,
      queue: this.queue,
      ...extra,
    };
  }

  emit(extra = {}) {
    const snapshot = this.snapshot(extra);
    const signature = JSON.stringify({
      members: snapshot.members.map((member) => [member.id, member.name, member.avatar || member.shape, member.color, member.gear]),
      set: snapshot.currentSet ? [snapshot.currentSet.version, snapshot.currentSet.title, snapshot.currentSet.startsAt] : null,
      hostId: snapshot.hostId || null,
      queue: snapshot.queue || [],
      jam: this.jam ? [this.jam.rev, this.jam.open, ...PART_IDS.map((p) => [this.jam.parts[p]?.owner, this.jam.parts[p]?.step])] : null,
      seq: this.seq,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.onUpdate(snapshot);
  }

  setKey(set) {
    return set?.version ? `server:${set.version}` : `local:${set?.broadcastId || `${set?.orderAt || set?.startsAt || 0}:${set?.title || ''}`}`;
  }

  acceptsSet(set) {
    if (!this.currentSet) return true;
    const incomingVersion = +set?.version || 0;
    const currentVersion = +this.currentSet.version || 0;
    if (incomingVersion) return !currentVersion || incomingVersion >= currentVersion;
    if (currentVersion) return (+set?.orderAt || +set?.startsAt || 0) >= (+this.currentSet.orderAt || +this.currentSet.startsAt || 0);
    return (+set?.orderAt || +set?.startsAt || 0) >= (+this.currentSet.orderAt || +this.currentSet.startsAt || 0);
  }

  applySet(set, userId, snapshot = false) {
    if (!set || !this.acceptsSet(set)) return;
    const key = this.setKey(set);
    if (key === this.currentSetKey) return;
    this.currentSet = set;
    this.currentSetKey = key;
    const seenBroadcast = !!(set.broadcastId && this.appliedBroadcasts.has(set.broadcastId));
    const initiatedHere = set.broadcastId && this.initiatedSets.has(set.broadcastId);
    if (set.broadcastId) this.appliedBroadcasts.add(set.broadcastId);
    if (initiatedHere && set.version) this.initiatedSets.delete(set.broadcastId);
    if (!initiatedHere && !seenBroadcast) this.onEvent({
      id: `${snapshot ? 'snapshot-' : ''}set:${key}`,
      type: 'set',
      user: { id: userId },
      payload: set,
      at: set.orderAt || set.startsAt || Date.now(),
      snapshot,
    });
  }

  async send(type, payload = {}) {
    const event = {
      id: `${this.clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      user: { id: this.clientId, ...this.user, joinedAt: this.joinedAt, seen: Date.now() },
      payload,
      at: Date.now(),
    };
    // A jam move only counts once the room service accepts it, so it never goes over the local channel.
    if (type !== 'jam') {
      this.receive({ ...event, local: true });
      this.channel?.postMessage(event);
    }
    await this.ready;
    try {
      const response = await fetch(this.endpoint('/events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, clientId: this.clientId, clientSecret: this.clientSecret, token: this.token, since: this.seq }),
      });
      const json = await response.json().catch(() => null);
      if (response.ok || json?.jam) this.applySnapshot(json);
      return { ok: response.ok, error: json?.error };
    } catch { return { ok: false, error: 'offline' }; }
  }

  // Jam: the room holds each part's latest layer and the room step it lands on; this client plays them on that bar.
  follow(set) {
    const id = set?.broadcastId || '';
    if (id !== this.jamFollow) {
      this.jamFollow = id;
      this.jamApplied = {};
      this.jamSent = {};
      this.jamSeen = {};
      this.jamHooks?.reset();
    }
    this.syncJam();
  }

  jamming(set = this.currentSet) {
    return !!(this.serverConnected && this.jam && set && jammable(set) && set.broadcastId && set.broadcastId === this.jamFollow);
  }

  myPart() {
    return PART_IDS.find((p) => this.jam?.parts?.[p]?.owner === this.clientId) || null;
  }

  syncJam() {
    const set = this.currentSet, jam = this.jam;
    if (!this.jamHooks || !this.jamming(set) || (set.version && jam.setVersion !== set.version)) return;
    for (const part of PART_IDS) {
      const slot = jam.parts?.[part];
      if (!slot?.layer || slot.rev <= (this.jamApplied[part] || 0)) continue;
      this.jamApplied[part] = slot.rev;
      // What I play on my own part is already in my song; the room copy only matters after a reload.
      if (slot.owner === this.clientId && this.jamSent[part]) continue;
      this.jamHooks.queuePart(part, slot.layer, stepWall(set, slot.step));
    }
  }

  playPart(part, layer) {
    const set = this.currentSet, step = jamStep(set);
    this.jamSent[part] = jamKey(part, layer);
    this.jamSeen[part] = null;
    this.jamHooks?.queuePart(part, layer, stepWall(set, step));
    return this.send('jam', { action: 'play', part, layer, step });
  }

  // Edits to my part in the Studio (piano roll, steps, knobs) go to the room on their own.
  jamTick() {
    const part = this.myPart();
    if (!part || !this.jamHooks?.isPlaying() || !this.jamming()) return;
    if (this.jamHooks.pending(part)) { this.jamSeen[part] = null; return; }
    const layer = extractPart(this.jamHooks.getState(), part), key = jamKey(part, layer);
    if (this.jamSeen[part] == null) { this.jamSeen[part] = key; return; }
    if (key === this.jamSeen[part]) return;
    this.jamSeen[part] = key;
    this.jamSent[part] = key;
    this.send('jam', { action: 'play', part, layer, step: jamStep(this.currentSet) });
  }

  updateUser(user) {
    this.user = user;
    this.members.set(this.clientId, normalizeMember({ id: this.clientId, ...user, joinedAt: this.joinedAt, seen: Date.now() }));
    this.heartbeat();
  }

  async heartbeat() {
    const event = {
      id: `${this.clientId}-presence-${Date.now()}`,
      type: 'presence',
      user: { id: this.clientId, ...this.user, joinedAt: this.joinedAt, seen: Date.now() },
      at: Date.now(),
    };
    this.channel?.postMessage(event);
    this.receive(event);
    try {
      const response = await fetch(this.endpoint('/events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'presence', clientId: this.clientId, clientSecret: this.clientSecret, token: this.token, user: { ...this.user, joinedAt: this.joinedAt }, since: this.seq }),
      });
      if (response.ok) this.applySnapshot(await response.json());
    } catch {}
  }

  async poll() {
    try {
      const response = await fetch(`${this.endpoint()}?since=${this.seq}`);
      if (response.ok) this.applySnapshot(await response.json());
    } catch {}
  }

  applySnapshot(snapshot) {
    this.serverConnected = true;
    if (snapshot.sessionToken) {
      this.token = snapshot.sessionToken;
      sessionStorage.setItem(this.tokenKey, this.token);
    }
    this.seq = Math.max(this.seq, snapshot.seq || 0);
    this.hostId = snapshot.hostId || this.hostId;
    this.queue = snapshot.queue || this.queue;
    for (const member of snapshot.members || []) {
      if (member.id !== this.clientId) this.members.set(member.id, normalizeMember(member));
    }
    this.members.set(this.clientId, normalizeMember({
      id: this.clientId,
      ...this.user,
      joinedAt: this.joinedAt,
      seen: Date.now(),
    }));
    const cutoff = Date.now() - 15000;
    for (const [id, member] of this.members) if ((member.seen || 0) < cutoff) this.members.delete(id);
    if (snapshot.currentSet) {
      this.applySet(snapshot.currentSet, snapshot.hostId, true);
    }
    if (snapshot.jam) {
      this.jam = snapshot.jam;
      this.syncJam();
    }
    for (const event of snapshot.events || []) if (event.type !== 'set') this.receive(event);
    this.emit({ hostId: snapshot.hostId });
  }

  handleChannel(message) {
    if (message?.kind === 'snapshot-request') {
      this.channel?.postMessage({
        kind: 'snapshot-response',
        target: message.requester,
        source: this.clientId,
        snapshot: this.snapshot(),
      });
      return;
    }
    if (message?.kind === 'snapshot-response') {
      if (message.target !== this.clientId) return;
      this.applyLocalSnapshot(message.snapshot);
      return;
    }
    this.receive(message);
  }

  applyLocalSnapshot(snapshot) {
    if (!snapshot) return;
    for (const member of snapshot.members || []) {
      const existing = this.members.get(member.id);
      const joined = [existing?.joinedAt, member.joinedAt].filter(Number.isFinite);
      this.members.set(member.id, normalizeMember({
        ...existing,
        ...normalizeMember(member),
        joinedAt: joined.length ? Math.min(...joined) : Date.now(),
        seen: Date.now(),
      }));
    }
    if (snapshot.currentSet) this.applySet(snapshot.currentSet, snapshot.hostId, true);
    this.queue = [...new Set([...(this.queue || []), ...(snapshot.queue || [])])];
    if (snapshot.hostId && this.members.has(snapshot.hostId)) this.hostId = snapshot.hostId;
    this.reconcileLocalHost();
    this.emit();
  }

  reconcileLocalHost() {
    if (this.serverConnected) return;
    if (!this.members.has(this.hostId)) {
      const members = [...this.members.values()].sort((a, b) =>
        (a.joinedAt || Infinity) - (b.joinedAt || Infinity) || String(a.id).localeCompare(String(b.id)));
      this.hostId = members[0]?.id || this.clientId;
    }
    this.queue = this.queue.filter((id) => id !== this.hostId && this.members.has(id));
  }

  receive(event) {
    if (!event?.id || this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 400) this.seen.delete(this.seen.values().next().value);
    if (event.user?.id) {
      const existing = this.members.get(event.user.id);
      this.members.set(event.user.id, normalizeMember({
        ...existing,
        ...normalizeMember(event.user),
        joinedAt: event.user.joinedAt || existing?.joinedAt || Date.now(),
        seen: Date.now(),
      }));
    }
    if (event.type === 'set') {
      this.applySet(event.payload, event.user?.id);
      this.emit();
      return;
    }
    if (event.type === 'deck') {
      const action = event.payload?.action;
      if (event.payload?.hostId) this.hostId = event.payload.hostId;
      if (Array.isArray(event.payload?.queue)) this.queue = event.payload.queue;
      else if (action === 'join' && event.user?.id !== this.hostId && !this.queue.includes(event.user.id)) this.queue.push(event.user.id);
      else if (action === 'leave') this.queue = this.queue.filter((id) => id !== event.user?.id);
      else if (action === 'pass' && event.user?.id === this.hostId) this.hostId = this.queue.shift() || this.hostId;
    }
    if (event.type === 'presence') this.reconcileLocalHost();
    this.onEvent(event);
    this.emit();
  }

  close() {
    clearInterval(this.jamTimer);
    clearInterval(this.timer);
    clearInterval(this.poller);
    this.channel?.close();
  }
}

// A live DJ's room connection outlives the overlay so the deck isn't lost while editing in Studio.
let parkedBus = null;

// The Club header shows one contextual primary action; everything else is secondary.
export function clubActions({ isHost, live, canListen, queued, queueLength = 0 }) {
  const queue = { id: queued ? 'unqueue' : 'queue', label: queued ? 'LEAVE QUEUE' : 'JOIN DJ QUEUE' };
  if (canListen) return { primary: { id: 'listen', label: 'LISTEN LIVE' }, secondary: isHost ? [] : [queue] };
  if (isHost && !live) return { primary: { id: 'live', label: 'GO LIVE' }, secondary: [] };
  if (isHost) return { primary: null, secondary: [...(queueLength ? [{ id: 'pass', label: 'PASS DECK' }] : []), { id: 'rebroadcast', label: 'REBROADCAST' }] };
  return queued ? { primary: null, secondary: [queue] } : { primary: queue, secondary: [] };
}

export function openClub({ getState, getStyle, loadTrack, getTransport, startRoomBroadcast, unlockAudio, joinRoomSet: joinSet, replayToRoom, jam: jamHooks = null, toast }) {
  const joinRoomSet = (set) => { joinSet(set); bus?.follow(set); };
  let audioReady = false;
  const unlock = () => unlockAudio().then((ok) => (audioReady = ok));
  unlock().then(() => {
    if (closed) return;
    if (audioReady && pendingSet && !getTransport().playing) {
      joinRoomSet(pendingSet);
      pendingSet = null;
    }
    render();
  });
  let avatar = loadAvatar();
  let activeRoom = roomId();
  let bus = null;
  let room = { members: [], currentSet: null };
  let messages = [];
  const stageView = createStage({ avatarNode, normalizeMember, looks: { SHAPES, COLORS, GEAR } });
  let apiBase = '';
  let pendingSet = null;
  let closed = false;

  const close = () => {
    closed = true;
    if (bus && (bus.hostId === bus.clientId || bus.myPart()) && bus.currentSet && getTransport().playing) {
      bus.onUpdate = () => {};
      bus.onEvent = () => {};
      parkedBus = bus;
    } else bus?.close();
    window.removeEventListener('untergrund:step', onStep);
    window.removeEventListener('untergrund:jam', onJam);
    window.removeEventListener('keydown', onKey, true);
    ov.remove();
  };
  const ov = h('div', { class: 'club-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'UNTERGRUND Club' });
  const modal = h('div', { class: 'club-shell' });
  ov.append(modal);
  document.body.append(ov);

  const onKey = (e) => {
    if (e.key === 'Escape' && editingRoom && e.target.closest?.('.club-room-input')) {
      editingRoom = false;
      render();
      e.stopPropagation();
      return;
    }
    if (e.key === 'Escape') {
      if (lookOpen) closeLook();
      else close();
      e.stopPropagation();
      return;
    }
    if (e.target.closest('input, textarea, select')) return;
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  let kickTimer = 0;
  const onStep = (e) => {
    stageView.step(e.detail);
    modal.classList.toggle('club-kick', e.detail.kick);
    modal.classList.toggle('club-accent', e.detail.accent);
    if (e.detail.step % 16 === 0) paintCountdowns();
    clearTimeout(kickTimer);
    kickTimer = setTimeout(() => modal.classList.remove('club-kick', 'club-accent'), 120);
  };
  window.addEventListener('untergrund:step', onStep);

  let joinedRoom = '';
  const invited = new URLSearchParams(location.search).has('room');
  const connect = () => {
    if (closed) return;
    localStorage.setItem(ROOM_KEY, activeRoom);
    if (joinedRoom !== activeRoom) { joinedRoom = activeRoom; trackEvent('room_join', { kind: invited ? 'link' : 'direct' }); }
    const onUpdate = (next) => { room = next; render(); };
    const onEvent = (event) => {
      if (event.type === 'chat') messages = [...messages, event].slice(-60);
      if (event.type === 'reaction') showReaction(event);
      if (event.type === 'jam' && JAM_LINES[event.payload?.action]) {
        const p = PARTS[event.payload.part]?.label || '';
        messages = [...messages, { ...event, jam: true, payload: { text: JAM_LINES[event.payload.action](p) } }].slice(-60);
      }
      if (event.type === 'set') {
        if (!shouldJoin(event.payload, event.user?.id)) { pendingSet = null; return; }
        pendingSet = event.payload;
        if (!event.local && audioReady) {
          joinRoomSet(pendingSet);
          pendingSet = null;
        }
      }
    };
    if (parkedBus && parkedBus.id === cleanRoom(activeRoom) && bus !== parkedBus) {
      bus = parkedBus;
      parkedBus = null;
      Object.assign(bus, { onUpdate, onEvent, lastSignature: null });
      bus.emit();
      return;
    }
    parkedBus?.close();
    parkedBus = null;
    bus?.close();
    bus = new RoomBus(activeRoom, avatar, onUpdate, onEvent, apiBase);
    if (jamHooks) bus.jamHooks = { ...jamHooks, getState, isPlaying: () => getTransport().playing };
  };

  // A DJ's own set never overwrites local edits or a running transport; it only resumes an idle, unedited deck.
  const musicKey = (st) => JSON.stringify([st?.patterns, st?.bpm, st?.swing, st?.key, st?.scale]);
  function shouldJoin(set, deckId = room.hostId) {
    if (!set) return false;
    if (set.by !== clientId() && deckId !== clientId()) return true;
    if (getTransport().playing) return false;
    return musicKey(set.state) === musicKey(getState());
  }

  function showReaction(event) {
    stageView.react({ id: event.user?.id, name: event.user?.name, value: event.payload?.value || 'HYPE' });
  }

  function nowPlaying() {
    const state = getState();
    return {
      title: state.artist?.title || 'Live Machine Set',
      artist: state.artist?.name || 'UNTERGRUND',
      bpm: state.bpm,
      style: STYLES[getStyle()]?.name || getStyle(),
      key: `${KEYS[state.key]} ${SCALES[state.scale]?.name || 'MINOR'}`,
    };
  }

  function broadcastSet() {
    unlock();
    if (room.hostId && room.hostId !== clientId()) {
      const queued = room.queue?.includes(clientId());
      bus.send('deck', { action: queued ? 'leave' : 'join' });
      toast(queued ? 'Left the DJ queue' : 'Joined the DJ queue');
      return;
    }
    const transport = getTransport();
    const startsAt = transport.playing ? transport.startsAt : Date.now() + 1600;
    const track = nowPlaying();
    const broadcastId = `${bus.clientId}:${Date.now()}:${++bus.localSetVersion}`;
    bus.initiatedSets.add(broadcastId);
    bus.send('set', { ...track, state: clone(getState()), style: getStyle(), startsAt, orderAt: Date.now(), broadcastId, by: bus.clientId });
    bus.follow(bus.currentSet);
    if (!transport.playing) startRoomBroadcast(startsAt);
    startLiveSet({
      getState, getStyle, startsAt, toast, dj: avatar.name, room: activeRoom, title: track.title,
      isPlaying: () => getTransport().playing,
      isDJ: () => { const b = parkedBus || bus; return !b.hostId || b.hostId === b.clientId; },
    });
    trackEvent('room_go_live', { kind: room.currentSet ? 'rebroadcast' : 'first' });
    toast(`Broadcasting “${track.title}” to ${activeRoom}`);
  }

  function commitRoom(value) {
    const next = cleanRoom(value);
    if (next === activeRoom) return;
    endLiveSet();
    activeRoom = next;
    history.replaceState(null, '', `${location.pathname}?room=${activeRoom}`);
    messages = [];
    connect();
  }

  function setAvatar(next) {
    avatar = { ...avatar, ...next };
    saveAvatar(avatar);
    bus?.updateUser(avatar);
    render();
  }

  // YOUR LOOK: name, head, color and gear, each a live preview. Opened from the head button or by tapping your own bot.
  let lookOpen = false;
  let nameTimer = 0;
  function openLook() {
    if (lookOpen) return;
    lookOpen = true;
    render();
    modal.querySelector('.club-look-done')?.focus({ preventScroll: true });
  }
  function closeLook() {
    if (!lookOpen) return;
    lookOpen = false;
    clearTimeout(nameTimer);
    bus?.updateUser(avatar);
    render();
    modal.querySelector('.club-look-btn')?.focus({ preventScroll: true });
  }
  modal.addEventListener('click', (e) => { if (e.target.closest('.club-stage .club-person.me')) openLook(); });

  // Typing never re-renders, so a tap on a tile right after typing still lands.
  function typeName(value) {
    const name = value.trim().slice(0, 28);
    if (!name || name === avatar.name) return;
    avatar = { ...avatar, name };
    saveAvatar(avatar);
    for (const el of modal.querySelectorAll('.club-look-preview .club-name')) el.textContent = name;
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => bus?.updateUser(avatar), 400);
  }

  const lookButton = () => h('button', {
    class: `btn ghost club-look-btn${lookOpen ? ' on' : ''}`, 'aria-haspopup': 'dialog', 'aria-expanded': String(lookOpen),
    title: `${avatar.name}: change your name and look`, onclick: () => (lookOpen ? closeLook() : openLook()),
  }, h('i', { class: `club-face ${avatar.shape} ${avatar.color}` }), h('span', {}, 'YOUR LOOK'));

  function lookSheet() {
    const tile = (key, value) => {
      const on = avatar[key] === value;
      return h('button', {
        class: `club-look-tile${on ? ' on' : ''}`, 'aria-pressed': String(on), 'aria-label': `${key === 'shape' ? 'Head' : 'Gear'}: ${value}`,
        'data-focus-key': `look-${key}-${value}`, onclick: () => setAvatar({ [key]: value }),
      }, h('span', { class: 'club-look-mini', 'aria-hidden': 'true' }, avatarNode({ ...avatar, name: '', [key]: value })), h('small', {}, value.toUpperCase()));
    };
    const swatch = (color) => {
      const on = avatar.color === color;
      return h('button', {
        class: `club-look-swatch ${color}${on ? ' on' : ''}`, 'aria-pressed': String(on), 'aria-label': `Color: ${color}`, title: color.toUpperCase(),
        'data-focus-key': `look-color-${color}`, onclick: () => setAvatar({ color }),
      });
    };
    const group = (label, cls, items) => h('div', { class: 'club-look-group' }, h('span', { class: 'club-look-label' }, label),
      h('div', { class: cls, role: 'group', 'aria-label': label }, items));
    const nameInput = h('input', {
      id: 'club-look-name', class: 'inp club-look-name', maxlength: 28, value: avatar.name, autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done',
      'data-focus-key': 'avatar-name',
      oninput: (e) => typeName(e.target.value),
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); closeLook(); } },
      onblur: (e) => { if (!e.target.value.trim()) e.target.value = avatar.name; },
    });
    return h('div', { class: 'club-look-layer' },
      h('div', { class: 'club-look-scrim', onclick: () => closeLook() }),
      h('section', { class: 'club-look', role: 'dialog', 'aria-label': 'Your look' },
        h('header', { class: 'club-look-head' },
          h('b', {}, 'YOUR LOOK'),
          h('button', { class: 'btn accent club-look-done', 'data-focus-key': 'look-done', onclick: () => closeLook() }, 'DONE')),
        h('div', { class: 'club-look-hero' },
          h('div', { class: 'club-look-preview' }, avatarNode(avatar, 'preview')),
          h('div', { class: 'club-look-id' },
            h('label', { class: 'club-look-label', for: 'club-look-name' }, 'NAME'),
            h('div', { class: 'club-look-name-row' }, nameInput,
              h('button', { class: 'btn ghost', 'aria-label': 'Generate a new name', 'data-focus-key': 'look-rename', onclick: () => setAvatar({ name: generateName() }) }, 'NEW NAME')),
            h('small', {}, 'How the room sees you, on stage and in chat.'))),
        group('HEAD', 'club-look-tiles three', SHAPES.map((v) => tile('shape', v))),
        group('COLOR', 'club-look-swatches', COLORS.map(swatch)),
        group('GEAR', 'club-look-tiles five', GEAR.map((v) => tile('gear', v))),
        h('footer', { class: 'club-look-foot' },
          h('button', { class: 'btn ghost', 'data-focus-key': 'look-shuffle', onclick: () => setAvatar(randomLook()) }, 'SHUFFLE LOOK'))));
  }

  function stage() {
    const members = (room.members.length ? room.members : [{ id: clientId(), ...avatar }]).map(normalizeMember);
    const set = room.currentSet;
    return stageView.update({
      members, hostId: room.hostId,
      current: { ...(set || nowPlaying()), startsAt: set?.startsAt },
      label: set ? `${set.replay ? 'REPLAY' : 'LIVE'} IN THIS ROOM${liveSetRecording() ? ' · RECORDING' : ''}` : 'READY TO BROADCAST',
    });
  }

  let sideTab = 'signal';
  let crate = { loaded: false, shared: false, tracks: [] };
  const refreshCrate = () => listCrate().then((next) => { crate = { ...next, loaded: true }; if (!closed) render(); });
  let replays = { loaded: false, items: [] };
  const refreshReplays = () => listReplays().catch(() => []).then((items) => { replays = { loaded: true, items }; if (!closed) render(); });
  const tabs = () => h('div', { class: 'club-tabs' }, [['signal', 'ROOM SIGNAL'], ['crate', 'CRATE'], ['sets', 'SETS']].map(([id, label]) =>
    h('button', { class: sideTab === id ? 'on' : '', 'aria-pressed': String(sideTab === id), onclick: () => { sideTab = id; if (id === 'crate') refreshCrate(); if (id === 'sets') refreshReplays(); render(); } }, label)));

  // Saved live sets: the DJ replays one to the whole room, in sync, from its state timeline.
  async function replaySet(item) {
    unlock();
    let timeline;
    try { timeline = await loadReplay(item); } catch { return toast('That set is no longer in the jukebox'); }
    endLiveSet({ offer: false });
    const startsAt = Date.now() + 1600;
    const broadcastId = `${bus.clientId}:${Date.now()}:${++bus.localSetVersion}`;
    bus.initiatedSets.add(broadcastId);
    const s = timeline.initial;
    bus.send('set', {
      title: item.title, artist: item.artist, bpm: s.bpm, key: `${KEYS[s.key]} ${SCALES[s.scale]?.name || 'MINOR'}`,
      state: clone(s), style: timeline.style, startsAt, orderAt: Date.now(), broadcastId, by: bus.clientId,
      replay: { ...(item.local ? { timeline } : { id: item.id }), title: item.title, dj: item.artist },
    });
    bus.follow(bus.currentSet);
    replayToRoom(timeline, startsAt);
    trackEvent('set_replay', { kind: 'room' });
    toast(`Replaying “${item.title}” to ${activeRoom}`);
  }

  function setsPanel() {
    const isHost = !room.hostId || room.hostId === clientId();
    const list = h('div', { class: 'club-crate' },
      !replays.loaded ? h('div', { class: 'club-chat-empty' }, 'Opening the jukebox…') :
      replays.items.length ? replays.items.map((item) => h('div', { class: 'club-crate-row' },
        h('div', {}, h('b', {}, item.title), h('small', {}, `${item.artist}${item.room ? ` · ${item.room}` : ''} · ${fmtTime((item.end || item.duration) - (item.start || 0))}${item.local ? ' · THIS BROWSER' : ''}`)),
        isHost ? h('button', { class: 'btn accent', onclick: () => replaySet(item) }, 'REPLAY TO ROOM') : null)) :
        h('div', { class: 'club-chat-empty' }, 'No saved sets yet. GO LIVE and your set is recorded for you.'));
    return h('aside', { class: 'club-social' },
      h('div', { class: 'club-social-head' }, tabs(), h('b', {}, `${replays.items.length} SETS`)),
      list,
      h('div', { class: 'club-crate-note' }, isHost ? 'Replays play in sync for everyone in the room.' : 'Take the deck to replay a set to the room.'));
  }

  function cratePanel() {
    const isHost = !room.hostId || room.hostId === clientId();
    const spin = async (item) => {
      try {
        const track = await fetchTrack(item.id);
        loadTrack(track);
        if (isHost) broadcastSet();
        else toast(`Loaded “${item.title}”. Join the DJ queue to spin it.`);
      } catch { toast('That track is no longer in the crate'); }
    };
    const list = h('div', { class: 'club-crate' },
      !crate.loaded ? h('div', { class: 'club-chat-empty' }, 'Opening the crate…') :
      crate.tracks.length ? crate.tracks.map((item) => h('div', { class: 'club-crate-row' },
        h('div', {}, h('b', {}, item.title), h('small', {}, `${STYLES[item.style]?.name || item.style} · ${item.bpm} BPM · ${item.artist}${item.localOnly && crate.shared ? ' · THIS BROWSER ONLY' : ''}`)),
        h('button', { class: `btn ${isHost ? 'accent' : 'ghost'}`, onclick: () => spin(item) }, isHost ? 'SPIN' : 'LOAD'))) :
        h('div', { class: 'club-chat-empty' }, 'No tracks yet. Hit GENERATE and they land here.'));
    return h('aside', { class: 'club-social' },
      h('div', { class: 'club-social-head' }, tabs(), h('b', {}, `${crate.tracks.length} TRACKS`)),
      list,
      h('div', { class: 'club-crate-note' }, crate.shared ? 'Shared crate: every UNTERGRUND DJ can spin these, except tracks marked this browser only.' : 'Saved in this browser. Shared storage is not connected yet.'));
  }

  // Chat follows the newest line unless you scrolled up to read; then a NEW button brings you back.
  let chatPinned = true, chatTop = 0, chatSeen = '';
  const clock = (at) => at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const chatGroup = (g) => g.system
    ? h('div', { class: 'club-chat-system' }, h('b', {}, g.mine ? 'You' : g.name), ` ${g.text}`)
    : h('div', { class: `club-chat-group ${g.color}${g.mine ? ' mine' : ''}` },
      h('div', { class: 'club-chat-who' },
        h('i', { class: `club-face ${g.shape} ${g.color}` }),
        h('b', {}, g.name),
        g.mine ? h('em', {}, 'YOU') : null,
        g.host ? h('em', { class: 'dj' }, 'DJ') : null,
        h('time', {}, clock(g.at))),
      g.lines.map((line) => h('p', {}, line.text)));

  function chatPanel() {
    if (sideTab === 'crate') return cratePanel();
    if (sideTab === 'sets') return setsPanel();
    const me = clientId();
    const groups = chatGroups(messages, { me, hostId: room.hostId });
    const lastId = messages[messages.length - 1]?.id || '';
    if (chatPinned) chatSeen = lastId;
    const unread = chatPinned ? 0 : messages.slice(messages.findIndex((m) => m.id === chatSeen) + 1).filter((m) => !m.jam && m.user?.id !== me).length;
    const toBottom = () => { chatPinned = true; feed.scrollTop = feed.scrollHeight; feed.querySelector('.club-chat-new')?.remove(); };
    const others = Math.max(0, (room.members.length || 1) - 1);
    const feed = h('div', {
      class: 'club-chat-feed', role: 'log', 'aria-label': 'Room chat',
      onscroll: () => {
        chatTop = feed.scrollTop;
        chatPinned = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 32;
        if (chatPinned) { chatSeen = lastId; feed.querySelector('.club-chat-new')?.remove(); }
      },
    },
    groups.length ? groups.map(chatGroup) : h('div', { class: 'club-chat-hello' },
      h('i', { class: `club-face ${avatar.shape} ${avatar.color}` }),
      h('b', {}, `You're in as ${avatar.name}`),
      h('span', {}, others ? `${others === 1 ? 'One person is' : `${others} people are`} here with you. Say hi: everyone hears the same set, on the same beat.`
        : 'Nobody else is here yet. Copy the invite and bring someone in.')),
    unread ? h('button', { class: 'club-chat-new', onclick: toBottom }, `${unread} NEW ↓`) : null);
    queueMicrotask(() => { if (feed.isConnected) feed.scrollTop = chatPinned ? feed.scrollHeight : chatTop; });
    const send = () => {
      const text = input.value.trim();
      if (!text) return;
      chatPinned = true;
      bus.send('chat', { text });
      input.value = '';
    };
    const input = h('input', {
      class: 'inp', maxlength: 280, placeholder: 'Message the room', 'aria-label': 'Message the room', 'data-focus-key': 'chat',
      autocomplete: 'off', enterkeyhint: 'send',
      onkeydown: (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); } },
    });
    return h('aside', { class: 'club-social' },
      h('div', { class: 'club-social-head' }, tabs(), h('b', {}, `${room.members.length || 1} LIVE`)),
      feed,
      h('div', { class: 'club-chat-compose' }, input,
        h('button', { class: 'btn club-chat-send', 'aria-label': 'Send message', onpointerdown: (e) => e.preventDefault(), onclick: () => send() }, 'SEND')),
      h('div', { class: 'club-reactions' }, REACTIONS.map((value) =>
        h('button', { class: 'btn ghost', onclick: () => bus.send('reaction', { value }) }, value))));
  }

  // JAM: each person takes a part; a change is sent for a room downbeat and lands there for everyone.
  const barMs = (set) => 240000 / (set?.bpm || 132);
  const landText = (wall, set) => {
    const bars = Math.ceil((wall - Date.now()) / barMs(set) - 0.05);
    return bars > 0 ? `LANDS IN ${bars} BAR${bars > 1 ? 'S' : ''}` : 'LANDED';
  };
  function paintCountdowns() {
    let landed = false;
    for (const el of modal.querySelectorAll('[data-wall]')) {
      const text = landText(+el.dataset.wall, room.currentSet);
      el.textContent = text;
      if (text === 'LANDED') landed = true;
    }
    if (landed) setTimeout(() => !closed && render(), 250);
  }
  let landedPart = '';
  const onJam = (e) => {
    landedPart = e.detail.part;
    render();
    setTimeout(() => { if (landedPart === e.detail.part) { landedPart = ''; modal.querySelector('.club-part.landed')?.classList.remove('landed'); } }, 700);
  };
  window.addEventListener('untergrund:jam', onJam);
  async function jamSend(payload) {
    const result = await bus.send('jam', payload);
    if (result && !result.ok) toast(JAM_ERRORS[result.error] || 'The band missed that one');
    if (!closed) render();
  }
  async function takePart(part) {
    const set = room.currentSet;
    if (!getTransport().playing) {
      await unlock();
      if (!audioReady) return toast('Tap again to start the audio');
      if (set && shouldJoin(set)) { joinRoomSet(set); pendingSet = null; } else bus.follow(set);
    } else if (!bus.jamming(set)) bus.follow(set);
    await jamSend({ action: 'claim', part });
    const label = PARTS[part].label;
    if (bus.myPart() === part) toast(`You have the ${label}. NEW, VARY or DROP it, or edit it in the Studio.`);
  }
  async function playIdea(part, kind) {
    const layer = partIdea(getState(), getStyle(), part, kind);
    const result = await bus.playPart(part, layer);
    if (result && !result.ok) toast(JAM_ERRORS[result.error] || 'The band missed that one');
    if (!closed) render();
  }
  function band() {
    const set = room.currentSet;
    if (!jamHooks || !bus?.serverConnected || !jammable(set)) return null;
    const jam = bus.jam, me = clientId();
    const isHost = !room.hostId || room.hostId === me;
    const open = jam?.open !== false;
    const mine = bus.myPart();
    const nameOf = (id) => id === me ? 'YOU' : room.members.find((member) => member.id === id)?.name || 'Listener';
    const note = !open ? (isHost ? 'Band locked. Only you can take a part.' : 'The host locked the band.')
      : mine ? 'Your moves land on the next bar for the whole room.' : 'Take a part. Every change lands on the bar, for everyone.';
    const cards = PART_IDS.map((part) => {
      const slot = jam?.parts?.[part] || {};
      const ours = slot.owner === me;
      const roomWall = slot.layer && slot.step ? stepWall(set, slot.step) : 0;
      const wall = Math.max(roomWall, ours ? jamHooks.pending(part) : 0);
      const muted = ours && PARTS[part].tracks.every((id) => getState().mutes?.[id]);
      const when = wall > Date.now() ? h('small', { class: 'club-part-when due', 'data-wall': wall }, landText(wall, set))
        : h('small', { class: 'club-part-when' }, ours ? (muted ? 'DROPPED OUT' : 'YOURS · STUDIO EDITS GO LIVE') : slot.owner ? 'PLAYING LIVE' : 'ROOM MIX');
      const actions = ours ? [
        h('button', { class: 'btn accent', onclick: () => playIdea(part, 'new') }, 'NEW'),
        h('button', { class: 'btn ghost', onclick: () => playIdea(part, 'vary') }, 'VARY'),
        h('button', { class: 'btn ghost', onclick: () => playIdea(part, 'drop') }, muted ? 'BRING IN' : 'DROP'),
        h('button', { class: 'btn ghost', onclick: () => jamSend({ action: 'release', part }) }, 'LET GO'),
      ] : slot.owner ? (isHost ? [h('button', { class: 'btn ghost', onclick: () => jamSend({ action: 'release', part }) }, 'FREE PART')] : [])
        : [h('button', { class: 'btn club-queue', ...(!open && !isHost && { disabled: '' }), onclick: () => takePart(part) }, `TAKE ${PARTS[part].label}`)];
      return h('div', { class: `club-part${ours ? ' mine' : ''}${slot.owner ? ' taken' : ''}${landedPart === part ? ' landed' : ''}`, 'data-part': part },
        h('div', { class: 'club-part-head' }, h('b', {}, PARTS[part].label), h('span', {}, slot.owner ? nameOf(slot.owner) : 'OPEN')),
        when,
        h('div', { class: 'club-part-actions' }, actions));
    });
    return h('section', { class: 'club-band', 'aria-label': 'Jam together' },
      h('div', { class: 'club-band-head' },
        h('b', {}, 'JAM'),
        h('span', {}, note),
        isHost ? h('button', { class: 'btn ghost', onclick: () => jamSend({ action: open ? 'lock' : 'open' }) }, open ? 'LOCK BAND' : 'OPEN BAND') : null),
      h('div', { class: 'club-band-parts' }, cards));
  }

  let rendering = false;
  let editingRoom = false;
  let view = 'stage';
  let lastSeen = null;
  function render() {
    const focused = modal.contains(document.activeElement) ? document.activeElement : null;
    const draft = focused?.dataset?.focusKey ? {
      key: focused.dataset.focusKey,
      value: focused.value,
      start: focused.selectionStart,
      end: focused.selectionEnd,
    } : null;
    rendering = true;
    modal.innerHTML = '';
    rendering = false;
    const invite = new URL(location.href);
    invite.searchParams.set('room', activeRoom);
    const shareInvite = async () => {
      trackEvent('share_link_copied', { what: 'room' });
      if (navigator.share && matchMedia('(pointer: coarse)').matches) return navigator.share({ title: `UNTERGRUND Club · ${activeRoom}`, url: invite.toString() }).catch(() => {});
      await navigator.clipboard?.writeText(invite.toString());
      toast('Room link copied');
    };
    const endEdit = (value) => { editingRoom = false; commitRoom(value); render(); };
    const roomSwitch = editingRoom ? h('input', {
      class: 'inp club-room-input', value: activeRoom, maxlength: 32, 'aria-label': 'Room name', 'data-focus-key': 'room', enterkeyhint: 'go',
      onkeydown: (e) => { if (e.key === 'Enter') endEdit(e.target.value); },
      onblur: (e) => { if (!rendering) endEdit(e.target.value); },
    }) : h('button', { class: 'club-room-btn', title: 'Switch room', onclick: () => { editingRoom = true; render(); } },
      h('span', {}, 'ROOM'), h('b', {}, activeRoom));
    const isHost = !room.hostId || room.hostId === clientId();
    const syncAudio = async () => {
      await unlock();
      const set = pendingSet || room.currentSet;
      if (set && audioReady && shouldJoin(set)) {
        joinRoomSet(set);
        pendingSet = null;
      }
      render();
    };
    const { primary, secondary } = clubActions({
      isHost,
      live: !!room.currentSet,
      canListen: !!room.currentSet && !getTransport().playing && shouldJoin(room.currentSet),
      queued: !!room.queue?.includes(clientId()),
      queueLength: room.queue?.length || 0,
    });
    const run = { listen: syncAudio, live: broadcastSet, rebroadcast: broadcastSet, queue: broadcastSet, unqueue: broadcastSet, pass: () => bus.send('deck', { action: 'pass' }) };
    const actionBtns = () => [
      ...secondary.map((a) => h('button', { class: 'btn ghost club-secondary', onclick: () => run[a.id]() }, a.label)),
      primary ? h('button', { class: 'btn accent club-primary', onclick: () => run[primary.id]() }, primary.label) : null,
    ];
    const head = h('div', { class: 'club-head' },
      h('div', { class: 'club-brand' }, h('i'), h('div', {}, h('b', {}, 'UNTERGRUND CLUB'), h('span', {}, 'original machine music only'))),
      h('div', { class: 'club-room-name' }, roomSwitch),
      h('div', { class: 'club-head-actions' },
        actionBtns(),
        h('button', { class: 'btn ghost club-invite', onclick: () => shareInvite() }, 'INVITE'),
        lookButton(),
        h('button', { class: 'btn ghost club-close', onclick: () => close() }, 'CLOSE')));
    if (view === 'chat') lastSeen = messages[messages.length - 1] || null;
    const unread = messages.length - (messages.indexOf(lastSeen) + 1);
    const showView = (next) => {
      view = next;
      render();
      if (next === 'chat') modal.querySelector('[data-focus-key="chat"]')?.focus();
    };
    // Phone: one action above the tab bar, and a one-tap switch between the stage and the room chat.
    const dock = h('div', { class: `club-dock${primary ? ' has-primary' : ''}` },
      actionBtns(),
      h('button', { class: 'btn ghost club-view-toggle', 'aria-pressed': String(view === 'chat'), onclick: () => showView(view === 'chat' ? 'stage' : 'chat') },
        view === 'chat' ? 'STAGE' : 'CHAT', view !== 'chat' && unread > 0 ? h('b', {}, String(Math.min(unread, 99))) : null));
    const names = (room.queue || []).map((id) => room.members.find((member) => member.id === id)?.name || 'Listener');
    const upNext = names.length ? h('div', { class: 'club-upnext' }, h('span', {}, 'UP NEXT'), h('b', {}, names.join(' · '))) : null;
    modal.classList.toggle('view-chat', view === 'chat');
    modal.append(head,
      h('div', { class: 'club-main' },
        h('div', { class: 'club-stage-col' }, stage(), upNext, band()),
        chatPanel()),
      dock,
      lookOpen ? lookSheet() : '');
    if (editingRoom && !draft) {
      const input = modal.querySelector('[data-focus-key="room"]');
      input?.focus({ preventScroll: true });
      input?.select();
    }
    const restored = draft && modal.querySelector(`[data-focus-key="${draft.key}"]`);
    if (restored) {
      restored.value = draft.value;
      restored.focus({ preventScroll: true });
      if (draft.start != null) restored.setSelectionRange(draft.start, draft.end);
    }
  }

  render();
  fetch('/api/room-config')
    .then((response) => response.ok ? response.json() : { apiBase: '' })
    .then((config) => { apiBase = config.apiBase || ''; })
    .catch(() => {})
    .finally(connect);
}
