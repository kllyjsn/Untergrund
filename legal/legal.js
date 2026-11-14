const form = document.querySelector('#legal-form');
const status = document.querySelector('#legal-status');

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = 'Submitting…';
  const data = Object.fromEntries(new FormData(form));
  data.attest = data.attest === 'on';
  try {
    const response = await fetch('/api/legal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'submission_failed');
    form.reset();
    status.textContent = `Request received. Keep reference ${body.id}.`;
  } catch {
    status.textContent = 'The request could not be stored. Please try again later.';
  } finally {
    button.disabled = false;
  }
});
