// Studio arrangement view: the song chain as a lane of section blocks with a playhead.
// Reads and writes state.chain (and optional state.labels), so saves, share links and rooms are unchanged.
import { h } from './ui.js';
import {
  LETTERS, COLORS, toSections, toChain, totalBars, starts, locate, sectionNames, cleanLabel,
  move, resize, duplicate, remove, setPattern, append, dropIndex, loopSkip,
} from './timeline.js';

// o: { state, kind, playing, current, before, after, select, jump, setSong, track }
export function songTimeline(o) {
  let cache = { chain: null, sections: [] };
  let sel = 0, loopAt = null, drag = null, nowIdx = -1;
  let el = null, lane = null, ph = null;

  const sections = () => {
    const chain = o.state().chain;
    if (cache.chain !== chain) cache = { chain, sections: toSections(chain) };
    return cache.sections;
  };
  const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

  // Keep the selection and the loop on the same block through an edit.
  function follow(op, a, b, n) {
    const map = (x) => {
      if (x == null) return x;
      if (op === 'move') { const ids = [...Array(n).keys()]; const [m] = ids.splice(a, 1); ids.splice(Math.min(b, ids.length), 0, m); return ids.indexOf(x); }
      if (op === 'duplicate') return x > a ? x + 1 : x;
      if (op === 'delete') return x === a ? null : x > a ? x - 1 : x;
      return x;
    };
    sel = map(sel) ?? Math.max(0, Math.min(a, n - 2));
    loopAt = map(loopAt);
  }

  function commit(next, kind) {
    const st = o.state();
    const chain = toChain(next);
    if (chain === st.chain) { cache = { chain, sections: next }; render(); return; }
    o.before();
    st.chain = chain;
    cache = { chain, sections: next };
    o.after();
    render();
    o.track(kind);
  }

  function edit(op, i, arg) {
    const s = sections(), n = s.length;
    if (op === 'duplicate') { follow(op, i, 0, n); sel = i + 1; return commit(duplicate(s, i), op); }
    if (op === 'delete') { if (n < 2) return; follow(op, i, 0, n); return commit(remove(s, i), op); }
    if (op === 'length') return commit(resize(s, i, s[i].bars + arg), op);
    if (op === 'pattern') return commit(setPattern(s, i, arg), op);
    if (op === 'add') { sel = n; return commit(append(s, arg), op); }
  }

  function rename(i, value) {
    const st = o.state(), letter = LETTERS[sections()[i].p], name = cleanLabel(value);
    const def = sectionNames(sections(), o.kind(), {})[i];
    const labels = { ...(st.labels || {}) };
    if (!name || name === def) delete labels[letter]; else labels[letter] = name;
    if ((st.labels?.[letter] || '') === (labels[letter] || '')) return render();
    o.before();
    if (Object.keys(labels).length) st.labels = labels; else delete st.labels;
    o.after();
    render();
    o.track('rename');
  }

  function tap(i) {
    const s = sections();
    if (!s[i]) return;
    sel = i;
    if (o.playing()) {
      if (loopAt != null) loopAt = i;
      if (!o.state().chainOn) o.setSong(true);
      o.jump(starts(s)[i]);
    } else if (o.current() !== s[i].p) o.select(s[i].p);
    render();
  }

  function toggleLoop(i) {
    const s = sections();
    if (loopAt === i) { loopAt = null; render(); return; }
    loopAt = i;
    if (!o.state().chainOn) o.setSong(true);
    if (!o.playing()) o.jump(starts(s)[i]);
    o.track('loop');
    render();
  }

  function blockEl(s, i, names, total) {
    const letter = LETTERS[s.p];
    const b = h('div', {
      class: 'tl-block' + (i === sel ? ' pick' : '') + (i === loopAt ? ' loop' : '') + (i === nowIdx ? ' now' : ''),
      role: 'button', tabindex: '0', 'data-i': i,
      style: `--c:${COLORS[s.p]};--bars:${s.bars}`,
      title: `${names[i]} · pattern ${letter} · ${s.bars} bar${s.bars > 1 ? 's' : ''}. Tap to select or jump; drag to move; drag the right edge to change length.`,
      'aria-label': `${names[i]}, pattern ${letter}, ${s.bars} bars`,
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); tap(i); }
      },
    },
    h('span', { class: 'tl-name' }, names[i]),
    h('span', { class: 'tl-sub' }, letter, h('em', {}, ` · ${s.bars}`)),
    h('i', { class: 'tl-edge', 'aria-hidden': 'true' }));
    if (total) b.style.setProperty('--w', `${(s.bars / total) * 100}%`);
    return b;
  }

  function renderLane(list, { total = totalBars(list), lift = -1, shift = 0 } = {}) {
    if (!lane) return;
    const names = sectionNames(list, o.kind(), o.state().labels);
    const blocks = list.map((s, i) => {
      const b = blockEl(s, i, names, total);
      if (i === lift) { b.classList.add('lift'); b.style.transform = `translateX(${shift}px)`; }
      return b;
    });
    lane.replaceChildren(...blocks, ph);
  }

  function onDown(e) {
    const b = e.target.closest('.tl-block');
    if (!b || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const s = sections(), i = +b.dataset.i, total = totalBars(s);
    drag = { id: e.pointerId, i, x0: e.clientX, mode: e.target.closest('.tl-edge') ? 'resize' : 'press',
      barPx: lane.clientWidth / total, total, snap: s, work: s };
    lane.setPointerCapture(e.pointerId);
    if (drag.mode === 'resize') lane.classList.add('resizing');
    e.preventDefault();
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, { snap, i, barPx } = drag;
    if (drag.mode === 'press' && Math.abs(dx) > 6) { drag.mode = 'move'; lane.classList.add('dragging'); }
    if (drag.mode === 'resize') {
      const next = resize(snap, i, snap[i].bars + Math.round(dx / barPx));
      if (next[i].bars !== drag.work[i].bars) { drag.work = next; renderLane(next, { total: drag.total }); }
    } else if (drag.mode === 'move') {
      const centre = starts(snap)[i] + snap[i].bars / 2 + dx / barPx;
      const k = dropIndex(snap, i, centre);
      drag.work = move(snap, i, k);
      drag.k = k;
      const home = (starts(drag.work)[k] + snap[i].bars / 2) * barPx;
      renderLane(drag.work, { lift: k, shift: centre * barPx - home });
    }
  }

  function end(e, cancel) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    lane.classList.remove('dragging', 'resizing');
    if (lane.hasPointerCapture?.(d.id)) lane.releasePointerCapture(d.id);
    if (cancel) return renderLane(sections());
    if (d.mode === 'press') return tap(d.i);
    if (d.mode === 'move') { follow('move', d.i, d.k, d.snap.length); return commit(d.work, 'move'); }
    if (d.mode === 'resize') { sel = d.i; return commit(d.work, 'length'); }
  }

  function tools(s, names) {
    const i = Math.max(0, Math.min(sel, s.length - 1)), cur = s[i];
    if (!cur) return null;
    const letter = LETTERS[cur.p];
    const name = h('input', { class: 'tl-rename', value: names[i], maxlength: '16', spellcheck: 'false', 'aria-label': 'Section name',
      title: `Name every block that plays pattern ${letter}`,
      onchange: (e) => rename(i, e.target.value), onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); } });
    const pats = h('div', { class: 'tl-pats', role: 'group', 'aria-label': 'Pattern' },
      [...LETTERS].map((L, p) => h('button', { class: 'tl-pat' + (p === cur.p ? ' on' : ''), style: `--c:${COLORS[p]}`, title: `Play pattern ${L} here`,
        onclick: () => edit('pattern', i, p) }, L)));
    const len = h('div', { class: 'tl-len' },
      h('button', { class: 'btn ghost', 'aria-label': 'One bar shorter', onclick: () => edit('length', i, -1) }, '−'),
      h('span', {}, `${cur.bars} BAR${cur.bars > 1 ? 'S' : ''}`),
      h('button', { class: 'btn ghost', 'aria-label': 'One bar longer', onclick: () => edit('length', i, 1) }, '+'));
    if (cur.bars <= 1) len.firstChild.disabled = true;
    const loop = h('button', { class: 'btn toggle tl-loop' + (loopAt === i ? ' on' : ''), title: 'Repeat this section until you turn it off', onclick: () => toggleLoop(i) }, loopAt === i ? 'LOOPING' : 'LOOP');
    const del = h('button', { class: 'btn ghost', title: 'Remove this section', onclick: () => edit('delete', i) }, 'DELETE');
    if (s.length < 2) del.disabled = true;
    return h('div', { class: 'tl-tools' },
      h('div', { class: 'tl-field' }, name, pats),
      h('div', { class: 'tl-acts' }, len,
        h('button', { class: 'btn ghost', title: 'Copy this section right after itself', onclick: () => edit('duplicate', i) }, 'DUPLICATE'),
        del, loop));
  }

  function render() {
    if (!el) return el;
    const st = o.state(), s = sections(), n = totalBars(s);
    sel = Math.max(0, Math.min(sel, s.length - 1));
    if (loopAt != null && !s[loopAt]) loopAt = null;
    const names = sectionNames(s, o.kind(), st.labels);
    const seg = (on, label, val) => h('button', { class: 'tl-seg' + (on ? ' on' : ''), 'aria-pressed': String(on), onclick: () => { if (st.chainOn !== val) o.setSong(val); } }, label);
    lane = h('div', { class: 'tl-lane', style: `--total:${n}` });
    lane.addEventListener('pointerdown', onDown);
    lane.addEventListener('pointermove', onMove);
    lane.addEventListener('pointerup', (e) => end(e, false));
    lane.addEventListener('pointercancel', (e) => end(e, true));
    lane.addEventListener('lostpointercapture', (e) => end(e, true));
    ph = h('i', { class: 'tl-ph' });
    renderLane(s);
    el.classList.toggle('off', !st.chainOn);
    el.replaceChildren(
      h('div', { class: 'tl-head' },
        h('b', {}, 'SONG'),
        h('span', { class: 'tl-meta' }, `${n} BARS · ${fmt((n * 4 * 60) / (st.bpm || 120))}`),
        h('div', { class: 'tl-play seg', role: 'group', 'aria-label': 'Play' }, seg(st.chainOn, 'WHOLE SONG', true), seg(!st.chainOn, `LOOP ${LETTERS[o.current()] || 'A'}`, false))),
      h('div', { class: 'tl-row' }, lane,
        h('button', { class: 'tl-add', title: `Add 4 bars of pattern ${LETTERS[o.current()] || 'A'} at the end`, 'aria-label': 'Add a section', onclick: () => edit('add', 0, o.current() || 0) }, '+')),
      tools(s, names));
    return el;
  }

  return {
    mount() { el = h('section', { class: 'song-tl panel', 'aria-label': 'Song arrangement' }); nowIdx = -1; return render(); },
    refresh: render,
    frame(ev) {
      if (!ph?.isConnected) return;
      const s = sections(), n = totalBars(s);
      if (!ev || !o.state().chainOn || !n) {
        ph.style.display = 'none';
        if (nowIdx !== -1) { lane.querySelector('.tl-block.now')?.classList.remove('now'); nowIdx = -1; }
        return;
      }
      const pos = (ev.abs / 16) % n, at = locate(s, pos).index;
      ph.style.display = 'block';
      ph.style.left = `${(pos / n) * 100}%`;
      if (at !== nowIdx && !drag) {
        lane.querySelector('.tl-block.now')?.classList.remove('now');
        lane.querySelector(`.tl-block[data-i="${at}"]`)?.classList.add('now');
        nowIdx = at;
      }
    },
    skip(chainPos) {
      if (loopAt == null || !o.state().chainOn) return 0;
      return loopSkip(sections(), { first: loopAt, last: loopAt }, chainPos);
    },
  };
}
