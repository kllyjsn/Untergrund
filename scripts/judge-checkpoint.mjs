import { createHash } from 'node:crypto';

export function canResumeModel(model) {
  return !model?.finished || model.error === 'Budget exhausted' || Boolean(model.fullSkipped);
}

export function checkpointFingerprint(inputs) {
  const hash = createHash('sha256');
  for (const input of inputs) {
    const bytes = Buffer.from(input);
    hash.update(String(bytes.length)).update(':').update(bytes);
  }
  return hash.digest('hex');
}

export function assertCheckpointInputs(state, fingerprint) {
  if (state && state.inputFingerprint !== fingerprint) throw new Error('Checkpoint inputs changed or fingerprint missing; use a new private output directory');
}
