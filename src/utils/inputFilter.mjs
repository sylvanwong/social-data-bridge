// Field type values follow @lark-base-open/js-sdk FieldType.
export const INPUT_FILTER_TYPES = [1, 3, 7];
export const INPUT_FILTER_OPERATORS = {
  eq: '等于', ne: '不等于', contains: '包含', not_contains: '不包含', empty: '为空', not_empty: '不为空',
};
export const operatorsForField = type => type === 7 ? ['eq', 'ne']
  : type === 3 ? ['eq', 'ne', 'empty', 'not_empty'] : Object.keys(INPUT_FILTER_OPERATORS);
export const isEmptyOperator = operator => ['empty', 'not_empty'].includes(operator);
export const cloneInputFilter = filter => filter == null ? null : JSON.parse(JSON.stringify(filter));

export function removeFilterRule(filter, groupIndex, ruleIndex) {
  const next = cloneInputFilter(filter);
  next.groups[groupIndex].splice(ruleIndex, 1);
  next.groups = next.groups.filter(group => group.length);
  return next.groups.length ? next : null;
}

export function validateInputFilter(filter) {
  if (filter == null) return;
  if (filter.version !== 1 || typeof filter.table_id !== 'string' || !filter.table_id
    || !Array.isArray(filter.groups) || !filter.groups.length || filter.groups.flat().length > 100) {
    throw new Error('筛选条件配置无效，请重新设置');
  }
  for (const group of filter.groups) {
    if (!Array.isArray(group) || !group.length) throw new Error('筛选条件组不能为空');
    for (const rule of group) {
      if (!rule || typeof rule.field_id !== 'string' || !rule.field_id || !INPUT_FILTER_TYPES.includes(rule.field_type)
        || !operatorsForField(rule.field_type).includes(rule.operator)) throw new Error('请选择有效的筛选字段和条件');
      if (!isEmptyOperator(rule.operator)) {
        if (rule.field_type === 7 ? typeof rule.value !== 'boolean' : typeof rule.value !== 'string' || !rule.value.trim()) {
          throw new Error('请填写完整的筛选条件，或删除不需要的条件');
        }
      }
    }
  }
}

export function prepareInputFilter(filter, fields, tableId) {
  validateInputFilter(filter);
  if (filter == null) return null;
  if (filter.table_id !== tableId) throw new Error('筛选条件属于其他数据表，请切回原表或重新设置条件');
  const byId = new Map(fields.map(field => [field.id, field]));
  for (const group of filter.groups) {
    for (const rule of group) {
      const field = byId.get(rule.field_id);
      if (!field || field.type !== rule.field_type) throw new Error(`筛选字段「${rule.field_name || rule.field_id}」已删除或类型已改变，请重新设置`);
      if (rule.field_type === 3 && !isEmptyOperator(rule.operator)
        && !(field.property?.options || []).some(option => option.id === rule.value)) {
        throw new Error(`筛选字段「${field.name}」的选项已删除，请重新选择`);
      }
    }
  }
  return cloneInputFilter(filter);
}

function cellValue(value, type) {
  if (value == null) return type === 7 ? false : '';
  if (type === 7 && typeof value === 'boolean') return value;
  if (type === 3 && typeof value.id === 'string') return value.id;
  // JS SDK text cells contain text / URL / mention segments, all with text.
  if (type === 1 && Array.isArray(value) && value.every(part => typeof part?.text === 'string')) {
    return value.map(part => part.text).join('');
  }
  throw new Error('筛选字段的单元格值无法读取，请检查字段类型');
}

export function matchesInputFilter(filter, values) {
  if (!filter) return true;
  // Normalize every referenced field before OR evaluation: malformed reads must not pass silently.
  const normalized = new Map(filter.groups.flat().map(rule => [rule.field_id, cellValue(values[rule.field_id], rule.field_type)]));
  return filter.groups.some(group => group.every(rule => {
    const actual = normalized.get(rule.field_id);
    switch (rule.operator) {
      case 'eq': return actual === rule.value;
      case 'ne': return actual !== rule.value;
      case 'contains': return actual.includes(rule.value);
      case 'not_contains': return !actual.includes(rule.value);
      case 'empty': return actual === '';
      case 'not_empty': return actual !== '';
      default: throw new Error('不支持的筛选条件');
    }
  }));
}

// The caller supplies the result of prepareInputFilter for this execution.
export async function filterRecordIds(table, recordIds, prepared) {
  if (prepared == null) return recordIds;
  if (prepared.table_id !== table.id) throw new Error('筛选条件属于其他数据表，请切回原表或重新设置条件');
  const fieldIds = [...new Set(prepared.groups.flat().map(rule => rule.field_id))];
  const matched = [];
  // Bound concurrent SDK calls; keep the original view/selection order.
  for (let start = 0; start < recordIds.length; start += 20) {
    const batch = await Promise.all(recordIds.slice(start, start + 20).map(async recordId => {
      const values = {};
      for (const fieldId of fieldIds) values[fieldId] = await table.getCellValue(fieldId, recordId);
      return matchesInputFilter(prepared, values) ? recordId : null;
    }));
    matched.push(...batch.filter(id => id !== null));
  }
  return matched;
}
