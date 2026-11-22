const roll = (n, k) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

export const ROOT_LAYERS = {
  fiddle: ['fiddlesoft', 'fiddlestac', 'fiddlestacsoft', 'fiddlestacb', 'fiddlestacsoftb'],
  upright: ['uprightsoft', 'uprighthard'],
};

export function cleanRoots(r) {
  if (!r || !['country', 'boombap', 'lofihiphop'].includes(r.style)) return null;
  if (r.style === 'country') return {
    style: r.style, seed: Number.isFinite(r.seed) ? r.seed | 0 : 0,
    ...(['fiddle', 'twang'].includes(r.hook) ? { hook: r.hook } : {}),
    ...(r.answer === 'fiddle' ? { answer: 'fiddle' } : {}),
  };
  return r.chord === 'upright' ? { style: r.style, chord: 'upright' } : null;
}

export function rootsTags(style, seed, voice, hook) {
  if (style === 'country' && hook && !['chop', 'oboe', 'airflute', 'tpt', 'harpplk'].includes(hook.v)) {
    return { style, seed: seed | 0, hook: roll(seed | 0, 281) < .5 ? 'fiddle' : 'twang', answer: 'fiddle' };
  }
  if (['boombap', 'lofihiphop'].includes(style) && Math.round(voice) === 7) return { style, chord: 'upright' };
  return null;
}

// Like pattern.jazz, the saved playing pattern carries its style independently of the listener's project.
export function rootsFor(state, pattern = state?.patterns?.[state.current || 0]) {
  const r = cleanRoots(pattern?.roots);
  const style = pattern?.jazz?.style ?? pattern?.roots?.style ?? state?.artist?.style;
  return !pattern?.score && r?.style === style ? r : null;
}

export function rootsPitch(m, lo, hi) {
  while (m > hi + .5) m -= 12;
  while (m < lo - .5) m += 12;
  return m;
}

export const fiddlePitch = (m) => rootsPitch(m, 55, 79);
export const fiddleDuration = (dur) => Math.max(.08, Math.min(3, dur));
export const fiddleRole = (r, expression) => r?.hook === 'fiddle' || (r?.answer === 'fiddle' && expression?.role === 'fiddle-answer');
export const fiddleAnswerRoll = (r, bar) => r?.answer === 'fiddle' && bar % 4 === 3 && roll(Math.floor(bar / 4) + r.seed, 293) < .25;

export function uprightNotes(t, v, iv, root, p) {
  if (!Array.isArray(iv) || !Number.isFinite(root) || !Number.isFinite(t) || !(v > 0)) return [];
  const pitches = [...new Set(iv.filter(Number.isFinite).map((n) => rootsPitch(root + n, 45, 79)))];
  return pitches.map((m, i) => ({ t: t + i * .003, m, dur: Math.min(3, Math.max(1.2, p.decay * 4)), v: v / Math.sqrt(pitches.length) }));
}
