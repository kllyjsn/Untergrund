// Undo/redo history of labelled snapshots. Snapshots are opaque (main.js stores JSON strings).
export const LIMIT = 40;

export function createHistory(limit = LIMIT) {
  const past = [], future = [];
  const cap = (list) => { while (list.length > limit) list.shift(); };
  return {
    // A new edit: remember the state before it and forget anything that could be redone.
    push(snap, label = '') {
      past.push({ snap, label });
      cap(past);
      future.length = 0;
    },
    // Returns the entry to restore, or null; `current` is kept so redo can come back to it.
    undo(current) {
      const e = past.pop();
      if (!e) return null;
      future.push({ snap: current, label: e.label });
      cap(future);
      return e;
    },
    redo(current) {
      const e = future.pop();
      if (!e) return null;
      past.push({ snap: current, label: e.label });
      cap(past);
      return e;
    },
    // Rewrite the latest undo entry (e.g. tag a genre switch with the genre it came from).
    amend(fn) { if (past.length) past[past.length - 1].snap = fn(past[past.length - 1].snap); },
    relabel(label) { if (past.length) past[past.length - 1].label = label; },
    peek: () => past[past.length - 1] || null,
    get depth() { return past.length; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    clear() { past.length = 0; future.length = 0; },
  };
}

// Coalesces a burst of changes (one knob drag, a run of wheel ticks or arrow keys) into one undo step:
// `begin(key)` returns true only for the first call of a gesture; `end()` closes a pointer gesture, so the next drag is its own step.
export function gesture(idleMs = 700, now = () => Date.now()) {
  let key = null, held = false, last = -Infinity;
  return {
    begin(k, hold = false) {
      const t = now();
      const fresh = k !== key || (!held && t - last > idleMs);
      key = k; last = t; if (hold) held = true;
      return fresh;
    },
    end() { key = null; held = false; },
    reset() { key = null; held = false; },
  };
}
