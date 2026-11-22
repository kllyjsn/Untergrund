import { connect } from './soundcloud.js';

const status = document.querySelector('#status');
const button = document.querySelector('#connect');
async function refresh() {
  const r = await fetch('/api/autopublish', { cache: 'no-store' });
  const info = await r.json();
  if (!r.ok) throw new Error(info.error || 'Could not load status');
  status.replaceChildren(document.createTextNode(info.connected ? 'Connected: ' : 'Not connected.'));
  if (info.account) {
    const a = document.createElement('a'); a.href = info.account; a.textContent = info.account;
    status.append(a);
  }
  if (info.last) {
    const a = document.createElement('a'); a.href = info.last.permalink_url; a.textContent = 'Listen';
    status.append(document.createElement('br'), `Last published: ${new Date(info.last.day * 86400e3).toISOString().slice(0, 10)} · `, a);
  }
}
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    await connect({ endpoint: '/api/autopublish', persistTokens: false });
    await refresh();
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
refresh().catch((error) => { status.textContent = error.message; });
