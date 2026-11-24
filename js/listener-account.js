import { accountAction, getAccount } from './account.js';
import { STYLES } from './state.js';
import { h } from './ui.js';

const errors = {
  invalid_email: 'Enter a valid email address.',
  invalid_password: 'Use at least 12 characters and no more than 256 bytes.',
  invalid_credentials: 'That email or password doesn’t match.',
  email_unavailable: 'That email already has an account. Try signing in instead.',
  rate_limited: 'Too many attempts. Wait a few minutes and try again.',
  invalid_reset: 'That reset link has expired or already been used. Request a new one.',
  sign_in_required: 'Sign in to continue.',
  already_signed_in: 'You’re already signed in. Sign out before creating another account.',
  already_linked: 'Your account is already connected to Google.',
  account_conflict: 'Your account changed in another tab. Try again.',
  google_unavailable: 'Google sign-in isn’t available here.',
  reset_unavailable: 'Password reset isn’t available here.',
};
const button = (text, onclick, cls = 'btn ghost') => h('button', { type: 'button', class: cls, onclick }, text);
const submit = (text) => h('button', { type: 'submit', class: 'btn accent listener-submit' }, text);
const input = (label, attrs) => {
  const el = h('input', { class: 'inp listener-input', ...attrs });
  return [h('label', { class: 'listener-field' }, h('span', {}, label), el), el];
};
const password = (label, fresh = false) => input(label, { type: 'password', required: '', autocomplete: fresh ? 'new-password' : 'current-password',
  ...(fresh && { minlength: 12 }), maxlength: 256 });
const emailField = (value) => input('Email address', { type: 'email', autocomplete: 'username', autocapitalize: 'none',
  spellcheck: 'false', required: '', maxlength: 254, value });

let active;

