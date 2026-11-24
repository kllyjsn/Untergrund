export const RHODES_STYLES = new Set(['neosoul', 'rnb', 'lofihiphop', 'jazzfunk']);

export function rhodesVoicing(notes) {
  if (!notes.length) return [];
  const shift = 12 * Math.max(0, Math.ceil((Math.max(...notes) - 68) / 12));
  const voiced = [...new Set(notes.map((n) => n - shift))].filter((n) => n >= 40).sort((a, b) => a - b);
  while (voiced.length > 1 && voiced[1] < 48) voiced.shift();
  return voiced;
}

export function rhodesFunkVoicing(notes) {
  if (!notes.length || notes.some((n) => !Number.isFinite(n))) return [];
  const voiced = [...new Set(notes.map((n) => n - 12 * Math.max(0, Math.ceil((n - 68) / 12))))]
    .filter((n) => n >= 40).sort((a, b) => a - b);
  while (voiced.length > 1 && voiced[1] < 48) voiced.shift();
  return voiced;
}

export function rhodesLineOctave(state) {
  const key = state.key > 6 ? state.key - 12 : state.key;
  const tops = [state.pattern, ...(state.patterns || [])].filter(Boolean).flatMap((p) => {
    const h = p.hook;
    if (!h || h.v !== 'tapekeys') return [];
    const notes = [...(h.s || []).filter(Boolean).map((n) => n[0]),
      ...['n', 'v', 'b'].flatMap((k) => (h.m?.[k] || []).map((n) => n[2]))];
    // Reserve the answer octave and the sequencer's resolving/developing notes.
    return notes.map((n) => 60 + key + (h.o || 0) * 12 + n + 19);
  });
  const top = Math.max(79, ...tops);
  return -12 * Math.max(0, Math.ceil((top - 68) / 12));
}

export function rhodesPhraseOctave(notes) {
  if (!notes.length || notes.some((n) => !Number.isFinite(n))) return null;
  const bottom = Math.min(...notes), top = Math.max(...notes);
  for (const [low, high] of [[48, 68], [82, 104]]) {
    const first = Math.ceil((low - bottom) / 12), last = Math.floor((high - top) / 12);
    if (first <= last) return 12 * Math.max(first, Math.min(0, last));
  }
  return null;
}

export function rhodesLoFiVoicing(notes) {
  if (!notes.length) return [];
  const shift = 12 * Math.max(0, Math.ceil((48 - Math.min(...notes)) / 12));
  const voiced = [...new Set(notes.map((n) => n + shift))].sort((a, b) => a - b);
  return voiced.at(-1) <= 68 ? voiced : null;
}

export function rhodesRnBVoicing(notes) {
  if (!notes.length) return [];
  if (notes.some((n) => !Number.isFinite(n))) return null;
  const shift = 12 * Math.max(0, Math.ceil((Math.max(...notes) - 68) / 12));
  const chord = [...new Set(notes.map((n) => n - shift))].sort((a, b) => a - b);
  const voiced = chord.filter((n) => n >= 52);
  for (const note of chord) {
    if (voiced.length >= 3) break;
    const raised = note + 12 * Math.max(1, Math.ceil((52 - note) / 12));
    if (raised <= 68 && !voiced.includes(raised)) voiced.push(raised);
  }
  return voiced.length >= 3 ? voiced.sort((a, b) => a - b) : null;
}

export function rhodesLoFiPhrase(notes) {
  if (!notes.length || notes.some((n) => !Number.isFinite(n))) return null;
  const bottom = Math.min(...notes), top = Math.max(...notes);
  if (bottom >= 82 && top <= 104) return { shift: 0, fm: false };
  const shift = 12 * Math.max(0, Math.ceil((60 - bottom) / 12));
  if (top + shift <= 68) return { shift, fm: false };
  return { shift: 12 * Math.max(0, Math.ceil((48 - bottom) / 12)), fm: true };
}
