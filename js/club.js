import { KEYS, SCALES } from './params.js';
import { STYLES, clone } from './state.js';
import { listCrate, fetchTrack } from './crate.js';
import { h } from './ui.js';
import { createClientCredentials } from './client-id.js';

const AVATAR_KEY = 'untergrund.avatar.v1';
const ROOM_KEY = 'untergrund.room.v1';
const SHAPES = ['block', 'round', 'visor'];
const COLORS = ['lime', 'red', 'blue', 'violet', 'bone'];
const GEAR = ['none', 'hood', 'goggles', 'antenna', 'phones'];
const REACTIONS = ['HYPE', 'DEEP', 'ACID'];

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
    this.receive({ ...event, local: true });
    this.channel?.postMessage(event);
    await this.ready;
    try {
      const response = await fetch(this.endpoint('/events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, clientId: this.clientId, clientSecret: this.clientSecret, token: this.token, since: this.seq }),
      });
      if (response.ok) this.applySnapshot(await response.json());
    } catch {}
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
    clearInterval(this.timer);
    clearInterval(this.poller);
    this.channel?.close();
  }
}

// A live DJ's room connection outlives the overlay so the deck isn't lost while editing in Studio.
let parkedBus = null;

export function openClub({ getState, getStyle, loadTrack, getTransport, startRoomBroadcast, unlockAudio, joinRoomSet, toast }) {
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
    if (bus && bus.hostId === bus.clientId && bus.currentSet && getTransport().playing) {
      bus.onUpdate = () => {};
      bus.onEvent = () => {};
      parkedBus = bus;
    } else bus?.close();
    window.removeEventListener('untergrund:step', onStep);
    window.removeEventListener('keydown', onKey, true);
    ov.remove();
  };
  const ov = h('div', { class: 'club-overlay' });
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
    clearTimeout(kickTimer);
    kickTimer = setTimeout(() => modal.classList.remove('club-kick', 'club-accent'), 120);
  };
  window.addEventListener('untergrund:step', onStep);

  const connect = () => {
    if (closed) return;
    localStorage.setItem(ROOM_KEY, activeRoom);
    const onUpdate = (next) => { room = next; render(); };
    const onEvent = (event) => {
      if (event.type === 'chat') messages = [...messages, event].slice(-60);
      if (event.type === 'reaction') showReaction(event);
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
    if (!transport.playing) startRoomBroadcast(startsAt);
    toast(`Broadcasting “${track.title}” to ${activeRoom}`);
  }

  function commitRoom(value) {
    const next = cleanRoom(value);
    if (next === activeRoom) return;
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
        h('span', {}, room.currentSet ? 'LIVE IN THIS ROOM' : 'READY TO BROADCAST'),
        h('strong', {}, current.title),
        h('small', {}, `${current.artist} · ${current.bpm} BPM · ${current.key || ''}`)),
      h('div', { class: 'club-floor' }, people));
  }

  let sideTab = 'signal';
  let crate = { loaded: false, shared: false, tracks: [] };
  const refreshCrate = () => listCrate().then((next) => { crate = { ...next, loaded: true }; if (!closed) render(); });
  const tabs = () => h('div', { class: 'club-tabs' }, [['signal', 'ROOM SIGNAL'], ['crate', 'CRATE']].map(([id, label]) =>
    h('button', { class: sideTab === id ? 'on' : '', onclick: () => { sideTab = id; if (id === 'crate') refreshCrate(); render(); } }, label)));

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
        h('div', {}, h('b', {}, item.title), h('small', {}, `${STYLES[item.style]?.name || item.style} · ${item.bpm} BPM · ${item.artist}`)),
        h('button', { class: `btn ${isHost ? 'accent' : 'ghost'}`, onclick: () => spin(item) }, isHost ? 'SPIN' : 'LOAD'))) :
        h('div', { class: 'club-chat-empty' }, 'No tracks yet. Hit GENERATE and they land here.'));
    return h('aside', { class: 'club-social' },
      h('div', { class: 'club-social-head' }, tabs(), h('b', {}, `${crate.tracks.length} TRACKS`)),
      list,
      h('div', { class: 'club-crate-note' }, crate.shared ? 'Shared crate: every UNTERGRUND DJ can spin these.' : 'Saved in this browser. Shared storage is not connected yet.'));
  }

  function chatPanel() {
    if (sideTab === 'crate') return cratePanel();
    const feed = h('div', { class: 'club-chat-feed' },
      messages.length ? messages.map((message) => h('div', { class: 'club-chat-line' },
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
      class: 'inp club-room-input', value: activeRoom, maxlength: 32, 'data-focus-key': 'room',
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
    const head = h('header', { class: 'club-head' },
      h('div', { class: 'club-brand' }, h('i'), h('div', {}, h('b', {}, 'UNTERGRUND CLUB'), h('span', {}, 'original machine music only'))),
      h('div', { class: 'club-room-name' }, h('span', {}, 'ROOM'), roomInput),
      h('div', { class: 'club-head-actions' },
        h('button', { class: 'btn ghost', onclick: async () => { await navigator.clipboard?.writeText(invite.toString()); toast('Room link copied'); } }, 'COPY INVITE'),
        room.currentSet && !getTransport().playing && shouldJoin(room.currentSet) ? h('button', { class: 'btn accent', onclick: syncAudio }, 'JOIN LIVE AUDIO') : null,
        h('button', { class: `btn ${isHost ? 'accent' : 'club-queue'}`, onclick: broadcastSet },
          isHost ? (room.currentSet ? 'REBROADCAST SET' : 'GO LIVE') : (queued ? 'LEAVE DJ QUEUE' : 'JOIN DJ QUEUE')),
        isHost && room.queue?.length ? h('button', { class: 'btn club-queue', onclick: () => bus.send('deck', { action: 'pass' }) }, 'PASS DECK') : null,
        h('button', { class: 'btn ghost', onclick: close }, 'CLOSE')));
    modal.append(head,
      h('main', { class: 'club-main' }, stage(), chatPanel()),
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
