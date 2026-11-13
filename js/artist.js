import { drawArtwork } from './artwork.js';
import { rng } from './dsp.js';
import { KEYS, SCALES } from './params.js';
import { STYLES, MAJOR_STYLES, applyOverrides, arrangement, clone, generate, sanitize } from './state.js';
import { h } from './ui.js';
import { accountPanel, syncProfile } from './account.js';
import { jbTile, myPublished } from './sets.js';

const PROFILE_KEY = 'untergrund.artist.v1';
const CATALOG_KEY = 'untergrund.catalog.v1';
const MORE_KEY = 'untergrund.artist.more';
export const TRAITS = [
  ['darkness', 'DARKNESS', 'darker scales, more distortion'],
  ['hypnosis', 'HYPNOSIS', 'trance-like loops, more swing'],
  ['acid', 'ACID', 'squelchier, more resonant bassline'],
  ['space', 'SPACE', 'more reverb, echo and room'],
  ['energy', 'ENERGY', 'harder, peak-time styles'],
  ['songs', 'SONGS', 'pop, rock, R&B, country and folk songs with a band'],
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
  songs: 0,
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
    // Song genres only once the artist turns SONGS up, so existing techno artists keep their sound.
    ['rock', (profile.songs || 0) * (0.4 + profile.energy / 200)],
    ['pop', (profile.songs || 0) * (0.3 + (100 - profile.darkness) / 250)],
    ['rnb', (profile.songs || 0) * (0.2 + profile.space / 300)],
    ['country', (profile.songs || 0) * 0.25],
    ['folk', (profile.songs || 0) * (0.2 + (100 - profile.energy) / 300)],
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
  state.scale = MAJOR_STYLES.has(style) ? 'major' : scale;
  const g = generate(style, seed, state.scale);
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

export function openArtistStudio({ getState, loadProject, performProject, publishProject, publishCurrent, toast }) {
  let profile = loadArtistProfile();
  let moreOpen = localStorage.getItem(MORE_KEY) === '1';
  let catalog = loadCatalog();
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Your page', onclick: (e) => e.target === ov && close() });
  const body = h('div', { class: 'artist-body' });
  const modal = h('div', { class: 'modal panel artist-modal' },
    h('div', { class: 'artist-head' },
      h('div', {}, h('div', { class: 'mtitle' }, 'YOUR PAGE'), h('div', { class: 'artist-kicker' }, 'One link for every song you publish.')),
      h('button', { class: 'btn ghost', onclick: close }, 'CLOSE')),
    body);
  ov.append(modal);
  document.body.append(ov);
  const onKey = (e) => { if (e.key === 'Escape') close(); e.stopPropagation(); };
  window.addEventListener('keydown', onKey, true);
  new MutationObserver((_, o) => {
    if (!ov.isConnected) { window.removeEventListener('keydown', onKey, true); o.disconnect(); }
  }).observe(document.body, { childList: true });

  const accountProfile = () => {
    const d = defaultArtistProfile();
    return {
      ...(profile.name && profile.name !== d.name && { name: profile.name }),
      ...(profile.manifesto !== d.manifesto && { bio: profile.manifesto || '' }),
      dna: Object.fromEntries(TRAITS.map(([id]) => [id, profile[id]])),
    };
  };
  const saveProfile = () => {
    saveArtistProfile(profile);
    syncProfile(accountProfile());
    toast('Saved');
  };

  function field(label, el) {
    return h('label', { class: 'artist-field' }, h('span', {}, label), el);
  }

  function trait([id, label, help]) {
    const value = h('b', {}, String(profile[id]));
    const input = h('input', {
      type: 'range', min: 0, max: 100, value: profile[id],
      oninput: (e) => { profile[id] = +e.target.value; value.textContent = e.target.value; },
      onchange: saveProfile,
    });
    input.setAttribute('aria-label', `${label}: ${help}`);
    return h('label', { class: 'dna-trait', title: help }, h('span', {}, label, h('small', {}, help)), input, value);
  }

  function render() {
    body.innerHTML = '';
    const name = h('input', { class: 'inp artist-name', value: profile.name, maxlength: 32, onchange: (e) => { profile.name = e.target.value.trim() || 'UNTERGRUND'; saveProfile(); render(); } });
    const manifesto = h('textarea', { class: 'inp', rows: 3, maxlength: 220, onchange: (e) => { profile.manifesto = e.target.value.trim(); saveProfile(); } });
    manifesto.value = profile.manifesto;
    const cadence = h('select', { class: 'sel', onchange: (e) => { profile.cadence = +e.target.value; saveProfile(); } },
      [[7, 'EVERY WEEK'], [14, 'EVERY 2 WEEKS'], [30, 'EVERY MONTH']].map(([v, label]) => {
        const o = h('option', { value: v }, label); if (profile.cadence === v) o.selected = true; return o;
      }));

    const identity = h('section', { class: 'artist-identity' },
      h('div', { class: 'artist-profile' },
        h('div', { class: 'artist-monogram' }, profile.name.slice(0, 2).toUpperCase()),
        h('div', { class: 'artist-profile-fields' }, field('ARTIST NAME', name), field('ABOUT YOU', manifesto), field('NEW RELEASE', cadence))),
      h('div', { class: 'dna' }, h('div', { class: 'artist-label' }, 'YOUR SOUND'), TRAITS.map(trait)));

    const make = (count) => {
      const made = createArtistCatalog(getState(), profile, count, Date.now(), catalog);
      catalog = [...catalog, ...made];
      saveCatalog(catalog);
      toast(count === 1 ? `Made “${made[0].title}”` : `Made ${count} tracks`);
      render();
    };
    const controls = h('section', { class: 'artist-create' },
      h('div', {},
        h('div', { class: 'artist-label' }, 'TRACKS MADE FOR YOU'),
        h('p', {}, 'UNTERGRUND writes full songs in your sound. Open one in Studio, play it live, or publish it as it is.')),
      h('div', { class: 'artist-actions' },
        h('button', { class: 'btn', onclick: () => make(1) }, 'MAKE ONE'),
        h('button', { class: 'btn', onclick: () => make(3) }, 'MAKE THREE')));

    const list = h('section', { class: 'artist-catalog' },
      h('div', { class: 'catalog-head' },
        h('div', {}, h('div', { class: 'artist-label' }, 'DRAFTS'), h('span', { class: 'artist-dim' }, `${catalog.length} ${catalog.length === 1 ? 'track' : 'tracks'} · saved in this browser`)),
        catalog.length ? h('button', { class: 'btn ghost', onclick: () => { if (confirm('Clear all drafts?')) { catalog = []; saveCatalog(catalog); render(); } } }, 'CLEAR') : null),
      catalog.length ? catalog.slice().reverse().map(releaseCard) : h('div', { class: 'catalog-empty' }, 'No drafts yet. Tap MAKE ONE above.'));

    const more = h('details', { class: 'artist-more' },
      h('summary', {}, h('span', {}, h('b', {}, 'Artist profile and auto-releases'), h('small', {}, 'Your name, bio and sound, plus tracks UNTERGRUND makes for you.'))),
      h('div', { class: 'artist-more-body' }, identity, controls, list));
    more.open = moreOpen;
    more.ontoggle = () => { moreOpen = more.open; localStorage.setItem(MORE_KEY, moreOpen ? '1' : '0'); };

    body.append(accountPanel({ getProfile: accountProfile, toast }), songsSection(), more);
  }

  function songsSection() {
    const rows = h('div', { class: 'artist-songs-list' }, h('p', { class: 'artist-dim' }, 'Loading…'));
    const title = getState()?.artist?.title;
    myPublished().then((songs) => {
      if (!songs.length) {
        return rows.replaceChildren(h('div', { class: 'artist-songs-empty' },
          h('p', {}, 'Nothing published yet. Publish a song and it gets its own page that plays instantly.'),
          publishCurrent && h('button', { class: 'btn', onclick: () => { close(); publishCurrent(); } }, title ? `PUBLISH “${title}”` : 'PUBLISH THIS SONG')));
      }
      rows.replaceChildren(...songs.map((t) => {
        const meta = [STYLES[t.style]?.name, t.bpm && `${t.bpm} BPM`].filter(Boolean).join(' · ');
        const inner = [jbTile(t.title), h('span', { class: 'jb-text' }, h('b', {}, t.title), h('small', {}, t.public ? meta : `${meta} · this browser only`)), h('span', { class: 'jb-side' }, t.public ? 'OPEN' : '')];
        return t.public
          ? h('a', { class: 'jb-item artist-song', href: `/t/${t.trackId}`, target: '_blank', rel: 'noopener' }, ...inner)
          : h('div', { class: 'jb-item artist-song' }, ...inner);
      }));
    }).catch(() => rows.replaceChildren(h('p', { class: 'artist-dim' }, 'Couldn’t load your songs right now.')));
    return h('section', { class: 'artist-songs' }, h('div', { class: 'artist-label' }, 'YOUR SONGS'), rows);
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
        h('div', { class: 'catalog-plan' }, field('RELEASE DATE', date), field('STATUS', status)),
        h('div', { class: 'catalog-actions' },
          h('button', { class: 'btn ghost', onclick: () => use(loadProject) }, 'OPEN'),
          h('button', { class: 'btn live', onclick: () => use(performProject) }, 'PLAY LIVE'),
          h('button', { class: 'btn sc', onclick: () => use(publishProject) }, 'PUBLISH'))));
  }

  render();
}
