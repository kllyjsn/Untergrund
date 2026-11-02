import { drawArtwork } from './artwork.js';
import { rng } from './dsp.js';
import { KEYS, SCALES } from './params.js';
import { STYLES, applyOverrides, arrangement, clone, generate, sanitize } from './state.js';
import { h } from './ui.js';

const PROFILE_KEY = 'untergrund.artist.v1';
const CATALOG_KEY = 'untergrund.catalog.v1';
const TRAITS = [
  ['darkness', 'DARKNESS'],
  ['hypnosis', 'HYPNOSIS'],
  ['acid', 'ACID'],
  ['space', 'SPACE'],
  ['energy', 'ENERGY'],
];
const FIRST = ['Beton', 'Null', 'Tief', 'Stahl', 'Nacht', 'Dunkel', 'Kalt', 'Grau', 'Strom', 'Schacht', 'Blind', 'Leerer'];
const SECOND = ['Ritual', 'Körper', 'Maschine', 'Frequenz', 'Tunnel', 'Werk', 'Druck', 'Kreis', 'Raum', 'Signal', 'Kontakt', 'System'];
const CHAINS = [
  'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH',
  'AABBCCCDEEFFGGGGHHHH',
  'AAAABBCCCDDDDEEFGGGGHHHH',
  'AABBBBCCDDDEEEFFGGGGHH',
];

export const defaultArtistProfile = () => ({
  name: 'UNTERGRUND',
  manifesto: 'Machine music from below. Synths and real players. Every set alive.',
  cadence: 7,
  darkness: 78,
  hypnosis: 72,
  acid: 52,
  space: 38,
  energy: 68,
});

export function loadArtistProfile() {
  try { return { ...defaultArtistProfile(), ...JSON.parse(localStorage.getItem(PROFILE_KEY)) }; }
  catch { return defaultArtistProfile(); }
}

export function saveArtistProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function loadCatalog() {
  try { return JSON.parse(localStorage.getItem(CATALOG_KEY)) || []; }
  catch { return []; }
}

export function saveCatalog(catalog) {
  localStorage.setItem(CATALOG_KEY, JSON.stringify(catalog.slice(-24)));
}

const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
const weighted = (r, entries) => {
  const total = entries.reduce((n, x) => n + Math.max(0, x[1]), 0);
  let roll = r() * total;
  for (const [value, weight] of entries) {
    roll -= Math.max(0, weight);
    if (roll <= 0) return value;
  }
  return entries[0][0];
};

export function chooseArtistStyle(profile, seed) {
  const r = rng(seed);
  return weighted(r, [
    ['hypnotic', 18 + profile.hypnosis * 1.2 + profile.darkness * .25],
    ['industrial', 10 + profile.darkness * .8 + profile.energy * .6],
    ['acid', 8 + profile.acid * 1.4 + profile.energy * .2],
    ['dub', 8 + profile.space * 1.2 + (100 - profile.energy) * .4],
    ['peak', 5 + profile.energy * 1.25],
  ]);
}

function chooseScale(profile, r) {
  return weighted(r, [
    ['minor', 42],
    ['dorian', 12 + (100 - profile.darkness) * .18],
    ['phrygian', 8 + profile.darkness * .48],
    ['harmonic', 8 + profile.acid * .25],
    ['pentatonic', 10 + profile.hypnosis * .28],
  ]);
}

function nextReleaseDate(catalog, cadence, offset = 0) {
  const now = new Date();
  const last = catalog.map((x) => new Date(x.target).getTime()).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const base = Math.max(now.getTime(), last || 0);
  const d = new Date(base + (offset + 1) * cadence * 864e5);
  return d.toISOString().slice(0, 10);
}

