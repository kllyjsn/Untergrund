// Server half of the SoundCloud OAuth 2.1 (PKCE) flow: only the code/refresh exchange
// needs the client secret, everything else runs in the browser against api.soundcloud.com.
export function scConfig(env = process.env) {
  return {
    clientId: env.SOUNDCLOUD_CLIENT_ID || '',
    secret: env.SOUNDCLOUD_CLIENT_SECRET || '',
    authUrl: (env.SOUNDCLOUD_AUTH_URL || 'https://secure.soundcloud.com').replace(/\/$/, ''),
    apiUrl: (env.SOUNDCLOUD_API_URL || 'https://api.soundcloud.com').replace(/\/$/, ''),
  };
}

export function publicConfig(env) {
  const c = scConfig(env);
  return { enabled: Boolean(c.clientId && c.secret), clientId: c.clientId, authUrl: c.authUrl, apiUrl: c.apiUrl };
}

export async function exchangeToken(body, env) {
  const c = scConfig(env);
  if (!c.clientId || !c.secret) return { status: 503, json: { error: 'soundcloud_not_configured' } };
  const form = new URLSearchParams({ client_id: c.clientId, client_secret: c.secret });
  if (body?.refresh_token) {
    form.set('grant_type', 'refresh_token');
    form.set('refresh_token', String(body.refresh_token));
  } else if (body?.code && body?.code_verifier && body?.redirect_uri) {
    if (!/\/sc-callback\.html$/.test(String(body.redirect_uri))) return { status: 400, json: { error: 'bad_redirect_uri' } };
    form.set('grant_type', 'authorization_code');
    form.set('code', String(body.code));
    form.set('code_verifier', String(body.code_verifier));
    form.set('redirect_uri', String(body.redirect_uri));
  } else {
    return { status: 400, json: { error: 'missing_parameters' } };
  }
  const r = await fetch(`${c.authUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json; charset=utf-8' },
    body: form,
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { error: 'bad_upstream_response' }; }
  return { status: r.status, json };
}
