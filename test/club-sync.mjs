// Real app, separate OS browser processes, HTTP rooms, rendered PCM only.
// Extend SCENARIOS rather than adding app test hooks. Node >=22 required.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { availableParallelism } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from './chrome.mjs';
import { defaultState, emptyPattern } from '../js/state.js';
import { installAudioTap, envelope, postResumeEnvelope, onsets, resolvedCompare, fixtureMissing, BPM, KICK_STEPS, PERIOD_MS } from './club-sync-audio.mjs';
import { transitionAudio } from './club-sync-transition.mjs';
import { measureDJEdits } from './club-dj-edit.mjs';
import { installDiagnostics, diagnose } from './club-sync-diagnostics.mjs';
import { mixFixture, realMixFixture, loadRealMixStem, mixBoundaries, mixGraphEdges, installMixStem, analyzeMix, mixFailures, channelEnvelope } from './club-sync-mix.mjs';
import { singRequest, vocalDb } from '../js/sing.js';
import { analyzeVocalGrid, vocalFindings, referenceEnvelope, clipRange, extractPCM, floatWav, levelMatchClips } from './club-sync-vocals.mjs';
import { parseNetwork, networkController, clockSpread } from './club-sync-network.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'test/out');
const SCENARIOS = [
  { name: 'listener-skew', listenerSkew: 2000 },
  { name: 'host-skew', hostSkew: 2000 },
  { name: 'late-join', joinDelay: 10000 },
  { name: 'cold-invite', cold: true },
  { name: 'injected-offset', displacementMs: 2000 },
  { name: 'reconnect', offlineMs: 10000 },
  { name: 'reconnect-expired', offlineMs: 20000 },
  { name: 'reconnect-mix', offlineMs: 10000, mix: true },
  { name: 'reconnect-expired-mix', offlineMs: 20000, mix: true },
  { name: 'foreground-stall', mainThreadStallMs: 320 },
  { name: 'dj-foreground-stall', mainThreadStallMs: 320, stallDJ: true },
  { name: 'dj-edit-latency', djLatency: true },
  { name: 'background-wake', freezeMs: 15000 },
  { name: 'downbeat-wake', freezeMs: 15000, wakeOnDownbeat: true },
  { name: 'short-wake', freezeMs: 800 },
  { name: 'short-wake-mix', freezeMs: 800, mix: true },
  { name: 'background-wake-mix', freezeMs: 15000, mix: true },
  { name: 'dj-handoff', handoff: true },
  { name: 'dj-handoff-mix', handoff: true, mix: true },
  { name: 'replay', replay: true },
];
const args = process.argv.slice(2);
const options = { repeat: 1, output: 'club-sync.json', vocal: 'synthetic', 'net-target':'listener', 'net-label':'default' };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (['--assert', '--diagnostics', '--mute-audio', '--no-audio-device', '--startup-contention', '--clips'].includes(arg)) options[arg.slice(2)] = true;
  else if (['--scenario', '--repeat', '--output', '--cpu-throttle', '--vocal', '--net', '--net-target', '--net-label'].includes(arg) && args[i + 1]) options[arg.slice(2)] = args[++i];
  else throw new Error(`Unknown/missing argument: ${arg}`);
}
const selected = options.scenario;
assert.ok(['synthetic', 'synthetic-pop', 'real'].includes(options.vocal), '--vocal must be synthetic, synthetic-pop or real');
const realVocal = options.vocal === 'real';
const mixSong = () => options.vocal === 'synthetic' ? mixFixture() : realMixFixture();
const selectedScenarios = selected?.split(',');
assert.ok(!selectedScenarios || selectedScenarios.every(name => SCENARIOS.some(s => s.name === name)), 'Unknown scenario');
assert.ok(/^\d+$/.test(String(options.repeat)) && +options.repeat >= 1 && +options.repeat <= 20, '--repeat must be 1..20');
assert.match(options.output, /^[a-z0-9-]+\.json$/, '--output must be a JSON filename under test/out');
assert.ok(options['cpu-throttle'] === undefined || (Number.isFinite(+options['cpu-throttle']) && +options['cpu-throttle'] >= 1 && +options['cpu-throttle'] <= 20), '--cpu-throttle must be 1..20');
const networkProfile = parseNetwork(options.net);
assert.ok(['listener', 'both'].includes(options['net-target']), '--net-target must be listener or both');
assert.match(options['net-label'], /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/, 'Invalid --net-label');
const activeClients = new Set();
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = options.net ? 180000 : 25000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await pause(100); }
  throw new Error(`Timed out: ${label}`);
}
async function freePort() {
  const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r));
  const p = s.address().port; await new Promise(r => s.close(r)); return p;
}
async function terminate(p) {
  if (!p || p.exitCode !== null) return;
  const done = new Promise(r => p.once('exit', r)); p.kill('SIGKILL'); await done;
}
async function client(base, skew = 0, fixture = null, displacementMs = 0, mix = false) {
  const chrome = findChrome(); if (!chrome) throw new Error('Chrome required');
  const profile = await mkdtemp(join(out, 'chrome-'));
  const proc = spawn(chrome, ['--headless=new', '--no-sandbox', '--no-first-run', '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding', ...(options['mute-audio'] ? ['--mute-audio'] : []), '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'],
    env: !fixture && options['no-audio-device'] ? { ...process.env, PULSE_SERVER: 'unix:/nonexistent/untergrund-pulse', ALSA_CONFIG_PATH: '/dev/null' } : process.env });
  let stderr = ''; proc.stderr.on('data', d => stderr += d);
  let ws;
  const close = async () => {
    activeClients.delete(close);
    ws?.close(); await terminate(proc);
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  activeClients.add(close);
  try {
    const debug = await until(() => /DevTools listening on (ws:\/\/\S+)/.exec(stderr)?.[1], 'Chrome startup');
    const http = debug.replace(/^ws/, 'http').replace(/\/devtools\/browser\/.*/, '');
    const target = await (await fetch(`${http}/json/new?about:blank`, { method: 'PUT' })).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, reject) => { ws.onopen = r; ws.onerror = reject; });
    let id = 0; const pending = new Map();
    ws.onmessage = e => {
      const m = JSON.parse(e.data), p = pending.get(m.id);
      if (p) { pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const i = ++id, timer = setTimeout(() => { pending.delete(i); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      pending.set(i, { resolve, reject, timer }); ws.send(JSON.stringify({ id: i, method, params }));
    });
    const run = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result?.value;
    };
    await send('Page.enable');
    if (options['cpu-throttle']) await send('Emulation.setCPUThrottlingRate', { rate: +options['cpu-throttle'] });
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    const cdpProbe = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now(); await run('1+1'); cdpProbe.push(performance.now() - start);
    }
    console.log(`CDP control RTT (unfiltered): ${JSON.stringify(cdpProbe)}ms`);
    if (options.diagnostics) {
      await installDiagnostics(send, base);
      await send('Profiler.enable');
      await send('Profiler.start');
      await send('Performance.enable');
    }
    const graph = mix ? await mixGraphEdges() : null;
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installAudioTap})(${skew}, ${JSON.stringify(fixture)}, ${displacementMs}, ${mix}, ${JSON.stringify(graph)})` });
    if (mix && !realVocal) await installMixStem(send, base, mixSong());
    if (mix && realVocal) {
      await send('Network.setBypassServiceWorker', { bypass: true });
      const receive = ws.onmessage;
      ws.onmessage = async e => {
        receive(e);
        const m = JSON.parse(e.data);
        if (m.method !== 'Fetch.requestPaused') return;
        try {
          await run(`(${loadRealMixStem})(${JSON.stringify(mixSong())})`);
          await send('Fetch.continueRequest', { requestId: m.params.requestId });
        } catch (err) {
          await send('Runtime.evaluate', { expression: `__clubAudio.errors.push(${JSON.stringify('Real stem: ')} + ${JSON.stringify(String(err))})` });
          await send('Fetch.failRequest', { requestId: m.params.requestId, errorReason: 'Failed' });
        }
      };
      await send('Fetch.enable', { patterns: [{ urlPattern: `${base}/js/main.js`, requestStage: 'Request' }] });
    }
    const nav = async path => {
      await send('Page.navigate', { url: base + path });
      await until(() => run('!!document.querySelector(".club-btn, .club-modal, .club-head")'), 'app ready');
      if (mix && realVocal) assert.ok(await run('!!__clubAudio.realStem?.resolved'), 'Real stem loaded before app navigation completes');
    };
    const clickElement = async (expression, label) => {
      const point = await until(() => run(`(() => { const e = ${expression}; if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return r.width && r.height && !e.disabled ? {x:r.x+r.width/2,y:r.y+r.height/2} : null; })()`), label);
      const at = Date.now();
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      return at;
    };
    const click = selector => clickElement(`document.querySelector(${JSON.stringify(selector)})`, selector);
    const clickText = label => clickElement(`[...document.querySelectorAll('.club-shell button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`, label);
    return { run, nav, click, clickText, clickElement, close, send, cdpProbe,
      audioErrors: () => stderr.split('\n').filter(l => /alsa|pulse|audio.*(?:error|fail)|(?:error|fail).*audio/i.test(l)) };
  } catch (e) { await close(); throw e; }
}

