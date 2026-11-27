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
      error.checkMissingOutputTable = true;
      throw error;
    }
  }
  return reconcile && hasPendingRange ? task.pendingWriteCount : undefined;
}

export function matchWrittenAppendRows(keys, candidates, historicalIds, keyOf, confirmedRecordIds = []) {
  const history = new Set(historicalIds);
  const expected = new Map();
  keys.forEach((key, index) => {
    const recordId = confirmedRecordIds[index];
    if (recordId) history.add(recordId);
    else expected.set(key, (expected.get(key) || 0) + 1);
  });
  const matches = new Map();
  for (const record of candidates) {
    if (history.has(record.recordId)) continue;
    const key = keyOf(record.fields);
    if (!expected.has(key)) continue;
    const ids = matches.get(key) || [];
    ids.push(record.recordId);
    if (ids.length > expected.get(key)) throw new Error('核对到多于预期的相同记录，请检查目标表后再继续');
    matches.set(key, ids);
  }
  return keys.map((key, index) => confirmedRecordIds[index] || matches.get(key)?.shift());
}

export async function readTableRecords(table, assertActive, filter) {
  const records = [];
  let pageToken;
  do {
    const page = await table.getRecordsByPage({ pageSize: 200, pageToken, ...(filter ? { filter } : {}) });
    assertActive?.();
    records.push(...page.records);
    if (page.hasMore && (!page.pageToken || page.pageToken === pageToken)) {
      throw new Error('读取目标表时未返回有效分页游标，无法核对写入结果');
    }
    pageToken = page.hasMore ? page.pageToken : undefined;
  } while (pageToken !== undefined);
  return records;
}
