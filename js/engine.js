import { TRACKS, TRACK_IDS, CHORDS, DELAY_TIMES, SCALES } from './params.js';
import { getSample } from './sampler.js';
import { liveKit, loadLiveKit, BASS_NOTES } from './livekit.js';
import { midiHz, makeNoise, makeIR, driveCurve, clipCurve, satCurve, SAT_HEADROOM } from './dsp.js';

const DUCKED = new Set(['acid', 'stab', 'vox']);
// Knob values the NEO-SOUL live-kit preset uses; the recorded samples play unaltered at these settings
const LIVE_REF = {
  kick: { tune: 52, decay: 0.5, drive: 0.2, click: 0.15, punch: 0.55 },
  snare: { tune: 200, decay: 0.22, snappy: 0.4 },
  ch: { tune: 1, decay: 0.05, tone: 3600 },
  oh: { tune: 1, decay: 0.32, tone: 6500 },
  ride: { tune: 1, decay: 1.4, tone: 3800 },
  acid: { cutoff: 320, drive: 0.3 },
};
const hash = (n, k) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const EPS = 0.0001;
const STAB_VOICES = [null, 'keys', 'pad', 'organ', 'brass', 'pluck', 'bells'];
const LIM_TRIM = 1.4;

// Six band-limited squares (808 cymbal cluster) summed once into a seamless 0.5 s loop.
// Each square is read from a one-period wavetable; a small LRU bounds memory as tunings change.
const METAL_FREQS = [205.3, 304.4, 369.6, 522.7, 540, 800];
const METAL_MAX = 24, TABLE = 2048;
const metalCache = new Map();
function metallicBuf(mul, sr) {
  const k = Math.round(mul * 200), key = `${sr}:${k}`;
  let buf = metalCache.get(key);
  if (buf) { metalCache.delete(key); metalCache.set(key, buf); return buf; }
  const n = Math.floor(sr / 2), d = new Float32Array(n), tab = new Float32Array(TABLE + 1);
  const top = Math.min(20000, sr * 0.45);
  for (const f0 of METAL_FREQS) {
    const f = (f0 * k) / 200, cycles = Math.max(1, Math.round((f * n) / sr));
    tab.fill(0);
    for (let h = 1; h * f < top; h += 2) {
      const a = (0.16 * 4) / (Math.PI * h), w = (2 * Math.PI * h) / TABLE;
      for (let j = 0; j < TABLE; j++) tab[j] += a * Math.sin(w * j);
    }
    tab[TABLE] = tab[0];
    const step = (cycles * TABLE) / n;
    for (let i = 0; i < n; i++) { const x = (i * step) % TABLE, j = x | 0; d[i] += tab[j] + (tab[j + 1] - tab[j]) * (x - j); }
  }
  buf = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: 1 });
  buf.copyToChannel(d, 0);
  metalCache.set(key, buf);
  if (metalCache.size > METAL_MAX) metalCache.delete(metalCache.keys().next().value);
  return buf;
}

export class Engine {
  constructor(ctx, state, { realtime = true } = {}) {
    this.ctx = ctx;
    this.state = state;
    this.realtime = realtime;
    this.noise = makeNoise(ctx, 2);
    this.buildMaster();
    this.buildFx();
    this.buildChannels();
    this.buildAcid();
    this.applyAll();
  }

  get stepDur() { return 60 / this.state.bpm / 4; }

