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
  const length = Math.round((to - from) * rate / 1000);
  const data = new Float32Array(length * 2), frameJumps = [];
  let previousEnd, written = 0;
  for (const { frame, pcm, right } of blocks) {
    if (pcm.length + frame <= startFrame) continue;
    const lo = previousEnd === undefined ? startFrame - frame : 0;
    if (lo < 0) throw new Error(`Missing initial PCM at frame ${startFrame}`);
    const hi = Math.min(pcm.length, lo + length - written);
    if (previousEnd !== undefined && frame !== previousEnd) frameJumps.push({ offset:written, frames:frame - previousEnd });
    for (let i = lo; i < hi; i++) {
      data[written * 2] = pcm[i];
      data[written * 2 + 1] = right[i];
      written++;
    }
    previousEnd = frame + pcm.length;
    if (written === length) break;
  }
  if (written !== length) throw new Error(`Incomplete PCM: captured ${written} of ${length} frames`);
  const bytes = new Uint8Array(data.buffer);
  let encoded = '';
  for (let i = 0; i < bytes.length; i += 16384) encoded += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return { pcm:btoa(encoded), startFrame, sampleRate:rate, anchor, frameJumps };
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
