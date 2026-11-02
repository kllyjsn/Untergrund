#!/usr/bin/env python3
"""Import the REPERTOIRE: public-domain / CC0 scores -> data/repertoire/<id>.json + js/repertoire-index.js.

Only scores whose own file states Public Domain (Mutopia) or that sit in a CC0 collection (OpenScore)
are imported; the license is re-checked from the pinned source on every run and the import fails otherwise.

  pip install music21==9.1.0 && GITHUB_TOKEN=$(gh auth token) python3 scripts/import-repertoire.py

Score events are [step, midi, duration, velocity, part, hand] with a step = one 16th note.
"""
import io, json, os, re, struct, sys, urllib.parse, urllib.request, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data', 'repertoire')
CACHE = os.path.join(ROOT, '.cache', 'repertoire')
MUTOPIA_SHA = '2144afd6f52d56c5b6995b8b589ef1268b3139f0'
OPENSCORE_SHA = '2614b0b2958dd1ce3f52e172a43e5f4d0e29570f'
Q = 48  # positions are kept to 1/48 of a 16th (exact for triplets and quintuplets of 32nds)

# rubato: how much the performer may breathe (0 = strict, 2 = a nocturne).
MUTOPIA = [
    dict(id='bach-prelude-c', dir='ftp/BachJS/BWV846/wtk1-prelude1', composer='Johann Sebastian Bach', title='Prelude in C major', work='The Well-Tempered Clavier I, BWV 846', key='C major', rubato=0.6),
    dict(id='beethoven-fur-elise', dir='ftp/BeethovenLv/WoO59/fur_Elise_WoO59', composer='Ludwig van Beethoven', title='Für Elise', work='Bagatelle in A minor, WoO 59', key='A minor', rubato=1.3),
    dict(id='beethoven-pathetique-1', dir='ftp/BeethovenLv/O13/pathetique-1', composer='Ludwig van Beethoven', title='Pathétique Sonata — I. Grave · Allegro di molto e con brio', work='Piano Sonata No. 8, Op. 13', key='C minor', rubato=0.9),
    dict(id='beethoven-pathetique-2', dir='ftp/BeethovenLv/O13/pathetique-2', composer='Ludwig van Beethoven', title='Pathétique Sonata — II. Adagio cantabile', work='Piano Sonata No. 8, Op. 13', key='A♭ major', rubato=1.5),
    dict(id='chopin-prelude-4', dir='ftp/ChopinFF/O28/Chop-28-4', composer='Frédéric Chopin', title='Prelude in E minor', work='Op. 28 No. 4', key='E minor', rubato=1.8),
    dict(id='chopin-prelude-7', dir='ftp/ChopinFF/O28/Chop-28-7', composer='Frédéric Chopin', title='Prelude in A major', work='Op. 28 No. 7', key='A major', rubato=1.6),
    dict(id='chopin-prelude-15', dir='ftp/ChopinFF/O28/Chop-28-15', composer='Frédéric Chopin', title='“Raindrop” Prelude', work='Op. 28 No. 15', key='D♭ major', rubato=1.6),
    dict(id='chopin-prelude-20', dir='ftp/ChopinFF/O28/Chop-28-20', composer='Frédéric Chopin', title='Prelude in C minor', work='Op. 28 No. 20', key='C minor', rubato=1.2),
    dict(id='chopin-fantaisie-impromptu', dir='ftp/ChopinFF/O66/chopin_fantaisie-impromptu', composer='Frédéric Chopin', title='Fantaisie-Impromptu', work='Op. 66', key='C♯ minor', rubato=1.4),
    dict(id='chopin-etude-10-1', dir='ftp/ChopinFF/O10/chp-10-01', composer='Frédéric Chopin', title='Étude in C major', work='Op. 10 No. 1', key='C major', rubato=0.7),
    dict(id='chopin-etude-10-12', dir='ftp/ChopinFF/O10/op-10-12-wfi', composer='Frédéric Chopin', title='“Revolutionary” Étude', work='Op. 10 No. 12', key='C minor', rubato=0.9),
    dict(id='chopin-waltz-64-1', dir='ftp/ChopinFF/O64/chopin_valse_op64_no1', composer='Frédéric Chopin', title='“Minute” Waltz', work='Op. 64 No. 1', key='D♭ major', rubato=1.3, tempo_scale=0.8),
    dict(id='satie-gymnopedie-1', dir='ftp/SatieE/gymnopedie_1', composer='Erik Satie', title='Gymnopédie No. 1', work='Trois Gymnopédies', key='D major', rubato=1.2),
    dict(id='schubert-impromptu-899-2', dir='ftp/SchubertF/D899/SchubertF-D899-2-Impromptu', composer='Franz Schubert', title='Impromptu in E♭ major', work='D. 899 No. 2', key='E♭ major', rubato=1.0),
    dict(id='schubert-impromptu-899-3', dir='ftp/SchubertF/D899/SchubertF-D899-3-Impromptu', composer='Franz Schubert', title='Impromptu in G♭ major', work='D. 899 No. 3', key='G♭ major', rubato=1.5),
    dict(id='schubert-impromptu-935-2', dir='ftp/SchubertF/D935/SchubertF-D935-2-Impromptu', composer='Franz Schubert', title='Impromptu in A♭ major', work='D. 935 No. 2', key='A♭ major', rubato=1.3),
    dict(id='mozart-nachtmusik-1', dir='ftp/MozartWA/KV525/eine-kleine-nachtmusik-mvt1', composer='Wolfgang Amadeus Mozart', title='Eine kleine Nachtmusik — I. Allegro', work='Serenade No. 13, K. 525', key='G major', rubato=0.5,
         parts=['vln1', 'vln2', 'vla', 'vc'], double_bass=True),
]
# measures are 0-based indices into the whole quartet file (each file holds several movements).
OPENSCORE = [
    dict(id='haydn-emperor', path='scores/Haydn,_Joseph/String_Quartet_in_C_major,_Hob.III77,_Op.76_No.3/sq20428156.mxl', measures=(128, 237), bpm=66, beat=2,
         composer='Joseph Haydn', title='“Emperor” Quartet — II. Poco adagio; cantabile', work='String Quartet Op. 76 No. 3', key='G major', rubato=0.9),
    dict(id='mozart-k387-1', path='scores/Mozart,_Wolfgang_Amadeus/String_Quartet_No.14_in_G_major,_K.387_(Op._10,_No._1)/sq7103818.mxl', measures=(0, 172), bpm=126,
         composer='Wolfgang Amadeus Mozart', title='String Quartet No. 14 — I. Allegro vivace assai', work='K. 387 “Spring”', key='G major', rubato=0.5),
    dict(id='beethoven-op18-1', path='scores/Beethoven,_Ludwig_van/String_Quartet_No.1,_Op.18_No.1/sq8071278.mxl', measures=(0, 313), bpm=168,
         composer='Ludwig van Beethoven', title='String Quartet No. 1 — I. Allegro con brio', work='Op. 18 No. 1', key='F major', rubato=0.5),
    dict(id='schubert-death-and-the-maiden', path='scores/Schubert,_Franz/String_Quartet_in_D_minor,_D.810,_No.14_(“Death_and_the_Maiden”)/sq7397765.mxl', measures=(341, 521), bpm=54, beat=2,
         composer='Franz Schubert', title='“Death and the Maiden” — II. Andante con moto', work='String Quartet No. 14, D. 810', key='G minor', rubato=1.0),
]