  // ---------- graph ----------
  gain(v = 1) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  filter(type, f, q = 0.707) { const b = this.ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
  comp(th, ratio, knee, atk, rel) {
    const c = this.ctx.createDynamicsCompressor();
    c.threshold.value = th; c.ratio.value = ratio; c.knee.value = knee; c.attack.value = atk; c.release.value = rel;
    return c;
  }

  buildMaster() {
    const c = this.ctx;
    this.mix = this.gain(1);
    this.duck = this.gain(1);
    this.duck.connect(this.mix);
    this.djHP = this.filter('highpass', 10, 0.9);
    this.djLP = this.filter('lowpass', 21000, 0.9);
    this.glue = this.comp(-14, 2.5, 8, 0.015, 0.16);
    this.satIn = this.gain(1 / SAT_HEADROOM);
    this.sat = c.createWaveShaper(); this.sat.oversample = '4x';
    this.warm = this.filter('lowpass', 20000, 0.5);
    this.master = this.gain(0.85);
    this.limIn = this.gain(0.5);
    this.limiter = this.comp(-6, 12, 3, 0.002, 0.12);
    this.limTrim = this.gain(LIM_TRIM);
    this.clip = c.createWaveShaper(); this.clip.curve = clipCurve(); this.clip.oversample = '4x';
    this.out = this.gain(0.95);
    this.mix.connect(this.djHP).connect(this.djLP).connect(this.glue).connect(this.satIn).connect(this.sat)
      .connect(this.warm).connect(this.master).connect(this.limIn).connect(this.limiter).connect(this.limTrim).connect(this.clip).connect(this.out);
    this.out.connect(c.destination);
    if (this.realtime) {
      this.analyser = c.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.72;
      this.out.connect(this.analyser);
    }
  }

  buildFx() {
    const c = this.ctx;
    // Reverb
    this.revIn = this.gain(1);
    this.revHP = this.filter('highpass', 240);
    this.revConv = c.createConvolver();
    this.revConv.buffer = makeIR(c, 3.8, { decay: 3.4, brightStart: 0.8, brightEnd: 0.1, predelay: 0.018 });
    this.revLP = this.filter('lowpass', 4500);
    this.revOut = this.gain(0.7);
    this.revIn.connect(this.revHP).connect(this.revConv).connect(this.revLP).connect(this.revOut).connect(this.duck);
    // Short shared room so the whole band sounds like it plays in one space
    this.roomIn = this.gain(1);
    this.roomConv = c.createConvolver();
    this.roomConv.buffer = makeIR(c, 0.7, { decay: 2.4, brightStart: 0.6, brightEnd: 0.15, predelay: 0.004, seed: 53 });
    this.roomHP = this.filter('highpass', 160);
    this.roomOut = this.gain(0);
    this.roomIn.connect(this.roomHP).connect(this.roomConv).connect(this.roomOut).connect(this.mix);

    // Ping-pong delay with band-limited feedback
    this.dlyIn = this.gain(1);
    this.dlyIn.channelCount = 1; this.dlyIn.channelCountMode = 'explicit';
    this.dlyHP = this.filter('highpass', 320);
    this.dlyLP = this.filter('lowpass', 4800);
    this.dL = c.createDelay(4); this.dR = c.createDelay(4);
    this.fb = this.gain(0.45);
    this.fbHP = this.filter('highpass', 260);
    this.fbLP = this.filter('lowpass', 3400);
    this.dlyIn.connect(this.dlyHP).connect(this.dlyLP).connect(this.dL);
    this.dL.connect(this.dR);
    this.dR.connect(this.fb).connect(this.fbHP).connect(this.fbLP).connect(this.dL);
    const merge = c.createChannelMerger(2);
    this.dL.connect(merge, 0, 0); this.dR.connect(merge, 0, 1);
    this.dlyOut = this.gain(0.65);
    merge.connect(this.dlyOut).connect(this.duck);

    // Kick rumble: dark reverb of the kick, low-passed and hard-ducked by the kick itself
    this.rumbleIn = this.gain(1);
    this.rumbleConv = c.createConvolver();
    this.rumbleConv.buffer = makeIR(c, 2.6, { decay: 2.2, brightStart: 0.25, brightEnd: 0.04, predelay: 0.03, seed: 31 });
    this.rumbleLP = this.filter('lowpass', 150, 1.1);
    this.rumbleHP = this.filter('highpass', 34, 0.8);
    this.rumbleDuck = this.gain(1);
    this.rumbleOut = this.gain(2.2);
    this.rumbleOut.channelCount = 1; this.rumbleOut.channelCountMode = 'explicit';
    this.rumbleIn.connect(this.rumbleConv).connect(this.rumbleLP).connect(this.rumbleHP)
      .connect(this.rumbleDuck).connect(this.rumbleOut).connect(this.mix);

    // Momentary FX throw bus (fed by every channel)
    this.throwBus = this.gain(0);
    this.throwBus.connect(this.revIn);
    this.throwBus.connect(this.dlyIn);
  }

  buildChannels() {
    const c = this.ctx;
    this.ch = {};
    for (const t of TRACKS) {
      const input = this.gain(1);
      const level = this.gain(1);
      const pan = c.createStereoPanner();
      const rev = this.gain(0);
      const dly = this.gain(0);
      input.connect(level).connect(pan);
      pan.connect(DUCKED.has(t.id) ? this.duck : this.mix);
      pan.connect(rev).connect(this.revIn);
      if (t.id !== 'vox') pan.connect(this.roomIn);
      pan.connect(dly).connect(this.dlyIn);
      pan.connect(this.throwBus);
      const ch = { input, level, pan, rev, dly };
      if (t.id === 'kick') {
        ch.rumble = this.gain(0);
        level.connect(ch.rumble).connect(this.rumbleIn);
      }
      this.ch[t.id] = ch;
    }
  }

  buildAcid() {
    const c = this.ctx;
    const a = {};
    a.o1 = c.createOscillator(); a.o1.type = 'sawtooth';
    a.o2 = c.createOscillator(); a.o2.type = 'square';
    a.g1 = this.gain(1); a.g2 = this.gain(0);
    a.f1 = this.filter('lowpass', 400, 0);
    a.f2 = this.filter('lowpass', 400, 18);
    a.vca = this.gain(0);
    a.hp = this.filter('highpass', 28);
    a.pre = this.gain(0.55);
    a.shaper = c.createWaveShaper(); a.shaper.oversample = '4x';
    a.tame = this.filter('lowpass', 9500, 0.5);
    a.post = this.gain(1);
    a.env = c.createConstantSource(); a.env.offset.value = 0;
    a.o1.connect(a.g1).connect(a.f1);
    a.o2.connect(a.g2).connect(a.f1);
    a.f1.connect(a.f2).connect(a.vca).connect(a.hp).connect(a.pre).connect(a.shaper).connect(a.tame).connect(a.post).connect(this.ch.acid.input);
    a.env.connect(a.f1.detune);
    a.env.connect(a.f2.detune);
    a.o1.start(0); a.o2.start(0); a.env.start(0);
    this.acidNodes = a;
  }

  // ---------- params ----------
  setTo(param, v, immediate) {
    if (immediate) param.value = v;
    else param.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  }

  applyAll() {
    for (const id of TRACK_IDS) for (const k of Object.keys(this.state.params[id])) this.applyParam(id, k, true);
    for (const k of Object.keys(this.state.master)) this.applyMaster(k, true);
  }

  setParam(tid, id, v) { this.state.params[tid][id] = v; this.applyParam(tid, id); }
  setMaster(id, v) { this.state.master[id] = v; this.applyMaster(id); }

  applyParam(tid, id, immediate = false) {
    if (id === 'tune' && (tid === 'ch' || tid === 'oh' || tid === 'ride')) {
      const tune = this.state.params[tid].tune, sr = this.ctx.sampleRate;
      for (const m of tid === 'ride' ? [2.05 * tune, 1.47 * tune] : [1.35 * tune]) metallicBuf(m, sr);
    }
    const v = this.state.params[tid][id];
    const ch = this.ch[tid];
    if (id === 'level') return this.setTo(ch.level.gain, v, immediate);
    if (id === 'pan') return this.setTo(ch.pan.pan, v, immediate);
    if (id === 'rev') return this.setTo(ch.rev.gain, v, immediate);
    if (id === 'dly') return this.setTo(ch.dly.gain, v, immediate);
    if (tid === 'kick' && id === 'rumble') return this.setTo(ch.rumble.gain, v * v, immediate);
    if (tid === 'acid') {
      const a = this.acidNodes;
      if (id === 'wave') { this.setTo(a.g1.gain, 1 - v, immediate); this.setTo(a.g2.gain, v * 0.72, immediate); }
      if (id === 'cutoff') { this.setTo(a.f1.frequency, v, immediate); this.setTo(a.f2.frequency, v, immediate); }
      if (id === 'reso') { this.setTo(a.f2.Q, v, immediate); this.setTo(a.f1.Q, v * 0.12, immediate); }
      if (id === 'drive') {
        a.shaper.curve = driveCurve(v * 0.75);
        this.setTo(a.post.gain, 1.05 / (1 + v * 1.1), immediate);
      }
    }
  }

  applyMaster(id, immediate = false) {
    const m = this.state.master;
    const v = m[id];
    if (id === 'dj') {
      const hp = v > 0 ? 10 * Math.pow(2, v * 10.3) : 10;
      const lp = v < 0 ? 21000 * Math.pow(2, v * 9.2) : 21000;
      const q = 0.9 + Math.abs(v) * 3.5;
      this.setTo(this.djHP.frequency, hp, immediate); this.setTo(this.djLP.frequency, lp, immediate);
      this.setTo(this.djHP.Q, q, immediate); this.setTo(this.djLP.Q, q, immediate);
    } else if (id === 'drive') {
      this.sat.curve = satCurve(v);
    } else if (id === 'volume') this.setTo(this.master.gain, v, immediate);
    else if (id === 'room') this.setTo(this.roomOut.gain, (v || 0) * 0.9, immediate);
    else if (id === 'warmth') this.setTo(this.warm.frequency, 20000 * Math.pow(0.22, v || 0), immediate);
    else if (id === 'revLevel') this.setTo(this.revOut.gain, v, immediate);
    else if (id === 'revTone') this.setTo(this.revLP.frequency, v, immediate);
    else if (id === 'dlyFb') this.setTo(this.fb.gain, v, immediate);
    else if (id === 'dlyLevel') this.setTo(this.dlyOut.gain, v, immediate);
    else if (id === 'dlyTime') this.applyDelayTime(immediate);
  }

  applyDelayTime(immediate = false) {
    const steps = DELAY_TIMES[Math.round(this.state.master.dlyTime)].steps;
    const t = Math.min(3.9, steps * this.stepDur);
    if (immediate) { this.dL.delayTime.value = t; this.dR.delayTime.value = t; }
    else {
      const now = this.ctx.currentTime;
      this.dL.delayTime.setTargetAtTime(t, now, 0.08);
      this.dR.delayTime.setTargetAtTime(t, now, 0.08);
    }
  }

  // ---------- helpers ----------
  noiseSrc(t, dur) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.start(t, (t * 7.31) % 1.5);
    s.stop(t + dur);
    return s;
  }

