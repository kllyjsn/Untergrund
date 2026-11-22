// Rule-written lyrics for the prompt path without a model (js/song-plan.js rulePlan): a verse that tells a story in
// concrete pictures, a chorus that says the feeling around the title, rhymes at the ends of lines. Lines are 2 bars
// long (4-9 syllables), 4 to a section, so the melody's phrases (two lines each) sing them one syllable per slot.
// Deterministic: the same prompt and seed always write the same song.
import { rng } from './dsp.js';
import { feelOf, FEELS } from './feel.js';

// Per theme: a default place, titles, and rhymed couplets for each job in the story. {place} is filled in from the
// prompt ("leaving LA") and never ends a line, so the rhymes hold.
const THEMES = {
  leaving: {
    words: /\b(?:leav\w*|left|goodbye|gone|go|away|move|moving|run\w*|escape|train|road|drive|highway)\b/i, place: 'this town',
    titles: ['Leaving Tonight', 'Taillights', 'Gone by Morning', 'One Way Out'],
    setup: [['Boxes on the kitchen floor', 'your jacket hanging by the door'], ['Neon fading over {place}', 'the streetlight shining on your face']],
    event: [['I wrote your name on the window glass', 'and watched the morning traffic pass'], ['The radio played our song again', 'I turned it up and drove through rain']],
    detail: [['A ticket folded in my hand', 'a picture of the summer band'], ['The diner sign still burning red', 'the coffee cold, the words unsaid']],
    turn: [['You never asked me why I go', 'and I could never tell you so'], ['I kept the key, I left the light', 'and drove out of {place} tonight']],
    pre: [['And every mile I hear you say', 'stay a little, stay']],
    chorus: [['I will not look back at the door', 'I can not be yours anymore'], ['my heart is beating like a drum', 'I am not sorry that I come'], ['the road is calling out my name', 'and nothing here will be the same']],
    bridge: [['Maybe someday you will see', 'what this town has done to me', 'I will call you from the coast', 'when I miss you the most']],
  },
  love: {
    words: /\b(?:love|lover|heart|kiss|crush|darling|baby|forever|together|wedding|romance)\b/i, place: 'the city',
    titles: ['Golden Hour', 'Only You', 'Stay With Me', 'Closer'],
    setup: [['Your coffee cup beside my bed', 'the silly things you always said'], ['We met on a Sunday in {place}', 'a paper rose, a borrowed space']],
    event: [['You laughed and spilled your wine on me', 'and I forgot how to be free'], ['You took my hand across the street', 'the summer pavement warm and sweet']],
    detail: [['Your sweater hanging on my chair', 'the smell of rain still in your hair'], ['A silver ring, a summer dress', 'the way you laugh at all my mess']],
    turn: [['And all the songs I used to know', 'are only songs about you, so'], ['I used to think that love was slow', 'but you showed up and told me so']],
    pre: [['And when the lights go low', 'I want you to know']],
    chorus: [['you are the only light I see', 'there is no other place to be'], ['I feel it every time we touch', 'I never knew I wanted much'], ['you hold me closer than the night', 'and everything is burning bright']],
    bridge: [['If the stars all fall tonight', 'I will hold you just as tight', 'Every road I walk alone', 'brings me back to you at home']],
  },
  heartbreak: {
    words: /\b(?:sad|cry\w*|tears?|broken|break\w*|lost|miss\w*|lonely|alone|hurt\w*|heartbreak|over|cold|rain\w*)\b/i, place: 'the old street',
    titles: ['Paper Hearts', 'Cold Coffee', 'Without You', 'Empty Room'],
    setup: [['Your toothbrush still beside the sink', 'I pour a glass but never drink'], ['The rain is falling on {place}', 'I see your shadow, not your face']],
    event: [['I found your letter in a book', 'I read it twice, I could not look'], ['You called me once and then you hung up', 'I held the phone and filled my cup']],
    detail: [['Your record spinning on the shelf', 'I play it only for myself'], ['The garden that we planted died', 'I left the window open wide']],
    turn: [['And everybody tells me so', 'it is time to let you go'], ['I tell my friends that I am fine', 'but you are still on every line']],
    pre: [['And I can hear the thunder roll', 'it is rolling through my soul']],
    chorus: [['I am falling and I can not stay', 'holding on to yesterday'], ['nothing hurts the way that you do', 'I am still in love with you'], ['every road is leading back to you', 'and I do not know what I can do']],
    bridge: [['Maybe I will learn to sleep', 'maybe this is mine to keep', 'When the morning light comes through', 'I will try to start anew']],
  },
  night: {
    words: /\b(?:night|party|dance\w*|club|neon|lights?|city|tonight|weekend|friday|saturday|floor)\b/i, place: 'the city',
    titles: ['Neon Heart', 'All Night', 'Midnight Run', 'Light It Up'],
    setup: [['Friday night and the bass is loud', 'I lose myself inside the crowd'], ['Lipstick on a paper cup', 'the night is young, the volume up']],
    event: [['You caught my eye across the room', 'a silver dress, a cheap perfume'], ['We ran through {place} after two', 'the taxis honking, me and you']],
    detail: [['The streetlights flicker blue and white', 'a cigarette, a borrowed light'], ['Your jacket smells like summer rain', 'we miss the last and only train']],
    turn: [['And when the sun comes up too soon', 'we will be dancing on the moon'], ['I do not care what people say', 'I want to dance until it is day']],
    pre: [['So turn it up and lose control', 'let the music take your soul']],
    chorus: [['I feel alive when we are near', 'there is nothing left to fear'], ['my heart is racing with the beat', 'I feel the fire in my feet'], ['we are dancing in the light', 'we are burning up the night']],
    bridge: [['When the music fades away', 'I will hear it anyway', 'Every light in every street', 'keeps on moving with the beat']],
  },
  summer: {
    words: /\b(?:summer|sun\w*|beach|ocean|sea|waves?|happy|holiday|july|island|sky)\b/i, place: 'the coast',
    titles: ['Summer Gold', 'Sunlight', 'Ocean Eyes', 'Blue Sky Day'],
    setup: [['Sand in the seats of your old car', 'a broken radio, a guitar'], ['July and the windows down', 'we left the noise of the old town']],
    event: [['We drove along {place} at noon', 'and sang the words to every tune'], ['You dove into the waves at night', 'the water glowing silver white']],
    detail: [['A bottle of lemonade', 'we lay together in the shade'], ['Your shoulders burning in the sun', 'the summer only just begun']],
    turn: [['And I could stay here every day', 'and never want to go away'], ['I know the season has to end', 'but this is ours, my oldest friend']],
    pre: [['And when the sun goes down', 'we paint the sleepy town']],
    chorus: [['I feel the sun on my face', 'and there is no better place'], ['we are flying high and free', 'you are all I want to see'], ['golden days are on the way', 'I just want the sun to stay']],
    bridge: [['When the winter comes around', 'I will hear the ocean sound', 'Close my eyes and you are there', 'summer sun and salty air']],
  },
  home: {
    words: /\b(?:home|town|mother|father|mama|daddy|family|roots|farm|church|river|small)\b/i, place: 'the river',
    titles: ['Back Home', 'Porch Light', 'Gravel Road', 'Where I Belong'],
    setup: [['A porch light on a gravel road', 'my father with his heavy load'], ['The church bell rings across {place}', 'my mother has a gentle face']],
    event: [['I packed a bag when I was young', 'with every song I ever sung'], ['I took the bus to chase a dream', 'and nothing turned out what it seemed']],
    detail: [['The pickup rusting by the shed', 'the quilt my grandma made for bed'], ['A photograph of Sunday lunch', 'my brother laughing at a punch']],
    turn: [['And now I know what I was told', 'the road is long, the road is cold'], ['I left to chase the city light', 'and found my way back home tonight']],
    pre: [['And every road I take', 'leads me back to the lake']],
    chorus: [['this is where I want to be', 'everything is home to me'], ['the porch light burning in the rain', 'is calling me back home again'], ['the kitchen light is burning low', 'the old road waiting in the snow']],
    bridge: [['I have seen the city lights', 'I have spent the lonely nights', 'Nothing ever felt the same', 'as the place that knows my name']],
  },
  shadow: {
    words: /\b(?:shadow\w*|dark\w*|devil\w*|danger\w*|smoke\w*|ghost\w*|haunt\w*|basement|warehouse|underground)\b/i, place: 'the city',
    titles: ['Black Water', 'Afterhours', 'No Saints', 'Static'],
    setup: [['Concrete sweating under red', 'the bass is pounding in my head'], ['Above {place} a broken light', 'a stranger waiting in the night']],
    event: [['I saw the sirens on the wall', 'and heard you laughing down the hall'], ['We took the stairs below the street', 'the walls were shaking with the beat']],
    detail: [['A cigarette, a silver chain', 'the gutter running black with rain'], ['The smoke is hanging in the air', 'and something watches from the stair']],
    turn: [['I know the devil by his smile', 'I let him walk with me a while'], ['There is no morning here at all', 'just shadows climbing up the wall']],
    pre: [['And the lights go out', 'nobody here can hear you shout']],
    chorus: [['we are the ghosts that never sleep', 'the secrets that the shadows keep'], ['I hear the thunder underground', 'my heart is drowning in the sound']],
    bridge: [['When the city lights go cold', 'there are stories never told', 'Down here no one knows your name', 'and nothing ever stays the same']],
  },
  pressure: {
    words: /\b(?:chase\w*|racing|faster|pressure|clock|edge|fight\w*|nerve\w*|tense|tension|breathless)\b/i, place: 'the highway',
    titles: ['Red Line', 'No Time', 'Edge of the Night', 'Heartbeat Racing'],
    setup: [['The clock is ticking on the wall', 'I hear your footsteps in the hall'], ['Through {place} the headlights race', 'the engine roaring, keep the pace']],
    event: [['They followed us across the bridge', 'we left the city on the ridge'], ['I grabbed your hand and we took flight', 'the sirens screaming through the night']],
    detail: [['A broken mirror, empty tank', 'a hundred dollars from the bank'], ['Your fingers shaking on the wheel', 'I can not tell you what I feel']],
    turn: [['There is no time to stop and think', 'we are standing at the brink'], ['If we stop now, we will not last', 'so keep on running, running fast']],
    pre: [['Every second pulling tight', 'we are running out of night']],
    chorus: [['my heart is pounding in my chest', 'there is no time for us to rest'], ['we are racing through the dark', 'living on a single spark']],
    bridge: [['Hold on, hold on, do not let go', 'the road is long, the clock is slow', 'One more mile and we will see', 'the morning waiting to be free']],
  },
  dream: {
    words: /\b(?:dream\w*|float\w*|haz[ey]\w*|cloud\w*|stars?|moon\w*|drift\w*|slow motion)\b/i, place: 'the bay',
    titles: ['Slow Motion', 'Daydream', 'Cloud Nine', 'Moonlit'],
    setup: [['Silver light across the floor', 'the radio, an open door'], ['We drift above {place} at night', 'the city small, the moon so bright']],
    event: [['You told me secrets in the dark', 'we fell asleep inside the park'], ['We lay together on the sand', 'I held the ocean in my hand']],
    detail: [['A paper boat, a painted sky', 'the clouds are slowly drifting by'], ['Your hair is glowing in the light', 'the stars are fading into night']],
    turn: [['Nobody knows the way we go', 'the world is moving soft and slow'], ['I close my eyes, I let it be', 'the tide is coming back to me']],
    pre: [['And the night is in your eyes', 'painted on the sleepy skies']],
    chorus: [['we are floating in the blue', 'there is nothing else but you'], ['hold me in the endless night', 'everything is soft and light']],
    bridge: [['When the morning comes too soon', 'I will find you on the moon', 'Close your eyes and stay with me', 'in a dream where we are free']],
  },
};
const MOOD_THEME = { sad: 'heartbreak', dark: 'heartbreak', happy: 'summer', lift: 'summer', dream: 'love', drive: 'leaving', tense: 'night' };
// Who writes pre-choruses (longform BASES): pop and soul build into the chorus; the band genres go straight in.
const PRE = new Set(['pop', 'rnb', 'neosoul', 'deephouse', 'euphoric', 'trance', 'ukg', 'hyperpop']);

