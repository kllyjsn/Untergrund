export function allocateChainIds(ids, count) {
  const used = new Set(ids), out = [];
  let next = 0;
  while (out.length < count) {
    while (used.has(next)) next++;
    out.push(next); used.add(next++);
  }
  return out;
}

export function cleanChainEntries(chain, entries) {
  if (typeof chain !== 'string' || !Array.isArray(entries) || entries.length !== chain.length) return null;
  const out = [], used = new Set();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || !Number.isInteger(e.p) || e.p < 0 || e.p > 7 || e.p !== chain.charCodeAt(i) - 65) return null;
    const id = Number.isSafeInteger(e.id) && e.id >= 0 && !used.has(e.id) ? e.id : undefined;
    if (id != null) used.add(id);
    out.push({ p: e.p, ...(Number.isInteger(e.sec) && e.sec >= 0 && e.sec < 128 ? { sec: e.sec } : {}), ...(id != null ? { id } : {}) });
  }
  return out;
}

export function identifyChainEntries(chain, entries, reserved = []) {
  const out = cleanChainEntries(chain, entries);
  if (!out || !out.some(e => e.sec != null || e.id != null)) return out;
  const ids = allocateChainIds([...reserved, ...out.map(e => e.id)], out.filter(e => e.id == null).length);
  let next = 0;
  return out.map(e => e.id == null ? { ...e, id: ids[next++] } : e);
}
