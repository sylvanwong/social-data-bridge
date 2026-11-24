const numberOrZero = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export const profileTaskResultStatus = status => {
  const code = Number(status?.status);
  if (code === 0) return 'running';
  if (code === 3) return 'stopped';
  if (code === 2) return 'failed';
  return 'completed';
};

export const buildProfileTaskResult = (status = {}, task = {}, finishedAt = new Date().toISOString()) => {
  const resultStatus = profileTaskResultStatus(status);
  const succeeded = numberOrZero(status.succeeded ?? status.succeeded_urls);
  const failed = numberOrZero(status.failed ?? status.failed_urls);
  return {
    status: resultStatus,
    taskId: task.taskId || status.task_id || '',
    total: numberOrZero(status.total),
    processed: numberOrZero(status.processed),
    succeeded,
    failed,
    requestCount: numberOrZero(status.request_count ?? succeeded + failed),
    fetchedCount: numberOrZero(status.fetched_count ?? task.writtenCount),
    startedAt: status.start || task.startedAt || '',
    finishedAt: status.end || (resultStatus === 'running' ? '' : finishedAt),
    reason: status.reason || '',
  };
};
