import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

function loadWriteBatch(component, taskName, createAndWriteData) {
  const source = parse(fs.readFileSync(new URL(`../src/components/${component}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const task = parseJS(source, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations)
    .find(node => node.id.name === taskName);
  const callback = task.init.arguments[0].properties.find(node => node.key.name === 'writeBatch').value;
  return new Function('createAndWriteData', 'showFieldProgress', `return (${source.slice(callback.start, callback.end)});`)(createAndWriteData, () => {});
}

for (const [component, taskName] of [['KeywordSearch', 'keywordStreamTask'], ['BloggerSearch', 'searchTask']]) {
  test(`${component}：新表写入失败后恢复仍使用原表，不重复建表`, async () => {
    let saved, createdTables = 0, attempts = 0;
    const targets = [], errors = [], finished = [];
    const timers = new Map(); let timerId = 0;
    const source = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
      .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
    const bitable = { bridge: {
      setData: async (_, value) => { saved = structuredClone(value); },
      getData: async () => structuredClone(saved),
    }, base: { getSelection: async () => ({ baseId: 'base' }) } };
    const create = new Function('bitable', 'setTimeout', 'clearTimeout', `${source}; return useIncrementalTask;`)(bitable,
      (fn) => { timers.set(++timerId, fn); return timerId; }, id => timers.delete(id));
    const writeBatch = loadWriteBatch(component, taskName, async (items, type, taskId, targetId, fields, options) => {
      if (!targetId) {
        targetId = `table-${++createdTables}`;
        await options.onTargetTableReady(targetId);
      }
      targets.push(targetId);
      if (++attempts === 1) throw new Error('write failed');
      return { tableId: targetId };
    });
    const options = { storageKey: 'test', writeBatch,
      getStatus: async () => ({ status: 3 }), isTerminal: status => status.status === 3,
      getResults: async task => ({ items: task.cursor ? [] : [{ user_id: 'author', aweme_id: 'post' }], next_cursor: 'cursor-1', has_more: false }),
      onError: error => errors.push(error), onFinish: (_, task) => finished.push(task.writtenCount),
    };
    const first = create(options);
    await first.start({ taskId: 'task', writeMode: 'upsert' });
    assert.equal(errors.length, 1);
    assert.equal(first.getActiveTask(), null);
    assert.equal(timers.size, 0);
    assert.equal(saved.cursor, '');
    assert.equal(saved.writtenCount, 0);
    assert.equal(saved.targetTableId, 'table-1');
    // 新实例只依赖持久化状态，不能借用上次的内存 task。
    const reopened = create(options);
    assert.equal(await reopened.resume(), true);
    for (const [id, fn] of [...timers]) { timers.delete(id); await fn(); }
    assert.equal(createdTables, 1);
    assert.deepEqual(targets, ['table-1', 'table-1']);
    assert.deepEqual(finished, [1]);
    assert.deepEqual(saved, {});
  });
}
