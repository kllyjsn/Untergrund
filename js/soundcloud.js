// Browser client for SoundCloud: OAuth 2.1 + PKCE (token exchange via /api/sc-token), profile/stats, direct uploads.
const STORE = 'untergrund.sc';
let config = null;

export async function getConfig() {
  if (config) return config;
  try {
    const r = await fetch('/api/sc-config', { cache: 'no-store' });
    config = r.ok ? await r.json() : { enabled: false };
  } catch { config = { enabled: false }; }
  return config;
}

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n = 48) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const redirectUri = () => `${location.origin}/sc-callback.html`;

function readTokens() { try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; } }
function writeTokens(t) {
  if (!t) return localStorage.removeItem(STORE);
  localStorage.setItem(STORE, JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: Date.now() + (t.expires_in ? t.expires_in * 1000 : 3600e3) - 60e3 }));
}
export const isConnected = () => Boolean(readTokens()?.access_token);
export function disconnect() { writeTokens(null); }

async function tokenRequest(body) {
  const r = await fetch('/api/sc-token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.access_token) throw new Error(json.error_description || json.error || `token exchange failed (${r.status})`);
  writeTokens(json);
  return json;
}

// Must be called from a click handler so the popup is not blocked.
export function connect() {
  const popup = window.open('about:blank', 'sc-auth', 'width=520,height=720');
  return new Promise(async (resolve, reject) => {
    const cfg = await getConfig();
    if (!cfg.enabled) { popup?.close(); return reject(new Error('SoundCloud is not configured on this server')); }
    const verifier = randomString(48);
    const state = randomString(16);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const q = new URLSearchParams({ client_id: cfg.clientId, redirect_uri: redirectUri(), response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', state });
    if (!popup) return reject(new Error('Popup blocked — allow popups for this site'));
    popup.location.href = `${cfg.authUrl}/authorize?${q}`;

    let done = false;
    const finish = async (msg) => {
      if (done || !msg || msg.state !== state) return;
      done = true; cleanup();
      if (msg.error || !msg.code) return reject(new Error(msg.error || 'Authorization cancelled'));
      try { await tokenRequest({ code: msg.code, code_verifier: verifier, redirect_uri: redirectUri() }); resolve(); } catch (e) { reject(e); }
    };
    const onMsg = (e) => { if (e.origin === location.origin && e.data?.type === 'sc-auth') finish(e.data); };
    const onStore = (e) => { if (e.key === 'untergrund.sc.callback' && e.newValue) finish(JSON.parse(e.newValue)); };
    const poll = setInterval(() => { if (popup.closed && !done) setTimeout(() => { if (!done) { done = true; cleanup(); reject(new Error('Authorization cancelled')); } }, 800); }, 500);
    const cleanup = () => { window.removeEventListener('message', onMsg); window.removeEventListener('storage', onStore); clearInterval(poll); };
    window.addEventListener('message', onMsg);
    window.addEventListener('storage', onStore);
  });
}

async function accessToken() {
  const t = readTokens();
  if (!t) throw new Error('Not connected to SoundCloud');
  if (Date.now() < t.expires_at) return t.access_token;
  if (!t.refresh_token) { disconnect(); throw new Error('SoundCloud session expired — reconnect'); }
  try { return (await tokenRequest({ refresh_token: t.refresh_token })).access_token; }
  catch (e) { disconnect(); throw new Error('SoundCloud session expired — reconnect'); }
}

async function api(path, opts = {}, retried = false) {
  const cfg = await getConfig();
  const r = await fetch(cfg.apiUrl + path, { ...opts, headers: { Accept: 'application/json; charset=utf-8', ...(opts.headers || {}), Authorization: `OAuth ${await accessToken()}` } });
  if (r.status === 401 && !retried) { const t = readTokens(); if (t) { t.expires_at = 0; localStorage.setItem(STORE, JSON.stringify(t)); } return api(path, opts, true); }
  if (!r.ok) throw new Error(`SoundCloud ${r.status}`);
  return r.json();
}

export const me = () => api('/me');
export async function myTracks(limit = 50) {
  const r = await api(`/me/tracks?limit=${limit}&linked_partitioning=true`);
  return Array.isArray(r) ? r : r.collection || [];
}

// meta: { title, description, genre, tags[], sharing, downloadable, license }
export async function uploadTrack(audio, artwork, meta, onProgress = () => {}) {
  const cfg = await getConfig();
  const token = await accessToken();
  const fd = new FormData();
  fd.append('track[title]', meta.title);
  fd.append('track[asset_data]', audio, `${slug(meta.title)}.wav`);
  if (artwork) fd.append('track[artwork_data]', artwork, 'artwork.png');
  if (meta.description) fd.append('track[description]', meta.description);
  if (meta.genre) fd.append('track[genre]', meta.genre);
  if (meta.tags?.length) fd.append('track[tag_list]', tagList(meta.tags));
  fd.append('track[sharing]', meta.sharing || 'public');
  fd.append('track[downloadable]', meta.downloadable ? 'true' : 'false');
  if (meta.license) fd.append('track[license]', meta.license);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${cfg.apiUrl}/tracks`);
    xhr.setRequestHeader('Authorization', `OAuth ${token}`);
    xhr.setRequestHeader('Accept', 'application/json; charset=utf-8');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let json = null; try { json = JSON.parse(xhr.responseText); } catch {}
      if (xhr.status >= 200 && xhr.status < 300 && json) return resolve(json);
      const msg = json?.errors?.[0]?.error_message || json?.message || `upload failed (${xhr.status})`;
      if (xhr.status === 401) disconnect();
      reject(new Error(msg));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(fd);
  });
}

export const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untergrund';
export const tagList = (tags) => tags.map((t) => t.trim()).filter(Boolean).map((t) => (/\s/.test(t) ? `"${t.replace(/"/g, '')}"` : t)).join(' ');
