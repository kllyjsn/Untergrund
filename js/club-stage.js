import { h } from './ui.js';

// The Club stage: a persistent DOM that stays locked to the room's beat grid, follows the song's sections,
// and turns reactions and DJ handoffs into moments. Only transform/opacity animate.

export const REACTION_COLORS = { HYPE: 'var(--green)', DEEP: 'var(--teal)', ACID: 'var(--yellow)' };
// CSS animations that ride the beat grid; their start time is pinned to the grid so every client dances on the same kick.
export const BEAT_ANIMATIONS = new Set(['botBounce', 'botNod', 'botJump', 'botSway']);
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
  const spin = h('div', { class: 'club-spin', 'aria-live': 'polite' }, h('span', {}, 'NOW SPINNING'), h('b'));
  const nowLabel = h('span');
  const nowTitle = h('strong');
  const nowMeta = h('small');
  const now = h('div', { class: 'club-now' }, nowLabel, nowTitle, nowMeta);
  const floor = h('div', { class: 'club-floor' });
  const el = h('section', { class: 'club-stage mood-groove' }, lights, flash, fx, djBox, spin, now, floor);

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

  function person(key, member, extra, style) {
    const sig = signature(member, extra, style);
    const known = nodes.get(key);
    if (known?.sig === sig) return known.node;
    const node = avatarNode(member, extra, style);
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
      djBox.prepend(oldNode);
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
      if (!reduced()) floor.querySelectorAll(':scope > .club-person:not(.ambient) .bot, :scope > .club-person.ambient:nth-child(odd) .bot').forEach((bot) =>
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

  function update({ members, hostId, current, label }) {
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
    const nextDjNode = person(`dj:${dj.id}`, dj, 'dj', '--turn:0deg');
    nextDjNode.dataset.id = dj.id;
    if (nextDjNode !== djNode) {
      prevNode?.remove();
      djBox.prepend(nextDjNode);
      djNode = nextDjNode;
    }
    djId = dj.id;
    if (prevDj && prevDj !== dj.id) handoff(prevNode, nextDjNode, dj.name);

    const ambient = Array.from({ length: Math.max(0, 14 - crowd.length) }, (_, i) =>
      normalizeMember({ name: '', shape: SHAPES[i % SHAPES.length], color: COLORS[(i + 2) % COLORS.length], gear: GEAR[i % GEAR.length] }));
    const keep = new Set([djNode.dataset.member]);
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
