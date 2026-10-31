import { TRACKS, TRACK_IDS, CHORDS, DELAY_TIMES, SCALES } from './params.js';
import { getSample } from './sampler.js';
import { midiHz, makeNoise, makeIR, driveCurve, clipCurve, satCurve, SAT_HEADROOM } from './dsp.js';

const DUCKED = new Set(['acid', 'stab', 'vox']);
const hash = (n, k) => { const x = Math.sin(n * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
const EPS = 0.0001;

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
    this.limiter = this.comp(-4, 20, 0, 0.001, 0.07);
    this.limTrim = this.gain(1.05);
    this.clip = c.createWaveShaper(); this.clip.curve = clipCurve(); this.clip.oversample = '4x';
    this.out = this.gain(0.95);
    this.mix.connect(this.djHP).connect(this.djLP).connect(this.glue).connect(this.satIn).connect(this.sat)
      .connect(this.warm).connect(this.master).connect(this.limiter).connect(this.limTrim).connect(this.clip).connect(this.out);
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
    a.shaper = c.createWaveShaper(); a.shaper.oversample = '2x';
    a.post = this.gain(1);
    a.env = c.createConstantSource(); a.env.offset.value = 0;
    a.o1.connect(a.g1).connect(a.f1);
    a.o2.connect(a.g2).connect(a.f1);
    a.f1.connect(a.f2).connect(a.vca).connect(a.hp).connect(a.pre).connect(a.shaper).connect(a.post).connect(this.ch.acid.input);
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
    const depth = this.state.master.duck * Math.min(1, v) * 0.85;
    const rel = this.stepDur * 1.4;
    const pairs = [[this.duck.gain, depth], [this.rumbleDuck.gain, 0.98]];
    for (const [param, d] of pairs) {
      param.cancelScheduledValues(t);
      param.setTargetAtTime(1 - d, t, 0.0025);
      param.setTargetAtTime(1, t + 0.03, rel / 3);
    }
  }

  trigger(id, t, v) {
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
      const bp = this.filter('bandpass', 3800, 0.8);
      const cg = this.gain(0);
      cg.gain.setValueAtTime(p.click * v * 0.9, t);
      cg.gain.exponentialRampToValueAtTime(EPS, t + 0.007);
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

  metallic(t, mul, out) {
    const c = this.ctx;
    const sum = this.gain(0.16);
    const freqs = [205.3, 304.4, 369.6, 522.7, 540, 800];
    const oscs = freqs.map((f) => {
      const o = c.createOscillator(); o.type = 'square';
      o.frequency.value = f * mul;
      o.connect(sum);
      o.start(t);
      return o;
    });
    sum.connect(out);
    return oscs;
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
    if (Math.round(p.voice) === 1) return this.keys(t, v, iv, root, p, out);
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

  harmRoot() { const h = this.harm; return h ? ((((h.r + 6) % 12) + 12) % 12) - 6 : 0; }

  // Round finger-style bass: triangle + sine, short pluck through a gentle lowpass.
  bass(t, st, sd, holdNext) {
    const c = this.ctx, p = this.state.params.acid;
    const f = midiHz(36 + this.state.key + st.n + Math.round(p.tune) + this.harmRoot());
    const len = holdNext ? sd * 2 : sd * (0.9 + p.decay * 2);
    const tri = c.createOscillator(); tri.type = 'triangle'; tri.frequency.value = f;
    const sub = c.createOscillator(); sub.frequency.value = f;
    const lp = this.filter('lowpass', 180 + p.cutoff * 0.6 + (st.a ? 500 : 0), 0.7);
    lp.frequency.setTargetAtTime(160 + p.cutoff * 0.3, t + 0.01, 0.08);
    const amp = this.gain(0), vel = (st.a ? 0.95 : 0.75) * (1 - p.drive * 0.2);
    amp.gain.setValueAtTime(EPS, t);
    amp.gain.linearRampToValueAtTime(vel, t + 0.006);
    amp.gain.setTargetAtTime(vel * 0.55, t + 0.02, 0.12);
    amp.gain.setTargetAtTime(0, t + len, 0.03);
    tri.connect(lp); sub.connect(lp); lp.connect(amp).connect(this.ch.acid.input);
    for (const o of [tri, sub]) { o.start(t); o.stop(t + len + 0.3); }
  }

  acid(t, st, sliding, holdNext, sd) {
    const a = this.acidNodes, p = this.state.params.acid;
    if (Math.round(p.voice) === 1) { a.vca.gain.setTargetAtTime(0, t, 0.005); return this.bass(t, st, sd, holdNext); }
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

  acidRelease(t) { this.acidNodes.vca.gain.setTargetAtTime(0, t, 0.008); }

  // ---------- performance (realtime) ----------
  setThrow(on) { this.throwBus.gain.setTargetAtTime(on ? 0.85 : 0, this.ctx.currentTime, 0.012); }

  riserStart() {
    if (this.riser) return;
    const now = this.ctx.currentTime;
    const dur = this.stepDur * 64;
    const s = this.ctx.createBufferSource(); s.buffer = this.noise; s.loop = true;
    const bp = this.filter('bandpass', 250, 5);
    const g = this.gain(0);
    bp.frequency.setValueAtTime(250, now);
    bp.frequency.exponentialRampToValueAtTime(9500, now + dur);
    g.gain.setValueAtTime(EPS, now);
    g.gain.exponentialRampToValueAtTime(0.42, now + dur);
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
        this.acidStep(pat, i, len, tt, sd);
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
      const late = hum * ((id === 'snare' || id === 'clap') ? 0.03 : id === 'ch' || id === 'ride' ? 0.012 : id === 'stab' || id === 'acid' ? 0.016 : 0);
      const ht = tt + late + (hash(abs, TRACK_IDS.indexOf(id)) - 0.5) * hum * 0.012;
      const hv = 1 - hum * 0.3 * hash(abs, TRACK_IDS.indexOf(id) + 20);
      const vel = (v === 2 ? 1 : v === 1 ? 0.78 : v) * hv;
      if (v && id === 'vox') e.vox(ht, vel, i);
      else if (v) e.trigger(id, ht, vel);
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
