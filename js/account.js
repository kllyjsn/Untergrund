// Creator account client: anonymous device identity, handle claims, SoundCloud sign-in, follows, and the
// "Your public page" panel in the Artist sheet. Everything no-ops gracefully when /api/account is off.
import { h } from './ui.js';
import * as sc from './soundcloud.js';

const API = '/api/account';
const OFF = { enabled: false, account: null, following: [] };
let cache = null, pending = null;
const listeners = new Set();
export const onAccount = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const set = (patch) => { cache = { ...(cache || OFF), ...patch }; listeners.forEach((fn) => fn(cache)); return cache; };

async function call(method, body, query = '') {
  const res = await fetch(API + query, { method, credentials: 'same-origin', ...(body && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

export async function getAccount(force = false) {
  if (cache && !force) return cache;
  pending ||= call('GET').then((r) => set(r.ok ? r.json : OFF), () => set(OFF)).finally(() => { pending = null; });
  return pending;
}

// Anonymous identity, created the first time this browser publishes or follows.
export async function ensureDevice() {
  const a = await getAccount();
  if (!a.enabled || a.account) return a.account;
  const r = await call('POST', { action: 'device' }).catch(() => null);
  return r?.ok ? set({ account: r.json.account }).account : null;
}

export async function checkHandle(handle) {
  const r = await call('GET', null, `?check=${encodeURIComponent(handle)}`).catch(() => null);
  return r?.ok ? r.json : { available: false, error: 'offline' };
}

export const HANDLE_HELP = {
  too_short: 'At least 3 characters.', too_long: '24 characters max.', invalid: 'Use letters, numbers, - or _.',
  reserved: 'That one is reserved. Try another.', taken: 'Already taken. Try another.', offline: 'Can’t check right now.', rate_limited: 'Too many tries. Wait a minute.',
};

export async function claim(handle, profile = {}) {
  const r = await call('POST', { action: 'claim', handle, ...profile });
  if (!r.ok) throw new Error(HANDLE_HELP[r.json.error] || 'Could not claim that link.');
  set({ account: r.json.account });
  migrateLocalSongs();
  return r.json.account;
}

let syncTimer = 0;
export function syncProfile(profile) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { if (cache?.account?.handle) call('POST', { action: 'profile', ...profile }).then((r) => r.ok && set({ account: r.json.account })).catch(() => {}); }, 600);
}

export async function follow(handle, on = true) {
  const r = await call('POST', { action: on ? 'follow' : 'unfollow', handle });
  if (!r.ok) throw new Error(r.json.error === 'rate_limited' ? 'Slow down a little.' : r.json.error === 'cannot_follow_self' ? 'That’s you.' : 'Could not update follow.');
  const following = new Set(cache?.following || []);
  if (on) following.add(handle); else following.delete(handle);
  set({ following: [...following] });
  if (!cache.account) getAccount(true);
  return r.json;
}

export async function signInWithSoundCloud() {
  const json = await sc.connect({ endpoint: `${API}?action=soundcloud` });
  if (!json?.account) throw new Error('SoundCloud sign-in failed');
  await getAccount(true);
  migrateLocalSongs();
  return json.account;
}

export async function signOut() {
  await call('POST', { action: 'signout' }).catch(() => {});
  sc.disconnect();
  set({ account: null, following: [] });
}

// The signed-in artist's published tracks (from their public page), or [] without a claimed link.
export async function myTracks() {
  const a = await getAccount();
  if (!a.account?.handle) return [];
  const r = await call('GET', null, `?handle=${encodeURIComponent(a.account.handle)}`).catch(() => null);
  return r?.ok ? r.json.tracks || [] : [];
}

export async function fetchFeed() {
  const r = await call('GET', null, '?feed=1').catch(() => null);
  return r?.ok ? r.json.items || [] : [];
}

export async function fetchPublicTrack(id) {
  const r = await call('GET', null, `?track=${encodeURIComponent(id)}`).catch(() => null);
  return r?.ok ? r.json : null;
}

// Songs published while storage was off live only in this browser; publish them under the account now.
export async function migrateLocalSongs() {
  let items = [];
  try { items = (await idb('all')).filter((it) => it.kind === 'song' && it.local && String(it.trackId).startsWith('local-')); } catch { return 0; }
  let crate = [];
  try { crate = JSON.parse(localStorage.getItem('untergrund.crate.v1')) || []; } catch {}
  let moved = 0;
  for (const it of items.slice(0, 20)) {
    const track = crate.find((t) => t.id === it.trackId);
    if (!track?.state) continue;
    const res = await fetch('/api/jukebox', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'song', title: it.title, style: it.style, artist: cache?.account?.name || it.artist, bpm: it.bpm, state: track.state }) }).catch(() => null);
    if (!res?.ok) break;
    await idb('delete', it.id).catch(() => {});
    moved++;
  }
  return moved;
}

function idb(op, key) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('untergrund-jukebox', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('items', { keyPath: 'id' });
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const st = open.result.transaction('items', op === 'all' ? 'readonly' : 'readwrite').objectStore('items');
      const req = op === 'all' ? st.getAll() : st.delete(key);
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    };
  });
}