const titleCase = (t) => t.replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\b(A|An|The|Of|In|On|To|And|For|At|By)\b(?!$)/g, (m, w, i) => (i ? w.toLowerCase() : w));
const fill = (line, place) => line.replace(/\{place\}/g, place);

// Themes added with the feelings; a song with no feeling keeps choosing among the original six.
const NEW = new Set(['shadow', 'pressure', 'dream']);
// How happy each theme's words are (-1..1, the same axis as a feeling's valence).
const TONE = { heartbreak: -0.8, shadow: -0.6, leaving: -0.3, pressure: -0.3, home: 0.2, dream: 0.3, love: 0.6, night: 0.7, summer: 0.8 };
// The theme a song's words come from. With a feeling, a topic the prompt names is kept only if its words agree with the
// feeling (a happy song about rain is not a heartbreak lyric over a major chorus); otherwise the feeling's own theme.
export function themeOf(text = '', mood = [], feel = null) {
  const t = String(text || ''), named = Object.keys(THEMES).filter((id) => THEMES[id].words.test(t)), F = FEELS[feel];
  if (F) return named.find((id) => Math.abs(TONE[id] - F.valence) < 0.75) || F.theme;
  return named.find((id) => !NEW.has(id)) || MOOD_THEME[mood[0]] || FEELS[feelOf(mood.join(' '))]?.theme || 'love';
}
// The first theme `text` names, or null.
export const namedTheme = (text = '') => Object.keys(THEMES).find((id) => THEMES[id].words.test(String(text || ''))) || null;
// The feeling a topic carries when the prompt names no feeling (a song about leaving longs, a summer song is joyful).
export const THEME_FEEL = { heartbreak: 'heartbroken', shadow: 'dark', leaving: 'longing', pressure: 'tense', home: 'longing', dream: 'dreamy', love: 'tender', night: 'euphoric', summer: 'joyful' };

