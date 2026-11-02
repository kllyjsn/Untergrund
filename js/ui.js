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

// Generic vertical-drag control used by knobs and number boxes.
function dragControl(el, { get, set, q, sens = 180, onStart, onEnd }) {
  let startY = 0, startN = 0, active = false;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    active = true; startY = e.clientY; startN = norm(q, get());
    el.classList.add('dragging');
    onStart?.();
  });
  el.addEventListener('pointermove', (e) => {
    if (!active) return;
    const s = e.shiftKey ? sens * 5 : sens;
    set(denorm(q, startN + (startY - e.clientY) / s));
  });
  const end = () => { if (!active) return; active = false; el.classList.remove('dragging'); onEnd?.(); };
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

export function knob(q, value, onChange, { size = 46, color = 'var(--accent)', format = (v) => v.toFixed(2), cls = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'knob ' + cls;
  el.style.setProperty('--kc', color);
  const r = size / 2 - 4, c = size / 2;
  el.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
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
  const set = (nv) => { if (nv === v) return; v = nv; draw(); onChange(v); };
  dragControl(el, { get: () => v, set, q });
  el.title = `${q.label} — drag, wheel, double-click to reset (shift = fine)`;
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', q.label);
  el.setAttribute('aria-valuemin', q.min);
  el.setAttribute('aria-valuemax', q.max);
  el.addEventListener('keydown', (e) => {
    const dir = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (!dir) return;
    e.preventDefault(); e.stopPropagation();
    const step = q.step || (q.max - q.min) / (e.shiftKey ? 200 : 40);
    set(clamp(v + dir * step, q.min, q.max));
  });
  const aria = () => { el.setAttribute('aria-valuenow', v); el.setAttribute('aria-valuetext', format(v)); };
  const draw0 = draw;
  draw = () => { draw0(); aria(); };
  draw();
  return { el, set: (nv) => { v = nv; draw(); }, get: () => v };
}

export function numBox(q, value, onChange, { format = (v) => String(v), cls = '' } = {}) {
  const el = document.createElement('div');
  el.className = 'numbox ' + cls;
  el.tabIndex = 0;
  let v = value;
  const draw = () => { el.textContent = format(v); };
  const set = (nv) => { if (nv === v) return; v = nv; draw(); onChange(v); };
  dragControl(el, { get: () => v, set, q, sens: 240 });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      set(clamp(v + (e.key === 'ArrowUp' ? 1 : -1) * (q.step || 1), q.min, q.max));
    }
  });
  draw();
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
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(c));
  return el;
}