export function openListenerAccount({ googleResult, resetToken } = {}) {
  if (active?.open) return;
  const opener = document.activeElement;
  const dialog = h('dialog', { class: 'listener-dialog', 'aria-labelledby': 'listener-title',
    onkeydown: (e) => e.stopPropagation(), onkeyup: (e) => e.stopPropagation() });
  active = dialog;
  const title = h('h2', { id: 'listener-title', tabindex: '-1' }, 'Your account');
  const content = h('div', { class: 'listener-content', 'aria-busy': 'true' }, 'Loading your account…');
  const status = h('p', { class: 'listener-status', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
  const notify = (text = '', bad = false) => {
    status.textContent = text;
    status.classList.toggle('bad', bad);
  };
  const close = button('Close', () => dialog.close(), 'btn ghost listener-close');
  dialog.append(h('header', { class: 'listener-heading' },
    h('div', {}, h('span', { class: 'listener-eyebrow' }, 'UNTERGRUND / ACCOUNT'), title), close), content, status);
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (opener?.isConnected) opener.focus();
    else document.querySelector('.listener-entry')?.focus();
  });
  document.body.append(dialog);
  dialog.showModal();
  title.focus();

  let auth = {}, account, mode = resetToken ? 'reset' : 'login', priorEmail = '';
  const googleButton = (link) => button(link ? 'Connect Google' : 'Continue with Google', async (e) => {
    const trigger = e.currentTarget;
    trigger.disabled = true;
    notify('Connecting to Google…');
    try {
      const { url } = await accountAction('google-start', { link });
      location.assign(url);
    } catch (err) {
      notify(errors[err.message] || 'Couldn’t connect to Google. Try again.', true);
      trigger.disabled = false;
    }
  }, 'btn listener-google');

  function makeForm(fields, go, work) {
    const form = h('form', { class: 'listener-form', onsubmit: async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      notify();
      go.disabled = true;
      form.setAttribute('aria-busy', 'true');
      try { await work(); }
      catch (err) { notify(errors[err.message] || 'Something went wrong. Please try again.', true); }
      finally { go.disabled = false; form.removeAttribute('aria-busy'); }
    } }, fields, go);
    return form;
  }

  function switchMode(value, email) {
    mode = value;
    if (email) priorEmail = email.value;
    render(true);
  }

  function render(focus = false) {
    if (!dialog.open) return;
    notify();
    content.removeAttribute('aria-busy');
    let focusOn = title;
    if (mode === 'reset' && auth.reset) {
      title.textContent = 'Reset your password';
      const [label, field] = password('New password', true);
      focusOn = field;
      content.replaceChildren(h('p', { class: 'listener-intro' }, 'Choose a new password with at least 12 characters. Other devices will be signed out, and you’ll need to reconnect Google if you used it.'),
        makeForm([label], submit('Set new password'), async () => {
          ({ account } = await accountAction('reset-password', { token: resetToken, password: field.value }));
          resetToken = null;
          mode = 'login';
          render(true);
          notify('Password updated. You’re signed in.');
        }), button('Back to account', () => switchMode('login')));
    } else if (account && !account.anon) {
      title.textContent = 'Your account';
      const prefs = account.listener || {};
      const [nameLabel, name] = input('Display name', { type: 'text', maxlength: 40, autocomplete: 'nickname',
        placeholder: 'Optional', value: prefs.displayName ?? account.name ?? '' });
      const genres = Object.entries(STYLES);
      const checks = genres.map(([id]) => [id, h('input', { type: 'checkbox', ...(prefs.favoriteGenres?.includes(id) && { checked: '' }) })]);
      const count = () => checks.filter(([, el]) => el.checked).length;
      const summaryLabel = () => `Choose genres · ${count()} selected`;
      const summary = h('summary', {}, summaryLabel());
      const choices = h('details', { class: 'listener-choices', onchange: () => { summary.textContent = summaryLabel(); } }, summary,
        h('div', { class: 'listener-genres' }, checks.map(([id, el]) => h('label', {}, el, h('span', {}, STYLES[id].name)))));
      const favorite = h('fieldset', { class: 'listener-favorites' }, h('legend', {}, 'Favorite genres'),
        h('p', { class: 'listener-intro' }, 'Your favorites are pinned above the genre picker.'), choices);
      const genre = h('select', { class: 'listener-input' }, h('option', { value: '' }, 'No default'),
        genres.map(([id, entry]) => h('option', { value: id, ...(id === prefs.defaultGenre && { selected: '' }) }, entry.name)));
      const profile = makeForm([
        h('h3', {}, 'Listening profile'),
        h('p', { class: 'listener-intro' }, 'These settings are private and follow you across devices.'),
        nameLabel, h('label', { class: 'listener-field' }, h('span', {}, 'Start in this genre'), genre), favorite,
      ], submit('Save preferences'), async () => {
        ({ account } = await accountAction('preferences', { displayName: name.value,
          defaultGenre: genre.value || null, favoriteGenres: checks.filter(([, el]) => el.checked).map(([id]) => id) }));
        notify('Preferences saved.');
      });
      const security = h('section', { class: 'listener-security' }, h('h3', {}, 'Sign-in methods'),
        account.email && h('p', { class: 'listener-identity' }, account.email),
        account.providers.includes('google') && h('p', { class: 'listener-intro' }, 'Google connected'),
        account.providers.includes('soundcloud') && h('p', { class: 'listener-intro' }, 'SoundCloud connected'),
        auth.google && !account.providers.includes('google') && googleButton(true));
      if (account.providers.includes('email')) {
        const [currentLabel, current] = password('Current password'), [newLabel, next] = password('New password', true);
        const details = h('details', {},
          h('summary', {}, 'Change password'),
          h('p', { class: 'listener-intro' }, 'Use at least 12 characters. Changing your password signs out other devices.'),
          makeForm([currentLabel, newLabel], submit('Update password'), async () => {
            ({ account } = await accountAction('password-change', { currentPassword: current.value, password: next.value }));
            current.value = next.value = '';
            details.open = false;
            details.querySelector('summary').focus();
            notify('Password updated.');
          }));
        security.append(details);
      }
      content.replaceChildren(profile, security, button('Sign out', async () => {
        try { await accountAction('signout'); account = null; switchMode('login'); notify('Signed out.'); }
        catch { notify('Couldn’t sign out. Try again.', true); }
      }));
    } else if (mode === 'forgot') {
      title.textContent = 'Forgot your password?';
      const [label, email] = emailField(priorEmail);
      focusOn = email;
      content.replaceChildren(h('p', { class: 'listener-intro' }, 'We’ll send a reset link if that email is registered.'),
        makeForm([label], submit('Send reset link'), async () => {
          await accountAction('reset-request', { email: email.value });
          notify('If an account matches, a reset link is on its way.');
        }), button('Back to sign in', () => switchMode('login', email)));
    } else {
      const signup = mode === 'signup';
      title.textContent = signup ? 'Create an account' : 'Sign in';
      const [emailLabel, email] = emailField(priorEmail), [passwordLabel, pass] = password('Password', signup);
      focusOn = email;
      content.replaceChildren(h('p', { class: 'listener-intro' }, signup
        ? 'Keep your favorite genres and listening profile wherever you listen.'
        : 'Pick up where you left off on any device.'),
      makeForm([emailLabel, passwordLabel, signup && h('p', { class: 'listener-intro', id: 'listener-password-help' }, 'Use at least 12 characters.'), auth.reset && !signup &&
        button('Forgot password?', () => switchMode('forgot', email), 'btn ghost listener-text')], submit(signup ? 'Create account' : 'Sign in'), async () => {
        ({ account } = await accountAction(signup ? 'email-signup' : 'email-login', { email: email.value, password: pass.value }));
        priorEmail = '';
        render(true);
        notify(signup ? 'Account created.' : 'Signed in.');
      }),
      ...(auth.google ? [h('div', { class: 'listener-alternative' }, h('span', {}, 'or'), googleButton(false))] : []),
      h('div', { class: 'listener-switch' }, signup ? 'Already have an account?' : 'New to Untergrund?',
        button(signup ? 'Sign in instead' : 'Create an account', () => switchMode(signup ? 'login' : 'signup', email))));
      if (signup) pass.setAttribute('aria-describedby', 'listener-password-help');
    }
    if (focus) focusOn.focus();
  }

  getAccount(true).then((state) => {
    if (!dialog.open) return;
    if (!state.enabled) {
      content.removeAttribute('aria-busy');
      content.textContent = 'Accounts are unavailable right now. You can still listen and make music.';
      return;
    }
    ({ account, auth = {} } = state);
    render();
    if (googleResult === 'google_ok') notify('Google connected.');
    if (googleResult === 'google_failed') notify('Google sign-in didn’t complete. Try again.', true);
    if (googleResult === 'google_conflict') notify('That Google account is already linked to another Untergrund account.', true);
    if (resetToken && !auth.reset) notify(errors.reset_unavailable, true);
  });
}
