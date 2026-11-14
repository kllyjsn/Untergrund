import { h } from './ui.js';
import { REPERTOIRE } from './repertoire-index.js';

// The Club stage: a persistent DOM that stays locked to the room's beat grid, follows the song's sections,
// and turns reactions and DJ handoffs into moments. Only transform/opacity animate.
// The set follows the music: a DJ booth for club records, a band for songs, an orchestra or a recital for scores.

export const REACTION_COLORS = { HYPE: 'var(--green)', DEEP: 'var(--teal)', ACID: 'var(--yellow)' };
// CSS animations that ride the beat grid; their start time is pinned to the grid so every client dances on the same kick.
export const BEAT_ANIMATIONS = new Set(['botBounce', 'botNod', 'botJump', 'botSway', 'armPlay', 'armConduct']);
const BAR_STEPS = 16;

export function crowdSlots() {
  const slots = [];
  [[5, 4, 1], [6, 19, .8], [7, 31, .64]].forEach(([count, y, depth], row) => {
    for (let i = 0; i < count; i++) slots.push({ x: 10 + (80 * (i + .5)) / count + (row === 1 ? 2.5 : 0), y, depth, row });
  });
  return slots.sort((a, b) => a.row - b.row || Math.abs(a.x - 50) - Math.abs(b.x - 50));
}

export function sectionMood(name = '') {
  const s = String(name).toUpperCase();
  if (s === 'DROP' || s === 'HOOK') return 'drop';
  if (s === 'BUILD' || s === 'FILL') return 'build';
  if (s === 'BREAKDOWN' || s === 'BRIDGE' || s === 'INTRO') return 'break';
  return 'groove';
}

const PIECE_ENSEMBLE = Object.fromEntries(REPERTOIRE.map((p) => [p.id, p.ensemble]));
// STAB voice (js/engine.js STAB_VOICES) -> who plays it on stage.
const STAB_PLAYER = { 1: 'keys', 3: 'keys', 7: 'keys', 8: 'egtr', 9: 'sax', 10: 'violin', 11: 'egtr', 12: 'agtr' };
const BANDS = {
  country: { set: 'barn', lead: 'agtr', mic: true, band: ['egtr', 'bass', 'drums'] },
  rock: { set: 'arena', lead: 'egtr', mic: true, band: ['egtr', 'bass', 'drums'] },
  folk: { set: 'lounge', lead: 'agtr', mic: true, band: ['bass', 'drums'] },
  pop: { set: 'arena', lead: 'mic', band: ['bass', 'drums'] },
  rnb: { set: 'lounge', lead: 'mic', band: ['bass', 'drums'] },
  neosoul: { set: 'lounge', lead: 'keys', band: ['bass', 'drums'] },
};
const ORCHESTRA = ['violin', 'violin', 'viola', 'cello', 'contrabass', 'flute', 'clarinet', 'horn', 'trumpet', 'timpani', 'harp'];
const ACCOMPANY = ['baton', 'violin', 'violin', 'cello', 'contrabass', 'flute', 'horn', 'timpani'];
export const DJ_SCENE = { kind: 'dj', set: 'club', lead: 'decks', mic: false, players: [], crowd: 'dance', verb: 'NOW SPINNING' };

// Which stage a song gets, from its genre and what is actually playing in it.
export function stageScene(style, state = null) {
  const pats = state?.patterns || [];
  const score = (pats[state?.current | 0] || pats[0])?.score;
  const hall = (kind, lead, players, verb) => ({ kind, set: 'hall', lead, mic: false, players, crowd: 'seated', verb });
  if (score?.piece || style === 'repertoire')
    return PIECE_ENSEMBLE[score?.piece] === 'strings' ? hall('chamber', 'violin', ['violin', 'viola', 'cello'], 'NOW ON STAGE') : hall('recital', 'grand', [], 'AT THE PIANO');
  const form = score?.form || style;
  if (form === 'nocturne') return hall('recital', 'grand', [], 'AT THE PIANO');
  if (form === 'concerto') return hall('orchestra', 'grand', ACCOMPANY, 'AT THE PIANO');
  if (form === 'symphony') return hall('orchestra', 'baton', ORCHESTRA, 'ON THE PODIUM');
  const band = BANDS[style];
  if (!band) return DJ_SCENE;
  const players = [...band.band];
  const stab = STAB_PLAYER[Math.round(+state?.params?.stab?.voice || 0)];
  if (stab && stab !== band.lead && !players.includes(stab)) players.unshift(stab);
  return { kind: 'band', set: band.set, lead: band.lead, mic: band.mic, players, crowd: 'dance', verb: 'NOW ON STAGE' };
}
export const sceneKey = (sc) => [sc.kind, sc.set, sc.lead, sc.mic, ...sc.players].join(':');

