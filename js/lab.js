import { analyzePcm, summarizeRatings, validateBenchmark } from './lab-metrics.js';

const DIMENSIONS = ['musicality', 'originality', 'genre accuracy', 'emotional pull'];
const $ = (id) => document.getElementById(id);
const files = new Map();
let manifest, order = [], index = 0, results = [];

function seededFlip(text) {
  let h = 2166136261;
  for (const char of text) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return (h >>> 0) % 2 === 1;
}
function storageKey() { return `untergrund:lab:${manifest.id}`; }
function source(candidate) {
  if (candidate.file && files.has(candidate.file)) return URL.createObjectURL(files.get(candidate.file));
  return candidate.url || null;
}
async function metrics(candidate, pair) {
  let response;
  if (candidate.file && files.has(candidate.file)) response = await files.get(candidate.file).arrayBuffer();
  else if (candidate.url) response = await fetch(candidate.url).then((res) => { if (!res.ok) throw new Error(`Audio unavailable: ${candidate.url}`); return res.arrayBuffer(); });
  else throw new Error(`Audio unavailable: ${candidate.file} was not loaded`);
  const context = new AudioContext();
  let buffer;
  try { buffer = await context.decodeAudioData(response.slice(0)); } catch { await context.close(); throw new Error('Audio unavailable: the file could not be decoded'); }
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const value = analyzePcm(channels, buffer.sampleRate, { bpm: pair.bpm, renderMs: candidate.renderMs });
  await context.close();
  return value;
}
function metricText(value) {
  if (!value) return 'Analyzing audio…';
  const flags = value.flags.length ? ` · ${value.flags.join(', ')}` : '';
  return `${value.rmsDb} dB RMS · ${value.crestDb} dB crest · ${value.onsets} onsets${value.gridErrorMs == null ? '' : ` · ${value.gridErrorMs} ms grid error`}${flags}`;
}
function player(side, candidate, pair) {
  const box = document.createElement('article');
  box.className = 'candidate';
  const name = side === 'left' ? 'A' : 'B';
  box.dataset.state = 'loading';
  box.setAttribute('aria-label', `Candidate ${name}`);
  box.innerHTML = `<b>${name}</b><audio controls preload="metadata" aria-label="Play candidate ${name}"></audio><div class="metrics" role="status">Analyzing audio…</div>`;
  const src = source(candidate);
  if (src) box.querySelector('audio').src = src;
  metrics(candidate, pair).then((value) => {
    box.dataset.metrics = JSON.stringify(value);
    box.dataset.state = 'ready';
    box.querySelector('.metrics').textContent = metricText(value);
  }).catch((error) => {
    box.dataset.state = 'error';
    box.classList.add('unavailable');
    box.querySelector('.metrics').textContent = `${error.message}. Fix the file before rating this pair.`;
  });
  return box;
}
function scale(name, side) {
  const candidate = side === 'left' ? 'A' : 'B';
  const wrap = document.createElement('div');
  wrap.className = 'scale';
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', `${name}, candidate ${candidate}`);
  const tag = document.createElement('span');
  tag.className = 'side-tag';
  tag.setAttribute('aria-hidden', 'true');
  tag.textContent = candidate;
  wrap.append(tag);
  for (let value = 1; value <= 5; value++) {
    const label = document.createElement('label');
    label.innerHTML = `<input type="radio" name="${name}-${side}" value="${value}" aria-label="${name}, candidate ${candidate}: ${value} of 5" /><span>${value}</span>`;
    wrap.append(label);
  }
  return wrap;
}
function renderRatings() {
  $('ratings').innerHTML = '<div class="rating-row rating-head" aria-hidden="true"><b>QUALITY</b><span>A</span><span>B</span></div>';
  for (const dimension of DIMENSIONS) {
    const row = document.createElement('div');
    row.className = 'rating-row';
    row.innerHTML = `<b>${dimension.toUpperCase()}</b>`;
    row.append(scale(dimension, 'left'), scale(dimension, 'right'));
    $('ratings').append(row);
  }
}
function renderPair() {
  const pair = order[index];
  if (!pair) return complete();
  const flip = seededFlip(`${manifest.id}:${pair.id}`);
  const left = flip ? pair.b : pair.a;
  const right = flip ? pair.a : pair.b;
  pair._identity = { left: left.id, right: right.id };
  pair._candidates = { left, right };
  $('genre').textContent = `${pair.style || 'MUSIC'} · SEED ${pair.seed ?? '—'}`;
  $('pair-title').textContent = pair.title || `Pair ${index + 1}`;
  $('progress-label').textContent = `${index + 1} / ${order.length}`;
  $('progress-bar').style.width = `${(index / order.length) * 100}%`;
  $('players').replaceChildren(player('left', left, pair), player('right', right, pair));
  renderRatings();
  document.querySelectorAll('input[type=radio]').forEach((input) => { input.checked = false; });
}
function selected(name) { return document.querySelector(`input[name="${name}"]:checked`)?.value; }
function savePair() {
  const pair = order[index];
  const boxes = [...document.querySelectorAll('.candidate')];
  if (boxes.some((box) => box.dataset.state === 'error')) throw new Error('One candidate has no usable audio. Fix the benchmark files before saving this pair.');
  if (boxes.some((box) => box.dataset.state !== 'ready')) throw new Error('Wait for both candidates to finish audio analysis');
  const ratings = { left: {}, right: {} };
  for (const dimension of DIMENSIONS) for (const side of ['left', 'right']) {
    const value = selected(`${dimension}-${side}`);
    if (!value) throw new Error(`Rate ${dimension} for both candidates`);
    ratings[side][dimension] = +value;
  }
  const replay = selected('replay'), release = selected('release');
  if (!replay || !release) throw new Error('Choose replay and release intent');
  const pairResult = {
    pairId: pair.id, style: pair.style, seed: pair.seed, bpm: pair.bpm,
    identity: pair._identity, ratings, replay, release,
    metrics: {
      left: JSON.parse(boxes[0].dataset.metrics),
      right: JSON.parse(boxes[1].dataset.metrics),
    },
  };
  results = results.filter((result) => result.pairId !== pair.id);
  results.push(pairResult);
  localStorage.setItem(storageKey(), JSON.stringify(results));
  index++;
  renderPair();
}
function exportResults() {
  const output = {
    benchmarkId: manifest.id, title: manifest.title, completedAt: new Date().toISOString(),
    dimensions: DIMENSIONS, summary: summarizeRatings(results), results,
  };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
  link.download = `${manifest.id}-results.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}
function complete() {
  $('test').hidden = true; $('complete').hidden = false;
  const summary = summarizeRatings(results);
  $('summary').innerHTML = Object.entries(summary).map(([id, value]) => (
    `<div class="summary-row"><b>${id}</b><span>${value.meanRating}/5 · replay ${value.replayWins} · release ${value.releaseWins} · flags ${value.technicalFlags}</span></div>`
  )).join('');
}

$('audio-files').onchange = (event) => {
  files.clear();
  for (const file of event.target.files) files.set(file.name, file);
  $('start').disabled = !manifest;
};
$('manifest').onchange = async (event) => {
  try {
    manifest = validateBenchmark(JSON.parse(await event.target.files[0].text()));
    $('start').disabled = false;
  } catch (error) {
    manifest = null; $('start').disabled = true; alert(error.message);
  }
};
$('start').onclick = () => {
  order = manifest.pairs;
  results = JSON.parse(localStorage.getItem(storageKey()) || '[]');
  index = results.length;
  $('setup').hidden = true; $('test').hidden = false;
  renderPair();
};
$('next').onclick = () => { try { savePair(); } catch (error) { alert(error.message); } };
$('export').onclick = exportResults;
$('export-top').onclick = exportResults;
