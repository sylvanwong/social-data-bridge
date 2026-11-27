import { onUnmounted, ref } from 'vue';
import { matchWrittenAppendRows, readTableRecords } from '../utils/taskWriteState.mjs';

function comparableValue(value) {
  if (!Array.isArray(value)) {
    if (value === '') return null;
    return value?.text ?? value ?? null;
  }
  if (!value.length) return null;
  if (value.every(part => part?.type === 'text')) {
    return value.map(part => part.text ?? '').join('') || null;
  }
  if (value.every(part => part?.type === 'url')) {
    return value.map(part => part.link ?? '');
  }
  if (value.every(part => part?.token)) return value.map(part => part.token);
  return value;
}

async function prepareAppend(table, records, assertActive) {
  // 使用 SDK 转换后的字段值固定写入载荷，续写不复用可能已挂载到记录的 SDK 单元格。
  const payloads = await Promise.all(records.map(async cells => ({
    fields: Object.fromEntries(await Promise.all(cells.filter(cell => cell.editable !== false)
      .map(async cell => [cell.getFieldId(), await cell.getValue()]))),
  })));
  assertActive();
  const fieldIds = Object.keys(payloads[0].fields);
  const values = payloads.map(({ fields }) => fieldIds.map(id => fields[id]));
  const fieldValues = values.map(row => row.map(comparableValue));
  const keys = fieldValues.map(row => JSON.stringify(row));
  const keyOf = fields => JSON.stringify(fieldIds.map(id => comparableValue(fields[id])));
  const expected = new Set(keys);

  // 优先按本批的文本或数字缩小范围。只写附件或空值时按实际单元格内容核对。
  const conditions = new Map();
  for (const [rowIndex, row] of fieldValues.entries()) {
    let index = -1;
    for (const [cellIndex, value] of row.entries()) {
      const raw = values[rowIndex][cellIndex];
      const isText = typeof raw === 'string' || (Array.isArray(raw) && raw.every(part => part?.type === 'text'));
      if (Number.isFinite(value)) {
        if (index < 0) index = cellIndex;
      } else if (isText && typeof value === 'string' && value.length > (row[index]?.length ?? 0)) {
        index = cellIndex;
      }
    }
    if (index < 0) {
      conditions.clear();
      break;
    }
    const fieldId = fieldIds[index];
    const value = row[index];
    conditions.set(JSON.stringify([fieldId, value]), { fieldId, operator: 'is', value });
  }
  const filters = [...conditions.values()];
  const readMatches = async () => {
    const matching = new Map();
    for (let offset = 0; offset < Math.max(filters.length, 1); offset += 20) {
      const filter = filters.length ? { conjunction: 'or', conditions: filters.slice(offset, offset + 20) } : undefined;
      for (const row of await readTableRecords(table, assertActive, filter)) {
        if (expected.has(keyOf(row.fields))) matching.set(row.recordId, row);
      }
    }
    return [...matching.values()];
  };
  return { payloads, keys, keyOf, readMatches };
}

export function useAppendWriteRecovery(taskFeedback, executionResult) {
  const appendPaused = ref(false);
  const appendRetrying = ref(false);
  let respond;
  let disposed = false;

  const choose = action => {
    if (!respond) return;
    const resolve = respond;
    respond = undefined;
    appendPaused.value = false;
    appendRetrying.value = true;
    if (action !== 'dispose') taskFeedback.begin('正在核对已写入的结果…');
    resolve(action);
  };
  onUnmounted(() => {
    disposed = true;
    choose('dispose');
  });

  const appendWithRecovery = async (table, records, resultOptions = {}) => {
    const assertActive = () => {
      if (disposed) throw new Error('插件页面已关闭');
    };
    const { payloads, keys, keyOf, readMatches } = await prepareAppend(table, records, assertActive);
    let historicalIds;
    const confirmedIds = new Set();
    let remainingIndices = keys.map((_, index) => index);
    let attempted = false;
    let action;
    try {
      for (;;) {
        assertActive();
        try {
          if (action === 'end' && !attempted) return { writtenCount: 0, ended: true };
          if (!historicalIds) historicalIds = (await readMatches()).map(row => row.recordId);
          if (attempted) {
            // 已确认的行可能被编辑，不再用其当前内容匹配其他待写结果。
            const matches = matchWrittenAppendRows(
              remainingIndices.map(index => keys[index]),
              await readMatches(),
              [...historicalIds, ...confirmedIds],
              keyOf,
            );
            remainingIndices = remainingIndices.filter((_, index) => {
              const recordId = matches[index];
              if (!recordId) return true;
              confirmedIds.add(recordId);
              return false;
            });
          }
          if (action === 'end') return { writtenCount: confirmedIds.size, ended: true };
          const remaining = remainingIndices.map(index => payloads[index]);
          if (remaining.length) {
            attempted = true;
            const ids = await table.addRecords(remaining);
            assertActive();
            if (!Array.isArray(ids) || ids.length !== remaining.length || ids.some(id => !id)) {
              throw new Error('表格未确认全部记录已写入');
            }
          }
          return { writtenCount: records.length, ended: false };
        } catch (error) {
          assertActive();
          if (action === 'end') return { writtenCount: confirmedIds.size, ended: true };
          const reason = error?.message || String(error || '表格写入失败');
          executionResult.finish({ ...resultOptions, status: 'paused', reason });
          taskFeedback.fail(`写入已暂停：${reason}。点击「继续写入」后将核对已写入的结果。关闭或刷新插件会清除未写入的结果。`, { persist: true });
        }
        appendRetrying.value = false;
        action = await new Promise(resolve => {
          respond = resolve;
          appendPaused.value = true;
        });
      }
    } finally {
      appendRetrying.value = false;
    }
  };

  return {
    appendWithRecovery, appendPaused, appendRetrying,
    resumeAppend: () => choose('resume'),
    endAppend: () => choose('end'),
  };
}