def fetch(url, name):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name)
    if not os.path.exists(path):
        headers = {'User-Agent': 'untergrund-repertoire-import'}
        if 'api.github.com' in url and os.environ.get('GITHUB_TOKEN'): headers['Authorization'] = 'Bearer ' + os.environ['GITHUB_TOKEN']
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=60) as r, open(path, 'wb') as f:
            f.write(r.read())
    return open(path, 'rb').read()


def mutopia_license(d):
    """The license field of the piece's own LilyPond header, read at the pinned commit."""
    api = f'https://api.github.com/repos/MutopiaProject/MutopiaProject/git/trees/{MUTOPIA_SHA}?recursive=1'
    tree = json.loads(fetch(api, 'mutopia-tree.json'))['tree']
    found = set()
    for t in tree:
        p = t['path']
        if p.startswith(d + '/') and p.endswith('.ly'):
            raw = fetch(f'https://raw.githubusercontent.com/MutopiaProject/MutopiaProject/{MUTOPIA_SHA}/{urllib.parse.quote(p)}', p.replace('/', '_'))
            txt = raw.decode('utf8', 'ignore')
            found |= set(re.findall(r'^\s*license\s*=\s*"([^"]+)"', txt, re.M))
            # Older Mutopia files carry the dedication in the tagline instead of a license field.
            if 'placed in the public domain' in txt or 'creativecommons.org/licenses/publicdomain' in txt: found.add('Public Domain')
            if re.search(r'Attribution|licenses/by', txt): found.add('Creative Commons Attribution')
    return found


