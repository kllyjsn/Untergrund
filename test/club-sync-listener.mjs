import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { songState } from '../js/song-spec.js';
import { floatWav } from './club-sync-vocals.mjs';

export function listenerSong(style, seed) {
  return songState({ style, title: `Club audit ${style} ${seed}` }, seed).state;
}

function extractListenerPCM(from, to) {
  const blocks = __clubPCM.mix;
  const rate = blocks[0].sampleRate;
  const anchors = __clubAudio.anchors.reduce((rows, a) => {
    if (!rows.length || (a[0] > rows.at(-1)[0] && a[1] > rows.at(-1)[1])) rows.push(a);
    return rows;
  }, []);
  const anchor = anchors.reduce((best, a) => Math.abs(a[1] - from) < Math.abs(best[1] - from) ? a : best);
  const startFrame = Math.round((anchor[0] + (from - anchor[1]) / 1000) * rate);
  const endFrame = startFrame + Math.round((to - from) * rate / 1000);
  const data = new Float32Array((endFrame - startFrame) * 2);
  let covered = startFrame;
  for (const { frame, pcm, right } of blocks) {
    if (frame >= endFrame || frame + pcm.length <= startFrame) continue;
    const lo = Math.max(frame, startFrame), hi = Math.min(frame + pcm.length, endFrame);
    if (lo !== covered) throw new Error(`Noncontiguous PCM: expected ${covered}, got ${lo}`);
    for (let i = lo; i < hi; i++) {
      data[(i - startFrame) * 2] = pcm[i - frame];
      data[(i - startFrame) * 2 + 1] = right[i - frame];
    }
    covered = hi;
  }
  if (covered !== endFrame) throw new Error(`Missing PCM after frame ${covered} (expected through ${endFrame})`);
  const bytes = new Uint8Array(data.buffer);
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 16384) encoded += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return { pcm:btoa(encoded), startFrame, sampleRate:rate, anchor };
}

export async function saveListenerClips(clients, captures, from, to, directory, prefix) {
  const clips = await Promise.all(clients.map(async (client, i) => {
    assert.deepEqual(captures[i].errors, []);
    assert.deepEqual(captures[i].probeErrors || [], []);
    const { pcm, ...meta } = await client.run(`(${extractListenerPCM})(${from}, ${to})`);
    const bytes = Buffer.from(pcm, 'base64');
    const filename = `${prefix}-${i ? 'listener' : 'host'}.wav`;
    await writeFile(join(directory, filename), floatWav(new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4), meta.sampleRate, 2));
    return { filename, from, to, ...meta };
  }));
  return clips;
}
