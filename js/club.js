import { KEYS, SCALES } from './params.js';
import { STYLES, clone } from './state.js';
import { h } from './ui.js';

const AVATAR_KEY = 'untergrund.avatar.v1';
const ROOM_KEY = 'untergrund.room.v1';
const SHAPES = ['block', 'round', 'visor'];
const COLORS = ['lime', 'red', 'blue', 'violet', 'bone'];
const GEAR = ['none', 'hood', 'goggles', 'antenna'];
const REACTIONS = ['HYPE', 'DEEP', 'ACID'];

const roomId = () => {
  const query = new URLSearchParams(location.search).get('room');
  const saved = localStorage.getItem(ROOM_KEY);
  return cleanRoom(query || saved || 'the-bunker');
};
const cleanRoom = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'the-bunker';
const clientId = () => {
  let id = sessionStorage.getItem('untergrund.client');
  if (!id) {
    id = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem('untergrund.client', id);
  }
  return id;
};
const defaultAvatar = () => ({ name: 'Night Listener', shape: 'block', color: 'lime', gear: 'hood' });

export function loadAvatar() {
  try { return { ...defaultAvatar(), ...JSON.parse(localStorage.getItem(AVATAR_KEY)) }; }
  catch { return defaultAvatar(); }
}

function saveAvatar(avatar) {
  localStorage.setItem(AVATAR_KEY, JSON.stringify(avatar));
}

function avatarNode(avatar, extra = '') {
  const safe = { ...defaultAvatar(), ...avatar };
  return h('div', { class: `club-person ${safe.shape} ${safe.color} gear-${safe.gear} ${extra}` },
    h('div', { class: 'club-shadow' }),
    h('div', { class: 'club-avatar' },
      h('i', { class: 'av-antenna' }),
      h('div', { class: 'av-head' }, h('i', { class: 'av-eye left' }), h('i', { class: 'av-eye right' }), h('i', { class: 'av-goggles' })),
      h('div', { class: 'av-body' }, h('i', { class: 'av-mark' })),
      h('i', { class: 'av-arm left' }), h('i', { class: 'av-arm right' })),
    h('div', { class: 'club-name' }, safe.name));
}