function fixture() {
  const s = defaultState();
  s.bpm = BPM; s.swing = 0; s.chainOn = true; s.chain = 'ABCD'; s.current = 0;
  s.solos = { kick: true }; s.mutes = {};
  s.patterns = Array.from({ length: 8 }, (_, b) => {
    const p = emptyPattern();
    for (const [i, step] of KICK_STEPS[b % 4].entries()) p.steps.kick[step] = i === b % 4 ? 2 : 1;
    return p;
  });
  Object.assign(s.master, { arr: 0, vary: 0, humanize: 0, pocket: 0, dust: 0, kit: 0,
    revLevel: 0, dlyLevel: 0, room: 0, warmth: 0, drive: 0 });
  Object.assign(s.params.kick, { decay: .12, rumble: 0, rev: 0, dly: 0, click: 0, drive: 0 });
  return s;
}

async function scenario(base, spec, network, run) {
  const clients = [];
  const contention = [];
  const contentionFile = join(out, 'club-sync-contention.bin');
  let events = {};
  try {
    const song = spec.mix ? mixSong() : fixture();
    if (spec.djLatency) {
      song.chainOn = false;
      song.patterns[0].len.kick = 4;
      song.patterns[0].steps.kick.fill(0);
      song.patterns[0].steps.kick[0] = 1;
    }
    const host = await client(network.base('host'), spec.hostSkew, song, 0, spec.mix); clients.push(host);
    await host.nav('/');
    await host.clickElement(`[...document.querySelectorAll('.tab-club, .club-btn')].find(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height)`, 'visible Club navigation');
    let listener;
    if (!spec.cold) { listener = await client(network.base('listener'), spec.listenerSkew, null, spec.displacementMs, spec.mix); clients.push(listener); await listener.nav('/'); }
    const action = await until(() => host.run(`document.querySelector('.lobby-cta')?.textContent === 'GO LIVE' ? '.lobby-cta' : document.querySelector('.club-primary')?.textContent === 'GO LIVE' ? '.club-primary' : null`), 'GO LIVE');
    await host.click(action);
    const room = await until(() => host.run('new URL(location.href).searchParams.get("room")'), 'Host room invite');
    const broadcast = Date.now();
    if (spec.joinDelay) await pause(spec.joinDelay);
    if (!listener) { listener = await client(network.base('listener'), spec.listenerSkew); clients.push(listener); }
    if (options['startup-contention']) {
      for (let i = 0; i < availableParallelism(); i++) contention.push(spawn(process.execPath,
        ['-e', 'const end=Date.now()+12000;let x=1;while(Date.now()<end){for(let i=0;i<10000;i++)x=Math.sin(x+i)}'], { stdio: 'ignore' }));
      contention.push(spawn(process.execPath, ['-e', `const fs=require('node:fs');const fd=fs.openSync(process.argv[1],'w');const b=Buffer.alloc(1048576,1),end=Date.now()+12000;let n=0;while(Date.now()<end){fs.writeSync(fd,b,0,b.length,(n++%16)*b.length);fs.fsyncSync(fd)}fs.closeSync(fd)`, contentionFile], { stdio: 'ignore' }));
    }
    const navigation = Date.now();
    await listener.nav(`/?room=${encodeURIComponent(room)}`);
    // Chrome's autoplay grant may already unlock and join on invite entry.
    const joined = await until(() => listener.run(`(() => {
      const b = document.querySelector('.club-primary');
      return b?.textContent === 'LISTEN LIVE' ? 'listen' : (__clubAudio.samples.some(r => r[1] > .001) ? 'automatic' : null);
    })()`), 'listener audio or LISTEN LIVE');
    if (joined === 'listen') await listener.click('.club-primary');
    const snapshot = async () => {
      const response = await fetch(`${base}/api/rooms/${room}`);
      assert.ok(response.ok, `Room snapshot HTTP ${response.status}`);
      const r = await response.json();
      return { at: Date.now(), members: r.members.map(m => m.id), hostId: r.hostId, queue: r.queue,
        set: { by: r.currentSet?.by, broadcastId: r.currentSet?.broadcastId, replay: !!r.currentSet?.replay },
        memberSeen: r.members.map(m => ({ id: m.id, seen: m.seen })), startsAt: r.currentSet?.startsAt };
    };
    const initial = await snapshot(); events.initial = initial;
    events.cdpProbeMs = clients.map(c => c.cdpProbe);
    if (spec.djLatency)
      return { name: spec.name, spec, edits: await measureDJEdits(host, listener, initial.startsAt, { until, pause }) };
    const listenerId = await listener.run('sessionStorage.getItem("untergrund.client")');
    if (spec.mainThreadStallMs) {
      const target = initial.startsAt + Math.ceil((Date.now() + 2500 - initial.startsAt) / PERIOD_MS) * PERIOD_MS;
      await (spec.stallDJ ? host : listener).run(`(() => {
        const epoch = () => performance.timeOrigin + performance.now();
        setTimeout(() => {
          const visibility = document.visibilityState, from = epoch();
          while (epoch() - from < ${spec.mainThreadStallMs}) {}
          __clubAudio.mainThreadStall = { from, to: epoch(), visibility };
        }, Math.max(0, ${target - 200} - epoch()));
        return true;
      })()`);
      events.stallTarget = target;
    }
    if (spec.handoff || spec.replay) {
      await pause(7000);
      events.before = await snapshot();
      if (spec.handoff) {
        await listener.clickText('JOIN DJ QUEUE');
        await until(async () => (await snapshot()).queue?.includes(listenerId), 'listener queued on room server');
        events.actionAt = await host.clickText('PASS DECK');
        if (spec.mix) events.interruptAt = events.recoverAt = events.actionAt;
        events.passed = await until(async () => { const s = await snapshot(); return s.hostId === listenerId && s; }, 'deck passed on room server');
        await until(() => listener.run(`[...document.querySelectorAll('.club-secondary')].some(b => b.textContent === 'UPDATE ROOM')`), 'new DJ controls');
        events.broadcastAt = await listener.clickText('UPDATE ROOM');
      } else {
        events.seed = await host.run(`(async () => {
          const {createTimelineRecorder} = await import('/js/set-timeline.js');
          const {publishReplay} = await import('/js/sets.js');
          const rec = createTimelineRecorder({state:${JSON.stringify(fixture())}, style:'hypnotic', startsAt:0,
            dj:'Sync fixture', room:${JSON.stringify(room)}, title:'Club sync replay'});
          const result = await publishReplay({timeline:rec.finish(30000), title:'Club sync replay', artist:'Sync fixture', room:${JSON.stringify(room)}});
          return {id:result.item.id, public:result.public, durationMs:30000};
        })()`);
        if (await host.run('!document.querySelector(".club-social")?.getClientRects().length')) await host.click('.club-view-toggle');
        await host.clickText('REPLAYS');
        events.actionAt = await host.clickText('REPLAY TO ROOM');
      }
      events.newSet = await until(async () => {
        const s = await snapshot();
        return s.set.broadcastId && s.set.broadcastId !== initial.set.broadcastId && s;
      }, 'new set broadcast on room server');
      assert.equal(events.newSet.set.by, spec.handoff ? listenerId : initial.hostId);
      assert.equal(events.newSet.set.replay, !!spec.replay);
      if (spec.replay) assert.ok(events.newSet.startsAt > events.actionAt, 'Fresh future replay origin');
      events.firstDownbeatAt = spec.handoff ? events.newSet.startsAt + Math.ceil((events.broadcastAt - events.newSet.startsAt) / PERIOD_MS) * PERIOD_MS : events.newSet.startsAt;
      const nextBoundary = spec.mix ? mixBoundaries(song, events.newSet.startsAt).find(b => b.at >= events.broadcastAt) : null;
      await pause(Math.max(events.firstDownbeatAt + 22000, nextBoundary ? nextBoundary.at + 4000 : 0) - Date.now());
      events.after = await snapshot();
    } else if (spec.offlineMs || spec.freezeMs) {
      if (spec.mix && spec.freezeMs) {
        events.plannedDrop = mixBoundaries(song, initial.startsAt).find(b => b.section === 'DROP');
        assert.ok(events.plannedDrop.at - 400 > Date.now(), 'Listener ready before drop freeze');
        await pause(events.plannedDrop.at - 400 - Date.now());
      } else await pause(7000);
      const wakeTarget = spec.wakeOnDownbeat
        ? initial.startsAt + Math.ceil((Date.now() + spec.freezeMs + 250 - initial.startsAt) / PERIOD_MS) * PERIOD_MS
        : null;
      if (wakeTarget !== null) {
        events.wakeTarget = wakeTarget;
        await pause(Math.max(0, wakeTarget - Date.now() - spec.freezeMs));
      }
      events.before = await snapshot(); events.interruptAt = Date.now();
      if (spec.offlineMs) {
        await listener.send('Network.setBlockedURLs', { urls: [`${network.base('listener')}/api/rooms*`] });
        await listener.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
        events.offlineProbe = await listener.run(`fetch('/api/rooms/${room}').then(() => 'UNEXPECTED success', () => 'blocked')`);
        assert.equal(events.offlineProbe, 'blocked');
        await pause(spec.offlineMs);
      } else {
        events.visibilityBefore = await listener.run('document.visibilityState');
        await listener.send('Page.setWebLifecycleState', { state: 'frozen' });
        await pause(wakeTarget === null ? spec.freezeMs : Math.max(0, wakeTarget - Date.now() - 250));
      }
      events.during = await snapshot();
      if (wakeTarget !== null) await pause(Math.max(0, wakeTarget - Date.now() - 4));
      events.recoverAt = Date.now();
      if (spec.offlineMs) {
        await listener.send('Network.setBlockedURLs', { urls: [] });
        await listener.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      } else {
        await host.run('__clubAudio.markResume()');
        await listener.send('Page.setWebLifecycleState', { state: 'active' });
        await listener.send('Page.bringToFront');
        events.visibilityAfter = await listener.run('document.visibilityState');
      }
      await pause(spec.mix ? 20000 : 12000);
      events.after = await snapshot();
    } else await pause(22000);
    const raw = await Promise.all(clients.map(c => c.run('({...__clubAudio, clockSkew: Date.now() - (performance.timeOrigin + performance.now())})')));
    if (options.diagnostics) await Promise.all(clients.map(async (c, i) => {
      raw[i].cpuProfile = (await c.send('Profiler.stop')).profile;
      raw[i].browserAudioErrors = c.audioErrors();
      const metrics = await c.send('Performance.getMetrics');
      raw[i].profileClock = { timestamp: metrics.metrics.find(m => m.name === 'Timestamp')?.value,
        epoch: await c.run('performance.timeOrigin + performance.now()') };
    }));
    if (spec.mix) {
      const mix = analyzeMix(raw, song, events, initial.startsAt, { resume: !!spec.freezeMs });
      const failures = mixFailures(mix, realVocal);
      const reference = await host.run(`(${referenceEnvelope})(${JSON.stringify(song)}, ${10 ** (vocalDb(song) / 20)})`);
      const vocalGrid = analyzeVocalGrid(raw, song, reference, events, initial.startsAt, !!spec.freezeMs);
      const findings = vocalFindings(vocalGrid);
      const clips = options.clips || failures.length || findings.length
        ? await saveClips(clients, song, spec.name, run, events, initial.startsAt,
          Math.min(...raw.map(r => channelEnvelope(r, 'vocal').at(-1)[0])) - 200) : null;
      console.table(vocalGrid.map((client, i) => ({ scenario: spec.name, mode: options.vocal, run, client: i ? 'listener' : 'host',
        beforeMs: client.before.vocalVsKick?.medianMs, afterMs: client.after.vocalVsKick?.medianMs,
        beforeP95Ms: client.before.vocalVsKick?.p95AbsMs, afterP95Ms: client.after.vocalVsKick?.p95AbsMs, gaps: client.after.gaps?.count, gapTotalMs: client.after.gaps?.totalMs,
        gapLongestMs: client.after.gaps?.longestMs, missing: client.after.phrases?.missing, displaced: client.after.phrases?.displaced,
        doubled: client.after.phrases?.doubled, replays: client.after.phrases?.replays.length,
        vocalRecoveryMs: client.after.recoveryMs, kickRecoveryMs: mix.timeToRealignMs })));
      if (realVocal) {
        console.log(`  real stems: ${JSON.stringify(mix.realStems)}`);
        assert.ok(!failures.includes('real stem not loaded/played through API'), 'Every client loaded and played singSong API audio');
      }
      const diagnostics = options.diagnostics ? diagnose(raw, initial.startsAt) : null;
      if (diagnostics) assert.ok(diagnostics.every(d => d.roomClock?.best && d.starts.length && d.schedulerSamples >= 5), 'Diagnostic breakpoints captured both app paths');
      console.log(`${spec.name}: ${spec.offlineMs ? `offline ${spec.offlineMs}ms` : spec.handoff ? 'PASS DECK → new DJ UPDATE ROOM' : 'frozen → wake'}; realign=${mix.timeToRealignMs}ms / budget=${mix.budgetMs}ms`);
      for (const [name, p] of Object.entries(mix.phases)) {
        console.log(`  ${name}: ${JSON.stringify({
          kicks:{...p.kicks, pairs:undefined, hostOnsets:undefined, listenerOnsets:undefined}, vocal:{...p.vocal, pairs:undefined}})}`);
        for (const [i, stats] of p.attribution.clients.entries())
          console.log(`  underruns ${name.toUpperCase()} ${['host', 'listener'][i]}: ${stats.countDelta === null ? 'unavailable' : `+${stats.countDelta} / ${stats.durationDeltaMs.toFixed(1)}ms (sampled)`}`);
        const point = p => `${p.onset === null ? 'missing@' : ''}${(p.referenceAt - initial.startsAt).toFixed(1)}ms start=${p.nearestStart?.when.toFixed(6) ?? 'none'} submit=${p.nearestStart?.submitContextTime.toFixed(6) ?? 'none'} overlap=${p.underrunOverlap === null ? 'unknown' : p.underrunOverlap ? 'yes' : 'no'}`;
        for (const pair of p.attribution.pairs)
          console.log(`  kick evidence ${name.toUpperCase()} ${pair.kind}${pair.deltaMs === null ? '' : ` Δ=${pair.deltaMs.toFixed(1)}ms`}: host[${point(pair.host)}] listener[${point(pair.listener)}]`);
      }
      for (const b of mix.boundaries) console.log(`  boundary: ${JSON.stringify(b)}`);
      console.log(`  summary: ${JSON.stringify({ missing:mix.phases.after.kicks.missing, extra:mix.phases.after.kicks.extra,
        medianMs:mix.phases.after.kicks.median, maxMs:mix.phases.after.kicks.max, recoveryMs:mix.timeToRealignMs,
        vocalVsKickMs:mix.phases.after.vocal.relativeToKickMs, boundaries:mix.boundaries.map(b => ({bar:b.bar, correctSection:b.correctSection, deltaMs:b.deltaMs})), failures })}`);
      if (diagnostics) console.log(`  diagnostics: ${JSON.stringify(diagnostics)}`);
      console.log(`  mix thresholds: ${failures.length ? 'FAIL: ' + failures.join(', ') : 'PASS'}`);
      return { name:spec.name, spec, mix, events, failures, diagnostics, raw:{captures:raw},
        vocalGrid, vocalFindings: findings, clips, gridReference: { sampleZeroEpochMs: initial.startsAt, bpm: song.bpm,
          processedStem: true, envelope: reference, updatedSetSampleZeroEpochMs: events.newSet?.startsAt ?? null },
        ...(realVocal ? { vocalTimeline: { sampleZeroEpochMs: initial.startsAt, sampleZeroGridSeconds: 0, bpm: song.bpm,
          updatedSetSampleZeroEpochMs: events.newSet?.startsAt ?? null } } : {}),
        ...mix.phases.after.kicks, hostFixture:{missing:null, measured:false}, phases:{after:mix.phases.after.kicks} };
    }
    const [he, le] = raw.map(r => envelope(r)), [ho, lo] = [he, le].map(e => onsets(e, BPM));
    assert.ok(ho.length > 10 && lo.length > 10, 'Enough detected rendered kicks');
    const start = Math.max(he[0][0], le[0][0], ho[0], lo[0], events.newSet ? events.broadcastAt ?? events.newSet.startsAt : 0) + 500;
    const end = Math.min(he.at(-1)[0], le.at(-1)[0]) - 100;
    if (spec.mainThreadStallMs) {
      const { mainThreadStall: stall, anchors } = raw[spec.stallDJ ? 0 : 1];
      assert.ok(stall && stall.visibility === 'visible' && stall.from < events.stallTarget && stall.to > events.stallTarget,
        'Foreground main-thread stall straddled the intended downbeat');
      assert.ok(stall.from >= start && stall.to <= end, 'Stall was inside the capture window');
      const before = anchors.findLast(([, wall]) => wall <= stall.from);
      const after = anchors.find(([, wall]) => wall >= stall.to);
      assert.ok(before && after && Math.abs((after[0] - before[0]) * 1000 - (after[1] - before[1])) < 100,
        'Audio clock kept running during the foreground stall');
      events.mainThreadStall = stall;
    }
    const stats = resolvedCompare(he, le, start, end);
    const hostFixture = fixtureMissing(he, events.newSet?.startsAt ?? initial.startsAt, start, end);
    const self = resolvedCompare(he, he, start, end);
    assert.equal(self.max, 0);
    const phases = {};
    let transition;
    if (events.newSet) {
      const rendered = [he, le].map(e => transitionAudio(e, events.actionAt, events.firstDownbeatAt));
      const first = resolvedCompare(he, le, Math.max(events.broadcastAt ?? events.actionAt, events.newSet.startsAt - 50), end).pairs.find(p => Math.abs(p.delta) <= 50);
      const firstDownbeatDeltaMs = rendered.every(r => r.firstDownbeat !== null) ? rendered[1].firstDownbeat - rendered[0].firstDownbeat : null;
      transition = { actionAt: events.actionAt, startsAt: events.newSet.startsAt, firstDownbeatAt: events.firstDownbeatAt, host: rendered[0], listener: rendered[1],
        firstDownbeatDeltaMs, actionToFirstAlignedKickMs: first ? Math.max(first.host, first.listener) - events.actionAt : null };
      console.log(`${spec.name}: ${spec.handoff ? 'PASS DECK → new DJ UPDATE ROOM (running origin preserved; next ABCD downbeat)' : 'seeded saved timeline → REPLAYS → REPLAY TO ROOM'}; first downbeat host/listener=${rendered.map(r => r.firstDownbeat?.toFixed(1) ?? 'none').join('/')} true epoch ms; Δ=${firstDownbeatDeltaMs?.toFixed(2) ?? 'none'}ms; action→aligned=${transition.actionToFirstAlignedKickMs?.toFixed(0) ?? 'none'}ms`);
      for (const [i, name] of ['original host', 'original listener'].entries()) console.log(`  ${name}: action→first kick=${rendered[i].actionToFirstKickMs?.toFixed(0) ?? 'none'}ms; inter-kick gap across action=${rendered[i].interKickGapAcrossActionMs?.toFixed(0) ?? 'none'}ms; silence before new downbeat=${rendered[i].silenceBeforeFirstDownbeatMs?.toFixed(0) ?? 'none'}ms; longest transition silence=${rendered[i].longestSilenceAroundTransitionMs?.toFixed(0) ?? 'none'}ms`);
    }
    if (events.recoverAt) {
      const recoveryEnvelopes = spec.freezeMs ? raw.map(r => postResumeEnvelope(r)) : [he, le];
      const recoveryHostOnsets = onsets(recoveryEnvelopes[0], BPM);
      for (const [name, from, to] of [['before', start, events.interruptAt], ['during', events.interruptAt, events.recoverAt], ['after', events.recoverAt, end]]) {
        const rows = name === 'after' ? recoveryEnvelopes : [he, le];
        phases[name] = resolvedCompare(...rows, from, to);
      }
      // Freeze must not shorten the analysis window to the last audible kick.
      const after = phases.after;
      if (spec.wakeOnDownbeat) {
        const resumeAt = raw[1].resumeBoundary.at;
        assert.ok(Math.abs(resumeAt - events.wakeTarget) <= 35, 'AudioContext resumed near the target fixture downbeat');
        const hostDownbeat = recoveryHostOnsets.find(t => t >= events.wakeTarget && t < events.wakeTarget + 150);
        assert.ok(hostDownbeat !== undefined, 'Host rendered the target downbeat');
        const first = after.pairs.find(p => p.host === hostDownbeat);
        events.wakeDownbeatDeltaMs = first?.delta ?? null;
        console.log(`  first downbeat: host rendered ${(hostDownbeat - resumeAt).toFixed(1)}ms after resume, listener delta=${first?.delta.toFixed(1) ?? 'MISSING'}ms`);
      }
      let streak = 0;
      for (const p of after.pairs) {
        const previous = after.pairs[after.pairs.indexOf(p) - 1];
        const contiguous = !previous || !recoveryHostOnsets.some(t => t > previous.host + 1 && t < p.host - 1);
        streak = Math.abs(p.delta) <= 50 && contiguous ? streak + 1 : Math.abs(p.delta) <= 50 ? 1 : 0;
        if (streak >= 3) { events.timeToRealignMs = p.listener - events.recoverAt; break; }
      }
      events.timeToRealignMs ??= null;
      events.listenerPresent = Object.fromEntries(['before', 'during', 'after'].map(k => [k, events[k].members.includes(listenerId)]));
      events.failedRoomRequests = raw[1].requests.filter(r => r.error && r.start >= events.interruptAt && r.start <= events.recoverAt).length;
      console.log(`${spec.name}: ${spec.offlineMs ? `offline+room URL block ${spec.offlineMs}ms` : `Page frozen→active ${spec.freezeMs}ms (desktop lifecycle, not phone)`}; presence=${JSON.stringify(events.listenerPresent)}; failed room requests=${events.failedRoomRequests}; realign=${events.timeToRealignMs?.toFixed(0) ?? 'none'}ms`);
      for (const [name, p] of Object.entries(phases)) console.log(`  ${name}: lag=${p.signedLagMs === null ? 'none' : p.signedLagMs + 'ms'} median=${p.median === null ? 'none' : p.median.toFixed(2) + 'ms'} p95=${p.p95 === null ? 'none' : p.p95.toFixed(2) + 'ms'} missing=${p.missing}/${p.expected} extra=${p.extra}; longest missing run=${Math.max(0, ...p.gaps.map(g => g.durationMs)).toFixed(0)}ms`);
      if (spec.freezeMs) {
        console.log(`  visibility ${events.visibilityBefore}→${events.visibilityAfter}; lifecycle=${raw[1].lifecycle.map(e => e.name + ':' + e.visibility).join(', ')}`);
        console.log(`  resume PCM boundary host/listener: ${raw.map(r => `${r.resumeBoundary.contextTime.toFixed(6)}s (frame ${r.resumeBoundary.frame})`).join(' / ')}`);
      }
    }
    let injectedEvidence;
    if (spec.displacementMs) {
      injectedEvidence = { injectedMs: spec.displacementMs, measuredMs: stats.signedLagMs, errorMs: stats.signedLagMs - spec.displacementMs };
      assert.ok(Math.abs(injectedEvidence.errorMs) <= 50, `Unaliased browser displacement: ${JSON.stringify(injectedEvidence)}`);
      console.log(`Browser displacement PROVED: destination DelayNode +${spec.displacementMs}ms BEFORE PCM tap → resolved ${stats.signedLagMs}ms (not nearest-kick phase).`);
    }
    // Assign first entry kicks using the globally resolved pattern, not local phase.
    const entry = resolvedCompare(he, le, Math.max(he[0][0], le[0][0]), end);
    const aligned = entry.pairs.find(p => Math.abs(p.delta) <= 50)?.listener;
    console.log(`${spec.name}: detector self=${self.max}ms; resolved lag=${stats.signedLagMs}ms; skew host/listener=${raw.map(r => Math.round(r.clockSkew)).join('/')}ms; join=${joined}`);
    const diagnostics = options.diagnostics ? diagnose(raw, initial.startsAt) : null;
    if (diagnostics) {
      const ms = value => Number.isFinite(value) ? value.toFixed(2) : 'unavailable';
      assert.ok(diagnostics.every(d => d.roomClock?.best && d.starts.length && d.schedulerSamples >= 5), 'Diagnostic breakpoints captured both app paths');
      console.log(`  diagnostics host/listener: clock shift=${diagnostics.map(d => ms(d.roomClock.shiftMs)).join('/')}ms; origin−server=${diagnostics.map(d => ms(d.originMinusServerMs)).join('/')}ms; scheduled output offset=${diagnostics.map(d => ms(d.scheduledOutputOffsetMs)).join('/')}ms; output clock lead=${diagnostics.map(d => ms(d.outputClockLeadMs)).join('/')}ms; smoothing residual=${diagnostics.map(d => ms(d.smoothingResidualMs)).join('/')}ms; tolerance residual=${diagnostics.map(d => ms(d.toleranceResidualMs)).join('/')}ms`);
    }
    return { name: spec.name, ...stats, hostFixture, phases, events, transition, diagnostics, injectedEvidence, navigationToFirstKickMs: lo[0] - navigation,
      navigationToFirstAlignedKickMs: aligned ? aligned - navigation : null, broadcast, navigation,
      detected: { host: ho.length, listener: lo.length }, detectorValidation: { selfMaxMs: self.max },
      spec, join: joined, raw: { captures: raw, hostOnsets: ho, listenerOnsets: lo } };
  } catch (error) {
    console.error(`${spec.name}: ${error.stack || error}`);
    events.cdpProbeMs = clients.map(c => c.cdpProbe);
    const captures = await Promise.all(clients.map(c => c.run('({...__clubAudio})').catch(() => ({}))));
    return { name:spec.name, spec, events, error:String(error.stack || error), raw:{captures} };
  } finally {
    await Promise.all([...clients.map(c => c.close()), ...contention.map(terminate)]);
    if (options['startup-contention']) await rm(contentionFile, { force: true });
  }
}

