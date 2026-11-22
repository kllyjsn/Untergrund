import { KEYS } from './params.js';
import { STYLES } from './state.js';

export function autoTags(state, style, key = `${KEYS[state.key]} ${state.scale || 'minor'}`) {
  const genre = STYLES[style];
  return [...new Set([genre?.name.toLowerCase(), genre?.family.toLowerCase(), 'independent music',
    `${state.bpm} bpm`, key, state.artist?.name?.toLowerCase(), 'untergrund'].filter(Boolean))];
}

export function autoDescription(state, style, bars, key = `${KEYS[state.key]} ${state.scale || 'minor'}`) {
  const genre = STYLES[style]?.name || 'Electronic music';
  return [`${genre} · ${state.bpm} BPM · ${key} · ${bars} bars.`,
    '', 'Made in UNTERGRUND from its own synths and royalty-free (CC0) recorded instruments.',
    ...(state.patterns?.some((p) => p.score?.piece) ? [`Composition: ${state.artist?.title || ''}.`] : []),
    '', 'A new track daily. Listen and make your own at https://www.untergrund.sh'].join('\n');
}
