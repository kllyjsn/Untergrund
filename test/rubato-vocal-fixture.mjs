export async function rubatoVocalFixture({style = 'ukg', residual = 0, rubato = true, engineSource, mainSource, pcm = false} = {}) {
  const {defaultState,freshSong} = await import('/js/state.js');
  const {sungNotes} = await import('/js/sing-score.js');
  const {rubatoMap} = await import('/js/perform.js');
  const sync = await import('/js/room-sync.js');
  const media = await import('/js/room-media-sync.js');
  let Engine;
  if (engineSource) {
    const url = URL.createObjectURL(new Blob([engineSource.replaceAll("from './", `from '${location.origin}/js/`)], {type:'text/javascript'}));
    ({Engine} = await import(url)); URL.revokeObjectURL(url);
  } else ({Engine} = await import('/js/engine.js'));
  const source = mainSource ?? await (await fetch('/js/main.js')).text();
  const schedule = source.slice(source.indexOf('function schedule(lead)'), source.indexOf('\n// Jam:'));
  const state = freshSong(style, 7, {length:'sketch', bpm:123, swing:0}) || defaultState();
  state.bpm = 123; state.swing = 0;
  const sr = 48000, seconds = 28, nominal = 15 / state.bpm;
  const ctx = new OfflineAudioContext(1, sr * seconds, sr);
  const buf = ctx.createBuffer(1, sr * 40, sr), samples = buf.getChannelData(0);
  const notes = sungNotes(state);
  if (!notes.length) throw new Error(`No style-derived sung notes for ${style}`);
  for (const [index,note] of notes.entries()) {
    const start = note.at * nominal, duration = note.dur * nominal;
    const f = 440 * 2 ** ((note.midi - 69) / 12);
    const formants = (index + (style === 'ukg' ? 0 : 1)) % 2 ? [420,1850,2700] : [730,1090,2440];
    for (let i = Math.max(0, Math.floor(start * sr)); i < Math.min(samples.length, (start + duration) * sr); i++) {
      const t = i / sr - start, gate = Math.max(0, Math.min(1, t / .025, (duration - t) / .04));
      let value = 0;
      for (let h = 1; h <= 18; h++) {
        const weight = formants.reduce((s,v) => s + Math.exp(-(((f * h - v) / 190) ** 2)), .025) / h;
        value += weight * Math.sin(2 * Math.PI * f * h * t);
      }
      samples[i] += .16 * gate * value;
    }
  }
  const engine = new Engine(ctx, state, {realtime:false, vocal:() => ({buf,gain:1,duck:1,lift:1,ms:0})});
  engine.out.disconnect(); engine.vocalBus.connect(ctx.destination);
  const starts = [], corrections = [], ticks = [], calls = [];
  const create = ctx.createBufferSource.bind(ctx);
  ctx.createBufferSource = () => {
    const src = create(), row = {events:[], stop:Infinity};
    const nativeStart = src.start.bind(src), nativeStop = src.stop.bind(src);
    src.start = (when = 0, offset = 0) => {Object.assign(row,{when,offset}); starts.push(row); nativeStart(when,offset);};
    src.stop = at => {row.stop = at; nativeStop(at);};
    for (const name of ['setValueAtTime','linearRampToValueAtTime','cancelScheduledValues']) {
      const native = src.playbackRate[name].bind(src.playbackRate);
      src.playbackRate[name] = (...args) => {row.events.push({name,args}); return native(...args);};
    }
    return src;
  };
  const vocal = engine.vocal.bind(engine);
  let pendingEntry = null;
  engine.vocal = (...args) => {
    const before = engine.vocalNow, count = starts.length, correction = engine.vocalCorrection;
    const phase = (args[1] * 16 + (args[2] || 0)) * (engine.vocalStepDur ?? engine.stepDur);
    const errorMs = before ? 1000*((args[3]??args[0])-phase-before.origin) : null;
    const pending = !!(before?.correction || before?.gapCorrection);
    calls.push({step:args[1]*16+(args[2]||0),reanchor:!!args[4],pending,errorMs});
    if (args[4] && !pending) pendingEntry = {step:args[1]*16+(args[2]||0),errorMs};
    const result = vocal(...args);
    if (starts.length > count && before) {
      const hard = engine.vocalCorrection !== correction && !!engine.vocalCorrection;
      corrections.push({step:args[1]*16+(args[2]||0), errorMs:hard ? engine.vocalCorrection.errorMs : errorMs,
        hard, forced:hard && engine.vocalCorrection.forced, when:starts.at(-1).when,entry:pendingEntry});
      pendingEntry = null;
    }
    return result;
  };
  const tempo = rubato ? rubatoMap(2048,16,[],1) : Array(2048).fill(1);
  engine.variableScoreTempo = rubato;
  const seq = {origin:0,cur:0,chainPos:1,songBars:12,finished:false,advanceBar(){},rewind(){},
    gridSpan(abs, steps) { return tempo.slice(abs, abs + steps).reduce((sum, scale) => sum + scale * nominal, 0); },
    tick(abs,t,gridTime,editable,settling) {
      this.chainPos = Math.floor(abs / 16) + 1;
      if (abs % 16 === 0) {
        const delay = abs === 0 ? residual : 0;
        engine.vocal(t+delay,Math.floor(abs/16),0,gridTime+delay,false,settling);
      }
      engine.stepScale = tempo[abs];
      ticks.push({step:abs,kick:t,scoreGrid:gridTime});
      this.finished = abs === 191;
      return 0;
    }};
  const noop = () => {};
  const env = {...sync,...media,engine,ctx,state,seq,roomMediaSync:media.createRoomMediaSync(),mediaRoute:null,
    document:{hidden:false},Date:{now:()=>1000000},performance:{now:()=>0},
    playing:true,roomPlayback:true,songOver:false,queuedRoomReplay:null,roomEditor:false,
    roomFirstNote:null,clockOffset:1000,roomAudioClock:null,roomDrainUntil:null,vocalGridDirty:false,
    abs:0,nextTime:1,transportOrigin:1001000,uiQueue:[],handoff:null,jamQueue:[],
    timeline:{skip:()=>0},artistTick:noop,midiClockStep:noop,midiClockStart:noop,
    BG_LEAD:1.5,ROOM_LEAD:.42,setTimeout:noop};
  new Function('env',`with(env){${schedule}; return schedule;}`)(env)(30);
  const phaseAt = (row,time) => {
    let at = row.when, phase = row.offset, rate = 1;
    const events = [];
    for (const event of row.events) {
      if (event.name === 'cancelScheduledValues') {
        for (let i = events.length - 1; i >= 0; i--) if (events[i].at >= event.args[0]) events.splice(i,1);
      } else events.push({at:event.args[1],rate:event.args[0],ramp:event.name==='linearRampToValueAtTime'});
    }
    for (const event of events) {
      if (event.at < at) {rate=event.rate;continue;}
      const end = Math.min(time,event.at), span = event.at-at, elapsed = Math.max(0,end-at);
      const endRate = event.ramp && span ? rate+(event.rate-rate)*elapsed/span : rate;
      phase += elapsed*(rate+endRate)/2;
      if (time <= event.at) return {phase,rate:endRate};
      at=event.at;rate=event.rate;
    }
    return {phase:phase+Math.max(0,time-at)*rate,rate};
  };
  const measurements = ticks.map(tick => {
    const row = starts.filter(s=>s.when<=tick.kick+1e-9 && s.stop>tick.kick).at(-1);
    if (!row) return {...tick,vocalMinusKickMs:null};
    const p = phaseAt(row,tick.kick);
    return {...tick,vocalMinusKickMs:1000*(tick.step*nominal-p.phase)/p.rate};
  });
  const rates = starts.flatMap(s=>s.events.filter(e=>e.name!=='cancelScheduledValues').map(e=>e.args[0]));
  const adjacent = starts.flatMap(s=> {
    const r=s.events.filter(e=>e.name!=='cancelScheduledValues').map(e=>e.args[0]);
    return r.slice(1).map((x,i)=>Math.abs(1200*Math.log2(x/r[i])));
  });
  const rampAdjacent = starts.flatMap(s=> {
    let previous = 1;
    return s.events.filter(e=>e.name!=='cancelScheduledValues').flatMap(e=> {
      const cents = Math.abs(1200*Math.log2(e.args[0]/previous));previous=e.args[0];
      return e.name==='linearRampToValueAtTime' ? [cents] : [];
    });
  });
  const fresh = [-.03,.03].map(error=>sync.transportResync(10+error,10,0,nominal,false,-Infinity,1,true).profile.rates);
  const centsLimit = Math.max(...fresh.flatMap(r=>r.slice(1).map((x,i)=>Math.abs(1200*Math.log2(x/r[i])))));
  const result = {style,residualMs:1000*residual,rubato,fixture:'Fresh deterministic formant synthesis from seed-7 style sungNotes; NOT Music neural inputs',
    restarts:starts.length-1,hardReanchors:corrections.filter(c=>c.hard),durationOnlyRestarts:corrections.filter(c=>!c.hard).length,
    maxVocalMinusKickMs:Math.max(...measurements.map(t=>Math.abs(t.vocalMinusKickMs??0))),
    maxBarVocalMinusKickMs:Math.max(...measurements.filter(t=>t.step%16===0).map(t=>Math.abs(t.vocalMinusKickMs??0))),
    peakCents:Math.max(0,...rates.map(r=>Math.abs(1200*Math.log2(r)))),maxAdjacentCents:Math.max(0,...adjacent),maxRampAdjacentCents:Math.max(0,...rampAdjacent),centsLimit,
    sourceStarts:starts,corrections,measurements,calls};
  if (pcm) {
    const rendered = await ctx.startRendering(), bytes = new Uint8Array(rendered.getChannelData(0).buffer);
    let binary = ''; for(let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    result.pcm=btoa(binary);result.sampleRate=sr;
  }
  return result;
}
