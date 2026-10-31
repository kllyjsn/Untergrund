// Minimal fake of secure.soundcloud.com + api.soundcloud.com for offline end-to-end tests.
import crypto from 'node:crypto';

const codes = new Map();
const tracks = [];
const user = { id: 1, username: 'untergrund-test', permalink_url: 'https://soundcloud.com/untergrund-test',
  avatar_url: '', followers_count: 128, followings_count: 40 };
const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' });
  res.end(JSON.stringify(body));
};
const authed = (req) => /^OAuth mock-access-/.test(req.headers.authorization || '');

export async function handle(req, res, url, readBody) {
  const p = url.pathname.replace('/mock-sc', '');
  if (req.method === 'OPTIONS') return json(res, 200, {});
  if (p === '/authorize') {
    const code = crypto.randomBytes(8).toString('hex');
    codes.set(code, url.searchParams.get('code_challenge'));
    const back = `${url.searchParams.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(url.searchParams.get('state'))}`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(`<body style="background:#f50;font:16px sans-serif;padding:40px"><h2>Mock SoundCloud</h2><p>Allow UNTERGRUND to access your account?</p><a id="allow" href="${back}">Connect and continue</a>`);
  }
  if (p === '/oauth/token' && req.method === 'POST') {
    const f = new URLSearchParams((await readBody(req)).toString());
    if (f.get('client_secret') !== 'mock-secret') return json(res, 401, { error: 'invalid_client' });
    if (f.get('grant_type') === 'authorization_code') {
      const challenge = codes.get(f.get('code'));
      const expect = crypto.createHash('sha256').update(f.get('code_verifier') || '').digest('base64url');
      if (!challenge || challenge !== expect) return json(res, 400, { error: 'invalid_grant' });
      codes.delete(f.get('code'));
    }
    return json(res, 200, { access_token: 'mock-access-' + Date.now(), refresh_token: 'mock-refresh', expires_in: 3600, scope: '', token_type: 'bearer' });
  }
  if (!p.startsWith('/api/')) return json(res, 404, { error: 'not_found' });
  if (!authed(req)) return json(res, 401, { error: 'unauthorized' });
  const ap = p.slice(4);
  if (ap === '/me') return json(res, 200, { ...user, track_count: tracks.length });
  if (ap === '/me/tracks') return json(res, 200, { collection: [...tracks].reverse() });
  if (ap === '/tracks' && req.method === 'POST') {
    const body = await readBody(req);
    const field = (name) => { const m = body.toString('latin1').match(new RegExp(`name="track\\[${name}\\]"\\r\\n\\r\\n([^\\r]*)`)); return m ? Buffer.from(m[1], 'latin1').toString('utf8') : null; };
    const hasAudio = /name="track\[asset_data\]"; filename=/.test(body.toString('latin1', 0, Math.min(body.length, 200000)));
    if (!field('title') || !hasAudio) return json(res, 422, { errors: [{ error_message: 'title and asset_data required' }] });
    const t = { id: 1000 + tracks.length, title: field('title'), genre: field('genre'), tag_list: field('tag_list'), sharing: field('sharing'),
      downloadable: field('downloadable') === 'true', license: field('license'), description: field('description'), bytes: body.length,
      has_artwork: /name="track\[artwork_data\]"; filename=/.test(body.toString('latin1')),
      permalink_url: `https://soundcloud.com/untergrund-test/track-${1000 + tracks.length}`, created_at: new Date().toISOString(),
      playback_count: 0, favoritings_count: 0, reposts_count: 0, comment_count: 0, state: 'processing' };
    tracks.push(t);
    console.log('[mock-sc] upload', JSON.stringify({ ...t, description: t.description?.slice(0, 60) }));
    return json(res, 201, t);
  }
  return json(res, 404, { error: 'not_found' });
}
