import test from 'node:test';
import assert from 'node:assert/strict';
import { parseManualUrls, extractCellLink } from '../src/utils/sourceLinks.mjs';
import { nextTableName } from '../src/utils/tableNames.mjs';

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