  adEnv(param, t, peak, attack, decay) {
    param.setValueAtTime(EPS, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(EPS, t + attack + decay);
  }

  duckAt(t, v) {
    const depth = this.state.master.duck * Math.min(1, v * 1.25) * 0.9;
    // Pump recovers over roughly one beat so offbeat basslines and pads audibly breathe
    const pairs = [[this.duck.gain, depth, this.stepDur * 1.5], [this.rumbleDuck.gain, 0.98, this.stepDur * 0.47]];
    for (const [param, d, rel] of pairs) {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(1 - d, t, 0.0025);
      param.setTargetAtTime(1, t + 0.03, rel);
    }
  }

  trigger(id, t, v) {
    if (Math.round(this.state.master.kit || 0) === 1) {
      const kit = liveKit();
      if (!kit) loadLiveKit();
      else if (this.sampledHit(kit, id, t, v)) return;
      switch (id) {
        case 'kick': return this.liveKick(t, v);
        case 'snare': return this.liveSnare(t, v);
        case 'ch': return this.brush(t, v, false);
        case 'oh': return this.brush(t, v, true);
        case 'ride': return this.liveRide(t, v);
      }
    }
    switch (id) {
      case 'kick': return this.kick(t, v);
      case 'clap': return this.clap(t, v);
      case 'snare': return this.snare(t, v);
      case 'ch': return this.hat(t, v, false);
      case 'oh': return this.hat(t, v, true);
      case 'ride': return this.ride(t, v);
      case 'perc': return this.perc(t, v);
      case 'stab': return this.stab(t, v);
    }
  }

  // ---------- voices ----------

  hand(t, v, p, out, bongo) {
    // Congas/bongos: two drums (low/high) alternating, open tones and slaps.
    const c = this.ctx, n = this.handN = (this.handN || 0) + 1;
    const high = hash(n, 7) < 0.55, slap = v > 0.85 || hash(n, 9) < p.noise * 0.6;
    const f = (bongo ? 420 : 200) * Math.sqrt(p.tune / 240) * (high ? 1.45 : 1);
    const dec = Math.max(0.04, p.decay * (bongo ? 0.5 : 1.1) * (slap ? 0.45 : 1));
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f * (1 + p.bend * 0.6), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.015 + p.bend * 0.04);
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 1.59;
    const g = this.gain(0), g2 = this.gain(0);
    this.adEnv(g.gain, t, v * 0.85, 0.001, dec);
    this.adEnv(g2.gain, t, v * 0.25, 0.001, dec * 0.4);
    o.connect(g).connect(out); o2.connect(g2).connect(out);
    o.start(t); o2.start(t); o.stop(t + dec + 0.05); o2.stop(t + dec + 0.05);
    const nz = this.noiseSrc(t, 0.06), bp = this.filter('bandpass', Math.min(9000, f * (slap ? 9 : 5)), slap ? 1.2 : 2.5), ng = this.gain(0);
    this.adEnv(ng.gain, t, v * (slap ? 0.7 : 0.15 + p.noise * 0.3), 0.0005, slap ? 0.04 : 0.018);
    nz.connect(bp).connect(ng).connect(out);
  }
  shaker(t, v, p, out) {
    // Shaker: band-passed noise with a soft attack; off-beat hits lean in.
    const n = this.shakN = (this.shakN || 0) + 1, len = Math.max(0.03, p.decay * 0.5);
    const src = this.noiseSrc(t, len + 0.02);
    const hp = this.filter('highpass', Math.min(9000, 2500 + p.tune * 6), 0.6), lp = this.filter('lowpass', 11000, 0.5);
    const g = this.gain(0), lvl = v * (n % 2 ? 0.55 : 0.42) * (0.6 + p.noise * 0.8);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + Math.min(0.03, len * 0.35));
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(hp).connect(lp).connect(g).connect(out);
  }
  clave(t, v, p, out) {
    const c = this.ctx, f = 1800 * Math.sqrt(p.tune / 240), dec = Math.max(0.02, p.decay * 0.25);
    for (const [m, l] of [[1, 0.8], [1.48, 0.25]]) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
      const g = this.gain(0); this.adEnv(g.gain, t, v * l, 0.0005, dec);
      o.connect(g).connect(out); o.start(t); o.stop(t + dec + 0.03);
    }
  }
  dust(t, sd, abs) {
    // Vinyl/tape bed: faint hiss plus sparse crackle, scheduled per step so it stops with transport.
    const d = this.state.master.dust || 0;
    const hiss = this.noiseSrc(t, sd), hp = this.filter('bandpass', 5200, 0.4), hg = this.gain(d * 0.018);
    hiss.connect(hp).connect(hg).connect(this.mix);
    for (let k = 0; k < 3; k++) {
      if (hash(abs, k + 70) > d * 0.55) continue;
      const tt = t + hash(abs, k + 80) * sd, c = this.noiseSrc(tt, 0.003);
      const f = this.filter('highpass', 1500 + hash(abs, k + 90) * 4000, 0.7), g = this.gain(d * (0.05 + hash(abs, k + 60) * 0.18));
      c.connect(f).connect(g).connect(this.mix);
    }
  }
  playBuf(buf, t, level, out, rate = 1, dur = 0, fx = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.playbackRate.value = rate;
    const g = this.gain(level);
    let node = s;
    if (fx.drive > 0.01) {
      const sh = this.ctx.createWaveShaper(); sh.curve = driveCurve(Math.min(1, fx.drive));
      node = node.connect(sh).connect(this.gain(1 / (1 + fx.drive)));
    }
    for (const [freq, db] of fx.shelves || []) {
      if (Math.abs(db) < 0.3) continue;
      const f = this.ctx.createBiquadFilter(); f.type = 'highshelf'; f.frequency.value = freq; f.gain.value = db;
      node = node.connect(f);
    }
    if (fx.punch && Math.abs(fx.punch) > 0.02) {
      const pk = Math.max(0.2, level * (1 + fx.punch));
      g.gain.setValueAtTime(pk, t);
      g.gain.linearRampToValueAtTime(level, t + 0.04);
    }
    node.connect(g).connect(out);
    s.start(t);
    if (dur) {
      g.gain.setValueAtTime(level, t + dur);
      g.gain.setTargetAtTime(0, t + dur, 0.05);
      s.stop(t + dur + 0.4);
    }
  }

  // The recorded kit follows the same TUNE/DECAY/TONE knobs as the synth kit; the live-kit preset is neutral.
  liveFx(id, buf) {
    const p = this.state.params[id], ref = LIVE_REF[id], clamp = (x, a, b) => Math.max(a, Math.min(b, x));
    const rate = clamp(ref.tune ? p.tune / ref.tune : 1, 0.6, 1.7);
    const full = buf.duration / rate;
    const dur = p.decay < ref.decay ? Math.max(0.03, full * (p.decay / ref.decay)) : 0;
    const shelves = [];
    if (ref.tone) shelves.push([4500, clamp(9 * Math.log2(p.tone / ref.tone), -18, 12)]);
    if (ref.snappy != null) shelves.push([2500, clamp((p.snappy - ref.snappy) * 20, -12, 12)]);
    if (ref.click != null) shelves.push([3000, clamp((p.click - ref.click) * 22, -12, 15)]);
    const drive = ref.drive != null ? Math.max(0, p.drive - ref.drive) * 1.2 : 0;
    const punch = ref.punch != null ? (p.punch - ref.punch) * 1.4 : 0;
    return { rate, dur, fx: { shelves, drive, punch } };
  }

  liveHit(kit, name, id, t, level, drift, durOverride) {
    const buf = kit[name], o = this.liveFx(id, buf);
    this.playBuf(buf, t, level, this.ch[id].input, drift * o.rate, durOverride ?? o.dur, o.fx);
  }

  sampledHit(kit, id, t, v) {
    const rr = (this.rr = (this.rr || 0) + 1);
    const drift = 1 + (hash(rr, 7) - 0.5) * 0.012;
    if (id === 'kick') {
      const loud = v > 0.75;
      this.liveHit(kit, `kick_v${loud ? 4 : 2}_${(rr % 2) + 1}`, 'kick', t, 0.95 * v ** 1.2, drift);
      this.duckAt(t, v * 0.7);
      return true;
    }
    if (id === 'snare') {
      const name = v > 0.97 ? 'snare_rim' : v > 0.85 ? 'snare_v34' : v > 0.65 ? 'snare_v24' : v > 0.45 ? 'snare_v14' : 'snare_v6';
      this.liveHit(kit, name, 'snare', t, 0.85 * v ** 1.4, drift);
      return true;
    }
    if (id === 'ch') {
      const layer = Math.max(1, Math.min(4, Math.ceil(v * 4)));
      this.liveHit(kit, `hh_v${layer}_${(rr % 2) + 1}`, 'ch', t, 0.32 * v ** 1.5, drift);
      return true;
    }
    if (id === 'oh') {
      this.liveHit(kit, v > 0.7 ? 'hh_open' : 'hh_half', 'oh', t, 0.3 * v, drift, 0.15 + this.state.params.oh.decay * 0.9);
      return true;
    }
    if (id === 'ride') {
      const layer = v > 0.85 ? 3 : v > 0.55 ? 2 : 1;
      const name = layer === 2 ? `ride_v2_${(rr % 2) + 1}` : `ride_v${layer}_1`;
      this.liveHit(kit, name, 'ride', t, 0.3 * v ** 1.3, drift);
      return true;
    }
    return false;
  }

  sampledBass(kit, t, m, len, accent) {
    let [name, center] = BASS_NOTES[0];
    for (const [n, c] of BASS_NOTES) if (Math.abs(c - m) < Math.abs(center - m)) [name, center] = [n, c];
    const out = this.ch.acid.input, p = this.state.params.acid, ref = LIVE_REF.acid;
    const fx = { shelves: [[700, Math.max(-24, Math.min(12, 8 * Math.log2(p.cutoff / ref.cutoff)))]], drive: Math.max(0, p.drive - ref.drive) * 1.4 };
    this.playBuf(kit[`bass_${name}_${hash(t * 1000, 3) > 0.5 ? 'a' : 'b'}`], t, accent ? 1.2 : 1, out, Math.pow(2, (m - center) / 12), len, fx);
    const sub = this.ctx.createOscillator(); sub.frequency.value = midiHz(m);
    const sg = this.gain(0);
    sg.gain.setValueAtTime(EPS, t);
    sg.gain.linearRampToValueAtTime(0.12, t + 0.01);
    sg.gain.setTargetAtTime(0.07, t + 0.05, 0.2);
    sg.gain.setTargetAtTime(0, t + len, 0.04);
    sub.connect(this.filter('lowpass', 120, 0.7)).connect(sg).connect(out);
    sub.start(t); sub.stop(t + len + 0.3);
  }

  kick(t, v) {
    const c = this.ctx, p = this.state.params.kick, out = this.ch.kick.input;
    const f = p.tune, dec = p.decay;
    const o = c.createOscillator();
    const g = this.gain(0);
    const sh = c.createWaveShaper(); sh.curve = driveCurve(p.drive * 0.6);
    const post = this.gain(0.92);
    const start = f * (3 + p.punch * 9);
    o.frequency.setValueAtTime(start, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.006 + 0.014 * (1 - p.punch));
    o.frequency.exponentialRampToValueAtTime(f, t + 0.075);
    o.frequency.linearRampToValueAtTime(f * 0.9, t + dec + 0.05);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(v, t + 0.0012);
    g.gain.exponentialRampToValueAtTime(v * 0.62, t + dec * 0.32);
    g.gain.exponentialRampToValueAtTime(EPS, t + dec);
    o.connect(g).connect(sh).connect(post).connect(out);
    o.start(t); o.stop(t + dec + 0.08);

    if (p.click > 0.01) {
      const n = this.noiseSrc(t, 0.03);
      const bp = this.filter('bandpass', 3200, 0.6);
      const cg = this.gain(0);
      cg.gain.setValueAtTime(p.click * v * 2.4, t);
      cg.gain.exponentialRampToValueAtTime(EPS, t + 0.014);
      n.connect(bp).connect(cg).connect(out);
    }
    this.duckAt(t, v);
  }

  clap(t, v) {
    const p = this.state.params.clap, out = this.ch.clap.input;
    const sp = 0.6 + p.spread * 0.9;
    const offs = [0, 0.0105 * sp, 0.021 * sp, 0.031 * sp];
    const last = offs[offs.length - 1];
    const n = this.noiseSrc(t, last + p.decay + 0.1);
    const bp = this.filter('bandpass', p.tone, 1.4);
    const hp = this.filter('highpass', 420);
    const g = this.gain(0);
    g.gain.setValueAtTime(EPS, t);
    for (let i = 0; i < offs.length - 1; i++) {
      g.gain.setValueAtTime(v, t + offs[i]);
      g.gain.exponentialRampToValueAtTime(v * 0.08, t + offs[i] + 0.0095 * sp);
    }
    g.gain.setValueAtTime(v, t + last);
    g.gain.exponentialRampToValueAtTime(EPS, t + last + p.decay);
    n.connect(bp).connect(hp).connect(g).connect(this.gain(3.4)).connect(out);
  }

  snare(t, v) {
    const c = this.ctx, p = this.state.params.snare, out = this.ch.snare.input;
    const body = this.gain(0);
    for (const [mul, lvl] of [[1, 0.55], [1.62, 0.3]]) {
      const o = c.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(p.tune * mul * 1.35, t);
      o.frequency.exponentialRampToValueAtTime(p.tune * mul, t + 0.03);
      const og = this.gain(lvl);
      o.connect(og).connect(body);
      o.start(t); o.stop(t + 0.3);
    }
    this.adEnv(body.gain, t, v * (1.1 - p.snappy * 0.4), 0.001, 0.06 + p.decay * 0.35);
    body.connect(out);
    const n = this.noiseSrc(t, p.decay + 0.1);
    const hp = this.filter('highpass', 1300);
    const lp = this.filter('lowpass', 9000);
    const ng = this.gain(0);
    this.adEnv(ng.gain, t, v * (0.25 + p.snappy * 0.75), 0.001, p.decay);
    n.connect(hp).connect(lp).connect(ng).connect(out);
  }

  // Acoustic kit: modal drum heads, beater and wire noise, brushes and a sine-partial ride.
  liveKick(t, v) {
    const c = this.ctx, p = this.state.params.kick, out = this.ch.kick.input;
    const f = Math.max(42, Math.min(70, p.tune * 1.1)), dec = 0.22 + p.decay * 0.25;
    const sh = c.createWaveShaper(); sh.curve = driveCurve(0.25 + p.drive * 0.3);
    sh.connect(this.gain(0.95)).connect(out);
    for (const [mul, lvl, d] of [[1, v, dec], [1.58, v * 0.35, dec * 0.4], [2.3, v * 0.12, dec * 0.25]]) {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(f * mul * 1.9, t);
      o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.025);
      const g = this.gain(0);
      this.adEnv(g.gain, t, lvl, 0.002, d);
      o.connect(g).connect(sh);
      o.start(t); o.stop(t + d + 0.05);
    }
    const n = this.noiseSrc(t, 0.03), lp = this.filter('lowpass', 2600, 0.6), ng = this.gain(0);
    this.adEnv(ng.gain, t, v * (0.25 + p.click * 0.4), 0.001, 0.012);
    n.connect(lp).connect(ng).connect(out);
    this.duckAt(t, v * 0.7);
  }

  liveSnare(t, v) {
    const c = this.ctx, p = this.state.params.snare, out = this.ch.snare.input;
    const ghost = v < 0.6, f = Math.max(150, Math.min(260, p.tune));
    if (!ghost) {
      for (const [mul, lvl] of [[1, 0.5], [1.59, 0.28], [2.14, 0.14]]) {
        const o = c.createOscillator();
        o.frequency.setValueAtTime(f * mul * 1.12, t);
        o.frequency.exponentialRampToValueAtTime(f * mul, t + 0.012);
        const g = this.gain(0);
        this.adEnv(g.gain, t, v * lvl, 0.001, 0.07 + p.decay * 0.12);
        o.connect(g).connect(out);
        o.start(t); o.stop(t + 0.3);
      }
    }
    const wires = 0.12 + p.decay * (ghost ? 0.15 : 0.45);
    const n = this.noiseSrc(t, wires + 0.05);
    const bp = this.filter('bandpass', ghost ? 4200 : 3200, 0.55), hp = this.filter('highpass', 900), ng = this.gain(0);
    ng.gain.setValueAtTime(EPS, t);
    ng.gain.linearRampToValueAtTime(v * (ghost ? 0.5 : 0.75) * (0.5 + p.snappy * 0.6), t + 0.002);
    ng.gain.exponentialRampToValueAtTime(v * 0.18, t + 0.03);
    ng.gain.exponentialRampToValueAtTime(EPS, t + wires);
    n.connect(bp).connect(hp).connect(ng).connect(out);
    if (v > 0.95) {
      const rim = c.createOscillator(); rim.type = 'triangle'; rim.frequency.value = 1680;
      const rg = this.gain(0); this.adEnv(rg.gain, t, 0.22, 0.0005, 0.018);
      rim.connect(rg).connect(out); rim.start(t); rim.stop(t + 0.05);
    }
  }

  brush(t, v, open) {
    const p = this.state.params[open ? 'oh' : 'ch'], out = this.ch[open ? 'oh' : 'ch'].input;
    const dur = open ? 0.18 + p.decay * 0.4 : 0.035 + p.decay * 0.12;
    const n = this.noiseSrc(t, dur + 0.05);
    const bp = this.filter('bandpass', 7800 * Math.min(1.2, p.tune), 0.45), hp = this.filter('highpass', Math.max(3500, p.tone * 0.8), 0.6);
    const g = this.gain(0);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(v * 1.2, t + (open ? 0.012 : 0.004));
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    n.connect(bp).connect(hp).connect(g).connect(out);
  }

  liveRide(t, v) {
    const c = this.ctx, p = this.state.params.ride, out = this.ch.ride.input;
    const base = 440 * p.tune, dec = Math.max(0.6, p.decay * 1.4);
    const bus = this.gain(1);
    const hp = this.filter('highpass', 700, 0.5);
    bus.connect(hp).connect(out);
    [[1, 0.25, 1], [2.64, 0.2, 0.8], [4.18, 0.16, 0.6], [5.53, 0.12, 0.5], [7.8, 0.1, 0.35], [11.2, 0.06, 0.25]].forEach(([m, lvl, d]) => {
      const o = c.createOscillator(); o.frequency.value = base * m * (1 + (m % 1) * 0.003);
      const g = this.gain(0);
      this.adEnv(g.gain, t, v * lvl, 0.001, dec * d);
      o.connect(g).connect(bus); o.start(t); o.stop(t + dec * d + 0.05);
    });
    const n = this.noiseSrc(t, 0.05), bp = this.filter('bandpass', 6500, 0.7), ng = this.gain(0);
    this.adEnv(ng.gain, t, v * 0.5, 0.0005, 0.025);
    n.connect(bp).connect(ng).connect(out);
  }

  metallic(t, mul, out) {
    const s = this.ctx.createBufferSource();
    s.buffer = metallicBuf(mul, this.ctx.sampleRate);
    s.loop = true;
    s.connect(out);
    s.start(t);
    return [s];
  }

  hat(t, v, open) {
    const p = this.state.params[open ? 'oh' : 'ch'], out = this.ch[open ? 'oh' : 'ch'].input;
    const dur = p.decay;
    const bus = this.gain(1);
    const oscs = this.metallic(t, 1.35 * p.tune, bus);
    const n = this.noiseSrc(t, dur + 0.05);
    const ng = this.gain(0.55);
    n.connect(ng).connect(bus);
    const bp = this.filter('bandpass', 10500 * Math.min(1.25, p.tune), 0.9);
    const hp = this.filter('highpass', p.tone, 0.8);
    const env = this.gain(0);
    this.adEnv(env.gain, t, v * 3.4, 0.0008, dur);
    bus.connect(bp).connect(hp).connect(env);
    for (const o of oscs) o.stop(t + dur + 0.05);
    if (open) {
      const choke = this.gain(1);
      env.connect(choke).connect(out);
      this.lastOpen = choke;
    } else {
      env.connect(out);
      if (this.lastOpen) {
        this.lastOpen.gain.setTargetAtTime(0, t, 0.007);
        this.lastOpen = null;
      }
    }
  }

  ride(t, v) {
    const p = this.state.params.ride, out = this.ch.ride.input;
    const bus = this.gain(1);
    const oscs = this.metallic(t, 2.05 * p.tune, bus);
    const oscs2 = this.metallic(t, 1.47 * p.tune, bus);
    const bp = this.filter('bandpass', 7200 * p.tune, 0.7);
    const hp = this.filter('highpass', p.tone, 0.7);
    const env = this.gain(0);
    env.gain.setValueAtTime(EPS, t);
    env.gain.linearRampToValueAtTime(v * 3.6, t + 0.001);
    env.gain.exponentialRampToValueAtTime(v * 1.1, t + 0.05);
    env.gain.exponentialRampToValueAtTime(EPS, t + p.decay);
    bus.connect(bp).connect(hp).connect(env).connect(out);
    for (const o of [...oscs, ...oscs2]) o.stop(t + p.decay + 0.05);
  }

  perc(t, v) {
    const c = this.ctx, p = this.state.params.perc, out = this.ch.perc.input;
    const vo = Math.round(p.voice || 0);
    if (vo > 0) return this[['', 'hand', 'hand', 'shaker', 'clave'][vo]](t, v, p, out, vo === 2);
    const o = c.createOscillator(); o.type = 'sine';
    const f = p.tune;
    o.frequency.setValueAtTime(f * (1 + p.bend * 2.2), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.02 + p.bend * 0.05);
    const g = this.gain(0);
    this.adEnv(g.gain, t, v * 0.9, 0.001, p.decay);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + p.decay + 0.05);
    if (p.metal > 0.01) {
      const m = c.createOscillator(); m.type = 'square';
      m.frequency.value = f * 2.76;
      const mf = this.filter('bandpass', f * 5.4, 3);
      const mg = this.gain(0);
      this.adEnv(mg.gain, t, v * p.metal * 0.5, 0.001, p.decay * 0.6);
      m.connect(mf).connect(mg).connect(out);
      m.start(t); m.stop(t + p.decay + 0.05);
    }
    if (p.noise > 0.01) {
      const n = this.noiseSrc(t, 0.12);
      const bp = this.filter('bandpass', Math.min(12000, f * 7), 1.6);
      const ng = this.gain(0);
      this.adEnv(ng.gain, t, v * p.noise * 0.9, 0.0008, 0.035);
      n.connect(bp).connect(ng).connect(out);
    }
  }

  // FM electric piano: sine carrier, 1:1 modulator for the bark, 14:1 burst for the tine.
  keys(t, v, iv, root, p, out) {
    const c = this.ctx, end = t + Math.max(0.6, p.decay * 3) + 0.3;
    const lp = this.filter('lowpass', Math.min(9000, p.cutoff * 2.5), 0.5);
    const trem = c.createStereoPanner();
    const lfo = c.createOscillator(); lfo.frequency.value = 4.8;
    const depth = this.gain(0.35); lfo.connect(depth).connect(trem.pan);
    iv.forEach((n, k) => {
      const f = midiHz(root + n), vel = v * (0.85 + hash(t * 97, k) * 0.3);
      const car = c.createOscillator(); car.frequency.value = f; car.detune.value = (k % 2 ? 1 : -1) * p.detune * 0.15;
      const mod = c.createOscillator(); mod.frequency.value = f;
      const modAmt = this.gain(0); mod.connect(modAmt).connect(car.frequency);
      modAmt.gain.setValueAtTime(f * (0.6 + vel * 1.6), t);
      modAmt.gain.setTargetAtTime(f * 0.15, t + 0.005, 0.12 + p.env * 0.3);
      const tine = c.createOscillator(); tine.frequency.value = f * 14;
      const tineAmt = this.gain(0); tine.connect(tineAmt).connect(car.frequency);
      tineAmt.gain.setValueAtTime(f * 2.5 * vel, t);
      tineAmt.gain.setTargetAtTime(0, t + 0.002, 0.018);
      const amp = this.gain(0);
      amp.gain.setValueAtTime(EPS, t);
      amp.gain.linearRampToValueAtTime((0.42 * vel) / Math.sqrt(iv.length), t + 0.004);
      amp.gain.setTargetAtTime(0, t + 0.01, Math.max(0.15, p.decay * 0.9));
      car.connect(amp).connect(lp);
      for (const o of [car, mod, tine]) { o.start(t); o.stop(end); }
    });
    lp.connect(trem).connect(out);
    lfo.start(t); lfo.stop(end);
  }

  stab(t, v) {
    const c = this.ctx, p = this.state.params.stab, out = this.ch.stab.input;
    const h = this.harm;
    const iv = CHORDS[h ? h.c : Math.round(p.chord)].iv;
    const root = 48 + this.state.key + Math.round(p.octave) * 12 + this.harmRoot();
    const vo = Math.round(p.voice);
    if (vo > 0) return this[STAB_VOICES[vo]](t, v, iv, root, p, out);
    const lp = this.filter('lowpass', p.cutoff, p.reso);
    const amp = this.gain(0);
    const env = c.createConstantSource();
    env.offset.setValueAtTime(p.env * 3600 * v, t);
    env.offset.setTargetAtTime(0, t + 0.004, Math.max(0.01, p.decay * 0.35));
    env.connect(lp.detune);
    const peak = (v * 0.55) / Math.sqrt(iv.length);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.003);
    amp.gain.setTargetAtTime(0, t + 0.012, Math.max(0.02, p.decay * 0.5));
    const end = t + p.decay * 4 + 0.2;
    for (const n of iv) {
      for (const side of [-1, 1]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = midiHz(root + n);
        o.detune.value = side * p.detune;
        const pan = c.createStereoPanner(); pan.pan.value = side * 0.55;
        o.connect(pan).connect(lp);
        o.start(t); o.stop(end);
      }
    }
    lp.connect(amp).connect(out);
    env.start(t); env.stop(end);
  }

  // Slow-swelling ensemble: three detuned saws per note, filter opens with ENV, DECAY sets release.
  pad(t, v, iv, root, p, out) {
    const c = this.ctx, atk = 0.04 + p.env * 0.9, hold = Math.max(this.stepDur * 4, p.decay * 1.2), end = t + atk + hold + p.decay * 2 + 0.2;
    const lp = this.filter('lowpass', p.cutoff * 0.5, Math.max(0.5, p.reso * 0.4));
    lp.frequency.setValueAtTime(p.cutoff * 0.4, t);
    lp.frequency.linearRampToValueAtTime(p.cutoff, t + atk);
    const amp = this.gain(0), peak = (v * 0.3) / Math.sqrt(iv.length);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(peak, t + atk);
    amp.gain.setTargetAtTime(0, t + atk + hold, Math.max(0.1, p.decay * 0.6));
    iv.forEach((n) => {
      [-1, 0, 1].forEach((side) => {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = midiHz(root + n); o.detune.value = side * (4 + p.detune);
        const pan = c.createStereoPanner(); pan.pan.value = side * 0.7;
        o.connect(pan).connect(lp); o.start(t); o.stop(end);
      });
    });
    lp.connect(amp).connect(out);
  }

  // Drawbar organ with key click and a rotary-style vibrato; DETUNE sets rotor depth.
  organ(t, v, iv, root, p, out) {
    const c = this.ctx, gate = Math.max(0.08, p.decay * 0.9), end = t + gate + 0.25;
    const lp = this.filter('lowpass', Math.min(12000, p.cutoff * 3), 0.6);
    const amp = this.gain(0), peak = (v * 0.24) / Math.sqrt(iv.length);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.006);
    amp.gain.setTargetAtTime(0, t + gate, 0.05);
    const lfo = c.createOscillator(); lfo.frequency.value = 6.2;
    const vib = this.gain(p.detune * 0.4); lfo.connect(vib);
    for (const n of iv) {
      const f = midiHz(root + n);
      for (const [mul, lvl] of [[0.5, 0.6], [1, 1], [2, 0.55], [3, 0.3]]) {
        const o = c.createOscillator(); o.frequency.value = f * mul; vib.connect(o.detune);
        const g = this.gain(lvl); o.connect(g).connect(lp); o.start(t); o.stop(end);
      }
    }
    const ck = this.noiseSrc(t, 0.012), cbp = this.filter('bandpass', 2400, 0.8), cg = this.gain(0);
    this.adEnv(cg.gain, t, v * 0.12, 0.0005, 0.006);
    ck.connect(cbp).connect(cg).connect(out);
    lp.connect(amp).connect(out);
    lfo.start(t); lfo.stop(end);
  }

  // Brass section: saws scooping into pitch while the filter blooms; ENV sets the blare.
  brass(t, v, iv, root, p, out) {
    const c = this.ctx, gate = Math.max(0.08, p.decay * 0.8), end = t + gate + 0.4;
    const lp = this.filter('lowpass', p.cutoff * 0.4, Math.max(0.7, p.reso * 0.5));
    lp.frequency.setValueAtTime(p.cutoff * 0.35, t);
    lp.frequency.linearRampToValueAtTime(Math.min(14000, p.cutoff * (1 + p.env * 3) * (0.7 + v * 0.3)), t + 0.06);
    lp.frequency.setTargetAtTime(p.cutoff * 0.8, t + 0.08, 0.15);
    const amp = this.gain(0), peak = (v * 0.36) / Math.sqrt(iv.length);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(peak, t + 0.025);
    amp.gain.setTargetAtTime(peak * 0.75, t + 0.05, 0.1);
    amp.gain.setTargetAtTime(0, t + gate, 0.06);
    iv.forEach((n, k) => {
      for (const side of [-1, 1]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = midiHz(root + n);
        o.detune.setValueAtTime(-60 + side * p.detune * 0.5, t);
        o.detune.linearRampToValueAtTime(side * p.detune * 0.5, t + 0.04 + k * 0.004);
        const pan = c.createStereoPanner(); pan.pan.value = side * 0.4;
        o.connect(pan).connect(lp); o.start(t); o.stop(end);
      }
    });
    lp.connect(amp).connect(out);
  }

  // Bright pluck, strummed: the filter snaps shut over DECAY; ENV sets how bright the snap is.
  pluck(t, v, iv, root, p, out) {
    const c = this.ctx, dec = Math.max(0.04, p.decay * 0.35);
    iv.forEach((n, k) => {
      const tt = t + k * 0.011, end = tt + dec * 5 + 0.1, f = midiHz(root + n);
      const lp = this.filter('lowpass', p.cutoff, p.reso * 0.7);
      lp.frequency.setValueAtTime(Math.min(16000, p.cutoff * (1.5 + p.env * 6)), tt);
      lp.frequency.setTargetAtTime(Math.max(200, p.cutoff * 0.5), tt + 0.003, dec * 0.5);
      const amp = this.gain(0), peak = (v * 0.38) / Math.sqrt(iv.length);
      amp.gain.setValueAtTime(EPS, tt);
      amp.gain.linearRampToValueAtTime(peak, tt + 0.002);
      amp.gain.setTargetAtTime(0, tt + 0.004, dec);
      const a = c.createOscillator(); a.type = 'sawtooth'; a.frequency.value = f; a.detune.value = -p.detune * 0.5;
      const b = c.createOscillator(); b.type = 'square'; b.frequency.value = f; b.detune.value = p.detune * 0.5;
      const bg = this.gain(0.5); b.connect(bg).connect(lp); a.connect(lp);
      const pan = c.createStereoPanner(); pan.pan.value = ((k % 3) - 1) * 0.35;
      lp.connect(amp).connect(pan).connect(out);
      for (const o of [a, b]) { o.start(tt); o.stop(end); }
    });
  }

  // FM bells and mallets: ENV sets the strike brightness, DECAY the ring, DETUNE the shimmer.
  bells(t, v, iv, root, p, out) {
    const c = this.ctx, ring = Math.max(0.2, p.decay * 1.6);
    const lp = this.filter('lowpass', Math.min(16000, p.cutoff * 2.5), 0.5);
    iv.forEach((n, k) => {
      const tt = t + k * 0.018, f = midiHz(root + 12 + n), end = tt + ring * 4;
      const car = c.createOscillator(); car.frequency.value = f; car.detune.value = (k % 2 ? 1 : -1) * p.detune * 0.2;
      const mod = c.createOscillator(); mod.frequency.value = f * 3.5;
      const ma = this.gain(0); mod.connect(ma).connect(car.frequency);
      ma.gain.setValueAtTime(f * (0.5 + p.env * 4) * v, tt);
      ma.gain.setTargetAtTime(f * 0.05, tt + 0.002, ring * 0.25);
      const amp = this.gain(0);
      amp.gain.setValueAtTime(EPS, tt);
      amp.gain.linearRampToValueAtTime((v * 0.3) / Math.sqrt(iv.length), tt + 0.002);
      amp.gain.setTargetAtTime(0, tt + 0.004, ring);
      car.connect(amp).connect(lp);
      for (const o of [car, mod]) { o.start(tt); o.stop(end); }
    });
    lp.connect(out);
  }

  vox(t, v, step) {
    const c = this.ctx, p = this.state.params.vox, sample = getSample();
    const { buffer, slices } = sample;
    const jump = hash(step, 1) < p.scatter ? Math.floor(hash(step, 2) * slices.length) : 0;
    const idx = (Math.round(p.slice) + jump) % slices.length;
    const from = slices[idx], to = slices[idx + 1] ?? buffer.duration;
    const notes = SCALES[this.state.scale]?.notes || SCALES.minor.notes;
    const degree = hash(step, 3) < p.melody ? notes[Math.floor(hash(step, 4) * notes.length)] : 0;
    const rate = 2 ** ((Math.round(p.pitch) + degree) / 12);
    const dur = Math.max(0.03, Math.min((to - from) / rate, p.length * this.stepDur));
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = p.tone; lp.Q.value = 0.7;
    const amp = this.gain(0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(v, t + 0.004);
    amp.gain.setValueAtTime(v, t + Math.max(0.005, dur - 0.015));
    amp.gain.linearRampToValueAtTime(0, t + dur);
    src.connect(lp).connect(amp).connect(this.ch.vox.input);
    src.start(t, from, dur + 0.02);
  }

  lick(t, v, k) {
    const p = this.state.params.stab, h = this.harm;
    const iv = CHORDS[h ? h.c : Math.round(p.chord)].iv;
    const n = iv[k % iv.length] + 12 * Math.floor(k / iv.length);
    const vo = Math.round(p.voice), lead = vo > 1 ? STAB_VOICES[vo] : 'keys';
    return this[lead](t, v, [n], 60 + this.state.key + Math.round(p.octave) * 12 + this.harmRoot(), p, this.ch.stab.input);
  }

  harmRoot() { const h = this.harm; return h ? ((((h.r + 6) % 12) + 12) % 12) - 6 : 0; }

  // Round finger-style bass: triangle + sine, short pluck through a gentle lowpass.
  bass(t, st, sd, holdNext) {
    const c = this.ctx, p = this.state.params.acid;
    const f = midiHz(36 + this.state.key + st.n + Math.round(p.tune) + this.harmRoot());
    const len = holdNext ? sd * 2 : sd * (0.9 + p.decay * 2);
    if (Math.round(this.state.master.kit || 0) === 1) {
      const kit = liveKit();
      if (kit) return this.sampledBass(kit, t, 36 + this.state.key + st.n + Math.round(p.tune) + this.harmRoot(), len, st.a);
      loadLiveKit();
    }
    const tri = c.createOscillator(); tri.type = 'triangle'; tri.frequency.value = f;
    const sub = c.createOscillator(); sub.frequency.value = f;
    const lp = this.filter('lowpass', 180 + p.cutoff * 0.6 + (st.a ? 500 : 0), 0.7);
    lp.frequency.setTargetAtTime(160 + p.cutoff * 0.3, t + 0.01, 0.08);
    const grit = this.ctx.createWaveShaper(); grit.curve = driveCurve(0.18 + p.drive * 0.5);
    const pick = this.noiseSrc(t, 0.02), pbp = this.filter('bandpass', 1100 + f * 4, 1.2), pg = this.gain(0);
    this.adEnv(pg.gain, t, st.a ? 0.16 : 0.1, 0.0008, 0.012);
    pick.connect(pbp).connect(pg).connect(this.ch.acid.input);
    const amp = this.gain(0), vel = (st.a ? 1 : 0.82) * (1 - p.drive * 0.2);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.006);
    amp.gain.setTargetAtTime(vel * 0.55, t + 0.02, 0.12);
    amp.gain.setTargetAtTime(0, t + len, 0.03);
    tri.connect(lp); sub.connect(lp); lp.connect(grit).connect(amp).connect(this.ch.acid.input);
    for (const o of [tri, sub]) { o.start(t); o.stop(t + len + 0.3); }
  }

  // Mono note helper for 808/REESE: chokes the previous note and glides on SLIDE steps.
  monoNote(t, f, sliding) {
    const prev = this.mono;
    if (prev && prev.end > t) prev.amp.gain.setTargetAtTime(0, t, sliding ? 0.02 : 0.006);
    this.mono = null;
    return prev && sliding && prev.end > t ? prev.f : f;
  }

  // Tuned 808: sine sub with a pitch knock, long tail on DECAY, CUTOFF/DRIVE add harmonics; slides glide.
  eight08(t, st, sd, holdNext, sliding) {
    const c = this.ctx, p = this.state.params.acid;
    const f = midiHz(36 + this.state.key + st.n + Math.round(p.tune) + this.harmRoot());
    const from = this.monoNote(t, f, sliding), len = holdNext ? sd * 2 : 0.15 + p.decay * 1.6, end = t + len + 0.4;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(sliding ? from : f * 1.9, t);
    o.frequency.exponentialRampToValueAtTime(f, t + (sliding ? 0.09 : 0.03));
    const sh = c.createWaveShaper(); sh.curve = driveCurve(0.1 + p.drive * 0.85);
    const lp = this.filter('lowpass', Math.max(80, p.cutoff * 2), 0.7);
    const amp = this.gain(0), vel = (st.a ? 1 : 0.85) * (1 + p.accent * (st.a ? 0.2 : 0)) * 0.9;
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.004);
    amp.gain.setTargetAtTime(0, t + 0.02, Math.max(0.05, len * 0.45));
    o.connect(sh).connect(lp).connect(amp).connect(this.ch.acid.input);
    o.start(t); o.stop(end);
    this.mono = { amp, f, end };
  }

  // Reese: two detuned saws beating against each other plus a sine sub. SAW/SQR sets the detune spread,
  // ENV MOD sweeps the filter, RESO adds bite.
  reese(t, st, sd, holdNext, sliding) {
    const c = this.ctx, p = this.state.params.acid;
    const f = midiHz(36 + this.state.key + st.n + Math.round(p.tune) + this.harmRoot());
    const from = this.monoNote(t, f, sliding), len = holdNext ? sd * 2 : sd * (1 + p.decay * 6), end = t + len + 0.3;
    const lp = this.filter('lowpass', p.cutoff, Math.max(0.5, p.reso * 0.35));
    lp.frequency.setValueAtTime(Math.min(9000, p.cutoff * (1 + p.envmod * 5 + (st.a ? p.accent * 2 : 0))), t);
    lp.frequency.setTargetAtTime(p.cutoff, t + 0.01, Math.max(0.03, p.decay * 0.6));
    const sh = c.createWaveShaper(); sh.curve = driveCurve(0.15 + p.drive * 0.7);
    const amp = this.gain(0), vel = (st.a ? 0.95 : 0.8);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel * 0.5, t + 0.008);
    amp.gain.setTargetAtTime(0, t + len, 0.04);
    const spread = 8 + p.wave * 30;
    for (const [type, det, lvl] of [['sawtooth', -spread, 0.5], ['sawtooth', spread, 0.5], ['sine', 0, 0.9]]) {
      const o = c.createOscillator(); o.type = type; o.detune.value = det;
      o.frequency.setValueAtTime(from, t);
      if (from !== f) o.frequency.exponentialRampToValueAtTime(f, t + 0.08);
      const g = this.gain(lvl);
      o.connect(g).connect(type === 'sine' ? amp : lp);
      o.start(t); o.stop(end);
    }
    lp.connect(sh).connect(amp).connect(this.ch.acid.input);
    this.mono = { amp, f, end };
  }

  // Amapiano log drum: a hollow, pitched knock. Sine body with a fast pitch drop, a second-harmonic
  // triangle for the wooden tone and a bandpassed click. CUTOFF sets brightness, DRIVE the grit.
  logdrum(t, st, sd, holdNext, sliding) {
    const c = this.ctx, p = this.state.params.acid, out = this.ch.acid.input;
    const f = midiHz(48 + this.state.key + st.n + Math.round(p.tune) + this.harmRoot());
    const from = this.monoNote(t, f, sliding), len = holdNext ? sd * 2 : 0.1 + p.decay * 0.8, end = t + len + 0.3;
    const o = c.createOscillator(), o2 = c.createOscillator(); o2.type = 'triangle';
    o.frequency.setValueAtTime(sliding ? from : f * 2.4, t);
    o.frequency.exponentialRampToValueAtTime(f, t + (sliding ? 0.07 : 0.025));
    o2.frequency.setValueAtTime(sliding ? from * 2 : f * 4, t);
    o2.frequency.exponentialRampToValueAtTime(f * 2, t + 0.02);
    const g2 = this.gain(0); this.adEnv(g2.gain, t, 0.3, 0.001, Math.max(0.03, len * 0.3));
    const sh = c.createWaveShaper(); sh.curve = driveCurve(0.15 + p.drive * 0.8);
    const lp = this.filter('lowpass', Math.max(200, p.cutoff * 3), 0.7);
    const amp = this.gain(0), vel = (st.a ? 1 : 0.8) * (1 + p.accent * (st.a ? 0.25 : 0)) * 0.8;
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.002);
    amp.gain.setTargetAtTime(0, t + 0.01, Math.max(0.04, len * 0.35));
    o.connect(sh); o2.connect(g2).connect(sh);
    sh.connect(lp).connect(amp).connect(out);
    o.start(t); o2.start(t); o.stop(end); o2.stop(end);
    const nz = this.noiseSrc(t, 0.03), bp = this.filter('bandpass', Math.min(6000, f * 8), 3), ng = this.gain(0);
    this.adEnv(ng.gain, t, 0.25 * vel, 0.0005, 0.012);
    nz.connect(bp).connect(ng).connect(out);
    this.mono = { amp, f, end };
  }

  acid(t, st, sliding, holdNext, sd) {
    const a = this.acidNodes, p = this.state.params.acid;
    const vo = Math.round(p.voice);
    if (vo > 0) { a.vca.gain.setTargetAtTime(0, t, 0.005); return this[['', 'bass', 'eight08', 'reese', 'logdrum'][vo]](t, st, sd, holdNext, sliding); }
    const f = midiHz(36 + this.state.key + st.n + Math.round(p.tune) + this.harmRoot());
    for (const o of [a.o1, a.o2]) {
      if (sliding) o.frequency.setTargetAtTime(f, t, 0.024);
      else o.frequency.setValueAtTime(f, t);
    }
    const acc = st.a ? p.accent : 0;
    if (!sliding) {
      const amt = 200 + p.envmod * 4400 + acc * 2600;
      const dec = Math.max(0.03, p.decay * (1 - acc * 0.5));
      a.env.offset.cancelScheduledValues(t);
      a.env.offset.setTargetAtTime(amt, t, 0.0015);
      a.env.offset.setTargetAtTime(0, t + 0.007, dec / 3);
      a.vca.gain.cancelScheduledValues(t);
      a.vca.gain.setTargetAtTime(0.6 + acc * 0.5, t, 0.0015);
    } else if (acc) {
      a.env.offset.setTargetAtTime(acc * 2200, t, 0.004);
      a.env.offset.setTargetAtTime(0, t + 0.01, p.decay / 3);
    }
    if (!holdNext) a.vca.gain.setTargetAtTime(0, t + sd * 0.55, 0.006);
  }

  acidRelease(t) { this.acidNodes.vca.gain.setTargetAtTime(0, t, 0.008); if (this.mono) { this.mono.amp.gain.setTargetAtTime(0, t, 0.01); this.mono = null; } }

  // ---------- performance (realtime) ----------
  setThrow(on) { this.throwBus.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.012); }

  riserStart() {
    if (this.riser) return;
    const now = this.ctx.currentTime;
    // Audible within a beat, peaks after 2 bars
    const dur = this.stepDur * 32;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bp = this.filter('bandpass', 400, 2.5);
    const g = this.gain(0);
    bp.frequency.setValueAtTime(400, now);
    bp.frequency.exponentialRampToValueAtTime(9000, now + dur);
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.12, now + 0.05);
    g.gain.linearRampToValueAtTime(0.55, now + dur);
    s.connect(bp).connect(g);
    g.connect(this.mix); g.connect(this.revIn);
    s.start(now);
    this.riser = { s, g };
  }

  riserStop() {
    if (!this.riser) return;
    const now = this.ctx.currentTime;
    const { s, g } = this.riser;
    if (g.gain.cancelAndHoldAtTime) g.gain.cancelAndHoldAtTime(now); else g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(0, now, 0.03);
    s.stop(now + 0.6);
    this.riser = null;
  }

  panic() {
    const now = this.ctx.currentTime;
    this.acidRelease(now);
    this.riserStop();
    this.setThrow(false);
  }
}

