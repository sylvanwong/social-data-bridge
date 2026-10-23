import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { createTableConfigSaver } from '../src/utils/tableOutputConfig.mjs';
import { bitable, FieldType, DateFormatter, NumberFormatter } from '@lark-base-open/js-sdk';

// Exercise the real page handlers, substituting only their SDK and external dependencies.
function pageHandler(page, name, bindings) {
  bindings = { writeMode: { value: 'upsert' }, editingTaskId: { value: null }, taskMappingDraft: { value: [] }, mappingDraft: { value: [] }, taskOutputLoading: { value: false }, taskOutputError: { value: '' }, taskOutputTableId: { value: '' }, taskOutputConfigReady: { value: true }, taskDialogVisible: { value: false }, tableConfigApplying: { value: false }, mainOutputTableId: { value: '' }, mainConfigReadId: { value: 0 }, taskConfigReadId: { value: 0 }, fieldReadRequests: new WeakMap(), taskTableFieldOptions: { value: [] }, tableFieldOptions: { value: [] }, ...bindings };
  if (name === 'saveTableOutputConfig' && !bindings.persistTableOutputConfig) {
    bindings.persistTableOutputConfig = pageHandler(page, 'persistTableOutputConfig', { ...bindings, createTableConfigSaver });
  }
  const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declarations = parseJS(source, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  if (name !== 'cloneFieldMappings' && !bindings.cloneFieldMappings && declarations.some(node => node.id.name === 'cloneFieldMappings')) {
    bindings.cloneFieldMappings = pageHandler(page, 'cloneFieldMappings', bindings);
  }
  const node = declarations.find(node => node.id.name === name).init;
  return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：先取输入范围，零匹配立即结束且不读取链接或创建输出`, async () => {
    const calls = [], notifications = [];
    const sourceTable = { id: 'table' };
    let activeReads = 0;
    const loading = { value: false }, isSubmitting = { value: false };
    const bindings = {
      formData: { value: { mode: 'table', scope: 'n', rowCount: 2, inputFilter: { version: 1 } } },
      selectedFieldKeys: { value: [] }, props: { api_key: 'test-only' },
      loading, isSubmitting, stopRequested: { value: false },
      console: { log() {}, error() {} }, validateBaseForm: () => true,
      validateConfiguredInputFilter: async (_, table) => { assert.equal(table, sourceTable); calls.push('validate'); return { version: 1 }; },
      getActiveFieldConfigs: () => [],
      getRecordIdListByScope: async (table, scope, count) => { assert.equal(table, sourceTable); assert.equal(scope, 'n'); assert.equal(count, 2); calls.push('scope'); return ['r1', 'r2']; },
      bitable: { base: { getActiveTable: async () => { activeReads++; return sourceTable; } } },
      filterRecordIds: async (table, ids) => { assert.equal(table, sourceTable); assert.deepEqual(ids, ['r1', 'r2']); calls.push('filter'); return []; },
      ElNotification: message => notifications.push(message),
      getCellValuesByFieldId: () => assert.fail('零匹配不应读取链接'),
      getProfileUrlsByFieldId: () => assert.fail('零匹配不应读取链接'),
      validateAndAddFields: () => assert.fail('零匹配不应创建输出字段'),
      postProfileTask: () => assert.fail('零匹配不应提交任务'),
    };
    await pageHandler(page, page === 'ProfileFetch' ? 'handleImmediateSubmit' : 'handleTableModeSubmit', bindings)();
    assert.deepEqual(calls, ['validate', 'scope', 'filter']);
    assert.equal(activeReads, 1);
    assert.deepEqual(notifications, [{ message: '没有符合筛选条件的数据', type: 'info' }]);
    assert.equal(loading.value, false);
    assert.equal(isSubmitting.value, false);
  });
}

// Run the editor's actual setup with Vue refs; replace only the Feishu SDK boundary.
async function filterEditor() {
  const { ref, computed, reactive } = await import('vue');
  const utils = await import('../src/utils/inputFilter.mjs');
  const source = parse(fs.readFileSync(new URL('../src/components/InputFilterEditor.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const body = parseJS(source, { sourceType: 'module' }).program.body
    .filter(node => node.type !== 'ImportDeclaration').map(node => source.slice(node.start, node.end)).join('\n');
  const props = reactive({ modelValue: null, sourceTableId: '' });
  let active = 'A', fail = false, reads = 0;
  const table = id => ({ id, getFieldMetaList: async () => {
    reads++;
    if (fail) throw new Error('read failed');
    return [{ id: `${id}-field`, name: id, type: 1 }];
  } });
  const bindings = { ref, computed, ...utils, defineProps: () => props,
    defineEmits: () => (_, value) => { props.modelValue = value; }, defineExpose() {},
    bitable: { base: { getActiveTable: async () => table(active), getTableById: async id => table(id) } } };
  const editor = new Function(...Object.keys(bindings), `${body};return {toggle,add,clear,remove,setRule,fields,error,validate,expanded,valueOptions,tableId,loading,handleFieldDropdownVisibleChange: typeof handleFieldDropdownVisibleChange === "function" ? handleFieldDropdownVisibleChange : undefined}`)(...Object.values(bindings));
  return { editor, props, bitable: bindings.bitable, switchTo: id => { active = id; }, failReads: value => { fail = value; }, reads: () => reads };
}

test('清空或删除末条后重新添加，读取当前表；已有条件继续使用原表', async () => {
  const { editor, props, switchTo, reads } = await filterEditor();
  await editor.toggle();
  await editor.add();
  switchTo('B');
  const before = reads();
  await editor.add(0);
  assert.equal(props.modelValue.table_id, 'A');
  assert.equal(reads(), before);
  editor.clear();
  await editor.add();
  assert.equal(props.modelValue.table_id, 'B');
  assert.equal(editor.fields.value[0].id, 'B-field');
  editor.remove(0, 0);
  switchTo('C');
  await editor.add();
  assert.equal(props.modelValue.table_id, 'C');
});

for (const action of ['clear', 'remove-target', 'remove-earlier', 'clear-or', 'unchanged']) {
  test(`添加条件等待字段读取时，删除或清空取消待完成的添加：${action}`, async () => {
    const { editor, props, bitable, failReads } = await filterEditor();
    const rule = value => ({ field_id: 'A-field', field_type: 1, operator: 'eq', value });
    props.modelValue = { version: 1, table_id: 'A', groups: [[rule('first')], [rule('second')], [rule('third')]] };
    failReads(true);
    await editor.toggle();
    let resolveMeta;
    bitable.base.getTableById = async () => ({ id: 'A', getFieldMetaList: () => new Promise(resolve => { resolveMeta = resolve; }) });
    const pending = editor.add(action === 'clear-or' ? undefined : 1);
    await Promise.resolve();
    if (action.startsWith('clear')) editor.clear();
    if (action === 'remove-target') editor.remove(1, 0);
    if (action === 'remove-earlier') editor.remove(0, 0);
    const afterDeletion = JSON.parse(JSON.stringify(props.modelValue));
    resolveMeta([{ id: 'A-field', name: '文本', type: 1 }]);
    await assert.doesNotReject(pending);
    if (action === 'unchanged') {
      assert.deepEqual(props.modelValue.groups.map(group => group.length), [1, 2, 1]);
    } else {
      assert.deepEqual(props.modelValue, afterDeletion);
      // 取消的旧操作不影响用户随后重新添加。
      failReads(false);
      await editor.add();
      assert.equal(props.modelValue.groups.length, (afterDeletion?.groups.length || 0) + 1);
    }
  });
}

test('新增首条时读取失败不沿用旧表，可以重试；编辑任务仍使用指定源表', async () => {
  const { editor, props, switchTo, failReads } = await filterEditor();
  await editor.toggle();
  switchTo('B');
  failReads(true);
  await editor.add();
  assert.equal(props.modelValue, null);
  assert.ok(editor.error.value);
  failReads(false);
  await editor.add();
  assert.equal(props.modelValue.table_id, 'B');
  editor.clear();
  props.sourceTableId = 'A';
  await editor.add();
  assert.equal(props.modelValue.table_id, 'A');
});


for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：校验和筛选合计只读一次元数据；每次执行重新校验`, async () => {
    const { prepareInputFilter, filterRecordIds } = await import('../src/utils/inputFilter.mjs');
    const { editor, props, bitable, reads, switchTo } = await filterEditor();
    props.modelValue = { version: 1, table_id: 'A', groups: [[{ field_id: 'A-field', field_type: 1, operator: 'eq', value: 'yes' }]] };
    const config = { mode: 'table', inputFilter: props.modelValue };
    const validate = pageHandler(page, 'validateConfiguredInputFilter', {
      taskDialogVisible: { value: false }, taskDialogForm: { value: {} },
      inputFilterEditor: { value: editor }, taskInputFilterEditor: { value: null }, bitable, prepareInputFilter,
    });
    const prepared = await validate(config);
    assert.ok(prepared);
    const table = await bitable.base.getActiveTable();
    table.getCellValue = async () => [{ type: 'text', text: 'yes' }];
    assert.deepEqual(await filterRecordIds(table, ['r1'], prepared), ['r1']);
    assert.equal(reads(), 1);
    await validate(config);
    assert.equal(reads(), 2);
    switchTo('B');
    await assert.rejects(validate(config), /其他数据表/);
    assert.equal(editor.expanded.value, true);
    assert.match(editor.error.value, /其他数据表/);
    const otherTable = await bitable.base.getActiveTable();
    await assert.rejects(filterRecordIds(otherTable, ['r1'], prepared), /其他数据表/);
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：保存期间清空、修改或新增条件，不改变已校验的提交内容`, async () => {
    const { prepareInputFilter, cloneInputFilter } = await import('../src/utils/inputFilter.mjs');
    const filter = { version: 1, table_id: 'A', groups: [[{ field_id: 'text', field_type: 1, operator: 'eq', value: '原条件' }]] };
    for (const change of ['clear', 'edit', 'add']) {
      const initial = change === 'add' ? null : cloneInputFilter(filter);
      const config = { mode: 'table', targetType: 'current', scope: 'all', personalBaseToken: 'test-only', triggerTime: '09:00', repeatType: 'hourly', selectedFieldKeys: [], fieldMappings: [], inputFilter: cloneInputFilter(initial) };
      let submitted, validations = 0;
      const bindings = {
        taskDialogForm: { value: config }, cloneInputFilter, validateBaseForm: () => true,
        ensureScheduleTableContext: async () => true, getWriteFieldConfigs: () => [], getActiveFieldConfigs: () => [],
        normalizeTargetType: value => value, normalizeWorkFetchRange: value => value, getTableName: () => 'test',
        getCurrentSourceContext: async () => {
          if (change === 'clear') config.inputFilter = null;
          if (change === 'edit') config.inputFilter.groups[0][0].value = '新条件';
          if (change === 'add') config.inputFilter = cloneInputFilter(filter);
          return { baseId: 'base', sourceTableId: 'A', sourceTableName: 'A', sourceViewId: 'view' };
        },
        TASK_PLUGIN_TYPE: 'test', MANUAL_TABLE_BASE_NAME: 'test', normalizeTimeValue: value => value,
        taskDialogLoading: { value: false }, taskDialogVisible: { value: true }, editingTaskId: { value: '' },
        props: { api_key: 'test-only' }, TASK_API_PATH: '/test', ElNotification() {}, console,
        validateConfiguredInputFilter: async value => {
          validations++;
          return prepareInputFilter(value.inputFilter, [{ id: 'text', name: '文本', type: 1 }], 'A');
        },
        saveTableOutputConfig: async () => {},
        request: async request => { submitted = request.data; return { data: { sta: 0 } }; },
        getDefaultTaskDialogForm: () => ({}), loadTaskList: async () => {},
      };
      bindings.buildTaskPayload = pageHandler(page, 'buildTaskPayload', bindings);
      await pageHandler(page, 'saveTask', bindings)();
      assert.ok(submitted, change);
      assert.deepEqual(submitted.snapshot.input_filter ?? null, initial, change);
      assert.equal(validations, 1);
    }
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch']) {
  test(`${page}：接口等待期间切表仍写回源表，写入失败不计成功`, async () => {
    const writes = [];
    let activeReads = 0, missing = false, rejectWrite = false;
    const table = {
      id: 'A', getFieldById: async () => {
        if (missing) throw new Error('源字段已删除');
        return { getType: async () => 1, createCell: async value => ({ getValue: async () => value }) };
      },
      setRecord: async (id, data) => { if (rejectWrite) throw new Error('无写入权限'); writes.push({ table: 'A', id, data }); },
    };
    const bindings = {
      bitable: { base: { getActiveTable: async () => { activeReads++; throw new Error('执行期间已切到 B 表，不应重新读取当前表'); } } },
      FieldType: { Attachment: 17 }, normalizeFieldValue: value => value,
      stopRequested: { value: false }, props: { api_key: 'test-only' }, TASK_TOAST_SUFFIX: '',
      console: { log() {}, warn() {}, error() {} }, showToast() {}, ElNotification() {},
      request: async () => ({ data: { sta: 0, data: { title: '结果' } } }),
    };
    const write = pageHandler(page, 'writeDataToRecord', bindings);
    const fetch = pageHandler(page, page === 'VideoDataFetch' ? 'fetchVideoDataByRows' : 'fetchBloggerInfoByRows', bindings);
    const configs = [{ name: '标题', key: 'title', type: 1, getValue: item => item.title }];
    const run = () => fetch([{ recordId: 'rA', url: 'https://example.test' }], {
      onSuccess: item => write(table, item.__recordId, item, { 标题: 'fA' }, configs),
    });
    assert.equal((await run()).successCount, 1);
    assert.deepEqual(writes, [{ table: 'A', id: 'rA', data: { fields: { fA: '结果' } } }]);
    missing = true;
    assert.deepEqual(await run(), { successCount: 0, failCount: 1, stopped: false });
    missing = false; rejectWrite = true;
    assert.deepEqual(await run(), { successCount: 0, failCount: 1, stopped: false });
    assert.equal(writes.length, 1);
    assert.equal(activeReads, 0);
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：范围与链接读取使用传入源表`, async () => {
    const ids = ['A-row'];
    const view = { getSelectedRecordIdList: async () => ids };
    const table = { getActiveView: async () => view, getFieldById: async id => {
      assert.equal(id, 'A-link');
      return { getCell: async recordId => { assert.equal(recordId, 'A-row'); return { getValue: async () => 'https://example.test/A' }; } };
    } };
    const bindings = { bitable: { base: { getActiveTable: () => assert.fail('不应读取新当前表') } },
      console: { log() {} }, getAllVisibleRecordIdList: async v => { assert.equal(v, view); return ids; },
      extractUrlHint: value => value, extractProfileLink: value => value };
    const scope = pageHandler(page, 'getRecordIdListByScope', bindings);
    assert.deepEqual(await scope(table, 'selected', 1), ids);
    assert.deepEqual(await scope(table, 'n', 1), ids);
    const read = pageHandler(page, page === 'ProfileFetch' ? 'getProfileUrlsByFieldId' : 'getCellValuesByFieldId', bindings);
    const rows = await read(table, ids, 'A-link');
    assert.equal(page === 'ProfileFetch' ? rows[0] : rows[0].url, 'https://example.test/A');
  });
}

// Keep the SDK's real field transforms; substitute only host metadata and writes.
async function videoOutputTable() {
  const base = Object.create(bitable.base, {
    isTableExist: { value: async () => true },
    tableMapCache: { value: new Map() },
  });
  const table = await base.getTableById('output');
  const meta = [
    { id: 'author', name: '作者名称', type: FieldType.Text },
    { id: 'tags', name: '标签', type: FieldType.MultiSelect, property: { options: [] } },
    { id: 'platform', name: '平台', type: FieldType.Text },
    { id: 'video', name: '作品ID', type: FieldType.Text },
  ];
  const writes = [];
  Object.defineProperties(table, {
    isFieldExist: { value: async id => meta.some(field => field.id === id) },
    getFieldMetaById: { value: async id => meta.find(field => field.id === id) },
    getFieldMetaList: { value: async () => meta },
    setField: { value: async (id, config) => {
      const field = meta.find(field => field.id === id);
      field.property = { ...config.property, options: config.property.options.map((option, index) => ({ id: option.id || `option-${index}`, ...option })) };
    } },
    setRecord: { value: async (recordId, record) => writes.push({ recordId, ...record }) },
    setRecords: { value: async records => writes.push(...records) },
    addRecords: { value: async records => {
      for (const cells of records) {
        const entries = await Promise.all(cells.map(async cell => [cell.getFieldId(), await cell.getValue()]));
        writes.push({ fields: Object.fromEntries(entries) });
      }
    } },
    getRecordsByPage: { value: async () => ({ records: [{ recordId: 'existing', fields: {
      platform: [{ type: 'text', text: 'xhs' }], video: [{ type: 'text', text: 'video-1' }],
    } }], hasMore: false }) },
  });
  for (const field of await table.getFieldList()) {
    Object.defineProperties(field, {
      getName: { value: async () => meta.find(item => item.id === field.id).name },
      getType: { value: async () => field.type },
      getMeta: { value: async () => meta.find(item => item.id === field.id) },
    });
  }
  return { table, writes };
}

for (const caption of [undefined, null, '', '  \n ', [], [' ', '']]) {
  test(`作品详情：空标签 ${JSON.stringify(caption)} 使用真实 SDK 写入当前表，不影响作者名称`, async () => {
    const { table, writes } = await videoOutputTable();
    const bindings = { FieldType, DateFormatter, NumberFormatter, httpToHttps: value => value,
      console: { log() {}, error() {} }, stopRequested: { value: false }, props: { api_key: 'test-only' },
      TASK_TOAST_SUFFIX: '', showToast() {},
      request: async () => ({ data: { sta: 0, data: { nickname: '正常作者', caption } } }),
      ElNotification: value => assert.fail(value.message),
      writeErrorMessageToFirstField: () => assert.fail('成功响应不应覆盖作者名称'),
    };
    bindings.normalizeTagTextValue = pageHandler('VideoDataFetch', 'normalizeTagTextValue', bindings);
    bindings.normalizeFieldValue = pageHandler('VideoDataFetch', 'normalizeFieldValue', bindings);
    const configs = pageHandler('VideoDataFetch', 'FIELD_CONFIG', bindings).filter(config => ['nickname', 'caption'].includes(config.key));
    const write = pageHandler('VideoDataFetch', 'writeDataToRecord', bindings);
    const fetch = pageHandler('VideoDataFetch', 'fetchVideoDataByRows', bindings);
    const result = await fetch([{ recordId: 'r1', url: 'https://example.test' }], {
      sourceTable: table, writeFailureToCurrent: true, fieldNameToId: { 作者名称: 'author', 标签: 'tags' },
      activeFieldConfigs: configs,
      onSuccess: item => write(table, item.__recordId, item, { 作者名称: 'author', 标签: 'tags' }, configs),
    });
    assert.deepEqual(result, { successCount: 1, failCount: 0, stopped: false });
    assert.deepEqual(writes, [{ recordId: 'r1', fields: { author: [{ type: 'text', text: '正常作者' }], tags: [] } }]);
  });
}

for (const writeMode of ['append', 'upsert']) {
  test(`作品详情：${writeMode} 使用真实 SDK 写入空标签及非空标签`, async () => {
    const { table, writes } = await videoOutputTable();
    const bindings = { FieldType, DateFormatter, NumberFormatter, httpToHttps: value => value,
      bitable: { base: { getTableById: async () => table } }, console: { log() {}, error() {} } };
    bindings.normalizeTagTextValue = pageHandler('VideoDataFetch', 'normalizeTagTextValue', bindings);
    bindings.normalizeFieldValue = pageHandler('VideoDataFetch', 'normalizeFieldValue', bindings);
    bindings.FIELD_CONFIG = pageHandler('VideoDataFetch', 'FIELD_CONFIG', bindings);
    bindings.createCellValue = pageHandler('VideoDataFetch', 'createCellValue', bindings);
    const configs = bindings.FIELD_CONFIG.filter(config => ['nickname', 'caption', 'social_type', 'social_id'].includes(config.key));
    const append = pageHandler('VideoDataFetch', 'appendRecordsToTable', bindings);
    for (const caption of ['', '标签一 标签二']) {
      await append('output', [{ nickname: '正常作者', caption, social_type: 'xhs', social_id: 'video-1' }], configs, { writeMode });
    }
    assert.equal(writes.length, 2);
    assert.deepEqual(writes.map(record => record.fields.author), Array(2).fill([{ type: 'text', text: '正常作者' }]));
    assert.deepEqual(writes[0].fields.tags, []);
    assert.deepEqual(writes[1].fields.tags.map(tag => tag.text), ['标签一', '标签二']);
    assert.equal(writes[0].recordId, writeMode === 'upsert' ? 'existing' : undefined);
  });
}

test('作品详情：接口成功后本地写入失败，不把异常写入作者名称', async () => {
  const notifications = [];
  const bindings = {
    console: { log() {}, error() {} }, stopRequested: { value: false }, props: { api_key: 'test-only' },
    TASK_TOAST_SUFFIX: '', showToast() {}, ElNotification: value => notifications.push(value),
    request: async () => ({ data: { sta: 0, data: { nickname: '正常作者' } } }),
    writeErrorMessageToFirstField: () => assert.fail('本地写入异常不应覆盖作者名称'),
  };
  const fetch = pageHandler('VideoDataFetch', 'fetchVideoDataByRows', bindings);
  const result = await fetch([{ recordId: 'r1', url: 'https://example.test' }], {
    sourceTable: {}, writeFailureToCurrent: true, fieldNameToId: { 作者名称: 'author' },
    activeFieldConfigs: [{ name: '作者名称' }],
    onSuccess: async () => { throw new TypeError('e11 is not iterable'); },
  });
  assert.deepEqual(result, { successCount: 0, failCount: 1, stopped: false });
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].message, /写入失败.*e11 is not iterable/);
});

