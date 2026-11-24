import { accountFromSession, allow, authEnabled } from './accounts.js';
import { aiEnv, askGemini, askOpenRouter } from './describe-ai.js';
import { billingConfig, hasActivePro } from './billing.js';
import { DESCRIBE_TEXT_LIMIT } from '../../js/describe.js';
import { localSpec, SONG_SYSTEM, validateSpec } from '../../js/song-spec.js';
import { PRO_DRAFTS_PER_SET, PRO_DRAFT_SETS_PER_MONTH } from '../../js/pro-plan.js';

export const MAX_DRAFT_BODY = 4000;
const system = `${SONG_SYSTEM.replace('Reply with JSON only, exactly this shape:', 'Reply with JSON only: {"drafts":[...]}. Each entry is a song spec with this shape:')}
Return exactly ${PRO_DRAFTS_PER_SET} complete drafts. Each is an alternate arrangement of the same brief. Make the first immediately playable with a quick hook, the second a longer build and release, and the third a distinct rhythmic or textural take. Keep any tempo, key or genre explicitly requested. Vary the actual arrangement and energy curve, not just the title.`;
const response = (status, json) => ({ status, json });
const err = (status, error) => response(status, { error });

export async function handleSongDrafts(req, { kv, secret, env = process.env, stripeFetch = fetch, modelFetch = fetch, now = Date.now() }) {
  const cfg = billingConfig(env);
  const ai = aiEnv(env);
  const enabled = Boolean(cfg && kv && ai.key && authEnabled(secret));
  if (req.method === 'GET') return response(200, { enabled });
  if (req.method !== 'POST') return err(405, 'method_not_allowed');
  if (!enabled) return err(503, 'drafts_unavailable');
  if (req.origin !== cfg.origin || req.host !== new URL(cfg.origin).host) return err(403, 'bad_origin');
  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_DRAFT_BODY) return err(413, 'too_large');
    try { body = JSON.parse(body); } catch { return err(400, 'bad_request'); }
  }
  if (JSON.stringify(body ?? null).length > MAX_DRAFT_BODY) return err(413, 'too_large');
  const text = typeof body?.text === 'string' ? body.text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, DESCRIBE_TEXT_LIMIT) : '';
  const style = typeof body?.style === 'string' ? body.style.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32) : '';
  if (!text) return err(400, 'no_prompt');
  const acct = await accountFromSession(kv, secret, req.cookie);
  if (!acct || !Object.keys(acct.providers || {}).length) return err(401, 'sign_in_required');
  if (!await allow(kv, 'pro-drafts', acct.id)) return err(429, 'rate_limited');
  if (!await hasActivePro(kv, acct.id, cfg, stripeFetch)) return err(403, 'pro_required');

  const month = new Date(now).toISOString().slice(0, 7);
  const key = `untergrund:billing:${cfg.mode}:drafts:${acct.id}:${month}`;
  await kv.cmd(['SET', key, '0', 'NX', 'EX', 40 * 86400]);
  const used = await kv.cmd(['INCR', key]);
  if (used > PRO_DRAFT_SETS_PER_MONTH) {
    await kv.cmd(['DECR', key]);
    return err(429, 'monthly_limit');
  }
  try {
    const ask = ai.provider === 'openrouter' ? askOpenRouter : askGemini;
    const output = await ask(text, style, { system, whole: true, tokens: 3600, timeout: 13000, key: ai.key, model: ai.songModel || ai.model, fetchImpl: modelFetch });
    if (!Array.isArray(output?.drafts) || output.drafts.length !== PRO_DRAFTS_PER_SET ||
      output.drafts.some((row) => !Array.isArray(row?.sections) || !row.sections.some((s) => s && typeof s === 'object' && !Array.isArray(s)))) throw new Error('bad draft shape');
    const fallbackStyle = localSpec(text, { style }).style;
    const drafts = output.drafts.map((row) => validateSpec(row, { style: fallbackStyle, prompt: text }));
    const arrangements = drafts.map((draft) => JSON.stringify(draft.sections));
    if (new Set(arrangements).size !== PRO_DRAFTS_PER_SET) throw new Error('duplicate drafts');
    return response(200, { drafts });
  } catch {
    await kv.cmd(['DECR', key]);
    return err(502, 'drafts_unavailable');
  }
}
