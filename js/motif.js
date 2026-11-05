// Motif development: how a writer keeps one hook recognisable while it travels through a song.
// Hook steps are [semitone, length, velocity] on a 32-step (2-bar) call and answer.
const mod = (x, n) => ((x % n) + n) % n;
const degs = (scale) => scale.filter((n) => n < 12);

// Scale-degree index of a semitone (null when it's outside the scale) and back.
export function degOf(n, scale) {
  const d = degs(scale), i = d.indexOf(mod(n, 12));
  return i < 0 ? null : i + d.length * Math.floor(n / 12);
}
export const semiOf = (k, scale) => { const d = degs(scale); return d[mod(k, d.length)] + 12 * Math.floor(k / d.length); };
export function stepDeg(n, k, scale) {
  const i = degOf(n, scale);
  return i === null || !k ? n : semiOf(i + k, scale);
}

const notesIn = (s, a, b) => { const o = []; for (let i = a; i < b; i++) if (s[i]) o.push(i); return o; };
// Note lengths never run past the next note or the end of their bar.
function fit(out) {
  for (let i = 0; i < 32; i++) if (out[i]) {
    let j = i + 1; while (j < 32 && !out[j] && j % 16) j++;
    out[i] = [out[i][0], Math.max(1, Math.min(out[i][1], j - i)), out[i][2]];
  }
  return out;
}

export const DEVELOP = ['answer', 'sequence', 'displace', 'fragment'];

// The same motif, varied: a new answer ending, the call sequenced up a third, the rhythm displaced by
// an eighth, or the call's head fragmented and climbing. 'contrast' is the breakdown's B-phrase: the
// call augmented to half speed with its contour inverted, landing on the fifth to lead back home.
export function develop(s, kind, scale) {
  if (!s || !kind || kind === 'orig') return s;
  const out = Array(32).fill(0), call = notesIn(s, 0, 16), ans = notesIn(s, 16, 32);
  const N = degs(scale).length, sh = (st, k, v = 1) => [stepDeg(st[0], k, scale), st[1], Math.min(1, st[2] * v)];
  if (!call.length) return s;
  if (kind === 'answer' && ans.length) {
    s.forEach((x, i) => { out[i] = x; });
    const last = ans[ans.length - 1], d = degOf(s[last][0], scale) ?? 0;
    out[last] = sh(s[last], mod(d, N) === 0 ? 4 : -mod(d, N) + (mod(d, N) > N / 2 ? N : 0));
    if (ans.length > 1) out[ans[ans.length - 2]] = sh(s[ans[ans.length - 2]], mod(d, N) === 0 ? 2 : 1);
  } else if (kind === 'sequence') {
    for (const i of call) { out[i] = s[i]; out[16 + i] = sh(s[i], 2, 0.97); }
    const lastA = ans[ans.length - 1];
    if (lastA !== undefined) { const i = call[call.length - 1]; out[16 + i] = [s[lastA][0], s[16 + i]?.[1] ?? s[i][1], s[lastA][2]]; }
  } else if (kind === 'displace') {
    for (const i of [...call, ...ans]) { const b = i < 16 ? 0 : 16, j = b + ((i - b + 2) % 16); if (!out[j]) out[j] = s[i]; }
  } else if (kind === 'fragment') {
    const head = notesIn(s, 0, 8);
    if (!head.length) return develop(s, 'sequence', scale);
    for (const i of call) out[i] = s[i];
    for (const i of head) { out[16 + i] = sh(s[i], 1, 0.94); out[24 + i] = sh(s[i], 2); }
  } else if (kind === 'contrast') {
    const d0 = degOf(s[call[0]][0], scale) ?? 0;
    call.forEach((i, j) => {
      const d = degOf(s[i][0], scale) ?? d0, inv = Math.max(d0 - 5, Math.min(d0 + 7, 2 * d0 - d));
      out[2 * i] = [semiOf(inv, scale), s[i][1] * 2, Math.max(0.6, s[i][2] * 0.9)];
      if (j === call.length - 1) out[2 * i][0] = semiOf(Math.floor(d0 / N) * N + 4, scale);
    });
  } else return s;
  return fit(out);
}

// Which version of the hook plays in this 2-bar cycle of a song: it is stated twice first, comes
// home every third cycle and in the last four bars, and the breakdown gets its own B-phrase.
export function motifPlan(bar, songBars, scene, salt = 0) {
  if (scene === 4 || scene === 5) return 'contrast';
  const b = mod(bar, songBars || 1), c = b >> 1;
  if (!songBars || c < 2 || c % 3 === 0 || b >= songBars - 4) return 'orig';
  return DEVELOP[(c + salt) % DEVELOP.length];
}
