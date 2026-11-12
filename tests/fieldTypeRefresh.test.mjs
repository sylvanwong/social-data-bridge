import test from 'node:test';
import assert from 'node:assert/strict';
import { bitable } from '@lark-base-open/js-sdk';
import { resolveWritableField } from '../src/utils/tableFields.js';

async function fixture() {
  const base = Object.create(bitable.base);
  Object.defineProperties(base, { isTableExist: { value: async () => true }, tableMapCache: { value: new Map() } });
  const sdkTable = await base.getTableById('cached');
  const meta = { id: 'count', name: '粉丝数', type: 2 };
  let reads = 0;
  const readError = new Error('字段元信息读取失败');
  let rejectRead = false;
  Object.defineProperties(sdkTable, {
    isFieldExist: { value: async () => true },
    getFieldMetaById: { value: async () => { reads++; if (rejectRead) throw readError; return meta; } },
  });
  const table = { fieldCache: sdkTable.fieldCache, getFieldById: async id => {
    const field = await sdkTable.getFieldById(id);
    return { id, type: field.type, getType: async () => meta.type, createCell: value => field.createCell(value) };
  } };
  const first = await table.getFieldById('count');
  return { table, meta, first, reads: () => reads, readError, rejectRead: () => { rejectRead = true; } };
}

test('SDK 旧引用在前一行已刷新后，后续行复用新字段，不反复查询元信息', async () => {
  const f = await fixture();
  const unrelated = {};
  f.table.fieldCache.set('unrelated', unrelated);
  f.meta.type = 1;
  for (let i = 0; i < 3; i++) {
    const { field } = await resolveWritableField(f.table, f.first);
    assert.deepEqual(await (await field.createCell('0')).getValue(), [{ type: 'text', text: '0' }]);
  }
  assert.equal(f.reads(), 2, '初次缓存及实际改型各读取一次元信息');
  assert.equal(f.table.fieldCache.get('unrelated'), unrelated);
});

test('刷新字段失败保留 SDK 原错误，不返回旧字段继续写入', async () => {
  const f = await fixture();
  f.meta.type = 1;
  f.rejectRead();
  await assert.rejects(resolveWritableField(f.table, f.first), error => error === f.readError);
});

test('SDK 缓存不能刷新时拒绝返回旧转换器', async () => {
  const field = { id: 'count', type: 2, getType: async () => 1 };
  await assert.rejects(resolveWritableField({ getFieldById: async () => field }, field), /类型已更改.*无法刷新/);
});
