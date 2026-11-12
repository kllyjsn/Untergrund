// Prints a fresh VAPID key pair for Daily Drop notifications. Paste both into Vercel env vars; never commit them.
import { generateVapidKeys } from '../api/_lib/webpush.js';

const { publicKey, privateKey } = generateVapidKeys();
console.log(`VAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${privateKey}`);
