export const RHODES_STYLES = new Set(['neosoul', 'rnb', 'lofihiphop', 'jazzfunk']);

export function rhodesVoicing(notes) {
  if (!notes.length) return [];
  const shift = 12 * Math.max(0, Math.ceil((Math.max(...notes) - 68) / 12));
  const voiced = [...new Set(notes.map((n) => n - shift))].filter((n) => n >= 40).sort((a, b) => a - b);
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
