import { KEYS, SCALES } from './params.js';
import { STYLES, clone } from './state.js';
import { listCrate, fetchTrack } from './crate.js';
import { h } from './ui.js';
import { createClientCredentials } from './client-id.js';
import { track as trackEvent } from './analytics.js';
import { startLiveSet, endLiveSet, liveSetRecording } from './live-sets.js';
import { listReplays, loadReplay, fmtTime } from './sets.js';
import { PARTS, PART_IDS, extractPart, jamKey, jamStep, stepWall, jammable, partIdea } from './jam.js';

const AVATAR_KEY = 'untergrund.avatar.v1';
const ROOM_KEY = 'untergrund.room.v1';
const SHAPES = ['block', 'round', 'visor'];
const COLORS = ['lime', 'red', 'blue', 'violet', 'bone'];
const GEAR = ['none', 'hood', 'goggles', 'antenna', 'phones'];
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
const defaultAvatar = () => ({ name: 'Night Listener', shape: 'block', color: 'lime', gear: 'hood' });

export function loadAvatar() {
  try { return { ...defaultAvatar(), ...JSON.parse(localStorage.getItem(AVATAR_KEY)) }; }
  catch { return defaultAvatar(); }
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

function saveAvatar(avatar) {
  localStorage.setItem(AVATAR_KEY, JSON.stringify(avatar));
}

const cube = (cls, faces = ['f', 't', 'l', 'r'], front = []) => h('div', { class: `cube ${cls}` },
  faces.map((face) => h('i', { class: face }, face === 'f' ? front : [])));

function avatarNode(avatar, extra = '', style = '') {
  const safe = normalizeMember(avatar);
  const screen = h('span', { class: 'bot-screen' },
    h('i', { class: 'bot-eye left' }), h('i', { class: 'bot-eye right' }), h('i', { class: 'bot-mouth' }), h('i', { class: 'bot-goggles' }));
  return h('div', { class: `club-person ${safe.shape} ${safe.color} gear-${safe.gear} ${extra}`, style, role: 'img', 'aria-label': safe.name ? `${safe.name} avatar` : 'Crowd silhouette' },
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

function crowdSlots() {
  const slots = [];
  [[5, 4, 1], [6, 19, .8], [7, 31, .64]].forEach(([count, y, depth], row) => {
    for (let i = 0; i < count; i++) slots.push({ x: 10 + (80 * (i + .5)) / count + (row === 1 ? 2.5 : 0), y, depth, row });
  });
  return slots.sort((a, b) => a.row - b.row || Math.abs(a.x - 50) - Math.abs(b.x - 50));
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
  let reactionTimer = 0;
  let reaction = null;
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
    if (e.key === 'Escape') {
      close();
      e.stopPropagation();
      return;
    }
    if (e.target.closest('input, textarea, select')) return;
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  let kickTimer = 0;
  const onStep = (e) => {
    modal.style.setProperty('--club-step', e.detail.step);
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

  function paintReaction(fx, restart = false) {
    const elapsed = reaction ? performance.now() - reaction.at : Infinity;
    if (!fx || elapsed >= 1400) return fx;
    fx.textContent = reaction.text;
    fx.style.animationDelay = `${-Math.round(elapsed)}ms`;
    if (!restart) fx.classList.add('show');
    else {
      fx.classList.remove('show');
      requestAnimationFrame(() => fx.classList.add('show'));
    }
    return fx;
  }

  function showReaction(event) {
    reaction = { text: `${event.user?.name || 'Listener'} · ${event.payload?.value || 'HYPE'}`, at: performance.now() };
    paintReaction(modal.querySelector('.club-reaction-fx'), true);
    clearTimeout(reactionTimer);
    reactionTimer = setTimeout(() => {
      reaction = null;
      modal.querySelector('.club-reaction-fx')?.classList.remove('show');
    }, 1400);
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

  function commitName(value) {
    const name = value.trim() || 'Night Listener';
    if (name !== avatar.name) setAvatar({ name });
  }

  function setAvatar(next) {
    avatar = { ...avatar, ...next };
    saveAvatar(avatar);
    bus?.updateUser(avatar);
    render();
  }

  function avatarEditor() {
    const choice = (label, key, values) => h('label', { class: 'club-field' }, h('span', {}, label),
      h('select', { class: 'sel', onchange: (e) => setAvatar({ [key]: e.target.value }) },
        values.map((value) => {
          const option = h('option', { value }, value.toUpperCase());
          if (avatar[key] === value) option.selected = true;
          return option;
        })));
    return h('div', { class: 'club-customizer' },
      h('div', { class: 'club-custom-preview' }, avatarNode(avatar, 'preview')),
      h('div', { class: 'club-custom-fields' },
        h('label', { class: 'club-field' }, h('span', {}, 'DISPLAY NAME'),
          h('input', { class: 'inp', maxlength: 28, value: avatar.name, 'data-focus-key': 'avatar-name', onkeydown: (e) => { if (e.key === 'Enter') commitName(e.target.value); }, onblur: (e) => { if (!rendering) commitName(e.target.value); } })),
        choice('HEAD', 'shape', SHAPES),
        choice('COLOR', 'color', COLORS),
        choice('GEAR', 'gear', GEAR)));
  }

  function stage() {
    const members = (room.members.length ? room.members : [{ id: clientId(), ...avatar }]).map(normalizeMember);
    const current = room.currentSet || nowPlaying();
    const dj = members.find((member) => member.id === room.hostId) || members[0] || normalizeMember(avatar);
    const crowd = members.filter((member) => member.id !== dj.id);
    const slots = crowdSlots();
    const ambient = Array.from({ length: Math.max(0, 14 - crowd.length) }, (_, i) =>
      ({ name: '', shape: SHAPES[i % SHAPES.length], color: COLORS[(i + 2) % COLORS.length], gear: GEAR[i % GEAR.length] }));
    const people = [...crowd, ...ambient].slice(0, slots.length).map((member, i) => {
      const slot = slots[i];
      const style = `--x:${slot.x.toFixed(1)}%;--y:${slot.y}%;--depth:${slot.depth};--z:${10 - slot.row};` +
        `--turn:${((50 - slot.x) * .55).toFixed(1)}deg;--delay:${(-((i * .37) % 1)).toFixed(2)}s`;
      return avatarNode(member, i < crowd.length ? `listener p${i}` : 'ambient', style);
    });
    return h('section', { class: 'club-stage', style: `--beat:${(60 / (current.bpm || 132)).toFixed(3)}s` },
      h('div', { class: 'club-lights' }, h('i'), h('i'), h('i')),
      paintReaction(h('div', { class: 'club-reaction-fx' })),
      h('div', { class: 'club-dj' },
        avatarNode(dj, 'dj', '--turn:0deg'),
        h('div', { class: 'club-booth' }, h('i'), h('b', {}, 'UNTERGRUND'), h('i'))),
      h('div', { class: 'club-now' },
        h('span', {}, room.currentSet ? `${room.currentSet.replay ? 'REPLAY' : 'LIVE'} IN THIS ROOM${liveSetRecording() ? ' · RECORDING' : ''}` : 'READY TO BROADCAST'),
        h('strong', {}, current.title),
        h('small', {}, `${current.artist} · ${current.bpm} BPM · ${current.key || ''}`)),
      h('div', { class: 'club-floor' }, people));
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

  function chatPanel() {
    if (sideTab === 'crate') return cratePanel();
    if (sideTab === 'sets') return setsPanel();
    const feed = h('div', { class: 'club-chat-feed' },
      messages.length ? messages.map((message) => h('div', { class: `club-chat-line${message.jam ? ' jam' : ''}` },
        h('b', {}, message.user?.name || 'Listener'), h('span', {}, message.payload?.text || ''))) :
        h('div', { class: 'club-chat-empty' }, 'The room is quiet. Start the signal.'));
    const input = h('input', {
      class: 'inp', maxlength: 280, placeholder: 'Message the room', 'data-focus-key': 'chat',
      onkeydown: (e) => {
        if (e.key !== 'Enter' || !e.target.value.trim()) return;
        bus.send('chat', { text: e.target.value.trim() });
        e.target.value = '';
      },
    });
    return h('aside', { class: 'club-social' },
      h('div', { class: 'club-social-head' }, tabs(), h('b', {}, `${room.members.length || 1} LIVE`)),
      feed,
      h('div', { class: 'club-chat-compose' }, input),
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
    if (!jamHooks || !bus?.serverConnected) return null;
    const set = room.currentSet, jam = bus.jam, me = clientId();
    const isHost = !room.hostId || room.hostId === me;
    const live = !!set && jammable(set);
    const open = jam?.open !== false;
    const mine = bus.myPart();
    const nameOf = (id) => id === me ? 'YOU' : room.members.find((member) => member.id === id)?.name || 'Listener';
    const note = !set ? 'When a set is live, everyone in the room can take a part.'
      : !live ? 'Replays and scores play as written. Jam opens on the next live set.'
      : !open ? (isHost ? 'Band locked. Only you can take a part.' : 'The host locked the band.')
      : mine ? 'Your moves land on the next bar for the whole room.' : 'Take a part. Every change lands on the bar, for everyone.';
    const cards = PART_IDS.map((part) => {
      const slot = jam?.parts?.[part] || {};
      const ours = slot.owner === me;
      const roomWall = live && slot.layer && slot.step ? stepWall(set, slot.step) : 0;
      const wall = Math.max(roomWall, ours ? jamHooks.pending(part) : 0);
      const muted = ours && PARTS[part].tracks.every((id) => getState().mutes?.[id]);
      const when = live && wall > Date.now() ? h('small', { class: 'club-part-when due', 'data-wall': wall }, landText(wall, set))
        : h('small', { class: 'club-part-when' }, ours ? (muted ? 'DROPPED OUT' : 'YOURS · STUDIO EDITS GO LIVE') : slot.owner ? 'PLAYING LIVE' : live ? 'ROOM MIX' : 'WAITING FOR A SET');
      const actions = ours ? [
        h('button', { class: 'btn accent', onclick: () => playIdea(part, 'new') }, 'NEW'),
        h('button', { class: 'btn ghost', onclick: () => playIdea(part, 'vary') }, 'VARY'),
        h('button', { class: 'btn ghost', onclick: () => playIdea(part, 'drop') }, muted ? 'BRING IN' : 'DROP'),
        h('button', { class: 'btn ghost', onclick: () => jamSend({ action: 'release', part }) }, 'LET GO'),
      ] : slot.owner ? (isHost ? [h('button', { class: 'btn ghost', onclick: () => jamSend({ action: 'release', part }) }, 'FREE PART')] : [])
        : [h('button', { class: 'btn club-queue', ...((!live || (!open && !isHost)) && { disabled: '' }), onclick: () => takePart(part) }, `TAKE ${PARTS[part].label}`)];
      return h('div', { class: `club-part${ours ? ' mine' : ''}${slot.owner ? ' taken' : ''}${landedPart === part ? ' landed' : ''}`, 'data-part': part },
        h('div', { class: 'club-part-head' }, h('b', {}, PARTS[part].label), h('span', {}, slot.owner ? nameOf(slot.owner) : 'OPEN')),
        when,
        h('div', { class: 'club-part-actions' }, actions));
    });
    return h('section', { class: 'club-band', 'aria-label': 'Jam together' },
      h('div', { class: 'club-band-head' },
        h('b', {}, 'JAM'),
        h('span', {}, note),
        isHost && live ? h('button', { class: 'btn ghost', onclick: () => jamSend({ action: open ? 'lock' : 'open' }) }, open ? 'LOCK BAND' : 'OPEN BAND') : null),
      h('div', { class: 'club-band-parts' }, cards));
  }

  let rendering = false;
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
    const roomInput = h('input', {
      class: 'inp club-room-input', value: activeRoom, maxlength: 32, 'aria-label': 'Room name', 'data-focus-key': 'room',
      onkeydown: (e) => { if (e.key === 'Enter') commitRoom(e.target.value); },
      onblur: (e) => { if (!rendering) commitRoom(e.target.value); },
    });
    const isHost = !room.hostId || room.hostId === clientId();
    const queued = room.queue?.includes(clientId());
    const syncAudio = async () => {
      await unlock();
      const set = pendingSet || room.currentSet;
      if (set && audioReady && shouldJoin(set)) {
        joinRoomSet(set);
        pendingSet = null;
      }
      render();
    };
    const head = h('div', { class: 'club-head' },
      h('div', { class: 'club-brand' }, h('i'), h('div', {}, h('b', {}, 'UNTERGRUND CLUB'), h('span', {}, 'original machine music only'))),
      h('div', { class: 'club-room-name' }, h('span', {}, 'ROOM'), roomInput),
      h('div', { class: 'club-head-actions' },
        h('button', { class: 'btn ghost', onclick: async () => { await navigator.clipboard?.writeText(invite.toString()); trackEvent('share_link_copied', { what: 'room' }); toast('Room link copied'); } }, 'COPY INVITE'),
        room.currentSet && !getTransport().playing && shouldJoin(room.currentSet) ? h('button', { class: 'btn accent', onclick: syncAudio }, 'JOIN LIVE AUDIO') : null,
        h('button', { class: `btn ${isHost ? 'accent' : 'club-queue'}`, onclick: broadcastSet },
          isHost ? (room.currentSet ? 'REBROADCAST SET' : 'GO LIVE') : (queued ? 'LEAVE DJ QUEUE' : 'JOIN DJ QUEUE')),
        isHost && room.queue?.length ? h('button', { class: 'btn club-queue', onclick: () => bus.send('deck', { action: 'pass' }) }, 'PASS DECK') : null,
        h('button', { class: 'btn ghost', onclick: close }, 'CLOSE')));
    const jamBand = band();
    modal.classList.toggle('has-band', !!jamBand);
    modal.append(head,
      jamBand || '',
      h('div', { class: 'club-main' }, stage(), chatPanel()),
      h('footer', { class: 'club-footer' },
        avatarEditor(),
        h('div', { class: 'club-principle' },
          h('b', {}, '100% UNTERGRUND-NATIVE'),
          h('span', {}, 'Every set in every room is created inside the instrument. No imported catalog. No passive playlist.'),
          h('small', {}, room.queue?.length ? `UP NEXT · ${room.queue.map((id) => room.members.find((member) => member.id === id)?.name || 'Listener').join(' · ')}` : 'DJ QUEUE OPEN'))));
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
