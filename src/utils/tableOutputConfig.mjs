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

export function parseTableConfigList(data) {
  const list = Array.isArray(data) ? data : data?.list ?? data?.items;
  if (!Array.isArray(list)) throw new Error('表格配置返回格式不正确');
  return list;
}
