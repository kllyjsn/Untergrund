// "Describe it" box on Create + Studio: type or tap what you want, get a one-line receipt with undo.
import { h } from './ui.js';
import { parse, applyEdits, genreOf, suggest, chipsFor, mergeEdits, needsMix, mixAdjust, heard, validateEdits } from './describe.js';
import { privacyOptOut } from './analytics.js';
import { isSongPrompt as isPlanPrompt, promptGenre, rulePlan, planEdits, planLyrics, validatePlan, lyricLines } from './song-plan.js';
import { cleanLyrics, splitLyrics, lyricTimeline, lyricLabels, lyricsText, LIMITS } from './lyrics.js';
import { barsLabel } from './scope.js';
import { isSongPrompt, localSpec, validateSpec, SONG_STYLES } from './song-spec.js';
import { KEYS } from './params.js';
import { STYLES } from './state.js';

let last = null, hint = null, draft = '', recent = null, net = null, ticket = 0;
let lyricsDraft = '', lyricsOpen = false, planOff = false, view = null;
// A song prompt goes to /api/song-plan (an env-gated LLM); null when it's off, slow or wrong, and the local rules plan instead.
async function askPlan(prompt, lyrics, style) {
  if (planOff || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch('/api/song-plan', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, lyrics, style }) });
    if (res.status === 501 || res.status === 404) planOff = true;
    if (!res.ok) return null;
    const lines = lyrics ? lyricLines(lyrics) : null;
    return validatePlan((await res.json()).plan, { lines: lines?.length ? lines : null });
  } catch { return null; } finally { clearTimeout(timer); }
}

// Lyrics view: the section the song is playing now, its current line lit. main.js calls this every bar.
export function syncLyrics(bar) {
  if (!view?.el.isConnected) return;
  const { lyrics, chain, chainOn, kind } = view.src();
  if (!lyrics?.sections.length) return;
  const key = `${chainOn ? chain : ''}|${kind}`;
  if (view.key !== key) { view.key = key; view.tl = chainOn ? lyricTimeline(chain, lyrics, { kind }) : []; }
  const at = bar == null || !view.tl.length ? { s: view.at?.s ?? 0, l: -1 } : view.tl[((bar % view.tl.length) + view.tl.length) % view.tl.length];
  const pos = at ? `${at.s}:${at.l}` : 'none';
  if (view.pos === pos) return;
  view.pos = pos;
  if (at) view.at = at;
  const s = at ? at.s : view.at?.s ?? 0;
  view.el.classList.toggle('rest', !at);
  view.sec.textContent = at ? lyricLabels(lyrics)[s] : 'INSTRUMENTAL';
  view.lines.replaceChildren(...lyrics.sections[s].lines.map((ln, i) => h('li', { class: at && i === at.l ? 'now' : '' }, ln.t)));
}
// Phrases the rules can't read go to /api/describe (an LLM limited to the app's own edits); [] if it's off.
async function askAI(text, style) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch('/api/describe', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style, log: !privacyOptOut(window) }) });
    return res.ok ? validateEdits((await res.json()).edits) : [];
  } catch { return []; } finally { clearTimeout(timer); }
}
// A whole song from one sentence: the server's model (or its rules, with no key) writes a validated spec;
// offline or on any error the same rules run here, so a song always arrives.
// hint: the plan rules' read of the prompt; a genre it names ("indie", "trap") and an explicit BPM win over the spec rules'.
async function askSong(text, style, hint = {}) {
  const local = () => {
    const sp = localSpec(text, { style }), pick = SONG_STYLES.includes(hint.genre) ? hint.genre : sp.style;
    return pick === sp.style && hint.bpm == null ? sp : validateSpec({ ...sp, style: pick, bpm: hint.bpm ?? sp.bpm }, { style: pick, prompt: text });
  };
  if (navigator.onLine === false) return local();
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
  try {
    const res = await fetch('/api/describe', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style, mode: 'song' }) });
    const body = res.ok ? await res.json() : null;
    return body?.spec && body.source !== 'rules' ? validateSpec(body.spec, { style: local().style, prompt: text }) : local();
  } catch { return local(); } finally { clearTimeout(timer); }
}
const Speech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
const MIC = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const SPEECH_ERR = { 'not-allowed': 'Microphone is blocked. Allow the mic for this site in your browser settings, then try again.', 'service-not-allowed': 'Speech input is turned off in this browser.',
  'audio-capture': 'No microphone found. Connect one and try again.', network: 'Speech input needs a connection. Type it instead:', 'no-speech': 'Didn’t catch that. Try again or type it:' };