class RoomBus {
  constructor(id, user, onUpdate, onEvent, apiBase = '') {
    this.id = cleanRoom(id);
    this.user = user;
    this.onUpdate = onUpdate;
    this.onEvent = onEvent;
    this.clientId = clientId();
    this.apiBase = String(apiBase || '').replace(/\/$/, '');
    this.seq = 0;
    this.seen = new Set();
    this.lastSignature = '';
    this.hostId = this.clientId;
    this.queue = [];
    this.members = new Map([[this.clientId, { id: this.clientId, ...user, seen: Date.now() }]]);
    this.currentSet = null;
    this.channel = 'BroadcastChannel' in window ? new BroadcastChannel(`untergrund:${this.id}`) : null;
    if (this.channel) this.channel.onmessage = (e) => this.receive(e.data);
    this.timer = setInterval(() => this.heartbeat(), 4000);
    this.poller = setInterval(() => this.poll(), 700);
    this.heartbeat();
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
      set: snapshot.currentSet ? [snapshot.currentSet.title, snapshot.currentSet.startsAt] : null,
      hostId: snapshot.hostId || null,
      queue: snapshot.queue || [],
      seq: this.seq,
    });
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    this.onUpdate(snapshot);
  }

  async send(type, payload = {}) {
    const event = {
      id: `${this.clientId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      user: { id: this.clientId, ...this.user, seen: Date.now() },
      payload,
      at: Date.now(),
    };
    this.receive(event);
    this.channel?.postMessage(event);
    try {
      const response = await fetch(this.endpoint('/events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...event, clientId: this.clientId, since: this.seq }),
      });
      if (response.ok) this.applySnapshot(await response.json());
    } catch {}
  }

  updateUser(user) {
    this.user = user;
    this.members.set(this.clientId, { id: this.clientId, ...user, seen: Date.now() });
    this.heartbeat();
  }

  heartbeat() {
    const event = { id: `${this.clientId}-presence-${Date.now()}`, type: 'presence', user: { id: this.clientId, ...this.user, seen: Date.now() }, at: Date.now() };
    this.channel?.postMessage(event);
    this.receive(event);
    fetch(this.endpoint('/events'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'presence', clientId: this.clientId, user: this.user, since: this.seq }),
    }).then((r) => r.ok ? r.json() : null).then((data) => data && this.applySnapshot(data)).catch(() => {});
  }

  async poll() {
    try {
      const response = await fetch(`${this.endpoint()}?since=${this.seq}`);
      if (response.ok) this.applySnapshot(await response.json());
    } catch {}
  }

  applySnapshot(snapshot) {
    this.seq = Math.max(this.seq, snapshot.seq || 0);
    this.hostId = snapshot.hostId || this.hostId;
    this.queue = snapshot.queue || this.queue;
    for (const member of snapshot.members || []) this.members.set(member.id, member);
    const cutoff = Date.now() - 15000;
    for (const [id, member] of this.members) if ((member.seen || 0) < cutoff) this.members.delete(id);
    if (snapshot.currentSet) this.currentSet = snapshot.currentSet;
    for (const event of snapshot.events || []) this.receive(event);
    this.emit({ hostId: snapshot.hostId });
  }

  receive(event) {
    if (!event?.id || this.seen.has(event.id)) return;
    this.seen.add(event.id);
    if (this.seen.size > 400) this.seen.delete(this.seen.values().next().value);
    if (event.user?.id) this.members.set(event.user.id, { ...event.user, seen: Date.now() });
    if (event.type === 'set') this.currentSet = event.payload;
    if (event.type === 'deck') {
      const action = event.payload?.action;
      if (event.payload?.hostId) this.hostId = event.payload.hostId;
      if (Array.isArray(event.payload?.queue)) this.queue = event.payload.queue;
      else if (action === 'join' && event.user?.id !== this.hostId && !this.queue.includes(event.user.id)) this.queue.push(event.user.id);
      else if (action === 'leave') this.queue = this.queue.filter((id) => id !== event.user?.id);
      else if (action === 'pass' && event.user?.id === this.hostId) this.hostId = this.queue.shift() || this.hostId;
    }
    this.onEvent(event);
    this.emit();
  }

  close() {
    clearInterval(this.timer);
    clearInterval(this.poller);
    this.channel?.close();
  }
}

export function openClub({ getState, getStyle, unlockAudio, joinRoomSet, toast }) {
  let audioReady = unlockAudio() !== false;
  let avatar = loadAvatar();
  let activeRoom = roomId();
  let bus = null;
  let room = { members: [], currentSet: null };
  let messages = [];
  let reactionTimer = 0;
  let apiBase = '';
  let pendingSet = null;
  let closed = false;

  const close = () => {
    closed = true;
    bus?.close();
    window.removeEventListener('untergrund:step', onStep);
    window.removeEventListener('keydown', onKey, true);
    ov.remove();
  };
  const ov = h('div', { class: 'club-overlay' });
  const modal = h('div', { class: 'club-shell' });
  ov.append(modal);
  document.body.append(ov);

  const onKey = (e) => {
    if (e.key === 'Escape') close();
    e.stopPropagation();
  };
  window.addEventListener('keydown', onKey, true);
  const onStep = (e) => {
    modal.style.setProperty('--club-step', e.detail.step);
    modal.classList.toggle('club-kick', e.detail.kick);
    modal.classList.toggle('club-accent', e.detail.accent);
    requestAnimationFrame(() => modal.classList.remove('club-kick', 'club-accent'));
  };
  window.addEventListener('untergrund:step', onStep);

  const connect = () => {
    if (closed) return;
    bus?.close();
    localStorage.setItem(ROOM_KEY, activeRoom);
    bus = new RoomBus(activeRoom, avatar,
      (next) => { room = next; render(); },
      (event) => {
        if (event.type === 'chat') messages = [...messages, event].slice(-60);
        if (event.type === 'reaction') showReaction(event);
        if (event.type === 'set') {
          pendingSet = event.payload;
          if (audioReady) {
            joinRoomSet(pendingSet);
            pendingSet = null;
          }
        }
      }, apiBase);
  };

  function showReaction(event) {
    const fx = modal.querySelector('.club-reaction-fx');
    if (!fx) return;
    fx.textContent = `${event.user?.name || 'Listener'} · ${event.payload?.value || 'HYPE'}`;
    fx.classList.remove('show');
    requestAnimationFrame(() => fx.classList.add('show'));
    clearTimeout(reactionTimer);
    reactionTimer = setTimeout(() => fx.classList.remove('show'), 1400);
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
    audioReady = unlockAudio() !== false;
    if (room.hostId && room.hostId !== clientId()) {
      const queued = room.queue?.includes(clientId());
      bus.send('deck', { action: queued ? 'leave' : 'join' });
      toast(queued ? 'Left the DJ queue' : 'Joined the DJ queue');
      return;
    }
    const startsAt = Date.now() + 1600;
    const track = nowPlaying();
    bus.send('set', { state: clone(getState()), style: getStyle(), ...track, startsAt });
    toast(`Broadcasting “${track.title}” to ${activeRoom}`);
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
          h('input', { class: 'inp', maxlength: 28, value: avatar.name, onchange: (e) => setAvatar({ name: e.target.value.trim() || 'Night Listener' }) })),
        choice('HEAD', 'shape', SHAPES),
        choice('COLOR', 'color', COLORS),
        choice('GEAR', 'gear', GEAR)));
  }

  function stage() {
    const members = room.members.length ? room.members : [{ id: clientId(), ...avatar }];
    const current = room.currentSet || nowPlaying();
    const dj = members.find((member) => member.id === room.hostId) || members[0] || avatar;
    const crowd = members.filter((member) => member.id !== dj.id);
    const ambient = Array.from({ length: Math.max(7, 12 - crowd.length) }, (_, i) =>
      avatarNode({ name: '', shape: SHAPES[i % SHAPES.length], color: COLORS[(i + 2) % COLORS.length], gear: GEAR[i % GEAR.length] }, `ambient a${i}`));
    return h('section', { class: 'club-stage' },
      h('div', { class: 'club-lights' }, h('i'), h('i'), h('i')),
      h('div', { class: 'club-reaction-fx' }),
      h('div', { class: 'club-dj' },
        h('div', { class: 'club-booth' }, h('i'), h('b', {}, 'UNTERGRUND'), h('i')),
        avatarNode(dj, 'dj')),
      h('div', { class: 'club-now' },
        h('span', {}, room.currentSet ? 'LIVE IN THIS ROOM' : 'READY TO BROADCAST'),
        h('strong', {}, current.title),
        h('small', {}, `${current.artist} · ${current.bpm} BPM · ${current.key || ''}`)),
      h('div', { class: 'club-floor' }, ambient, crowd.map((member, i) => avatarNode(member.avatar || member, `listener p${i}`))));
  }

  function chatPanel() {
    const feed = h('div', { class: 'club-chat-feed' },
      messages.length ? messages.map((message) => h('div', { class: 'club-chat-line' },
        h('b', {}, message.user?.name || 'Listener'), h('span', {}, message.payload?.text || ''))) :
        h('div', { class: 'club-chat-empty' }, 'The room is quiet. Start the signal.'));
    const input = h('input', {
      class: 'inp', maxlength: 280, placeholder: 'Message the room',
      onkeydown: (e) => {
        if (e.key !== 'Enter' || !e.target.value.trim()) return;
        bus.send('chat', { text: e.target.value.trim() });
        e.target.value = '';
      },
    });
    return h('aside', { class: 'club-social' },
      h('div', { class: 'club-social-head' }, h('span', {}, 'ROOM SIGNAL'), h('b', {}, `${room.members.length || 1} LIVE`)),
      feed,
      h('div', { class: 'club-chat-compose' }, input),
      h('div', { class: 'club-reactions' }, REACTIONS.map((value) =>
        h('button', { class: 'btn ghost', onclick: () => bus.send('reaction', { value }) }, value))));
  }

  function render() {
    modal.innerHTML = '';
    const invite = new URL(location.href);
    invite.searchParams.set('room', activeRoom);
    const roomInput = h('input', {
      class: 'inp club-room-input', value: activeRoom, maxlength: 32,
      onchange: (e) => {
        const next = cleanRoom(e.target.value);
        if (next === activeRoom) return;
        activeRoom = next;
        history.replaceState(null, '', `${location.pathname}?room=${activeRoom}`);
        messages = [];
        connect();
      },
    });
    const isHost = !room.hostId || room.hostId === clientId();
    const queued = room.queue?.includes(clientId());
    const syncAudio = () => {
      audioReady = unlockAudio() !== false;
      const set = pendingSet || room.currentSet;
      if (set && audioReady) {
        joinRoomSet(set);
        pendingSet = null;
      }
    };
    const head = h('header', { class: 'club-head' },
      h('div', { class: 'club-brand' }, h('i'), h('div', {}, h('b', {}, 'UNTERGRUND CLUB'), h('span', {}, 'original machine music only'))),
      h('div', { class: 'club-room-name' }, h('span', {}, 'ROOM'), roomInput),
      h('div', { class: 'club-head-actions' },
        h('button', { class: 'btn ghost', onclick: async () => { await navigator.clipboard?.writeText(invite.toString()); toast('Room link copied'); } }, 'COPY INVITE'),
        !audioReady && room.currentSet ? h('button', { class: 'btn accent', onclick: syncAudio }, 'JOIN LIVE AUDIO') : null,
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
  }

  render();
  fetch('/api/room-config')
    .then((response) => response.ok ? response.json() : { apiBase: '' })
    .then((config) => { apiBase = config.apiBase || ''; })
    .catch(() => {})
    .finally(connect);
}
