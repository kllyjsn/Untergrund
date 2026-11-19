// Real app, separate OS browser processes, HTTP rooms, rendered PCM only.
// Extend SCENARIOS rather than adding app test hooks. Node >=22 required.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
import { mixFixture, mixBoundaries, mixGraphEdges, installMixStem, analyzeMix, mixFailures } from './club-sync-mix.mjs';

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
const options = { repeat: 1, output: 'club-sync.json' };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--assert' || arg === '--diagnostics') options[arg.slice(2)] = true;
  else if (['--scenario', '--repeat', '--output'].includes(arg) && args[i + 1]) options[arg.slice(2)] = args[++i];
  else throw new Error(`Unknown/missing argument: ${arg}`);
}
const selected = options.scenario;
assert.ok(!selected || SCENARIOS.some(s => s.name === selected), 'Unknown scenario');
assert.ok(/^\d+$/.test(String(options.repeat)) && +options.repeat >= 1 && +options.repeat <= 20, '--repeat must be 1..20');
assert.match(options.output, /^[a-z0-9-]+\.json$/, '--output must be a JSON filename under test/out');
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, label, timeout = 25000) {
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
    '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; proc.stderr.on('data', d => stderr += d);
  let ws;
  const close = async () => {
    ws?.close(); await terminate(proc);
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
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
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    if (options.diagnostics) {
      await installDiagnostics(send, base);
      await send('Profiler.enable');
      await send('Profiler.start');
    }
    const graph = mix ? await mixGraphEdges() : null;
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installAudioTap})(${skew}, ${JSON.stringify(fixture)}, ${displacementMs}, ${mix}, ${JSON.stringify(graph)})` });
    if (mix) await installMixStem(send, base, mixFixture());
    const nav = async path => { await send('Page.navigate', { url: base + path }); await until(() => run('!!document.querySelector(".club-btn, .club-modal, .club-head")'), 'app ready'); };
    const clickElement = async (expression, label) => {
      const point = await until(() => run(`(() => { const e = ${expression}; if (!e) return null; e.scrollIntoView({block:'center'}); const r = e.getBoundingClientRect(); return r.width && r.height && !e.disabled ? {x:r.x+r.width/2,y:r.y+r.height/2} : null; })()`), label);
      const at = Date.now();
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
      return at;
    };
    const click = selector => clickElement(`document.querySelector(${JSON.stringify(selector)})`, selector);
    const clickText = label => clickElement(`[...document.querySelectorAll('.club-shell button')].find(b => b.textContent.trim() === ${JSON.stringify(label)})`, label);
    return { run, nav, click, clickText, clickElement, close, send };
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

async function scenario(base, spec) {
  const clients = [];
  try {
    const song = spec.mix ? mixFixture() : fixture();
    if (spec.djLatency) {
      song.chainOn = false;
      song.patterns[0].len.kick = 4;
      song.patterns[0].steps.kick.fill(0);
      song.patterns[0].steps.kick[0] = 1;
    }
    const host = await client(base, spec.hostSkew, song, 0, spec.mix); clients.push(host);
    await host.nav('/');
    await host.clickElement(`[...document.querySelectorAll('.tab-club, .club-btn')].find(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height)`, 'visible Club navigation');
    let listener;
    if (!spec.cold) { listener = await client(base, spec.listenerSkew, null, spec.displacementMs, spec.mix); clients.push(listener); await listener.nav('/'); }
    const action = await until(() => host.run(`document.querySelector('.lobby-cta')?.textContent === 'GO LIVE' ? '.lobby-cta' : document.querySelector('.club-primary')?.textContent === 'GO LIVE' ? '.club-primary' : null`), 'GO LIVE');
    await host.click(action);
    const room = await until(() => host.run('new URL(location.href).searchParams.get("room")'), 'Host room invite');
    const broadcast = Date.now();
    if (spec.joinDelay) await pause(spec.joinDelay);
    if (!listener) { listener = await client(base, spec.listenerSkew); clients.push(listener); }
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
    const initial = await snapshot(), events = { initial };
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
        await listener.send('Network.setBlockedURLs', { urls: [`${base}/api/rooms*`] });
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
    }));
    if (spec.mix) {
      const mix = analyzeMix(raw, song, events, initial.startsAt, { resume: !!spec.freezeMs });
      const failures = mixFailures(mix);
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
  } finally { await Promise.all(clients.map(c => c.close())); }
}

await mkdir(out, { recursive: true });
const port = await freePort(), base = `http://localhost:${port}`;
const env = { ...process.env, SC_MOCK: '1', PORT: String(port), DATA_FILE: join(out, 'club-sync-kv.json') };
for (const k of Object.keys(env)) if (/REDIS|KV_REST|ROOMS_API_URL/.test(k)) delete env[k];
const server = spawn(process.execPath, ['server.mjs'], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', d => serverLog += d); server.stderr.on('data', d => serverLog += d);
const results = [];
let error = null;
try {
  await until(async () => { try { return (await fetch(base)).ok; } catch { return false; } }, 'server');
  console.log('Club sync: isolated Chrome processes; memory rooms; dry irregular ABCD kicks or seed-7 full-mix hypnotic sketch / 123 BPM.');
  console.log('PCM destination tap → 180Hz low-pass RMS; getOutputTimestamp + true performance.timeOrigin.');
  console.log('Dry: signed lag resolved across ±3900ms; 7s baseline + interruption + 12s recovery. Mix: isolated rendered kick/vocal graph taps, drop−400ms freeze + 20s recovery; PCM resume boundaries for wakes.');
  for (const spec of SCENARIOS.filter(s => !selected || s.name === selected)) {
    for (let run = 1; run <= +options.repeat; run++) {
      console.log(`Running ${spec.name}${+options.repeat > 1 ? ` (${run}/${options.repeat})` : ''}…`);
      results.push({ ...await scenario(base, spec), run });
    }
  }
  console.table(results.filter(r => !r.spec.djLatency).map(r => ({ scenario: r.name, 'median |Δ| ms': r.median?.toFixed(2), 'p95 ms': r.p95?.toFixed(2),
    'max ms': r.max?.toFixed(2), matched: r.matched, missing: `${r.hostFixture.missing}/${r.missing}`,
    'signed lag ms': r.signedLagMs, 'entry→aligned ms': r.navigationToFirstAlignedKickMs?.toFixed(0) })));
  console.log('Detector validation: empty audio has no onsets; empty comparison cannot pass.');
  assert.deepEqual(onsets([], BPM), []); assert.equal(resolvedCompare([], [], 0, 10000).median, null);
  assert.throws(() => envelope({ errors: ['unsupported route'], anchors: [], samples: [] }), /unsupported route/);
  const failures = results.filter(r => {
    if (r.spec.djLatency) return r.edits.missed > 0;
    if (r.spec.mix) return r.failures.length;
    if (r.spec.displacementMs) return !r.injectedEvidence || Math.abs(r.injectedEvidence.errorMs) > 50;
    const s = r.phases.after || r;
    return s.median === null || s.median > 25 || s.p95 > 50 || !s.matched || s.missing ||
      ((r.spec.freezeMs || r.spec.mainThreadStallMs) && s.extra) || r.hostFixture.missing ||
      (r.spec.wakeOnDownbeat && (r.events.wakeDownbeatDeltaMs === null || Math.abs(r.events.wakeDownbeatDeltaMs) > 50)) ||
      (r.transition && (r.transition.firstDownbeatDeltaMs === null || Math.abs(r.transition.firstDownbeatDeltaMs) > 50 || r.transition.actionToFirstAlignedKickMs === null));
  });
  console.log(`Thresholds: median ≤25ms, p95 ≤50ms, missing=0 (recovery scenarios: AFTER window; injected-offset: |lag−2000|≤50ms): ${failures.length ? 'FAIL: ' + failures.map(r => r.name).join(', ') : 'PASS'}`);
  if (options.assert && failures.length) process.exitCode = 1;
} catch (e) { error = String(e.stack || e); console.error(e); process.exitCode = 1; }
finally {
  await writeFile(join(out, options.output), JSON.stringify({ generatedAt: new Date().toISOString(), options, error, results, serverLog }, null, 2));
  console.log(`JSON: test/out/${options.output}`);
  await terminate(server);
  await rm(join(out, 'club-sync-kv.json'), { force: true });
}
