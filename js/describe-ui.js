// "Describe it" box on Create + Studio: type or tap what you want, get a one-line receipt with undo.
import { h } from './ui.js';
import { parse, applyEdits, genreOf, suggest, chipsFor } from './describe.js';

let last = null, hint = null, draft = '';

// ctx: state(), style(), styleName(id), depth(), pushUndo(), undo(), switchGenre(id), commit(nextState), track(props)
export function describeBar(ctx) {
  const input = h('input', { class: 'describe-input', type: 'text', placeholder: 'Describe it: “darker and slower”', 'aria-label': 'Describe the change you want',
    autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', maxlength: '140', oninput: () => { draft = input.value; } });
  input.value = draft;
  const receipt = h('div', { class: 'describe-receipt', 'aria-live': 'polite' });
  const chips = h('div', { class: 'describe-chips' }, chipsFor(ctx.style()).map((c) => h('button', { type: 'button', class: 'describe-chip', onclick: () => run(c) }, c)));
  const box = h('form', { class: 'describe', onsubmit: (e) => { e.preventDefault(); run(input.value); } },
    h('div', { class: 'describe-row' }, input, h('button', { class: 'describe-go', type: 'submit' }, 'DO IT')), receipt, chips);
  paint();
  return box;

  function paint() {
    receipt.replaceChildren();
    // A receipt only offers undo while its change is still the latest one.
    const live = last && last.depth === ctx.depth();
    receipt.hidden = !live && !hint;
    if (live) {
      receipt.append(h('div', { class: 'describe-line' }, h('span', { class: 'describe-did' }, h('b', {}, 'Did: '), last.did.join(', '), last.miss ? h('em', {}, ` · skipped “${last.miss}”`) : null),
        h('button', { type: 'button', class: 'describe-undo', onclick: () => { last = hint = null; ctx.undo(); } }, 'UNDO')));
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
    const { edits, unknown } = parse(text, { style });
    if (!edits.length) return miss(text);
    const genre = genreOf(edits, style), seed = (Math.random() * 1e9) | 0;
    hint = null;
    draft = '';
    // `last` is set before the page rebuilds so the new box paints this receipt.
    if (genre) {
      // The rest of the edits land on the new song before it is played and saved to the CRATE.
      ctx.switchGenre(genre, (s) => {
        const r = applyEdits(s, edits, { seed });
        last = { did: [`new ${ctx.styleName(genre)} track`, ...r.did], miss: unknown.join(', '), depth: ctx.depth() };
        return r.state;
      });
    } else {
      const r = applyEdits(ctx.state(), edits, { seed });
      if (!r.did.length) return miss(text, `Nothing to change: ${r.skipped.map((s) => s.replace(' (already there)', '')).join(', ')} already. Try:`);
      ctx.pushUndo();
      last = { did: r.did, miss: unknown.join(', '), depth: ctx.depth() };
      ctx.commit(r.state);
    }
    ctx.track({ kind: genre ? 'genre' : edits[0].id, genre: genre || style });
  }
}
