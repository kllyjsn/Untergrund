const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function norm(q, v) {
  if (q.curve === 'exp') return Math.log(v / q.min) / Math.log(q.max / q.min);
  return (v - q.min) / (q.max - q.min);
}
export function denorm(q, n) {
  n = clamp(n, 0, 1);
  let v = q.curve === 'exp' ? q.min * Math.pow(q.max / q.min, n) : q.min + n * (q.max - q.min);
  if (q.step) v = Math.round(v / q.step) * q.step;
  return clamp(v, q.min, q.max);
}

const A0 = -135, A1 = 135;
const polar = (cx, cy, r, deg) => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
function arc(cx, cy, r, d0, d1) {
  if (Math.abs(d1 - d0) < 0.01) d1 = d0 + 0.01;
  const [x0, y0] = polar(cx, cy, r, Math.min(d0, d1));
  const [x1, y1] = polar(cx, cy, r, Math.max(d0, d1));
  const large = Math.abs(d1 - d0) > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// main.js hooks user edits on knobs/number boxes to group them into undo steps:
// change(el, label, held) runs before each change (held = during a pointer drag), end() when a drag ends.
export const controlHooks = { change: null, end: null };

// Arrow / Page / Home / End keys for a slider-like control; returns the new value or null.
function keyValue(q, v, e) {
  if (e.key === 'Home') return q.min;
  if (e.key === 'End') return q.max;
  const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[e.key];
  if (!dir) return null;
  if (q.step && q.curve !== 'exp') return clamp(v + dir * q.step, q.min, q.max);
  return denorm(q, norm(q, v) + dir / (e.shiftKey ? 200 : 40));
}
const ariaNum = (v) => String(Math.round(v * 1e4) / 1e4);

// Generic vertical-drag control used by knobs and number boxes.
function dragControl(el, { get, set, q, sens = 180, onStart, onEnd }) {
  let startY = 0, startN = 0, active = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    active = true; startY = e.clientY; startN = norm(q, get());
    el.classList.add('dragging');
    el._held = true;
    onStart?.();
  });
  el.addEventListener('pointermove', (e) => {
    if (!active) return;
    const s = e.shiftKey ? sens * 5 : sens;
    set(denorm(q, startN + (startY - e.clientY) / s));
  });
  const end = () => { if (!active) return; active = false; el._held = false; el.classList.remove('dragging'); controlHooks.end?.(); onEnd?.(); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => set(q.def));
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const stepN = q.step ? q.step / (q.max - q.min) : 0.01;
    const dir = e.deltaY < 0 ? 1 : -1;
    set(denorm(q, norm(q, get()) + dir * stepN * (e.shiftKey ? 0.25 : 1) * (q.step ? 1 : 2)));
  }, { passive: false });
}

export function knob(q, value, onChange, { size = 46, color = 'var(--accent)', format = (v) => v.toFixed(2), cls = '', name = q.label } = {}) {
  const el = document.createElement('div');
  el.className = 'knob ' + cls;
  el.style.setProperty('--kc', color);
  const r = size / 2 - 4, c = size / 2;
  el.innerHTML = `
    <svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle class="k-body" cx="${c}" cy="${c}" r="${r - 5}"/>
      <path class="k-track" d="${arc(c, c, r, A0, A1)}"/>
      <path class="k-val" d=""/>
      <line class="k-ptr" x1="${c}" y1="${c}" x2="${c}" y2="${c - r + 7}"/>
    </svg>
    <div class="k-label">${q.label}</div>
    <div class="k-value"></div>`;
  const val = el.querySelector('.k-val');
  const ptr = el.querySelector('.k-ptr');
  const txt = el.querySelector('.k-value');
  let v = value;
  let draw = () => {
    const n = norm(q, v);
    const deg = A0 + n * (A1 - A0);
    const from = q.bipolar ? 0 : A0;
    val.setAttribute('d', arc(c, c, r, from, deg));
    ptr.setAttribute('transform', `rotate(${deg} ${c} ${c})`);
    txt.textContent = format(v);
  };
  const set = (nv) => { if (nv === v) return; controlHooks.change?.(el, name, !!el._held); v = nv; draw(); onChange(v); };
  dragControl(el, { get: () => v, set, q });
  el.title = `${q.label} — drag, wheel, double-click to reset (shift = fine)`;
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', name);
  el.setAttribute('aria-valuemin', ariaNum(q.min));
  el.setAttribute('aria-valuemax', ariaNum(q.max));
  el.addEventListener('keydown', (e) => {
    const nv = keyValue(q, v, e);
    if (nv == null) return;
    e.preventDefault(); e.stopPropagation();
    set(nv);
  });
  const aria = () => { el.setAttribute('aria-valuenow', ariaNum(v)); el.setAttribute('aria-valuetext', format(v)); };
  const draw0 = draw;
  draw = () => { draw0(); aria(); };
  draw();
  el.dataset.param = q.id;
  el._ctl = { q, get: () => v, set };
  return { el, set: (nv) => { v = nv; draw(); }, get: () => v };
}

export function numBox(q, value, onChange, { format = (v) => String(v), cls = '', name = q.label || '' } = {}) {
  const el = document.createElement('div');
  el.className = 'numbox ' + cls;
  el.tabIndex = 0;
  el.setAttribute('role', 'spinbutton');
  if (name) el.setAttribute('aria-label', name);
  el.setAttribute('aria-valuemin', ariaNum(q.min));
  el.setAttribute('aria-valuemax', ariaNum(q.max));
  let v = value;
  const draw = () => { el.textContent = format(v); el.setAttribute('aria-valuenow', ariaNum(v)); };
  const set = (nv) => { if (nv === v) return; controlHooks.change?.(el, name, !!el._held); v = nv; draw(); onChange(v); };
  dragControl(el, { get: () => v, set, q, sens: 240 });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') return;
    const nv = keyValue({ step: 1, ...q, curve: undefined }, v, e);
    if (nv == null) return;
    e.preventDefault(); e.stopPropagation();
    set(nv);
  });
  draw();
  el._ctl = { q, get: () => v, set };
  return { el, set: (nv) => { v = nv; draw(); }, get: () => v };
}

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}