// { title, sections: [{ sec, lines }] } for a prompt. `about` is the prompt's subject ("leaving LA").
export function writeLyrics({ prompt = '', about = '', style = 'pop', mood = [], seed = 1, feel = null } = {}) {
  const r = rng(Math.imul((seed | 0) ^ 0x5bd1e995, 0x1b873593) ^ [...String(prompt) + about].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193), 0x811c9dc5));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const T = THEMES[themeOf(`${about} ${prompt}`, mood, feel)];
  const quoted = String(prompt).match(/["\u201c]([^"\u201d]{2,40})["\u201d]/)?.[1];
  const words = about.replace(/[^A-Za-z' ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const proper = words.filter((w, i) => i && /^[A-Z]/.test(w)).join(' ');
  const place = proper || T.place;
  const title = titleCase((quoted || (words.length && words.length <= 4 ? words.join(' ') : pick(T.titles))).trim());
  // The hook line is the title, padded to a singable 4+ syllables with a word that belongs to the theme.
  const short = title.split(/\s+/).length < 2;
  const hook = short ? `${title}, ${pick(['oh', 'tonight', 'again'])}` : title;
  const two = (k) => pick(T[k]).map((l) => fill(l, place));
  const a = [two('setup'), two('event'), two('detail'), two('turn')];
  const verse1 = [...a[0], ...a[1]], verse2 = [...a[2], ...a[3]];
  const ch = pick(T.chorus), chorus = [hook, ch[0], hook, ch[1]];
  const bridge = pick(T.bridge).map((l) => fill(l, place));
  const pre = PRE.has(style) ? two('pre') : null;
  const sections = [{ sec: 'verse', lines: verse1 }, ...(pre ? [{ sec: 'pre', lines: pre }] : []), { sec: 'chorus', lines: chorus },
    { sec: 'verse', lines: verse2 }, ...(pre ? [{ sec: 'pre', lines: pre }] : []), { sec: 'chorus', lines: chorus },
    { sec: 'bridge', lines: bridge }, { sec: 'chorus', lines: chorus }];
  return { title, hook, sections };
}

// Line pairs that are meant to rhyme in a written song (for the composition scorecard): verse couplets, the chorus's
// answering lines, the bridge couplets.
export function rhymePairs(sections) {
  const out = [];
  for (const s of sections) {
    const L = s.lines.map((l) => (typeof l === 'string' ? l : l.t));
    if (s.sec === 'chorus' && L.length >= 4) out.push([L[1], L[3]]);
    else for (let i = 0; i + 1 < L.length; i += 2) out.push([L[i], L[i + 1]]);
  }
  return out;
}
