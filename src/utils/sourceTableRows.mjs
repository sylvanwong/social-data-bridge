import { extractCellLink } from './sourceLinks.mjs';

// 调用方传入本次执行的源表。工具页还会在每次 SDK 等待后检查是否已卸载。
export async function readRecordIds(table, scope, rowCount, notify, assertMounted = value => value) {
  const view = assertMounted(await table.getActiveView());
  if (scope === 'selected') {
    const ids = assertMounted(await view.getSelectedRecordIdList());
    if (ids.length) return ids;
    notify({ plain: true, message: '请先在表格中选择至少一行数据', type: 'warning', duration: 3000 });
    return null;
  }

  const limit = scope === 'all' ? Infinity : rowCount;
  const pageSize = 200;
  const ids = [];
  let pageToken;
  for (let page = 0; page < 100; page++) {
    const result = assertMounted(await view.getVisibleRecordIdListByPage({ pageSize, pageToken }));
    const batch = Array.isArray(result) ? result : result?.recordIds || result?.records || result?.data || result?.list || [];
    ids.push(...batch);
    const hasMore = Array.isArray(result) ? batch.length === pageSize : result?.hasMore || result?.hasNext || result?.has_next;
    if (!hasMore || !batch.length || ids.length >= limit) break;
    pageToken = result?.pageToken || result?.nextPageToken || result?.next_token;
  }
  return ids.slice(0, limit);
}

export async function readSourceRows(table, recordIds, fieldId, toRow, assertMounted = value => value) {
  const field = assertMounted(await table.getFieldById(fieldId));
  const rows = assertMounted(await Promise.all(recordIds.map(async recordId => {
    try {
      const cell = assertMounted(await field.getCell(recordId));
      return toRow(recordId, assertMounted(await cell.getValue()));
    } catch {
      assertMounted();
      return null;
    }
  })));
  return rows.filter(Boolean);
}

export async function readUniqueSourceLinks(table, recordIds, fieldId) {
  const links = await readSourceRows(table, recordIds, fieldId, (_, value) => extractCellLink(value));
  return [...new Set(links)];
}
