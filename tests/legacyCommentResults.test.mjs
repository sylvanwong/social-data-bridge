import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

// Reuse the installed parser dependencies to exercise both legacy entry points.
const vueSource = parse(fs.readFileSync(new URL('../../social-comment-assistant/src/components/Form.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
const vueFunctions = new Set(['getNoteTaskInterval', 'closeNoteInterval', 'activeCommentTaskId', 'getNoteTask', 'getList', 'createAndWriteData', 'resetParams', 'finishCommentWrite']);
const vueCode = parseJS(vueSource, { sourceType: 'module' }).program.body
  .filter(node => node.type === 'VariableDeclaration' && node.declarations.some(item => vueFunctions.has(item.id.name)))
  .map(node => vueSource.slice(node.start, node.end)).join('\n');

function sidebar(status, targetTableId = '', options = {}) {
  const events = [];
  const statusRequests = [];
  const intervals = new Map();
  let intervalId = 0;
  const records = options.empty ? [] : Array.from({ length: 21 }, (_, id) => ({ id }));
  const field = { getType: async () => 'Text', createCell: async value => value };
  const table = {
    getField: async () => field,
    getFieldMetaList: async () => [{ id: 'primary' }],
    setField: async () => {}, addField: async () => {},
    addRecords: async rows => {
      if (options.writeError) throw new Error('write failed');
      events.push(['write', rows.length]);
    },
  };
  const scope = {
    loading: { value: true }, getValidApiKey: () => 'test-key',
    request: async config => {
      if (config.method === 'get') {
        statusRequests.push(config);
        return { data: { sta: 0, data: { status: options.getStatus ? await options.getStatus() : status } } };
      }
      events.push(['list', config.data.page]);
      if (options.listError === config.data.page) return { data: { sta: 1, msg: 'list failed' } };
      return { data: { sta: 0, data: { count: records.length, data: records.slice((config.data.page - 1) * 20, config.data.page * 20) } } };
    },
    setInterval: callback => { intervals.set(++intervalId, callback); return intervalId; },
    clearInterval: id => { intervals.delete(id); events.push(['stop']); },
    showErrorMsg: msg => events.push(['error', msg]),
    showCompletionToast: msg => events.push(['success', msg]),
    ElMessage: value => events.push(['message', value.message]),
    ElNotification: value => events.push(['error', value.message]),
    getActiveFieldConfigs: () => [{ name: '评论ID', key: 'id', type: 'Text' }],
    getFieldWriteValue: (_config, item) => item.id,
    EXISTING_TABLE_REQUIRED_FIELD: '评论ID',
    createSequentialTable: async () => { events.push(['create']); return { tableId: 'new' }; },
    bitable: { base: { getTable: async () => table, getTableById: async () => table, getActiveTable: async () => table }, ui: { switchToTable: async () => {} } },
    console: { log() {}, error() {}, warn() {} },
  };
  const api = new Function(...Object.keys(scope), `let note_timer = null, page = 1, total = 0; const page_size = 20; ${vueCode}; return { getNoteTaskInterval, closeNoteInterval };`)(...Object.values(scope));
  const start = (taskId = 'task') => api.getNoteTaskInterval(taskId, targetTableId);
  const tick = () => { for (const callback of [...intervals.values()]) callback(); };
  return { events, statusRequests, scope, start, tick, stop: api.closeNoteInterval, async run() { start(); tick(); await setImmediate(); } };
}

test('已修复的侧栏主动声明支持失败任务的部分结果，保留真实终态', async () => {
  const fixture = sidebar(2);
  await fixture.run();
  assert.equal(fixture.statusRequests[0].params?.supports_partial_results, 1);
});

for (const status of [1, 2, 3]) {
  for (const target of ['', 'existing']) {
    test(`旧侧栏终态 ${status} 写完两页后再提示：${target || 'new'}`, async () => {
      const fixture = sidebar(status, target);
      await fixture.run();
      assert.deepEqual(fixture.events.filter(event => event[0] === 'list'), [['list', 1], ['list', 2]]);
      assert.deepEqual(fixture.events.filter(event => event[0] === 'write'), [['write', 20], ['write', 1]]);
      assert.equal(fixture.events.filter(event => event[0] === 'create').length, target ? 0 : 1);
      assert.equal(fixture.scope.loading.value, false);
      const notice = fixture.events.at(-1);
      assert.equal(notice[0], status === 1 ? 'success' : 'error');
      if (status !== 1) assert.match(notice[1], /未完成|停止/);
    });
  }
}

test('旧侧栏运行中不读取列表', async () => {
  const fixture = sidebar(0);
  await fixture.run();
  assert.deepEqual(fixture.events, []);
  assert.equal(fixture.scope.loading.value, true);
});

for (const status of [2, 3]) {
  test(`旧侧栏终态 ${status} 无结果时仍提示真实状态，不建空表`, async () => {
    const fixture = sidebar(status, '', { empty: true });
    await fixture.run();
    assert.equal(fixture.events.at(-1)[0], 'error');
    assert.match(fixture.events.at(-1)[1], /未完成|停止/);
    assert.equal(fixture.events.some(event => ['create', 'write', 'success'].includes(event[0])), false);
  });
}

for (const options of [{ listError: 1 }, { listError: 2 }, { writeError: true }]) {
  test(`旧侧栏${JSON.stringify(options)}不报告已写入成功`, async () => {
    const fixture = sidebar(2, 'existing', options);
    await fixture.run();
    assert.equal(fixture.scope.loading.value, false);
    assert.equal(fixture.events.some(event => event[0] === 'success'), false);
    assert.equal(fixture.events.at(-1)[0], 'error');
    assert.doesNotMatch(fixture.events.at(-1)[1], /已写入/);
    if (options.listError === 2) {
      assert.deepEqual(fixture.events.filter(event => event[0] === 'write'), [['write', 20]]);
    }
  });
}

for (const status of [1, 2, 3]) {
  for (const target of ['', 'existing']) {
    for (const timing of ['simultaneous', 'after-write']) {
      test(`旧侧栏并发终态只交付一次：status=${status}, ${target || 'new'}, ${timing}`, async () => {
        const pending = [];
        const fixture = sidebar(status, target, { getStatus: () => new Promise(resolve => pending.push(resolve)) });
        fixture.start();
        fixture.tick();
        fixture.tick();
        assert.equal(pending.length, 2);
        pending[0](status);
        if (timing === 'after-write') await setImmediate();
        pending[1](status);
        await setImmediate();
        assert.deepEqual(fixture.events.filter(event => event[0] === 'list'), [['list', 1], ['list', 2]]);
        assert.deepEqual(fixture.events.filter(event => event[0] === 'write'), [['write', 20], ['write', 1]]);
        assert.equal(fixture.events.filter(event => event[0] === 'create').length, target ? 0 : 1);
        assert.equal(fixture.events.filter(event => ['success', 'error'].includes(event[0])).length, 1);
      });
    }
  }
}

test('旧侧栏上一任务晚返回不停止或写入下一任务', async () => {
  const pending = [];
  const fixture = sidebar(2, '', { getStatus: () => new Promise(resolve => pending.push(resolve)) });
  fixture.start('old-task');
  fixture.tick();
  fixture.tick();
  pending[0](2);
  await setImmediate();
  fixture.start('new-task');
  fixture.tick();
  const eventsBeforeLateResponse = [...fixture.events];
  pending[1](3);
  await setImmediate();
  assert.deepEqual(fixture.events, eventsBeforeLateResponse);
  pending[2](1);
  await setImmediate();
  assert.equal(fixture.events.filter(event => event[0] === 'create').length, 2);
  assert.deepEqual(fixture.events.filter(event => event[0] === 'write'), [['write', 20], ['write', 1], ['write', 20], ['write', 1]]);
  assert.equal(fixture.events.at(-1)[0], 'success');
});

test('旧侧栏查询状态出错后仍能继续轮询并交付', async () => {
  let calls = 0;
  const fixture = sidebar(1, '', { getStatus: async () => {
    if (++calls === 1) throw new Error('network failed');
    return 1;
  } });
  fixture.start();
  fixture.tick();
  await setImmediate();
  assert.equal(fixture.events.length, 0);
  fixture.tick();
  await setImmediate();
  assert.equal(calls, 2);
  assert.equal(fixture.events.filter(event => event[0] === 'create').length, 1);
  assert.equal(fixture.events.at(-1)[0], 'success');
});

for (const stopReason of ['unmount', 'timeout']) {
  test(`旧侧栏${stopReason}停止轮询后忽略在途终态`, async () => {
    const pending = [];
    const fixture = sidebar(2, '', { getStatus: () => new Promise(resolve => pending.push(resolve)) });
    fixture.start();
    fixture.tick();
    if (stopReason === 'timeout') {
      for (let tick = 1; tick < 200; tick += 1) fixture.tick();
      assert.equal(fixture.scope.loading.value, false);
      assert.match(fixture.events.at(-1)[1], /超时/);
    } else {
      fixture.stop();
    }
    const stoppedEvents = [...fixture.events];
    pending.forEach(resolve => resolve(2));
    await setImmediate();
    assert.deepEqual(fixture.events, stoppedEvents);
  });
}

const tsSource = stripTypeScriptTypes(fs.readFileSync(new URL('../../workflow-comment-fetch/src/index.ts', import.meta.url), 'utf8'));
const workflowCode = parseJS(tsSource, { sourceType: 'module' }).program.body
  .filter(node => !['ImportDeclaration', 'ExportDefaultDeclaration'].includes(node.type))
  .map(node => tsSource.slice(node.start, node.end)).join('\n');

function workflow() {
  const actions = [];
  const enums = new Proxy({}, { get: (_target, name) => name });
  new Function('basekit', 't', 'ActionComponent', 'ActionCode', 'ActionResultType', 'AuthorizationType', 'console', 'setTimeout', workflowCode)(
    { addDomainList() {}, addAction: action => actions.push(action) }, value => value,
    enums, { Success: 0, Error: 1254500 }, enums, enums, { log() {} }, callback => callback(),
  );
  return actions[0];
}

for (const status of [1, 2, 3]) {
  for (const empty of [false, true]) {
    test(`旧工作流终态 ${status} 保留字符串数组和真实状态：empty=${empty}`, async () => {
      const action = workflow();
      const fetchedPages = [];
      const statusUrls = [];
      const rows = empty ? [] : Array.from({ length: 21 }, (_, id) => JSON.stringify({ cid: String(id) }));
      const result = await action.execute({ url: 'https://www.xiaohongshu.com/explore/test' }, {
        fetch: async (url, config) => ({ json: async () => {
          if (config.method === 'POST' && !url.endsWith('/list')) return { sta: 0, data: { task_id: 'task-123' } };
          if (config.method === 'GET') {
            statusUrls.push(url);
            return { sta: 0, data: { status } };
          }
          const page = JSON.parse(config.body).page;
          fetchedPages.push(page);
          return { sta: 0, data: { count: rows.length, data: rows.slice((page - 1) * 20, page * 20) } };
        } }),
      });
      assert.deepEqual(fetchedPages, empty ? [1] : [1, 2]);
      assert.equal(new URL(statusUrls[0]).searchParams.get('supports_partial_results'), '1');
      assert.equal(action.resultType.type, 'StringArray');
      assert.deepEqual(result.data, rows);
      assert.equal(result.code, status === 1 ? 0 : 1254500);
      if (status !== 1) {
        assert.match(result.msg, /未完成|停止/);
        assert.ok(result.msg.includes(`已获取${rows.length}条评论`));
        assert.match(result.msg, /task-123/);
      }
    });
  }
}

for (const failedPage of [1, 2]) {
  test(`旧工作流第${failedPage}页读取失败仍返回错误，不能把部分分页当成完整结果`, async () => {
    const result = await workflow().execute({ url: 'https://www.xiaohongshu.com/explore/test' }, {
      fetch: async (url, config) => ({ json: async () => {
        if (config.method === 'GET') return { sta: 0, data: { status: 2 } };
        if (url.endsWith('/list')) {
          if (JSON.parse(config.body).page === failedPage) return { sta: 1, msg: 'list failed' };
          return { sta: 0, data: { count: 21, data: Array(20).fill('{"cid":"comment"}') } };
        }
        return { sta: 0, data: { task_id: 'task' } };
      } }),
    });
    assert.equal(result.code, 1254500);
    assert.equal(result.msg, 'list failed');
    assert.equal(result.data, undefined);
  });
}
