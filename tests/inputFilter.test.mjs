import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareInputFilter, matchesInputFilter, removeFilterRule, filterRecordIds, cloneInputFilter } from '../src/utils/inputFilter.mjs';

const fields = [
  { id: 'status', name: '状态', type: 3, property: { options: [{ id: 'active', name: '进行中' }, { id: 'done', name: '已完成' }] } },
  { id: 'text', name: '文本', type: 1 }, { id: 'check', name: '开关', type: 7 },
];
const rule = (field_id, field_type, value, operator = 'eq') => ({ field_id, field_type, value, operator });
const filter = groups => ({ version: 1, table_id: 'table', groups });
test('组内并且、组间或者；false 与空文本分别判断', () => {
  const prepared = prepareInputFilter(filter([[rule('status', 3, 'active'), rule('check', 7, false)], [rule('text', 1, null, 'empty')]]), fields, 'table');
  assert.equal(matchesInputFilter(prepared, { status: { id: 'active', text: '进行中' }, check: false, text: [{ type: 'text', text: 'abc' }] }), true);
  assert.equal(matchesInputFilter(prepared, { status: { id: 'active', text: '进行中' }, check: true, text: [{ type: 'text', text: 'abc' }] }), false);
  assert.equal(matchesInputFilter(prepared, { status: null, check: true, text: null }), true);
});
test('文本多个片段合并后匹配，不把对象变成字符串', () => {
  const prepared = prepareInputFilter(filter([[rule('text', 1, 'ab', 'contains')]]), fields, 'table');
  assert.equal(matchesInputFilter(prepared, { text: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }), true);
  assert.throws(() => matchesInputFilter(prepared, { text: { unexpected: true } }));
});
test('删单条保留其他条件、删除末条移除空组且不修改输入', () => {
  const original = filter([[rule('status', 3, 'active'), rule('check', 7, false)], [rule('text', 1, 'x')]]);
  const next = removeFilterRule(original, 0, 0);
  assert.deepEqual(next.groups, [[rule('check', 7, false)], [rule('text', 1, 'x')]]);
  assert.equal(original.groups[0].length, 2);
  assert.equal(removeFilterRule(filter([[rule('text', 1, 'x')]]), 0, 0), null);
  const copy = cloneInputFilter(original); copy.groups[0][0].value = 'done';
  assert.equal(original.groups[0][0].value, 'active');
});
test('字段、类型、选项与源表失效时阻止执行，即使其他 OR 组匹配', () => {
  assert.throws(() => prepareInputFilter(filter([[rule('status', 3, 'deleted')]]), fields, 'table'));
  assert.throws(() => prepareInputFilter(filter([[rule('missing', 1, 'x')]]), fields, 'table'));
  assert.throws(() => prepareInputFilter(filter([[rule('check', 1, 'x')]]), fields, 'table'));
  assert.throws(() => prepareInputFilter(filter([[rule('text', 1, 'x')]]), fields, 'other'));
  assert.throws(() => prepareInputFilter(filter([[]]), fields, 'table'));
});
test('只筛选调用方给定的范围，读取失败不能当空值通过', async () => {
  const values = { r1: [{ type: 'text', text: 'done' }], r2: [{ type: 'text', text: 'active' }] };
  const table = { id: 'table', getFieldMetaList: async () => fields, getCellValue: async (id, record) => values[record] };
  const config = prepareInputFilter(filter([[rule('text', 1, 'active')]]), fields, 'table');
  assert.deepEqual(await filterRecordIds(table, ['r1'], config), []);
  assert.deepEqual(await filterRecordIds(table, ['r1', 'r2'], config), ['r2']);
  table.getCellValue = async () => { throw new Error('denied'); };
  await assert.rejects(filterRecordIds(table, ['r1'], prepareInputFilter(filter([[rule('text', 1, null, 'empty')]]), fields, 'table')), /denied/);
});
test('无条件保持原范围，不访问字段或单元格', async () => {
  assert.deepEqual(await filterRecordIds(null, ['r1'], null), ['r1']);
});
