import { remapTakes } from './scope.js';

export function cleanChainEntries(chain, entries) {
  if (typeof chain !== 'string' || !Array.isArray(entries) || entries.length !== chain.length) return null;
  const out = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || !Number.isInteger(e.p) || e.p < 0 || e.p > 7 || e.p !== chain.charCodeAt(i) - 65) return null;
    out.push({ p: e.p, ...(Number.isInteger(e.sec) && e.sec >= 0 && e.sec < 128 ? { sec: e.sec } : {}) });
  }
  return out;
}

export function editChainEntries(before, after, entries, at = Infinity) {
  const old = cleanChainEntries(before, entries);
  if (!old || typeof after !== 'string' || /[^A-H]/.test(after)) return null;
  let start = 0, end = before.length, nextEnd = after.length;
  while (start < end && start < nextEnd && start < at && before[start] === after[start]) start++;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  const added = [];
  for (let i = start; i < nextEnd; i++) {
    const sec = old[Math.min(i, end - 1)]?.sec ?? old[start - 1]?.sec ?? old[end]?.sec;
    added.push({ p: after.charCodeAt(i) - 65, ...(sec != null ? { sec } : {}) });
  }
  return [...old.slice(0, start), ...added, ...old.slice(end)];
}

export function setChain(state, chain, entries, at) {
  const tagged = entries ? cleanChainEntries(chain, entries) : editChainEntries(state.chain, chain, state.chainEntries, at);
  remapTakes(state.patterns, state.chain, chain);
  state.chain = chain;
  if (tagged) state.chainEntries = tagged; else delete state.chainEntries;
}