test('作品详情失败信息写回源表，切表后不会写入新当前表', async () => {
  const writes = [];
  const table = { getFieldById: async id => ({ setValue: async (record, value) => writes.push({ id, record, value }) }) };
  const bindings = { bitable: { base: { getActiveTable: () => assert.fail('不应读取新当前表') } },
    console: { log() {}, error() {} }, stopRequested: { value: false }, props: { api_key: 'test-only' },
    TASK_TOAST_SUFFIX: '', showToast() {}, request: async () => ({ data: { sta: 1, msg: '测试业务失败' } }) };
  bindings.writeErrorMessageToFirstField = pageHandler('VideoDataFetch', 'writeErrorMessageToFirstField', bindings);
  const fetch = pageHandler('VideoDataFetch', 'fetchVideoDataByRows', bindings);
  const result = await fetch([{ recordId: 'rA', url: 'https://example.test' }], {
    sourceTable: table, writeFailureToCurrent: true, fieldNameToId: { 标题: 'fA' }, activeFieldConfigs: [{ name: '标题' }],
  });
  assert.equal(result.failCount, 1);
  assert.deepEqual(writes, [{ id: 'fA', record: 'rA', value: '测试业务失败' }]);
});

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：在 B 表编辑 A 表任务，保存和字段选项仍使用 A 表原视图`, async () => {
    const { prepareInputFilter } = await import('../src/utils/inputFilter.mjs');
    const filter = { version: 1, table_id: 'A', groups: [[{ field_id: 'A-link', field_type: 1, operator: 'not_empty' }]] };
    const config = { mode: 'table', sourceTableId: 'A', sourceViewId: 'A-view', baseId: 'base', targetType: 'current', scope: 'all', personalBaseToken: 'test', triggerTime: '09:00', repeatType: 'hourly', selectedFieldKeys: [], videoLinkFieldId: 'A-link', profileLinkFieldId: 'A-link', inputFilter: filter };
    let failTable = false, failView = false;
    const meta = [{ id: 'A-link', name: '原表链接', type: 1 }];
    const view = { id: 'A-view', getName: async () => '原视图', getFieldMetaList: async () => meta };
    const table = { id: 'A', getName: async () => '原表', getFieldMetaList: async () => meta,
      getViewById: async id => { assert.equal(id, 'A-view'); if (failView) throw new Error('视图已删除'); return view; },
      getActiveView: async () => ({ ...view, id: 'other-view' }) };
    const current = { id: 'B', getName: async () => '当前表', getActiveView: async () => ({ ...view, id: 'B-view' }), getFieldMetaList: async () => [] };
    const bindings = { taskDialogForm: { value: config }, taskDialogMode: { value: 'edit' }, taskDialogVisible: { value: true },
      fieldOptions: { value: [] }, FieldType: { Url: 15, Text: 1 }, console: { error() {} }, ElNotification() {}, showErrorMsg() {},
      bitable: { base: { getSelection: async () => ({ baseId: 'base', tableId: 'B' }), getActiveTable: async () => current,
        getTableById: async id => { assert.equal(id, 'A'); if (failTable) throw new Error('原表无权限'); return table; } } },
      getFieldNameById: async (id) => id === 'A' ? '原表链接' : '错误表链接', prepareInputFilter,
      inputFilterEditor: { value: null }, taskInputFilterEditor: { value: null }, validateBaseForm: () => true,
      getWriteFieldConfigs: () => [], getActiveFieldConfigs: () => [], normalizeTargetType: x => x, normalizeWorkFetchRange: x => x,
      getTableName: () => 'output', TASK_PLUGIN_TYPE: 'test', MANUAL_TABLE_BASE_NAME: 'output', normalizeTimeValue: x => x,
    };
    bindings.ensureScheduleTableContext = pageHandler(page, 'ensureScheduleTableContext', bindings);
    bindings.getCurrentSourceContext = pageHandler(page, 'getCurrentSourceContext', bindings);
    const validate = pageHandler(page, 'validateConfiguredInputFilter', bindings);
    const build = pageHandler(page, 'buildTaskPayload', bindings);
    const loadFields = pageHandler(page, page === 'ProfileFetch' ? 'loadFieldOptions' : 'getFieldListByType', bindings);
    const prepared = await validate(config);
    const payload = await build(prepared);
    assert.equal(payload.snapshot.source_table_id, 'A');
    assert.equal(payload.snapshot.source_view_id, 'A-view');
    if (page !== 'ProfileFetch') assert.equal(payload.snapshot.resolved_target_table_id, 'A');
    await loadFields({ silent: true });
    assert.deepEqual(bindings.fieldOptions.value, [{ id: 'A-link', name: '原表链接' }]);
    failView = true;
    await assert.rejects(build(prepared), /视图/);
    failView = false; failTable = true;
    await assert.rejects(validate(config), /原表无权限/);
    assert.equal(await build(prepared), null);
    failTable = false;
    bindings.taskDialogMode.value = 'create';
    config.inputFilter = null;
    const created = await build(null);
    assert.equal(created.snapshot.source_table_id, 'B');
    assert.equal(created.snapshot.source_view_id, 'B-view');
  });
}

test('VideoDataFetch：跨表编辑保存任务时，字段映射写入原来源表', async () => {
  const config = { mode: 'table', targetType: 'current', sourceTableId: 'A', resolvedTargetTableId: 'A', fieldMappings: [], writeMode: 'upsert' };
  const writes = [];
  const bindings = {
    taskDialogForm: { value: config }, taskDialogMode: { value: 'edit' }, editingTaskId: { value: 'task' }, taskDialogLoading: { value: false }, taskDialogVisible: { value: true },
    tableConfigsLoaded: { value: true }, mainOutputTableId: { value: 'A' }, taskOutputTableId: { value: 'A' },
    formData: { value: {} }, tableConfigSaving: { value: false }, tableConfigSaveStatus: { value: '' }, tableOutputConfigs: { value: {} }, tableFieldOptions: { value: [] }, FIELD_CONFIG: [],
    bitable: { base: { getActiveTable: async () => ({ id: 'B' }), getSelection: async () => ({ baseId: 'base' }) } },
    getTableNameById: async id => id, props: { api_key: 'test' }, TASK_PLUGIN_TYPE: 'test', TABLE_CONFIG_API_PATH: '/mapping', TASK_API_PATH: '/tasks',
    validateConfiguredInputFilter: async () => null, buildTaskPayload: async () => ({ snapshot: { source_table_id: 'A' } }),
    request: async args => { writes.push(args); return { data: { sta: 0 } }; },
    ElNotification() {}, console, getDefaultTaskDialogForm: () => ({}), loadTaskList: async () => {},
  };
  bindings.saveTableOutputConfig = pageHandler('VideoDataFetch', 'saveTableOutputConfig', bindings);
  await pageHandler('VideoDataFetch', 'saveTask', bindings)();
  assert.equal(writes.length, 2);
  assert.equal(writes[0].data.target_table_id, 'A');
});

for (const page of ['VideoDataFetch', 'BloggerInfoFetch']) {
  test(`${page}：筛选期间停止后不读取链接、不准备输出，并结束运行状态`, async () => {
    for (const matched of [[], ['r1']]) {
      const calls = [], notices = [], toasts = [];
      const stopRequested = { value: false }, loading = { value: false };
      const bindings = {
        formData: { value: { mode: 'table', scope: 'all', targetType: 'current' } },
        selectedFieldKeys: { value: [] }, props: { api_key: 'test-only' },
        stopRequested, loading, console: { log() {}, error() {} }, validateBaseForm: () => true,
        bitable: { base: { getActiveTable: async () => ({ id: 'A' }) } },
        validateConfiguredInputFilter: async () => ({ version: 1 }), getActiveFieldConfigs: () => [],
        getRecordIdListByScope: async () => ['r1'],
        filterRecordIds: async () => { stopRequested.value = true; return matched; },
        getCellValuesByFieldId: async () => { calls.push('read-links'); return []; },
        validateAndAddFields: async () => { calls.push('prepare-output'); return null; },
        showToast: (message, running) => toasts.push({ message, running }), hideToast() {}, setTimeout() {},
        ElNotification: value => notices.push(value),
      };
      await pageHandler(page, 'handleTableModeSubmit', bindings)();
      assert.deepEqual(calls, []);
      assert.deepEqual(notices, []);
      assert.ok(toasts.some(item => item.message.includes('已停止') && item.running === false));
      assert.equal(loading.value, false);
      assert.equal(stopRequested.value, false);
    }
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch']) {
  test(`${page}：读取链接期间停止后不准备输出，并结束运行状态`, async () => {
    for (const matched of [[], ['r1']]) {
      const calls = [], notices = [], toasts = [];
      const stopRequested = { value: false }, loading = { value: false };
      const bindings = {
        formData: { value: { mode: 'table', scope: 'all', targetType: 'current' } },
        selectedFieldKeys: { value: [] }, props: { api_key: 'test-only' },
        stopRequested, loading, console: { log() {}, error() {} }, validateBaseForm: () => true,
        bitable: { base: { getActiveTable: async () => ({ id: 'A' }) } },
        validateConfiguredInputFilter: async () => ({ version: 1 }), getActiveFieldConfigs: () => [],
        getRecordIdListByScope: async () => ['r1'],
        filterRecordIds: async () => ['r1'],
        getCellValuesByFieldId: async () => { stopRequested.value = true; return matched.map(recordId => ({ recordId, url: 'https://example.test' })); },
        validateAndAddFields: async () => { calls.push('prepare-output'); return null; },
        showToast: (message, running) => toasts.push({ message, running }), hideToast() {}, setTimeout() {},
        ElNotification: value => notices.push(value),
      };
      await pageHandler(page, 'handleTableModeSubmit', bindings)();
      assert.deepEqual(calls, []);
      assert.deepEqual(notices, []);
      assert.ok(toasts.some(item => item.message.includes('已停止') && item.running === false));
      assert.equal(loading.value, false);
      assert.equal(stopRequested.value, false);
    }
  });
}

for (const groupIndex of [0, undefined]) {
  test(`已有条件加载失败后，点击${groupIndex === 0 ? '并且' : '或者'}可重试且保留原条件`, async () => {
    const { editor, props, failReads, reads } = await filterEditor();
    props.modelValue = { version: 1, table_id: 'A', groups: [[{ field_id: 'A-field', field_type: 1, operator: 'eq', value: 'yes' }]] };
    const original = JSON.parse(JSON.stringify(props.modelValue.groups[0][0]));
    failReads(true);
    await editor.toggle();
    assert.ok(editor.error.value);
    const before = reads();
    await editor.add(groupIndex);
    assert.equal(reads(), before + 1);
    assert.deepEqual(props.modelValue.groups.map(group => group.length), [1]);
    assert.ok(editor.error.value);
    failReads(false);
    await editor.add(groupIndex);
    assert.equal(reads(), before + 2);
    assert.deepEqual(props.modelValue.groups.map(group => group.length), groupIndex === 0 ? [2] : [1, 1]);
    assert.deepEqual(props.modelValue.groups[0][0], original);
    assert.equal(props.modelValue.table_id, 'A');
    assert.equal(editor.error.value, '');
  });
}


test('展开筛选字段下拉框时刷新原表字段，关闭不刷新，读取失败后可再次展开重试', async () => {
  const { editor, props, bitable, switchTo } = await filterEditor();
  assert.equal(typeof editor.handleFieldDropdownVisibleChange, 'function');
  props.modelValue = { version: 1, table_id: 'A', groups: [[{ field_id: 'A-field', field_type: 1, operator: 'eq', value: 'yes' }]] };
  const original = JSON.parse(JSON.stringify(props.modelValue));
  let fields = [{ id: 'A-field', name: '原字段', type: 1 }], reads = 0, fail = false;
  bitable.base.getTableById = async id => {
    assert.equal(id, 'A');
    return { id, getFieldMetaList: async () => { reads++; if (fail) throw new Error('temporary'); return fields; } };
  };
  switchTo('B');
  await editor.handleFieldDropdownVisibleChange(true);
  assert.equal(reads, 1);
  fields = [...fields, { id: 'A-new', name: '新增字段', type: 1 }];
  await editor.handleFieldDropdownVisibleChange(false);
  assert.equal(reads, 1);
  await editor.handleFieldDropdownVisibleChange(true);
  assert.equal(reads, 2);
  assert.deepEqual(editor.fields.value.map(field => field.id), ['A-field', 'A-new']);
  fail = true;
  await editor.handleFieldDropdownVisibleChange(true);
  assert.ok(editor.error.value);
  fail = false;
  await editor.handleFieldDropdownVisibleChange(true);
  assert.equal(editor.error.value, '');
  assert.deepEqual(props.modelValue, original);
});

test('面板首次展开加载，反复收展不重复读取；字段下拉框仍刷新', async () => {
  const { editor, props, reads } = await filterEditor();
  props.modelValue = { version: 1, table_id: 'A', groups: [[{ field_id: 'A-field', field_type: 1, operator: 'eq', value: 'yes' }]] };
  await editor.toggle();
  assert.equal(reads(), 1);
  assert.equal(editor.fields.value[0].id, 'A-field');
  await editor.toggle();
  await editor.toggle();
  assert.equal(reads(), 1);
  await editor.handleFieldDropdownVisibleChange(true);
  assert.equal(reads(), 2);
});

test('面板首次加载失败，再次展开可以重试；加载中的反复收展不重复请求', async () => {
  const { editor, failReads, reads } = await filterEditor();
  failReads(true);
  await editor.toggle();
  assert.ok(editor.error.value);
  failReads(false);
  await editor.toggle();
  await editor.toggle();
  assert.equal(reads(), 2);
  assert.equal(editor.error.value, '');

  const pending = await filterEditor();
  let resolveFields, pendingReads = 0;
  pending.bitable.base.getActiveTable = async () => ({ id: 'A', getFieldMetaList: () => {
    pendingReads++;
    return new Promise(resolve => { resolveFields = resolve; });
  } });
  const opening = pending.editor.toggle();
  await Promise.resolve();
  await pending.editor.toggle();
  const reopening = pending.editor.toggle();
  await Promise.resolve();
  assert.equal(pendingReads, 1);
  resolveFields([]);
  await Promise.all([opening, reopening]);
  await pending.editor.toggle();
  await pending.editor.toggle();
  assert.equal(pendingReads, 1);
});


test('展开状态选项下拉框刷新新增选项，失败可重试且保留选中值', async () => {
  const { editor, props, bitable } = await filterEditor();
  const rule = { field_id: 'status', field_type: 3, operator: 'eq', value: 'active' };
  props.modelValue = { version: 1, table_id: 'A', groups: [[rule]] };
  let options = [{ id: 'active', name: '进行中' }], reads = 0, fail = false;
  bitable.base.getTableById = async () => ({ id: 'A', getFieldMetaList: async () => {
    reads++;
    if (fail) throw new Error('temporary');
    return [{ id: 'status', name: '状态', type: 3, property: { options: options.map(item => ({ ...item })) } }];
  } });
  await editor.toggle();
  options.push({ id: 'pending', name: '待更新' });
  // Dispatch the actual template binding, so a missing visible-change handler is caught.
  const template = parse(fs.readFileSync(new URL('../src/components/InputFilterEditor.vue', import.meta.url), 'utf8')).descriptor.template.ast;
  const findSelect = node => {
    if (node.tag === 'el-select' && node.props.some(prop => prop.name === 'aria-label' && prop.value?.content === '状态选项')) return node;
    for (const child of node.children || []) { const found = findSelect(child); if (found) return found; }
  };
  const binding = findSelect(template).props.find(prop => prop.name === 'on' && prop.arg?.content === 'visible-change');
  const dispatch = visible => binding ? editor[binding.exp.content](visible) : Promise.resolve();
  await dispatch(false);
  assert.equal(reads, 1);
  await dispatch(true);
  assert.deepEqual(editor.valueOptions(rule).map(item => item.name), ['进行中', '待更新']);
  fail = true;
  await dispatch(true);
  assert.ok(editor.error.value);
  fail = false;
  await dispatch(true);
  assert.equal(editor.error.value, '');
  assert.equal(props.modelValue.groups[0][0].value, 'active');
});


test('字段读取尚未成功或读取失败时不标已失效，读取成功确认缺失后才标记', async () => {
  const { editor, props, bitable } = await filterEditor();
  const rule = { field_id: 'status', field_name: '状态', field_type: 3, operator: 'eq', value: 'active' };
  props.modelValue = { version: 1, table_id: 'A', groups: [[rule]] };
  const original = JSON.parse(JSON.stringify(props.modelValue));
  const template = parse(fs.readFileSync(new URL('../src/components/InputFilterEditor.vue', import.meta.url), 'utf8')).descriptor.template.ast;
  const fallbacks = [];
  const visit = node => {
    if (node.tag === 'el-option' && node.props.some(prop => prop.name === 'disabled')) fallbacks.push(node);
    for (const child of node.children || []) visit(child);
  };
  visit(template);
  const labels = () => fallbacks.map(node => {
    const label = node.props.find(prop => prop.name === 'label' || (prop.name === 'bind' && prop.arg?.content === 'label'));
    return label.name === 'label' ? label.value.content
      : new Function('rule', 'tableId', 'loading', `return (${label.exp.content});`)(rule, editor.tableId.value, editor.loading.value);
  });
  assert.deepEqual(labels(), ['状态', '原选项']);
  let resolveMeta, rejectMeta;
  bitable.base.getTableById = async () => ({ id: 'A', getFieldMetaList: () => new Promise((resolve, reject) => { resolveMeta = resolve; rejectMeta = reject; }) });
  const first = editor.toggle();
  await Promise.resolve();
  assert.deepEqual(labels(), ['状态', '原选项']);
  rejectMeta(new Error('temporary'));
  await first;
  assert.ok(editor.error.value);
  assert.deepEqual(labels(), ['状态', '原选项']);
  const retry = editor.handleFieldDropdownVisibleChange(true);
  await Promise.resolve();
  resolveMeta([]);
  await retry;
  assert.deepEqual(labels(), ['状态（已失效）', '原选项（已失效）']);
  const refresh = editor.handleFieldDropdownVisibleChange(true);
  await Promise.resolve();
  assert.deepEqual(labels(), ['状态', '原选项']);
  rejectMeta(new Error('temporary'));
  await refresh;
  assert.deepEqual(labels(), ['状态', '原选项']);
  assert.deepEqual(props.modelValue, original);
});

for (const scenario of [
  { from: 1, to: 3, operator: 'eq', value: '待更新', expectedOperator: 'eq', nextValue: 'pending' },
  { from: 1, to: 7, operator: 'contains', value: 'yes', expectedOperator: 'eq', nextValue: false },
  { from: 3, to: 1, operator: 'ne', value: 'pending', expectedOperator: 'ne', nextValue: '完成' },
  { from: 1, to: 3, operator: 'empty', value: null, expectedOperator: 'empty', nextValue: null },
]) {
  test(`字段类型变化 ${scenario.from}→${scenario.to}：保留条件行并重置比较值`, async () => {
    const { editor, props, bitable } = await filterEditor();
    props.modelValue = { version: 1, table_id: 'A', groups: [[
      { field_id: 'status', field_name: '状态', field_type: scenario.from, operator: scenario.operator, value: scenario.value },
      { field_id: 'other', field_type: 1, operator: 'eq', value: '保留' },
    ]] };
    const other = JSON.parse(JSON.stringify(props.modelValue.groups[0][1]));
    const table = { id: 'A', getFieldMetaList: async () => [
      { id: 'status', name: '状态', type: scenario.to, property: { options: [{ id: 'pending', name: '待更新' }] } },
      { id: 'other', name: '其他', type: 1 },
    ] };
    bitable.base.getTableById = async () => table;
    await editor.toggle();
    const rule = props.modelValue.groups[0][0];
    assert.equal(rule.field_type, scenario.to);
    assert.equal(rule.operator, scenario.expectedOperator);
    assert.equal(rule.value, scenario.to === 7 || scenario.operator === 'empty' ? null : '');
    assert.deepEqual(props.modelValue.groups[0][1], other);
    assert.match(editor.error.value, /字段类型已改变/);
    if (scenario.operator !== 'empty') {
      await assert.rejects(editor.validate(table));
      editor.setRule(0, 0, 'value', scenario.nextValue);
    }
    const prepared = await editor.validate(table);
    assert.equal(prepared.groups[0][0].value, scenario.nextValue);
  });
}

test('执行校验首次发现字段类型变化时更新编辑器，但阻止本次执行', async () => {
  const { editor, props } = await filterEditor();
  props.modelValue = { version: 1, table_id: 'A', groups: [[{ field_id: 'status', field_type: 1, operator: 'eq', value: '旧值' }]] };
  const table = { id: 'A', getFieldMetaList: async () => [{ id: 'status', name: '状态', type: 7 }] };
  await assert.rejects(editor.validate(table));
  assert.equal(props.modelValue.groups[0][0].field_type, 7);
  assert.equal(props.modelValue.groups[0][0].value, null);
});

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  for (const outcome of ['invalid', 'error', 'valid']) {
    test(`${page}：任务参数${outcome}，校验通过前不保存输出表配置`, async () => {
      const calls = [];
      const taskDialogLoading = { value: false };
      const bindings = {
        taskDialogLoading,
        taskDialogForm: { value: { targetType: 'existing', targetTableId: 'target', fieldMappings: [] } },
        taskMappingDraft: { value: [] }, mappingDraft: { value: [] },
        taskDialogMode: { value: 'edit' }, taskDialogVisible: { value: true },
        editingTaskId: { value: 'task' }, props: { api_key: 'test-only' }, TASK_API_PATH: '/tasks',
        normalizeTargetType: type => type,
        validateConfiguredInputFilter: async () => null,
        buildTaskPayload: async () => {
          calls.push('validate');
          if (outcome === 'error') throw new Error('无法访问来源表');
          return outcome === 'valid' ? { name: 'task' } : null;
        },
        saveTableOutputConfig: async () => { calls.push('mapping'); },
        request: async () => { calls.push('task'); return { data: { sta: 0 } }; },
        ElNotification() {}, console: { error() {} },
        getDefaultTaskDialogForm: () => ({}), loadTaskList: async () => {},
      };
      await pageHandler(page, 'saveTask', bindings)();
      assert.deepEqual(calls, outcome === 'valid' ? ['validate', 'mapping', 'task'] : ['validate']);
      assert.equal(taskDialogLoading.value, false);
    });
  }
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch']) {
  for (const failed of [true, false]) {
    test(`${page}：输出配置业务${failed ? '失败阻止任务保存' : '成功后继续保存任务'}`, async () => {
      const calls = [], notifications = [];
      const oldConfig = { write_mode: 'upsert' }, savedConfig = { write_mode: 'append' };
      const config = { targetType: 'existing', targetTableId: 'target', writeMode: 'append', fieldMappings: [] };
      const bindings = {
        taskDialogLoading: { value: false }, taskDialogVisible: { value: true },
        taskDialogForm: { value: config }, formData: { value: config },
        taskMappingDraft: { value: [] }, mappingDraft: { value: [] },
        tableConfigSaving: { value: false }, tableConfigSaveStatus: { value: '' },
        tableConfigsLoaded: { value: true }, loadedTableConfigs: { value: new Set(['target']) },
        mainOutputTableId: { value: 'target' }, taskOutputTableId: { value: 'target' }, tableConfigApplying: { value: false },
        tableOutputConfigs: { value: { target: oldConfig } }, tableFieldOptions: { value: [] },
        taskDialogMode: { value: 'edit' }, editingTaskId: { value: 'task' },
        props: { api_key: 'test-only' }, TASK_PLUGIN_TYPE: 'test',
        TASK_API_PATH: '/tasks', TABLE_CONFIG_API_PATH: '/output-config', FIELD_CONFIG: [],
        bitable: { base: { getSelection: async () => ({ baseId: 'base' }),
          getTableById: async () => ({ getName: async () => '目标表' }) } },
        getTableNameById: async () => '目标表',
        validateConfiguredInputFilter: async () => null,
        buildTaskPayload: async () => ({ name: 'task' }),
        request: async ({ url }) => {
          calls.push(url);
          return { data: url === '/output-config'
            ? (failed ? { sta: 1, msg: '字段映射无效' } : { sta: 0, data: savedConfig })
            : { sta: 0 } };
        },
        ElNotification: value => notifications.push(value), console: { error() {} },
        getDefaultTaskDialogForm: () => ({}), loadTaskList: async () => {},
      };
      bindings.saveTableOutputConfig = pageHandler(page, 'saveTableOutputConfig', bindings);
      await pageHandler(page, 'saveTask', bindings)();
      assert.deepEqual(calls, failed ? ['/output-config'] : ['/output-config', '/tasks/task']);
      assert.deepEqual(bindings.tableOutputConfigs.value.target, failed ? oldConfig : savedConfig);
      assert.equal(bindings.tableConfigSaveStatus.value, failed ? '保存失败' : '已保存');
      assert.equal(bindings.tableConfigSaving.value, false);
      assert.equal(bindings.taskDialogLoading.value, false);
      assert.equal(bindings.taskDialogVisible.value, failed);
      assert.equal(notifications[0].type, failed ? 'error' : 'success');
      if (failed) assert.equal(notifications[0].message, '字段映射无效');
    });
  }
}

for (const [page, loader] of [
  ['VideoDataFetch', 'loadTableOutputConfigs'],
  ['ProfileFetch', 'loadTableOutputConfigs'],
  ['BloggerInfoFetch', 'loadTableOutputConfig'],
  ['BloggerInfoFetch', 'applyTaskTableOutputConfig'],
]) {
  for (const failure of ['business', 'network']) {
    test(`${page}/${loader}：读取${failure}失败保留映射并阻止保存，重新读到空配置后可保存`, async () => {
      const mapping = [{ source_key: 'name', target_field_id: 'field' }];
      const cached = page === 'ProfileFetch' ? {} : { target: { target_table_id: 'target', field_mappings: mapping } };
      let failed = true, writes = 0;
      const config = { targetType: 'existing', targetTableId: 'target', writeMode: 'upsert', fieldMappings: [...mapping] };
      const bindings = {
        props: { api_key: 'test-only' }, TABLE_CONFIGS_API_PATH: '/configs', TABLE_CONFIG_API_PATH: '/config', TASK_PLUGIN_TYPE: 'test',
        tableConfigsLoaded: { value: true }, loadedTableConfigs: { value: new Set(['target']) },
        mainOutputTableId: { value: 'target' }, taskOutputTableId: { value: 'target' }, tableConfigApplying: { value: false },
        tableConfigLoading: { value: false }, tableConfigSaving: { value: false }, tableConfigSaveStatus: { value: '' },
        tableOutputConfigs: { value: cached }, taskDialogForm: { value: config }, formData: { value: config },
        mappingDraft: { value: [...mapping] }, taskMappingDraft: { value: [...mapping] }, writeMode: { value: 'upsert' },
        tableFieldOptions: { value: [] }, FIELD_CONFIG: [],
        bitable: { base: { getSelection: async () => ({ baseId: 'base' }),
          getTableById: async () => ({ getName: async () => '目标表' }) } },
        getTableNameById: async () => '目标表', getTableFields: async () => {},
        ElNotification() {}, console: { error() {} },
        request: async ({ method }) => {
          if (method === 'put') { writes++; return { data: { sta: 0, data: {} } }; }
          if (failed && failure === 'network') throw new Error('网络失败');
          return { data: failed ? { sta: 1, msg: '读取失败' } : { sta: 0, data: [] } };
        },
      };
      if (page === 'ProfileFetch') {
        Object.assign(bindings, {
          getBaseId: async () => 'base', normalizeTargetType: type => type,
          PROFILE_FIELD_MAPPING: [],
          cloneFieldMappings: items => items.map(item => ({ ...item })),
          loadTargetFieldOptions: async () => {},
        });
        bindings.unwrapApiData = pageHandler(page, 'unwrapApiData', bindings);
        bindings.getTableConfig = pageHandler(page, 'getTableConfig', bindings);
        bindings.applyTableConfig = pageHandler(page, 'applyTableConfig', bindings);
      }
      const load = pageHandler(page, loader, bindings);
      const save = pageHandler(page, 'saveTableOutputConfig', bindings);
      await load('target');
      if (page === 'ProfileFetch') {
        await bindings.applyTableConfig('target');
        await pageHandler(page, 'applyTaskTableConfig', bindings)('target');
      }
      assert.deepEqual(bindings.tableOutputConfigs.value, cached);
      assert.deepEqual(bindings.mappingDraft.value, mapping);
      assert.deepEqual(bindings.taskMappingDraft.value, mapping);
      await assert.rejects(() => save(config), /读取/);
      assert.equal(writes, 0);
      failed = false;
      await load('target');
      await assert.doesNotReject(() => save({ ...config, fieldMappings: [] }));
      assert.equal(writes, 1);
    });
  }
}

for (const inDialog of [false, true]) {
  for (const complete of [false, true]) {
    test(`BloggerInfoFetch：${inDialog ? '弹窗' : '主页面'}保存使用本入口映射，${complete ? '完整映射提交' : '不完整映射阻止保存'}`, async () => {
      const selected = [{ source_key: 'name', target_field_id: complete ? 'selected-field' : '' }];
      const other = [{ source_key: 'name', target_field_id: 'other-field' }];
      const saved = [], notifications = [];
      let requests = 0;
      const bindings = {
        taskDialogLoading: { value: false }, taskDialogVisible: { value: inDialog },
        taskDialogForm: { value: { targetType: 'existing', targetTableId: 'target' } },
        mappingDraft: { value: inDialog ? other : selected },
        taskMappingDraft: { value: inDialog ? selected : other },
        editingTaskId: { value: inDialog ? 'task' : null }, props: { api_key: 'test-only' }, TASK_API_PATH: '/tasks',
        validateConfiguredInputFilter: async () => null,
        buildTaskPayload: async () => ({ name: 'task' }),
        saveTableOutputConfig: async config => { saved.push(config.fieldMappings); },
        request: async () => { requests++; return { data: { sta: 0 } }; },
        ElNotification: value => notifications.push(value), console: { error() {} },
        getDefaultTaskDialogForm: () => ({}), loadTaskList: async () => {},
      };
      await pageHandler('BloggerInfoFetch', 'saveTask', bindings)();
      assert.equal(requests, complete ? 1 : 0);
      if (complete) {
        assert.deepEqual(saved, [selected]);
        assert.notEqual(saved[0], selected);
      } else {
        assert.deepEqual(saved, []);
        assert.equal(notifications[0].message, '请完成字段映射后再保存任务');
      }
      assert.equal(bindings.taskDialogLoading.value, false);
    });
  }
}

test('BloggerInfoFetch：初始化定时表单保留主页面写入方式及映射，草稿相互独立', async () => {
  const mappings = [{ source_key: 'name', target_field_id: 'custom-field' }];
  const bindings = {
    taskDialogForm: { value: {} }, taskMappingDraft: { value: [] },
    getDefaultTaskDialogForm: () => ({ writeMode: 'upsert', fieldMappings: [] }),
    formData: { value: { mode: 'manual', targetType: 'existing', targetTableId: 'target' } },
    writeMode: { value: 'append' }, mappingDraft: { value: mappings }, selectedFieldKeys: { value: [] },
    cloneInputFilter: () => null, ensureOption() {}, tableOptions: { value: [] },
    getTableNameById: async () => '目标表',
  };
  await pageHandler('BloggerInfoFetch', 'copyCurrentFormToTaskDialog', bindings)();
  assert.equal(bindings.taskDialogForm.value.writeMode, 'append');
  assert.deepEqual(bindings.taskDialogForm.value.fieldMappings, mappings);
  assert.deepEqual(bindings.taskMappingDraft.value, mappings);
  bindings.taskMappingDraft.value[0].target_field_id = 'edited';
  assert.equal(mappings[0].target_field_id, 'custom-field');
  assert.equal(bindings.taskDialogForm.value.fieldMappings[0].target_field_id, 'custom-field');
});

test('ProfileFetch：打开另一张表的任务只加载弹窗草稿，主页面映射和字段不变', async () => {
  const main = [{ source_key: 'name', target_field_id: 'A-field' }];
  const task = [{ source_key: 'name', target_field_id: 'B-field' }];
  const bindings = {
    tableConfigsLoaded: { value: true }, tableConfigApplying: { value: false }, tableConfigSaveStatus: { value: '' },
    taskDialogForm: { value: { targetType: 'existing', targetTableId: 'B' } },
    mappingDraft: { value: main }, taskMappingDraft: { value: [] },
    tableFieldOptions: { value: [{ id: 'A-field' }] }, taskTableFieldOptions: { value: [] },
    normalizeTargetType: value => value, cloneFieldMappings: list => list.map(item => ({ ...item })),
    getTableConfig: () => ({ write_mode: 'append', field_mappings: task }),
    loadTargetFieldOptions: async (_id, target) => { (target || bindings.tableFieldOptions).value = [{ id: 'B-field' }]; },
  };
  await pageHandler('ProfileFetch', 'applyTaskTableConfig', bindings)('B');
  assert.deepEqual(bindings.mappingDraft.value, main);
  assert.deepEqual(bindings.tableFieldOptions.value, [{ id: 'A-field' }]);
  assert.deepEqual(bindings.taskMappingDraft.value, task);
  assert.deepEqual(bindings.taskTableFieldOptions.value, [{ id: 'B-field' }]);
});

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：自动保存固定所属表和内容，加载期间及弹窗修改不写入主页面配置`, async () => {
    const writes = [], pending = [];
    const config = { targetType: 'existing', targetTableId: 'A', writeMode: 'append' };
    const bindings = {
      formData: { value: config }, mainOutputTableId: { value: 'A' },
      tableConfigsLoaded: { value: false }, loadedTableConfigs: { value: new Set() },
      tableConfigApplying: { value: false }, taskDialogVisible: { value: false },
      mappingDraft: { value: [{ source_key: 'name', target_field_id: 'A-field' }] },
      writeMode: { value: 'append' }, tableFieldOptions: { value: [{ id: 'A-field', name: 'A列', type: 1 }] },
      tableConfigSaving: { value: false }, tableConfigSaveStatus: { value: '' }, tableOutputConfigs: { value: {} },
      props: { api_key: 'test-only' }, TASK_PLUGIN_TYPE: 'test', TABLE_CONFIG_API_PATH: '/config',
      FIELD_CONFIG: [{ key: 'name', name: '名称' }], PROFILE_FIELD_MAPPING: [{ key: 'name', name: '名称' }],
      bitable: { base: { getSelection: async () => ({ baseId: 'base' }) } },
      getBaseId: async () => 'base', getTableNameById: async id => id,
      request: async ({ data }) => { writes.push(data); return { data: { sta: 0, data } }; },
      console: { error() {} },
    };
    const persist = pageHandler(page, 'persistTableOutputConfig', { ...bindings, createTableConfigSaver });
    bindings.persistTableOutputConfig = config => { const result = persist(config); pending.push(result); return result; };
    bindings.saveTableOutputConfig = pageHandler(page, 'saveTableOutputConfig', bindings);
    const autosave = pageHandler(page, 'saveMainTableOutputConfig', bindings);
    autosave();
    assert.equal(pending.length, 0); // 未成功读取。
    bindings.tableConfigsLoaded.value = true;
    bindings.loadedTableConfigs.value.add('A');
    bindings.tableConfigApplying.value = true;
    autosave();
    assert.equal(pending.length, 0); // 正在回填，不把读取当用户编辑。
    bindings.tableConfigApplying.value = false;
    autosave();
    config.targetTableId = 'B';
    config.writeMode = 'upsert';
    bindings.writeMode.value = 'upsert';
    bindings.mappingDraft.value[0].target_field_id = 'B-field';
    bindings.tableFieldOptions.value[0] = { id: 'B-field', name: 'B列', type: 1 };
    autosave();
    assert.equal(pending.length, 1); // B 的草稿尚未完成加载，不能写回 A。
    bindings.mainOutputTableId.value = 'B';
    bindings.loadedTableConfigs.value.add('B');
    autosave();
    bindings.taskDialogVisible.value = true;
    autosave();
    assert.equal(pending.length, 2);
    await Promise.all(pending);
    assert.deepEqual(writes.map(item => item.target_table_id), ['A', 'B']);
    assert.deepEqual(writes.map(item => item.write_mode), ['append', 'upsert']);
    assert.deepEqual(writes.map(item => item.field_mappings[0].target_field_id), ['A-field', 'B-field']);
    assert.deepEqual(writes.map(item => item.field_mappings[0].target_field_name), ['A列', 'B列']);
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：直接保存也不能用未加载或其他表的主页面草稿覆盖目标表`, async () => {
    const bindings = {
      formData: { value: { targetType: 'existing', targetTableId: 'B', writeMode: 'upsert' } },
      mainOutputTableId: { value: '' }, mappingDraft: { value: [] }, writeMode: { value: 'upsert' },
      tableConfigsLoaded: { value: true }, loadedTableConfigs: { value: new Set(['A', 'B']) },
      persistTableOutputConfig: () => assert.fail('来源不明确的草稿不能提交'),
      FIELD_CONFIG: [], PROFILE_FIELD_MAPPING: [],
    };
    const save = pageHandler(page, 'saveTableOutputConfig', bindings);
    await assert.rejects(() => save(), /读取/);
    bindings.mainOutputTableId.value = 'A';
    await assert.rejects(() => save(), /读取/);
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：取消任务弹窗不重载或清空主页面草稿`, async () => {
    const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
    const watcher = parseJS(source, { sourceType: 'module' }).program.body.find(node =>
      node.type === 'ExpressionStatement' && node.expression.callee?.name === 'watch'
      && source.slice(node.expression.arguments[0].start, node.expression.arguments[0].end).includes('taskDialogVisible.value'));
    const main = [{ source_key: 'name', target_field_id: 'A-field' }];
    let close;
    const bindings = {
      watch: (_source, callback) => { close = callback; }, taskDialogVisible: { value: true },
      taskOutputLoading: { value: false }, taskOutputError: { value: '' }, taskOutputTableId: { value: '' }, taskConfigReadId: { value: 0 }, fieldReadRequests: new WeakMap(),
      taskDialogForm: { value: { targetTableId: 'B' } }, taskDialogMode: { value: 'edit' }, editingTaskId: { value: 'task' },
      taskMappingDraft: { value: [] }, taskTableFieldOptions: { value: [] }, taskMappingExpanded: { value: true },
      formData: { value: { targetType: 'existing', targetTableId: 'A', writeMode: 'append' } },
      mappingDraft: { value: main }, tableFieldOptions: { value: [{ id: 'A-field' }] },
      getDefaultTaskDialogForm: () => ({}),
      applyTableConfig: () => assert.fail('关闭弹窗不应回填、覆盖主页面草稿'),
    };
    new Function(...Object.keys(bindings), source.slice(watcher.start, watcher.end))(...Object.values(bindings));
    await close(false);
    assert.deepEqual(bindings.mappingDraft.value, main);
    assert.deepEqual(bindings.tableFieldOptions.value, [{ id: 'A-field' }]);
    assert.equal(bindings.formData.value.writeMode, 'append');
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  for (const oldFails of [false, true]) {
    test(`${page}：切表后忽略旧字段请求${oldFails ? '失败' : '成功'}`, async () => {
      const pending = {};
      const fields = { value: [] };
      const load = pageHandler(page, page === 'BloggerInfoFetch' ? 'getTableFields' : 'loadTargetFieldOptions', {
        fieldReadRequests: new WeakMap(), tableFieldOptions: fields,
        console: { error() {} },
        bitable: { base: { getTableById: async id => ({ getFieldMetaList: () => new Promise((resolve, reject) => { pending[id] = { resolve, reject }; }) }) } },
      });
      const a = load('A');
      const b = load('B');
      await new Promise(resolve => setImmediate(resolve));
      pending.B.resolve([{ id: 'B-field', name: 'B', type: 1 }]);
      await b;
      if (oldFails) pending.A.reject(new Error('old request failed'));
      else pending.A.resolve([{ id: 'A-field', name: 'A', type: 1 }]);
      await a;
      assert.equal(fields.value[0]?.id, 'B-field');
    });
  }
}

for (const target of ['main', 'task']) {
  for (const oldFails of [false, true]) {
    test(`BloggerInfoFetch：${target}配置只应用最新读取，旧请求${oldFails ? '失败' : '成功'}`, async () => {
      const pending = [], notifications = [];
      const draft = { value: [] }, owner = { value: '' };
      const bindings = {
        mainConfigReadId: { value: 0 }, taskConfigReadId: { value: 0 },
        mainOutputTableId: owner, loadedTableConfigs: { value: new Set() },
        tableConfigLoading: { value: false }, tableConfigApplying: { value: false },
        tableOutputConfigs: { value: {} }, writeMode: { value: 'upsert' }, mappingDraft: draft,
        taskDialogForm: { value: { targetTableId: 'A' } }, taskMappingDraft: draft,
        getTableFields: async () => {}, props: { api_key: 'test' },
        bitable: { base: { getSelection: async () => ({ baseId: 'base' }) } },
        request: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
        TABLE_CONFIGS_API_PATH: 'test', TASK_PLUGIN_TYPE: 'test',
        ElNotification: value => notifications.push(value), console: { error() {} },
      };
      const load = pageHandler('BloggerInfoFetch', target === 'main' ? 'loadTableOutputConfig' : 'applyTaskTableOutputConfig', bindings);
      const a = load('A');
      await new Promise(resolve => setImmediate(resolve));
      bindings.taskDialogForm.value.targetTableId = 'B';
      const b = load('B');
      await new Promise(resolve => setImmediate(resolve));
      const response = { data: { sta: 0, data: ['A', 'B'].map(id => ({ target_table_id: id, field_mappings: [{ source_key: 'name', target_field_id: `${id}-name` }] })) } };
      pending[1].resolve(response); await b;
      if (oldFails) pending[0].reject(new Error('old request failed'));
      else pending[0].resolve(response);
      await a;
      assert.equal(draft.value[0].target_field_id, 'B-name');
      if (target === 'main') assert.equal(owner.value, 'B');
      assert.equal(notifications.length, 0);
    });
  }
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：清空字段选择使旧读取失效，主页面和弹窗读取互不取消`, async () => {
    const pending = {};
    const main = { value: [] }, task = { value: [] };
    const load = pageHandler(page, page === 'BloggerInfoFetch' ? 'getTableFields' : 'loadTargetFieldOptions', {
      tableFieldOptions: main,
      bitable: { base: { getTableById: async id => ({ getFieldMetaList: () => new Promise(resolve => { pending[id] = resolve; }) }) } },
    });
    const a = load('A'), b = load('B', task);
    await new Promise(resolve => setImmediate(resolve));
    await load('', task);
    pending.B([{ id: 'B-field' }]); await b;
    pending.A([{ id: 'A-field' }]); await a;
    assert.equal(main.value[0].id, 'A-field');
    assert.deepEqual(task.value, []);
  });
}

test('VideoDataFetch：旧任务表字段加载结束后不能覆盖新表配置', async () => {
  const pending = {};
  const form = { value: {} };
  const load = pageHandler('VideoDataFetch', 'loadTaskTableOutputConfig', {
    taskDialogForm: form, tableConfigsLoaded: { value: true },
    loadTargetFieldOptions: id => new Promise(resolve => { pending[id] = resolve; }),
    getTableConfig: id => ({ write_mode: id, field_mappings: [{ source_key: 'name', target_field_id: `${id}-name` }] }),
  });
  const a = load('A'), b = load('B');
  pending.B(); await b;
  pending.A(); await a;
  assert.equal(form.value.writeMode, 'B');
  assert.equal(form.value.fieldMappings[0].target_field_id, 'B-name');
});

function taskDialogCloseHandler(page, bindings) {
  const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const watcher = parseJS(source, { sourceType: 'module' }).program.body.find(node =>
    node.type === 'ExpressionStatement' && node.expression.callee?.name === 'watch'
    && source.slice(node.expression.arguments[0].start, node.expression.arguments[0].end).includes('taskDialogVisible.value'));
  const callback = watcher.expression.arguments[1];
  return new Function(...Object.keys(bindings), `return (${source.slice(callback.start, callback.end)});`)(...Object.values(bindings));
}

for (const page of ['BloggerInfoFetch', 'VideoDataFetch', 'ProfileFetch']) {
  for (const reset of ['close', 'initialize']) {
    test(`${page}：${reset}后旧弹窗字段和配置读取不污染新草稿`, async () => {
      let finishFields;
      const bindings = {
        taskOutputLoading: { value: false }, taskOutputError: { value: '' }, taskOutputTableId: { value: '' }, taskConfigReadId: { value: 0 }, fieldReadRequests: new WeakMap(),
        taskDialogForm: { value: { targetType: 'existing', targetTableId: 'A' } },
        taskMappingDraft: { value: [] }, taskTableFieldOptions: { value: [] }, taskMappingExpanded: { value: true },
        taskDialogMode: { value: 'edit' }, editingTaskId: { value: 'old' },
        tableConfigApplying: { value: false }, tableConfigSaveStatus: { value: '' },
        tableConfigsLoaded: { value: true }, loadedTableConfigs: { value: new Set() },
        formData: { value: { mode: 'manual', targetType: 'existing', targetTableId: 'B', writeMode: 'upsert' } },
        writeMode: { value: 'upsert' }, mappingDraft: { value: [{ source_key: 'name', target_field_id: 'B-field' }] },
        tableFieldOptions: { value: [{ id: 'B-field' }] }, selectedFieldKeys: { value: [] },
        getDefaultTaskDialogForm: () => ({}), cloneInputFilter: () => null,
        normalizeTargetType: value => value, ensureOption() {},
        tableOptions: { value: [] }, table_options: { value: [] }, getTableNameById: async id => id,
        props: { api_key: 'test' }, console: { error() {} }, ElNotification() {},
        getTableConfig: () => ({ write_mode: 'append', field_mappings: [{ source_key: 'name', target_field_id: 'A-field' }] }),
        request: () => assert.fail('失效的读取不应继续请求配置'),
        bitable: { base: { getTableById: async () => ({ getFieldMetaList: () => new Promise(resolve => { finishFields = resolve; }) }) } },
      };
      const fieldLoader = page === 'BloggerInfoFetch' ? 'getTableFields' : 'loadTargetFieldOptions';
      bindings[fieldLoader] = pageHandler(page, fieldLoader, bindings);
      const loader = page === 'BloggerInfoFetch' ? 'applyTaskTableOutputConfig' : page === 'VideoDataFetch' ? 'loadTaskTableOutputConfig' : 'applyTaskTableConfig';
      const pending = pageHandler(page, loader, bindings)('A');
      await new Promise(resolve => setImmediate(resolve));
      if (reset === 'close') {
        await taskDialogCloseHandler(page, bindings)(false);
        // 新弹窗草稿；不再发起读取，以验证关闭本身已经取消旧读取。
        bindings.taskDialogForm.value = { targetType: 'existing', targetTableId: 'B', writeMode: 'upsert', fieldMappings: [{ target_field_id: 'B-field' }] };
        bindings.taskMappingDraft.value = [{ target_field_id: 'B-field' }];
        bindings.taskTableFieldOptions.value = [{ id: 'B-field' }];
      } else {
        await pageHandler(page, 'copyCurrentFormToTaskDialog', bindings)();
      }
      finishFields([{ id: 'A-field' }]); await pending;
      assert.equal(bindings.taskDialogForm.value.targetTableId, 'B');
      assert.equal(bindings.taskDialogForm.value.writeMode, 'upsert');
      assert.equal(bindings.taskTableFieldOptions.value[0].id, 'B-field');
      const mappings = page === 'VideoDataFetch' ? bindings.taskDialogForm.value.fieldMappings : bindings.taskMappingDraft.value;
      assert.equal(mappings[0].target_field_id, 'B-field');
    });
  }
}

for (const fail of [false, true]) {
  test(`BloggerInfoFetch：取消弹窗后忽略已发出的配置请求${fail ? '失败' : '成功'}`, async () => {
    let resolveRequest, rejectRequest;
    const notifications = [];
    const bindings = {
      taskOutputLoading: { value: false }, taskOutputError: { value: '' }, taskOutputTableId: { value: '' }, taskConfigReadId: { value: 0 }, fieldReadRequests: new WeakMap(),
      loadedTableConfigs: { value: new Set() }, taskDialogForm: { value: { targetTableId: 'A' } },
      taskMappingDraft: { value: [] }, taskTableFieldOptions: { value: [] },
      taskDialogMode: { value: 'edit' }, editingTaskId: { value: 'old' },
      getDefaultTaskDialogForm: () => ({}), getTableFields: async () => {}, props: { api_key: 'test' },
      bitable: { base: { getSelection: async () => ({ baseId: 'base' }) } },
      request: () => new Promise((resolve, reject) => { resolveRequest = resolve; rejectRequest = reject; }),
      TABLE_CONFIGS_API_PATH: 'test', TASK_PLUGIN_TYPE: 'test',
      ElNotification: value => notifications.push(value), console: { error() {} },
    };
    const pending = pageHandler('BloggerInfoFetch', 'applyTaskTableOutputConfig', bindings)('A');
    await new Promise(resolve => setImmediate(resolve));
    await taskDialogCloseHandler('BloggerInfoFetch', bindings)(false);
    bindings.taskDialogForm.value = { targetTableId: 'B', writeMode: 'upsert' };
    bindings.taskMappingDraft.value = [{ target_field_id: 'B-field' }];
    if (fail) rejectRequest(new Error('old request failed'));
    else resolveRequest({ data: { sta: 0, data: [{ target_table_id: 'A', write_mode: 'append', field_mappings: [{ target_field_id: 'A-field' }] }] } });
    await pending;
    assert.equal(bindings.taskDialogForm.value.writeMode, 'upsert');
    assert.equal(bindings.taskMappingDraft.value[0].target_field_id, 'B-field');
    assert.deepEqual(notifications, []);
  });
}

for (const state of ['未就绪']) {
  test(`VideoDataFetch：弹窗配置${state}时不提交任务或表配置`, async () => {
    const notifications = [];
    const bindings = {
      taskDialogLoading: { value: false }, taskDialogVisible: { value: true },
      taskOutputConfigReady: { value: false }, taskDialogForm: { value: { targetType: 'existing', targetTableId: 'B' } },
      validateConfiguredInputFilter: async () => null, buildTaskPayload: async () => ({}),
      saveTableOutputConfig: () => assert.fail('配置尚未就绪，不得保存'),
      request: () => assert.fail('配置尚未就绪，不得提交任务'),
      console: { error() {} }, ElNotification: value => notifications.push(value),
    };
    await pageHandler('VideoDataFetch', 'saveTask', bindings)();
    assert.match(notifications[0]?.message || '', /输出表配置尚未加载完成/);
    assert.equal(bindings.taskDialogLoading.value, false);
  });
}

test('VideoDataFetch：任务目标归属仅在字段和配置成功加载后更新', async () => {
  let finish;
  const owner = { value: 'A' };
  const bindings = {
    taskOutputTableId: owner, taskDialogForm: { value: {} }, tableConfigsLoaded: { value: true },
    loadTargetFieldOptions: () => new Promise(resolve => { finish = resolve; }),
    getTableConfig: () => ({ field_mappings: [] }),
  };
  const load = pageHandler('VideoDataFetch', 'loadTaskTableOutputConfig', bindings);
  const failed = load('B');
  assert.equal(owner.value, '');
  finish(false); await failed;
  assert.equal(owner.value, '');
  const successful = load('B');
  finish(true); await successful;
  assert.equal(owner.value, 'B');
});

test('VideoDataFetch：任务配置就绪状态按草稿所属表判断，新建表不受限制', async () => {
  const { computed, ref } = await import('vue');
  const form = ref({ targetType: 'existing', targetTableId: 'B' });
  const owner = ref('A');
  const ready = pageHandler('VideoDataFetch', 'taskOutputConfigReady', {
    computed, taskDialogForm: form, taskOutputTableId: owner, mainOutputTableId: ref('C'),
  });
  assert.equal(ready.value, false);
  owner.value = ''; assert.equal(ready.value, false);
  owner.value = 'B'; assert.equal(ready.value, true);
  form.value = { targetType: 'current', sourceTableId: 'A' };
  assert.equal(ready.value, false);
  owner.value = 'A'; assert.equal(ready.value, true);
  form.value = { targetType: 'new' }; owner.value = '';
  assert.equal(ready.value, true);
});

test('VideoDataFetch：表配置提交入口拒绝把旧表草稿写入新表', async () => {
  const save = pageHandler('VideoDataFetch', 'saveTableOutputConfig', {
    taskDialogVisible: { value: true }, taskOutputTableId: { value: 'A' },
    persistTableOutputConfig: () => assert.fail('不得写入不属于当前表的草稿'),
  });
  await assert.rejects(save({ targetType: 'existing', targetTableId: 'B', fieldMappings: [] }), /输出表配置尚未加载完成/);
});

for (const page of ['BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：任务配置加载失败不开放保存，重选成功后恢复`, async () => {
    let finish;
    const owner = { value: 'A' };
    const bindings = {
      taskOutputTableId: owner, taskDialogForm: { value: { targetType: 'existing', targetTableId: 'B' } },
      taskMappingDraft: { value: [] }, tableConfigsLoaded: { value: true },
      loadedTableConfigs: { value: new Set() }, tableConfigSaveStatus: { value: '' },
      normalizeTargetType: value => value, props: { api_key: 'test' },
      getTableConfig: () => ({ field_mappings: [] }),
      bitable: { base: { getSelection: async () => ({ baseId: 'base' }) } },
      request: async () => ({ data: { sta: 0, data: [] } }),
      TABLE_CONFIGS_API_PATH: '/test', TASK_PLUGIN_TYPE: 'test',
    };
    bindings[page === 'BloggerInfoFetch' ? 'getTableFields' : 'loadTargetFieldOptions'] = () => new Promise(resolve => { finish = resolve; });
    const load = pageHandler(page, page === 'BloggerInfoFetch' ? 'applyTaskTableOutputConfig' : 'applyTaskTableConfig', bindings);
    const failed = load('B');
    assert.equal(owner.value, ''); finish(false); await failed;
    assert.equal(owner.value, '');
    const retry = load('B'); finish(true); await retry;
    assert.equal(owner.value, 'B');
  });

  test(`${page}：配置未就绪时保存入口不发出任何写入`, async () => {
    const notices = [];
    await pageHandler(page, 'saveTask', {
      taskDialogLoading: { value: false }, taskDialogVisible: { value: true }, taskOutputConfigReady: { value: false },
      taskDialogForm: { value: { targetType: 'existing', targetTableId: 'B' } },
      validateConfiguredInputFilter: async () => null, buildTaskPayload: async () => ({}), normalizeTargetType: x => x,
      cloneFieldMappings: () => [], taskMappingDraft: { value: [] },
      saveTableOutputConfig: () => assert.fail('不得保存未就绪的配置'), request: () => assert.fail('不得提交任务'),
      ElNotification: value => notices.push(value), console: { error() {} },
    })();
    assert.match(notices[0]?.message || '', /输出表配置尚未加载完成/);
  });

  test(`${page}：保存表配置拒绝草稿与目标表不一致`, async () => {
    const save = pageHandler(page, 'saveTableOutputConfig', {
      taskDialogVisible: { value: true }, taskOutputTableId: { value: 'A' },
      persistTableOutputConfig: () => assert.fail('不得写入错误的表'),
    });
    await assert.rejects(save({ targetType: 'existing', targetTableId: 'B', fieldMappings: [] }), /输出表配置尚未加载完成/);
  });
}