// Renders two bars of the drop and measures each part; null if it fails or takes too long.
const listen = (state) => Promise.race([import('./mix-check.js').then((m) => m.measureMix(state)), new Promise((r) => setTimeout(() => r(null), 8000))]).catch(() => null);

// Before the first song, only whole-song prompts: edits like "darker" need a song to change.
const FIRST_CHIPS = ['A sunrise drive song', 'Dark techno for 3am', 'A breakup country song'];
const chipList = (ctx) => (ctx.fresh?.() ? FIRST_CHIPS : [songChip(ctx.style()), ...chipsFor(ctx.style())]);
const placeholder = (ctx) => (lyricsOpen ? 'Describe the song: “sad indie, female vocal, 90 bpm”' : ctx.fresh?.() ? 'Or describe a song' : `Try “${chipsFor(ctx.style())[0]}”`);
const songChip = (style) => (/CLASSICAL|JAZZ/.test(STYLE_FAMILY(style)) ? 'A late-night rainy track' : 'A sunrise drive song');
const STYLE_FAMILY = (id) => STYLES[id]?.family || '';
// ctx: state(), style(), styleName(id), depth(), pushUndo(label), undo(), switchGenre(id, steer, label), song(spec, label, done(title, key), lyrics), commit(nextState), track(props), kind(),
// prompted(text) (optional: the prompt the next switchGenre/song is written from, for listen signals)
// highlight(bars) (optional: shows which bars of the song a scoped edit changed)
export function describeBar(ctx) {
  const input = h('input', { class: 'describe-input', type: 'text', placeholder: placeholder(ctx), 'aria-label': 'Describe a song to write, or a change to this one',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', maxlength: '200', oninput: () => { draft = input.value; } });
  input.value = draft;
  const receipt = h('div', { class: 'describe-receipt', 'aria-live': 'polite' });
  const lyricsBox = h('textarea', { class: 'describe-lyrics-input', rows: '6', maxlength: String(LIMITS.text), 'aria-label': 'Lyrics', spellcheck: 'true',
    placeholder: 'Paste lyrics. Blank lines split sections; [Verse] and [Chorus] headers are optional.', oninput: () => { lyricsDraft = lyricsBox.value; } });
  lyricsBox.value = lyricsDraft;
  lyricsBox.hidden = !lyricsOpen;
  const lyricsChip = h('button', { type: 'button', class: 'describe-chip lyrics-chip' + (lyricsOpen ? ' on' : ''), 'aria-pressed': String(lyricsOpen), onclick: () => toggleLyrics() }, 'Lyrics');
  const chips = h('div', { class: 'describe-chips' }, lyricsChip, ...chipList(ctx).map((c) => h('button', { type: 'button', class: 'describe-chip', onclick: () => run(c) }, c)));
  const box = h('form', { class: 'describe', onsubmit: (e) => { e.preventDefault(); run(input.value); } },
    h('div', { class: 'describe-row' }, input, Speech ? mic() : null, h('button', { class: 'describe-go', type: 'submit' }, ctx.fresh?.() ? 'MAKE IT' : 'DO IT')), lyricsBox, receipt, lyricsView(), chips);
  paint();
  return box;

  function toggleLyrics(open = !lyricsOpen, text) {
    lyricsOpen = open;
    if (text != null) lyricsBox.value = lyricsDraft = text;
    lyricsBox.hidden = !open;
    lyricsChip.classList.toggle('on', open);
    lyricsChip.setAttribute('aria-pressed', String(open));
    input.placeholder = placeholder(ctx);
    if (open) lyricsBox.focus();
  }

  function lyricsView() {
    const lyrics = ctx.state().lyrics;
    if (!lyrics?.sections?.length) { view = null; return null; }
    const sec = h('b', { class: 'describe-lyrics-sec' });
    const lines = h('ol', { class: 'describe-lyrics-lines' });
    const meta = [lyrics.vocal && `${lyrics.vocal.toUpperCase()} VOCAL`, 'NOT SUNG YET'].filter(Boolean).join(' · ');
    const el = h('div', { class: 'describe-lyrics', 'aria-label': 'Lyrics' },
      h('div', { class: 'describe-lyrics-head' }, sec, h('span', { class: 'describe-lyrics-meta' }, meta),
        h('button', { type: 'button', class: 'describe-undo', onclick: () => { input.value = draft = ''; toggleLyrics(true, lyricsText(ctx.state().lyrics)); } }, 'EDIT')),
      lines);
    view = { el, sec, lines, src: () => { const st = ctx.state(); return { lyrics: st.lyrics, chain: st.chain, chainOn: st.chainOn, kind: ctx.kind?.() || 'club' }; } };
    // Painted once the element is in the page.
    queueMicrotask(() => syncLyrics(null));
    return el;
  }

  // Say it: the browser's speech recognition fills the box as you talk and runs what it heard.
  function mic() {
    let rec = null;
    const btn = h('button', { type: 'button', class: 'describe-mic', 'aria-label': 'Say it', title: 'Say it', 'aria-pressed': 'false', onclick: () => (rec ? rec.stop() : start()) });
    btn.innerHTML = MIC;
    const done = () => { rec = null; btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); };
    function start() {
      try { rec = new Speech(); } catch { return miss('', 'Speech input isn’t available here. Type it instead:'); }
      Object.assign(rec, { lang: navigator.language || 'en-US', interimResults: true, maxAlternatives: 4, continuous: false });
      let final = null;
      rec.onresult = (e) => {
        const res = e.results[e.results.length - 1];
        input.value = draft = [...e.results].map((r) => r[0].transcript).join(' ').trim();
        if (res.isFinal) final = [...res].map((a) => a.transcript);
      };
      rec.onerror = (e) => { final = null; done(); if (e.error !== 'aborted') miss('', SPEECH_ERR[e.error] || 'Couldn’t hear that. Type it instead:'); };
      rec.onend = () => { done(); if (!final) return; const text = heard(final) || final[0]; input.value = draft = text; run(text); };
      btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true');
      hint = { note: 'Listening… say what you want to change', suggestions: [] }; paint();
      try { rec.start(); } catch { done(); }
    }
    return btn;
  }

  function paint() {
    receipt.replaceChildren();
    // A receipt only offers undo while its change is still the latest one.
    const live = last && last.depth === ctx.depth();
    receipt.hidden = !live && !hint;
    if (live) {
      receipt.append(h('div', { class: 'describe-line' }, h('span', { class: 'describe-did' }, h('b', {}, 'Did: '), last.did.join(', '), last.miss ? h('em', {}, ` · skipped “${last.miss}”`) : null),
        h('button', { type: 'button', class: 'describe-undo', onclick: () => { last = hint = recent = net = null; ctx.undo(); } }, 'UNDO')));
      // Where it landed: one cell per bar of the song, the changed ones lit.
      if (last.bars && last.chain === ctx.state().chain) {
        const on = new Set(last.bars), c = last.chain;
        receipt.append(h('div', { class: 'describe-line describe-at' },
          h('div', { class: 'describe-where', role: 'img', 'aria-label': `Changed ${barsLabel(last.bars)} of ${c.length}` },
            [...c].map((L, i) => h('i', { class: (on.has(i) ? 'on' : '') + (i && c[i - 1] !== L ? ' edge' : '') }))),
          h('span', { class: 'describe-note', 'aria-hidden': 'true' }, `${barsLabel(last.bars)} of ${c.length}`)));
      }
      const nudges = recent?.some((e) => e.amt != null) ? ['more', 'too much', 'other way'] : recent?.some((e) => e.id === 'mute') ? ['other way'] : [];
      if (nudges.length) receipt.append(h('div', { class: 'describe-line' }, ...nudges.map((s) => h('button', { type: 'button', class: 'describe-chip sm', onclick: () => run(s) }, s))));
    }
    if (hint) {
      receipt.append(h('div', { class: 'describe-line' }, h('span', { class: 'describe-note' }, hint.note),
        ...hint.suggestions.map((s) => h('button', { type: 'button', class: 'describe-chip sm', onclick: () => run(s) }, s))));
    }
  }

  function miss(text, why) {
    const shown = new Set(chipList(ctx).map((c) => c.toLowerCase()));
    hint = { note: why || `Not sure what “${text.slice(0, 40)}” means yet. Try:`, suggestions: suggest(text, 16).filter((x) => !shown.has(x.toLowerCase())).slice(0, 5) };
    paint();
  }

  function run(raw) {
    const text = String(raw || '').trim();
    const words = lyricsOpen ? lyricsDraft.trim() : '';
    if (!text && words) return ctx.state().lyrics ? relyric(words) : runPlan('', words);
    if (!text) return input.focus();
    if (words) return runPlan(text, words);
    const style = ctx.style();
    const mine = ++ticket;
    if (ctx.song && (isSongPrompt(text, { style }) || isPlanPrompt(text))) return song(text, style, mine);
    if (isPlanPrompt(text)) return runPlan(text, '');
    const parsed = parse(text, { style, last: recent, net });
    if (!parsed.edits.length) {
      if (navigator.onLine === false || /^(?:more|again|less|too much|other way|undo\b)/.test(text.toLowerCase())) return miss(text);
      hint = { note: 'Thinking…', suggestions: [] };
      paint();
      return askAI(text, style).then((edits) => {
        if (mine !== ticket) return;
        hint = null;
        if (!edits.length) return miss(text);
        apply(text, style, { edits, unknown: [] }, []);
      });
    }
    if (!genreOf(parsed.edits, style) && needsMix(parsed.edits)) {
      hint = { note: 'Listening to the mix…', suggestions: [] };
      paint();
      const before = ctx.state();
      return listen(before).then((m) => {
        if (mine !== ticket) return;
        hint = null;
        const r = m ? mixAdjust(parsed.edits, m, before) : { edits: parsed.edits, notes: [] };
        apply(text, style, { ...parsed, edits: r.edits }, r.notes);
      });
    }
    apply(text, style, parsed, []);
  }

  // Edited lyrics on the song that's already playing: just the words change.
  function relyric(words) {
    const lyrics = cleanLyrics({ ...ctx.state().lyrics, sections: splitLyrics(words) });
    if (!lyrics?.sections.length) return miss('', 'No lyric lines in there. Paste a verse or two:');
    ctx.pushUndo('LYRICS');
    hint = recent = net = null;
    lyricsDraft = ''; toggleLyrics(false, '');
    last = { did: [`lyrics: ${lyrics.sections.reduce((n, s) => n + s.lines.length, 0)} lines`], miss: '', depth: ctx.depth() };
    ctx.commit({ ...ctx.state(), lyrics });
    ctx.track({ kind: 'lyrics', genre: ctx.style() });
  }

  // "sad indie song about leaving LA, female vocal, 90 bpm" (and/or pasted lyrics) -> a whole new song.
  function runPlan(text, words) {
    const style = ctx.style(), mine = ++ticket;
    hint = { note: words ? 'Reading your lyrics…' : 'Planning the song…', suggestions: [] };
    paint();
    askPlan(text, words, style).then((remote) => {
      if (mine !== ticket) return;
      let plan = remote, via = 'ai';
      if (!plan) { plan = rulePlan(text, words, { style }); via = 'rules'; }
      else if (words && !plan.lyrics.length) plan.lyrics = splitLyrics(words);
      hint = null;
      if (!plan) return miss(text);
      applyPlan(text, plan, via);
    });
  }

  function applyPlan(text, plan, via) {
    const edits = planEdits(plan), seed = (Math.random() * 1e9) | 0;
    const src = text || plan.lyrics[0]?.lines[0]?.t || 'lyrics';
    const label = `“${src.length > 32 ? src.slice(0, 31) + '…' : src}”`;
    hint = recent = net = null;
    draft = ''; lyricsDraft = '';
    lyricsOpen = false;
    ctx.prompted?.(text || plan.lyrics[0]?.lines[0]?.t || '');
    ctx.switchGenre(plan.style, (s) => {
      const r = applyEdits(s, edits, { seed, style: plan.style });
      const lyrics = cleanLyrics(planLyrics(plan, text));
      if (lyrics) r.state.lyrics = lyrics; else delete r.state.lyrics;
      if (plan.title && r.state.artist) r.state.artist.title = plan.title;
      const lines = lyrics?.sections.reduce((n, x) => n + x.lines.length, 0) || 0;
      last = { did: [`new ${ctx.styleName(plan.style)} song`, ...r.did, ...(lines ? [`${lines} lyric lines`] : []), ...(plan.vocal ? [`${plan.vocal} vocal (not sung yet)`] : [])], miss: '', depth: ctx.depth() };
      return r.state;
    }, label);
    ctx.track({ kind: 'song_plan', genre: plan.style, via });
  }

  function song(text, style, mine) {
    hint = { note: 'Writing the song…', suggestions: [] };
    paint();
    // The plan rules read words the spec rules don't ("indie", "female vocal"); the vocal is kept for the singer.
    const plan = rulePlan(text, '', { style }), meta = plan ? cleanLyrics(planLyrics(plan, text)) : null;
    return askSong(text, style, { genre: promptGenre(text), bpm: plan?.bpm }).then((spec) => {
      if (mine !== ticket) return;
      hint = null; draft = ''; recent = null; net = null;
      const label = `“${text.length > 32 ? text.slice(0, 31) + '…' : text}”`;
      const bars = spec.sections.reduce((a, x) => a + x.bars, 0);
      ctx.prompted?.(text);
      ctx.song(spec, label, (title, key) => {
        last = { did: [`new ${ctx.styleName(spec.style)} song “${title}”`, `${spec.sections.length} sections, ${bars} bars, ${spec.bpm} BPM in ${KEYS[key]} ${spec.scale}`, ...(meta?.vocal ? [`${meta.vocal} vocal (not sung yet)`] : [])], miss: '', depth: ctx.depth() };
      }, meta);
      ctx.track({ kind: 'song', genre: spec.style });
    });
  }

  function apply(text, style, { edits, unknown, next, follow }, notes) {
    const genre = genreOf(edits, style), seed = (Math.random() * 1e9) | 0;
    const label = `“${text.length > 32 ? text.slice(0, 31) + '…' : text}”`;
    hint = null;
    draft = '';
    // "more", "too much", "the other way" act on this next time.
    const remember = () => {
      // A measured dB belongs to this receipt only; follow-ups measure again.
      const fresh = (list) => list.filter((e) => e.id !== 'genre').map(({ db, ...e }) => e);
      recent = fresh(next || edits);
      net = fresh(mergeEdits([...(follow && net ? net : []), ...edits]));
    };
    // `last` is set before the page rebuilds so the new box paints this receipt.
    if (genre) {
      // The rest of the edits land on the new song before it is played and saved to the CRATE.
      ctx.switchGenre(genre, (s) => {
        const r = applyEdits(s, edits, { seed, style: genre });
        last = { did: [`new ${ctx.styleName(genre)} track`, ...r.did], miss: unknown.join(', '), depth: ctx.depth() };
        remember();
        return r.state;
      }, label);
    } else {
      const r = applyEdits(ctx.state(), edits, { seed, style });
      if (!r.did.length) return miss(text, r.skipped.length ? `Nothing to change: ${r.skipped.map((s) => s.replace(' (already there)', ' already')).join(', ')}. Try:` : 'It already sounds like that. Try:');
      ctx.pushUndo(label);
      remember();
      last = { did: [...r.did, ...notes], miss: unknown.join(', '), depth: ctx.depth(), ...(r.bars?.length ? { bars: r.bars, chain: r.state.chain } : {}) };
      ctx.commit(r.state);
      if (r.bars?.length) ctx.highlight?.(r.bars);
    }
    ctx.track({ kind: genre ? 'genre' : edits[0].id, genre: genre || style });
  }
}
