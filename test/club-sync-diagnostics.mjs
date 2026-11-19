import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// False conditional breakpoints observe module locals without changing app sources or pausing.
export async function installDiagnostics(send, base) {
  await send('Debugger.enable');
  const at = async (file, marker, body) => {
    const source = await readFile(new URL(`../js/${file}`, import.meta.url), 'utf8');
    const lineNumber = source.split('\n').findIndex(l => l.includes(marker));
    assert.ok(lineNumber >= 0, `Diagnostic marker missing: ${file}: ${marker}`);
    await send('Debugger.setBreakpointByUrl', { url: `${base}/js/${file}`, lineNumber,
      condition: `(() => { if (!globalThis.__clubAudio) return false; ${body}; return false; })()` });
  };
  const clock = `const a = __clubAudio.roomClocks ||= []; if (!a.length || a.at(-1).best?.at !== best?.at)
    a.push({at:performance.timeOrigin + performance.now(), best:best ? {...best} : null,
      shiftMs:best ? monotonic() + best.offset - wall() : 0})`;
  await at('room-sync.js', 'return best ? monotonic()', clock);
  await at('main.js', 'if (!seeking) engine.recLock', `(__clubAudio.starts ||= []).push({at:performance.timeOrigin + performance.now(),
    step:abs, delay, nextTime, transportOrigin, contextTime:ctx.currentTime})`);
  await at('main.js', 'while (nextTime < ctx.currentTime +', `const a = __clubAudio.scheduler ||= [];
    if (!a.length || performance.now() - a.at(-1).monotonic >= 1000)
      a.push({at:performance.timeOrigin + performance.now(), monotonic:performance.now(), abs, base, nextTime,
        transportOrigin, clockOffset, wallOffset:offset, contextTime:ctx.currentTime,
        baseLatency:ctx.baseLatency, outputLatency:ctx.outputLatency, output:ctx.getOutputTimestamp()})`);
}

const median = values => {
  const a = values.filter(Number.isFinite).sort((a, b) => a - b);
  return a.length ? a[Math.floor(a.length / 2)] : null;
};

export function diagnose(captures, serverOrigin) {
  return captures.map(c => {
    const sched = (c.scheduler || []).filter(r => r.output.contextTime > 0 && r.at > serverOrigin + 3000);
    const mapped = r => r.at - r.monotonic + r.output.performanceTime + (r.nextTime - r.output.contextTime) * 1000;
    return { roomClock: c.roomClocks?.at(-1) ?? null,
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
