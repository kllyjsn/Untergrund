// /api/song-plan: a free-text song prompt (plus optional pasted lyrics) -> a song plan from a small, cheap
// OpenRouter model. Off unless OPENROUTER_API_KEY is set; the client then plans with the local rules (js/song-plan.js).
// The model's answer only reaches the app through validatePlan(), and pasted lyrics are never rewritten by it.
import { createHash } from 'node:crypto';
import { PLAN_SYSTEM, PLAN_LIMITS, validatePlan, lyricLines } from '../../js/song-plan.js';
import { LIMITS, cleanText } from '../../js/lyrics.js';

export const PLAN_PER_HOUR = 20, PLAN_MODEL = 'google/gemini-2.5-flash-lite', PLAN_TIMEOUT = 8000;
export const planEnv = (env) => ({ key: env.OPENROUTER_API_KEY || '', model: env.SONG_PLAN_MODEL || PLAN_MODEL });
const slug = (v) => cleanText(v, 32).toLowerCase().replace(/[^a-z0-9_-]/g, '');

export async function askPlan(request, { key, model = PLAN_MODEL, fetchImpl = fetch, timeout = PLAN_TIMEOUT }) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Title': 'UNTERGRUND' },
      body: JSON.stringify({ model, temperature: 0.5, max_tokens: 1200, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: PLAN_SYSTEM }, { role: 'user', content: JSON.stringify(request) }] }),
    });
    if (!res.ok) throw new Error(`openrouter ${res.status}`);
    const json = await res.json();
    return JSON.parse(String(json?.choices?.[0]?.message?.content || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } finally { clearTimeout(timer); }
}

export async function handlePlan({ method, body, client = 'anon', key = '', model, kv, fetchImpl, timeout, now = Date.now() }) {
  if (method !== 'POST') return { status: 405, json: { error: 'method_not_allowed' } };
  if (typeof body === 'string') { try { body = JSON.parse(body || '{}'); } catch { body = null; } }
  const prompt = cleanText(body?.prompt, PLAN_LIMITS.prompt), style = slug(body?.style);
  const lines = lyricLines(String(body?.lyrics ?? '').slice(0, LIMITS.text)).slice(0, LIMITS.total);
  if (!prompt && !lines.length) return { status: 400, json: { error: 'no_prompt' } };
  if (!key) return { status: 501, json: { error: 'disabled' } };
  if (kv) {
    const k = `untergrund:ev:plan_rate:${createHash('sha256').update(String(client)).digest('hex').slice(0, 16)}:${Math.floor(now / 3600e3)}`;
    const [n] = await kv([['INCR', k], ['EXPIRE', k, 3600]]);
    if (+n > PLAN_PER_HOUR) return { status: 429, json: { error: 'rate_limited' } };
  }
  const request = { request: prompt || null, currentStyle: style || null, ...(lines.length && { lines: lines.map((t, i) => `${i + 1}. ${t}`) }) };
  try {
    const plan = validatePlan(await askPlan(request, { key, ...(model && { model }), fetchImpl, ...(timeout && { timeout }) }), { lines: lines.length ? lines : null });
    if (!plan) return { status: 502, json: { error: 'bad_plan' } };
    return { status: 200, json: { plan } };
  } catch { return { status: 502, json: { error: 'model_unavailable' } }; }
}
