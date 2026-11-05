export const getTaskStoppingText = (task, label) => {
  const written = task?.writtenCount || 0;
  const reminder = '。请勿关闭插件，关闭会中断数据写入';
  if (Number(task?.latestStatus?.status) !== 3) {
    return `正在停止获取数据，已写入 ${written} 条${label}${reminder}`;
  }
  const total = task.resultCount;
  return Number.isSafeInteger(total) && total >= 0
    ? `获取数据已停止，剩余 ${Math.max(0, total - written)} 条待写入，已写入 ${written} 条${label}${reminder}`
    : `获取数据已停止，正在写入剩余结果，已写入 ${written} 条${label}${reminder}`;
};