# --- a small Standard MIDI File reader (LilyPond output: format 1, PPQ ticks, one track per staff) ---
def read_midi(data):
    assert data[:4] == b'MThd'
    _, ntrk, ppq = struct.unpack('>HHH', data[8:14])
    pos, tracks, tempos, timesig = 14, [], [], None
    for _ in range(ntrk):
        assert data[pos:pos + 4] == b'MTrk'
        ln = struct.unpack('>I', data[pos + 4:pos + 8])[0]
        p, end, t, run, on, notes, name, prog = pos + 8, pos + 8 + ln, 0, 0, {}, [], '', None
        def vlq():
            nonlocal p
            v = 0
            while True:
                b = data[p]; p += 1
                v = (v << 7) | (b & 0x7f)
                if b < 0x80: return v
        while p < end:
            t += vlq()
            st = data[p]
            if st == 0xff:
                typ, p = data[p + 1], p + 2
                ln2 = vlq(); body = data[p:p + ln2]; p += ln2
                if typ == 0x51: tempos.append((t, 60e6 / int.from_bytes(body, 'big')))
                elif typ == 0x58 and timesig is None: timesig = (body[0], 2 ** body[1])
                elif typ == 0x03: name = body.decode('latin1')
                continue
            if st in (0xf0, 0xf7):
                p += 1; ln2 = vlq(); p += ln2; continue
            if st & 0x80: run, p = st, p + 1
            cmd = run & 0xf0
            if cmd in (0xc0, 0xd0):
                if cmd == 0xc0: prog = data[p]
                p += 1; continue
            a, b = data[p], data[p + 1]; p += 2
            if cmd == 0x90 and b > 0:
                if a in on: notes.append((on[a][0], a, t - on[a][0], on[a][1]))
                on[a] = (t, b)
            elif cmd == 0x80 or (cmd == 0x90 and b == 0):
                if a in on:
                    s, v = on.pop(a); notes.append((s, a, t - s, v))
        if notes: tracks.append(dict(name=name, prog=prog, notes=notes))
        pos = end
    return ppq, tracks, sorted(tempos), timesig or (4, 4)


def q(x): return round(x * Q) / Q


def tempo_curve(tempos, ppq):
    """Sparse step-length multipliers relative to the opening tempo: [[step, mult], ...]."""
    if not tempos: return 100, []
    base = tempos[0][1]
    out = []
    for t, bpm in tempos:
        s = q(t / ppq * 4)
        m = round(base / bpm, 4)
        if out and out[-1][0] == s: out[-1][1] = m
        elif not out or out[-1][1] != m: out.append([s, m])
    return round(base), [x for x in out if not (x[0] == 0 and x[1] == 1)]


def sections_for(bars, bar_len, marks=()):
    """Form cells for the score map: given marks, else even phrase groups of 4-bar multiples (at most 12 cells)."""
    if marks: return [dict(at=a, name=n) for a, n in marks]
    size = 4
    while bars / size > 12: size += 4
    return [dict(at=a, name=f'BARS {a + 1}–{min(bars, a + size)}') for a in range(0, bars, size)]


