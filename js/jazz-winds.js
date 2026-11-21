import { WIND_PEAKS } from './jazz-wind-data.js';

export const TRUMPET_BANKS = ['jtv1', 'jtv2', ...[1, 2, 3].flatMap((v) => [1, 2].map((rr) => `jts${v}${rr}`))];
export const HARMON_BANKS = ['jhm1', 'jhm3'];
export const FLUTE_BANKS = ['jfl', 'jflb'];
export const windBanks = (voice) => voice === 'tpt' ? TRUMPET_BANKS : voice === 'harmon' ? HARMON_BANKS : voice === 'airflute' ? FLUTE_BANKS : [];
export const windNotches = (bank, midi, rate = 1) => Number.isFinite(rate) && rate > 0 ? (WIND_PEAKS[bank]?.[Math.round(midi)] || []).map(([f, q, db]) => [f * rate, q, db]) : [];

export function recordedJazzWind(e, t, v, midi, duration, voice, strong, { take = 0, harm = false }, mix) {
  const banks = windBanks(voice), sets = banks.map((bank) => e.rec(bank));
  if (!banks.length || sets.some((set) => !set?.length)) return false;
  const touch = Math.max(0, Math.min(1, v));
  const velocity = Math.max(0, Math.min(1, v / 1.3));
  const flute = voice === 'airflute', muted = voice === 'harmon';
  const short = !flute && !muted && duration <= .26;
  const rr = (((Number.isFinite(take) ? Math.trunc(take) : 0) + (harm ? 1 : 0)) % 2 + 2) % 2;
  const bank = flute ? FLUTE_BANKS[rr && duration <= .85 ? 1 : 0] : muted ? HARMON_BANKS[velocity < .68 ? 0 : 1] : short ? `jts${velocity < .48 ? 1 : velocity < .75 ? 2 : 3}${rr + 1}` : `jtv${velocity < .68 ? 1 : 2}`;
  const set = sets[banks.indexOf(bank)];
  const [center, buffer] = set.reduce((a, b) => Math.abs(b[0] - midi) < Math.abs(a[0] - midi) ? b : a);
  const rate = 2 ** ((midi - center) / 12);
  const out = e.trimOut(`hook-${voice}`, 1, e.hookBus || e.windDuck, -4, 500);
  e.playBuf(buffer, t, (flute ? 1.02 : muted ? .48 : .4) * touch * mix, out, rate, Math.max(.06, duration * .92), {
    peaks: windNotches(bank, center, rate),
    fade: short ? .004 : flute ? .008 : .015,
    attackGain: strong ? 1.02 : .94,
    release: short ? .07 : .055, ringOut: true,
  });
  return true;
}
