export function createClientCredentials() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return { id: secret.slice(0, 24), secret };
}
