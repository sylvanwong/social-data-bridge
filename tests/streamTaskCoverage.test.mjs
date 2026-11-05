import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

for (const [component, engineName, key] of [['ProfileFetch', 'profileStreamTask', 'aweme_id'], ['SeriesFetch', 'seriesStreamTask', 'series_id']]) {
  test(`${component}：新表部分写入失败后恢复同一表，核对原批并排空后续结果`, async () => {
    const source = parse(fs.readFileSync(new URL(`../src/components/${component}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
    const decl = parseJS(source, { sourceType: 'module' }).program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations);
    const node = decl.find(n => n.id.name === engineName);
    assert.ok(node, '使用已验证的增量任务引擎');
    const batch = node.init.arguments[0].properties.find(n => n.key.name === 'writeBatch').value;
    let saved, tables = 0, attempts = 0; const rows = [];
    const writer = async (items, type, taskId, target, fields, options) => {
      options.assertActive();
      if (!target) { target = `table-${++tables}`; await options.onTargetTableReady(target); }
      assert.equal(saved.targetTableId, target);
      if (attempts > 0 && !saved.cursor) assert.equal(options.reconcile, true);
      await options.onBeforeWrite();
      assert.equal(saved.pendingWrite, true);
      for (const item of items) if (!options.reconcile || !rows.includes(item[key])) rows.push(item[key]);
      if (++attempts === 1) throw new Error('SDK committed but response lost');
      return { tableId: target };
    };
    const batchFn = new Function('createAndWriteData', 'showProfileFieldProgress', 'showFieldProgress', `return (${source.slice(batch.start, batch.end)})`)(writer, () => {}, () => {});
    const engineSource = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8').replace(/^import .*;\n/, '').replace('export const useIncrementalTask','const useIncrementalTask');
    const timers = new Map(); let id = 0;
    const bitable = { base: { getSelection: async () => ({baseId:'base'}) }, bridge: { getData: async () => structuredClone(saved), setData: async (_, value) => {saved=structuredClone(value)} } };
    const create = new Function('bitable','setTimeout','clearTimeout',`${engineSource};return useIncrementalTask`)(bitable, fn=>{timers.set(++id,fn);return id},id=>timers.delete(id));
    const config = { storageKey: 'test', getStatus: async () => ({status:3}), isTerminal: () => true,
      getResults: async task => ({ items: task.cursor === '2' ? [] : [{[key]: task.cursor ? 'b' : 'a'}], next_cursor: task.cursor ? '2' : '1', has_more: true }),
      writeBatch: batchFn,
    };
    await create(config).start({taskId:'task', writeMode:'append', pendingWrite:false,selectedFieldKeys:[key]});
    assert.equal(tables,1);assert.deepEqual(rows,['a']);assert.equal(saved.cursor,'');
    const reopened=create(config);await reopened.resume();
    assert.deepEqual(rows,['a','b']);assert.equal(tables,1);assert.equal(saved.cursor,'2');
    for(const [id,fn] of [...timers]){timers.delete(id);await fn()}
    assert.deepEqual(saved,{});
  });
}

for (const [page, engine] of [['CommentFetch', 'commentStreamTask'], ['ProfileFetch', 'profileStreamTask'],
  ['SeriesFetch', 'seriesStreamTask'], ['KeywordSearch', 'keywordStreamTask'], ['BloggerSearch', 'searchTask']]) {
  test(`${page}：只拉取和写入，不请求写入确认或启用旧确认模式`, () => {
    const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
    const decl = parseJS(source, { sourceType: 'module' }).program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations);
    const options = decl.find(n => n.id.name === engine).init.arguments[0].properties;
    assert.ok(options.some(n => n.key.name === 'getResults'));
    assert.ok(options.some(n => n.key.name === 'writeBatch'));
    assert.equal(options.some(n => n.key.name === 'acknowledge'), false);
    assert.doesNotMatch(source, /\/feishu\/[^'"\s]*\/ack|flow_control\s*:/);
  });
}

for (const [page, engine, helpers, limit] of [
  ['ProfileFetch', 'profileStreamTask', ['unwrapApiData', 'readAvailablePosts'], 40],
  ['SeriesFetch', 'seriesStreamTask', ['getSeriesResults'], 20],
  ['KeywordSearch', 'keywordStreamTask', [], 40],
]) {
  for (const count of [2, null, undefined]) {
    test(`${page}：真实结果读取接入轮询，总数 ${count}、读取失败重试后仍写完`, async () => {
      const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
      const declarations = parseJS(source, { sourceType: 'module' }).program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations);
      const reader = declarations.find(n => n.id.name === engine).init.arguments[0].properties.find(n => n.key.name === 'getResults').value;
      const helperSource = helpers.map(name => {
        const node = declarations.find(n => n.id.name === name);
        return `const ${name} = ${source.slice(node.init.start, node.init.end)};`;
      }).join('\n');
      let saved, attempts = 0, seq = 0;
      const timers = new Map(), requests = [], rows = [], totals = [], finished = [];
      const request = async config => {
        assert.equal(config.data.limit, limit);
        assert.equal(config.data.task_id, 'old-task');
        requests.push(config.data.after_id);
        if (++attempts === 1) return { data: { sta: 1, msg: '读取失败' } };
        const cursor = config.data.after_id;
        const items = cursor === '2' ? [] : [{ id: cursor ? 'b' : 'a' }];
        const payload = { [count === null ? 'items' : 'data']: items,
          next_cursor: cursor ? '2' : '1', has_more: !cursor,
          ...(count === undefined ? {} : { count }) };
        // 保留短剧已有的嵌套响应兼容。
        return { data: { sta: 0, data: page === 'SeriesFetch' && count === undefined ? { data: payload } : payload } };
      };
      const getResults = new Function('request', 'props', 'STREAM_RESULT_LIMIT', 'listPageSize',
        `${helperSource}; return (${source.slice(reader.start, reader.end)});`)(request, { api_key: 'test-only' }, 40, 20);
      const engineSource = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
        .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
      const bitable = { base: { getSelection: async () => ({ baseId: 'base' }) },
        bridge: { setData: async (_, value) => { saved = structuredClone(value); }, getData: async () => saved } };
      const create = new Function('bitable', 'setTimeout', 'clearTimeout', `${engineSource}; return useIncrementalTask;`)(bitable,
        fn => { timers.set(++seq, fn); return seq; }, id => timers.delete(id));
      const task = create({ storageKey: 'test', getStatus: async () => ({ status: 3 }), isTerminal: () => true, getResults,
        onWriting: (_, active) => totals.push(active.resultCount), writeBatch: async items => rows.push(...items.map(item => item.id)),
        onFinish: (_, active) => finished.push(active.writtenCount), onError: error => assert.fail(error.message) });
      const tick = async () => { const [id, fn] = [...timers][0]; timers.delete(id); await fn(); };
      await task.start({ taskId: 'old-task', targetTableId: 'original-table' });
      assert.deepEqual(rows, []);
      assert.equal(saved.cursor, '');
      await tick();
      assert.deepEqual(rows, ['a', 'b']);
      assert.equal(saved.cursor, '2');
      assert.equal(saved.targetTableId, 'original-table');
      assert.deepEqual(totals, [count === 2 ? 2 : undefined, count === 2 ? 2 : undefined]);
      assert.deepEqual(finished, []);
      await tick();
      assert.deepEqual(requests, ['', '', '1', '2']);
      assert.deepEqual(finished, [2]);
      assert.deepEqual(saved, {});
    });
  }
}
