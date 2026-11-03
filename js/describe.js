// "Describe it": plain-language steering. A deterministic, local rule-based parser turns phrases like
// "a bit darker and slower" or "like a 3am warehouse" into concrete edits on the existing controls
// (master macros, track params, swing, bpm, scale/key, density, voices, mutes/locks, genre).
// No network, no paid API. An optional interpreter can be plugged in later via interpret({ remote }).
import { SCALES, KEYS, CHORDS, TRACK_IDS, TRACK_BY_ID, MASTER_PARAMS, STEPS } from './params.js';
import { STYLES, mutate, clone } from './state.js';

// ---------------- vocabulary ----------------
// Multi-word phrases are folded into single tokens before matching.
const PHRASES = [
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
add(genre('neosoul', 'JAZZ & HIP-HOP'), 'jazz', 'soul', 'rnb');
add(genre('boombap', 'JAZZ & HIP-HOP'), 'hiphop', 'rap');
add(genre('breaks'), 'breakbeat', 'breakbeats');
add(genre('dnb'), 'jungle', 'liquid');
add(genre('reggaeton'), 'dembow', 'latin');
add(genre('symphony', 'CLASSICAL'), 'classical', 'symphonic', 'orchestra');
add(genre('ukg'), 'garage');
add(genre('hyperpop'), 'kpop', 'pop');
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
add(voice(10), 'strings', 'string', 'violin', 'violins', 'cello', 'cellos', 'viola', 'orchestral');
const bassVoice = (v) => ({ k: 'bassVoice', v });
add(bassVoice(0), 'acidbass', 'squelch', 'squelchy');
add(bassVoice(1), 'livebass');
add(bassVoice(2), 'eightoheight');
add(bassVoice(3), 'reese', 'wobble', 'wobbly');
add(bassVoice(4), 'logdrum');
const kit = (v) => ({ k: 'kit', v });
add(kit(1), 'livekit'); add(kit(0), 'machinekit');
for (const id of Object.keys(SCALES)) W[id] = { k: 'scale', v: id };
add({ k: 'scale', v: 'minor' }, 'minor');
add({ k: 'scale', v: 'major' }, 'major');
add({ k: 'scale', v: 'phrygian' }, 'phrygian');
// "warm" bundles a little drive; "grand" means piano, "orchestral" strings (later entries win above).

const VOICE_NAMES = ['synth', 'Rhodes keys', 'pads', 'organ', 'brass', 'plucks', 'bells', 'piano', 'guitar', 'horns', 'strings'];
const BASS_NAMES = ['303 acid bass', 'bass guitar', '808 bass', 'reese bass', 'log drum'];
const TRACK_WORD = { kick: 'kick', clap: 'claps', snare: 'snare', ch: 'hats', oh: 'open hats', ride: 'ride', perc: 'percussion', acid: 'bass', stab: 'chords', vox: 'vocals' };

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
  for (const [re, to] of PHRASES) s = s.replace(re, to);
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
  return c;
}

function resolve(entry, mods, ctx, src) {
  const words = mods;
  const neg = words.filter((w) => NEGATE.has(w)).length % 2 === 1 && !words.includes('enough');
  let int = 1;
  for (const w of words) if (INTENSITY[w] != null && INTENSITY[w] !== 1) int = INTENSITY[w];
  const sign = neg ? -1 : 1;
  const out = [];
  if (entry.k === 'axis') out.push({ id: entry.id, amt: entry.sign * sign * int, src });
  else if (entry.k === 'bundle') for (const e of BUNDLES[entry.id](sign * int, ctx).filter(Boolean)) out.push({ ...e, src });
  else if (entry.k === 'genre') { if (!neg) out.push({ id: 'genre', value: entry.id, family: entry.family, src }); }
  else if (entry.k === 'scale') { if (!neg) out.push({ id: 'scale', value: entry.v, src }); }
  else if (entry.k === 'kit') { if (!neg) out.push({ id: 'kit', value: entry.v, src }); }
  else if (entry.k === 'bassVoice') {
    if (words.some((w) => MUTE.has(w))) out.push({ id: 'mute', target: 'acid', value: true, src });
    else out.push({ id: 'bassVoice', value: entry.v, src });
  } else if (entry.k === 'voice' || entry.k === 'track') {
    const ids = entry.k === 'voice' ? ['stab'] : entry.ids;
    const has = (set) => words.some((w) => set.has(w));
    for (const target of ids) {
      if (has(UNLOCK)) out.push({ id: 'lock', target, value: false, src });
      else if (has(LOCK)) out.push({ id: 'lock', target, value: true, src });
      else if (has(UNMUTE)) out.push({ id: 'mute', target, value: false, src });
      else if (has(MUTE)) out.push({ id: 'mute', target, value: true, src });
      else if (entry.k === 'voice' && !has(LEVEL_DOWN) && !words.includes('louder')) out.push({ id: 'voice', value: entry.v, src });
      else {
        const down = has(LEVEL_DOWN) !== words.includes('too');
        out.push({ id: 'level', target, amt: (down ? -1 : 1) * int, src });
      }
      if (entry.k === 'voice') break;
    }
  }
  return out;
}

