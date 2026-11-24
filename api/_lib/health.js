import { authEnabled } from './accounts.js';
import { redis, redisEnv } from './crate.js';
import { publicConfig } from './soundcloud.js';

export function redisHealthCheck() {
  return redisEnv() ? async () => (await redis(['PING'], { signal: AbortSignal.timeout(2000) })) === 'PONG' : null;
}

export async function handleHealth(method, { checkStorage, env = process.env, accountSecret = env.AUTH_SECRET, uploads = !!env.BLOB_READ_WRITE_TOKEN }) {
  if (method !== 'GET') return { status: 405, json: { error: 'method_not_allowed' } };
  let ready = false;
  try { ready = !!(await checkStorage?.()); } catch {}
  const sha = env.VERCEL_GIT_COMMIT_SHA || '';
  return {
    status: ready ? 200 : 503,
    json: {
      ok: ready,
      commit: /^[a-f0-9]{12,40}$/i.test(sha) ? sha.slice(0, 12) : 'dev',
      storage: ready ? 'ready' : checkStorage ? 'unavailable' : 'not_configured',
      features: { accounts: !!checkStorage && authEnabled(accountSecret), recordedSetUploads: uploads, soundcloud: publicConfig(env).enabled },
    },
  };
}
