import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { onsets } from './club-sync-audio.mjs';
import { channelEnvelope, firstMixDownbeat } from './club-sync-mix.mjs';

const rate = 48000, framesPerRow = 128, bytesPerFrame = 8;
const epoch = () => performance.timeOrigin + performance.now();

function wave(pcm) {
  const header = Buffer.alloc(68);
  header.write('RIFF', 0); header.writeUInt32LE(60 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(40, 16); header.writeUInt16LE(0xfffe, 20); header.writeUInt16LE(4, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * bytesPerFrame, 28);
  header.writeUInt16LE(bytesPerFrame, 32); header.writeUInt16LE(16, 34);
  header.writeUInt16LE(22, 36); header.writeUInt16LE(16, 38); header.writeUInt32LE(0x33, 40);
  Buffer.from('0100000000001000800000aa00389b71', 'hex').copy(header, 44);
  header.write('data', 60); header.writeUInt32LE(pcm.length, 64);
  return Buffer.concat([header, pcm]);
}

export function outputOnsets(pcm, bpm, order) {
  const rows = [[], []], low = [0, 0];
  const alpha = 1 - Math.exp(-2 * Math.PI * 180 / rate);
  for (let offset = 0; offset + framesPerRow * bytesPerFrame <= pcm.length; offset += framesPerRow * bytesPerFrame) {
    const energy = [0, 0];
    for (let i = offset; i < offset + framesPerRow * bytesPerFrame; i += bytesPerFrame) {
      for (let j = 0; j < 2; j++) {
        const x = pcm.readInt16LE(i + 4 * j) / 32768;
        low[j] += alpha * (x - low[j]);
        energy[j] += low[j] ** 2;
      }
    }
    rows.forEach((r, j) => r.push([offset / bytesPerFrame / rate * 1000, Math.sqrt(energy[j] / framesPerRow)]));
  }
  if (order === 'listener-first') rows.reverse();
  return rows.map(r => onsets(r, bpm));
}

export async function startOutputCapture(out, order, until, terminate) {
  const dir = await mkdtemp(join(out, 'pulse-'));
  const env = { ...process.env, PULSE_RUNTIME_PATH: dir, PULSE_SERVER: `unix:${join(dir, 'native')}` };
  const server = spawn('pulseaudio', ['-n', '--exit-idle-time=-1', '--log-target=stderr',
    '--load=module-native-protocol-unix'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let recorder, error = '', spawnError;
  const monitor = p => {
    p.stderr.on('data', d => error += d);
    p.on('error', e => { spawnError = e; });
  };
  monitor(server);
  const close = async () => {
    await terminate(recorder);
    await terminate(server);
    await rm(dir, { recursive: true, force: true });
  };
  const ctl = (...args) => execFileSync('pactl', args, { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    await until(() => {
      if (spawnError) throw spawnError;
      if (server.exitCode !== null) throw new Error(error);
      try { return ctl('info'); } catch { return false; }
    }, 'private PulseAudio server');
    ctl('load-module', 'module-null-sink', 'sink_name=club_capture', 'format=s16le', `rate=${rate}`,
      'channels=4', 'channel_map=front-left,front-right,rear-left,rear-right');
    const roles = order === 'host-first' ? ['host', 'listener'] : ['listener', 'host'];
    for (const [i, role] of roles.entries()) {
      ctl('load-module', 'module-remap-sink', 'master=club_capture', `sink_name=club_${role}`,
        'channels=2', 'channel_map=front-left,front-right', 'remix=no',
        `master_channel_map=${i === 0 ? 'front-left,front-right' : 'rear-left,rear-right'}`);
    }
    const chunks = [];
    let firstAt, lastAt;
    recorder = spawn('parec', ['--raw', '--device=club_capture.monitor', '--format=s16le', `--rate=${rate}`,
      '--channels=4', '--channel-map=front-left,front-right,rear-left,rear-right',
      '--latency-msec=20', '--process-time-msec=10'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    monitor(recorder);
    recorder.stdout.on('data', d => {
      lastAt = epoch();
      firstAt ??= lastAt - d.length / bytesPerFrame / rate * 1000;
      chunks.push(d);
    });
    await until(() => {
      if (spawnError) throw spawnError;
      if (recorder.exitCode !== null) throw new Error(error);
      return chunks.length;
    }, 'four-channel PulseAudio monitor');
    return {
      chromeEnv: role => ({ PULSE_SERVER: env.PULSE_SERVER, PULSE_SINK: `club_${role}` }),
      close,
      async finish(path, raw, origin, bpm) {
        if (spawnError || recorder.exitCode !== null) throw new Error(String(spawnError || error));
        const sinks = JSON.parse(ctl('--format=json', 'list', 'sinks'));
        const inputs = JSON.parse(ctl('--format=json', 'list', 'sink-inputs'));
        const routing = ['host', 'listener'].map(role => inputs.filter(input =>
          sinks.find(sink => sink.name === `club_${role}`)?.index === input.sink)
          .map(input => ({ application: input.properties['application.name'], corked: input.corked })));
        await terminate(recorder);
        const data = Buffer.concat(chunks);
        const pcm = data.subarray(0, data.length - data.length % bytesPerFrame);
        await writeFile(path, wave(pcm));
        const durationMs = pcm.length / bytesPerFrame / rate * 1000;
        const clockErrorMs = lastAt - firstAt - durationMs;
        assert.ok(Math.abs(clockErrorMs) < 100, `Monitor frame count disagrees with elapsed time by ${clockErrorMs}ms`);
        assert.ok(routing.every(streams => streams.some(s => !s.corked)), 'Both Chrome outputs must be active on their assigned sinks');
        const captured = outputOnsets(pcm, bpm, order);
        assert.ok(captured.every(hits => hits.length > 0), 'Both monitor outputs must contain audio');
        const mapped = raw.map(c => onsets(channelEnvelope(c, 'kick'), bpm));
        const first = firstMixDownbeat(...captured, origin - firstAt, bpm);
        // The approximate epoch only identifies candidate kicks. Their delta is
        // always from sample indices, and ambiguous matches remain unassigned.
        const near = (hits, at) => {
          const matches = hits.filter(t => Math.abs(t - at) < 120);
          return matches.length === 1 ? matches[0] : null;
        };
        const pairs = mapped[0].flatMap(hostAt => {
          const listenerAt = near(mapped[1], hostAt);
          if (listenerAt === null || near(mapped[0], listenerAt) !== hostAt) return [];
          const h = near(captured[0], hostAt - firstAt), l = near(captured[1], listenerAt - firstAt);
          if (h === null || l === null || near(mapped[0], h + firstAt) !== hostAt ||
            near(mapped[1], l + firstAt) !== listenerAt) return [];
          return [{ hostAt, listenerAt, mappedMs: listenerAt - hostAt, hostSampleMs: h, listenerSampleMs: l,
            capturedMs: l - h, mappedMinusCapturedMs: listenerAt - hostAt - (l - h) }];
        });
        return { order, firstAt, clockErrorMs, durationMs, routing, first, captured, pairs };
      },
    };
  } catch (e) {
    await close();
    throw e;
  }
}