// Where everyone stands: the lead out front, players fanned around them, rhythm and brass on the riser.
const ROW = { drums: 2, timpani: 2, harp: 2, horn: 2, trumpet: 2, flute: 1, clarinet: 1, sax: 1, keys: 1, contrabass: 1 };
export function ensembleLayout(sc) {
  const big = sc.kind === 'orchestra', piano = sc.lead === 'grand';
  const Y = big ? [0, 66, 120] : [4, 58, 92], S = big ? [.74, .64, .58] : [1.05, .92, .86];
  const rows = [[], [], []];
  const at = new Array(sc.players.length);
  sc.players.forEach((inst, i) => {
    // A concerto's conductor stands just past the piano's tail, facing the orchestra.
    if (inst === 'baton') at[i] = { x: 66, y: Y[0], s: S[0] + .04, z: 9 };
    else rows[ROW[inst] ?? 0].push(i);
  });
  if (!rows[0].length && !big) rows[0] = rows[1].splice(0);
  const spread = (n, a, b) => Array.from({ length: n }, (_, k) => (n === 1 ? (a + b) / 2 : a + ((b - a) * k) / (n - 1)));
  rows.forEach((row, r) => {
    if (!row.length) return;
    let xs;
    if (r === 0) {
      // The front row leaves the middle to the lead (a grand piano and its conductor need room to the right).
      const edge = big ? 7 : 16, left = Math.ceil(row.length / 2);
      const l = spread(left, edge, piano ? 22 : 34), rt = spread(row.length - left, piano ? 76 : 66, 100 - edge);
      xs = [...(left === 1 ? [piano ? 16 : 24] : l), ...(rt.length === 1 ? [piano ? 84 : 82] : rt)];
    } else if (row.length > 1) xs = spread(row.length, big ? 18 : 30, big ? 82 : 70);
    // Lone players on the riser step out from behind the lead and from each other.
    else xs = [big ? 50 : r === 2 && rows[1].length ? 34 : 64];
    row.forEach((i, k) => { at[i] = { x: xs[k], y: Y[r], s: S[r], z: 8 - r * 2 }; });
  });
  const lead = sc.lead === 'grand' ? { x: sc.players.length ? 40 : 36, y: Y[0], s: big ? .9 : 1.25, z: 9 } : { x: 50, y: Y[0] - (big ? 0 : 6), s: big ? .86 : 1.25, z: 10 };
  return { lead, players: at };
}

// Instruments, built from boxes like the bots. HELD rides the player's bounce, FLOOR stands in front of them
// (and turns with them), HAND sits in a hand, ROOM stays flat on the stage.
const parts = (cls, n) => h('b', { class: `prop ${cls}` }, Array.from({ length: n }, () => h('i')));
const INSTRUMENTS = {
  agtr: { held: () => parts('gtr acoustic', 3) },
  egtr: { held: () => parts('gtr electric', 3) },
  bass: { held: () => parts('gtr bassgtr', 3) },
  violin: { held: () => parts('violin', 2), right: 'bow', chair: true },
  viola: { held: () => parts('violin viola', 2), right: 'bow', chair: true },
  cello: { floor: () => parts('cello', 2), right: 'bow', seated: true },
  contrabass: { floor: () => parts('cello contrabass', 2), right: 'bow' },
  flute: { held: () => parts('flute', 1), chair: true },
  clarinet: { held: () => parts('clarinet', 1), chair: true },
  sax: { held: () => parts('sax', 1) },
  trumpet: { held: () => parts('trumpet', 1), chair: true },
  horn: { held: () => parts('horn', 1), chair: true },
  drums: { floor: () => parts('kit', 5), left: 'stick', right: 'stick', seated: true },
  timpani: { floor: () => parts('timpani', 2), left: 'mallet', right: 'mallet' },
  keys: { floor: () => parts('keys', 2) },
  harp: { floor: () => parts('harp', 2), chair: true },
  grand: { room: () => [parts('bench', 0), parts('grand', 5)], seated: true },
  baton: { room: () => [parts('podium', 0)], right: 'baton' },
  mic: { right: 'mic' },
};
export const INSTRUMENT_NAMES = Object.keys(INSTRUMENTS);

