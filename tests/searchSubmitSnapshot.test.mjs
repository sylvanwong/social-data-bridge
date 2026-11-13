import { nextTick } from 'vue';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';

for (const [page, handler, engineName] of [['KeywordSearch', 'postSearchTask', 'keywordStreamTask'], ['BloggerSearch', 'submit', 'searchTask']]) {
  test(`${page}: creating HTTP keeps original output target, fields and mode`, async () => {
    const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
    const node = parseJS(source, { sourceType: 'module' }).program.body
      .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations)
      .find(node => node.id.name === handler).init;
    const form = { value: { social_type: 'xhs', keyword: 'test', radio: 2, table_id: 'original-table', writeMode: 'upsert', rangeType: 'all', workFetchRange: { type: 'all' } } };
    const fields = { value: ['user_id'] }, mappings = { value: [{ source_key: 'user_id', target_field_id: 'original-field' }] };
    let finishRequest, saved;
    const bindings = {
      ...loadRequestModule(),
      feedback: { begin() {}, fail: e => assert.fail(e?.message || e) }, nextTick, requiresReopen: { value: false },
      form, formData1: form, selectedFieldKeys: fields, mappingDraft: mappings,
      props: { api_key: 'test' }, [engineName]: { submit: async create => { saved = await create(); } },
      request: () => new Promise(resolve => { finishRequest = resolve; }),
      restoreTask() {}, auth: () => ({}), showToast() {}, TASK_TOAST_SUFFIX: '',
      normalizeWorkFetchRange: () => ({}), parseKeywords: value => [value],
      hasRecoverableTask: { value: false }, submitting: { value: false }, loading: { value: false },
      componentUnmounted: false, tableFieldsError: null, tableConfigsLoaded: { value: true }, mappingLoading: { value: false }, isDouyin: { value: false },
      validateTableFields: async (table, selected, options) => {
        assert.equal(table, 'original-table'); assert.equal(options.writeMode, 'upsert'); return true;
      }, showErrorMsg: message => assert.fail(message),
    };
    bindings.feishuRequest = config => bindings.request(config);
    const submit = new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
    const pending = submit('original-table');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(typeof finishRequest, 'function');
    form.value.table_id = 'changed-table'; form.value.radio = 1; form.value.writeMode = 'append';
    fields.value.push('title'); mappings.value[0].target_field_id = 'changed-field';
    finishRequest({ data: { sta: 0, data: { task_id: 'task' } } });
    await pending;
    assert.equal(saved.targetTableId, 'original-table');
    assert.deepEqual(saved.selectedFieldKeys, ['user_id']);
    assert.equal(saved.writeMode, 'upsert');
    assert.equal(saved.fieldMappings[0].target_field_id, 'original-field');
  });
}
