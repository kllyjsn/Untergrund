import { remapTakes } from './scope.js';
import { allocateChainIds, identifyChainEntries } from './chain-entries.js';
export { cleanChainEntries, identifyChainEntries } from './chain-entries.js';

export function editChainEntries(before, after, entries, at = Infinity) {
  const old = identifyChainEntries(before, entries);
  if (!old || typeof after !== 'string' || /[^A-H]/.test(after)) return null;
  let start = 0, end = before.length, nextEnd = after.length;
  while (start < end && start < nextEnd && start < at && before[start] === after[start]) start++;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) { end--; nextEnd--; }
  const added = [];
  const ids = old.some(e => e.id != null) ? allocateChainIds(old.map(e => e.id), nextEnd - start) : [];
  for (let i = start; i < nextEnd; i++) {
    const sec = old[Math.min(i, end - 1)]?.sec ?? old[start - 1]?.sec ?? old[end]?.sec;
    added.push({ p: after.charCodeAt(i) - 65, ...(sec != null ? { sec } : {}), ...(ids[i - start] != null ? { id: ids[i - start] } : {}) });
  }
  return [...old.slice(0, start), ...added, ...old.slice(end)];
}

export function setChain(state, chain, entries, at) {
  const before = identifyChainEntries(state.chain, state.chainEntries);
  const tagged = entries ? identifyChainEntries(chain, entries, before?.map(e => e.id)) : editChainEntries(state.chain, chain, before, at);
  remapTakes(state.patterns, state.chain, chain, before, tagged);
  state.chain = chain;
  if (tagged) state.chainEntries = tagged; else delete state.chainEntries;
}
