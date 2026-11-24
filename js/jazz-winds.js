import { WIND_PEAKS } from './jazz-wind-data.js';
import { jazzNotches } from './jazz.js';

export const TRUMPET_BANKS = ['jtv1', 'jtv2', ...[1, 2, 3].flatMap((v) => [1, 2].map((rr) => `jts${v}${rr}`))];
export const HARMON_BANKS = ['jhm1', 'jhm3'];
export const FLUTE_BANKS = ['jfl', 'jflb'];
export const windBanks = (voice, style) => voice === 'tpt' ? TRUMPET_BANKS : voice === 'harmon' ? HARMON_BANKS : voice === 'airflute' ? style === 'bossa' ? ['jfl'] : FLUTE_BANKS : [];
export const trumpetStaccatoLayer = (velocity, duration) => duration <= .26 ? velocity < .48 ? 1 : velocity < .75 ? 2 : 3 : null;
const BOSSA_TRUMPET_PEAKS = { jtv2: { 67: [[2739, 40, -27], [3131, 40, -27]] } };
export const windNotches = (bank, midi, rate = 1, style) => Number.isFinite(rate) && rate > 0 ? [...(WIND_PEAKS[bank]?.[Math.round(midi)] || []), ...(style === 'bossa' ? BOSSA_TRUMPET_PEAKS[bank]?.[Math.round(midi)] || [] : [])].map(([f, q, db]) => [f * rate, q, db]) : [];
const BOSSA_FLUTE_DEPTHS = { 69: { 2644: -3 } };
const BOSSA_TRUMPET_LEVELS = { jtv1: { 65: -3.2 } };
export const bossaFluteNotches = (midi, rate = 1) => Number.isFinite(rate) && rate > 0 ? jazzNotches('fl', midi).flatMap(([f, q, db]) => {
  const gain = BOSSA_FLUTE_DEPTHS[Math.round(midi)]?.[f] ?? db;
  return gain < 0 ? [[f * rate, q, gain]] : [];
}) : [];

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
  const balance = style === 'bossa' ? 10 ** ((BOSSA_TRUMPET_LEVELS[bank]?.[Math.round(center)] ?? 0) / 20) : 1;
  let out = e.trimOut(`hook-${voice}`, 1, e.hookBus || e.windDuck, -4, 500);
  if (bossa) out = e.bodyFor(e.bodyFor(out, [2950, .8, 6.2]), [780, 1.2, -2.5]);
  e.playBuf(buffer, t, (flute ? 1.02 : muted ? .48 : .4) * touch * mix * balance, out, rate, Math.max(.06, duration * .92), {
    peaks: bossa ? bossaFluteNotches(center, rate) : windNotches(bank, center, rate, style),
    fade: short ? .004 : flute ? .008 : .015,
    attackGain: strong ? 1.02 : .94,
    release: short ? .07 : .055, ringOut: !short,
  });
  return true;
}
