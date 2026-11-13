// Lyrics: pasted or planned words split into song sections and lines, each line broken into syllable slots so a
// melody (and later a singer) can give every syllable its own note. Pure functions, shared by the app, sanitize()
// and the /api/song-plan validator.
import { toSections, sectionNames } from './timeline.js';

export const LYRIC_SECS = ['intro', 'verse', 'pre', 'chorus', 'bridge', 'outro'];
export const VOCALS = ['female', 'male', 'duet', 'choir'];
export const LIMITS = { sections: 16, lines: 16, total: 64, line: 100, text: 4000 };
export const SEC_LABEL = { intro: 'INTRO', verse: 'VERSE', pre: 'PRE-CHORUS', chorus: 'CHORUS', bridge: 'BRIDGE', outro: 'OUTRO' };

const ctrl = /[\u0000-\u0008\u000b-\u001f\u007f]/g;
export const cleanText = (v, max) => String(v ?? '').replace(ctrl, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------------- syllables ----------------
// English is irregular; these common lyric words break the vowel-group rules below.
const WORDS = {
  people: ['peo', 'ple'], every: ['ev', 'ry'], everything: ['ev', 'ry', 'thing'], everyone: ['ev', 'ry', 'one'], evening: ['eve', 'ning'],
  different: ['dif', 'frent'], family: ['fam', 'ly'], business: ['bus', 'ness'], chocolate: ['choc', 'late'], being: ['be', 'ing'],
  seeing: ['see', 'ing'], going: ['go', 'ing'], doing: ['do', 'ing'], poem: ['po', 'em'], quiet: ['qui', 'et'], science: ['sci', 'ence'],
  idea: ['i', 'de', 'a'], lion: ['li', 'on'], create: ['cre', 'ate'], area: ['ar', 'e', 'a'], someone: ['some', 'one'], somewhere: ['some', 'where'],
  sometimes: ['some', 'times'], forever: ['for', 'ev', 'er'], whatever: ['what', 'ev', 'er'], ocean: ['o', 'cean'], angel: ['an', 'gel'],
  little: ['lit', 'tle'], baby: ['ba', 'by'], maybe: ['may', 'be'], cause: ['cause'], heaven: ['heav', 'en'], la: ['la'], la_: ['l', 'a'], fire: ['fire'], desire: ['de', 'sire'], tired: ['tired'], hour: ['hour'],
};
const VOW = 'aeiouy';
// Compounds whose first half ends in a silent e: "someday", "careless", "lifetime", "homesick".
const SILENT_HEAD = /^(some|love|home|life|time|fire|care|hope|safe|side|more|where|there|here|place|face|name|lone|wise|use|space|grace|night|moon|sun|heart)(?=[a-z]{2,}$)/;
const HIATUS = /^(?:ia|io|iu|eo|ua|uo|yi|ya|yo|ye|ie)$/;
const DIGRAPH = /^(?:ch|sh|th|ph|wh|gh|ck|ng|qu)$/;

// "leaving" -> ['leav', 'ing']; letters only, original case kept.
export function syllabify(word) {
  const letters = String(word ?? '').replace(/[^A-Za-zÀ-ÖØ-öø-ÿ']/g, '').replace(/^'+|'+$/g, '');
  if (!letters) return /\d/.test(String(word ?? '')) ? [String(word).replace(/[^\d]/g, '').slice(0, 8)] : [];
  const w = letters.toLowerCase().replace(/[àáâãäå]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i').replace(/[òóôõöø]/g, 'o').replace(/[ùúûü]/g, 'u');
  const known = WORDS[w.replace(/'/g, '')];
  if (known && known.join('') === w.replace(/'/g, '')) { let i = 0; return known.map((p) => { const out = letters.replace(/'/g, '').slice(i, i + p.length); i += p.length; return out; }); }
  const head = !known && w.replace(/'/g, '') === w && w.match(SILENT_HEAD)?.[1];
  if (head && /[aeiouy]/.test(w.slice(head.length)) && !/^(?:e|r|s|d|y|st|ly|ry|ed|er|ers|es|ing|ings|n|ns|ness)$/.test(w.slice(head.length))) {
    const a = syllabify(letters.slice(0, head.length)), b = syllabify(letters.slice(head.length));
    if (b.length) return [...a, ...b];
  }
  const isV = (i) => {
    const c = w[i];
    if (!VOW.includes(c)) return false;
    if (c === 'y') return i > 0 && !VOW.includes(w[i - 1]);
    if (c === 'u' && w[i - 1] === 'q') return false;
    return true;
  };
  // Vowel groups as [start, end) spans, split where two vowels are sung separately ("pi-a-no", "try-ing").
  let groups = [];
  for (let i = 0; i < w.length;) {
    if (!isV(i)) { i++; continue; }
    let j = i + 1;
    while (j < w.length && isV(j)) j++;
    let a = i;
    for (let k = i; k < j - 1; k++) {
      const pair = w.slice(k, k + 2), pre = w[a - 1] || '';
      if (HIATUS.test(pair) && !(/[ctsxg]/.test(pre) && pair[0] === 'i') && !(pair === 'ie' && j === w.length) && !(pair === 'ie' && w[j] === 'w') && !(pair === 'ie' && /^[sd]$/.test(w[j] || '') && j === w.length - 1)) {
        groups.push([a, k + 1]); a = k + 1;
      }
    }
    groups.push([a, j]);
    i = j;
  }
  if (!groups.length) return [letters];
  const n = w.length, last = groups[groups.length - 1];
  const cons = (c) => c && !VOW.includes(c);
  if (groups.length > 1) {
    const silentE = last[0] === n - 1 && w[n - 1] === 'e' && last[1] - last[0] === 1 && !(w[n - 2] === 'l' && cons(w[n - 3]));
    const silentEd = last[0] === n - 2 && w.endsWith('ed') && last[1] - last[0] === 1 && !/[td]/.test(w[n - 3]);
    const silentEs = last[0] === n - 2 && w.endsWith('es') && last[1] - last[0] === 1 && !/[sxz]/.test(w[n - 3]) && !/(?:ch|sh|ce|ge)$/.test(w.slice(0, n - 1));
    if (silentE || silentEd || silentEs) groups = groups.slice(0, -1);
    // "lonely", "hopeful", "careless": a silent e before a suffix.
    groups = groups.filter(([a, b], g) => !(g > 0 && b - a === 1 && w[a] === 'e' && cons(w[a - 1]) && /^[^aeiouy]?(?:ly|ment|ful|ness|less)$/.test(w.slice(a + 1))));
  }
  // Cut between groups: one consonant starts the next syllable, a cluster splits after its first letter
  // (ch/sh/th/ph/wh stay with the next syllable; ck/ng/gh stay with this one).
  const cuts = [];
  for (let g = 0; g < groups.length - 1; g++) {
    const from = groups[g][1], to = groups[g + 1][0], cl = w.slice(from, to);
    if (g === groups.length - 2 && /[^aeiouy]le$/.test(w) && groups[g + 1][0] === n - 1 && cl.length >= 2) cuts.push(to - 2);
    else if (cl.length <= 1) cuts.push(from);
    else if (cl.length > 2 && /^(?:ck|ng|gh)$/.test(cl.slice(0, 2))) cuts.push(from + 2);
    else if (cl.length === 2 && DIGRAPH.test(cl)) cuts.push(/^(?:ck|ng|gh)$/.test(cl) ? to : from);
    else if (DIGRAPH.test(cl.slice(-2)) && !/^(?:ck|ng|gh)$/.test(cl.slice(-2))) cuts.push(to - 2);
    else cuts.push(from + 1);
  }
  const src = letters;
  const out = [];
  let at = 0;
  for (const c of cuts) { out.push(src.slice(at, c)); at = c; }
  out.push(src.slice(at));
  return out.filter(Boolean);
}

// One slot per sung syllable: { s: text, w: word index, end: last syllable of its word }.
export function lineSlots(text) {
  const slots = [];
  String(text ?? '').split(/[\s\u2014\u2013-]+/).filter(Boolean).forEach((word, w) => {
    const syl = syllabify(word);
    syl.forEach((s, i) => slots.push({ s, w, end: i === syl.length - 1 }));
  });
  return slots;
}
export const syllableCount = (text) => lineSlots(text).length;

// ---------------- splitting pasted lyrics ----------------
const HEADER = /^\s*[[(]?\s*(intro|verse|pre[\s-]?chorus|prechorus|pre|post[\s-]?chorus|chorus|hook|refrain|bridge|middle\s*8|breakdown|interlude|outro|coda)\b[^\])\n]{0,20}[\])]?\s*:?\s*$/i;
const HEADER_SEC = (w) => {
  w = w.toLowerCase().replace(/[\s-]/g, '');
  if (w.startsWith('pre')) return 'pre';
  if (/^(?:postchorus|chorus|hook|refrain)$/.test(w)) return 'chorus';
  if (/^(?:bridge|middle8|breakdown|interlude)$/.test(w)) return 'bridge';
  if (w === 'coda') return 'outro';
  return w;
};
// "La la la [x2]" style repeat marks and stage directions in parentheses aren't sung words.
const stripMarks = (line) => line.replace(/\s*[[(](?:x\s*\d+|\d+\s*x|repeat[^\])]*)[\])]\s*$/i, '').replace(/^\s*[-*•]\s*/, '');

function wrap(line) {
  const out = [];
  let rest = line;
  while (rest.length > LIMITS.line) {
    let cut = rest.lastIndexOf(', ', LIMITS.line);
    if (cut < 30) cut = rest.lastIndexOf(' ', LIMITS.line);
    if (cut < 1) cut = LIMITS.line;
    out.push(rest.slice(0, cut).replace(/,\s*$/, '').trim());
    rest = rest.slice(cut).replace(/^[,\s]+/, '');
  }
  if (rest.trim()) out.push(rest.trim());
  return out;
}

// Pasted text -> [{ sec, lines: [{ t, n }] }]. Headers like "[Chorus]" or "Verse 2:" win; otherwise blank-line stanzas
// are named by repetition (a stanza that comes back is the chorus) and position (verse, chorus, verse, chorus, bridge).
export function splitLyrics(text) {
  const raw = String(text ?? '').slice(0, LIMITS.text).replace(/\r\n?/g, '\n').replace(ctrl, ' ');
  const stanzas = [];
  let cur = null;
  const open = (sec) => { cur = { sec, lines: [] }; stanzas.push(cur); };
  for (const line0 of raw.split('\n')) {
    const m = line0.match(HEADER);
    if (m) { open(HEADER_SEC(m[1])); continue; }
    const line = stripMarks(line0).replace(/\s+/g, ' ').trim();
    if (!line) { if (cur?.lines.length) cur = null; continue; }
    if (!cur) open(null);
    cur.lines.push(...wrap(line));
  }
  const list = stanzas.filter((s) => s.lines.length);
  const key = (s) => s.lines.join('\n').toLowerCase().replace(/[^a-z0-9\n]+/g, '');
  const seen = new Map();
  for (const s of list) seen.set(key(s), (seen.get(key(s)) || 0) + 1);
  // A stanza that repeats is the chorus; a labelled chorus elsewhere tells unlabeled repeats apart.
  for (const s of list) if (!s.sec && seen.get(key(s)) > 1) s.sec = 'chorus';
  const hasChorus = list.some((s) => s.sec === 'chorus');
  const TEMPLATE = ['verse', 'chorus', 'verse', 'chorus', 'bridge', 'chorus', 'outro'];
  let choruses = 0;
  list.forEach((s, i) => {
    if (s.sec === 'chorus') { choruses++; return; }
    if (s.sec) return;
    if (!hasChorus) { s.sec = list.length === 1 ? 'verse' : TEMPLATE[i] || 'verse'; return; }
    // Between the second chorus and a later one, a single new stanza is the bridge.
    const later = list.slice(i + 1).some((x) => x.sec === 'chorus');
    const between = list.slice(i + 1).findIndex((x) => x.sec === 'chorus');
    s.sec = choruses >= 2 && later && between === 0 ? 'bridge' : choruses >= 1 && !later && i === list.length - 1 && s.lines.length <= 2 ? 'outro' : 'verse';
  });
  return finish(list.map((s) => ({ sec: s.sec, lines: s.lines })));
}

// Bounds and syllable counts; counts are always recomputed, never trusted from input.
function finish(sections) {
  let total = 0;
  const out = [];
  for (const s of sections.slice(0, LIMITS.sections)) {
    if (!s || !LYRIC_SECS.includes(s.sec)) continue;
    const lines = [];
    for (const l of (Array.isArray(s.lines) ? s.lines : []).slice(0, LIMITS.lines)) {
      const t = cleanText(typeof l === 'string' ? l : l?.t, LIMITS.line);
      if (!t || total >= LIMITS.total) continue;
      const n = syllableCount(t);
      if (!n) continue;
      lines.push({ t, n }); total++;
    }
    if (lines.length) out.push({ sec: s.sec, lines });
  }
  return out;
}
export const cleanSections = finish;

// The project's lyrics block (state.lyrics); null when there is nothing worth keeping.
export function cleanLyrics(v) {
  if (!v || typeof v !== 'object') return null;
  const sections = finish(Array.isArray(v.sections) ? v.sections : []);
  const out = { v: 1 };
  const prompt = cleanText(v.prompt, 200), title = cleanText(v.title, 60), about = cleanText(v.about, 120);
  if (prompt) out.prompt = prompt;
  if (title) out.title = title;
  if (about) out.about = about;
  if (VOCALS.includes(v.vocal)) out.vocal = v.vocal;
  out.sections = sections;
  return sections.length || out.prompt || out.vocal || out.about ? out : null;
}

// ---------------- following the song ----------------
// Each song section the chain plays is matched to a lyric section of the same kind, in order: the second verse
// of the song sings the second written verse, every chorus sings the chorus. Fills and half-time turnarounds keep
// singing the section they close. Returns one entry per bar: { s: lyric section index, l: line index } or null.
const ROLE = { VERSE: 'verse', HOOK: 'chorus', DROP: 'chorus', CHORUS: 'chorus', BRIDGE: 'bridge', BREAK: 'bridge', BREAKDOWN: 'bridge',
  INTRO: 'intro', OUTRO: 'outro', PRE: 'pre', 'PRE-CHORUS': 'pre', PRECHORUS: 'pre', BUILD: 'build' };
const TURN = new Set(['FILL', 'HALF-TIME', 'TURNAROUND']);
export function lyricTimeline(chain, lyrics, { kind = 'club', labels = {} } = {}) {
  const secs = toSections(chain), names = sectionNames(secs, kind, labels);
  const written = lyrics?.sections || [];
  if (!secs.length || !written.length) return [];
  const blocks = [];
  secs.forEach((s, i) => {
    const name = String(names[i] || '').toUpperCase();
    const prev = blocks[blocks.length - 1];
    const role = ROLE[name] || null;
    // Fills close the section before them; back-to-back sections of one kind are one long section.
    if (prev && (TURN.has(name) || (role && role === prev.role))) { prev.bars += s.bars; return; }
    blocks.push({ role, bars: s.bars });
  });
  let sungVerse = false;
  const used = {};
  const out = [];
  blocks.forEach((b, i) => {
    let role = b.role;
    // A build after the first verse leads into a chorus: that's where a pre-chorus sits.
    if (role === 'build') role = sungVerse && ['chorus'].includes(blocks[i + 1]?.role) ? 'pre' : i === 0 ? 'intro' : sungVerse ? 'outro' : 'intro';
    if (role === 'verse') sungVerse = true;
    const mine = written.map((w, j) => (w.sec === role ? j : -1)).filter((j) => j >= 0);
    const k = used[role] || 0;
    used[role] = k + 1;
    // Choruses repeat the last written chorus; other parts stay instrumental once their words run out.
    const s = role === 'chorus' ? mine[Math.min(k, mine.length - 1)] : mine[k];
    for (let bar = 0; bar < b.bars; bar++) {
      if (s == null) { out.push(null); continue; }
      const lines = written[s].lines.length;
      out.push({ s, l: Math.min(lines - 1, Math.floor((bar / b.bars) * lines)) });
    }
  });
  return out;
}

// Display names: "VERSE 2", "CHORUS".
export function lyricLabels(lyrics) {
  const count = {}, total = {};
  for (const s of lyrics?.sections || []) total[s.sec] = (total[s.sec] || 0) + 1;
  return (lyrics?.sections || []).map((s) => {
    count[s.sec] = (count[s.sec] || 0) + 1;
    return SEC_LABEL[s.sec] + (s.sec === 'verse' && total.verse > 1 ? ` ${count[s.sec]}` : '');
  });
}

// Back to editable text with [Section] headers.
export const lyricsText = (lyrics) => (lyrics?.sections || []).map((s, i) => `[${lyricLabels(lyrics)[i].replace(/\b\w+/g, (w) => w[0] + w.slice(1).toLowerCase())}]\n${s.lines.map((l) => l.t).join('\n')}`).join('\n\n');
