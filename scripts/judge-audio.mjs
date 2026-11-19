import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIMENSIONS, validateJudgment, validateScores, aggregateScores, orderAgreement } from '../js/listen-review.js';

export const MODEL = process.env.LISTEN_JUDGE_MODEL || 'google/gemini-2.5-flash';
const legacyPrompt = (style) => `You are a seasoned producer and mix engineer reviewing two blind, loudness-matched generated music excerpts. Judge groove, musical intent, arrangement, harmony, tonal masking, punch, headroom and mono-compatible imaging. Do not favor louder or brighter. Do not invent numeric measurements. Genre: ${style}. Only return strict JSON: {"preference":"A"|"B"|"same","dimensions":[{"dimension":name,"preference":"A"|"B"|"same","note":"specific audible evidence or uncertainty"}]}. Include these dimensions exactly in order: ${DIMENSIONS.join('; ')}. These are short mono excerpts: explicitly acknowledge inability to judge stereo and full-song form.`;
export async function checkModel() {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing');
  const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`Model catalog HTTP ${r.status}`);
  const catalog = await r.json();
  if (!catalog.data?.find((m) => m.id === MODEL)?.architecture?.input_modalities?.includes('audio')) throw new Error(`Model ${MODEL} does not advertise audio input`);
}
const run = (bin, args) => execFileSync(bin, args, { encoding: 'utf8' });
export async function judgeAudio({ files, style, protocol = 'stable', out, prefix, onCall = () => {} }) {
  if (!['stable', 'legacy'].includes(protocol)) throw new Error('Unknown judge protocol');
  const durations = files.map((f) => Number(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', f])));
  const duration = Math.min(...durations);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid audio duration');
  const length = Math.min(20, duration);
  const starts = protocol === 'legacy' ? [30] : [0.2, 0.5, 0.8].map((f) => Math.max(0, Math.min(duration - length, duration * f - length / 2)));
  const windows = [];
  for (const [w, start] of starts.entries()) {
    const audio = files.map((file, i) => {
      const dest = join(out, `${prefix}-${protocol}-${w}-${i}.mp3`);
      run('ffmpeg', ['-v', 'error', '-y', '-i', file, '-ss', String(start), '-t', protocol === 'legacy' ? '24' : String(length), '-af', 'loudnorm=I=-18:TP=-2:LRA=11', '-ar', '24000', '-ac', '1', '-b:a', '64k', dest]);
      return readFileSync(dest).toString('base64');
    });
    const orders = [];
    for (const order of [[0, 1], [1, 0]]) {
      const prompt = protocol === 'legacy' ? legacyPrompt(style) : `Score each candidate independently against fixed production anchors, not relative rank. 1=severely broken/unusable, 3=major audible defects, 5=competent demo with obvious issues, 7=polished genre-appropriate production, 9=excellent professional release, 10=exceptional. Equal quality must receive equal scores; do not force a winner. Do not favor louder or brighter. Audible distortion, noise and loss of detail reduce quality, but intentional genre texture is not itself a defect. Genre: ${style}. Mono short windows cannot establish stereo or full-song form; use neutral 5 for unobservable dimensions. Return only strict JSON {"A":{"overall":number,"dimensions":[{"dimension":name,"score":number}]},"B":{"overall":number,"dimensions":[{"dimension":name,"score":number}]}}. Every score must be 1–10. Include dimensions exactly in this order: ${DIMENSIONS.join('; ')}. Overall is audible production quality using these same anchors, not a preference vote.`;
      onCall();
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: 2200, response_format: { type: 'json_object' }, messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: order.flatMap((index, i) => [{ type: 'text', text: `Candidate ${i === 0 ? 'A' : 'B'}` }, { type: 'input_audio', input_audio: { data: audio[index], format: 'mp3' } }]) },
        ] }),
      });
      if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}`);
      const data = await response.json();
      const value = JSON.parse(data.choices?.[0]?.message?.content);
      orders.push(protocol === 'legacy' ? validateJudgment(value) : validateScores(value));
    }
    windows.push(orders);
  }
  if (protocol === 'stable') return { ...aggregateScores(windows), starts, windows };
  const [a, b] = windows[0];
  const unblind = (p, reversed) => p === 'same' ? 'same' : ((p === 'A') !== reversed ? 'base' : 'head');
  return { forward: unblind(a.preference, false), reverse: unblind(b.preference, true), preference: orderAgreement(a, b), starts, windows };
}