async function saveClips(clients, song, name, run, events, origin, afterEnd) {
  const marker = events.recoverAt;
  const { from, to } = clipRange(marker, afterEnd);
  const capture = await Promise.all(clients.map(c => c.run(`(${extractPCM})(${JSON.stringify({ from, to, origin, gain: 10 ** (vocalDb(song) / 20),
    updatedOrigin: events.newSet?.startsAt ?? origin, ...(events.broadcastAt ? {updateAt:events.broadcastAt} : {}) })})`)));
  const decode = value => { const b = Buffer.from(value.pcm, 'base64'); return Float32Array.from(new Float32Array(b.buffer, b.byteOffset, b.length / 4)); };
  const audio = { host: decode(capture[0].vocal), listener: decode(capture[1].vocal), expected: decode(capture[0].expected),
    'host-mix': decode(capture[0].mix), 'listener-mix': decode(capture[1].mix) };
  const matching = levelMatchClips(audio, capture[0].sampleRate);
  await mkdir(join(out, 'clips'), { recursive: true });
  const paths = {};
  for (const [role, samples] of Object.entries(audio)) {
    const path = `clips/${name}-${options.vocal}-${run}-${role}.wav`;
    await writeFile(join(out, path), floatWav(samples, capture[0].sampleRate)); paths[role] = path;
  }
  return { fromEpochMs: from, toEpochMs: to, markerOffsetMs: 4000, sampleRate: capture[0].sampleRate,
    coverage: capture.map(c => ({ vocal:c.vocal.coverage, mix:c.mix.coverage, nativeSampleRate:c.vocal.nativeSampleRate })), matching, paths };
}

