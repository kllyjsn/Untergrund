import { writeFileSync } from 'node:fs';
import { withChrome } from '../test/chrome.mjs';

const selectedAt = process.argv.indexOf('--styles');
const styles = selectedAt < 0 ? ['swing', 'modal', 'neosoul'] : process.argv[selectedAt + 1].split(',');
const seedsAt = process.argv.indexOf('--seeds');
const seeds = seedsAt < 0 ? [11, 42] : process.argv[seedsAt + 1].split(',').map(Number);
if (!seeds.length || seeds.some((n) => !Number.isInteger(n))) throw new Error('Expected integer seeds');
if (styles.some((s) => !['swing', 'modal', 'bossa', 'jazzfunk', 'neosoul'].includes(s))) throw new Error('Unknown jazz comparison style');
const result = await withChrome(async (run) => run(`(async () => {
  const { freshSong } = await import('/js/state.js');
  const { render } = await import('/test/audio-quality-page.js');
  const { spectrum, BANDS, targetBalance } = await import('/js/audio-quality.js');
  const { loudness, truePeak } = await import('/js/loudness.js');
  const { TRACK_IDS } = await import('/js/params.js');
  Object.assign(BANDS, { below40: [20, 40], fundamentals: [40, 200], ride: [4000, 8000], rideLower: [2000, 4000], rideUpper: [8000, 12000] });
  const out = [];
  for (const [style, seed] of ${JSON.stringify(styles)}.flatMap((style) => (style === 'neosoul' ? [42] : ${JSON.stringify(seeds)}).map((seed) => [style, seed]))) {
    const s = freshSong(style, seed); s.artist = { style, seed }; s.ending = false;
    const buf = await render(s, 0, 8, { sampleRate: 44100, tail: 1 });
    const ch = [buf.getChannelData(0), buf.getChannelData(1)];
    const integrated = loudness(ch, buf.sampleRate).integrated;
    const gain = 10 ** ((-16 - integrated) / 20);
    for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= gain;
    const spec = spectrum(ch[0], ch[1], buf.sampleRate);
    const parts = {}, peaks = {}, ride = {}, comp = {};
    if (style !== 'neosoul') for (const part of ['acid', 'ride', 'lead', 'piano', 'ch', ...(style === 'jazzfunk' ? ['oh'] : []), 'kick', 'snare']) {
      if (['bossa', 'jazzfunk'].includes(style) && part === 'ride') continue;
      const solo = structuredClone(s);
      solo.mutes = Object.fromEntries(TRACK_IDS.map((id) => [id, id !== (['lead', 'piano'].includes(part) ? 'stab' : part)]));
      const b = await render(solo, 0, 8, { sampleRate: 24000, tail: 1, onEngine(e) {
        if (part === 'lead') e.stab = () => {};
        if (part === 'piano') e.hook = () => {};
      } });
      parts[part] = loudness([b.getChannelData(0), b.getChannelData(1)], b.sampleRate).integrated + 20 * Math.log10(gain);
      peaks[part] = 20 * Math.log10(truePeak([b.getChannelData(0), b.getChannelData(1)])) + 20 * Math.log10(gain);
      if (part === 'ride' || part === 'piano') {
        const ch = [b.getChannelData(0), b.getChannelData(1)];
        for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= gain;
        const spec = spectrum(ch[0], ch[1], b.sampleRate), e = spec.shares;
        if (part === 'ride') {
          ride.dbtp = 20 * Math.log10(truePeak(ch)); ride.spectrum = spec;
          ride.bumpDb = 10 * Math.log10(e.ride / Math.max(e.rideLower, e.rideUpper / Math.log2(1.5)));
        } else comp.spectrum = spec;
      }
    }
    out.push({ style, seed, leadVoice: s.patterns[6].hook.v, isolatedPartLufsAtMixGain: parts, isolatedPartDbtpAtMixGain: peaks, ride, comp, sourceLufs: integrated, matchedLufs: loudness(ch, buf.sampleRate).integrated,
      matchedDbtp: 20 * Math.log10(truePeak(ch)), spectrum: spec, acousticDeviation: targetBalance(spec.octaves, 'swing') });
  }
  return { bars: 8, matchedTarget: -16, bands: BANDS, reference: 'Repository acoustic LTAS engineering target; not a measured jazz recording', measurements: out };
})()`));
if (!result) throw new Error('Chrome unavailable');
writeFileSync(process.argv[2]?.startsWith('--') ? 'test/out/jazz/balance.json' : process.argv[2] || 'test/out/jazz/balance.json', JSON.stringify(result, null, 2) + '\n');
for (const r of result.measurements) console.log(JSON.stringify(r));
