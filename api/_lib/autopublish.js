import { exchangeToken, scConfig } from './soundcloud.js';

export const AUTOPUBLISH = 'untergrund:autopublish';
const result = (status, json) => ({ status, json });
const request = (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(45000) });

export async function handleAutopublish({ method, query = {}, body = {}, kv, env = process.env, fetchImpl = request, now = Date.now() }) {
  if (!kv) return result(503, { error: 'storage_unavailable' });
  const day = Math.floor(now / 86400e3), date = new Date(day * 86400e3).toISOString().slice(0, 10);
  const dayKey = `${AUTOPUBLISH}:day:${day}`;
  const cfg = scConfig(env);
  try {
    if (method === 'GET' && query.run !== '1') {
      const account = JSON.parse(await kv.cmd(['GET', `${AUTOPUBLISH}:account`]) || 'null');
      const last = JSON.parse(await kv.cmd(['GET', `${AUTOPUBLISH}:last`]) || 'null');
      return result(200, { connected: !!account, account: account?.permalink_url || null, last });
    }
    if (method !== 'POST' && !(method === 'GET' && query.run === '1')) return result(405, { error: 'method_not_allowed' });
    if (typeof body === 'string') {
      try { body = body.trim() ? JSON.parse(body) : {}; } catch { return result(400, { error: 'invalid_json' }); }
    }
    const run = query.run === '1';
    if (!run && (!body?.code || !body?.code_verifier || !body?.redirect_uri)) return result(400, { error: 'missing_parameters' });
    const lock = await kv.cmd(['SET', `${AUTOPUBLISH}:lock`, date, 'NX', 'EX', 600]);
    if (!lock) return result(409, { error: 'busy' });
    try {
      if (!run) {
        const token = await exchangeToken({ code: body.code, code_verifier: body.code_verifier, redirect_uri: body.redirect_uri }, env);
        if (token.status !== 200 || !token.json.access_token || !token.json.refresh_token) return result(400, { error: 'token_exchange_failed' });
        const meResponse = await fetchImpl(`${cfg.apiUrl}/me`, { headers: { Authorization: `OAuth ${token.json.access_token}` } });
        if (!meResponse.ok) return result(502, { error: 'account_lookup_failed' });
        const me = await meResponse.json();
        if (me.permalink !== (env.AUTOPUBLISH_SC_USER || 'jason-kelley-203620322')) return result(403, { error: 'wrong_account' });
        await kv.cmd(['SET', `${AUTOPUBLISH}:account`, JSON.stringify({ refresh_token: token.json.refresh_token, permalink_url: me.permalink_url })]);
        return result(200, { connected: true, account: me.permalink_url });
      }
      const existing = JSON.parse(await kv.cmd(['GET', dayKey]) || 'null');
      if (existing) return existing.trackId ? result(200, { published: false, ...existing }) : result(409, { error: 'publish_uncertain', day, message: 'An upload was started. Check SoundCloud before manually clearing this day record.' });
      const account = JSON.parse(await kv.cmd(['GET', `${AUTOPUBLISH}:account`]) || 'null');
      if (!account?.refresh_token) return result(409, { error: 'not_connected' });
      const repo = env.AUTOPUBLISH_GITHUB_REPO || 'kllyjsn/Untergrund';
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return result(503, { error: 'invalid_repository' });
      const tag = `daily-${date}`;
      const releaseResponse = await fetchImpl(`https://api.github.com/repos/${repo}/releases/tags/${tag}`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'untergrund-autopublish' } });
      if (releaseResponse.status === 404) return result(404, { error: 'no_release_yet', date });
      if (!releaseResponse.ok) return result(502, { error: 'github_unavailable' });
      const release = await releaseResponse.json();
      const asset = (name) => {
        const found = release.assets?.find((a) => a.name === name);
        if (!found?.browser_download_url?.toLowerCase().startsWith(`https://github.com/${repo}/releases/download/${tag}/`.toLowerCase())) throw new Error('invalid_release_asset');
        return found.browser_download_url;
      };
      const download = async (name, limit) => {
        const r = await fetchImpl(asset(name));
        if (!r.ok) throw new Error('asset_download_failed');
        if (Number(r.headers.get('content-length')) > limit) throw new Error('asset_too_large');
        const bytes = await r.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > limit) throw new Error('invalid_asset_size');
        return bytes;
      };
      const meta = JSON.parse(new TextDecoder().decode(await download('release.json', 65536)));
      if (meta.day !== day || meta.date !== date || typeof meta.title !== 'string' || !meta.title.trim() ||
          typeof meta.audio !== 'string' || !meta.audio.endsWith('.mp3') || typeof meta.description !== 'string' ||
          typeof meta.genre !== 'string' || !Array.isArray(meta.tags) || meta.tags.some((t) => typeof t !== 'string')) return result(422, { error: 'invalid_release_metadata' });
      const refreshed = await exchangeToken({ refresh_token: account.refresh_token }, env);
      if (refreshed.status !== 200 || !refreshed.json.access_token || !refreshed.json.refresh_token) return result(502, { error: 'refresh_failed' });
      await kv.cmd(['SET', `${AUTOPUBLISH}:account`, JSON.stringify({ ...account, refresh_token: refreshed.json.refresh_token })]);
      const form = new FormData();
      form.append('track[title]', meta.title);
      form.append('track[asset_data]', new Blob([await download(meta.audio, 150 * 1024 * 1024)], { type: 'audio/mpeg' }), meta.audio);
      if (meta.artwork) form.append('track[artwork_data]', new Blob([await download(meta.artwork, 10 * 1024 * 1024)], { type: 'image/png' }), meta.artwork);
      form.append('track[description]', meta.description);
      form.append('track[tag_list]', meta.tags.map((t) => `"${t.replace(/["\\]/g, '')}"`).join(' '));
      form.append('track[genre]', meta.genre);
      form.append('track[sharing]', 'public');
      await kv.cmd(['SET', dayKey, JSON.stringify({ day, state: 'uploading' })]);
      const upload = await fetchImpl(`${cfg.apiUrl}/tracks`, { method: 'POST', headers: { Authorization: `OAuth ${refreshed.json.access_token}` }, body: form });
      if (!upload.ok) return result(502, { error: 'upload_failed', upstreamStatus: upload.status, message: 'Check SoundCloud before retrying; this day is held to avoid duplicates.' });
      const track = await upload.json();
      if (!track.id || !track.permalink_url) throw new Error('invalid_upload_response');
      const published = { day, trackId: track.id, permalink_url: track.permalink_url };
      await kv.cmd(['SET', dayKey, JSON.stringify(published)]);
      await kv.cmd(['SET', `${AUTOPUBLISH}:last`, JSON.stringify(published)]);
      return result(200, { published: true, ...published });
    } finally { await kv.cmd(['DEL', `${AUTOPUBLISH}:lock`]); }
  } catch {
    return result(502, { error: 'autopublish_failed' });
  }
}