export function createArtistProject(baseState, profile, seed = Date.now(), index = 0, catalog = []) {
  const r = rng(seed);
  const style = chooseArtistStyle(profile, seed);
  const scale = chooseScale(profile, r);
  const title = `${pick(r, FIRST)} ${pick(r, SECOND)}`;
  const state = sanitize(clone(baseState));
  state.key = Math.floor(r() * KEYS.length);
  state.scale = scale;
  const g = generate(style, seed, scale);
  state.patterns = arrangement(g.pattern, seed, g.bpm >= 115);
  applyOverrides(state, g, true);
  state.current = 0;
  state.chainOn = true;
  state.chain = pick(r, CHAINS);
  state.swing = Math.max(0, Math.min(.26, .025 + profile.hypnosis / 950 + r() * .035));
  state.master.drive = Math.max(state.master.drive, (profile.darkness + profile.energy) / 320);
  state.master.revLevel = Math.max(.12, Math.min(.68, .12 + profile.space / 180));
  state.master.dlyLevel = Math.max(.08, Math.min(.52, .08 + profile.space / 245));
  state.params.acid.drive = Math.max(state.params.acid.drive, profile.acid / 150);
  state.params.acid.reso = Math.max(state.params.acid.reso, 4 + profile.acid * .19);
  state.params.acid.cutoff = Math.max(110, state.params.acid.cutoff * (.78 + profile.energy / 260));
  state.artist = { name: profile.name, title, style, seed, created: new Date().toISOString() };
  return {
    id: `${seed.toString(36)}-${index}`,
    title,
    artist: profile.name,
    style,
    scale,
    key: state.key,
    bpm: state.bpm,
    seed,
    artworkSeed: Math.floor(r() * 1e9),
    created: new Date().toISOString(),
    target: nextReleaseDate(catalog, profile.cadence, index),
    status: 'draft',
    state,
  };
}

export function createArtistCatalog(baseState, profile, count = 3, seed = Date.now(), existing = []) {
  const made = [];
  for (let i = 0; i < count; i++) made.push(createArtistProject(baseState, profile, seed + i * 7919, i, existing));
  return made;
}

