import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManualUrls, extractCellLink } from '../src/utils/sourceLinks.mjs';
import { nextTableName } from '../src/utils/tableNames.mjs';
import { readSourceRows, readUniqueSourceLinks } from '../src/utils/sourceTableRows.mjs';
import { bitable, FieldType } from '@lark-base-open/js-sdk';

async function sourceTable(values, reads) {
  const base = Object.create(bitable.base, {
    isTableExist: { value: async () => true }, tableMapCache: { value: new Map() },
  });
  const table = await base.getTableById('source');
  Object.defineProperties(table, {
    isFieldExist: { value: async id => id === 'link' },
    getFieldMetaById: { value: async () => ({ id: 'link', name: '作者主页', type: FieldType.Url }) },
    getCellValue: { value: async (fieldId, recordId) => {
      assert.equal(fieldId, 'link');
      reads.push(recordId);
      const value = values[recordId];
      if (value instanceof Error) throw value;
      return value;
    } },
  });
  return table;
}

test('真实SDK：作者主页每行单次取值，保留顺序、去重、空值与失败行过滤', async () => {
  const reads = [];
  const table = await sourceTable({
    a: [{ type: 'url', text: '作者B', link: 'https://example.test/b' }],
    b: null, c: [{ type: 'url', text: '作者B', link: 'https://example.test/b' }],
    d: new Error('该行读取失败'), e: [{ type: 'url', text: '作者A', link: 'https://example.test/a' }],
  }, reads);
  assert.deepEqual(await readUniqueSourceLinks(table, ['a', 'b', 'c', 'd', 'e'], 'link'),
    ['https://example.test/b', 'https://example.test/a']);
  assert.equal(reads.length, 5, 'getCell 后再 getValue 会重复读取同一行');
  assert.deepEqual([...new Set(reads)], ['a', 'b', 'c', 'd', 'e']);
});

test('共用源表读取：单次取值保留原行ID，卸载后的迟到值不再交给解析器', async () => {
  let release, mounted = true, parsed = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const raw = { text: '原始值' };
  const table = { getFieldById: async () => ({ getValue: async () => { await gate; return raw; } }) };
  const assertMounted = value => { if (!mounted) throw new Error('页面已卸载'); return value; };
  const pending = readSourceRows(table, ['original-row'], 'link', (recordId, value) => {
    parsed++; return { recordId, value };
  }, assertMounted);
  await Promise.resolve(); mounted = false; release();
  await assert.rejects(pending, /页面已卸载/);
  assert.equal(parsed, 0);
  mounted = true;
  assert.deepEqual(await readSourceRows(table, ['original-row'], 'link', (recordId, value) => ({ recordId, value })),
    [{ recordId: 'original-row', value: raw }]);
});

test('手动输入按原分隔符和首次出现顺序去重', () => {
  assert.deepEqual(parseManualUrls(' b，a\n b ,c d '), ['b', 'a', 'c d']);
  assert.deepEqual(parseManualUrls(null), []);
});

test('嵌套链接单元格保留属性优先级并跳过空项', () => {
  assert.equal(extractCellLink([{}, { text: '文字', link: { url: ' 地址 ' } }, '后续']), '地址');
  assert.equal(extractCellLink([{}, '  ']), null);
});

test('新表名沿用旧表占名及最大编号规则', () => {
  assert.equal(nextTableName('结果', ['其他2', '结果备份']), '结果');
  assert.equal(nextTableName('结果', ['结果副本2']), '结果1');
  assert.equal(nextTableName('结果', ['结果', '结果02', '结果9', '结果备份99']), '结果10');
});