// text -> { edits, unknown, genre? }. ctx.style lets scene/artist bundles decide whether to switch genre.
export function parse(text, ctx = {}) {
  const s = normalize(text);
  const clauses = s.split(/\s*(?:,|;|\.|!|\?|\band\b|&|\+|\bbut\b|\bthen\b|\balso\b|\bplus\b|\bwith\b|\bwhile\b|\bnow\b)\s*/).map((c) => c.trim()).filter(Boolean);
  const edits = [], unknown = [];
  for (const clause of clauses) {
    const before = edits.length;
    const rest = extract(` ${clause} `, edits);
    const toks = rest.split(/[^a-z0-9#]+/).filter(Boolean);
    let mods = [];
    for (let i = 0; i < toks.length; i++) {
      let t = toks[i];
      if (t === toks[i - 1] && W[t]?.k === 'bundle') continue;
      // "drop the kick" mutes; "bigger drop" is about the drop itself.
      if ((t === 'drop' || t === 'cut') && (W[toks[i + 1]]?.k === 'track' || W[toks[i + 2]]?.k === 'track' || W[toks[i + 1]]?.k === 'voice' || W[toks[i + 2]]?.k === 'voice')) { mods.push('drop'); continue; }
      if (t === 'minimal' && W[toks[i + 1]]?.k === 'genre') continue;
      let entry = W[t];
      if (entry && (STOP.has(t) || INTENSITY[t] != null || NEGATE.has(t)) && !['more', 'bigger', 'add'].includes(t)) entry = null;
      if (!entry && !STOP.has(t) && INTENSITY[t] == null && !NEGATE.has(t) && !MUTE.has(t) && !LOCK.has(t) && !UNMUTE.has(t) && !UNLOCK.has(t) && !LEVEL_UP.has(t) && !LEVEL_DOWN.has(t)) {
        const f = fuzzy(t);
        if (f) { entry = W[f]; t = f; }
      }
      if (!entry || ['more', 'add'].includes(t)) { mods.push(t); continue; }
      if (t === 'bigger' && i + 1 < toks.length) { mods.push(t); continue; }
      // Adjective + track ("heavier bass", "louder hats") is about that track, not the whole mix.
      const next = W[toks[i + 1]];
      if (entry.k === 'axis' && next && (next.k === 'track' || next.k === 'voice') && ['grit', 'volume', 'punch'].includes(entry.id)) {
        mods.push(entry.sign > 0 ? 'louder' : 'quieter'); continue;
      }
      if ((entry.k === 'track') && !mods.length && edits.length > before) continue;
      edits.push(...resolve(entry, mods, ctx, clause.replace(/\s+/g, ' ')));
      mods = [];
    }
    // A clause of only modifiers ("way more", "a bit less") rescales the previous edit.
    if (edits.length === before && mods.length) {
      const prev = edits[edits.length - 1];
      const int = mods.map((w) => INTENSITY[w]).filter((x) => x != null && x !== 1).pop();
      const neg = mods.some((w) => NEGATE.has(w));
      if (prev && prev.amt != null && (int || neg)) { prev.amt *= (int || 1) * (neg ? -1 : 1); continue; }
      if (mods.some((w) => !STOP.has(w))) unknown.push(clause);
    }
  }
  return { edits: merge(edits), unknown };
}

// Same intent twice ("darker, much darker") adds up; the last explicit value wins.
function merge(edits) {
  const out = [];
  for (const e of edits) {
    const k = `${e.id}:${e.target || ''}`;
    const prev = out.find((x) => `${x.id}:${x.target || ''}` === k);
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
  key: 'value: 0-11 (C=0)', keyStep: 'amt: ±1 semitone', voice: `value: 0-10 (${VOICE_NAMES.join(', ')})`, bassVoice: `value: 0-4 (${BASS_NAMES.join(', ')})`,
  kit: 'value: 0 machine | 1 live', level: `target: ${TRACK_IDS.join('|')}, amt`, mute: 'target, value: bool', lock: 'target, value: bool', genre: `value: ${Object.keys(STYLES).join('|')}`,
};
export function validateEdits(list) {
  if (!Array.isArray(list)) return [];
  const num = (v, lo, hi) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : null);
  const out = [];
  for (const e of list.slice(0, 12)) {
    if (!e || !INTENTS[e.id]) continue;
    const x = { id: e.id, src: String(e.src || '').slice(0, 80) };
    if (['level', 'mute', 'lock'].includes(e.id)) { if (!TRACK_IDS.includes(e.target)) continue; x.target = e.target; }
    if (['mute', 'lock'].includes(e.id)) x.value = !!e.value;
    else if (e.id === 'scale') { if (!SCALES[e.value]) continue; x.value = e.value; }
    else if (e.id === 'genre') { if (!STYLES[e.value]) continue; x.value = e.value; }
    else if (e.id === 'bpm') { if ((x.value = num(e.value, 60, 200)) == null) continue; x.value = Math.round(x.value); }
    else if (e.id === 'key') { if ((x.value = num(e.value, 0, 11)) == null) continue; x.value = Math.round(x.value); }
    else if (e.id === 'voice') { if ((x.value = num(e.value, 0, 10)) == null) continue; x.value = Math.round(x.value); }
    else if (e.id === 'bassVoice') { if ((x.value = num(e.value, 0, 4)) == null) continue; x.value = Math.round(x.value); }
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
const DEFAULT_HITS = { kick: [0, 4, 8, 12], clap: [4, 12], snare: [4, 12], ch: [2, 6, 10, 14], oh: [2, 10], ride: [0, 4, 8, 12], perc: [3, 7, 10, 14], stab: [0], vox: [0, 8] };

function lab(a, more, less) {
  const base = a >= 0 ? more : less;
  const m = Math.abs(a);
  return m < 0.75 ? `a bit ${base}` : m >= 1.75 ? `much ${base}` : base;
}
const signed = (n, unit) => `${n > 0 ? '+' : '−'}${Math.abs(n)}${unit}`;

// Applies edits (all but `genre`, which the caller handles by generating first) to a copy of state.
// Returns { state, did: [labels], skipped: [labels] } — `did` only lists edits that actually changed something.
export function applyEdits(state, edits, { seed = 1 } = {}) {
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
  const SCORE_OK = new Set(['tone', 'warmth', 'tempo', 'bpm', 'space', 'echo', 'volume', 'genre']);
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
        label = lab(a, 'busier', 'sparser') + ' parts';
        break;
      }
      case 'drops':
        mset('arr', M.arr + 0.5 * a); mset('duck', M.duck + 0.1 * a);
        tset('kick', 'punch', P.kick.punch + 0.08 * a);
        label = a > 0 ? lab(a, 'bigger drops', '') : 'smoother (fewer drops)';
        break;
      case 'space':
        mset('revLevel', M.revLevel + 0.18 * a); mset('room', M.room + 0.12 * a);
        tset('stab', 'rev', P.stab.rev + 0.08 * a);
        label = lab(a, 'more reverb', 'drier');
        break;
      case 'echo': {
        mset('dlyLevel', M.dlyLevel + 0.2 * a); mset('dlyFb', Math.min(0.85, M.dlyFb + 0.1 * a));
        const cap = Math.round(P.stab.voice) >= 7 ? 0.25 : 1;
        tset('stab', 'dly', Math.min(cap, P.stab.dly + 0.12 * a)); tset('perc', 'dly', P.perc.dly + 0.1 * a);
        label = lab(a, 'more echo', 'less echo');
        break;
      }
      case 'grit':
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
          for (const id of TRACK_IDS) if (!locked(id)) { p.steps[id] = m.steps[id]; }
        });
        label = lab(a, 'more variation', 'steadier');
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
        label = `${a > 0 ? 'louder' : 'quieter'} ${TRACK_WORD[t]}`;
        break;
      }
      case 'mute':
        S.mutes[t] = !!e.value;
        if (S.solos?.[t] && e.value) S.solos[t] = false;
        label = e.value ? `no ${TRACK_WORD[t]}` : `${TRACK_WORD[t]} back in`;
        break;
      case 'lock': S.locks[t] = !!e.value; label = `${e.value ? 'locked' : 'unlocked'} ${TRACK_WORD[t]}`; break;
      default: continue;
    }
    if (JSON.stringify(S) === before) skipped.push(`${label || e.id} (already there)`);
    else did.push(label);
  }
  return { state: S, did, skipped };
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
  const { state: next, did, skipped } = applyEdits(base, edits, { seed });
  if (genre) did.unshift(`switched to ${STYLES[genre].name}`);
  return { edits, unknown, genre, state: next, did, skipped, suggestions: unknown.length || !did.length ? suggest(unknown.join(' ') || text) : [] };
}
