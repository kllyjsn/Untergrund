// "Describe it": plain-language steering. A deterministic, local rule-based parser turns phrases like
// "a bit darker and slower" or "like a 3am warehouse" into concrete edits on the existing controls
// (master macros, track params, swing, bpm, scale/key, density, voices, mutes/locks, genre).
// No network, no paid API. An optional interpreter can be plugged in later via interpret({ remote }).
import { SCALES, KEYS, CHORDS, TRACK_IDS, TRACK_BY_ID, MASTER_PARAMS, STEPS } from './params.js';
import { STYLES, mutate, clone, hookLine } from './state.js';
import { rng } from './dsp.js';
import { patternAt, setTake, remapTakes, changedBars, barsLabel } from './scope.js';

// ---------------- vocabulary ----------------
// Artists and scenes people name: folded into one token each, expanded by ARTISTS below.
const ARTISTS = {
  daftpunk: [/daft\s+punk/, 'deephouse', [['swing', 0.5], ['grit', 0.5], ['pump', 1], ['tone', 0.5]]],
  kaytranada: [/kaytranada/, 'deephouse', [['swing', 1], ['voice', 1], ['harmony', 0.5], ['punch', 0.5]]],
  fredagain: [/fred\s+again(?:\.\.)?/, 'ukg', [['voice', 7], ['space', 0.5], ['level:vox', 1], ['harmony', 0.5]]],
  fourtet: [/four\s+tet/, 'deephouse', [['level:perc', 1], ['voice', 6], ['warmth', 0.5], ['variation', 0.5]]],
  aphex: [/aphex(?:\s+twin)?/, 'acid', [['variation', 1], ['density', 0.5], ['grit', 0.5]]],
  boc: [/boards\s+of\s+canada/, 'ambient', [['dust', 1], ['warmth', 1], ['tone', -0.5]]],
  bonobo: [/bonobo/, 'deephouse', [['voice', 10], ['warmth', 1], ['level:perc', 0.5]]],
  nujabes: [/nujabes/, 'boombap', [['voice', 7], ['harmony', 1], ['swing', 0.5], ['dust', 0.5]]],
  disclosure: [/disclosure/, 'ukg', [['punch', 0.5], ['swing', 0.5], ['level:vox', 0.5]]],
  skrillex: [/skrillex/, 'trap', [['bassVoice', 3], ['grit', 2], ['drops', 1]]],
  travis: [/travis\s+scott/, 'trap', [['tone', -1], ['space', 1], ['bassVoice', 2]]],
  drake: [/\bdrake\b/, 'trap', [['tone', -0.5], ['density', -0.5], ['space', 0.5], ['bassVoice', 2]]],
  weeknd: [/(?:the\s+)?weeknd/, 'electro', [['voice', 2], ['tone', -0.5], ['space', 1]]],
  metro: [/metro\s+boomin/, 'trap', [['tone', -1], ['bassVoice', 2], ['voice', 6]]],
  doom: [/mf\s+doom/, 'boombap', [['dust', 1], ['swing', 0.5]]],
  kanye: [/kanye(?:\s+west)?/, 'boombap', [['voice', 10], ['punch', 0.5]]],
  jeffmills: [/jeff\s+mills/, 'hypnotic', [['tempo', 0.5], ['level:perc', 0.5]]],
  hawtin: [/richie\s+hawtin|plastikman/, 'minimal', [['density', -1], ['echo', 0.5]]],
  dewitte: [/charlotte\s+de\s+witte/, 'hardtechno', [['tone', -1], ['grit', 1]]],
  amelie: [/amelie\s+lens/, 'peak', [['drops', 1], ['tone', -0.5]]],
  carlcox: [/carl\s+cox/, 'peak', [['level:perc', 1], ['drops', 0.5]]],
  berghain: [/berghain|ben\s+klock|marcel\s+dettmann/, 'hypnotic', [['tone', -1], ['grit', 1], ['space', 0.5]]],
  eno: [/brian\s+eno/, 'ambient', [['space', 1], ['density', -1]]],
  zimmer: [/hans\s+zimmer/, 'symphony', [['drops', 1], ['space', 0.5]]],
  chopin: [/chopin/, 'nocturne', []],
  classic: [/mozart|beethoven|bach|vivaldi|tchaikovsky/, 'symphony', []],
  shm: [/swedish\s+house\s+mafia|avicii|calvin\s+harris|deadmau5|martin\s+garrix/, 'euphoric', [['drops', 1], ['pump', 0.5]]],
  blackcoffee: [/black\s+coffee/, 'deephouse', [['level:perc', 1], ['swing', 0.5]]],
  peggygou: [/peggy\s+gou|kerri\s+chandler|larry\s+heard|frankie\s+knuckles/, 'deephouse', [['voice', 3], ['warmth', 0.5]]],
  hood: [/robert\s+hood|ricardo\s+villalobos/, 'minimal', [['density', -0.5], ['swing', 0.5]]],
  badbunny: [/bad\s+bunny|j\s+balvin|daddy\s+yankee/, 'reggaeton', []],
  burna: [/burna\s+boy|wizkid|davido|tems/, 'afrobeats', []],
  goldie: [/goldie|ltj\s+bukem/, 'dnb', [['space', 0.5]]],
};
const ARTIST_RE = Object.entries(ARTISTS).map(([id, [re]]) => [new RegExp(re.source, 'g'), ` artist${id} `]);

