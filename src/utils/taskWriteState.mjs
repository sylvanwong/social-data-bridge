// 只在已知失败批次范围内核对，不能用历史同 ID 行抵扣本次追加。
export function getPendingWriteLimit(task, maxLimit) {
  const reconcile = task.pendingWrite ?? !!task.targetTableId;
  const hasPendingRange = Number.isInteger(task.pendingWriteCount)
    && task.pendingWriteCount > 0 && task.pendingWriteCount <= maxLimit;
  if (reconcile && task.writeMode === 'append') {
    const state = task.appendState;
    const hasAppendBaseline = Array.isArray(state?.knownRecordIds)
      && state.knownRecordIds.every(id => typeof id === 'string' && id)
      && Array.isArray(state.fieldIds) && state.fieldIds.length > 0
      && state.fieldIds.every(id => typeof id === 'string' && id)
      && state.pendingCount === task.pendingWriteCount;
    const reason = !hasPendingRange ? '无法确认原写入批次范围'
      : !hasAppendBaseline ? '无法区分历史行和本批新增结果' : '';
    if (reason) {
      const error = new Error(`${reason}，已暂停自动恢复。请核对目标表格中的已写入结果；原任务进度已保留。`);
      error.stopPolling = true;
      throw error;
    }
  }
  return reconcile && hasPendingRange ? task.pendingWriteCount : undefined;
}
