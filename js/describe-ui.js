// "Describe it" box on Create + Studio: type or tap what you want, get a one-line receipt with undo.
import { h } from './ui.js';
import { parse, applyEdits, genreOf, suggest, chipsFor, mergeEdits, needsMix, mixAdjust, heard, validateEdits } from './describe.js';
import { privacyOptOut } from './analytics.js';
import { barsLabel } from './scope.js';

let last = null, hint = null, draft = '', recent = null, net = null, ticket = 0;
// Phrases the rules can't read go to /api/describe (an LLM limited to the app's own edits); [] if it's off.
async function askAI(text, style) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch('/api/describe', { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, style, log: !privacyOptOut(window) }) });
    return res.ok ? validateEdits((await res.json()).edits) : [];
  } catch { return []; } finally { clearTimeout(timer); }
}
const Speech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
const MIC = '<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
const SPEECH_ERR = { 'not-allowed': 'Microphone is blocked. Allow the mic for this site in your browser settings, then try again.', 'service-not-allowed': 'Speech input is turned off in this browser.',
  'audio-capture': 'No microphone found. Connect one and try again.', network: 'Speech input needs a connection. Type it instead:', 'no-speech': 'Didn’t catch that. Try again or type it:' };

// Renders two bars of the drop and measures each part; null if it fails or takes too long.
const listen = (state) => Promise.race([import('./mix-check.js').then((m) => m.measureMix(state)), new Promise((r) => setTimeout(() => r(null), 8000))]).catch(() => null);

// ctx: state(), style(), styleName(id), depth(), pushUndo(label), undo(), switchGenre(id, steer, label), commit(nextState), track(props),
// highlight(bars) (optional: shows which bars of the song a scoped edit changed)
export function describeBar(ctx) {
  const input = h('input', { class: 'describe-input', type: 'text', placeholder: 'Describe it: “darker and slower”', 'aria-label': 'Describe the change you want',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', maxlength: '140', oninput: () => { draft = input.value; } });
  input.value = draft;
  const receipt = h('div', { class: 'describe-receipt', 'aria-live': 'polite' });
  const chips = h('div', { class: 'describe-chips' }, chipsFor(ctx.style()).map((c) => h('button', { type: 'button', class: 'describe-chip', onclick: () => run(c) }, c)));
  const box = h('form', { class: 'describe', onsubmit: (e) => { e.preventDefault(); run(input.value); } },
    h('div', { class: 'describe-row' }, input, Speech ? mic() : null, h('button', { class: 'describe-go', type: 'submit' }, 'DO IT')), receipt, chips);
  paint();
  return box;

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
        receipt.append(h('div', { class: 'describe-where', role: 'img', title: `Changed ${barsLabel(last.bars)} of ${c.length}`, 'aria-label': `Changed ${barsLabel(last.bars)} of ${c.length}` },
          [...c].map((L, i) => h('i', { class: (on.has(i) ? 'on' : '') + (i && c[i - 1] !== L ? ' edge' : '') }))));
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
    const shown = new Set(chipsFor(ctx.style()).map((c) => c.toLowerCase()));
    hint = { note: why || `Not sure what “${text.slice(0, 40)}” means yet. Try:`, suggestions: suggest(text, 16).filter((x) => !shown.has(x.toLowerCase())).slice(0, 5) };
    paint();
  }

  function run(raw) {
    const text = String(raw || '').trim();
    if (!text) return input.focus();
    const style = ctx.style();
    const parsed = parse(text, { style, last: recent, net });
    const mine = ++ticket;
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
