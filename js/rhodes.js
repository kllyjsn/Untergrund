export const RHODES_STYLES = new Set(['neosoul', 'rnb', 'lofihiphop', 'jazzfunk']);

export function rhodesVoicing(notes) {
  if (!notes.length) return [];
  const top = Math.max(...notes), shift = top >= 69 && top <= 81 ? -12 : 0;
  const folded = [...new Set(notes.map((n) => {
    n += shift;
    while (n >= 69 && n <= 81) n -= 12;
    return n;
  }))].sort((a, b) => a - b);
  // Keep the top voice; octave-displace lower voices that would crowd it.
  const placed = [], ceiling = Math.min(104, folded.at(-1));
  for (const note of folded.reverse()) {
    const options = [];
    for (let n = ((note % 12) + 12) % 12 + 24; n <= ceiling; n += 12) {
      if (n >= 28 && (n <= 68 || n >= 82)) options.push(n);
    }
    options.sort((a, b) => Math.abs(a - note) - Math.abs(b - note) || a - b);
    const pick = options.find((n) => placed.every((p) => Math.abs(n - p) >= 3))
      ?? options.find((n) => placed.every((p) => Math.abs(n - p) >= 2));
    if (pick != null) placed.push(pick);
  }
  return placed.sort((a, b) => a - b);
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