function equip(node, inst, { mic = false, chair = false } = {}) {
  const spec = INSTRUMENTS[inst];
  if (!spec) return node;
  const bot = node.querySelector('.bot'), rig = node.querySelector('.bot-rig');
  if (spec.held) rig.append(spec.held());
  if (spec.floor) bot.append(spec.floor());
  if (mic) bot.append(parts('micstand', 0));
  for (const side of ['left', 'right']) if (spec[side]) node.querySelector(`.bot-arm.${side}`).append(h('b', { class: `prop hand ${spec[side]}` }));
  if (spec.room) node.prepend(...spec.room());
  if (spec.seated || (chair && spec.chair)) node.classList.add('seated');
  if (chair && spec.chair) node.prepend(parts('chair', 0));
  return node;
}

export const stepMs = (bpm) => 15000 / Math.max(40, Math.min(240, +bpm || 132));

// Wall-clock set start → document-timeline origin (performance.now() shares the timeline's time origin).
export const gridOrigin = (startsAt, nowWall = Date.now(), nowPerf = performance.now()) => nowPerf - (nowWall - startsAt);

// Signed offset (ms) of `est` against `origin`, folded into one bar so it never exceeds half a bar.
export function gridError(est, origin, period) {
  const d = (((est - origin) % period) + period) % period;
  return d > period / 2 ? d - period : d;
}

