import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse as parseVue } from '@vue/compiler-sfc';
import { parse } from '@babel/parser';
import { bitable, FieldType, DateFormatter, NumberFormatter } from '@lark-base-open/js-sdk';
import { createProductDetailFields, buildProductDetailRequest } from '../src/utils/productDetail.mjs';
import { resolveWritableField } from '../src/utils/tableFields.js';
import { installSDKCells } from './helpers/sdkTable.mjs';
import { fakeTable } from '../../social-blogger-search/tests/helpers.mjs';
import { loadRequestModule } from './helpers/requestService.mjs';

const source = parseVue(fs.readFileSync(new URL('../src/components/VideoDataFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
function functions(names, bindings = {}) {
  const nodes = parse(source, { sourceType: 'module' }).program.body.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(item => names.includes(item.id.name)));
  const scope = {
    props: { productDetail: true, api_key: 'test-only' },
    FieldType, DateFormatter, NumberFormatter, createProductDetailFields, buildProductDetailRequest,
    resolveWritableField, assertMounted: value => value, mappingDraft: { value: [] },
    console: { log() {}, error() {}, warn() {} }, ...bindings,
  };
  return new Function(...Object.keys(scope), nodes.map(node => source.slice(node.start, node.end)).join('\n') + `\nreturn {${names.join(',')}};`)(...Object.values(scope));
}

for (const platform of ['douyin', 'xhs']) test(`商品详情${platform}提交已有接口契约并保留返回字段`, async () => {
  const requests = [], saved = [];
  const url = platform === 'douyin' ? 'https://v.douyin.com/product/' : 'https://www.xiaohongshu.com/goods/abc';
  const api = loadRequestModule();
  api.service.defaults.adapter = async config => {
    requests.push({ ...config, data: JSON.parse(config.data) });
    return { status: 200, statusText: 'OK', headers: {}, config,
      data: { sta: 0, data: { product_id: 'one', title: '商品', sold_count: 0, assurances: '保障1\n保障2' } } };
  };
  const f = functions(['fetchVideoDataByRows'], {
    ...api, stopRequested: { value: false }, showToast() {},
    taskFeedback: { recordFailure: message => assert.fail(message) },
  });
  const result = await f.fetchVideoDataByRows([{ url, recordId: 'row' }], { onSuccess: item => saved.push(item) });
  assert.equal(result.successCount, 1);
  assert.equal(result.failCount, 0);
  assert.match(requests[0].url, /\/feishu\/product\/detail$/);
  assert.deepEqual(requests[0].data, { social_type: platform, url });
  assert.equal(saved[0].sold_count, 0);
  assert.equal(saved[0].assurances, '保障1\n保障2');
  assert.equal(saved[0].__recordId, 'row');
});

test('商品详情空结果和接口失败不进入写表回调', async () => {
  const failures = [], saved = [];
  const responses = [{ sta: 0, data: {} }, { sta: -1, msg: '服务暂时不可用' }];
  const f = functions(['fetchVideoDataByRows'], {
    ...loadRequestModule(), stopRequested: { value: false }, showToast() {},
    taskFeedback: { recordFailure: message => failures.push(message) },
    feishuRequest: async () => ({ data: responses.shift() }),
  });
  const result = await f.fetchVideoDataByRows([{ url: 'https://v.douyin.com/a' }, { url: 'https://xhslink.com/a' }], { onSuccess: item => saved.push(item) });
  assert.equal(result.failCount, 2);
  assert.equal(saved.length, 0);
  assert.deepEqual(failures, ['商品详情缺少商品ID或商品标题', '服务暂时不可用']);
});

for (const type of [FieldType.Text, FieldType.Number]) test(`商品详情映射销量到已有${type}列，更新和追加使用SDK转换且保留其他列`, async () => {
  const table = fakeTable('target', '商品表', [
    { id: 'id', name: '自定义ID', type: FieldType.Text },
    { id: 'sales', name: '自定义销量', type },
    { id: 'other', name: '其他数据', type: FieldType.Text },
  ], [{ recordId: 'old', fields: { id: [{ type: 'text', text: 'one' }], sales: 9, other: '保留' } }]);
  await installSDKCells(table, bitable);
  const names = ['FIELD_CONFIG', 'FIELD_TYPE_NAME', 'getAllowedFieldTypes', 'isFieldTypeCompatible', 'getExpectedFieldTypeName', 'normalizeFieldValue', 'createCellValue', 'appendRecordsToTable'];
  const f = functions(names, { bitable: { base: { getTableById: async () => table } } });
  const configs = f.FIELD_CONFIG.filter(field => ['product_id', 'sold_count'].includes(field.key));
  const fieldsBefore = structuredClone(table.fields);
  const options = { writeMode: 'upsert', fieldMappings: [{ source_key: 'product_id', target_field_id: 'id' }, { source_key: 'sold_count', target_field_id: 'sales' }] };
  await f.appendRecordsToTable('target', [{ product_id: 'one', sold_count: 0 }, { product_id: 'two', sold_count: null }], configs, options);
  assert.equal(table.records.length, 2);
  assert.equal(table.records[0].fields.other, '保留');
  assert.deepEqual(table.records[0].fields.sales, type === FieldType.Text ? [{ type: 'text', text: '0' }] : 0);
  assert.deepEqual(table.records[1].fields.sales, type === FieldType.Text ? [{ type: 'text', text: '' }] : null);
  assert.deepEqual(table.fields, fieldsBefore);
  await f.appendRecordsToTable('target', [{ product_id: 'one', sold_count: 2 }], configs, { ...options, writeMode: 'append' });
  assert.equal(table.records.length, 3, '始终新增不覆盖相同ID');
});

test('商品详情新表创建13列并实际写入文本、数字和日期', async () => {
  const table = fakeTable('new', '商品详情获取', [{ id: 'primary', name: '文本', type: FieldType.Text }]);
  await installSDKCells(table, bitable);
  const names = ['FIELD_CONFIG', 'FIELD_TYPE_NAME', 'getAllowedFieldTypes', 'isFieldTypeCompatible', 'getExpectedFieldTypeName', 'normalizeFieldValue', 'setupNewTableFields', 'createCellValue', 'appendRecordsToTable'];
  const f = functions(names, { bitable: { base: { getTableById: async () => table } } });
  await f.setupNewTableFields('new', f.FIELD_CONFIG);
  assert.equal(table.fields.length, 13);
  assert.equal(table.fields[0].name, '商品ID');
  const row = { product_id: 'one', title: '商品', sold_count: 0, main_image_urls: 'https://example.test/1\nhttps://example.test/2', extract_time: '2026-11-19 10:20:30' };
  await f.appendRecordsToTable('new', [row], f.FIELD_CONFIG);
  const value = name => table.records[0].fields[table.fields.find(field => field.name === name).id];
  assert.deepEqual(value('商品ID'), [{ type: 'text', text: 'one' }]);
  assert.deepEqual(value('商品图链接'), [{ type: 'text', text: row.main_image_urls }]);
  assert.equal(value('销量'), 0);
  assert.equal(value('提取时间'), Date.UTC(2026, 10, 19, 2, 20, 30));
});