// Multi-word phrases are folded into single tokens before matching.
const PHRASES = [
  [/(?:make\s+it|go|sound|more)\s+(?:huge|massive|enormous|gigantic)\b/g, ' mainstage '],
  [/thin\s+(?:it\s+|them\s+|things\s+)?out/g, ' sparser '],
  [/\b(?:do|does|did)\s+not\s+like|not\s+(?:a\s+)?(?:fan|feeling|into)\s+(?:of\s+)?|can\s*not\s+stand/g, ' dislike '],
  [/\b(?:everything|all)\s+(?:but|except|apart\s+from|other\s+than)|\bapart\s+from|\bother\s+than/g, ' except '],
  [/half[\s-]?time|half\s+speed/g, ' halftime '], [/double[\s-]?time|double\s+(?:the\s+)?(?:speed|tempo)/g, ' doubletime '],
  [/(?:change|switch|new|different|another|modulate)\s+(?:the\s+)?key|key\s+change|modulate/g, ' keychange '],
  [/jazz(?:y)?\s+chords|(?:seventh|7th|extended|ninth|9th)\s+chords|maj(?:or)?\s*7(?:ths?)?/g, ' richer harmony '],
  [/\b(?:19)?80s\b|eighties|retro[\s-]?wave|out[\s-]?run|vapou?r[\s-]?wave/g, ' synthwave '], [/\b(?:19)?90s\b|nineties/g, ' nineties '], [/\b(?:19)?70s\b|seventies/g, ' disco '],
  [/video\s+games?(?:\s+music)?|\b8[\s-]?bit\b|chip[\s-]?tunes?/g, ' chiptune '], [/(?:movie|film|tv)\s+(?:soundtrack|score|music)|soundtrack/g, ' cinematic '],
  [/trip[\s-]?hop/g, ' triphop '], [/tech[\s-]house/g, ' techhouse '], [/afro[\s-]house/g, ' afrohouse '], [/\br\s*(?:&|and|n)\s*b\b/g, ' rnb '], [/\bk[\s-]?pop\b/g, ' kpop '], [/\b(pop|rnb|rock|country)\s+ballads?\b/g, ' $1 '], [/singer[\s-]*song[\s-]*writer/g, ' folk '], [/acoustic\s+guitars?/g, ' acousticguitar '],
  [/(?:distorted|overdriven|electric|crunchy|dirty)\s+guitars?/g, ' driveguitar '], [/(?:electric|fender)\s+bass|bass\s+guitar/g, ' electricbass '],
  [/drum\s+(?:roll|fill)s?/g, ' fills '], [/low[\s-]end/g, ' bass '], [/top[\s-]?line/g, ' melody '],
  [/drum\s*(?:and|&|n|'n'|n')\s*bass|\bd\s*(?:&|n)\s*b\b/g, ' dnb '],
  [/hip[\s-]?hop/g, ' hiphop '], [/lo[\s-]?fi/g, ' lofi '], [/neo[\s-]?soul/g, ' neosoul '], [/boom[\s-]?bap/g, ' boombap '],
  [/deep[\s-]house/g, ' deephouse '], [/uk[\s-]?garage/g, ' ukg '], [/\b(?:2|two)[\s-]?step\b/g, ' ukg '],
  [/peak[\s-]time/g, ' peak '], [/hard[\s-]techno/g, ' hardtechno '], [/dub[\s-]techno/g, ' dub '],
  [/minimal\s+(?:house|techno)/g, ' minimalgenre '], [/baile(?:[\s-]funk)?|funk\s+carioca/g, ' bailefunk '],
  [/jersey(?:[\s-]club)?/g, ' jerseyclub '], [/hyper[\s-]?pop/g, ' hyperpop '], [/afro[\s-]?beats?/g, ' afrobeats '],
  [/piano\s+concerto/g, ' concerto '], [/drum\s+machine|machine\s+drums|electronic\s+drums/g, ' machinekit '],
  [/(?:live|real|acoustic|recorded)\s+drums/g, ' livekit '],
  [/electric\s+piano|e[\s-]piano|fender\s+rhodes|wurlitzer|wurli/g, ' rhodes '], [/log[\s-]?drums?/g, ' logdrum '],
  [/acid\s+bass|\b303\b/g, ' acidbass '], [/(?:double|upright|live|bass)\s+(?:bass|guitar)/g, ' livebass '],
  [/\b808s?\b/g, ' eightoheight '],
  [/open[\s-]hi[\s-]?hats?|open[\s-]hats?/g, ' openhat '], [/(?:closed[\s-])?hi[\s-]?hats?/g, ' hats '], [/bass[\s-]?drums?/g, ' kick '],
  [/robert\s+glasper/g, ' glasper '], [/j\.?\s*dilla/g, ' dilla '],
  [/\b(?:3|three)\s*(?:am|a\.m\.)|late[\s-]night|after[\s-]?hours|warehouse/g, ' latenight '],
  [/main[\s-]?(?:stage|room)/g, ' mainstage '], [/side[\s-]?chain(?:ing|ed)?/g, ' sidechain '],
  [/in\s+your\s+face|up\s+front/g, ' drier '], [/strip(?:ped)?\s+(?:it\s+)?(?:back|down)|pare(?:d)?\s+(?:it\s+)?(?:back|down)/g, ' sparser '],
  [/(?:speed|hurry)\s+(?:it\s+)?up|pick\s+up\s+the\s+pace|tempo\s+up/g, ' faster '], [/slow\s+(?:it\s+)?down|tempo\s+down|take\s+it\s+easy/g, ' slower '],
  [/change\s+(?:it|things)\s+up|mix\s+it\s+up|switch\s+it\s+up|shake\s+it\s+up/g, ' variation '],
  [/more\s+going\s+on/g, ' busier '], [/less\s+going\s+on/g, ' sparser '], [/laid[\s-]?back/g, ' chill '],
  [/harmonic\s+minor/g, ' harmonic '], [/minor\s+pentatonic|pentatonic/g, ' pentatonic '],
  [/get\s+rid\s+of|take\s+out|take\s+away|lose\s+the/g, ' remove '], [/bring\s+back|add\s+back|put\s+back/g, ' unmute '],
  [/turn\s+(?:it\s+)?up|crank(?:\s+up)?|pump\s+up/g, ' louder '], [/turn\s+(?:it\s+)?down|tone\s+down|dial\s+(?:it\s+)?back|pull\s+back|back\s+off/g, ' less '],
  [/a\s+(?:little\s+)?bit|a\s+little|a\s+touch|a\s+tad|kind\s+of|sort\s+of|a\s+hair|just\s+a\s+bit/g, ' slightly '],
  [/a\s+lot|a\s+ton|way\s+more|much\s+more|lots\s+more|tons\s+more/g, ' muchmore '],
];

const INTENSITY = {
  slightly: 0.5, little: 0.5, touch: 0.5, tad: 0.5, somewhat: 0.5, kinda: 0.5, sorta: 0.5, bit: 0.5, subtle: 0.5, subtly: 0.5, gently: 0.5, mildly: 0.5,
  muchmore: 2, much: 2, way: 2, lot: 2, lots: 2, really: 2, very: 2, super: 2, extra: 2, tons: 2, hella: 2, massively: 2, totally: 2, seriously: 2, crazy: 2, insanely: 2, loads: 2, heaps: 2, huge: 2,
  more: 1, even: 1, bigger: 1, add: 1, plus: 1,
};
// "less dark", "too busy", "no drops" flip the direction of whatever follows.
const NEGATE = new Set(['less', 'fewer', 'not', 'no', 'without', 'too', 'reduce', 'lower', 'decrease', 'minus', 'never', 'nothing', 'zero', 'smaller']);
// Track verbs: hard negation silences the track; soft negation turns it down.
const MUTE = new Set(['no', 'without', 'mute', 'kill', 'remove', 'drop', 'cut', 'lose', 'off', 'silence', 'ditch', 'skip', 'stop', 'delete']);
const UNMUTE = new Set(['unmute', 'restore', 'return']);
const LOCK = new Set(['lock', 'keep', 'freeze', 'hold', 'protect', 'save']);
const UNLOCK = new Set(['unlock', 'unfreeze', 'release']);
const LEVEL_UP = new Set(['louder', 'loud', 'boost', 'more', 'bigger', 'up', 'add', 'raise', 'stronger', 'heavier', 'fatter', 'thicker', 'turn']);
const LEVEL_DOWN = new Set(['quieter', 'quiet', 'softer', 'less', 'fewer', 'lower', 'down', 'reduce', 'weaker', 'lighter', 'smaller', 'thinner']);
const STOP = new Set(['make', 'it', 'the', 'a', 'an', 'more', 'please', 'some', 'sound', 'sounds', 'like', 'feel', 'feels', 'vibe', 'vibes', 'give', 'me', 'can', 'you', 'we', 'i', 'want',
  'is', 'be', 'bit', 'track', 'song', 'beat', 'mix', 'just', 'so', 'that', 'this', 'of', 'in', 'to', 'at', 'on', 'for', 'with', 'my', 'little', 'lets', 'let', 's', 'us', 'get', 'go', 'way', 'much',
  'really', 'very', 'kind', 'sort', 'turn', 'up', 'down', 'add', 'put', 'use', 'try', 'switch', 'into', 'something', 'stuff', 'thing', 'all', 'too', 'than', 'now', 'again', 'yeah', 'ok', 'okay', 'maybe',
  'bring', 'back', 'less', 'not', 'no', 'enough', 'lot', 'tons', 'super', 'extra', 'even', 'out', 'over', 'bit', 'tad', 'touch', 'slightly', 'muchmore', 'hey', 'lot', 'style', 'vibe', 'type', 'sounding']);

const W = {}; // token -> entry
const add = (entry, ...words) => { for (const w of words) W[w] = entry; };
const axis = (id, sign) => ({ k: 'axis', id, sign });
add(axis('tone', 1), 'brighter', 'bright', 'brighten', 'crisp', 'crisper', 'crispier', 'airy', 'airier', 'shiny', 'shinier', 'sparkly', 'sparklier', 'clearer', 'sharper', 'treble', 'brilliant', 'glossy', 'shimmery');
add(axis('tone', -1), 'darker', 'dark', 'darken', 'murky', 'murkier', 'muffled', 'dull', 'duller', 'deeper', 'moody', 'moodier', 'filtered', 'muted', 'underwater');
add(axis('warmth', 1), 'warmer', 'warm', 'warmth', 'cozy', 'cosy', 'cozier', 'cosier', 'analog', 'analogue', 'vintage', 'mellow', 'mellower', 'round', 'rounder', 'fuzzy');
add(axis('warmth', -1), 'colder', 'cold', 'clinical', 'digital', 'sterile', 'icy', 'icier', 'cooler', 'cool');
add(axis('tempo', 1), 'faster', 'fast', 'quicker', 'quick', 'speedier', 'uptempo', 'tempo', 'pacier', 'speed');
add(axis('tempo', -1), 'slower', 'slow', 'downtempo', 'sluggish', 'lazier', 'lazy');
add(axis('swing', 1), 'swing', 'swingy', 'swingier', 'swung', 'swinging', 'shuffle', 'shuffled', 'shuffly', 'groovy', 'groovier', 'groove', 'bouncy', 'bouncier', 'bounce', 'looser', 'loose', 'drunk', 'drunken', 'sloppy', 'human', 'humanize', 'humanise', 'pocket');
add(axis('swing', -1), 'straighter', 'straight', 'tighter', 'tight', 'rigid', 'quantized', 'quantised', 'robotic', 'mechanical', 'stiff', 'stiffer', 'precise', 'grid');
add(axis('density', 1), 'busier', 'busy', 'fuller', 'full', 'denser', 'dense', 'complex', 'intricate', 'layered', 'notes', 'hits', 'action', 'activity');
add(axis('density', -1), 'sparser', 'sparse', 'simpler', 'simple', 'emptier', 'empty', 'minimal', 'minimalist', 'stripped', 'barer', 'bare', 'space', 'breathe', 'breathing', 'room', 'spacey', 'calmer');
add(axis('drops', 1), 'drop', 'drops', 'buildup', 'buildups', 'build', 'builds', 'riser', 'risers', 'climax', 'explosive', 'dramatic', 'drama', 'payoff', 'impact');
add(axis('space', 1), 'reverb', 'reverby', 'wetter', 'wet', 'spacious', 'roomier', 'roomy', 'washy', 'cavernous', 'distant', 'hall', 'cathedral', 'ambience', 'ambiance', 'verb');
add(axis('space', -1), 'drier', 'dry', 'intimate', 'closer', 'close', 'upfront');
add(axis('echo', 1), 'echo', 'echoes', 'echoey', 'echoy', 'delay', 'delays', 'dubby', 'dubbier', 'repeats', 'pingpong');
add(axis('grit', 1), 'dirtier', 'dirty', 'grittier', 'gritty', 'grit', 'distorted', 'distortion', 'distort', 'crunchy', 'crunchier', 'crunch', 'harder', 'hard', 'heavier', 'heavy', 'aggressive', 'angrier', 'angry', 'nastier', 'nasty', 'raw', 'rawer', 'saturated', 'saturation', 'gnarly', 'gnarlier', 'filthy', 'filthier', 'rough', 'rougher');
add(axis('grit', -1), 'cleaner', 'clean', 'smoother', 'smooth', 'gentler', 'gentle', 'polished', 'softer', 'soft', 'silky', 'silkier', 'pristine');
add(axis('pump', 1), 'pump', 'pumping', 'pumpy', 'pumpier', 'sidechain', 'ducking', 'duck', 'breathing');
add(axis('punch', 1), 'punchier', 'punchy', 'punch', 'thump', 'thumpier', 'thumping', 'slap', 'slappier', 'knock', 'knockier', 'knocking', 'kickier');
add(axis('variation', 1), 'variation', 'variations', 'vary', 'varied', 'evolve', 'evolving', 'different', 'change', 'fresh', 'fresher', 'surprise', 'unpredictable', 'mutate', 'remix', 'spice', 'interesting');
add(axis('variation', -1), 'repetitive', 'steady', 'steadier', 'consistent', 'loopy', 'predictable');
add(axis('volume', 1), 'louder', 'loud', 'volume');
add(axis('volume', -1), 'quieter', 'quiet');
add(axis('harmony', 1), 'richer', 'rich', 'lush', 'lusher', 'colorful', 'colourful', 'extended', 'sophisticated', 'fancier', 'fancy');
add(axis('harmony', -1), 'plainer', 'plain', 'basic', 'triads');
add(axis('dust', 1), 'dust', 'crackle', 'vinyl', 'hiss', 'tape');
const bundle = (id) => ({ k: 'bundle', id });
add(bundle('sad'), 'sad', 'sadder', 'melancholy', 'melancholic', 'emotional', 'gloomy', 'gloomier', 'somber', 'sombre', 'blue', 'heartbroken', 'crying', 'tearful', 'nostalgic', 'wistful', 'bittersweet', 'lonely', 'heartbreak', 'tragic');
add(bundle('happy'), 'happy', 'happier', 'uplifting', 'joyful', 'cheerful', 'cheerier', 'sunny', 'sunnier', 'hopeful', 'optimistic', 'feelgood', 'positive', 'playful', 'fun', 'upbeat');
add(bundle('spooky'), 'spooky', 'spookier', 'sinister', 'evil', 'scary', 'scarier', 'creepy', 'creepier', 'ominous', 'menacing', 'eerie', 'haunted', 'horror', 'villain', 'tense', 'tension');
add(bundle('mysterious'), 'mysterious', 'exotic', 'eastern', 'spanish', 'arabic', 'mystical', 'enigmatic');
add(bundle('dreamy'), 'dreamy', 'dreamier', 'floaty', 'floatier', 'hazy', 'hazier', 'ethereal', 'atmospheric', 'cloudy', 'blissful', 'heavenly');
add(bundle('jazzy'), 'jazzy', 'jazzier', 'soulful', 'soulfuller', 'sophisticated');
add(bundle('lofi'), 'lofi', 'dusty', 'dustier', 'worn', 'retro', 'grainy', 'old', 'older', 'oldschool');
add(bundle('latenight'), 'latenight', 'underground', 'rave', 'berlin', 'dungeon', 'basement', 'bunker', 'club', 'clubby', 'clubbier', 'dancefloor');
add(bundle('mainstage'), 'mainstage', 'festival', 'stadium', 'anthem', 'anthemic', 'banger', 'arena');
add(bundle('epic'), 'epic', 'cinematic', 'orchestral', 'grand', 'grander', 'majestic', 'massive');
add(bundle('funky'), 'funky', 'funkier', 'funk');
add(bundle('romantic'), 'romantic', 'sexy', 'sensual', 'sultry', 'intimate');
add(bundle('summer'), 'summer', 'summery', 'beach', 'sunset', 'tropical', 'island', 'vacation');
add(bundle('energy'), 'energetic', 'energy', 'hype', 'hyped', 'intense', 'intensity', 'wilder', 'wild', 'driving', 'urgent', 'excited', 'exciting', 'powerful', 'bigger');
add(bundle('chill'), 'chill', 'chilled', 'chiller', 'chillout', 'relaxed', 'relaxing', 'calm', 'peaceful', 'sleepy', 'easy', 'zen', 'lounge');
add(bundle('glasper'), 'glasper');
add(bundle('dilla'), 'dilla', 'madlib');
add(bundle('burial'), 'burial');
const genre = (id, family) => ({ k: 'genre', id, family });
add(genre('hypnotic', 'TECHNO'), 'techno');
add(genre('deephouse', 'HOUSE'), 'house');
add(genre('neosoul', 'JAZZ & HIP-HOP'), 'jazz', 'soul');
add(genre('pop', 'POP & R&B'), 'pop', 'mainstream', 'popsong');
add(genre('rnb', 'POP & R&B'), 'rnb', 'slowjam', 'slowjams');
add(genre('rock', 'ROCK & ROOTS'), 'rock', 'punk', 'grunge', 'indie', 'garagerock', 'alternative');
add(genre('folk', 'ROCK & ROOTS'), 'folk', 'songwriter', 'campfire', 'ballad');
add(genre('country', 'ROCK & ROOTS'), 'country', 'nashville', 'americana', 'honkytonk', 'western', 'bluegrass');
add(genre('boombap', 'JAZZ & HIP-HOP'), 'hiphop', 'rap');
add(genre('breaks'), 'breakbeat', 'breakbeats');
add(genre('dnb'), 'jungle', 'liquid');
add(genre('reggaeton'), 'dembow', 'latin');
add(genre('symphony', 'CLASSICAL'), 'classical', 'symphonic', 'orchestra');
add(genre('ukg'), 'garage');
add(genre('hyperpop'), 'kpop');
add(genre('minimal'), 'minimalgenre');
for (const id of Object.keys(STYLES)) if (id !== 'repertoire' && id !== 'minimal') W[id] ??= genre(id);
const track = (...ids) => ({ k: 'track', ids });
const DRUMS = ['kick', 'clap', 'snare', 'ch', 'oh', 'ride', 'perc'];
add(track('kick'), 'kick', 'kicks');
add(track('clap'), 'clap', 'claps', 'handclap', 'handclaps');
add(track('snare'), 'snare', 'snares', 'rimshot', 'rim', 'backbeat');
add(track('ch'), 'hats', 'hat', 'hihat', 'hihats');
add(track('oh'), 'openhat');
add(track('ride'), 'ride', 'rides', 'cymbal', 'cymbals');
add(track('perc'), 'perc', 'percussion', 'percs', 'congas', 'conga', 'bongos', 'bongo', 'shaker', 'shakers', 'clave', 'toms', 'tom');
add(track('acid'), 'bass', 'bassline', 'basslines', 'sub', 'bottom', 'low', 'lows', 'bassier');
add(track('stab'), 'chords', 'chord', 'stabs', 'stab', 'harmony', 'keys');
add(track('vox'), 'vocals', 'vocal', 'vox', 'voice', 'voices', 'chops', 'chop', 'singing');
add(track(...DRUMS), 'drums', 'drum', 'percussive', 'rhythm', 'beats');
const voice = (v) => ({ k: 'voice', v });
add(voice(0), 'saw', 'supersaw', 'supersaws', 'synth', 'synths', 'synthy');
add(voice(1), 'rhodes', 'electricpiano');
add(voice(2), 'pad', 'pads');
add(voice(3), 'organ', 'organs', 'hammond');
add(voice(4), 'brass', 'synthbrass');
add(voice(5), 'pluck', 'plucks', 'plucky');
add(voice(6), 'bells', 'bell', 'mallets', 'chimes', 'glockenspiel');
add(voice(7), 'piano', 'pianos', 'grand');
add(voice(8), 'guitar', 'guitars');
add(voice(9), 'horns', 'horn', 'trumpet', 'trumpets', 'sax', 'saxophone', 'trombone');
add(voice(11), 'driveguitar', 'overdrive', 'overdriven', 'powerchords');
add(voice(12), 'acousticguitar', 'strummed', 'strumming');
add(voice(10), 'strings', 'string', 'violin', 'violins', 'cello', 'cellos', 'viola', 'orchestral');
const bassVoice = (v) => ({ k: 'bassVoice', v });
add(bassVoice(0), 'acidbass', 'squelch', 'squelchy');
add(bassVoice(1), 'livebass');
add(bassVoice(2), 'eightoheight');
add(bassVoice(3), 'reese', 'wobble', 'wobbly');
add(bassVoice(4), 'logdrum');
add(bassVoice(5), 'electricbass', 'bassguitar');
const kit = (v) => ({ k: 'kit', v });
add(kit(1), 'livekit'); add(kit(0), 'machinekit');
for (const id of Object.keys(SCALES)) W[id] = { k: 'scale', v: id };
add({ k: 'scale', v: 'minor' }, 'minor');
add({ k: 'scale', v: 'major' }, 'major');
add({ k: 'scale', v: 'phrygian' }, 'phrygian');
// "warm" bundles a little drive; "grand" means piano, "orchestral" strings (later entries win above).

// Words people use for the lead line; it plays through the chord channel as the song's hook.
add(track('melody'), 'melody', 'melodies', 'lead', 'leads', 'hook', 'hooks', 'riff', 'riffs', 'arp', 'arps', 'arpeggio', 'arpeggios');
add(track('perc'), 'cowbell', 'cowbells', 'tambourine', 'tambourines', 'woodblock', 'triangle', 'claves');
add(axis('space', 1), 'spacier', 'spacey', 'spacy', 'wide', 'wider', 'width', 'stereo', 'expansive');
add(axis('space', -1), 'mono', 'narrow', 'narrower');
add(axis('punch', 1), 'hit', 'hitting', 'snappy', 'snappier');
add(axis('variation', 1), 'new', 'another', 'rewrite', 'redo', 'regenerate', 'reroll', 'rework', 'reshuffle', 'alternate');
add(axis('density', 1), 'roll', 'rolls', 'fill', 'fills', 'triplets', 'stutter', 'stutters');
add(axis('drops', 1), 'breakdown', 'breakdowns', 'tension');
add(axis('pump', 1), 'compress', 'compressed', 'compression', 'glue');
add(axis('density', -1), 'emptier');
add(axis('tone', -1), 'duller');
add(bundle('spooky'), 'halloween', 'dark-side');
add(bundle('energy'), 'bang', 'banging', 'bangin', 'fire', 'lit', 'heat', 'hype', 'gym', 'workout', 'running', 'training', 'party');
add(bundle('mainstage'), 'huge', 'giant', 'enormous', 'monster');
const B2 = {
  polish: (a) => [{ id: 'punch', amt: 0.5 * a }, { id: 'grit', amt: -0.3 * a }, { id: 'pump', amt: 0.3 * a }, { id: 'space', amt: 0.3 * a }, { id: 'harmony', amt: 0.5 * a }],
  fat: (a) => [{ id: 'punch', amt: 0.5 * a }, { id: 'warmth', amt: 0.5 * a }, { id: 'level', target: 'acid', amt: 0.5 * a }],
  tribal: (a) => [{ id: 'level', target: 'perc', amt: a }, { id: 'swing', amt: 0.3 * a }, a > 0 && { id: 'kit', value: 1 }],
  acoustic: (a) => [a > 0 && { id: 'kit', value: 1 }, a > 0 && { id: 'bassVoice', value: 1 }, { id: 'warmth', amt: 0.5 * a }, { id: 'grit', amt: -0.3 * a }],
  electronic: (a) => [a > 0 && { id: 'kit', value: 0 }, a > 0 && { id: 'voice', value: 0 }, { id: 'warmth', amt: -0.5 * a }],
  texture: (a) => [{ id: 'dust', amt: 0.5 * a }, { id: 'space', amt: 0.5 * a }, { id: 'echo', amt: 0.3 * a }],
  holiday: (a) => [a > 0 && { id: 'voice', value: 6 }, a > 0 && { id: 'scale', value: 'major' }, { id: 'warmth', amt: 0.5 * a }, { id: 'space', amt: 0.3 * a }],
  chiptune: (a, ctx) => [a > 0 && STYLES[ctx.style]?.family !== 'BREAKS & BASS' && { id: 'genre', value: 'electro' }, a > 0 && { id: 'voice', value: 5 }, { id: 'tone', amt: a }, a > 0 && { id: 'kit', value: 0 }],
  nineties: (a) => [{ id: 'dust', amt: 0.5 * a }, { id: 'warmth', amt: 0.5 * a }, { id: 'punch', amt: 0.3 * a }],
};
const scene = (genreId, edits) => (a, ctx) => [a > 0 && ctx.style !== genreId && STYLES[ctx.style]?.family !== STYLES[genreId]?.family && { id: 'genre', value: genreId }, ...edits(a)];
Object.assign(B2, {
  synthwave: scene('electro', (a) => [a > 0 && { id: 'voice', value: 2 }, { id: 'space', amt: 0.5 * a }, { id: 'tone', amt: -0.3 * a }]),
  disco: scene('deephouse', (a) => [{ id: 'swing', amt: 0.5 * a }, { id: 'tone', amt: 0.5 * a }, { id: 'harmony', amt: 0.5 * a }, { id: 'level', target: 'perc', amt: 0.5 * a }]),
  rock: scene('rock', (a) => [{ id: 'grit', amt: 0.5 * a }]),
  metal: scene('breaks', (a) => [a > 0 && { id: 'kit', value: 1 }, a > 0 && { id: 'voice', value: 8 }, { id: 'grit', amt: 2 * a }, { id: 'tempo', amt: 0.5 * a }]),
  reggae: scene('dub', (a) => [a > 0 && { id: 'bassVoice', value: 1 }, a > 0 && { id: 'voice', value: 3 }, { id: 'swing', amt: 0.5 * a }, { id: 'echo', amt: 0.5 * a }]),
  dubstep: scene('trap', (a) => [a > 0 && { id: 'bassVoice', value: 3 }, { id: 'grit', amt: a }, { id: 'drops', amt: a }]),
  triphop: scene('boombap', (a) => [{ id: 'tone', amt: -a }, { id: 'dust', amt: 0.5 * a }, { id: 'tempo', amt: -0.5 * a }, { id: 'space', amt: 0.5 * a }]),
  techhouse: scene('deephouse', (a) => [{ id: 'punch', amt: a }, { id: 'density', amt: 0.5 * a }, { id: 'grit', amt: 0.3 * a }]),
  afrohouse: scene('deephouse', (a) => [{ id: 'level', target: 'perc', amt: a }, { id: 'swing', amt: 0.3 * a }]),
  phonk: scene('trap', (a) => [a > 0 && { id: 'bassVoice', value: 2 }, { id: 'grit', amt: a }, { id: 'dust', amt: 0.5 * a }, { id: 'level', target: 'perc', amt: 0.5 * a }]),
  edm: scene('euphoric', (a) => [{ id: 'drops', amt: a }, { id: 'pump', amt: 0.5 * a }]),
  progressive: scene('trance', (a) => [{ id: 'variation', amt: -0.3 * a }]),
  psytrance: scene('trance', (a) => [{ id: 'tempo', amt: a }, { id: 'grit', amt: 0.5 * a }]),
  idm: scene('electro', (a) => [{ id: 'variation', amt: a }, { id: 'density', amt: 0.5 * a }]),
  footwork: scene('jerseyclub', (a) => [{ id: 'density', amt: 0.5 * a }]),
  grime: scene('ukg', (a) => [{ id: 'grit', amt: a }, { id: 'tone', amt: -0.5 * a }]),
  gospel: scene('neosoul', (a) => [a > 0 && { id: 'voice', value: 3 }, { id: 'harmony', amt: a }]),
  dancehall: scene('reggaeton', () => []),
});
for (const [id, [, g, list]] of Object.entries(ARTISTS)) {
  B2[`artist${id}`] = scene(g, (a) => list.map(([k, v]) => {
    if (a <= 0 && ['voice', 'bassVoice'].includes(k)) return null;
    if (k === 'voice' || k === 'bassVoice') return { id: k, value: v };
    if (k.startsWith('level:')) return { id: 'level', target: k.slice(6), amt: v * a };
    return { id: k, amt: v * a };
  }));
}
const BW = {
  polish: ['professional', 'pro', 'better', 'improve', 'improved', 'mastered', 'radio', 'finished', 'refined', 'expensive', 'commercial'],
  fat: ['fat', 'fatter', 'thicker', 'phat', 'thicc', 'beefy', 'beefier', 'meaty', 'meatier', 'chunky', 'chunkier'],
  tribal: ['tribal', 'primal', 'ritual'], acoustic: ['acoustic', 'organic', 'natural', 'unplugged', 'instruments', 'band'],
  electronic: ['electronic', 'synthetic', 'electronica', 'futuristic', 'robot'], texture: ['texture', 'textured', 'textures', 'grainier'],
  holiday: ['christmas', 'xmas', 'festive', 'holiday', 'holidays', 'wintry', 'winter', 'snow'], chiptune: ['chiptune', 'arcade'], nineties: ['nineties'],
  synthwave: ['synthwave'], disco: ['disco', 'nudisco'], metal: ['metal', 'heavymetal'],
  reggae: ['reggae', 'ska', 'rocksteady'], dubstep: ['dubstep', 'brostep', 'riddim'], triphop: ['triphop'], techhouse: ['techhouse'],
  afrohouse: ['afrohouse'], phonk: ['phonk'], edm: ['edm'], progressive: ['progressive'], psytrance: ['psytrance', 'psy', 'goa'],
  idm: ['idm', 'glitch', 'glitchy'], footwork: ['footwork', 'juke'], grime: ['grime'], gospel: ['gospel', 'church'], dancehall: ['dancehall'],
};
for (const id of Object.keys(ARTISTS)) BW[`artist${id}`] = [`artist${id}`];
for (const [id, words] of Object.entries(BW)) add(bundle(id), ...words);
// Complaints name the problem; the fix is the same whether or not they say "too" or "less".
const complaint = (id) => ({ k: 'complaint', id });
const COMPLAINTS = {
  boring: (a) => [{ id: 'variation', amt: a }, { id: 'drops', amt: 0.5 * a }, { id: 'density', amt: 0.3 * a }],
  empty: (a) => [{ id: 'density', amt: a }, { id: 'harmony', amt: 0.3 * a }, { id: 'space', amt: 0.3 * a }],
  weak: (a) => [{ id: 'punch', amt: a }, { id: 'drops', amt: 0.5 * a }, { id: 'grit', amt: 0.3 * a }],
  muddy: (a) => [{ id: 'tone', amt: 0.7 * a }, { id: 'level', target: 'acid', amt: -0.5 * a }, { id: 'space', amt: -0.3 * a }],
  harsh: (a) => [{ id: 'tone', amt: -0.7 * a }, { id: 'grit', amt: -0.5 * a }],
  cluttered: (a) => [{ id: 'density', amt: -a }, { id: 'space', amt: -0.3 * a }],
  dull: (a) => [{ id: 'tone', amt: 0.7 * a }, { id: 'variation', amt: 0.5 * a }],
};
add(complaint('boring'), 'boring', 'bored', 'bland', 'stale', 'generic', 'samey', 'lifeless', 'meh', 'monotonous', 'uninspired', 'static');
add(complaint('empty'), 'empty', 'thin', 'hollow', 'lacking', 'barren');
add(complaint('weak'), 'weak', 'limp', 'flat', 'wimpy', 'tame', 'underwhelming', 'lame');
add(complaint('muddy'), 'muddy', 'muddier', 'boomy', 'mushy', 'murky');
add(complaint('harsh'), 'harsh', 'harsher', 'shrill', 'piercing', 'abrasive', 'tinny', 'brittle', 'fatiguing');
add(complaint('cluttered'), 'cluttered', 'messy', 'crowded', 'chaotic', 'cluttery', 'noisy', 'overcrowded');
add(complaint('dull'), 'dull');

const VOICE_NAMES = ['synth', 'Rhodes keys', 'pads', 'organ', 'brass', 'plucks', 'bells', 'piano', 'guitar', 'horns', 'strings', 'overdriven guitar', 'acoustic guitar'];
const BASS_NAMES = ['303 acid bass', 'bass guitar', '808 bass', 'reese bass', 'log drum', 'electric bass'];
const TRACK_WORD = { drums: 'drums', melody: 'melody', kick: 'kick', clap: 'claps', snare: 'snare', ch: 'hats', oh: 'open hats', ride: 'ride', perc: 'percussion', acid: 'bass', stab: 'chords', vox: 'vocals' };

// Bundles: moods, scenes and artists expand into the same primitive edits (a = signed amount).
const BUNDLES = {
  sad: (a) => [a > 0 && { id: 'scale', value: 'minor' }, { id: 'tempo', amt: -0.5 * a }, { id: 'tone', amt: -0.5 * a }, { id: 'space', amt: 0.5 * a }],
  happy: (a) => [a > 0 && { id: 'scale', value: 'major' }, { id: 'tone', amt: 0.5 * a }, { id: 'tempo', amt: 0.5 * a }],
  spooky: (a) => [a > 0 && { id: 'scale', value: 'phrygian' }, { id: 'tone', amt: -1 * a }, { id: 'space', amt: 0.5 * a }],
  mysterious: (a) => [a > 0 && { id: 'scale', value: 'harmonic' }, { id: 'echo', amt: 0.5 * a }, { id: 'tone', amt: -0.5 * a }],
  dreamy: (a) => [{ id: 'space', amt: a }, { id: 'echo', amt: 0.5 * a }, { id: 'tone', amt: -0.5 * a }, { id: 'density', amt: -0.5 * a }],
  jazzy: (a) => [a > 0 && { id: 'scale', value: 'dorian' }, { id: 'harmony', amt: a }, { id: 'swing', amt: 0.5 * a }],
  lofi: (a) => [{ id: 'dust', amt: a }, { id: 'warmth', amt: a }, { id: 'tone', amt: -0.5 * a }],
  latenight: (a, ctx) => [a > 0 && STYLES[ctx.style]?.family !== 'TECHNO' && { id: 'genre', value: 'hypnotic' }, { id: 'tone', amt: -a }, { id: 'grit', amt: 0.5 * a }, { id: 'space', amt: 0.5 * a }, { id: 'swing', amt: -0.5 * a }],
  mainstage: (a) => [{ id: 'drops', amt: a }, { id: 'pump', amt: 0.5 * a }, { id: 'punch', amt: 0.5 * a }, { id: 'tone', amt: 0.5 * a }],
  epic: (a) => [a > 0 && { id: 'voice', value: 10 }, { id: 'space', amt: 0.5 * a }, { id: 'drops', amt: 0.5 * a }],
  funky: (a) => [{ id: 'swing', amt: 0.5 * a }, { id: 'density', amt: 0.5 * a }, { id: 'punch', amt: 0.5 * a }],
  romantic: (a) => [{ id: 'warmth', amt: a }, { id: 'tempo', amt: -0.5 * a }, { id: 'harmony', amt: 0.5 * a }],
  summer: (a) => [a > 0 && { id: 'scale', value: 'major' }, { id: 'warmth', amt: 0.5 * a }, { id: 'tone', amt: 0.5 * a }, { id: 'level', target: 'perc', amt: 0.5 * a }],
  energy: (a) => [{ id: 'drops', amt: 0.5 * a }, { id: 'grit', amt: 0.5 * a }, { id: 'tempo', amt: 0.5 * a }, { id: 'density', amt: 0.5 * a }],
  chill: (a) => [{ id: 'tempo', amt: -a }, { id: 'density', amt: -0.5 * a }, { id: 'grit', amt: -0.5 * a }, { id: 'space', amt: 0.5 * a }, { id: 'swing', amt: 0.3 * a }],
  glasper: (a, ctx) => [a > 0 && ctx.style !== 'neosoul' && { id: 'genre', value: 'neosoul' }, a > 0 && { id: 'voice', value: 1 }, { id: 'harmony', amt: a }, { id: 'swing', amt: 0.5 * a }],
  dilla: (a, ctx) => [a > 0 && STYLES[ctx.style]?.family !== 'JAZZ & HIP-HOP' && { id: 'genre', value: 'boombap' }, { id: 'swing', amt: a }, { id: 'warmth', amt: 0.5 * a }],
  burial: (a, ctx) => [a > 0 && ctx.style !== 'ukg' && { id: 'genre', value: 'ukg' }, { id: 'tone', amt: -a }, { id: 'space', amt: a }, { id: 'dust', amt: a }],
};

export const CHIPS = ['Darker', 'More swing', 'Less busy', 'Bigger drop', 'Slower', 'Add strings', 'Make it sad', 'Like a 3am warehouse'];
export function chipsFor(style) {
  const fam = STYLES[style]?.family;
  if (fam === 'CLASSICAL') return ['Slower', 'Faster', 'Warmer', 'More reverb', 'Brighter', 'Quieter'];
  if (fam === 'JAZZ & HIP-HOP') return ['More Glasper', 'More swing', 'Darker', 'Less busy', 'Add strings', 'Make it sad', 'Dustier'];
  if (fam === 'POP & R&B' || fam === 'ROCK & ROOTS') return ['Make it happy', 'Make it sad', 'Acoustic guitar', 'Overdriven guitar', 'Add strings', 'Less busy', 'Slower'];
  return CHIPS;
}
export const SUGGESTIONS = ['darker', 'slower', 'more swing', 'less busy', 'bigger drop', 'add strings', 'make it sad', 'like a 3am warehouse', 'more reverb', 'no hats', 'in D minor', '120 bpm', 'make it happy', 'grittier', 'busier', 'faster', 'up a key', 'more variation'];

// ---------------- parsing ----------------
const KEY_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const MODE = { minor: 'minor', min: 'minor', m: 'minor', major: 'major', maj: 'major', dorian: 'dorian', phrygian: 'phrygian' };

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return d[b.length];
}
const VOCAB = () => Object.keys(W).filter((w) => w.length >= 4 && !/^[a-z]+genre$|kit$|eightoheight/.test(w));
function fuzzy(tok) {
  if (tok.length < 5 || STOP.has(tok)) return null;
  let best = null, bd = tok.length >= 8 ? 2 : 1;
  for (const w of VOCAB()) { const d = lev(tok, w); if (d < bd || (d === bd && best === null && d <= (tok.length >= 8 ? 2 : 1))) { if (d <= (tok.length >= 8 ? 2 : 1)) { best = w; bd = d; } } }
  return best;
}

function normalize(text) {
  let s = ` ${String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/♯/g, '#').replace(/♭/g, 'b')} `;
  s = s.replace(/\bbase(line)?\b/g, 'bass$1');
  s = s.replace(/\bcan'?t\b/g, 'can not').replace(/\bwon'?t\b/g, 'will not').replace(/n't\b/g, ' not');
  for (const [re, to] of ARTIST_RE) s = s.replace(re, to);
  for (const [re, to] of PHRASES) s = s.replace(re, to);
  // "only bass and drums", "everything except the kick and hats", "bass and drums only" stay one clause.
  const glue = (list) => list.replace(/\s*(?:,|\band\b|&|\+)\s*/g, ' ');
  s = s.replace(/\b(only|just|solo|except)\s+((?:the\s+)?[a-z]+(?:\s*(?:,|\band\b|&|\+)\s*(?:the\s+)?[a-z]+)+)/g, (_, w, list) => ` ${w} ${glue(list)} `);
  s = s.replace(/((?:[a-z]+\s*(?:,|\band\b|&)\s*)+[a-z]+)\s+only\b/g, (_, list) => ` only ${glue(list)} `);
  return s;
}

// Explicit numbers and keys are read with patterns before word matching.
function extract(clause, edits) {
  let c = clause;
  const bpm = c.match(/\b(\d{2,3})\s*bpm\b/) || c.match(/\b(?:tempo|bpm)\s*(?:of|to|at|=)?\s*(\d{2,3})\b/) || c.match(/\b(?:at|to)\s+(\d{2,3})\b/);
  if (bpm) { edits.push({ id: 'bpm', value: +bpm[1], src: bpm[0].trim() }); c = c.replace(bpm[0], ' '); }
  const key = c.match(/\b(?:in\s+the\s+key\s+of|key\s+of|in|to|key)\s+([a-g])(#|b|\s+sharp|\s+flat)?(?:\s+(minor|major|min|maj|m|dorian|phrygian))?(?=\s|$)/)
    || c.match(/\b([a-g])(#|b)?\s*(minor|major|m|maj|dorian|phrygian)\b/);
  if (key && !(key[1] === 'a' && !key[2] && !key[3] && /\bin\s+a\s*$|\bto\s+a\s*$/.test(key[0]) === false && !/key/.test(key[0]))) {
    let pc = KEY_PC[key[1]];
    if (key[2]) pc += /#|sharp/.test(key[2]) ? 1 : -1;
    edits.push({ id: 'key', value: ((pc % 12) + 12) % 12, src: key[0].trim() });
    if (key[3]) edits.push({ id: 'scale', value: MODE[key[3]], src: key[3] });
    c = c.replace(key[0], ' ');
  }
  const step = c.match(/\b(?:up\s+a\s+(?:key|step|semitone)|key\s+up|higher\s+key|raise\s+the\s+key|transpose\s+up|pitch\s+(?:it\s+)?up)\b/)
    || c.match(/\b(?:down\s+a\s+(?:key|step|semitone)|key\s+down|lower\s+key|lower\s+the\s+key|transpose\s+down|pitch\s+(?:it\s+)?down)\b/);
  if (step) { edits.push({ id: 'keyStep', amt: /up|higher|raise/.test(step[0]) ? 1 : -1, src: step[0].trim() }); c = c.replace(step[0], ' '); }
  const scale = c.match(/\b(halftime|doubletime)\b/);
  if (scale) { edits.push({ id: 'bpmScale', value: scale[1] === 'halftime' ? 0.5 : 2, src: scale[0] }); c = c.replace(scale[0], ' '); }
  if (/\bkeychange\b/.test(c)) { edits.push({ id: 'keyStep', amt: 2, src: 'new key' }); c = c.replace(/\bkeychange\b/, ' '); }
  const bare = c.match(/(?:^|\s)(?:make\s+it\s+|go\s+|try\s+|around\s+)?(\d{2,3})(?=\s|$)/);
  if (bare && +bare[1] >= 60 && +bare[1] <= 200) { edits.push({ id: 'bpm', value: +bare[1], src: bare[0].trim() }); c = c.replace(bare[0], ' '); }
  return c;
}

Object.assign(BUNDLES, B2);
const DISLIKE = new Set(['dislike', 'annoying', 'annoys', 'ugly', 'irritating', 'grating', 'cheesy', 'cheap']);
const HATE = new Set(['hate', 'hates', 'hated', 'awful', 'terrible', 'horrible', 'sucks', 'trash', 'garbage']);
const COPULA = new Set(['is', 'are', 's', 'its', 'sounds', 'feels', 'seems', 'was', 'were', 'getting', 'gets']);
const IMPERATIVE = new Set(['make', 'more', 'add', 'go', 'get', 'turn', 'set', 'want', 'need', 'needs']);
const REGEN = new Set(['new', 'another', 'different', 'fresh', 'change', 'rewrite', 'redo', 'regenerate', 'reroll', 'rework', 'reshuffle', 'alternate', 'other']);
const ONLY = new Set(['only', 'solo', 'except', 'isolate']);
// Axes that mean something on a single track ("faster hats", "more reverb on the chords", "make the kick louder").
const SCOPED = new Set(['tone', 'warmth', 'space', 'echo', 'density', 'grit', 'tempo', 'volume', 'punch', 'variation']);
const SCOPE_NEG = new Set([...NEGATE, 'down', 'off', 'cut', 'kill', 'remove', 'drop', 'lose', 'ditch']);
const HARD_VERB = new Set(['mute', 'silence', 'delete', 'unmute', 'restore', 'return', 'lock', 'unlock', 'keep', 'freeze', 'unfreeze', 'hold', 'protect', 'save', 'release']);
COMPLAINTS.buried = (a) => [{ id: 'volume', amt: 0.5 * a }];
add(complaint('buried'), 'buried', 'missing', 'inaudible', 'drowned', 'hidden', 'lost');

const isTrack = (e) => e && (e.k === 'track' || e.k === 'voice');
const idsOf = (e) => (e.k === 'voice' ? ['stab'] : e.ids);
const real = (t) => (t === 'melody' ? 'stab' : t);

// One edit on one track for an axis word scoped to it; s is the signed amount the word asks for.
function scoped(id, s, target, src) {
  const t = real(target);
  if (id === 'volume' || (id === 'punch' && t !== 'kick')) return [{ id: 'level', target: t, amt: s, src }];
  if (id === 'punch') return [{ id: 'punch', amt: s, src }];
  if (id === 'tempo') return [{ id: 'density', target: t, amt: s, src }];
  if (id === 'warmth') return [{ id: 'tone', target: t, amt: -0.5 * s, src }];
  if (id === 'grit') return [s > 0 && { id: 'level', target: t, amt: s, src }, ['kick', 'acid', 'stab', 'vox'].includes(t) && { id: 'grit', target: t, amt: 0.5 * s, src }].filter(Boolean);
  return [{ id, target: t, amt: s, src }];
}
const TRACK_COMPLAINT = {
  weak: (t) => [['level', 1], t === 'kick' && ['punch', 1]], empty: () => [['level', 1]], buried: () => [['level', 1.5]],
  harsh: () => [['tone', -0.7]], dull: () => [['tone', 0.7]], muddy: () => [['tone', 0.7], ['level', -0.3]],
  cluttered: () => [['density', -1]], boring: () => [['variation', 1]],
};

function trackEdits(entry, words, ctx, src, { dislike, hate, copula }) {
  const has = (set) => words.some((w) => set.has(w));
  const out = [];
  let int = 1;
  for (const w of words) if (INTENSITY[w] != null && INTENSITY[w] !== 1) int = INTENSITY[w];
  for (const target of idsOf(entry)) {
    const melody = target === 'melody';
    if (has(UNLOCK)) out.push({ id: 'lock', target: real(target), value: false, src });
    else if (has(LOCK)) out.push({ id: 'lock', target: real(target), value: true, src });
    else if (has(UNMUTE)) out.push(melody ? { id: 'hook', value: 1, src } : { id: 'mute', target, value: false, src });
    else if (has(MUTE) || hate) out.push(melody ? { id: 'hook', value: 0, src } : { id: 'mute', target, value: true, src });
    else if (dislike) out.push({ id: 'level', target: real(target), amt: -1.5, src });
    else if (melody && has(REGEN)) out.push({ id: 'hook', value: 2, src });
    else if (entry.k === 'voice' && !has(LEVEL_DOWN) && !words.includes('louder')) out.push({ id: 'voice', value: entry.v, src });
    else if (melody && !has(LEVEL_DOWN) && !words.some((w) => ['louder', 'loud', 'boost', 'up', 'raise', 'turn', 'too'].includes(w))) out.push({ id: 'hook', value: 1, src });
    else if (!melody && has(REGEN) && !has(LEVEL_DOWN)) out.push({ id: 'variation', target, amt: 1, src });
    else {
      const down = has(LEVEL_DOWN) !== words.includes('too') !== (copula && !words.includes('too') && has(LEVEL_DOWN));
      out.push({ id: 'level', target: real(target), amt: (down ? -1 : 1) * int, src });
    }
    if (entry.k === 'voice') break;
  }
  return out;
}

function resolve(entry, mods, ctx, src, flags = {}) {
  const words = mods;
  const neg = words.filter((w) => NEGATE.has(w)).length % 2 === 1 && !words.includes('enough');
  let int = 1;
  for (const w of words) if (INTENSITY[w] != null && INTENSITY[w] !== 1) int = INTENSITY[w];
  const sign = (neg ? -1 : 1) * (flags.dislike || flags.hate ? -1 : 1);
  const out = [];
  if (entry.k === 'axis') out.push({ id: entry.id, amt: entry.sign * sign * int, src });
  else if (entry.k === 'bundle') for (const e of BUNDLES[entry.id](sign * int, ctx).filter(Boolean)) out.push({ ...e, src });
  else if (entry.k === 'complaint') {
    // "boring", "too boring", "less boring" all ask for the fix; only "make it boring" asks for the thing itself.
    const want = flags.imperative && !flags.copula && !neg && !words.includes('too');
    for (const e of COMPLAINTS[entry.id](want ? -int : int).filter(Boolean)) out.push({ ...e, src, why: entry.id });
  }
  else if (entry.k === 'genre') { if (sign > 0) out.push({ id: 'genre', value: entry.id, family: entry.family, src }); }
  else if (entry.k === 'scale') { if (sign > 0) out.push({ id: 'scale', value: entry.v, src }); }
  else if (entry.k === 'kit') { if (sign > 0) out.push({ id: 'kit', value: entry.v, src }); }
  else if (entry.k === 'bassVoice') {
    if (words.some((w) => MUTE.has(w)) || flags.hate) out.push({ id: 'mute', target: 'acid', value: true, src });
    else if (flags.dislike) out.push({ id: 'level', target: 'acid', amt: -1.5, src });
    else out.push({ id: 'bassVoice', value: entry.v, src });
  } else if (isTrack(entry)) out.push(...trackEdits(entry, words, ctx, src, flags));
  return out;
}

function lookup(toks, i) {
  let t = toks[i];
  let entry = W[t];
  if (entry && (STOP.has(t) || INTENSITY[t] != null || NEGATE.has(t)) && !['more', 'bigger', 'add'].includes(t)) entry = null;
  const verb = (s) => s.has(t);
  if (!entry && !STOP.has(t) && INTENSITY[t] == null && !NEGATE.has(t) && ![MUTE, LOCK, UNMUTE, UNLOCK, LEVEL_UP, LEVEL_DOWN, DISLIKE, HATE, COPULA, REGEN, ONLY].some(verb)) {
    const f = fuzzy(t);
    if (f) { entry = W[f]; t = f; }
  }
  if (['more', 'add'].includes(t)) entry = null;
  if (t === 'bigger' && i + 1 < toks.length) entry = null;
  // "drop the kick" mutes; "bigger drop" is about the drop itself.
  if ((t === 'drop' || t === 'cut') && (isTrack(W[toks[i + 1]]) || isTrack(W[toks[i + 2]]))) { entry = null; t = 'drop'; }
  if (t === 'minimal' && W[toks[i + 1]]?.k === 'genre') return { t, skip: true };
  if (i > 0 && t === toks[i - 1] && entry?.k === 'bundle') return { t, skip: true };
  return { t, e: entry || null };
}

// text -> { edits, unknown }. ctx.style lets scene/artist bundles decide whether to switch genre.
// ---------------- follow-ups ----------------
// "more", "too much", "the other way", "undo the reverb but keep the rest" act on the previous change (ctx.last;
// ctx.net is the sum of that run of follow-ups).
const FOLLOW = [
  ['again', /^(?:(?:yes|yeah|ok|okay|nice|good|great|love it|perfect)\s+)?(?:(?:even|a\s+bit|a\s+little|a\s+touch|way|much|lots|a\s+lot|slightly)\s+)*(?:more|again|further|harder|keep\s+going|do\s+(?:it|that)\s+again|one\s+more\s+time|more\s+of\s+that|same\s+again|go\s+further|push\s+it(?:\s+further)?|double\s+it)(?:\s+please)?$/],
  ['less', /^(?:(?:hmm|nah|eh|ok|okay)\s+)?(?:(?:that\s*'?s|that\s+is|it\s*'?s|way|a\s+bit|a\s+little|a\s+touch|slightly)\s+)*(?:too\s+much|too\s+far|overkill|overdone|overdid\s+it|back\s+(?:it\s+)?off|tone\s+it\s+down|ease\s+(?:up|off)|less|less\s+of\s+that|not\s+so\s+much|pull\s+(?:it\s+)?back|dial\s+it\s+back|halfway|half\s+that|not\s+that\s+much)(?:\s+please)?$/],
  ['invert', /^(?:(?:no|nope|nah|wrong|oops)\s+)*(?:(?:the\s+)?other\s+(?:way|direction)(?:\s+round)?|(?:do\s+)?the\s+opposite|opposite|wrong\s+way|reverse\s+(?:it|that)|backwards|flip\s+it)(?:\s+please)?$/],
];
const UNDO_PART = /^(?:(?:no|nah)\s+)*(?:undo|revert|take\s+back|put\s+back|reset|cancel|lose|remove|drop|ditch)\s+(?:the\s+|that\s+|those\s+)?(.+?)(?:\s+(?:change|changes|bit|part|edit))?\s+(?:but\s+|and\s+)?keep\s+(?:the\s+)?(?:rest|everything\s+else|others?|the\s+rest)$/;
const KEEP_PART = /^keep\s+(?:the\s+)?(.+?)(?:\s+(?:change|changes|bit|part|edit))?\s+(?:but\s+|and\s+)?(?:undo|revert|lose|drop|ditch|take\s+back)\s+(?:the\s+)?(?:rest|everything\s+else|others?)$/;
const UNDO_ONLY = /^(?:undo|revert|take\s+back|cancel)\s+(?:the\s+|that\s+|just\s+the\s+|only\s+the\s+)?(.+?)(?:\s+(?:change|changes|bit|part|edit))?(?:\s+only)?$/;
const invertible = (e) => e.amt != null || e.id === 'mute';
const flip = (e, k) => (e.amt != null ? { ...e, amt: Math.max(-3, Math.min(3, e.amt * k)) } : { ...e, value: !e.value });
const scaleBy = (s) => (/\b(?:way|much|lots|a\s+lot|double)\b/.test(s) ? 2 : /\b(?:a\s+bit|a\s+little|a\s+touch|slightly)\b/.test(s) ? 0.5 : 1);
// Which previous edits a phrase like "the reverb" or "the bass" points at.
function pick(last, phrase, ctx) {
  const words = phrase.replace(/\b(?:the|that|those|my|on|of|to)\b/g, ' ').trim();
  const p = parse(words, { ...ctx, last: null, net: null });
  if (!p.edits.length) return null;
  const ids = new Set(p.edits.filter((e) => !(e.id === 'level' && p.edits.length > 1 && !e.amt)).map((e) => e.id));
  const targets = new Set(p.edits.map((e) => e.target).filter(Boolean));
  const trackOnly = p.edits.every((e) => e.target && ['level', 'mute'].includes(e.id));
  return last.filter((e) => (trackOnly ? targets.has(e.target) : ids.has(e.id) && (!targets.size || !e.target || targets.has(e.target))));
}
function followUp(text, ctx) {
  const last = (ctx.last || []).filter((e) => e && e.id !== 'genre');
  if (!last.length) return null;
  const s = text.trim().replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim();
  const src = s;
  const amt = last.filter((e) => e.amt != null);
  for (const [kind, re] of FOLLOW) {
    if (!re.test(s)) continue;
    if (kind === 'again' && amt.length) {
      const k = scaleBy(s);
      return { edits: amt.map((e) => ({ ...flip(e, k), src })), next: amt, follow: kind };
    }
    if (kind === 'less' && amt.length) return { edits: amt.map((e) => ({ ...flip(e, -0.5), src })), next: amt.map((e) => flip(e, -0.5)), follow: kind };
    if (kind === 'invert') {
      const inv = last.filter(invertible);
      if (!inv.length) return null;
      return { edits: inv.map((e) => ({ ...flip(e, -2), src })), next: inv.map((e) => flip(e, -1)), follow: kind };
    }
    return null;
  }
  let m = s.match(UNDO_PART), keep = false;
  if (!m) { m = s.match(KEEP_PART); keep = !!m; }
  const only = !m && s.match(UNDO_ONLY);
  if (!m && !only) return null;
  // Undo reaches back over the whole run of follow-ups ("darker", "more", "too much"), not just the last step.
  const whole = (ctx.net || ctx.last).filter((e) => e && e.id !== 'genre');
  const hit = pick(whole, (m || only)[1], ctx);
  if (!hit || (!keep && !hit.length)) return null;
  const chosen = (keep ? whole.filter((e) => !hit.includes(e)) : hit).filter(invertible);
  if (!chosen.length) return null;
  return { edits: chosen.map((e) => ({ ...flip(e, -1), src })), next: chosen.map((e) => flip(e, -1)), follow: 'undo' };
}

// ---------------- sections ----------------
// "no kick in the breakdown", "longer intro", "make the drop bigger" edit one part of the song. Scenes come from
// arrangement(): 0 intro, 1 build, 2 verse, 3 fill, 4-5 breakdown, 6-7 drop; the chain plays them as letters A-H.
export const SECTION = {
  intro: { p: [0], c: 'A', run: 'first' }, outro: { p: [0, 1], c: 'AB', main: 'A', run: 'last' }, build: { p: [1], c: 'B' },
  verse: { p: [2], c: 'C' }, breakdown: { p: [4, 5], c: 'EF', main: 'E' }, drop: { p: [6, 7], c: 'GH', main: 'G' },
};
const SEC_WORD = { intro: 'intro', intros: 'intro', opening: 'intro', start: 'intro', beginning: 'intro', outro: 'outro', ending: 'outro', end: 'outro',
  build: 'build', buildup: 'build', builds: 'build', riser: 'build', verse: 'verse', verses: 'verse', groove: 'verse', breakdown: 'breakdown', breakdowns: 'breakdown',
  break: 'breakdown', bridge: 'breakdown', drop: 'drop', drops: 'drop', chorus: 'drop', choruses: 'drop', peak: 'drop', climax: 'drop' };
// Weak words only name a section after "the": "drop the kick", "bigger drops", "more groove", "add chorus" stay as they were.
const SEC_WEAK = new Set(['start', 'beginning', 'end', 'build', 'buildup', 'builds', 'break', 'drop', 'drops', 'groove', 'peak', 'climax', 'riser', 'bridge', 'opening', 'chorus', 'choruses', 'ending']);
const SEC_RE = /(?:^|\s)((?:(?:in|on|during|for|at|into|before|after|of|to|from|throughout)\s+)?(?:(?:the|my|this|that|our)\s+)?)(build\s+up|[a-z]+)(?=\s|$)/g;
const SEC_FILLER = new Set(['in', 'on', 'during', 'for', 'at', 'into', 'before', 'after', 'of', 'to', 'from', 'throughout', 'the', 'my', 'this', 'that', 'our', 'a', 'an', 'please', 'part', 'section', 'bit']);
function findSection(clause) {
  for (const m of clause.matchAll(SEC_RE)) {
    const w = m[2].replace(/\s+/g, '');
    if (!SEC_WORD[w]) continue;
    if (SEC_WEAK.has(w) && !/\b(?:the|my|this|that|our)\s*$/.test(m[1])) continue;
    // "add a breakdown", "an intro" ask for more of a thing, not an edit of the existing one.
    if (!m[1] && /\b(?:a|an|another|more|some)\s*$/.test(clause.slice(0, m.index + 1))) continue;
    return { sec: SEC_WORD[w], text: m[0] };
  }
  return null;
}
// Part of the song: "bar 17", "bars 9-16", "the last 8 bars", "the second drop", "drop 2". bars are 1-based and
// inclusive; negative ones count from the end (-8..-1 is the last 8 bars). nth picks one pass of a section (-1 = last).
const NUM = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, sixteen: 16, 'thirty two': 32 };
const ORD = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5, last: -1, final: -1 };
const numOf = (w) => (/^\d+$/.test(w) ? +w : NUM[w]);
const NUM_W = '\\d+|one|a|two|three|four|five|six|seven|eight|nine|ten|twelve|sixteen|thirty[\\s-]two';
const PRE = '(?:(?:in|on|at|for|during|over|across|of|to|from|throughout|into)\\s+)?(?:(?:the|my|this|that|our)\\s+)?';
const BARS_RE = new RegExp(`\\s${PRE}(?:(?:bars?|measures?)\\s+(\\d+)(?:\\s*(?:-|–|to|through|thru|until)\\s*(\\d+))?|(first|last|final|opening|closing)\\s+(?:(${NUM_W})\\s+)?(?:bars?|measures?))(?=\\s|$)`);
const SEC_NAMES = Object.keys(SEC_WORD).filter((w) => !['start', 'beginning', 'end', 'ending', 'opening', 'groove', 'peak', 'climax', 'riser'].includes(w)).join('|');
const NTH_RE = new RegExp(`\\s${PRE}(?:(${Object.keys(ORD).join('|')})\\s+(${SEC_NAMES})|(${SEC_NAMES})\\s+(\\d|one|two|three|four))(?=\\s|$)`);
export function findScope(clause) {
  const b = clause.match(BARS_RE);
  if (b) {
    let bars;
    if (b[1]) { const x = +b[1], y = b[2] ? +b[2] : x; bars = [Math.min(x, y), Math.max(x, y)]; }
    else { const n = b[4] ? numOf(b[4].replace(/[\s-]+/g, ' ')) : 1; bars = /first|opening/.test(b[3]) ? [1, n] : [-n, -1]; }
    if (bars.some((x) => !x || Math.abs(x) > 999)) return null;
    return { sec: 'bars', bars, text: b[0] };
  }
  const m = clause.match(NTH_RE);
  if (m) {
    const w = (m[2] || m[3]).replace(/\s+/g, ''), nth = m[1] ? ORD[m[1]] : numOf(m[4]);
    if (SEC_WORD[w] && nth) return { sec: SEC_WORD[w], nth, text: m[0] };
  }
  return null;
}
const ORDINAL = { 1: 'first ', 2: 'second ', 3: 'third ', 4: 'fourth ', 5: 'fifth ', [-1]: 'last ' };
const TENSION = /\b(?:tension|tense|tenser|suspense|anticipation|anticipate|rising|rise|lift|ramp|build\s+up|builds?\s+more)\b/;
const OCTAVE = /\boctaves?\b/;
const OCT_DOWN = /\b(?:down|lower|deeper|drop)\b/;
const PULL_OUT = /\b(?:strip|pull|take|cut|leave|rip)\b.*\bout\b|\bstrip\b/;
const SOONER = /\b(?:sooner|earlier|faster|quicker|straight|right\s+away|asap)\b/;
const LONGER = /\b(?:longer|extend|extended|stretch|lengthen|draw\s+out|more\s+of)\b/;
const SHORTER = /\b(?:shorter|shorten|trim|tighter|quicker|less\s+of|too\s+long|drags?|dragging)\b/;
const SKIP = /^(?:no|skip|cut|remove|lose|ditch|drop|kill|delete|without|get\s+rid\s+of|cut\s+out|skip\s+over|lose\s+it|cut\s+it)$/;
const STRIP = /\b(?:strip|stripped|bare|barer|emptier|minimal|drumless|empty)\b/;
const FULLER = /\b(?:bigger|fuller|harder|louder|heavier|huge|massive|punchier|busier|energy|energetic|intense|hype|bang|slap|explode|explosive|epic)\b/;
const SMALLER = /\b(?:smaller|quieter|softer|calmer|sparser|thinner|gentler|lighter|chill|chiller|calm|mellow|less\s+busy)\b/;
const SEC_ENERGY = new Set(['volume', 'drops', 'punch', 'density', 'grit', 'tempo', 'variation', 'pump']);
function sectionClause(sec, rest, src, ctx, carry = [], where = {}) {
  const s = ` ${rest} `;
  const E = (op, x = {}) => ({ id: 'section', sec, op, ...x, ...where, src });
  const plain = rest.replace(/\b(?:the|please|just|i|want|lets|let's|can|you|we)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const tracky = plain.split(' ').some((w) => isTrack(W[w]));
  const named = [...new Set(plain.split(' ').filter((w) => isTrack(W[w])).flatMap((w) => idsOf(W[w])).map(real))];
  // "bass up an octave in the second drop", "strip the hats out of the breakdown", "more tension in the build".
  if (!carry.length && tracky && OCTAVE.test(s)) {
    const tracks = named.filter((t) => t === 'acid' || t === 'stab');
    const n = /\b(?:two|2)\s+octaves\b/.test(s) ? 2 : 1;
    return tracks.length ? { edits: [E('octave', { tracks, amt: OCT_DOWN.test(s) ? -n : n })] } : { edits: [], miss: true };
  }
  if (!carry.length && tracky && PULL_OUT.test(s) && !/\b(?:back|in)\b/.test(s)) return { edits: [E('mute', { tracks: named })] };
  if (!carry.length && !tracky && TENSION.test(s)) return { edits: [E('tension', { amt: /\b(?:less|no|without|fewer)\b/.test(s) ? -1 : /\b(?:way|much|lot|loads)\b/.test(s) ? 2 : 1 })] };
  if (!carry.length && !tracky && (sec !== 'bars' || !/\b(?:skip|cut|remove|delete|longer|shorter)\b/.test(s))) {
    if (sec === 'drop' && SOONER.test(s)) return { edits: [{ id: 'section', sec: 'intro', op: 'length', amt: -1, src }, { id: 'section', sec: 'build', op: 'length', amt: -1, src }] };
    if (/\btoo\s+short\b/.test(s)) return { edits: [E('length', { amt: 1 })] };
    if (SHORTER.test(s)) return { edits: [E('length', { amt: -1 })] };
    if (LONGER.test(s)) return { edits: [E('length', { amt: /\b(?:way|much|lot|double)\b/.test(s) ? 2 : 1 })] };
    if (SKIP.test(plain)) return { edits: [E('skip')] };
    if (STRIP.test(s)) return { edits: [E('strip')] };
  }
  const sub = carry.length ? carry : parse(rest, { ...ctx, noSection: true, last: null, net: null }).edits;
  const out = [], mute = [], add = [];
  let energy = 0, left = 0;
  for (const e of sub) {
    if (e.target && e.id === 'mute') (e.value ? mute : add).push(e.target);
    else if (e.target && e.id === 'level') { if (e.amt > 0) add.push(e.target); else out.push(E('density', { tracks: [e.target], amt: e.amt })); }
    else if (e.target && e.id === 'density') out.push(E('density', { tracks: [e.target], amt: e.amt }));
    else if (e.id === 'hook') out.push(E('hook', { value: e.value ? 1 : 0 }));
    else if (!e.target && SEC_ENERGY.has(e.id) && e.amt) energy += Math.sign(e.amt);
    else left++;
  }
  if (mute.length) out.push(E('mute', { tracks: [...new Set(mute)] }));
  if (add.length) out.push(E('add', { tracks: [...new Set(add)] }));
  if (!out.length && !energy && !left) energy = SMALLER.test(s) || /\bless\b/.test(s) ? -1 : FULLER.test(s) ? 1 : 0;
  if (energy) out.push(E('energy', { amt: Math.sign(energy) }));
  return { edits: out, miss: left > 0 || !out.length };
}

// Mix-aware fixes. Each stem's loudness against the whole mix (LU) and the share of energy above 120 Hz
// in the 200–500 Hz mud and 2–5 kHz harsh bands, measured on the drops of 32 generated songs (medians).
export const TYPICAL = { kick: -4.3, clap: -19.3, snare: -27.3, ch: -22.8, oh: -18.1, ride: -18.5, perc: -28.5, acid: -7.2, stab: -6.9, vox: -22.4 };
export const TYPICAL_BANDS = { mud: 0.33, harsh: 0.019 };

export const needsMix = (edits) => edits.some((e) => (e.id === 'level' && e.target && e.amt) || e.why === 'muddy' || e.why === 'harsh');

// Re-sizes level and muddy/harsh edits from a measurement (measureMix in mix-check.js): a part that is
// already far over its usual place comes down to it in one go, one that is under it moves a small step.
export function mixAdjust(edits, m, state) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v)), r1 = (v) => Math.round(v * 10) / 10;
  const notes = [], upper = Math.max(1e-6, 1 - (m.bands?.subShare || 0) - (m.bands?.lowShare || 0));
  const ratio = m.bands ? { muddy: m.bands.mudShare / upper / TYPICAL_BANDS.mud, harsh: Math.sqrt(m.bands.harshShare / upper / TYPICAL_BANDS.harsh) } : {};
  const out = edits.map(({ db: _, ...e }) => {
    if (e.amt == null) return e;
    if (ratio[e.why] != null) {
      const k = clamp(r1(ratio[e.why]), 0.5, 2);
      const n = `${e.why === 'muddy' ? 'low-mids' : 'highs'} ${k >= 1.2 ? 'measured heavy' : k <= 0.8 ? 'measured clean, gentle fix' : 'measured about normal'}`;
      if (!notes.includes(n)) notes.push(n);
      return { ...e, amt: clamp(e.amt * k, -3, 3) };
    }
    const t = e.target, rel = m.tracks?.[t], typ = TYPICAL[t], L = state.params?.[t]?.level;
    if (e.id !== 'level' || !t || rel == null || typ == null || !(L > 0)) return e;
    const mag = Math.abs(e.amt);
    const want = clamp(e.amt < 0 ? Math.min(-1.5 * mag, typ - 1 - rel) : Math.max(1.5 * mag, typ + 1 - rel), -12, 9);
    const nl = clamp(L * 10 ** (want / 20), 0.02, 1.2), db = r1(20 * Math.log10(nl / L));
    return db ? { ...e, amt: (nl - L) / 0.12, db } : e;
  });
  return { edits: out, notes };
}

// Voice input: speech engines hear "courts" for chords and "symbols" for cymbals and wrap requests in
// filler. Picks the alternative transcript the parser understands best.
const SPOKEN = [[/\bcourts?\b/g, 'chords'], [/\bsymbols?\b/g, 'cymbals'], [/\bhigh[\s-]?hats?\b/g, 'hats'], [/\bbeats per minute\b/g, 'bpm'],
  [/^(?:(?:hey|okay|ok|so|um+|uh+|erm|please|can you|could you)[\s,]+)+/, ''], [/[\s,]+please$/, '']];
export function heard(alternatives) {
  let best = null;
  for (const [i, raw] of [...alternatives].entries()) {
    let text = String(raw || '').toLowerCase().trim().replace(/[.!?]+$/, '');
    for (const [re, to] of SPOKEN) text = text.replace(re, to);
    text = text.trim();
    if (!text) continue;
    const p = parse(text), score = (p.edits.length ? 100 : 0) - 10 * p.unknown.length - i;
    if (!best || score > best.score) best = { text, score };
  }
  return best?.text || '';
}

export { merge as mergeEdits };
export function parse(text, ctx = {}) {
  const fu = followUp(String(text || '').toLowerCase().replace(/[’']/g, "'"), ctx);
  if (fu) return { edits: merge(fu.edits), unknown: [], follow: fu.follow, next: fu.next };
  // "undo the reverb" with nothing to undo must not add reverb.
  if (UNDO_ONLY.test(String(text || '').toLowerCase().trim().replace(/[.!?,]+/g, ' ').replace(/\s+/g, ' ').trim())) return { edits: [], unknown: [String(text).trim()] };
  const s = normalize(text);
  const clauses = s.split(/\s*(?:,|;|\.|!|\?|\band\b|&|\+|\bbut\b|\bthen\b|\balso\b|\bplus\b|\bwith\b|\bwhile\b|\bnow\b)\s*/).map((c) => c.trim()).filter(Boolean);
  const edits = [], unknown = [];
  let lastTrack = null, pending = null, clauseStart = 0;
  for (const clause of clauses) {
    const before = edits.length;
    const src = clause.replace(/\s+/g, ' ');
    const prevStart = clauseStart;
    clauseStart = before;
    const len = !ctx.noSection && src.match(/^(?:make\s+)?(?:it|the\s+(?:song|track|tune))\s+(?:a\s+bit\s+|way\s+|much\s+)?(longer|shorter)$|^(longer|shorter)\s+(?:song|track|tune)$/);
    if (len) { edits.push({ id: 'section', sec: 'drop', op: 'length', amt: (len[1] || len[2]) === 'longer' ? 1 : -1, src }); lastTrack = null; continue; }
    const found = !ctx.noSection && (findScope(` ${clause} `) || findSection(` ${clause} `));
    if (found || (pending && !ctx.noSection)) {
      const at = found || pending, sec = at.sec;
      const where = at.bars ? { bars: at.bars } : at.nth ? { nth: at.nth } : {};
      const restS = (found ? ` ${clause} `.replace(found.text, ' ') : clause).replace(/\s+/g, ' ').trim();
      const left = restS.split(' ').filter((w) => w && !SEC_FILLER.has(w));
      // "in the breakdown, no kick" names the section first; it holds for the rest of the request.
      if (found && !left.length) { pending = found; continue; }
      // "no kick and snare in the breakdown": the kick clause before belongs to the breakdown too.
      let carry = [];
      const bare = left.filter((w) => !STOP.has(w));
      if (lastTrack && bare.length && bare.every((w) => isTrack(W[w]))) {
        carry = edits.slice(prevStart, before).filter((e) => e.target);
        for (const e of carry) edits.splice(edits.indexOf(e), 1);
        const tg = [...new Set(bare.flatMap((w) => idsOf(W[w])).map(real))];
        carry.push(...tg.flatMap((t) => lastTrack.map((e) => ({ ...e, target: t }))));
      }
      const got = sectionClause(sec, restS, src, ctx, carry, where);
      edits.push(...got.edits);
      if (got.miss) unknown.push(clause);
      lastTrack = null;
      continue;
    }
    const rest = extract(` ${clause} `, edits);
    const toks = rest.split(/[^a-z0-9#]+/).filter(Boolean);
    const items = toks.map((_, i) => lookup(toks, i)).filter((x) => !x.skip);
    const words = items.map((x) => x.t);
    const hasW = (set) => words.some((w) => set.has(w));
    const flags = { dislike: hasW(DISLIKE), hate: hasW(HATE), copula: hasW(COPULA) && !hasW(IMPERATIVE), imperative: hasW(IMPERATIVE) };
    const tracks = items.filter((x) => isTrack(x.e));
    const targets = [...new Set(tracks.flatMap((x) => idsOf(x.e)).map(real))];
    const clauseTrack = [];

    // "only the kick and bass", "mute everything except the hats", "solo the vocals".
    const soloVerb = items.some((x, i) => ['solo', 'isolate'].includes(x.t) && isTrack(items.slice(i + 1).find((y) => y.e || !STOP.has(y.t))?.e));
    if (targets.length && (hasW(new Set(['only', 'except'])) || soloVerb || (words.includes('just') && items.every((x) => !x.e || isTrack(x.e))))) {
      for (const id of TRACK_IDS) edits.push({ id: 'mute', target: id, value: !targets.includes(id), src });
      if (targets.includes('stab') && tracks.some((x) => x.e.ids?.includes('melody'))) edits.push({ id: 'hook', value: 1, src });
      lastTrack = null;
      continue;
    }

    // A bare track after a track edit takes the same edit: "mute the kick and snare", "quieter hats and claps".
    if (tracks.length && items.every((x) => !x.e || isTrack(x.e)) && items.every((x) => isTrack(x.e) || STOP.has(x.t)) && lastTrack) {
      for (const t of targets) for (const e of lastTrack) edits.push({ ...e, target: t, src });
      continue;
    }

    if (tracks.some((x) => melodyRegen(x, words))) {
      edits.push({ id: 'hook', value: 2, src });
      for (let i = items.length - 1; i >= 0; i--) if (REGEN.has(items[i].t) || items[i].e?.ids?.includes('melody')) items.splice(i, 1);
      if (!items.some((x) => x.e)) { lastTrack = null; continue; }
    }
    const nextReal = (i) => items.slice(i + 1).find((y) => y.e || !STOP.has(y.t));
    const blocked = items.some((x, i) => (HARD_VERB.has(x.t) || MUTE.has(x.t)) && isTrack(nextReal(i)?.e));
    const scopedItems = items.filter((x) => x.e && ((x.e.k === 'axis' && SCOPED.has(x.e.id)) || x.e.k === 'complaint' || (x.e.k === 'bundle' && x.e.id === 'fat')));
    if (targets.length && scopedItems.length && !blocked && !flags.hate && !flags.dislike) {
      const mods = items.filter((x) => !x.e).map((x) => x.t);
      const neg = mods.filter((w) => SCOPE_NEG.has(w)).length % 2 === 1;
      let int = 1;
      for (const w of mods) if (INTENSITY[w] != null && INTENSITY[w] !== 1) int = INTENSITY[w];
      // "the vocals are quiet" names a problem; "the vocals are too quiet" already says which way.
      const flip = flags.copula && !mods.some((w) => SCOPE_NEG.has(w)) ? -1 : 1;
      for (const x of scopedItems) for (const t of targets) {
        if (x.e.k === 'complaint') {
          for (const c of TRACK_COMPLAINT[x.e.id](t).filter(Boolean)) clauseTrack.push(...scoped(c[0] === 'level' ? 'volume' : c[0], c[1] * int, t, src));
        } else if (x.e.k === 'bundle') clauseTrack.push(...scoped('volume', (neg ? -1 : 1) * flip * int, t, src));
        else clauseTrack.push(...scoped(x.e.id, x.e.sign * (neg ? -1 : 1) * flip * int, t, src));
      }
      edits.push(...clauseTrack);
      let mods2 = [];
      for (const x of items) {
        if (!x.e) { mods2.push(x.t); continue; }
        if (scopedItems.includes(x)) { mods2 = []; continue; }
        if (x.e.k === 'voice' && !neg) edits.push({ id: 'voice', value: x.e.v, src });
        else if (x.e.k === 'track' && x.e.ids.includes('melody') && words.some((w) => REGEN.has(w))) edits.push({ id: 'hook', value: 2, src });
        else if (!isTrack(x.e)) edits.push(...resolve(x.e, mods2, ctx, src, flags));
        mods2 = [];
      }
      lastTrack = clauseTrack.filter((e) => e.target).map(({ target, src: _, ...e }) => e);
      lastTrack = lastTrack.filter((e, i) => lastTrack.findIndex((y) => y.id === e.id) === i);
      continue;
    }

    let mods = [];
    for (let i = 0; i < items.length; i++) {
      const x = items[i];
      if (!x.e) { mods.push(x.t); continue; }
      if (isTrack(x.e)) {
        // Verbs can trail the track: "turn the bass down", "hats off".
        let j = i + 1;
        const trail = [];
        while (j < items.length && !items[j].e) trail.push(items[j++].t);
        const verbs = [...mods, ...trail].some((w) => [MUTE, UNMUTE, LOCK, UNLOCK, LEVEL_UP, LEVEL_DOWN, NEGATE, DISLIKE, HATE, REGEN].some((set) => set.has(w)));
        // "make the chords richer" is about the chords' harmony, not their level.
        if (x.e.k === 'track' && !verbs && !flags.dislike && !flags.hate && (edits.length > before || items.some((y) => y.e && !isTrack(y.e)))) { i = j - 1; continue; }
        if (melodyRegen(x, words)) { edits.push({ id: 'hook', value: 2, src }); i = j - 1; mods = []; continue; }
        const got = resolve(x.e, [...mods, ...trail], ctx, src, flags);
        edits.push(...got);
        clauseTrack.push(...got.filter((e) => e.target));
        i = j - 1;
      } else if (!(REGEN.has(x.t) && tracks.length)) edits.push(...resolve(x.e, mods, ctx, src, flags));
      mods = [];
    }
    if (clauseTrack.length) lastTrack = clauseTrack.map(({ target, src: _, ...e }) => e).filter((e, i, a) => a.findIndex((y) => y.id === e.id) === i);
    else if (edits.length > before) lastTrack = null;
    // A clause of only modifiers ("way more", "a bit less") rescales the previous edit.
    if (edits.length === before && mods.length) {
      const prev = edits[edits.length - 1];
      const int = mods.map((w) => INTENSITY[w]).filter((x) => x != null && x !== 1).pop();
      // "faster but not too much" tones the last edit down rather than reversing it.
      const easy = mods.includes('not') && mods.some((w) => ['too', 'much', 'crazy', 'overboard'].includes(w));
      const neg = !easy && mods.some((w) => NEGATE.has(w));
      if (prev && prev.amt != null && easy) { prev.amt *= 0.5; continue; }
      if (prev && prev.amt != null && (int || neg)) { prev.amt *= (int || 1) * (neg ? -1 : 1); continue; }
      if (mods.some((w) => !STOP.has(w))) unknown.push(clause);
    }
  }
  // An explicit BPM already says how fast: "slow down to 90".
  const exact = edits.some((e) => e.id === 'bpm');
  return { edits: merge(exact ? edits.filter((e) => e.id !== 'tempo') : edits), unknown };
}
const melodyRegen = (x, words) => x.e.k === 'track' && x.e.ids.includes('melody') && words.some((w) => REGEN.has(w));

// Same intent twice ("darker, much darker") adds up; the last explicit value wins.
function merge(edits) {
  const out = [];
  for (const e of edits) {
    const key = (x) => `${x.id}:${x.target || ''}:${x.sec || ''}:${x.op || ''}:${(x.tracks || []).join()}:${x.nth || ''}:${x.bars || ''}`;
    const k = key(e);
    const prev = out.find((x) => key(x) === k);
    if (!prev) { out.push({ ...e }); continue; }
    if (e.amt != null && prev.amt != null) prev.amt = Math.max(-3, Math.min(3, prev.amt + e.amt));
    else Object.assign(prev, e);
  }
  return out.filter((e) => e.amt == null || Math.abs(e.amt) > 1e-6);
}

// ---------------- optional external interpreter ----------------
// Edits are a closed vocabulary, so any model's output can be validated before it touches the song.
export const INTENTS = {
  tone: 'amt: + brighter / - darker', warmth: 'amt: + warmer / - colder', tempo: 'amt: ±1 = ±6 BPM', bpm: 'value: 60-200',
  swing: 'amt: + swing / - straight', density: 'amt: + busier / - sparser', drops: 'amt: + bigger drops', space: 'amt: + reverb / - drier',
  echo: 'amt: + echo', grit: 'amt: + drive / - cleaner', pump: 'amt: + sidechain', punch: 'amt: + kick punch', variation: 'amt: + mutate / - steadier',
  volume: 'amt: ± master', harmony: 'amt: + richer chords / - plainer', dust: 'amt: + vinyl dust', scale: `value: ${Object.keys(SCALES).join('|')}`,
  key: 'value: 0-11 (C=0)', keyStep: 'amt: ±1 semitone', voice: `value: 0-12 (${VOICE_NAMES.join(', ')})`, bassVoice: `value: 0-5 (${BASS_NAMES.join(', ')})`,
  bpmScale: 'value: 0.5 half time | 2 double time', hook: 'value: 0 no melody | 1 add melody | 2 new melody',
  kit: 'value: 0 machine | 1 live', level: `target: ${TRACK_IDS.join('|')}, amt`, mute: 'target, value: bool', lock: 'target, value: bool', genre: `value: ${Object.keys(STYLES).join('|')}`,
  section: `sec: ${Object.keys(SECTION).join('|')}|bars; op: mute|add|density (tracks[]), energy|length|tension (amt), octave (tracks[] acid|stab, amt ±1|2), skip, strip, hook (value 0|1); `
    + 'optional nth: 1-8 or -1 (which pass of sec: "second drop" = 2, "last drop" = -1); sec bars needs bars: [from, to] 1-based ("bars 9-16" = [9,16], "last 8 bars" = [-8,-1])',
};
export function validateEdits(list) {
  if (!Array.isArray(list)) return [];
  const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : null);
  const out = [];
  for (const e of list.slice(0, 12)) {
    if (!e || !INTENTS[e.id]) continue;
    const x = { id: e.id, src: String(e.src || '').slice(0, 80) };
    if (e.id === 'section') {
      const byBar = e.sec === 'bars';
      if ((!SECTION[e.sec] && !byBar) || !['mute', 'add', 'density', 'energy', 'hook', 'length', 'skip', 'strip', 'tension', 'octave'].includes(e.op)) continue;
      Object.assign(x, { sec: e.sec, op: e.op });
      // Where: bars [from, to] (1-based, negative from the end, same sign) or the nth pass of a section.
      if (byBar) {
        const b = Array.isArray(e.bars) ? e.bars.map((v) => Math.round(+v)) : [];
        if (b.length !== 2 || !b.every((v) => Number.isFinite(v) && v && Math.abs(v) <= 128) || Math.sign(b[0]) !== Math.sign(b[1]) || b[0] > b[1]) continue;
        if (['length', 'skip'].includes(e.op)) continue;
        x.bars = b;
      } else if (e.nth != null) {
        const n = Math.round(+e.nth);
        if (!(n === -1 || (n >= 1 && n <= 8))) continue;
        x.nth = n;
      }
      if (['mute', 'add', 'density', 'octave'].includes(e.op)) { x.tracks = (Array.isArray(e.tracks) ? e.tracks : []).filter((t) => TRACK_IDS.includes(t) && (e.op !== 'octave' || t === 'acid' || t === 'stab')).slice(0, TRACK_IDS.length); if (!x.tracks.length) continue; }
      if (['density', 'energy', 'length', 'tension'].includes(e.op)) { if ((x.amt = num(e.amt, -3, 3)) == null || !x.amt) continue; }
      if (e.op === 'octave') { if (!(x.amt = Math.round(num(e.amt, -2, 2) ?? 0))) continue; }
      if (e.op === 'hook') x.value = e.value ? 1 : 0;
      out.push(x);
      continue;
    }
    if (['level', 'mute', 'lock'].includes(e.id)) { if (!TRACK_IDS.includes(e.target)) continue; x.target = e.target; }
    else if (['tone', 'space', 'echo', 'grit', 'density', 'variation'].includes(e.id) && e.target != null) { if (!TRACK_IDS.includes(e.target)) continue; x.target = e.target; }
    if (['mute', 'lock'].includes(e.id)) x.value = !!e.value;
    else if (e.id === 'bpmScale') { if (![0.5, 2].includes(+e.value)) continue; x.value = +e.value; }
    else if (e.id === 'hook') { if ((x.value = num(e.value, 0, 2)) == null) continue; x.value = Math.round(x.value); }
    else if (e.id === 'scale') { if (!SCALES[e.value]) continue; x.value = e.value; }
    else if (e.id === 'genre') { if (!STYLES[e.value]) continue; x.value = e.value; }
    else if (e.id === 'bpm') { if ((x.value = num(e.value, 60, 200)) == null) continue; x.value = Math.round(x.value); }
    else if (e.id === 'key') { if ((x.value = num(e.value, 0, 11)) == null) continue; x.value = Math.round(x.value); }
    else if (e.id === 'voice') { if ((x.value = num(e.value, 0, 12)) == null) continue; x.value = Math.round(x.value); }
    else if (e.id === 'bassVoice') { if ((x.value = num(e.value, 0, 5)) == null) continue; x.value = Math.round(x.value); }
    else if (e.id === 'kit') { if ((x.value = num(e.value, 0, 2)) == null) continue; x.value = Math.round(x.value); }
    else { if ((x.amt = num(e.amt, -3, 3)) == null || !x.amt) continue; }
    out.push(x);
  }
  return out;
}
// Local rules first; `remote` (e.g. an env-gated /api endpoint backed by an LLM) is only asked about
// phrases the rules don't understand. Off unless a caller passes one.
export async function interpret(text, ctx = {}, { remote } = {}) {
  const local = parse(text, ctx);
  if (!remote || !local.unknown.length) return { ...local, via: 'rules' };
  try {
    const r = await remote(local.unknown.join(', '), { ...ctx, intents: INTENTS });
    const extra = validateEdits(r?.edits);
    if (extra.length) return { edits: merge([...local.edits, ...extra]), unknown: [], via: 'remote' };
  } catch {}
  return { ...local, via: 'rules' };
}

// ---------------- applying ----------------
const MQ = Object.fromEntries(MASTER_PARAMS.map((q) => [q.id, q]));
const clampTo = (q, v) => Math.max(q.min, Math.min(q.max, v));
const r3 = (v) => Math.round(v * 1000) / 1000;
const pq = (tid, id) => TRACK_BY_ID[tid].params.find((q) => q.id === id) || { min: 0, max: 1.2 };
const hashi = (...xs) => { let h = 2166136261; for (const x of xs) h = Math.imul(h ^ (x | 0), 16777619); return ((h >>> 0) % 10007) / 10007; };
const ext = { 0: 3, 10: 3, 1: 7, 7: 7, 2: 9, 9: 9, 3: 9 };
const QUAL = { m: { 3: 0, 7: 1, 9: 2 }, M: { 3: 10, 7: 7, 9: 9 } };
const isMajorChord = (c) => [7, 9, 10].includes(c);

function remapNote(n, from, to) {
  const F = from.slice(0, -1), T = to.slice(0, -1);
  const pc = ((n % 12) + 12) % 12, base = n - pc;
  let j = F.indexOf(pc);
  if (j < 0) return n;
  j = Math.round((j * (T.length - 1)) / Math.max(1, F.length - 1));
  return base + T[Math.min(j, T.length - 1)];
}
function quality(scale, rootPc) {
  const T = (SCALES[scale] || SCALES.minor).notes.slice(0, -1);
  const deg = T.length === 7 ? T : SCALES.minor.notes.slice(0, -1);
  const j = deg.indexOf(((rootPc % 12) + 12) % 12);
  if (j < 0) return null;
  const third = (deg[(j + 2) % 7] + (j + 2 >= 7 ? 12 : 0)) - deg[j];
  return third === 4 ? 'M' : 'm';
}
function requality(c, q) {
  if (ext[c] == null || !q) return c;
  if (c === 3 && q === 'm') return 3;
  return QUAL[q][ext[c]];
}
const hits = (arr, len = STEPS) => arr.slice(0, len).filter((v) => (typeof v === 'object' ? v.on : v)).length;
const weight = (i) => (i % 4 === 0 ? 3 : i % 2 === 0 ? 2 : 1);

function thin(p, id, frac, seed, pi) {
  const len = p.len[id] || STEPS, arr = p.steps[id];
  const on = (i) => (id === 'acid' ? arr[i].on : arr[i]);
  const protect = (i) => (id === 'snare' && (i === 4 || i === 12)) || (id === 'acid' && i === 0) || (id !== 'acid' && arr[i] === 2 && id === 'snare');
  const idx = [];
  for (let i = 0; i < len; i++) if (on(i) && !protect(i)) idx.push(i);
  const total = hits(arr, len);
  if (total < 2) return;
  idx.sort((a, b) => weight(a) - weight(b) || hashi(seed, pi, a) - hashi(seed, pi, b));
  const n = Math.min(idx.length, total - 1, Math.max(1, Math.round(total * frac)));
  for (const i of idx.slice(0, n)) { if (id === 'acid') arr[i] = { ...arr[i], on: false, s: false }; else arr[i] = 0; }
}
function thicken(p, id, frac, seed, pi) {
  const len = p.len[id] || STEPS, arr = p.steps[id];
  if (!hits(arr, len)) return;
  const on = (i) => (id === 'acid' ? arr[i].on : arr[i]);
  const empty = [];
  for (let i = 0; i < len; i++) if (!on(i)) empty.push(i);
  if (!empty.length) return;
  empty.sort((a, b) => weight(b) - weight(a) || hashi(seed, pi, a) - hashi(seed, pi, b));
  const n = Math.max(1, Math.round(empty.length * frac * (id === 'stab' || id === 'acid' ? 0.5 : 0.8)));
  for (const i of empty.slice(0, n)) {
    if (id === 'acid') { let k = i; while (k > 0 && !arr[k].on) k--; arr[i] = { on: true, n: arr[k].on ? arr[k].n : 0, a: false, s: false }; }
    else arr[i] = 1;
  }
}
const DEFAULT_HITS = { acid: [0, 3, 6, 10, 14], kick: [0, 4, 8, 12], clap: [4, 12], snare: [4, 12], ch: [2, 6, 10, 14], oh: [2, 10], ride: [0, 4, 8, 12], perc: [3, 7, 10, 14], stab: [0], vox: [0, 8] };

function lab(a, more, less) {
  const base = a >= 0 ? more : less;
  const m = Math.abs(a);
  return m < 0.75 ? `a bit ${base}` : m >= 1.75 ? `much ${base}` : base;
}
const signed = (n, unit) => `${n > 0 ? '+' : '−'}${Math.abs(n)}${unit}`;

// Applies edits (all but `genre`, which the caller handles by generating first) to a copy of state.
// Returns { state, did: [labels], skipped: [labels] } — `did` only lists edits that actually changed something.
export function applyEdits(state, edits, { seed = 1, style } = {}) {
  const S = clone(state);
  const did = [], skipped = [];
  const locked = (id) => !!S.locks?.[id];
  const score = S.patterns.some((p) => p.score);
  const loops = S.patterns.filter((p) => !p.score);
  const P = S.params, M = S.master;
  const mset = (id, v) => { M[id] = r3(clampTo(MQ[id], v)); };
  const tset = (tid, id, v) => { if (!locked(tid)) P[tid][id] = r3(clampTo(pq(tid, id), v)); };
  const tmul = (tid, id, f) => tset(tid, id, P[tid][id] * f);
  const lvl = (tid, d) => tset(tid, 'level', P[tid].level + d);
  const SCORE_OK = new Set(['tone', 'warmth', 'tempo', 'bpm', 'bpmScale', 'space', 'echo', 'volume', 'genre']);
  const order = ['scale', 'key', 'keyStep'];
  const list = [...edits].filter((e) => e.id !== 'genre').sort((a, b) => (order.includes(b.id) ? 1 : 0) - (order.includes(a.id) ? 1 : 0));
  for (const e of list) {
    const before = JSON.stringify(S);
    const a = e.amt ?? 0, t = e.target;
    let label = '';
    if (score && !SCORE_OK.has(e.id)) { skipped.push(`${e.src || e.id} (not for a score)`); continue; }
    if (t && locked(t) && !['lock', 'mute'].includes(e.id)) { skipped.push(`${TRACK_WORD[t]} locked`); continue; }
    switch (e.id) {
      case 'tone': {
        const f = (x) => Math.pow(x, a);
        const tp = t && ['cutoff', 'tone', 'tune'].find((k) => P[t][k] != null);
        if (tp) { tmul(t, tp, f(1.45)); label = `${lab(a, 'brighter', 'darker')} ${TRACK_WORD[t]}`; break; }
        tmul('stab', 'cutoff', f(1.45)); tmul('acid', 'cutoff', f(1.3)); tmul('vox', 'tone', f(1.3));
        for (const h of ['ch', 'oh', 'ride']) tmul(h, 'tone', f(1.15));
        mset('warmth', M.warmth - 0.2 * a); mset('revTone', M.revTone * f(1.25));
        label = lab(a, 'brighter', 'darker') + ' tone';
        break;
      }
      case 'warmth': mset('warmth', M.warmth + 0.2 * a); mset('drive', M.drive + 0.04 * a); label = lab(a, 'warmer', 'colder'); break;
      case 'tempo': {
        const d = Math.round(6 * a) || Math.sign(a);
        S.bpm = Math.max(60, Math.min(200, S.bpm + d));
        label = signed(Math.round(S.bpm - JSON.parse(before).bpm), ' BPM');
        break;
      }
      case 'bpmScale': S.bpm = Math.max(60, Math.min(200, Math.round(S.bpm * e.value))); label = `${e.value < 1 ? 'half' : 'double'} time (${S.bpm} BPM)`; break;
      case 'bpm': S.bpm = Math.max(60, Math.min(200, Math.round(e.value))); label = `${S.bpm} BPM`; break;
      case 'swing':
        S.swing = r3(Math.max(0, Math.min(0.6, S.swing + 0.1 * a)));
        mset('humanize', M.humanize + 0.15 * a);
        label = lab(a, 'more swing', 'less swing');
        break;
      case 'density': {
        const frac = Math.min(0.85, 0.3 * Math.abs(a));
        const ids = (t ? [t] : ['ch', 'oh', 'ride', 'perc', 'snare', 'stab', 'acid']).filter((id) => !locked(id));
        S.patterns.forEach((p, pi) => { if (!p.score) for (const id of ids) (a > 0 ? thicken : thin)(p, id, frac, seed, pi); });
        if (a < 0) mset('vary', M.vary * Math.pow(0.7, Math.abs(a)));
        label = lab(a, 'busier', 'sparser') + (t ? ` ${TRACK_WORD[t]}` : ' parts');
        break;
      }
      case 'drops':
        mset('arr', M.arr + 0.5 * a); mset('duck', M.duck + 0.1 * a);
        tset('kick', 'punch', P.kick.punch + 0.08 * a);
        label = a > 0 ? lab(a, 'bigger drops', '') : 'smoother (fewer drops)';
        break;
      case 'space':
        if (t) { tset(t, 'rev', P[t].rev + 0.15 * a); label = `${lab(a, 'more reverb', 'less reverb')} on ${TRACK_WORD[t]}`; break; }
        mset('revLevel', M.revLevel + 0.18 * a); mset('room', M.room + 0.12 * a);
        tset('stab', 'rev', P.stab.rev + 0.08 * a);
        label = lab(a, 'more reverb', 'drier');
        break;
      case 'echo': {
        if (t) { tset(t, 'dly', P[t].dly + 0.15 * a); label = `${lab(a, 'more echo', 'less echo')} on ${TRACK_WORD[t]}`; break; }
        mset('dlyLevel', M.dlyLevel + 0.2 * a); mset('dlyFb', Math.min(0.85, M.dlyFb + 0.1 * a));
        const cap = Math.round(P.stab.voice) >= 7 ? 0.25 : 1;
        tset('stab', 'dly', Math.min(cap, P.stab.dly + 0.12 * a)); tset('perc', 'dly', P.perc.dly + 0.1 * a);
        label = lab(a, 'more echo', 'less echo');
        break;
      }
      case 'grit':
        if (t && P[t].drive != null) { tset(t, 'drive', P[t].drive + 0.2 * a); label = `${lab(a, 'heavier', 'cleaner')} ${TRACK_WORD[t]}`; break; }
        mset('drive', M.drive + 0.18 * a); tset('kick', 'drive', P.kick.drive + 0.15 * a); tset('acid', 'drive', P.acid.drive + 0.15 * a);
        label = lab(a, 'grittier', 'cleaner');
        break;
      case 'pump': mset('duck', M.duck + 0.25 * a); label = lab(a, 'more pump', 'less pump'); break;
      case 'punch':
        tset('kick', 'punch', P.kick.punch + 0.15 * a); tset('kick', 'click', P.kick.click + 0.1 * a); lvl('kick', 0.06 * a);
        label = lab(a, 'punchier kick', 'softer kick');
        break;
      case 'variation':
        mset('vary', M.vary + 0.3 * a);
        if (a > 0) S.patterns.forEach((p, pi) => {
          if (p.score) return;
          const m = mutate(p, seed * 31 + pi, Math.min(0.6, 0.15 * a), (SCALES[S.scale] || SCALES.minor).notes);
          for (const id of (t ? [t] : TRACK_IDS)) if (!locked(id)) { p.steps[id] = m.steps[id]; }
        });
        label = t ? `new ${TRACK_WORD[t]} part` : lab(a, 'more variation', 'steadier');
        break;
      case 'volume': mset('volume', M.volume + 0.08 * a); label = lab(a, 'louder', 'quieter'); break;
      case 'dust': mset('dust', M.dust + 0.25 * a); label = lab(a, 'more vinyl dust', 'less dust'); break;
      case 'harmony': {
        const up = { 0: 1, 1: 2, 7: 9, 10: 9, 6: 1, 4: 2 }, down = { 2: 1, 1: 0, 9: 7, 3: 1, 7: 10 };
        const map = a > 0 ? up : down;
        if (!locked('stab')) {
          P.stab.chord = map[Math.round(P.stab.chord)] ?? P.stab.chord;
          for (const p of loops) for (const arr of [p.prog, p.alt]) if (Array.isArray(arr)) for (const h of arr) h.c = map[h.c] ?? h.c;
        }
        label = a > 0 ? 'richer chords' : 'plainer chords';
        break;
      }
      case 'scale': {
        const from = (SCALES[S.scale] || SCALES.minor).notes, to = SCALES[e.value]?.notes;
        if (!to) break;
        for (const p of loops) {
          if (!locked('acid')) for (const st of p.steps.acid) if (st.on) st.n = remapNote(st.n, from, to);
          if (p.hook) p.hook.s = p.hook.s.map((x) => (x ? [remapNote(x[0], from, to), ...x.slice(1)] : x));
          if (!locked('stab')) for (const arr of [p.prog, p.alt]) if (Array.isArray(arr)) for (const h of arr) {
            h.r = remapNote(h.r, from, to);
            h.c = requality(h.c, quality(e.value, h.r));
          }
        }
        if (!locked('stab')) P.stab.chord = requality(Math.round(P.stab.chord), quality(e.value, 0));
        S.scale = e.value;
        label = `${SCALES[e.value].name.toLowerCase().replace('harm min', 'harmonic minor').replace('min penta', 'pentatonic')} key`;
        break;
      }
      case 'key': S.key = ((Math.round(e.value) % 12) + 12) % 12; label = `key of ${KEYS[S.key]}`; break;
      case 'keyStep': S.key = (((S.key + Math.round(a)) % 12) + 12) % 12; label = `${a > 0 ? 'up' : 'down'} to ${KEYS[S.key]}`; break;
      case 'voice': {
        if (locked('stab')) { skipped.push('chords locked'); continue; }
        const v = Math.round(e.value);
        P.stab.voice = v;
        P.stab.level = r3(Math.max(P.stab.level, v >= 7 ? 0.9 : 0.75));
        if (v >= 7) { P.stab.dly = Math.min(P.stab.dly, 0.08); P.stab.rev = Math.min(P.stab.rev, 0.2); }
        if ([2, 3, 10].includes(v)) P.stab.decay = r3(Math.max(P.stab.decay, 1.4));
        S.mutes.stab = false;
        // Sections with no chord part get one held chord per bar where the groove plays, so a bed (pads/organ/strings)
        // is there from the start, and a genre with no chords at all still gets them.
        const bed = [2, 3, 10].includes(v) || !loops.some((p) => hits(p.steps.stab));
        if (bed) for (const p of loops) if (!hits(p.steps.stab) && (hits(p.steps.kick) || hits(p.steps.acid))) p.steps.stab[0] = 1;
        label = `${VOICE_NAMES[v]} on the chords`;
        break;
      }
      case 'bassVoice':
        if (locked('acid')) { skipped.push('bass locked'); continue; }
        P.acid.voice = Math.round(e.value); S.mutes.acid = false;
        label = BASS_NAMES[P.acid.voice];
        break;
      case 'kit': M.kit = Math.round(e.value); label = M.kit === 1 ? 'live drums' : M.kit === 2 ? 'hybrid kit' : 'drum machine'; break;
      case 'level': {
        const empty = !S.patterns.some((p) => hits(p.steps[t], p.len[t]));
        if (a > 0 && empty && DEFAULT_HITS[t]) {
          for (const p of loops) if (DRUMS.some((d) => hits(p.steps[d]))) for (const i of DEFAULT_HITS[t]) p.steps[t][i] = t === 'acid' ? { on: true, n: 0, a: false, s: false } : 1;
          S.mutes[t] = false;
          label = `added ${TRACK_WORD[t]}`;
          break;
        }
        if (a > 0 && S.mutes[t]) S.mutes[t] = false;
        lvl(t, 0.12 * a);
        label = `${a > 0 ? 'louder' : 'quieter'} ${TRACK_WORD[t]}${e.db ? ` (${e.db > 0 ? '+' : '−'}${Math.abs(e.db)} dB)` : ''}`;
        break;
      }
      case 'mute':
        if (!!S.mutes[t] === !!e.value && !(e.value && S.solos?.[t])) continue;
        S.mutes[t] = !!e.value;
        if (S.solos?.[t] && e.value) S.solos[t] = false;
        label = e.value ? `no ${TRACK_WORD[t]}` : `${TRACK_WORD[t]} back in`;
        break;
      case 'hook': {
        const v = Math.round(e.value);
        if (v === 0) { for (const p of loops) if (p.hook) p.hm = 0; label = 'no melody'; break; }
        if (locked('stab')) { skipped.push('chords locked'); continue; }
        const notes = (SCALES[S.scale] || SCALES.minor).notes;
        const has = loops.some((p) => p.hook);
        const r = rng(seed * 7 + 3);
        const line = v === 2 || !has ? [style, 'deephouse'].map((g) => g && STYLES[g] && hookLine(r, g, notes)).find(Boolean) : null;
        for (const p of loops) {
          if (line) p.hook = clone(line);
          if (p.hook && hits(p.steps.kick)) p.hm = 2;
        }
        S.mutes.stab = false;
        const was = loops.some((p) => p.hook && p.hm);
        if (!line && was) lvl('stab', 0.08);
        label = line ? (has ? 'new melody' : 'added a melody') : was ? 'melody up front' : 'melody back in';
        break;
      }
      case 'section': {
        const sd = SECTION[e.sec], byBar = e.sec === 'bars' && Array.isArray(e.bars);
        if ((!sd && !byBar) || score || S.patterns.length < 8) { skipped.push(`${e.src || e.sec} (needs a full song arrangement)`); continue; }
        const scoped = byBar || !!e.nth;
        if (scoped && !S.chainOn) { skipped.push(`${e.src || e.sec} (song mode is off)`); continue; }
        const chain = S.chainOn ? String(S.chain || '') : '';
        // The passes of this section in the chain, as [start, length] (nth picks one of them).
        let runs = [];
        if (sd && chain) {
          const main = sd.main || sd.c[0];
          runs = [...chain.matchAll(new RegExp(`[${sd.c}]+`, 'g'))].filter((m) => m[0].includes(main));
          if (sd.run === 'first') runs = runs.filter((m) => m.index === 0);
          if (sd.run === 'last') runs = runs.filter((m) => m.index + m[0].length === chain.length);
          // The B bars that wind the song down belong to the outro, not to a build.
          const outro = chain.match(/[AB]*A$/);
          if (e.sec === 'build' && outro) runs = runs.filter((m) => m.index < outro.index || m.index === 0);
          if (e.nth) runs = [e.nth < 0 ? runs[runs.length + e.nth] : runs[e.nth - 1]].filter(Boolean);
        }
        let spots = null;
        if (byBar) {
          const n = chain.length, at = (x) => (x < 0 ? n + x : x - 1);
          const a0 = Math.max(0, at(e.bars[0])), a1 = Math.min(n - 1, at(e.bars[1]));
          spots = [];
          for (let q = a0; q <= a1; q++) spots.push(q);
          if (!spots.length) { skipped.push(`${e.src} (the song has ${n} bars)`); continue; }
        } else if (chain && (e.nth || e.op === 'tension' || runs.length)) spots = runs.flatMap((m) => [...m[0]].map((_, k) => m.index + k));
        if (scoped && sd && !runs.length) { skipped.push(`no ${ORDINAL[e.nth] || ''}${e.sec} in this song`); continue; }
        const secName = byBar ? barsLabel(spots) : e.nth ? `${ORDINAL[e.nth]}${e.sec}` : e.sec;
        const where = byBar ? `in ${secName}` : `in the ${secName}`;
        const tr = (e.tracks || []).filter((id) => TRACK_IDS.includes(id) && !locked(id));
        const words = (ids) => (DRUMS.every((d) => ids.includes(d)) ? ['drums', ...ids.filter((x) => !DRUMS.includes(x)).map((x) => TRACK_WORD[x])] : ids.map((x) => TRACK_WORD[x])).join(' & ');
        const blank = (id) => Array.from({ length: STEPS }, () => (id === 'acid' ? { on: false, n: 0, a: false, s: false } : 0));
        const on = (p, id) => hits(p.steps[id], p.len?.[id]);
        const fillFrom = (p, id) => {
          const from = [6, 7, 2, 4, 5, 1, 0, 3].map((i) => S.patterns[i]).find((q) => q && q !== p && on(q, id));
          if (from) { p.steps[id] = clone(from.steps[id]); if (p.len && from.len?.[id]) p.len[id] = from.len[id]; return; }
          if (!DEFAULT_HITS[id]) return;
          p.steps[id] = blank(id);
          for (const i of DEFAULT_HITS[id]) p.steps[id][i] = id === 'acid' ? { on: true, n: 0, a: false, s: false } : 1;
        };
        const op = e.op;
        if (op === 'length' || op === 'skip') {
          if (!S.chainOn) { skipped.push(`${e.src || e.sec} (song mode is off)`); continue; }
          if (byBar) { skipped.push(`${e.src} (name a section to make it longer, shorter or skip it)`); continue; }
          if (!runs.length) { skipped.push(`no ${e.sec} in this song`); continue; }
          const main = sd.main || sd.c[0];
          let c = S.chain;
          for (const m of [...runs].reverse()) {
            const run = m[0];
            let next = '';
            if (op === 'skip') next = '';
            else if (a > 0) { const n = Math.max(2, Math.round(run.length * 0.5 * a)); next = sd.run === 'last' ? run + main.repeat(n) : main.repeat(n) + run; }
            else next = run.slice(Math.min(run.length - 1, Math.max(1, Math.round(run.length * 0.5 * Math.abs(a)))));
            c = c.slice(0, m.index) + next + c.slice(m.index + run.length);
          }
          if (!c || c.length > 128) { skipped.push(`${e.src || e.sec} (song would be ${c ? 'too long' : 'empty'})`); continue; }
          const d = c.length - S.chain.length;
          remapTakes(S.patterns, S.chain, c);
          S.chain = c;
          if (S.current >= S.patterns.length) S.current = 0;
          label = op === 'skip' ? `no ${secName} (${signed(d, ' bars')})` : `${a > 0 ? 'longer' : 'shorter'} ${secName} (${signed(d, ' bars')})`;
          break;
        }
        if (op === 'add' && tr.some((id) => S.mutes[id])) skipped.push(`${words(tr.filter((id) => S.mutes[id]))} muted`);
        let busier = false;
        if (op === 'hook' && !loops.some((p) => p.hook)) { skipped.push('no melody yet (try "add a melody")'); continue; }
        if (op === 'octave' && tr.includes('stab') && !loops.some((p) => p.hook) && !tr.includes('acid')) { skipped.push('no melody yet (try "add a melody")'); continue; }
        // One edit on a list of patterns; pi seeds the variation, k is how far into its section a bar is (0-1).
        const edit = (p, pi, k = 1) => {
          if (op === 'mute' || op === 'strip') {
            for (const id of op === 'strip' ? DRUMS.filter((d) => !locked(d)) : tr) if (on(p, id)) p.steps[id] = blank(id);
          } else if (op === 'add') {
            const ids = tr.filter((id) => !S.mutes[id]), was = JSON.stringify(p.steps);
            for (const id of ids) if (!on(p, id)) fillFrom(p, id);
            // Already playing there: "more bass in the drop" makes it busier there instead.
            if (JSON.stringify(p.steps) === was && ids.length) { busier = true; for (const id of ids) thicken(p, id, 0.3, seed, pi); }
          } else if (op === 'density') {
            for (const id of tr) (a > 0 ? thicken : thin)(p, id, Math.min(0.85, 0.3 * Math.abs(a)), seed, pi);
          } else if (op === 'energy') {
            const ids = TRACK_IDS.filter((id) => !locked(id) && !S.mutes[id]);
            if (a > 0) {
              for (const id of ids) if (id !== 'vox' && !on(p, id) && S.patterns.some((q) => q !== p && on(q, id))) fillFrom(p, id);
              for (const id of ['ch', 'oh', 'perc', 'snare'].filter((x) => ids.includes(x))) thicken(p, id, 0.25 * a, seed, pi);
              // Hits harder: the downbeats of the kick, clap and snare get the accent.
              for (const id of ['kick', 'clap', 'snare'].filter((x) => ids.includes(x))) p.steps[id] = p.steps[id].map((v, i) => (v && i % 4 === 0 ? 2 : v));
              if (p.hook) p.hm = 2;
            } else for (const id of ids.filter((x) => x !== 'kick')) thin(p, id, Math.min(0.85, 0.3 * Math.abs(a)), seed, pi);
          } else if (op === 'hook') {
            if (p.hook) p.hm = e.value ? 2 : 0;
          } else if (op === 'octave') {
            const d = Math.max(-2, Math.min(2, Math.round(a))) || 1;
            if (tr.includes('acid')) p.steps.acid = p.steps.acid.map((x) => (x.on ? { ...x, n: Math.max(-24, Math.min(24, x.n + 12 * d)) } : x));
            if (tr.includes('stab') && p.hook) p.hook = { ...p.hook, o: Math.max(-1, Math.min(1, (p.hook.o || 0) + d)) };
          } else if (op === 'tension') {
            // Rises across the section: hats and percussion fill in, the snare joins late and rolls on the last bar.
            const ids = (x) => x.filter((id) => !locked(id) && !S.mutes[id]);
            if (a < 0) { for (const id of ids(['ch', 'oh', 'perc', 'snare'])) thin(p, id, Math.min(0.85, 0.3 * Math.abs(a)), seed, pi); return; }
            const g = Math.min(1, a);
            for (const id of ids(['ch', 'perc'])) thicken(p, id, Math.min(0.85, (0.15 + 0.45 * k) * g), seed, pi);
            if (k > 0.5) for (const id of ids(['snare', 'clap'])) { if (!on(p, id)) fillFrom(p, id); thicken(p, id, Math.min(0.85, (k - 0.5) * g), seed, pi); }
            if (k >= 0.99 && ids(['snare']).length) {
              const L = p.len?.snare || STEPS;
              p.steps.snare = p.steps.snare.map((v, i) => (i >= L / 2 && i < L ? (i % 2 === 0 || a > 1 ? 2 : 1) : v));
            }
          }
        };
        if (!spots) {
          sd.p.forEach((i, j) => edit(S.patterns[i], j + sd.p[0]));
        } else {
          // A pattern whose every bar is in scope (and has no per-bar takes) is edited itself; anything partial
          // ("the second drop", "bars 9-16", an outro that shares the intro's pattern) gets per-bar takes.
          const L = 'ABCDEFGH', pos = new Set(spots);
          const progress = new Map();
          for (const m of runs) for (let k = 0; k < m[0].length; k++) progress.set(m.index + k, (k + 1) / m[0].length);
          if (byBar) spots.forEach((q, k) => progress.set(q, (k + 1) / spots.length));
          for (let li = 0; li < 8; li++) {
            const mine = spots.filter((q) => L.indexOf(chain[q]) === li);
            if (!mine.length) continue;
            const base = S.patterns[li];
            const whole = op !== 'tension' && !base.at && [...chain].every((ch, q) => ch !== L[li] || pos.has(q));
            if (whole) { edit(base, li); continue; }
            const groups = new Map();
            for (const q of mine) {
              const cur = patternAt(base, q), k = op === 'tension' ? Math.round(progress.get(q) * 8) / 8 : 1;
              const key = `${k}|${cur === base ? '' : JSON.stringify(cur)}`;
              if (!groups.has(key)) groups.set(key, { cur, k, bars: [] });
              groups.get(key).bars.push(q);
            }
            for (const { cur, k, bars } of groups.values()) {
              const eff = clone(cur);
              delete eff.at;
              edit(eff, li * 16 + bars[0], k);
              for (const q of bars) setTake(base, q, eff);
            }
          }
        }
        const kind = {
          mute: `no ${words(tr)} ${where}`, strip: `stripped-back ${secName} (no drums)`, add: `${busier ? 'busier ' : ''}${words(tr.filter((id) => !S.mutes[id]))} ${where}`,
          density: `${lab(a, 'busier', 'sparser')} ${words(tr)} ${where}`, energy: lab(a, `fuller ${secName}`, `sparser ${secName}`),
          hook: `${e.value ? 'melody' : 'no melody'} ${where}`, tension: a > 0 ? `more tension ${where}` : `less tension ${where}`,
          octave: `${tr.map((x) => (x === 'stab' ? 'melody' : TRACK_WORD[x])).join(' & ')} ${a > 0 ? 'up' : 'down'} ${Math.abs(a) > 1 ? 'two octaves' : 'an octave'} ${where}`,
        };
        if (!kind[op]) continue;
        label = kind[op];
        if (op === 'mute' && !tr.length) continue;
        break;
      }
      case 'lock': S.locks[t] = !!e.value; label = `${e.value ? 'locked' : 'unlocked'} ${TRACK_WORD[t]}`; break;
      default: continue;
    }
    if (JSON.stringify(S) === before) skipped.push(e.id === 'level' && t ? `${TRACK_WORD[t]} is at ${a > 0 ? 'full' : 'lowest'} level` : `${label || e.id} (already there)`);
    else did.push(label);
  }
  const bars = changedBars(state, S);
  return { state: S, did: groupDrums(did), skipped, ...(bars && bars.length && bars.length < String(S.chain || '').length ? { bars } : {}) };
}

// "louder kick, louder snare, louder hats…" reads as "louder drums" once most of the kit moved the same way.
function groupDrums(did) {
  const words = DRUMS.map((d) => TRACK_WORD[d]).sort((a, b) => b.length - a.length);
  const tpl = (l) => { const w = words.find((x) => new RegExp(`(^| )${x}( |$)`).test(l)); return w ? [l.replace(new RegExp(`(^| )${w}( |$)`), '$1{}$2'), w] : null; };
  const count = {};
  for (const l of did) { const x = tpl(l); if (x) count[x[0]] = (count[x[0]] || 0) + 1; }
  const seen = new Set();
  return did.flatMap((l) => {
    const x = tpl(l);
    if (!x || count[x[0]] < 4) return [l];
    if (seen.has(x[0])) return [];
    seen.add(x[0]);
    const rest = words.filter((w) => !did.includes(x[0].replace('{}', w)));
    return [x[0].replace('{}', rest.length && x[0].startsWith('no ') ? `drums except ${rest.join(', ')}` : 'drums')];
  });
}

// The genre to switch to first (or null), and the edits that ride on top of it.
export function genreOf(edits, style) {
  const g = edits.find((e) => e.id === 'genre');
  if (!g || !STYLES[g.value]) return null;
  if (g.value === style || (g.family && STYLES[style]?.family === g.family)) return null;
  return g.value;
}

// Friendly fallback: close vocabulary first, then the general menu.
export function suggest(phrase, n = 6) {
  const toks = normalize(phrase).split(/[^a-z0-9#]+/).filter((t) => t.length >= 4);
  const near = [];
  for (const t of toks) for (const w of VOCAB()) if (t.length >= 5 && lev(t, w) <= 2 && !near.includes(w)) near.push(w);
  const pretty = near.filter((w) => !/genre$|kit$|eightoheight|latenight|mainstage|acidbass|livebass|logdrum/.test(w)).slice(0, 2);
  return [...new Set([...pretty, ...SUGGESTIONS])].slice(0, n);
}

// One call for the UI: parse, then report.
// `regenerate(genre)` returns a fresh state in the new genre; the other edits are then applied on top of it.
export function describe(text, state, { style, seed = 1, regenerate } = {}) {
  const { edits, unknown } = parse(text, { style });
  const genre = genreOf(edits, style);
  const base = genre && regenerate ? regenerate(genre) : state;
  const { state: next, did, skipped, bars } = applyEdits(base, edits, { seed, style: genre || style });
  if (genre) did.unshift(`switched to ${STYLES[genre].name}`);
  return { edits, unknown, genre, state: next, did, skipped, ...(bars && !genre ? { bars } : {}), suggestions: unknown.length || !did.length ? suggest(unknown.join(' ') || text) : [] };
}
