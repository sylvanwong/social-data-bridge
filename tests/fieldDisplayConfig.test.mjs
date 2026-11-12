import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse as parseVue } from '@vue/compiler-sfc';
import { parse } from '@babel/parser';
import { bitable, FieldType, NumberFormatter, DateFormatter } from '@lark-base-open/js-sdk';
import { resolveWritableField } from '../src/utils/tableFields.js';

async function fixture(page, initialType, key) {
  const source = parseVue(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const names = new Set(['FIELD_CONFIG', 'FIELD_TYPE_NAME', 'getAllowedFieldTypes', 'isFieldTypeCompatible', 'getExpectedFieldTypeName', 'getFieldCandidateNames', 'resolveFieldMetaByConfig', 'validateAndAddFields', 'setupNewTableFields']);
  const nodes = parse(source, { sourceType: 'module' }).program.body.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(item => names.has(item.id.name)));
  const meta = { id: 'output', name: '文本', type: initialType, property: {} };
  const changes = [];
  const base = Object.create(bitable.base);
  Object.defineProperties(base, { isTableExist: { value: async () => true }, tableMapCache: { value: new Map() } });
  const sdkTable = await base.getTableById('target');
  Object.defineProperties(sdkTable, {
    isFieldExist: { value: async () => true },
    getFieldMetaById: { value: async () => meta },
    setField: { value: async (id, config) => { changes.push(structuredClone(config)); Object.assign(meta, config); return id; } },
  });
  const getField = async () => {
    const cached = await sdkTable.getFieldById(meta.id);
    // 只替换宿主元信息读取；格式 setter 使用真实 SDK，会调用 setField 更新元信息。
    Object.defineProperty(cached, 'getMeta', { configurable: true, value: async () => meta });
    return { id: meta.id, type: cached.type, getName: async () => meta.name, getType: async () => meta.type,
      setFormatter: typeof cached.setFormatter === 'function' ? value => cached.setFormatter(value) : undefined,
      setDateFormat: typeof cached.setDateFormat === 'function' ? value => cached.setDateFormat(value) : undefined,
    };
  };
  const table = { id: 'target', fieldCache: sdkTable.fieldCache, getFieldById: getField,
    getFieldList: async () => [await getField()], getFieldMetaList: async () => [structuredClone(meta)],
    setField: (id, config) => sdkTable.setField(id, config),
  };
  const scope = { FieldType, NumberFormatter, DateFormatter, resolveWritableField, bitable: { base: { getTableById: async () => table } }, loading: { value: true }, console: { log() {}, error() {} } };
  const api = new Function(...Object.keys(scope), nodes.map(node => source.slice(node.start, node.end)).join('\n') + '\nreturn {FIELD_CONFIG, validateAndAddFields, setupNewTableFields};')(...Object.values(scope));
  const config = api.FIELD_CONFIG.find(config => config.key === key);
  assert.ok(config);
  return { meta, changes, table, api, config };
}

for (const page of ['BloggerInfoFetch', 'VideoDataFetch']) {
  const key = page === 'BloggerInfoFetch' ? 'follower_count' : 'digg_count';
  test(`${page}：数字列首次校验已缓存，改为文本后同页重试不提交数字格式`, async () => {
    const f = await fixture(page, FieldType.Number, key);
    f.meta.name = f.config.name;
    await f.api.validateAndAddFields('target', [f.config]);
    f.changes.length = 0;
    f.meta.type = FieldType.Text;
    f.meta.property = {};
    await f.api.validateAndAddFields('target', [f.config]);
    assert.deepEqual(f.changes, []);
    assert.equal(f.meta.type, FieldType.Text);
    assert.deepEqual(f.meta.property, {});
  });

  test(`${page}：缓存文本列改为数字后，同页校验仍正常设置数字格式`, async () => {
    const f = await fixture(page, FieldType.Text, key);
    f.meta.name = f.config.name;
    await f.api.validateAndAddFields('target', [f.config]);
    f.changes.length = 0;
    f.meta.type = FieldType.Number;
    await f.api.validateAndAddFields('target', [f.config]);
    assert.equal(f.changes.length, 1);
    assert.equal(f.meta.type, FieldType.Number);
    assert.equal(f.meta.property.formatter, NumberFormatter.INTEGER);
  });

  for (const [type, fieldKey, property, expected] of [
    [FieldType.Number, key, 'formatter', NumberFormatter.INTEGER],
    [FieldType.DateTime, 'ctime', 'dateFormat', DateFormatter.DATE_TIME],
  ]) {
    test(`${page}：新表首列缓存仍是文本，初始化 ${type} 列后正确设置格式`, async () => {
      const f = await fixture(page, FieldType.Text, fieldKey);
      await f.table.getFieldList();
      await f.api.setupNewTableFields('target', [f.config]);
      assert.equal(f.meta.type, type);
      assert.equal(f.meta.name, f.config.name);
      assert.equal(f.meta.property[property], expected);
    });
  }
}
