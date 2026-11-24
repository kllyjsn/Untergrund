import { WIND_PEAKS } from './jazz-wind-data.js';
import { jazzNotches } from './jazz.js';

export const TRUMPET_BANKS = ['jtv1', 'jtv2', ...[1, 2, 3].flatMap((v) => [1, 2].map((rr) => `jts${v}${rr}`))];
export const HARMON_BANKS = ['jhm1', 'jhm3'];
export const FLUTE_BANKS = ['jfl', 'jflb'];
export const windBanks = (voice, style) => voice === 'tpt' ? TRUMPET_BANKS : voice === 'harmon' ? HARMON_BANKS : voice === 'airflute' ? style === 'bossa' ? ['jfl'] : FLUTE_BANKS : [];
export const trumpetStaccatoLayer = (velocity, duration) => duration <= .26 ? velocity < .48 ? 1 : velocity < .75 ? 2 : 3 : null;
const BOSSA_TRUMPET_PEAKS = { jtv2: { 67: [[2739, 40, -27], [3131, 40, -27]] } };
const WIND_TAKE_PEAKS = { jtv2: { 60: [[2611, 60, -18]], 65: [[2812, 60, -12]], 77: [[2795, 60, -12]] }, jts21: { 74: [[2929, 60, -18]] }, jfl: { 69: [[2631, 60, -6]] } };
const takePeaks = (bank, midi) => WIND_TAKE_PEAKS[bank]?.[Math.round(midi)] || [];
export const windNotches = (bank, midi, rate = 1, style) => Number.isFinite(rate) && rate > 0 ? [...(WIND_PEAKS[bank]?.[Math.round(midi)] || []), ...takePeaks(bank, midi), ...(style === 'bossa' ? BOSSA_TRUMPET_PEAKS[bank]?.[Math.round(midi)] || [] : [])].map(([f, q, db]) => [f * rate, q, db]) : [];
const BOSSA_FLUTE_DEPTHS = { 69: { 2644: -3 } };
const BOSSA_FLUTE_PEAKS = { 64: [[2301.5, 60, -10]] };
const BOSSA_TRUMPET_LEVELS = { jtv1: { 65: -3.2 } };
export const bossaFluteNotches = (midi, rate = 1) => Number.isFinite(rate) && rate > 0 ? jazzNotches('fl', midi).flatMap(([f, q, db]) => {
  const gain = BOSSA_FLUTE_DEPTHS[Math.round(midi)]?.[f] ?? db;
  return gain < 0 ? [[f * rate, q, gain]] : [];
}).concat([...takePeaks('jfl', midi), ...(BOSSA_FLUTE_PEAKS[Math.round(midi)] || [])].map(([f, q, db]) => [f * rate, q, db])) : [];

const WIND_TONES = {
  swing: { tpt: { body: [[1800, 1.2, 4.3], [2050, 4, -8.4], [2800, 4, -6.87], [3600, 1.4, -.68]], shelves: [[2600, -11.31], [5000, -13.8]] } },
  modal: { tpt: { body: [[1800, 1.2, -.46], [2050, 4, -16.17], [2300, 1.4, 16], [2800, 4, 11.23], [3600, 1.4, -16.37]], shelves: [[2600, -3.09], [5000, -21.81]] } },
  bossa: {
    tpt: { body: [[1800, 1.2, 3.83], [2050, 4, -15.02], [2300, 1.4, 2.18], [2800, 4, 5.13], [3600, 1.4, -4.13]], shelves: [[2600, -10.71], [5000, -15.58]] },
    airflute: { body: [[2050, 4, 1.35], [2300, 1.4, -.53], [2800, 4, 1.16], [3600, 1.4, 3.25]], shelves: [[2600, -1.39], [5000, -3.8]] },
  },
  jazzfunk: { tpt: { body: [[1800, 1.2, -2.97], [2050, 4, -7.34], [2300, 1.4, 13.69], [2800, 4, -7.78], [3600, 1.4, -11.3]], shelves: [[2600, -9.17], [5000, -28.25]] } },
};
const JAZZFUNK_BODY = [[1200, .9, -1.64], [1800, 1.2, 3.21], [2300, 1.4, -1.31], [2800, 4, -3.99], [3600, 1.4, -2.5]];
export const windTone = (style, voice, short = false, bank, root) => {
  const voices = Object.hasOwn(WIND_TONES, style) ? WIND_TONES[style] : null;
  const tone = voices && Object.hasOwn(voices, voice) ? voices[voice] : null;
  return tone ? { body: [...tone.body, ...(style === 'jazzfunk' ? [[2000, .9, short ? -3 : 1], ...JAZZFUNK_BODY, ...(bank === 'jtv2' && Number.isFinite(root) && Math.round(root) === 77 ? [[900, .7, 5.04]] : [])] : [])], shelves: tone.shelves, fade: voice === 'airflute' ? .012 : .028 } : null;
};

export function recordedJazzWind(e, t, v, midi, duration, voice, strong, { take = 0, harm = false, style }, mix) {
  const bossa = style === 'bossa' && voice === 'airflute';
  const banks = windBanks(voice, style), sets = banks.map((bank) => e.rec(bank));
  if (!banks.length || sets.some((set) => !set?.length)) return false;
  const touch = Math.max(0, Math.min(1, v));
  const velocity = Math.max(0, Math.min(1, v / 1.3));
  const flute = voice === 'airflute', muted = voice === 'harmon';
  const layer = !flute && !muted ? trumpetStaccatoLayer(velocity, duration) : null;
  const short = layer != null;
  const rr = (((Number.isFinite(take) ? Math.trunc(take) : 0) + (harm ? 1 : 0)) % 2 + 2) % 2;
  const bank = flute ? FLUTE_BANKS[!bossa && rr && duration <= .85 ? 1 : 0] : muted ? HARMON_BANKS[velocity < .68 ? 0 : 1] : short ? `jts${layer}${rr + 1}` : `jtv${velocity < .68 ? 1 : 2}`;
  const set = sets[banks.indexOf(bank)];
  const distance = ([pitch]) => Math.abs((bossa ? Math.round(pitch) : pitch) - midi);
  const [center, buffer] = set.reduce((a, b) => distance(b) < distance(a) ? b : a);
  const rate = 2 ** ((midi - center) / 12);
  const balance = style === 'bossa' ? 10 ** ((BOSSA_TRUMPET_LEVELS[bank]?.[Math.round(center)] ?? 0) / 20) : style === 'jazzfunk' && voice === 'tpt' ? 10 ** (2 / 20) : 1;
  let out = e.trimOut(`hook-${voice}`, 1, e.hookBus || e.windDuck, -4, 500);
  if (bossa) out = e.bodyFor(e.bodyFor(out, [2950, .8, 6.2]), [780, 1.2, -2.5]);
  const tone = windTone(style, voice, short, bank, center);
  for (const band of tone?.body || []) out = e.bodyFor(out, band);
  e.playBuf(buffer, t, (flute ? 1.02 : muted ? .48 : .4) * touch * mix * balance, out, rate, Math.max(.06, duration * .92), {
    ...(tone ? { shelves: tone.shelves } : {}),
    peaks: bossa ? bossaFluteNotches(center, rate) : windNotches(bank, center, rate, style),
    fade: tone?.fade ?? (short ? .004 : flute ? .008 : .015),
    attackGain: strong ? 1.02 : .94,
    release: short ? .07 : .055, ringOut: !short,
  });
  return true;
}