export const pageUrl = (handle) => `${location.origin}/a/${handle}`;
const shortUrl = (handle) => `${location.host.replace(/^www\./, '')}/a/${handle}`;
export const suggestHandle = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

// "Your public page" panel for the Artist sheet. `getProfile` returns { name, bio, dna } from the artist DNA.
export function accountPanel({ getProfile, toast }) {
  const el = h('section', { class: 'acct-panel' }, h('div', { class: 'acct-label' }, 'YOUR LINK'), h('p', { class: 'acct-dim' }, 'Loading…'));
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch { toast(text); } };
  async function render() {
    const [a, cfg] = await Promise.all([getAccount(), sc.getConfig().catch(() => ({ enabled: false }))]);
    el.replaceChildren(h('div', { class: 'acct-label' }, 'YOUR LINK'));
    if (!a.enabled) return el.append(h('p', { class: 'acct-dim' }, 'Artist pages go live once public storage is connected. Your music stays saved in this browser.'));
    const acct = a.account;
    const scBtn = (label) => cfg.enabled ? h('button', { class: 'btn sc acct-sc', onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = 'CONNECTING…';
      try { const who = await signInWithSoundCloud(); toast(who.handle ? `Signed in as @${who.handle}` : 'Signed in with SoundCloud'); render(); }
      catch (err) { toast(err.message); b.disabled = false; b.textContent = label; }
    } }, label) : null;
    if (acct?.handle) {
      const avatar = acct.avatar ? h('img', { class: 'acct-avatar', src: acct.avatar, alt: '' }) : h('span', { class: 'acct-avatar' }, (acct.name || acct.handle).slice(0, 2).toUpperCase());
      el.append(
        h('div', { class: 'acct-live' }, avatar,
          h('div', { class: 'acct-who' }, h('b', {}, acct.name || acct.handle), h('a', { href: `/a/${acct.handle}`, target: '_blank', rel: 'noopener' }, shortUrl(acct.handle))),
          h('div', { class: 'acct-btns' },
            h('a', { class: 'btn', href: `/a/${acct.handle}`, target: '_blank', rel: 'noopener' }, 'VIEW PAGE'),
            h('button', { class: 'btn ghost', onclick: () => copy(pageUrl(acct.handle)) }, 'COPY LINK'))),
        acct.anon
          ? h('div', { class: 'acct-foot' }, h('span', { class: 'acct-dim' }, 'Saved to this browser. Sign in to keep it on every device.'), scBtn('SIGN IN WITH SOUNDCLOUD'))
          : h('div', { class: 'acct-foot' }, h('span', { class: 'acct-dim' }, `Signed in with ${acct.providers.includes('soundcloud') ? 'SoundCloud' : 'your account'}.`),
            h('button', { class: 'btn ghost acct-out', onclick: async () => { await signOut(); toast('Signed out'); render(); } }, 'SIGN OUT')));
      return;
    }
    const prof = getProfile();
    const input = h('input', { class: 'inp acct-input', maxlength: 24, placeholder: 'yourname', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false',
      value: suggestHandle(prof.name && prof.name !== 'UNTERGRUND' ? prof.name : ''), 'aria-label': 'Choose your link' });
    const hint = h('div', { class: 'acct-hint' }, 'Letters, numbers, - or _.');
    const go = h('button', { class: 'btn accent acct-go' }, 'CLAIM');
    let seq = 0, timer = 0;
    const check = () => {
      clearTimeout(timer);
      const v = input.value.trim().toLowerCase(), my = ++seq;
      if (!v) { hint.textContent = 'Letters, numbers, - or _.'; hint.className = 'acct-hint'; return; }
      timer = setTimeout(async () => {
        const r = await checkHandle(v);
        if (my !== seq) return;
        hint.textContent = r.available ? `${shortUrl(r.handle)} is yours to claim.` : HANDLE_HELP[r.error || 'taken'];
        hint.className = 'acct-hint ' + (r.available ? 'ok' : 'bad');
      }, 250);
    };
    input.oninput = () => { const lower = input.value.toLowerCase().replace(/\s+/g, '-'); if (lower !== input.value) input.value = lower; check(); };
    input.onkeydown = (e) => { if (e.key === 'Enter') go.click(); e.stopPropagation(); };
    go.onclick = async () => {
      go.disabled = true;
      try { const acc = await claim(input.value.trim(), getProfile()); toast(`${shortUrl(acc.handle)} is yours`); render(); }
      catch (err) { hint.textContent = err.message; hint.className = 'acct-hint bad'; go.disabled = false; }
    };
    el.append(
      h('p', { class: 'acct-copy' }, 'Claim a free link. Every song you publish gets its own page that plays instantly.'),
      h('div', { class: 'acct-claim' }, h('span', { class: 'acct-prefix' }, `${location.host.replace(/^www\./, '')}/a/`), input, go),
      hint,
      cfg.enabled ? h('div', { class: 'acct-foot' }, h('span', { class: 'acct-dim' }, 'Have SoundCloud? Use it to sign in on any device.'), scBtn('SIGN IN WITH SOUNDCLOUD')) : null);
    if (input.value) check();
  }
  render();
  return el;
}