export function openArtistStudio({ getState, loadProject, performProject, publishProject, toast }) {
  let profile = loadArtistProfile();
  let catalog = loadCatalog();
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay', onclick: (e) => e.target === ov && close() });
  const body = h('div', { class: 'artist-body' });
  const modal = h('div', { class: 'modal panel artist-modal' },
    h('div', { class: 'artist-head' },
      h('div', {}, h('div', { class: 'mtitle' }, 'AUTONOMOUS ARTIST'), h('div', { class: 'dim artist-kicker' }, 'identity → musical DNA → live set → release')),
      h('button', { class: 'btn ghost', onclick: close }, 'CLOSE')),
    body);
  ov.append(modal);
  document.body.append(ov);
  const onKey = (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); };
  window.addEventListener('keydown', onKey, true);
  new MutationObserver((_, o) => {
    if (!ov.isConnected) { window.removeEventListener('keydown', onKey, true); o.disconnect(); }
  }).observe(document.body, { childList: true });

  const saveProfile = () => {
    saveArtistProfile(profile);
    toast(`${profile.name} DNA saved`);
  };

  function field(label, el) {
    return h('label', { class: 'artist-field' }, h('span', {}, label), el);
  }

  function trait([id, label]) {
    const value = h('b', {}, String(profile[id]));
    const input = h('input', {
      type: 'range', min: 0, max: 100, value: profile[id],
      oninput: (e) => { profile[id] = +e.target.value; value.textContent = e.target.value; },
      onchange: saveProfile,
    });
    return h('label', { class: 'dna-trait' }, h('span', {}, label), input, value);
  }

  function render() {
    body.innerHTML = '';
    const name = h('input', { class: 'inp artist-name', value: profile.name, maxlength: 32, onchange: (e) => { profile.name = e.target.value.trim() || 'UNTERGRUND'; saveProfile(); render(); } });
    const manifesto = h('textarea', { class: 'inp', rows: 3, maxlength: 220, onchange: (e) => { profile.manifesto = e.target.value.trim(); saveProfile(); } });
    manifesto.value = profile.manifesto;
    const cadence = h('select', { class: 'sel', onchange: (e) => { profile.cadence = +e.target.value; saveProfile(); } },
      [[7, 'WEEKLY'], [14, 'EVERY 2 WEEKS'], [30, 'MONTHLY']].map(([v, label]) => {
        const o = h('option', { value: v }, label); if (profile.cadence === v) o.selected = true; return o;
      }));

    const identity = h('section', { class: 'artist-identity' },
      h('div', { class: 'artist-profile' },
        h('div', { class: 'artist-monogram' }, profile.name.slice(0, 2).toUpperCase()),
        h('div', { class: 'artist-profile-fields' }, field('ARTIST NAME', name), field('MANIFESTO', manifesto), field('RELEASE RHYTHM', cadence))),
      h('div', { class: 'dna' }, h('div', { class: 'artist-label' }, 'MUSICAL DNA'), TRAITS.map(trait)));

    const make = (count) => {
      const made = createArtistCatalog(getState(), profile, count, Date.now(), catalog);
      catalog = [...catalog, ...made];
      saveCatalog(catalog);
      toast(count === 1 ? `Created “${made[0].title}”` : `Created ${count}-track release`);
      render();
    };
    const controls = h('section', { class: 'artist-create' },
      h('div', {},
        h('div', { class: 'artist-label' }, 'THE MACHINE BECOMES THE ARTIST'),
        h('p', {}, 'Each release is a playable eight-scene project generated from this identity. Load it, let Artist Live perform it, or publish it as-is.')),
      h('div', { class: 'artist-actions' },
        h('button', { class: 'btn', onclick: () => make(1) }, 'CREATE TRACK'),
        h('button', { class: 'btn accent', onclick: () => make(3) }, 'CREATE 3-TRACK RELEASE')));

    const list = h('section', { class: 'artist-catalog' },
      h('div', { class: 'catalog-head' },
        h('div', {}, h('div', { class: 'artist-label' }, 'RELEASE CATALOG'), h('span', { class: 'dim' }, `${catalog.length} projects · stored in this browser`)),
        catalog.length ? h('button', { class: 'btn ghost', onclick: () => { if (confirm('Clear the generated catalog?')) { catalog = []; saveCatalog(catalog); render(); } } }, 'CLEAR') : null),
      catalog.length ? catalog.slice().reverse().map(releaseCard) : h('div', { class: 'catalog-empty' }, 'No releases yet. Create one from the artist DNA above.'));

    body.append(identity, controls, list);
  }

  function releaseCard(item) {
    const art = h('div', { class: 'catalog-art' });
    art.append(drawArtwork(item.state, { title: item.title, style: STYLES[item.style].name, seed: item.artworkSeed, size: 320 }));
    const date = h('input', {
      class: 'inp', type: 'date', value: item.target,
      onchange: (e) => { item.target = e.target.value; saveCatalog(catalog); },
    });
    const status = h('select', { class: 'sel', onchange: (e) => { item.status = e.target.value; saveCatalog(catalog); render(); } },
      ['draft', 'ready', 'published'].map((v) => {
        const o = h('option', { value: v }, v.toUpperCase()); if (item.status === v) o.selected = true; return o;
      }));
    const use = (fn) => { close(); fn(item); };
    return h('article', { class: `catalog-card ${item.status}` },
      art,
      h('div', { class: 'catalog-info' },
        h('div', { class: 'catalog-title' }, item.title),
        h('div', { class: 'catalog-meta' }, `${STYLES[item.style].name} · ${item.bpm} BPM · ${KEYS[item.key]} ${SCALES[item.scale].name}`),
        h('div', { class: 'catalog-plan' }, field('RELEASE', date), field('STATUS', status)),
        h('div', { class: 'catalog-actions' },
          h('button', { class: 'btn ghost', onclick: () => use(loadProject) }, 'LOAD'),
          h('button', { class: 'btn live', onclick: () => use(performProject) }, 'ARTIST LIVE'),
          h('button', { class: 'btn sc', onclick: () => use(publishProject) }, 'PUBLISH'))));
  }

  render();
}
