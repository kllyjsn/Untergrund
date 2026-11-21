import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// False conditional breakpoints observe module locals without changing app sources or pausing.
export async function installDiagnostics(send, base, {vocalSlew = false, vocalRestart = false, wholeStep = false, dropStep = false, forceRepeat = false, listenerAudit = false} = {}) {
  await send('Debugger.enable');
  const at = async (file, marker, body, required = true) => {
    const source = await readFile(new URL(`../js/${file}`, import.meta.url), 'utf8');
    const lineNumber = source.split('\n').findIndex(l => l.includes(marker));
    if (lineNumber < 0 && !required) return;
    assert.ok(lineNumber >= 0, `Diagnostic marker missing: ${file}: ${marker}`);
    await send('Debugger.setBreakpointByUrl', { url: `${base}/js/${file}`, lineNumber,
      condition: `(() => { if (!globalThis.__clubAudio) return false;
        try { ${body}; } catch (e) {
          const errors = __clubAudio.probeErrors ||= [];
          const message = ${JSON.stringify(file + ': ' + marker + ': ')} + String(e);
          if (!errors.includes(message)) errors.push(message);
        } return false; })()` });
  };
  const optional = name => `${name}:typeof ${name} === 'undefined' ? undefined : ${name}`;
  if (listenerAudit) {
    const mark = (kind, fields = '') => `(__clubAudio.transitions ||= []).push({kind:'${kind}',
      at:performance.timeOrigin + performance.now(), contextTime:ctx?.currentTime${fields}})`;
    await at('main.js', "if (!continuous || !sameSet) playbackStats.end", mark('join', ', continuous, sameSet, startsAt, broadcastId:item.broadcastId'));
    await at('main.js', "function stop(playbackOutcome", mark('stop', ', playing, roomPlayback'));
    await at('main.js', 'if (!seeking) engine.recLock', mark('play', ', nextTime, step:abs, transportOrigin'));
    await at('main.js', 'if (fix.adopted) {', mark('grid', ', nextTime, step:abs, skip:fix.skip'), false);
    return;
  }
  const clock = `const selected = typeof best === 'undefined' ? null : best;
    const a = __clubAudio.roomClocks ||= []; if (!a.length || a.at(-1).best?.at !== selected?.at)
    a.push({at:performance.timeOrigin + performance.now(), best:selected ? {...selected} : null,
      shiftMs:selected && typeof monotonic === 'function' && typeof wall === 'function' ? monotonic() + selected.offset - wall() : 0})`;
  await at('room-sync.js', 'return best ? monotonic()', clock);
  await at('main.js', 'if (!seeking) engine.recLock', `(__clubAudio.starts ||= []).push({at:performance.timeOrigin + performance.now(),
    step:typeof abs === 'undefined' ? undefined : abs, ${['delay', 'nextTime', 'transportOrigin'].map(optional).join(', ')},
    contextTime:typeof ctx === 'undefined' ? undefined : ctx.currentTime})`);
  const main = await readFile(new URL('../js/main.js', import.meta.url), 'utf8');
  const targetMarker = main.includes('const target = roomMediaTime(') ? 'const target = roomMediaTime(' : 'const target = transportOrigin';
  await at('main.js', targetMarker, `const a = __clubAudio.scheduler ||= [];
    ${forceRepeat ? `const first = __clubAudio.vocalStarts?.find(s => s.forced)?.forced, index = abs - seq.origin;
    if (first && !__clubAudio.vocalForceRepeatInjected && index > first.step && index %16 ===0 && engine.vocalNow && nextTime > ctx.currentTime +.025) {
      const time = nextTime, pos = Math.floor(index/16)%seq.songBars;
      const repeat = __clubAudio.vocalForceRepeatInjected = {at:performance.timeOrigin+performance.now(), step:index, correctionId:first.correctionId};
      queueMicrotask(() => {
        engine.vocalNow.origin -= .12;
        engine.vocalNow.correction = {id:first.correctionId, forceFrom:index-32, forceStep:index};
        repeat.applied = engine.vocal(time, pos, 0, time, true);
      });
    }` : ''}
    ${vocalSlew ? `if (!__clubAudio.forcedVocalSlew && abs >= 32 && abs % 16 >= 13) {
      transportOrigin += 20; __clubAudio.forcedVocalSlew = {at:performance.timeOrigin + performance.now(), step:abs, deltaMs:20}; }` : ''}
    ${vocalRestart ? `if (!__clubAudio.vocalRestartInjected && __clubAudio.forcedVocalSlew && abs >= __clubAudio.forcedVocalSlew.step + 16 && engine.vocalNow) {
      const v = engine.vocalOf(engine.state), phase = ((seq.chainPos - 1) % seq.songBars * 16 + (abs - seq.origin) % 16) * engine.stepDur - v.ms / 1000;
      const data = v.buf.getChannelData(0), first = Math.max(0, Math.floor(phase * v.buf.sampleRate)), count = Math.ceil(.06 * v.buf.sampleRate);
      let energy = 0; for (let i = first; i < Math.min(data.length, first + count); i++) energy += data[i] * data[i];
      if (energy / count > .0004) {
        engine.vocalStop(nextTime); engine.vocal(nextTime, (seq.chainPos - 1) % seq.songBars, (abs - seq.origin) % 16, nextTime, true);
        __clubAudio.vocalRestartInjected = {at:performance.timeOrigin + performance.now(), step:abs, time:nextTime}; }
    }` : ''}
    ${wholeStep ? `if (!__clubAudio.forcedWholeStep && abs >= 64 && abs % 16 === 4 && nextTime > ctx.currentTime + 0.255) {
      const o = ctx.getOutputTimestamp();
      __clubAudio.forcedWholeStep = {at:performance.timeOrigin + performance.now(), step:abs, nextTime, base,
        target:transportOrigin / 1000 + abs * base - clockOffset,
        contextTime:ctx.currentTime, deltaMs:-2 * base * 1000,
        clock:{outputContextTime:o.contextTime, outputEpochMs:performance.timeOrigin + o.performanceTime}};
      transportOrigin -= 2 * base * 1000;
      ${dropStep ? `const tick = seq.tick.bind(seq), step = abs;
        seq.tick = (n, ...args) => { if (!__clubAudio.droppedStep && __clubAudio.gridAdoptions?.length && (n % 16 === 4 || n % 16 === 12)) {
          __clubAudio.droppedStep = {step:n, time:args[0]}; return seq.cur; } return tick(n, ...args); };` : ''}
    }` : ''}
    (__clubAudio.schedulerCalls ||= []).push(performance.timeOrigin + performance.now());
    if (typeof ctx !== 'undefined' && (!a.length || performance.now() - a.at(-1).monotonic >= 1000))
      a.push({at:performance.timeOrigin + performance.now(), monotonic:performance.now(),
        ${['abs', 'base', 'nextTime', 'transportOrigin', 'clockOffset'].map(optional).join(', ')},
        wallOffset:Date.now()/1000 - ctx.currentTime, contextTime:ctx.currentTime,
        baseLatency:ctx.baseLatency, outputLatency:ctx.outputLatency, output:ctx.getOutputTimestamp()})`);
  await at('engine.js', 'this.ch[t.id] = ch;', `if (t.id === 'ch' && __clubAudio.channels?.hat) __clubCaptureChannel(ch.level, 'hat')`);
  await at('main.js', 'if (fix.adopted) {', `if (fix.adopted) (__clubAudio.gridAdoptions ||= []).push({at:performance.timeOrigin + performance.now(),
    contextTime:now, step:abs, nextTime, skipped:fix.skip})`, false);
  await at('engine.js', 'this.vocalCorrection = {', `const a = __clubAudio.vocalCorrections ||= [];
    const ids = globalThis.__clubVocalCorrectionIds ||= new WeakMap();
    if (!ids.has(cur.src)) { const id = a.length; ids.set(cur.src, id);
      a.push({id, at:performance.timeOrigin + performance.now(), time:t, origin, previousOrigin:cur.origin, errorMs, gap}); }
    Object.assign(a[ids.get(cur.src)], {correctionId:typeof alignment === 'undefined' ? undefined : alignment.id,
      forced:typeof forced === 'undefined' ? false : forced, gap});
    if (typeof alignment === 'undefined' && gap) Object.assign(a[ids.get(cur.src)], {gap, appliedAt:performance.timeOrigin + performance.now(), appliedTime:t, appliedErrorMs:errorMs});`, false);
  await at('engine.js', 'if (off < 0) this.startSource', `if (typeof alignment !== 'undefined' && alignment) {
    const ids = globalThis.__clubVocalCorrectionIds, record = __clubAudio.vocalCorrections?.[ids?.get(cur.src)];
    const rubatoFrom = this.vocalRubato ? alignment.forceFrom : null;
    if (record) Object.assign(record, {gap:this.vocalCorrection.gap, forced, correctionId:alignment.id,
      appliedAt:performance.timeOrigin + performance.now(), appliedTime:t, appliedErrorMs:this.vocalCorrection.errorMs,
      appliedOrigin:origin, appliedPreviousOrigin:cur.origin, rubatoFrom, fallbackFadeGuard:this.vocalCorrection.fallbackFadeGuard});
    if (forced) __clubAudio.nextVocalStart = {reason:'forced', correctionId:alignment.id,
      errorMs:this.vocalCorrection.errorMs, step:pos*16+step, stepDur:this.vocalStepDur ?? this.stepDur, vocalMs:v.ms,
      gridTime, rubatoFrom, spliceAdvance:this.vocalCorrection.spliceAdvance, fadeParam:crossfade.gain};
  }`, false);
  await at('main.js', 'if (fix.discard) {', `if (fix.discard) __clubAudio.nextVocalStart = 'wake'`);
}