// A burst: enough reactions, from enough different people, inside a short window.
export function reactionBurst(history, now, { windowMs = 2500, count = 3, people = 2 } = {}) {
  const recent = history.filter((r) => now - r.at <= windowMs);
  return recent.length >= count && new Set(recent.map((r) => r.id)).size >= people;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const signature = (m, extra, style) => JSON.stringify([m.name, m.shape, m.color, m.gear, extra, style]);

export function createStage({ avatarNode, normalizeMember, looks: { SHAPES, COLORS, GEAR } }) {
  const lights = h('div', { class: 'club-lights' }, h('i'), h('i'), h('i'));
  const flash = h('div', { class: 'club-flash' });
  const fx = h('div', { class: 'club-fx', 'aria-hidden': 'true' });
  const booth = h('div', { class: 'club-booth' }, h('i'), h('b', {}, 'UNTERGRUND'), h('i'));
  const djBox = h('div', { class: 'club-dj' }, booth);
  const scenery = h('div', { class: 'club-set', 'aria-hidden': 'true' });
  const spinVerb = h('span', {}, DJ_SCENE.verb);
  const spin = h('div', { class: 'club-spin', 'aria-live': 'polite' }, spinVerb, h('b'));
  const nowLabel = h('span');
  const nowTitle = h('strong');
  const nowMeta = h('small');
  const now = h('div', { class: 'club-now' }, nowLabel, nowTitle, nowMeta);
  const floor = h('div', { class: 'club-floor' });
  const el = h('section', { class: 'club-stage mood-groove set-club scene-dj' }, scenery, lights, flash, fx, djBox, spin, now, floor);

  const nodes = new Map(); // key → { node, sig }
  let djId = '';
  let djNode = null;
  let beat = stepMs(132) * 4;
  let origin = 0;
  let startsAt = null;
  let mood = 'groove';
  let lateness = [];
  let reactions = [];
  let momentUntil = 0;
  let momentTimer = 0;
  let lockQueued = false;
  let chipAt = 0;
  let scene = DJ_SCENE;
  let sceneId = sceneKey(DJ_SCENE);
  let bandNodes = [];

  const bar = () => beat * 4;
  // Pin every beat animation to the grid. Runs after (re)insertion, so a re-render never visibly restarts the dance.
  function lock() {
    lockQueued = false;
    if (!el.isConnected) return;
    for (const a of el.getAnimations({ subtree: true })) if (BEAT_ANIMATIONS.has(a.animationName)) a.startTime = origin;
  }
  const queueLock = () => { if (!lockQueued) { lockQueued = true; queueMicrotask(lock); } };
  const nextBeatIn = (ahead = 0) => {
    const t = performance.now() + ahead - origin;
    return Math.ceil(t / beat) * beat - t;
  };

  function person(key, member, extra, style, gear = null) {
    const sig = signature(member, extra + (gear ? ` ${JSON.stringify(gear)}` : ''), style);
    const known = nodes.get(key);
    if (known?.sig === sig) return known.node;
    const node = avatarNode(member, extra, style);
    if (gear) equip(node, gear.inst, gear);
    node.dataset.member = key;
    nodes.set(key, { node, sig, fresh: !known });
    return node;
  }

  function nowSpinning(name, delay = 0) {
    spin.querySelector('b').textContent = name;
    if (reduced()) {
      spin.animate([{ opacity: 0 }, { opacity: 1, offset: .1 }, { opacity: 1, offset: .85 }, { opacity: 0 }], { duration: 2600, delay });
      return;
    }
    spin.animate([
      { opacity: 0, transform: 'translate(-50%, 10px)' },
      { opacity: 1, transform: 'translate(-50%, 0)', offset: .12 },
      { opacity: 1, transform: 'translate(-50%, 0)', offset: .82 },
      { opacity: 0, transform: 'translate(-50%, -6px)' },
    ], { duration: 2800, delay, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  function handoff(oldNode, newNode, name) {
    if (oldNode) {
      oldNode.classList.add('leaving');
      djBox.append(oldNode);
      const out = oldNode.animate([{ translate: '0 0', opacity: 1 }, { translate: '0 70px', opacity: 0 }],
        { duration: reduced() ? 1 : 650, easing: 'cubic-bezier(.4,0,.6,1)', fill: 'forwards' });
      out.finished.then(() => oldNode.remove(), () => oldNode.remove());
    }
    if (!reduced()) newNode.animate([{ translate: '0 90px', opacity: 0 }, { translate: '0 0', opacity: 1 }],
      { duration: 750, delay: oldNode ? 380 : 0, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    nowSpinning(name, oldNode ? 500 : 0);
    moment(oldNode ? 1000 : 300);
  }

  // Room moment: lights flare, the floor jumps on the next four beats.
  function moment(delay = 0) {
    const t = performance.now() + delay;
    if (t < momentUntil) return;
    const wait = delay + nextBeatIn(delay);
    momentUntil = t + beat * 4;
    clearTimeout(momentTimer);
    momentTimer = setTimeout(() => {
      el.classList.add('club-moment');
      flash.animate([{ opacity: .9 }, { opacity: 0 }], { duration: beat * 2, easing: 'ease-out' });
      if (!reduced() && scene.crowd !== 'seated') floor.querySelectorAll(':scope > .club-person:not(.ambient) .bot, :scope > .club-person.ambient:nth-child(odd) .bot').forEach((bot) =>
        bot.animate([{ translate: '0 0' }, { translate: '0 -22px', offset: .45, easing: 'ease-in' }, { translate: '0 0' }],
          { duration: beat, iterations: 4, easing: 'cubic-bezier(.3,.7,.4,1)' }));
      momentTimer = setTimeout(() => el.classList.remove('club-moment'), beat * 4);
    }, wait);
  }

  function setMood(next) {
    if (next === mood) return;
    const was = mood;
    el.classList.replace(`mood-${mood}`, `mood-${next}`);
    mood = next;
    queueLock();
    if (next === 'drop' && was !== 'drop') moment();
  }

  const DRESSING = {
    hall: ['curtain left', 'curtain right', 'valance'],
    barn: ['bulbs', 'bulbs low', 'bale left', 'bale right'],
    arena: ['truss', 'amp left', 'amp right'],
    lounge: ['lamp left', 'lamp right'],
  };
  function setScene(next) {
    const id = sceneKey(next);
    if (id === sceneId) return;
    el.classList.remove(`set-${scene.set}`, `scene-${scene.kind}`, `crowd-${scene.crowd}`);
    el.classList.add(`set-${next.set}`, `scene-${next.kind}`, `crowd-${next.crowd}`);
    scenery.replaceChildren(...(DRESSING[next.set] || []).map((c) => h('i', { class: c })));
    djBox.className = next.kind === 'dj' ? 'club-dj' : `club-ensemble ens-${next.kind}`;
    booth.hidden = next.kind !== 'dj';
    spinVerb.textContent = next.verb;
    scene = next;
    sceneId = id;
  }

  function update({ members, hostId, current, label, scene: nextScene = DJ_SCENE }) {
    setScene(nextScene);
    const dj = members.find((m) => m.id === hostId) || members[0];
    const crowd = members.filter((m) => m.id !== dj.id);
    const slots = crowdSlots();
    const bpm = current.bpm || 132;
    beat = stepMs(bpm) * 4;
    el.style.setProperty('--beat', `${(beat / 1000).toFixed(3)}s`);
    const start = Number.isFinite(+current.startsAt) ? +current.startsAt : null;
    if (start !== startsAt) { startsAt = start; origin = start == null ? 0 : gridOrigin(start); lateness = []; }

    nowLabel.textContent = label;
    nowTitle.textContent = current.title;
    nowMeta.textContent = `${current.artist} · ${current.bpm} BPM · ${current.key || ''}`;

    const prevDj = djId;
    const prevNode = djNode;
    const dj_ = scene.kind === 'dj';
    const layout = dj_ ? null : ensembleLayout(scene);
    const place = (p, turn) => `--x:${p.x.toFixed(1)}%;--y:${p.y}px;--s:${p.s};--z:${p.z};--turn:${turn.toFixed(1)}deg;--delay:0s`;
    const nextDjNode = dj_ ? person(`dj:${dj.id}`, dj, 'dj', '--turn:0deg')
      : person(`dj:${dj.id}`, dj, `lead plays-${scene.lead}`, place(layout.lead, scene.lead === 'grand' ? 58 : 0), { inst: scene.lead, mic: scene.mic });
    nextDjNode.dataset.id = dj.id;
    const players = dj_ ? [] : scene.players.map((inst, i) => {
      const p = layout.players[i];
      const look = normalizeMember({ name: '', shape: SHAPES[(i + 1) % SHAPES.length], color: COLORS[(i * 3 + 1) % COLORS.length], gear: GEAR[(i * 2) % GEAR.length] });
      return person(`band:${i}`, look, `player plays-${inst}`, place(p, (50 - p.x) * .5), { inst, chair: scene.set === 'hall' });
    });
    if (nextDjNode !== djNode || players.length !== bandNodes.length || players.some((n, i) => n !== bandNodes[i])) {
      for (const n of [...djBox.children]) if (n !== booth && n !== prevNode) n.remove();
      if (nextDjNode !== djNode) prevNode?.remove();
      djBox.append(...players, nextDjNode);
      djNode = nextDjNode;
      bandNodes = players;
    }
    djId = dj.id;
    if (prevDj && prevDj !== dj.id) handoff(prevNode, nextDjNode, dj.name);

    const ambient = Array.from({ length: Math.max(0, 14 - crowd.length) }, (_, i) =>
      normalizeMember({ name: '', shape: SHAPES[i % SHAPES.length], color: COLORS[(i + 2) % COLORS.length], gear: GEAR[i % GEAR.length] }));
    const keep = new Set([djNode.dataset.member, ...bandNodes.map((n) => n.dataset.member)]);
    const people = [...crowd, ...ambient].slice(0, slots.length).map((member, i) => {
      const slot = slots[i];
      const real = i < crowd.length;
      // Whole-beat offsets: neighbours sway mirrored but every kick still lands on the same frame.
      const style = `--x:${slot.x.toFixed(1)}%;--y:${slot.y}%;--depth:${slot.depth};--z:${10 - slot.row};` +
        `--turn:${((50 - slot.x) * .55).toFixed(1)}deg;--delay:calc(var(--beat) * ${-((i * 3) % 4)});--blink:${(-((i * .37) % 1) * 4.2).toFixed(2)}s`;
      const key = real ? `m:${member.id}` : `a:${i}`;
      keep.add(key);
      const node = person(key, member, real ? `listener p${i}` : 'ambient', style);
      if (real) node.dataset.id = member.id;
      return node;
    });
    const changed = people.length !== floor.children.length || people.some((node, i) => floor.children[i] !== node);
    if (changed) floor.replaceChildren(...people);
    for (const key of [...nodes.keys()]) if (!keep.has(key)) nodes.delete(key);
    for (const node of people) {
      const entry = nodes.get(node.dataset.member);
      if (entry?.fresh && prevDj && !reduced() && !node.classList.contains('ambient'))
        node.animate([{ opacity: 0, translate: '0 24px' }, { opacity: 1, translate: '0 0' }], { duration: 600, easing: 'cubic-bezier(.2,.8,.2,1)' });
      if (entry) entry.fresh = false;
    }
    queueLock();
    return el;
  }

  // Every rendered step from main.js: keep the grid on what this client actually hears, and follow the song's sections.
  function step(detail) {
    if ('section' in detail) setMood(sectionMood(detail.section));
    if (!Number.isFinite(detail.abs)) return;
    const est = performance.now() - detail.abs * (beat / 4);
    if (startsAt == null && !lateness.length && origin === 0) origin = est;
    lateness.push(gridError(est, origin, bar()));
    if (lateness.length < 8) return;
    const err = Math.min(...lateness);
    lateness = [];
    if (Math.abs(err) > 25) { origin += err; lock(); }
  }

  function react({ id, name, value }) {
    const t = performance.now();
    reactions = [...reactions.filter((r) => t - r.at < 4000), { id, at: t }];
    const target = id && (el.querySelector(`.club-person[data-id="${CSS.escape(id)}"]`));
    const stage = el.getBoundingClientRect();
    const box = target?.querySelector('.bot-head-wrap')?.getBoundingClientRect();
    const x = box ? box.left + box.width / 2 - stage.left : stage.width / 2;
    const y = box ? box.top - stage.top - 34 : stage.height * .4;
    const color = REACTION_COLORS[value] || 'var(--text)';
    const key = id || '';
    const lane = [...fx.children].filter((c) => c.dataset.for === key).length % 4;
    const chip = h('div', { class: 'club-chip', 'data-for': key, style: `left:${x.toFixed(0)}px;top:${(y - lane * 30).toFixed(0)}px;--c:${color}` },
      h('b', {}, value), h('span', {}, name || 'Listener'));
    while (fx.children.length > 11) fx.firstChild.remove();
    fx.append(chip);
    const drift = (lane % 2 ? 1 : -1) * (6 + lane * 6);
    const still = reduced();
    // Reactions that arrive in one poll still read one by one.
    const delay = Math.max(0, chipAt + 160 - t);
    chipAt = t + delay;
    chip.animate([
      { opacity: 0, transform: `translate(-50%, 8px) scale(.9)` },
      { opacity: 1, transform: `translate(-50%, -6px) scale(1)`, offset: .12 },
      { opacity: 1, transform: `translate(calc(-50% + ${drift * .6}px), ${still ? -6 : -60}px)`, offset: .78 },
      { opacity: 0, transform: `translate(calc(-50% + ${drift}px), ${still ? -6 : -92}px)` },
    ], { duration: 2600, delay, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' }).finished.then(() => chip.remove(), () => chip.remove());
    if (target && !still) {
      const bot = target.querySelector('.bot');
      const arms = target.querySelectorAll('.bot-arm');
      if (value === 'ACID') bot.animate([{ rotate: '0 1 0 0deg' }, { rotate: '0 1 0 360deg' }], { duration: beat * 2, delay: delay + nextBeatIn(delay), easing: 'cubic-bezier(.5,0,.3,1)' });
      bot.animate(value === 'DEEP'
        ? [{ translate: '0 0' }, { translate: '0 9px', offset: .5 }, { translate: '0 0' }]
        : [{ translate: '0 0' }, { translate: '0 -26px', offset: .4, easing: 'ease-in' }, { translate: '0 0' }],
      { duration: beat, iterations: value === 'HYPE' ? 2 : 1, delay: delay + nextBeatIn(delay), easing: 'cubic-bezier(.3,.7,.4,1)' });
      arms.forEach((arm, i) => {
        const up = `0 0 1 ${i ? -165 : 165}deg`;
        arm.animate([{ rotate: up, offset: .15 }, { rotate: up, offset: .75 }], { duration: beat * 2, delay, easing: 'ease-out' });
      });
    }
    if (reactionBurst(reactions, t)) { reactions = []; moment(); }
  }

  return { el, update, step, react, lock, get mood() { return mood; } };
}