def import_mutopia(c):
    lic = mutopia_license(c['dir'])
    if lic != {'Public Domain'}:
        sys.exit(f"{c['id']}: license {lic or 'missing'} is not Public Domain — not importing")
    name = c['dir'].split('/')[-1]
    url = f"https://www.mutopiaproject.org/{c['dir']}/{name}.mid"
    ppq, tracks, tempos, (num, den) = read_midi(fetch(url, name + '.mid'))
    bpm, tempo = tempo_curve(tempos, ppq)
    notes = []
    vels = {v for tr in tracks for *_, v in tr['notes']}
    if c.get('parts'):
        assert len(tracks) == len(c['parts']), (c['id'], len(tracks))
        for tr, part in zip(tracks, c['parts']):
            for s, m, d, v in tr['notes']:
                notes.append([q(s / ppq * 4), m, max(1 / Q, q(d / ppq * 4)), 0.62, part, 0])
                if c.get('double_bass') and part == 'vc': notes.append([q(s / ppq * 4), m - 12, max(1 / Q, q(d / ppq * 4)), 0.5, 'cb', 0])
    else:
        # Hands: staves above middle C on average are the right hand.
        for tr in tracks:
            mean = sum(n[1] for n in tr['notes']) / len(tr['notes'])
            hand = 0 if mean >= 60 else 1
            for s, m, d, v in tr['notes']:
                vel = round(v / 127, 3) if len(vels) > 1 else 0.62
                notes.append([q(s / ppq * 4), m, max(1 / Q, q(d / ppq * 4)), vel, 'pno', hand])
    src = dict(name='Mutopia Project', url=f"https://www.mutopiaproject.org/cgibin/make-table.cgi?searchingfor={urllib.parse.quote(name)}",
               file=f"https://github.com/MutopiaProject/MutopiaProject/tree/{MUTOPIA_SHA}/{c['dir']}", midi=url)
    return finish(c, notes, bpm, tempo, num * 16 // den, 'Public Domain', src)


DYN = dict(ppp=0.25, pp=0.32, p=0.42, mp=0.52, mf=0.62, f=0.76, ff=0.88, fff=0.98, sf=0.86, sfz=0.88, sfp=0.8, fp=0.76, rf=0.82, rfz=0.84, fz=0.86)
QUARTET = ['vln1', 'vln2', 'vla', 'vc']


def import_openscore(c):
    import music21
    url = f"https://raw.githubusercontent.com/OpenScore/StringQuartets/{OPENSCORE_SHA}/{urllib.parse.quote(c['path'])}"
    fetch(url, c['id'] + '.mxl')
    s = music21.converter.parse(os.path.join(CACHE, c['id'] + '.mxl'))
    a, b = c['measures']
    notes, num, den, marks = [], None, None, []
    for part, name in zip(s.parts, QUARTET):
        ms = list(part.getElementsByClass('Measure'))[a:b]
        ms0 = ms[0].offset
        level = 0.55
        for bi, m in enumerate(ms):
            if num is None and m.timeSignature: num, den = m.timeSignature.numerator, m.timeSignature.denominator
            if name == 'vln1':
                for t in m.recurse().getElementsByClass('TextExpression'):
                    txt = t.content.strip()
                    if re.match(r'^(Var\.|Tema|Coda|Thema|Più|Tempo)', txt): marks.append((bi, txt.upper()))
            events = sorted(m.recurse().getElementsByClass(['Dynamic', 'GeneralNote']), key=lambda e: e.getOffsetInHierarchy(m))
            for e in events:
                if isinstance(e, music21.dynamics.Dynamic):
                    v = DYN.get(e.value)
                    if v and e.value not in ('sf', 'sfz', 'fz', 'rf', 'rfz'): level = v
                    continue
                if not e.isNote and not e.isChord: continue
                if e.duration.isGrace: continue
                tie = e.tie.type if e.tie else None
                if tie in ('stop', 'continue'):
                    # extend the note this tie continues
                    for p_ in (e.pitches if e.isChord else [e.pitch]):
                        for n in reversed(notes):
                            if n[4] == name and n[1] == p_.midi: n[2] = q(n[2] + e.duration.quarterLength * 4); break
                    continue
                st = q((m.offset - ms0 + e.getOffsetInHierarchy(m)) * 4)
                d = max(1 / Q, q(e.duration.quarterLength * 4))
                acc = any(isinstance(x, music21.articulations.Accent) or isinstance(x, music21.articulations.StrongAccent) for x in e.articulations)
                stacc = any(isinstance(x, music21.articulations.Staccato) for x in e.articulations)
                v = min(1, level + (0.1 if acc else 0))
                for p_ in (e.pitches if e.isChord else [e.pitch]):
                    notes.append([st, p_.midi, q(d * 0.55) if stacc else d, round(v, 3), name, 0])
    bar_len = num * 16 // den
    bpm = c['bpm'] * (c.get('beat', 1))  # bpm given per written beat; the app counts quarter notes
    src = dict(name='OpenScore String Quartets', url='https://github.com/OpenScore/StringQuartets',
               file=f"https://github.com/OpenScore/StringQuartets/blob/{OPENSCORE_SHA}/{c['path']}")
    return finish(c, notes, bpm, [], bar_len, 'CC0-1.0', src, marks)


def finish(c, notes, bpm, tempo, bar_len, lic, src, marks=()):
    notes.sort(key=lambda n: (n[0], n[1]))
    first = min(n[0] for n in notes)
    first = (first // bar_len) * bar_len  # drop leading empty bars, keep an anacrusis on its beat
    for n in notes: n[0] = q(n[0] - first)
    tempo = [[q(max(0, s - first)), m] for s, m in tempo]
    marked = bpm
    bpm *= c.get('tempo_scale', 1)
    # The app's transport runs 60-200 BPM in 16ths: a Grave counts in 32nds, a presto in 8ths. Same music, same speed.
    while bpm < 60 or bpm > 200:
        f = 2 if bpm < 60 else 0.5
        bpm *= f
        bar_len = int(bar_len * f)
        for n in notes: n[0], n[2] = q(n[0] * f), max(1 / Q, q(n[2] * f))
        tempo = [[q(s * f), m] for s, m in tempo]
    end = max(n[0] + n[2] for n in notes)
    bars = int(-(-end // bar_len))
    seen, uniq = set(), []
    marks = [(a, n) for a, n in marks if not (a in seen or seen.add(a))]
    if marks and marks[0][0] != 0: marks = [(0, 'THEME')] + marks
    meta = {k: c[k] for k in ('id', 'composer', 'title', 'work', 'key')}
    ensemble = 'piano' if all(n[4] == 'pno' for n in notes) else 'strings'
    piece = dict(**meta, ensemble=ensemble, bpm=round(bpm), marked=round(marked), barLen=bar_len, bars=bars, rubato=c['rubato'], license=lic, source=src,
                 sections=sections_for(bars, bar_len, marks), tempo=tempo, notes=notes)
    return piece


def main():
    only = set(sys.argv[1:])
    os.makedirs(OUT, exist_ok=True)
    index = []
    for c in MUTOPIA + OPENSCORE:
        if only and c['id'] not in only:
            path = os.path.join(OUT, c['id'] + '.json')
            if os.path.exists(path): index.append(json.load(open(path)))
            continue
        piece = import_mutopia(c) if 'dir' in c else import_openscore(c)
        with open(os.path.join(OUT, c['id'] + '.json'), 'w') as f:
            json.dump(piece, f, ensure_ascii=False, separators=(',', ':'))
        print(f"{c['id']}: {piece['bars']} bars of {piece['barLen']} steps, {len(piece['notes'])} notes, {piece['bpm']} bpm, {piece['license']}")
        index.append(piece)
    order = {c['id']: i for i, c in enumerate(MUTOPIA + OPENSCORE)}
    index.sort(key=lambda p: order[p['id']])
    meta = [{k: p[k] for k in ('id', 'composer', 'title', 'work', 'key', 'ensemble', 'bpm', 'bars', 'license')} | {'source': p['source']['name']} for p in index]
    with open(os.path.join(ROOT, 'js', 'repertoire-index.js'), 'w') as f:
        f.write('// Generated by scripts/import-repertoire.py — the REPERTOIRE catalogue (notes live in data/repertoire/<id>.json).\n')
        f.write('export const REPERTOIRE = ' + json.dumps(meta, ensure_ascii=False, indent=1) + ';\n')
    with open(os.path.join(OUT, 'LICENSE.md'), 'w') as f:
        f.write('# REPERTOIRE score licenses\n\nEvery score here was converted by `scripts/import-repertoire.py` from a source whose own file states its license.\n'
                'Mutopia scores are taken only when their LilyPond header reads `license = "Public Domain"`; OpenScore String Quartets are CC0 1.0.\n\n'
                '| id | composer | work | license | source |\n|---|---|---|---|---|\n')
        for p in index:
            f.write(f"| {p['id']} | {p['composer']} | {p['title']} ({p['work']}) | {p['license']} | [{p['source']['name']}]({p['source']['file']}) |\n")


if __name__ == '__main__':
    main()