const median = values => {
  const a = values.filter(Number.isFinite).sort((a, b) => a - b);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

export function diagnose(captures, serverOrigin) {
  return captures.map(c => {
    const sched = (c.scheduler || []).filter(r => r.output.contextTime > 0 && r.at > serverOrigin + 3000);
    const mapped = r => r.at - r.monotonic + r.output.performanceTime + (r.nextTime - r.output.contextTime) * 1000;
    return { vocalCorrections:c.vocalCorrections || [], vocalStarts:c.vocalStarts || [], forcedVocalSlew:c.forcedVocalSlew ?? null,
      forcedWholeStep:c.forcedWholeStep ?? null, droppedStep:c.droppedStep ?? null, vocalRestartInjected:c.vocalRestartInjected ?? null,
      vocalForceRepeatInjected:c.vocalForceRepeatInjected ?? null,
      gridAdoptions:c.gridAdoptions || [],
      roomClock: c.roomClocks?.at(-1) ?? null,
      joinRoomClock: c.roomClocks?.filter(r => r.at <= c.starts?.[0]?.at).at(-1) ?? null,
      starts: c.starts || [], schedulerSamples: sched.length,
      originMinusServerMs: median(sched.map(r => r.transportOrigin - serverOrigin - c.clockSkew)),
      scheduledOutputOffsetMs: median(sched.map(r => mapped(r) - (r.transportOrigin + r.abs * r.base * 1000 - c.clockSkew))),
      outputClockLeadMs: median(sched.map(r => mapped(r) + (r.contextTime - r.nextTime) * 1000 - r.at)),
      baseLatencyMs: median(sched.map(r => r.baseLatency * 1000)), outputLatencyMs: median(sched.map(r => r.outputLatency * 1000)),
      smoothingResidualMs: median(sched.map(r => (r.wallOffset - r.clockOffset) * 1000)),
      toleranceResidualMs: median(sched.map(r => (r.nextTime - (r.transportOrigin / 1000 + r.abs * r.base - r.clockOffset)) * 1000)),
      audioWallOffsetSpanMs: sched.length ? (Math.max(...sched.map(r => r.wallOffset)) - Math.min(...sched.map(r => r.wallOffset))) * 1000 : null };
  });
}
