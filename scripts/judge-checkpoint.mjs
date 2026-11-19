export function canResumeModel(model) {
  return !model?.finished || model.error === 'Budget exhausted' || Boolean(model.fullSkipped);
}