await mkdir(out, { recursive: true });
const port = await freePort(), base = `http://localhost:${port}`;
const env = { ...process.env, SC_MOCK: '1', PORT: String(port), DATA_FILE: join(out, 'club-sync-kv.json') };
for (const k of Object.keys(env)) if (/REDIS|KV_REST|ROOMS_API_URL/.test(k)) delete env[k];
const python = process.env.SINGER_PYTHON || join(process.env.HOME, 'singer-investigation-venv/bin/python');
let singer = null, singerLog = '', vocalGroundTruth = null;
if (realVocal) {
  env.SINGER_URL = `http://127.0.0.1:${await freePort()}`;
  env.SINGER_SECRET = randomBytes(24).toString('hex');
}
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
const results = [];
let error = null;
let network;
let stopping = false;
const stop = async signal => {
  if (stopping) return;
  stopping = true;
  try { await network?.close(); } finally {
    await Promise.all([...activeClients].map(close => close()));
    await terminate(server); process.exit(signal === 'SIGINT' ? 130 : 143);
  }
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, () => { void stop(signal); });
function failed(r) {
  if (r.error) return true;
  if (r.spec.djLatency) return r.edits.missed > 0;
  if (r.spec.mix) return r.failures.length > 0;
  if (r.spec.displacementMs) return !r.injectedEvidence || Math.abs(r.injectedEvidence.errorMs) > 50;
  const s = r.phases.after || r;
  return s.median === null || s.median > 25 || s.p95 > 50 || !s.matched || s.missing ||
    ((r.spec.freezeMs || r.spec.mainThreadStallMs) && s.extra) || r.hostFixture.missing ||
    (r.spec.wakeOnDownbeat && (r.events.wakeDownbeatDeltaMs === null || Math.abs(r.events.wakeDownbeatDeltaMs) > 50)) ||
    (r.transition && (r.transition.firstDownbeatDeltaMs === null || Math.abs(r.transition.firstDownbeatDeltaMs) > 50 || r.transition.actionToFirstAlignedKickMs === null));
}
try {
  if (realVocal) {
    singer = spawn(python, ['test/club-sync-singer.py', '--port', new URL(env.SINGER_URL).port, '--cache', join(out, 'singer-cache')],
      { cwd: root, env: { ...process.env, SINGER_SECRET: env.SINGER_SECRET, SCYLLASBAND_NO_BOOTSTRAP: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    singer.on('error', err => { singerLog += String(err); });
    singer.stdout.on('data', d => singerLog += d); singer.stderr.on('data', d => singerLog += d);
    await until(async () => {
      if (singer.exitCode !== null || singerLog.includes('ENOENT')) throw new Error(`Singer startup failed: ${singerLog}`);
      try { return (await fetch(`${env.SINGER_URL}/health`)).ok; } catch { return false; }
    }, 'CPU singer health', 15 * 60e3);
  }
  await until(async () => { try { return (await fetch(base)).ok; } catch { return false; } }, 'server');
  network = await networkController(port, networkProfile, options['net-target'], options['net-label']);
  if (realVocal) {
    const request = singRequest(mixSong(), 'opus');
    assert.ok(request, 'Real fixture has a singable score');
    const post = body => fetch(`${base}/api/sing`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let response = await post(request), hash;
    const deadline = Date.now() + 15 * 60e3;
    while (response.status === 202) {
      const job = await response.json(); hash = job.hash;
      assert.ok(Date.now() < deadline, 'Singer prewarm timed out');
      await pause(1000); response = await post({ job: job.job, hash });
    }
    assert.ok(response.ok && response.headers.get('content-type')?.startsWith('audio/'), `Singer prewarm HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const stem = options.output.replace(/\.json$/, '-stem');
    await writeFile(join(out, `${stem}.ogg`), bytes);
    const convert = spawn(python, ['-c', 'import soundfile as s,sys; x,r=s.read(sys.argv[1]); s.write(sys.argv[2],x,r,subtype="PCM_16")', join(out, `${stem}.ogg`), join(out, `${stem}.wav`)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let conversionLog = ''; convert.stderr.on('data', d => conversionLog += d);
    await new Promise((resolve, reject) => { convert.on('error', reject); convert.on('exit', code => code === 0 ? resolve() : reject(new Error(conversionLog))); });
    vocalGroundTruth = { request, hash, encodedSha256: createHash('sha256').update(bytes).digest('hex'),
      wav: `${stem}.wav`, encoded: `${stem}.ogg`, wavSource: 'decoded API Opus response, PCM_16',
      bpm: request.score.bpm, sampleZeroBar: 0, sampleZeroGridSeconds: 0, timingTrimMs: 0 };
    console.log(`Real singer prewarmed once: ${JSON.stringify({ hash, wav: vocalGroundTruth.wav, bpm: request.score.bpm })}`);
  }
  console.log(`Club sync: isolated Chrome processes; memory rooms; dry irregular ABCD kicks or seed-7 full-mix ${realVocal ? 'neural pop' : options.vocal === 'synthetic-pop' ? 'synthetic pop' : 'hypnotic sketch'} / 123 BPM.`);
  console.log('PCM destination tap → 180Hz low-pass RMS; getOutputTimestamp + true performance.timeOrigin.');
  console.log('Dry: signed lag resolved across ±3900ms; 7s baseline + interruption + 12s recovery. Mix: isolated rendered kick/vocal graph taps, drop−400ms freeze + 20s recovery; PCM resume boundaries for wakes.');
  for (const spec of SCENARIOS.filter(s => !selectedScenarios || selectedScenarios.includes(s.name))) {
    for (let run = 1; run <= +options.repeat; run++) {
      console.log(`Running ${spec.name}${+options.repeat > 1 ? ` (${run}/${options.repeat})` : ''}…`);
      const result = { ...await scenario(base, spec, network, run), run,
        network:{profile:networkProfile, target:options['net-target'], label:options['net-label']} };
      result.outputClockSpread = (result.raw?.captures || []).map(clockSpread);
      result.failed = !!failed(result);
      console.log(`Output clock spread: ${JSON.stringify(result.outputClockSpread)}`);
      results.push(result);
    }
  }
  console.table(results.filter(r => !r.spec.djLatency && !r.error).map(r => ({ scenario: r.name, 'median |Δ| ms': r.median?.toFixed(2), 'p95 ms': r.p95?.toFixed(2),
    'max ms': r.max?.toFixed(2), matched: r.matched, missing: `${r.hostFixture.missing}/${r.missing}`,
    'signed lag ms': r.signedLagMs, 'entry→aligned ms': r.navigationToFirstAlignedKickMs?.toFixed(0) })));
  console.log('Detector validation: empty audio has no onsets; empty comparison cannot pass.');
  assert.deepEqual(onsets([], BPM), []); assert.equal(resolvedCompare([], [], 0, 10000).median, null);
  assert.throws(() => envelope({ errors: ['unsupported route'], anchors: [], samples: [] }), /unsupported route/);
  const failures = results.filter(failed);
  console.log(`Thresholds: median ≤25ms, p95 ≤50ms, missing=0 (recovery scenarios: AFTER window; injected-offset: |lag−2000|≤50ms): ${failures.length ? 'FAIL: ' + failures.map(r => r.name).join(', ') : 'PASS'}`);
  if (results.some(r => r.error) || (options.assert && failures.length)) process.exitCode = 1;
} catch (e) { error = String(e.stack || e); console.error(e); process.exitCode = 1; }
finally {
  try {
    const metadata = network?.metadata || {label:options['net-label'], target:options['net-target'], profile:networkProfile};
    metadata.cdpProbes = results.map(r => ({name:r.name, run:r.run, clientsMs:r.events?.cdpProbeMs || []}));
    metadata.finalQdisc = network?.counters();
    await writeFile(join(out, options.output), JSON.stringify({ generatedAt: new Date().toISOString(), options, network:metadata, error, results, serverLog, singerLog, vocalGroundTruth }, null, 2));
    console.log(`JSON: test/out/${options.output}`);
    if (results.some(r => r.failed)) {
      try { console.log(execFileSync('python3', [join(root, 'test/club-sync-plot.py'), join(out, options.output)], {encoding:'utf8'})); }
      catch (plotError) { console.error('Failure plots unavailable:', String(plotError)); process.exitCode = 1; }
    }
  } finally {
    await network?.close();
    await terminate(server);
    await terminate(singer);
    await rm(join(out, 'club-sync-kv.json'), { force: true });
  }
}