export function parseChain(str) {
  return (str || '').toUpperCase().replace(/[^A-H]/g, '').split('').map((ch) => ch.charCodeAt(0) - 65);
}

const DRUMS = new Set(['kick', 'clap', 'snare', 'ch', 'oh', 'ride', 'perc']);

export class Sequencer {
  constructor(engine, state) {
    this.e = engine;
    this.s = state;
    this.cur = state.current;
    this.queued = null;
    this.chainPos = 0;
    this.roll = null;
    this.acidPrevSlide = false;
    this.acidMuted = false;
  }

  advanceBar(abs) {
    if (abs % 16 !== 0) return;
    const chain = this.s.chainOn ? parseChain(this.s.chain) : [];
    if (chain.length) { this.cur = chain[this.chainPos % chain.length]; this.chainPos++; }
    else if (this.queued !== null) { this.cur = this.queued; this.queued = null; }
  }

  tick(abs, t) {
    const s = this.s, e = this.e;
    this.advanceBar(abs);
    const pat = s.patterns[this.cur];
    const bar = Math.floor(abs / 16), vary = s.master.vary || 0;
    e.harm = pat.prog?.length ? pat.prog[bar % pat.prog.length] : null;
    const sd = e.stepDur;
    const tt = t + (abs % 2 ? s.swing * sd * 0.5 : 0);
    if ((s.master.dust || 0) > 0.01) e.dust(t, sd, abs);
    const anySolo = TRACK_IDS.some((id) => s.solos[id]);
    for (const id of TRACK_IDS) {
      const on = !s.mutes[id] && (!anySolo || s.solos[id]);
      const len = pat.len[id] || 16;
      const i = abs % len;
      if (id === 'acid') {
        if (!on) {
          if (!this.acidMuted) e.acidRelease(tt);
          this.acidMuted = true; this.acidPrevSlide = false;
          continue;
        }
        this.acidMuted = false;
        const nextH = vary && i === len - 1 && pat.prog?.length > 1 ? pat.prog[(bar + 1) % pat.prog.length] : null;
        if (nextH && nextH.r !== e.harm?.r && hash(bar, 91) < vary) {
          const cur = e.harm; e.harm = nextH;
          e.acid(tt + (s.master.humanize || 0) * 0.016, { on: true, n: hash(bar, 92) < 0.5 ? -1 : 1, a: false, s: false }, false, false, sd);
          e.harm = cur; this.acidPrevSlide = false;
        } else this.acidStep(pat, i, len, tt, sd);
        continue;
      }
      if (this.roll === id && id !== 'stab') {
        const r = this.rollCount = (this.rollCount || 0) + 1;
        const base = 0.45 + Math.min(0.5, r * 0.02);
        e.trigger(id, tt, base);
        e.trigger(id, tt + sd / 2, base * 0.8);
        continue;
      }
      if (!on) continue;
      let v = pat.steps[id][i];
      if (vary) {
        const k = TRACK_IDS.indexOf(id), roll = hash(abs * 1.37 + bar, k + 40);
        if (v && (id === 'ch' || id === 'perc' || id === 'ride' || id === 'vox') && roll < vary * 0.18) v = 0;
        else if (!v && id === 'snare' && roll < vary * (bar % 4 === 3 && i >= 12 ? 0.7 : 0.1)) v = 0.45;
        else if (!v && id === 'ch' && roll < vary * 0.12) v = 0.4;
        else if (!v && id === 'kick' && i % 4 === 3 && roll < vary * 0.08) v = 0.6;
        if (bar % 8 === 7 && i >= 12 && (id === 'kick' || id === 'stab') && hash(bar, k) < vary) v = 0;
      }
      const hum = s.master.humanize || 0;
      const k = TRACK_IDS.indexOf(id), drum = DRUMS.has(id), cym = id === 'ch' || id === 'ride' || id === 'oh';
      const late = hum * ((id === 'snare' || id === 'clap') ? 0.03 : cym ? (i % 2 ? 0.016 : 0.006) : id === 'kick' ? -0.003 : id === 'stab' || id === 'acid' ? 0.016 : 0);
      // Drummer feel: the whole kit breathes together over 8 bars and pushes into each 4-bar fill
      const phrase = drum ? hum * (0.007 * Math.sin((Math.PI * 2 * abs) / 128 + 1.3) - (bar % 4 === 3 && i >= 8 ? 0.005 : 0)) : 0;
      const ht = tt + late + phrase + (hash(bar, k + 60) - 0.5) * hum * 0.006 + (hash(abs, k) - 0.5) * hum * 0.008;
      const accent = cym ? (i % 4 === 0 ? 1 : i % 2 === 0 ? 0.84 : 0.68) : 1;
      const swell = drum ? 1 - hum * 0.1 * (3 - (bar % 4)) / 3 : 1;
      const hv = (1 - hum * 0.22 * hash(abs, k + 20)) * (1 - hum * (1 - accent)) * swell;
      const ghostSnare = id === 'snare' && Math.round(s.master.kit || 0) === 1;
      const vel = (v === 2 ? 1 : v === 1 ? (ghostSnare ? 0.45 : 0.78) : v) * hv;
      if (v && id === 'vox') e.vox(ht, vel, i);
      else if (v) e.trigger(id, ht, vel);
    }
    const sp = pat.steps.stab;
    if (vary && !s.mutes.stab && (!anySolo || s.solos.stab) && bar % 2 === 1 && !sp[abs % (pat.len.stab || 16)] && hash(abs, 77) < vary * 0.28) {
      const k = Math.floor(hash(abs, 78) * 6) + (bar % 4 === 3 ? 2 : 0);
      e.lick(tt + (s.master.humanize || 0) * 0.02, 0.35 + hash(abs, 79) * 0.3, k);
    }
    if (this.roll === null) this.rollCount = 0;
    return this.cur;
  }

  acidStep(pat, i, len, t, sd) {
    const steps = pat.steps.acid;
    const st = steps[i];
    if (!st.on) { this.acidPrevSlide = false; return; }
    const next = steps[(i + 1) % len];
    this.e.acid(t, st, this.acidPrevSlide, st.s && next.on, sd);
    this.acidPrevSlide = !!st.s;
  }
}