for (const page of ['BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：只允许已加载的目标表编辑保存，新建表无需等待`, async () => {
    const { computed, ref } = await import('vue');
    const form = ref({ targetType: 'existing', targetTableId: 'B' });
    const owner = ref('A');
    const ready = pageHandler(page, 'taskOutputConfigReady', { computed, taskDialogForm: form, taskOutputTableId: owner });
    assert.equal(ready.value, false);
    owner.value = ''; assert.equal(ready.value, false);
    owner.value = 'B'; assert.equal(ready.value, true);
    form.value.targetType = 'new'; owner.value = '';
    assert.equal(ready.value, true);
    form.value.targetType = 'current';
    assert.equal(ready.value, true);
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：局部提示区分加载、失败与重试成功，保留失败前草稿`, async () => {
    let finish;
    const loading = { value: false }, error = { value: '' };
    const draft = [{ source_key: 'name', target_field_id: 'old' }];
    const bindings = {
      taskOutputLoading: loading, taskOutputError: error, taskOutputTableId: { value: '' },
      taskDialogForm: { value: { targetType: 'existing', targetTableId: 'B', fieldMappings: draft } }, taskMappingDraft: { value: draft },
      tableConfigsLoaded: { value: true }, loadedTableConfigs: { value: new Set() }, tableConfigSaveStatus: { value: '' },
      normalizeTargetType: x => x, props: { api_key: 'test' },
      getTableConfig: () => ({ field_mappings: [] }),
      bitable: { base: { getSelection: async () => ({ baseId: 'base' }) } },
      request: async () => ({ data: { sta: 0, data: [] } }), TABLE_CONFIGS_API_PATH: '/test', TASK_PLUGIN_TYPE: 'test',
      console: { error() {} }, ElNotification() {},
    };
    bindings[page === 'BloggerInfoFetch' ? 'getTableFields' : 'loadTargetFieldOptions'] = () => new Promise(resolve => { finish = resolve; });
    const load = pageHandler(page, page === 'BloggerInfoFetch' ? 'applyTaskTableOutputConfig' : page === 'ProfileFetch' ? 'applyTaskTableConfig' : 'loadTaskTableOutputConfig', bindings);
    const failed = load('B');
    assert.equal(loading.value, true); assert.equal(error.value, '');
    finish(false); await failed;
    assert.equal(loading.value, false); assert.ok(error.value);
    assert.deepEqual(page === 'VideoDataFetch' ? bindings.taskDialogForm.value.fieldMappings : bindings.taskMappingDraft.value, draft);
    const retry = load('B');
    assert.equal(loading.value, true); assert.equal(error.value, '');
    finish(true); await retry;
    assert.equal(loading.value, false); assert.equal(error.value, '');
    assert.equal(bindings.taskOutputTableId.value, 'B');
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：旧读取失败不结束新表的加载提示`, async () => {
    const pending = {};
    const loading = { value: false }, error = { value: '' };
    const bindings = {
      taskOutputLoading: loading, taskOutputError: error,
      taskDialogForm: { value: { targetType: 'existing' } }, taskMappingDraft: { value: [] },
      tableConfigsLoaded: { value: true }, loadedTableConfigs: { value: new Set() },
      normalizeTargetType: x => x, props: { api_key: 'test' },
      getTableConfig: () => ({ field_mappings: [] }),
      bitable: { base: { getSelection: async () => ({ baseId: 'base' }) } },
      request: async () => ({ data: { sta: 0, data: [] } }), TABLE_CONFIGS_API_PATH: '/test', TASK_PLUGIN_TYPE: 'test',
    };
    bindings[page === 'BloggerInfoFetch' ? 'getTableFields' : 'loadTargetFieldOptions'] = id => new Promise(resolve => { pending[id] = resolve; });
    const load = pageHandler(page, page === 'BloggerInfoFetch' ? 'applyTaskTableOutputConfig' : page === 'ProfileFetch' ? 'applyTaskTableConfig' : 'loadTaskTableOutputConfig', bindings);
    const a = load('A'), b = load('B');
    pending.A(false); await a;
    assert.equal(loading.value, true); assert.equal(error.value, '');
    pending.B(true); await b;
    assert.equal(loading.value, false); assert.equal(error.value, '');
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  for (const action of ['complete', 'cancel', 'reopen']) {
    test(`${page}：编辑先显示弹窗再加载，${action}不被旧打开流程干扰`, async () => {
      let finishFields, finishTables;
      let sourceReads = 0;
      const ref = value => ({ value });
      const bindings = {
        taskConfigReadId: ref(0), taskOutputTableId: ref(''), taskOutputLoading: ref(false), taskOutputError: ref(''),
        fieldReadRequests: new WeakMap(), taskTableFieldOptions: ref([]), taskMappingDraft: ref([]), taskMappingExpanded: ref(false),
        tableOptions: ref([]), table_options: ref([]), fieldOptions: ref([]),
        taskDialogVisible: ref(false), taskDialogForm: ref({}), taskDialogMode: ref(''), editingTaskId: ref(null),
        tableConfigsLoaded: ref(true), loadedTableConfigs: ref(new Set()),
        getDefaultTaskDialogForm: () => ({}), normalizeRepeatType: x => x, normalizeTargetType: x => x,
        parseWorkFetchRange: x => x, cloneInputFilter: x => x, getDefaultSelectedFieldKeys: () => [], PROFILE_FIELD_MAPPING: [],
        ensureOption: (options, item) => { if (item.id) options.value.push(item); },
        loadTableOptions: () => new Promise(resolve => { finishTables = resolve; }),
        getTableConfig: () => ({ field_mappings: [] }), props: { api_key: 'test' },
        TABLE_CONFIGS_API_PATH: '/test', TASK_PLUGIN_TYPE: 'test',
        request: async () => ({ data: { sta: 0, data: [] } }),
        bitable: { base: { getTableById: async () => ({ getFieldMetaList: () => new Promise(resolve => { finishFields = resolve; }) }), getSelection: async () => ({ baseId: 'base' }) } },
        getFieldListByType: async () => { sourceReads++; }, loadFieldOptions: async () => { sourceReads++; },
      };
      const fieldLoader = page === 'BloggerInfoFetch' ? 'getTableFields' : 'loadTargetFieldOptions';
      const configLoader = page === 'BloggerInfoFetch' ? 'applyTaskTableOutputConfig' : page === 'ProfileFetch' ? 'applyTaskTableConfig' : 'loadTaskTableOutputConfig';
      bindings[fieldLoader] = pageHandler(page, fieldLoader, bindings);
      bindings[configLoader] = pageHandler(page, configLoader, bindings);
      const pending = pageHandler(page, 'openEditTaskDialog', bindings)({ id: 'task-A', snapshot: { mode: 'table', target_type: 'existing', target_table_id: 'A' } });
      assert.equal(bindings.taskDialogVisible.value, true);
      assert.equal(bindings.editingTaskId.value, 'task-A');
      assert.equal(bindings.taskOutputLoading.value, true);
      await new Promise(resolve => setImmediate(resolve));
      if (action !== 'complete') {
        bindings.taskDialogVisible.value = false;
        await taskDialogCloseHandler(page, bindings)(false);
        if (action === 'reopen') {
          bindings.taskDialogForm.value = { mode: 'table', targetType: 'existing', targetTableId: 'B' };
          bindings.editingTaskId.value = 'task-B';
          bindings.taskDialogVisible.value = true;
        }
      }
      finishFields([{ id: 'A-field' }]); finishTables(); await pending;
      assert.equal(bindings.taskDialogVisible.value, action !== 'cancel');
      assert.equal(sourceReads, action === 'complete' ? 1 : 0);
      assert.equal(bindings.taskOutputLoading.value, false);
      if (action === 'complete') assert.equal(bindings.taskOutputTableId.value, 'A');
      if (action === 'reopen') assert.equal(bindings.taskDialogForm.value.targetTableId, 'B');
    });
  }
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：保存固定任务ID、表和映射，重复点击不重复提交`, async () => {
    let finishValidation, finishMapping;
    const calls = [], mappings = [];
    const form = { targetType: 'existing', targetTableId: 'A', writeMode: 'append', fieldMappings: [{ source_key: 'name', target_field_id: 'A-field' }] };
    const bindings = {
      taskDialogLoading: { value: false }, taskDialogVisible: { value: true }, taskOutputConfigReady: { value: true },
      taskDialogForm: { value: form }, taskDialogMode: { value: 'edit' }, editingTaskId: { value: 'task-A' },
      taskMappingDraft: { value: form.fieldMappings }, mappingDraft: { value: [] },
      taskTableFieldOptions: { value: [{ id: 'A-field', name: 'A' }] }, tableFieldOptions: { value: [] },
      validateConfiguredInputFilter: () => new Promise(resolve => { finishValidation = resolve; }),
      buildTaskPayload: async (_filter, config) => ({ name: 'task', target: config?.targetTableId }),
      saveTableOutputConfig: config => { mappings.push(config); return new Promise(resolve => { finishMapping = resolve; }); },
      request: async config => { calls.push(config); return { data: { sta: 0 } }; },
      normalizeTargetType: x => x, props: { api_key: 'test' }, TASK_API_PATH: '/tasks',
      getDefaultTaskDialogForm: () => ({}), loadTaskList: async () => {}, ElNotification() {}, console: { error() {} },
    };
    const save = pageHandler(page, 'saveTask', bindings);
    const pending = save();
    const duplicate = save();
    form.targetTableId = 'B'; form.fieldMappings[0].target_field_id = 'B-field';
    finishValidation(null);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(mappings.length, 1);
    assert.equal(mappings[0].targetTableId, 'A');
    assert.equal(mappings[0].fieldMappings[0].target_field_id, 'A-field');
    bindings.editingTaskId.value = null;
    finishMapping(true); await pending; await duplicate;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/tasks/task-A');
    assert.equal(calls[0].method, 'put');
    assert.equal(calls[0].data.target, 'A');
    assert.equal(bindings.taskDialogLoading.value, false);
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：保存失败恢复操作并保留任务草稿`, async () => {
    const form = { mode: 'manual', targetType: 'new', manualUrls: 'original', fieldMappings: [] };
    const loading = { value: false }, dialog = { value: true }, taskForm = { value: form };
    const notices = [];
    await pageHandler(page, 'saveTask', {
      taskDialogLoading: loading, taskDialogVisible: dialog, taskDialogForm: taskForm,
      editingTaskId: { value: 'task-A' }, normalizeTargetType: x => x,
      validateConfiguredInputFilter: async () => null, buildTaskPayload: async () => ({}),
      request: async () => { throw new Error('保存失败'); }, props: { api_key: 'test' }, TASK_API_PATH: '/tasks',
      ElNotification: value => notices.push(value), console: { error() {} },
    })();
    assert.equal(loading.value, false);
    assert.equal(dialog.value, true);
    assert.equal(taskForm.value, form);
    assert.equal(form.manualUrls, 'original');
    assert.equal(notices[0].message, '保存失败');
  });

  test(`${page}：提交副本的筛选仍使用原任务来源表和弹窗校验器`, async () => {
    const original = { mode: 'table', sourceTableId: 'saved-source', inputFilter: { version: 1 } };
    const copy = JSON.parse(JSON.stringify(original));
    const table = { id: 'saved-source' };
    const validate = pageHandler(page, 'validateConfiguredInputFilter', {
      taskDialogForm: { value: original }, taskDialogVisible: { value: true }, taskDialogMode: { value: 'edit' },
      taskInputFilterEditor: { value: { validate: async (actual, filter) => {
        assert.equal(actual, table); assert.deepEqual(filter, copy.inputFilter); return filter;
      } } },
      inputFilterEditor: { value: { validate: () => assert.fail('不得使用主页面校验器') } },
      bitable: { base: { getTableById: async id => { assert.equal(id, 'saved-source'); return table; }, getActiveTable: () => assert.fail('不得切换到当前打开的表') } },
    });
    assert.deepEqual(await validate(copy, null, true), copy.inputFilter);
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch']) {
  test(`${page}：运行中草稿变化不改变本批逐行写入配置`, async () => {
    const formData = { value: { mode: 'manual', manualUrls: 'url', targetType: 'existing', writeMode: 'upsert' } };
    const mappingDraft = { value: [{ source_key: 'title', target_field_id: 'original' }] };
    const writeMode = { value: 'upsert' };
    const writes = [];
    const fetchRows = async (_, { onSuccess }) => {
      await onSuccess({});
      mappingDraft.value[0].target_field_id = 'changed';
      writeMode.value = 'append';
      formData.value.writeMode = 'append';
      await onSuccess({});
      return { successCount: 2, failCount: 0, stopped: false };
    };
    await pageHandler(page, 'handleManualModeSubmit', {
      formData, mappingDraft, writeMode, selectedFieldKeys: { value: [] },
      loading: { value: false }, stopRequested: { value: false },
      validateBaseForm: () => true, parseManualUrls: () => ['url'], getWriteFieldConfigs: () => [],
      resolveTargetTableId: async () => 'target',
      fetchVideoDataByRows: fetchRows, fetchBloggerInfoByRows: fetchRows,
      appendRecordsToTable: async (_, __, ___, options) => writes.push(JSON.parse(JSON.stringify(options))),
      showToast() {}, hideToast() {}, setTimeout() {}, TASK_TOAST_SUFFIX: '',
      console: { error() {} }, ElNotification: details => assert.fail(details.message),
    })();
    assert.equal(writes.length, 2);
    for (const write of writes) {
      assert.equal(write.writeMode, 'upsert');
      assert.equal(write.fieldMappings[0].target_field_id, 'original');
    }
  });
}

for (const page of ['VideoDataFetch', 'BloggerInfoFetch', 'ProfileFetch']) {
  test(`${page}：前N行读够即停，保留视图顺序；所有行与选中行不变`, async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `record-${i}`);
    const calls = [];
    let selected = ['record-9', 'record-2'];
    const notices = [];
    const view = {
      getVisibleRecordIdListByPage: async ({ pageSize, pageToken }) => {
        calls.push(pageToken);
        const start = Number(pageToken || 0);
        const end = Math.min(start + pageSize, ids.length);
        return { recordIds: ids.slice(start, end), hasMore: end < ids.length, pageToken: String(end) };
      },
      getSelectedRecordIdList: async () => selected,
    };
    const bindings = { console: { log() {}, warn() {} }, ElNotification: value => notices.push(value) };
    bindings.getAllVisibleRecordIdList = pageHandler(page, 'getAllVisibleRecordIdList', bindings);
    const read = pageHandler(page, 'getRecordIdListByScope', bindings);
    const table = { getActiveView: async () => view };
    for (const [count, pages] of [[5, 1], [200, 1], [201, 2], [500, 3]]) {
      calls.length = 0;
      assert.deepEqual(await read(table, 'n', count), ids.slice(0, count));
      assert.equal(calls.length, pages, `前 ${count} 行的请求数`);
    }
    calls.length = 0;
    assert.deepEqual(await read(table, 'all'), ids);
    assert.equal(calls.length, 3);
    calls.length = 0;
    assert.deepEqual(await read(table, 'selected'), selected);
    selected = [];
    assert.equal(await read(table, 'selected'), null);
    assert.equal(notices.length, 1);
    assert.equal(calls.length, 0);
  });
}
