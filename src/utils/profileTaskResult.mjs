const numberOrZero = value => Number.isFinite(Number(value)) ? Number(value) : 0;

const invalidInputCount = status => numberOrZero(status?.invalid_url_count ?? status?.invalid_items?.length);

export const profileTaskResultStatus = status => {
  const code = Number(status?.status);
  if (code === 0) return 'running';
  if (code === 3) return 'stopped';
  if (code === 2) return 'interrupted';
  const succeeded = numberOrZero(status?.succeeded ?? status?.succeeded_urls);
  if (numberOrZero(status?.failed ?? status?.failed_urls) + invalidInputCount(status) > 0) return succeeded > 0 ? 'partial' : 'failed';
  if (code === 1 && succeeded > 0 && succeeded === Number(status.total) && succeeded === Number(status.processed)
    && !status.scope_warning) return 'success';
  // 无失败但范围被缩减或仍有输入未处理，不能当作完整完成。
  const total = numberOrZero(status?.total);
  const processed = numberOrZero(status?.processed ?? succeeded);
  if (status?.scope_warning || total > processed) return 'incomplete';
  return 'completed';
};

export const buildProfileTaskResult = (status = {}, task = {}, finishedAt = new Date().toISOString()) => {
  const resultStatus = profileTaskResultStatus(status);
  const elapsedMs = Date.parse(finishedAt) - task.executionStartedAt;
  const succeeded = numberOrZero(status.succeeded ?? status.succeeded_urls);
  const fetchFailures = numberOrZero(status.failed ?? status.failed_urls);
  const invalid = invalidInputCount(status);
  const total = numberOrZero(status.total);
  // 旧任务缩减过范围时，total 只包含实际纳入获取的作者。
  const inputCount = status.input_count ?? (
    !status.scope_warning && Number.isInteger(status.total) && status.total > 0 ? total + invalid : null
  );
  const processed = numberOrZero(status.processed ?? (succeeded + fetchFailures));
  // 解析失败已计入失败。只有原始输入总数已知时，才能确认因范围缩减未执行的条数。
  const skippedCount = inputCount == null ? 0 : Math.max(0, inputCount - total - invalid);
  const unprocessedCount = Math.max(0, total - processed);
  // 有失败输入时，正常终态的 reason 可能只属于最后一条失败输入。
  const showReason = Number(status.status) !== 1 || (fetchFailures === 0 && total > processed);
  const reason = showReason ? status.reason || '' : '';
  const fetchItems = status.failed_items ?? status.failedItems;
  const failedItems = [
    ...(Array.isArray(fetchItems) ? fetchItems : []),
    ...(Array.isArray(status.invalid_items) ? status.invalid_items : []),
  ].filter(item => item?.url || item?.profile_url || item?.link).map(item => ({
    url: item.url || item.profile_url || item.link || '',
    reason: item.reason?.trim() || item.error?.trim() || '未返回具体原因',
  }));
  // 按原因汇总已返回的失败明细，数量多的在前，同数量保持首次出现顺序。
  const reasonCounts = new Map();
  for (const item of failedItems) reasonCounts.set(item.reason, (reasonCounts.get(item.reason) || 0) + 1);
  const failureReasons = [...reasonCounts].map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
  const scopeWarning = status.scope_warning || '';
  return {
    status: resultStatus,
    taskId: task.taskId || status.task_id || '',
    total: total + invalid,
    inputCount,
    processed: processed + invalid,
    skippedCount,
    unprocessedCount,
    succeeded,
    failed: fetchFailures + invalid,
    requestCount: numberOrZero(status.request_count ?? succeeded + fetchFailures),
    fetchedCount: numberOrZero(status.fetched_count ?? task.writtenCount),
    writtenCount: numberOrZero(task.writtenCount),
    executionDurationSeconds: resultStatus !== 'running' && Number.isFinite(task.executionStartedAt) && task.executionStartedAt > 0 && elapsedMs >= 0
      ? Math.floor(elapsedMs / 1000) : null,
    finishedAt: resultStatus === 'running' ? '' : finishedAt,
    reason,
    scopeWarning,
    scopeWarningText: skippedCount > 0 ? scopeWarning.replace('部分作者未执行', `${skippedCount} 条输入未执行`) : scopeWarning,
    rerunHint: skippedCount > 0 && scopeWarning.startsWith('积分不足')
      ? '充值后，如果输入范围不变，点击「立即执行」会重新处理该范围内的全部输入。'
      : '',
    failedItems,
    failureReasons,
  };
};
