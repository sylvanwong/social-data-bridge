export const taskProgressView = entries => new Proxy(entries, {
  get(target, key) {
    const initial = target[key];
    if (typeof key !== 'string' || key.includes(':') || !initial?.taskId) return initial;
    const scope = [initial.baseId || '', initial.taskId, initial.retryGeneration ?? 0].map(encodeURIComponent).join(':');
    const progressKey = `${key}:progress:${scope}`;
    const progress = target[progressKey];
    return target[`${progressKey}:finished`]?.finished === true || progress?.finished === true ? {} : progress ?? initial;
  },
});

export function createTaskStorage(key = 'test', initial) {
  const entries = { [key]: initial };
  const view = taskProgressView(entries);
  return {
    getData: async name => structuredClone(entries[name]),
    setData: async (name, value) => { entries[name] = structuredClone(value); },
    current: () => view[key],
    seed: value => { entries[key] = structuredClone(value); },
  };
}
