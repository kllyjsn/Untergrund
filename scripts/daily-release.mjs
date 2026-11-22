import { mkdir, open, writeFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { withChrome, findChrome } from '../test/chrome.mjs';
import { STYLES } from '../js/state.js';

export function releaseChoice(day, style) {
  const ids = Object.keys(STYLES);
  if (!Number.isSafeInteger(day) || day < 0 || !Number.isFinite(new Date(day * 86400e3).getTime())) throw new Error('Invalid UTC day');
  if (style && !ids.includes(style)) throw new Error(`Unknown style: ${style}`);
  return { day, date: new Date(day * 86400e3).toISOString().slice(0, 10), style: style || ids[day % ids.length], seed: ((Math.imul(day, 2654435761) >>> 0) % 1e9) + 1 };
}

export async function dailyRelease({ day = Math.floor(Date.now() / 86400e3), style, out = 'out' } = {}) {
  const choice = releaseChoice(day, style), ids = Object.keys(STYLES);
  if (!findChrome()) throw new Error('Chrome is required (set CHROME_PATH)');
  const probe = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  if (probe.status !== 0) throw new Error('ffmpeg is required');
  out = resolve(out);
  await mkdir(out, { recursive: true });
  await unlink(join(out, 'release.json')).catch((e) => { if (e.code !== 'ENOENT') throw e; });
  for (let offset = 0; offset < ids.length; offset++) {
    const selected = ids[(ids.indexOf(choice.style) + offset) % ids.length];
    const started = Date.now();
    console.log(`Rendering ${selected}, UTC day ${day}, seed ${choice.seed}, 44100 Hz stereo`);
    try {
      const meta = await withChrome(async (run) => {
        let timer;
        try {
          return await Promise.race([(async () => {
            const meta = await run(`(async () => {
              const { freshSong, STYLES } = await import('/js/state.js');
              const { parseChain } = await import('/js/engine.js');
              const { compose } = await import('/js/classical.js');
              const { PIECE, loadPiece } = await import('/js/repertoire.js');
              const { trackTitle } = await import('/js/crate.js');
              const { KEYS } = await import('/js/params.js');
              const { parseKeyName } = await import('/js/midi.js');
              const { autoTags, autoDescription } = await import('/js/release-metadata.js');
              const { drawArtwork } = await import('/js/artwork.js');
              const { renderBars, bufferToWav } = await import('/js/render.js');
              const style = ${JSON.stringify(selected)}, seed = ${choice.seed};
              const state = freshSong(style, seed);
              const score = state.patterns.find(p => p.score)?.score;
              if (score?.piece) await loadPiece(score.piece);
              const composition = score ? compose(score) : null;
              if (composition?.waiting) throw new Error('Score did not load');
              const bars = composition ? composition.bars : parseChain(state.chain).length;
              if (!(bars > 0)) throw new Error('Empty arrangement');
              const piece = PIECE[score?.piece];
              const title = piece ? piece.title : trackTitle(seed);
              state.artist = { name: piece?.composer || 'UNTERGRUND', title, style, seed };
              const buffer = await renderBars(state, bars, { sampleRate: 44100, channels: 2 });
              let peak = 0;
              for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
                const pcm = buffer.getChannelData(ch);
                for (let i = 0; i < pcm.length; i++) { if (!Number.isFinite(pcm[i])) throw new Error('Non-finite audio'); peak = Math.max(peak, Math.abs(pcm[i])); }
              }
              if (peak < 0.00001) throw new Error('Silent render');
              window.releaseWav = new Uint8Array(await bufferToWav(buffer).arrayBuffer());
              const pieceKey = piece ? parseKeyName(piece.key) : null;
              const artState = pieceKey ? { ...state, key: pieceKey.pc, scale: pieceKey.minor ? 'minor' : 'major' } : state;
              window.releaseArt = drawArtwork(artState, { title, style: STYLES[style].name, seed, size: 1200 }).toDataURL('image/png').split(',')[1];
              return { style, genreName: STYLES[style].name, title, bpm: state.bpm,
                key: piece?.key.replace(/\\s+(major|minor)$/i, '') || KEYS[state.key], scale: pieceKey ? (pieceKey.minor ? 'minor' : 'major') : state.scale,
                seed, description: autoDescription(state, style, bars, piece?.key) + (piece ? '\\n' + piece.composer + ' — ' + piece.work + ' (' + piece.license + ')' : ''),
                tags: autoTags(state, style, piece?.key), genre: STYLES[style].name, bars, duration: buffer.duration, bytes: window.releaseWav.length };
            })()`);
            const slug = `${choice.date}-${selected}-${meta.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'track'}`;
            const wav = join(out, `${slug}.wav`), mp3 = join(out, `${slug}.mp3`);
            const file = await open(wav, 'w');
            try {
              for (let at = 0; at < meta.bytes; at += 32768) {
                const data = await run(`btoa(String.fromCharCode(...window.releaseWav.slice(${at}, ${at + 32768})))`);
                await file.write(Buffer.from(data, 'base64'));
              }
            } finally { await file.close(); }
            const encoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-codec:a', 'libmp3lame', '-b:a', '320k', mp3], { encoding: 'utf8' });
            if (encoded.status !== 0) throw new Error(`ffmpeg: ${encoded.stderr}`);
            await unlink(wav);
            await writeFile(join(out, `${slug}.png`), Buffer.from(await run('window.releaseArt'), 'base64'));
            const { bytes, ...release } = meta;
            return { ...release, day, date: choice.date, audio: `${slug}.mp3`, artwork: `${slug}.png` };
          })(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Render exceeded 40 minutes')), 40 * 60e3); })]);
        } finally { clearTimeout(timer); }
      });
      await writeFile(join(out, 'release.json'), JSON.stringify(meta, null, 2) + '\n');
      console.log(JSON.stringify({ ...meta, elapsedSeconds: (Date.now() - started) / 1000 }));
      return meta;
    } catch (error) { console.error(`Skipping ${selected}: ${error.message}`); }
  }
  throw new Error('No genre could be rendered');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { day: { type: 'string' }, style: { type: 'string' }, out: { type: 'string' } } });
  await dailyRelease({ ...values, ...(values.day != null && { day: Number(values.day) }) });
}
