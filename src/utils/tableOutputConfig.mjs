// 固定每次提交的内容；同表顺序保存，不同表互不等待或取消。
export function createTableConfigSaver(write) {
  const pending = new Map();
  return config => {
    const snapshot = JSON.parse(JSON.stringify(config));
    const key = snapshot.targetTableId;
    const previous = pending.get(key);
    const result = previous
      ? previous.catch(() => {}).then(() => write(snapshot))
      : Promise.resolve().then(() => write(snapshot));
    pending.set(key, result);
    const clear = () => { if (pending.get(key) === result) pending.delete(key); };
    result.then(clear, clear);
    return result;
  };
}
