import { openListenerAccount } from './listener-account.js';

const price = document.getElementById('plan-price');
const status = document.getElementById('plan-status');
const action = document.getElementById('plan-action');
const manage = document.getElementById('plan-manage');
const renewal = document.getElementById('plan-renewal');
const query = new URLSearchParams(location.search);
const returned = query.get('checkout');
const googleResult = query.get('account');
const errors = {
  rate_limited: 'Too many requests. Try again in a minute.',
  sign_in_required: 'Sign in again before starting checkout.',
  subscription_exists: 'You already have a subscription. Refresh to manage it.',
  checkout_in_progress: 'A checkout is already open. Finish it or try again after it expires.',
  checkout_paused: 'New memberships are paused. Existing members can still manage billing.',
};

async function request(path, method = 'GET') {
  const res = await fetch(`/api/billing/${path}`, { method, credentials: 'same-origin' });
  const json = await res.json();
  if (!res.ok) throw new Error(errors[json.error] || 'Billing is unavailable right now. Try again shortly.');
  return json;
}

async function redirect(path) {
  const { url } = await request(path, 'POST');
  location.assign(url);
}

function button(element, label, onClick) {
  element.hidden = !label;
  element.textContent = label || '';
  element.onclick = !label ? null : async () => {
    action.disabled = manage.disabled = true;
    try { await onClick(); } catch (err) { status.textContent = err.message; }
    finally { action.disabled = manage.disabled = false; }
  };
}

async function refresh(retries = 5) {
  let info;
  try { info = await request('status'); }
  catch {
    button(action); button(manage); renewal.hidden = true;
    status.textContent = 'Could not load billing. Reload to try again.';
    return;
  }
  if (!info.available) {
    button(action); button(manage); renewal.hidden = true;
    status.textContent = 'Studio Pro is not available yet. The studio is still free.';
    return;
  }
  const formatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: info.plan.currency,
    minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(info.plan.cents / 100);
  price.textContent = `${formatted} / month`;
  renewal.hidden = false;
  const prefix = info.test ? 'Stripe test mode — no real charges. ' : '';
  status.textContent = prefix;
  button(manage, info.manage ? 'Manage billing' : '', () => redirect('portal'));
  if (!info.signedIn && !info.plan.accepting) {
    status.textContent += errors.checkout_paused;
    button(action);
  } else if (!info.signedIn) {
    status.textContent += 'Sign in so you can manage your membership on any device.';
    button(action, 'Sign in', () => openAccount());
  } else if (info.member === 'active') {
    status.textContent += info.ending ? 'Studio Pro is active until your current period ends.' : 'Studio Pro is active.';
    button(action);
  } else if (info.member === 'attention') {
    status.textContent += 'Your subscription needs attention. Check its status in billing.';
    button(action);
  } else if (returned === 'return') {
    status.textContent += retries > 0 ? 'Checking your subscription with Stripe…' : 'Stripe hasn’t confirmed a subscription yet. Check billing or reload this page soon.';
    button(action);
    if (retries > 0) setTimeout(() => refresh(retries - 1), 1800);
  } else if (!info.plan.accepting) {
    status.textContent += errors.checkout_paused;
    button(action);
  } else {
    if (returned === 'canceled') status.textContent += 'Checkout was closed.';
    button(action, 'Get Studio Pro', () => redirect('checkout'));
  }
}

function openAccount(googleResult) {
  openListenerAccount({ googleResult, returnTo: '/pricing', includeSoundCloud: true, onClose: () => refresh() });
}

if (['google_ok', 'google_failed', 'google_conflict'].includes(googleResult)) {
  query.delete('account');
  history.replaceState(null, '', location.pathname + (query.size ? `?${query}` : '') + location.hash);
  if (googleResult !== 'google_ok') openAccount(googleResult);
}
refresh();
