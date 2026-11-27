import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { taskProgressView } from './helpers/taskStorage.mjs';

function harness(options = {}) {
  const records = {};
  const saved = taskProgressView(records);
  const timers = new Map(); let seq = 0;
  const source = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
  const bitable = { bridge: { setData: async (key, value) => { records[key] = structuredClone(value); }, getData: async key => (key === undefined ? saved.test : records[key]) ?? null },
    base: { getSelection: async () => ({ baseId: 'base' }) } };
  const create = new Function('bitable', 'setTimeout', 'clearTimeout', `${source}; return useIncrementalTask;`)(bitable,
    (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id; }, id => timers.delete(id));
  const calls = [], finished = [], errors = [];
  let batches = [[{ id: 'one' }], []];
  const task = create({ storageKey: 'test', getStatus: async () => ({ status: 3, cancel_requested: true }),
    isTerminal: status => status.status === 3,
    getResults: async () => { const items = batches.shift() || []; return { items, next_cursor: items.length ? 'cursor-1' : '', has_more: false }; },
    writeBatch: async () => calls.push('write'),
    onFinish: (_, task) => finished.push(task.writtenCount), onError: error => errors.push(error), ...options });
  return { task, create, calls, finished, errors, bitable, timers, saved: () => saved.test ?? null,
    tick: async () => { const [id, timer] = [...timers].find(([, timer]) => timer.delay < 60000); timers.delete(id); await timer.fn(); } };
}

test('未配置等待时间的入口仍在 10 分钟无进度后暂停', async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const h = harness({
    getStatus: async () => ({ status: 0, processed: 0 }),
    getResults: async () => ({ items: [] }),
  });
  try {
    await h.task.start({ taskId: 'original' });
    now += 10 * 60 * 1000 - 1;
    await h.tick();
    assert.ok(h.task.getActiveTask());
    now++;
    await h.tick();
    assert.equal(h.task.getActiveTask(), null);
    assert.equal(h.errors[0]?.message, '任务超过 10 分钟没有进度更新，请稍后重试');
    assert.equal(h.saved().taskId, 'original');
  } finally { h.task.stop(); }
});

test('暂停且尚未选定输出表也能结束，后台仍在执行时先等待停止确认', async () => {
  let status = { status: 0 };
  const cancelled = [];
  const h = harness({
    getStatus: async () => status,
    isTerminal: value => [1, 2, 3].includes(value.status),
    writeBatch: async () => { throw new Error('保存任务进度失败'); },
    requestStop: async task => {
      cancelled.push(task.taskId);
      status = { status: 0, cancel_requested: true };
      return status;
    },
  });
  await h.task.start({ taskId: 'old', targetTableId: '' });
  const end = h.errors[0].endPausedTask;
  assert.equal(typeof end, 'function');
  await assert.rejects(end(), /任务正在停止/);
  assert.deepEqual(cancelled, ['old']);
  assert.equal(h.saved().taskId, 'old');
  await assert.rejects(end(), /任务正在停止/);
  assert.deepEqual(cancelled, ['old'], '确认停止前不重复发取消请求');
  status = { status: 3 };
  assert.equal(await end(), true);
  assert.equal(await h.task.resume(), false);
  assert.deepEqual(h.saved(), {});
});

test('新建表后第一次保存返回失败，结束仍认领原任务并保护其他任务', async () => {
  let status = { status: 0 };
  const cancelled = [];
  const h = harness({
    getStatus: async () => status,
    isTerminal: value => [1, 2, 3].includes(value.status),
    writeBatch: async (_, task, { saveProgress }) => {
      // 聚合评论只记录 targetTableId，其他入口可能还记录 initializingTableId。
      task.targetTableId = 'new-table';
      await saveProgress();
      assert.fail('写前保存失败不可写入');
    },
    requestStop: async task => {
      cancelled.push(task.taskId);
      return { status: 0, cancel_requested: true };
    },
  });
  const setData = h.bitable.bridge.setData;
  h.bitable.bridge.setData = (key, value) => key === 'test:progress:base:old:0' && value.targetTableId === 'new-table'
    ? false : setData(key, value);
  await h.task.submit(async () => ({ taskId: 'old', targetTableId: '' }));
  assert.match(h.errors[0]?.message, /保存任务进度失败/);
  const end = h.errors[0].endPausedTask;
  const initial = await h.bitable.bridge.getData('test');
  assert.equal(initial.targetTableId, '');
  for (const change of [{ taskId: 'other' }, { baseId: 'other' }, { retryGeneration: 1 }, { targetTableId: 'other-table' }]) {
    await setData('test', { ...initial, ...change });
    await assert.rejects(end(), /任务进度已变化/);
    assert.deepEqual(await h.bitable.bridge.getData('test'), { ...initial, ...change });
  }
  assert.deepEqual(cancelled, []);
  await setData('test', initial);
  await assert.rejects(end(), /任务正在停止/);
  assert.deepEqual(cancelled, ['old']);
  status = { status: 3 };
  assert.equal(await end(), true);
  assert.equal(await h.task.resume(), false);
  assert.deepEqual(h.saved(), {});
});

for (const [entry, checkpoint] of Object.entries({
  作品搜索: { pendingWrite: true, pendingWriteCount: 2 },
  作品评论: { pendingCommentWrite: true, pendingWriteCount: 2 },
  商品评价: { appendState: { pendingCount: 2 } },
})) {
  test(`聚合${entry}待核对批次返回空列表，保留原进度并允许结束`, async () => {
    const h = harness({
      getStatus: async () => ({ status: 1 }),
      isTerminal: status => status.status === 1,
      getResults: async task => ({ items: [], next_cursor: task.cursor }),
      writeBatch: async () => assert.fail('空列表不可写表'),
      requestStop: async () => assert.fail('已确认结束的后台任务无需再次停止'),
    });
    const original = { taskId: 'old', baseId: 'base', targetTableId: 'table', cursor: 'last', writtenCount: 4, ...checkpoint };
    await h.bitable.bridge.setData('test', original);
    assert.equal(await h.task.resume(), true);
    assert.deepEqual(h.finished, []);
    assert.deepEqual(h.saved(), original);
    assert.match(h.errors[0]?.message, /未返回待核对的结果/);
    assert.equal(await h.errors[0].endPausedTask(), true);
    assert.equal(await h.task.resume(), false);
  });
}

test('聚合任务执行中暂未返回待核对批次时继续轮询，后续可恢复写入', async () => {
  let reads = 0;
  const h = harness({
    getStatus: async () => ({ status: 0 }),
    getResults: async () => ++reads === 1 ? { items: [] } : { items: [{ id: 'next' }], next_cursor: 'next' },
    writeBatch: async (_, task) => {
      h.calls.push(task.cursor);
      task.pendingWrite = false;
      delete task.pendingWriteCount;
    },
  });
  await h.bitable.bridge.setData('test', { taskId: 'old', baseId: 'base', cursor: 'last', writtenCount: 4,
    pendingWrite: true, pendingWriteCount: 1 });
  try {
    assert.equal(await h.task.resume(), true);
    assert.deepEqual(h.errors, []);
    assert.equal(h.saved().pendingWrite, true);
    await h.tick();
    assert.deepEqual(h.calls, ['last']);
    assert.equal(h.saved().cursor, 'next');
    assert.equal(h.saved().writtenCount, 5);
  } finally {
    h.task.stop();
  }
});

test('暂停任务结束前发现进度已被其他窗口换成新任务，保留新任务', async () => {
  const h = harness({ writeBatch: async () => { throw new Error('保存失败'); },
    requestStop: async () => assert.fail('不可停止其他窗口的新任务') });
  await h.task.start({ taskId: 'old', targetTableId: 'table' });
  const end = h.errors[0].endPausedTask;
  await h.bitable.bridge.setData('test', { taskId: 'new', baseId: 'base', targetTableId: 'other' });
  await assert.rejects(end(), /任务进度已变化/);
  assert.equal(h.saved().taskId, 'new');
});

const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const releaseSaveRetry = async h => {
  const retry = [...h.timers].find(([, timer]) => timer.delay === 1000);
  assert.ok(retry, '保存失败后应等待 1 秒，而不是立即暂停或继续写表');
  h.timers.delete(retry[0]);
  retry[1].fn();
  await flush();
};

for (const stage of ['before-write', 'after-write']) {
  for (const persisted of [false, true]) {
    test(`${stage}进度保存${persisted ? '已生效但响应报错' : '失败'}：等1秒重存同一快照，不重复写表`, async () => {
      let attempts = 0;
      const payloads = [], rows = [];
      const h = harness({ operationTimeoutMs: 180000,
        getResults: async task => ({ items: task.cursor ? [] : [{ id: 'one' }], next_cursor: '1', has_more: false }),
        writeBatch: async (items, task, controls) => {
          task.pendingWrite = true;
          task.pendingWriteCount = items.length;
          await controls.saveProgress();
          controls.assertActive();
          rows.push(...items.map(item => item.id));
          task.pendingWrite = false;
          delete task.pendingWriteCount;
        },
      });
      const save = h.bitable.bridge.setData;
      h.bitable.bridge.setData = async (key, value) => {
        if ((stage === 'before-write' && value.pendingWrite) || (stage === 'after-write' && value.cursor === '1')) {
          payloads.push(structuredClone(value));
          if (++attempts === 1) {
            if (persisted) await save(key, value);
            throw new Error('set data error, msg: set block entity error');
          }
        }
        return save(key, value);
      };
      try {
        const running = h.task.start({ taskId: 'original', targetTableId: 'table', selectedFieldKeys: ['id'] });
        await flush();
        assert.equal(attempts, 1);
        assert.deepEqual(rows, stage === 'before-write' ? [] : ['one']);
        assert.deepEqual(h.errors, []);
        // 外部对象变化不能改变已经开始保存的检查点。
        h.task.getActiveTask().selectedFieldKeys.push('later-field');
        await releaseSaveRetry(h);
        await running;
        assert.deepEqual(payloads[0], payloads[1]);
        assert.deepEqual(rows, ['one']);
        assert.equal(h.saved().cursor, '1');
        assert.equal(h.saved().writtenCount, 1);
        await h.tick();
        assert.deepEqual(h.finished, [1]);
        assert.deepEqual(h.saved(), {});
        assert.deepEqual(h.errors, []);
      } finally { h.task.stop(); }
    });
  }
}

for (const stage of ['before-write', 'after-write']) {
  test(`${stage}进度连续保存失败只尝试两次，外层不再补存，恢复原游标`, async () => {
    let attempts = 0, fail = true;
    const rows = new Map();
    const h = harness({ getResults: async task => ({ items: task.cursor ? [] : [{ id: 'one' }], next_cursor: '1', has_more: false }),
      writeBatch: async (items, task, controls) => {
        task.pendingWrite = true;
        task.pendingWriteCount = items.length;
        await controls.saveProgress();
        controls.assertActive();
        for (const item of items) rows.set(item.id, item);
        task.pendingWrite = false;
        delete task.pendingWriteCount;
      },
    });
    const save = h.bitable.bridge.setData;
    h.bitable.bridge.setData = async (key, value) => {
      if (fail && ((stage === 'before-write' && value.pendingWrite) || (stage === 'after-write' && value.cursor === '1'))) {
        attempts++;
        throw new Error('set data error, msg: set block entity error');
      }
      return save(key, value);
    };
    try {
      const running = h.task.start({ taskId: 'original', targetTableId: 'table', pendingWrite: false });
      await flush();
      await releaseSaveRetry(h);
      await running;
      assert.equal(attempts, 2);
      assert.equal(h.errors.length, 1);
      assert.equal(h.errors[0].message, '保存任务进度失败：set data error, msg: set block entity error。已暂停，已写入的数据会保留，请点击「恢复任务」继续。');
      assert.equal(h.errors[0].cause.message, 'set data error, msg: set block entity error');
      assert.equal(h.errors[0].stopPolling, true);
      assert.equal(h.task.getActiveTask(), null);
      assert.equal(h.saved().cursor, '');
      assert.equal(h.saved().writtenCount, 0);
      assert.equal(h.saved().pendingWrite, stage === 'after-write');
      assert.equal(h.timers.size, 0);
      fail = false;
      await h.task.resume();
      assert.deepEqual([...rows.keys()], ['one']);
      assert.equal(h.saved().writtenCount, 1);
      await h.tick();
      assert.deepEqual(h.finished, [1]);
    } finally { h.task.stop(); }
  });
}

for (const stage of ['before-write', 'after-write']) {
  test(`${stage}重试等待期间仍有在途保存保护，停止后不再补存旧任务或推进游标`, async () => {
    const h = harness({
      getResults: async task => ({ items: task.cursor ? [] : [{ id: 'one' }], next_cursor: '1', has_more: false }),
      writeBatch: async (items, task, controls) => {
        task.pendingWrite = true;
        await controls.saveProgress();
        h.calls.push('write');
      },
    });
    const save = h.bitable.bridge.setData;
    let attempts = 0;
    h.bitable.bridge.setData = async (key, value) => {
      if ((stage === 'before-write' && value.pendingWrite) || (stage === 'after-write' && value.cursor === '1')) {
        attempts++; throw new Error('set data error, msg: set block entity error');
      }
      return save(key, value);
    };
    const running = h.task.start({ taskId: 'original' });
    await flush();
    assert.equal(attempts, 1);
    h.task.stop();
    await assert.rejects(h.task.resume(), error => error.pendingMutation && error.requiresReopen);
    await releaseSaveRetry(h);
    await running;
    assert.equal(attempts, 1);
    assert.deepEqual(h.calls, stage === 'before-write' ? [] : ['write']);
    assert.deepEqual(h.errors, []);
    assert.equal(h.saved().cursor, '');
    h.bitable.bridge.setData = save;
    await h.task.start({ taskId: 'new' });
    assert.equal(h.saved().taskId, 'new');
    assert.equal(h.saved().writtenCount, 1);
    h.task.stop();
  });
}

test('保存已超时后原请求才报错，不启动延迟重试；晚响应前仍禁止恢复', async () => {
  const h = harness({ operationTimeoutMs: 180000 });
  const save = h.bitable.bridge.setData;
  let rejectSave, attempts = 0;
  h.bitable.bridge.setData = (key, value) => {
    if (++attempts === 1) return new Promise((_, reject) => { rejectSave = reject; });
    return save(key, value);
  };
  const running = h.task.start({ taskId: 'original' });
  await flush();
  const [id, timeout] = [...h.timers].find(([, timer]) => timer.delay === 180000);
  h.timers.delete(id); timeout.fn();
  await running;
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0].requiresReopen, true);
  await assert.rejects(h.task.resume(), error => error.pendingMutation);
  rejectSave(new Error('set data error, msg: set block entity error'));
  await flush();
  assert.equal(attempts, 1);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.calls, []);
  h.task.stop();
});

test('重试等待期间达到原保存超时，不再发起第二次保存', async () => {
  const h = harness({ operationTimeoutMs: 180000 });
  let attempts = 0;
  h.bitable.bridge.setData = async () => { attempts++; throw new Error('set data error, msg: set block entity error'); };
  const running = h.task.start({ taskId: 'original' });
  await flush();
  const retry = [...h.timers].find(([, timer]) => timer.delay === 1000);
  assert.ok(retry);
  const [id, timeout] = [...h.timers].find(([, timer]) => timer.delay === 180000);
  h.timers.delete(id); timeout.fn();
  await running;
  assert.equal(h.errors[0].requiresReopen, true);
  await releaseSaveRetry(h);
  assert.equal(attempts, 1);
  assert.deepEqual(h.calls, []);
  assert.equal(h.timers.size, 0);
});

for (const [name, detail] of [
  ['权限错误', { response: { status: 403 } }],
  ['参数错误', { response: { status: 400 } }],
  ['鉴权错误', { code: 'INVALID_API_KEY' }],
  ['原保护要求暂停', { stopPolling: true }],
  ['原保护要求重开', { requiresReopen: true }],
  ['未知错误', null],
]) {
  test(`非临时保存错误不重试或外层补存：${name}`, async () => {
    const error = Object.assign(new Error(detail ? 'set data error, msg: set block entity error' : 'unknown SDK error'), detail);
    const h = harness({ getResults: async () => ({ items: [] }), getStatus: async () => ({ status: 0 }) });
    const save = h.bitable.bridge.setData;
    let attempts = 0;
    h.bitable.bridge.setData = async (key, value) => {
      if (++attempts > 1) throw error;
      return save(key, value);
    };
    await h.task.start({ taskId: 'original' });
    assert.equal(attempts, 2, '首次身份保存成功，轮询保存失败后不得外层再补存');
    assert.equal(h.errors.length, 1);
    if (detail?.stopPolling || detail?.requiresReopen) assert.equal(h.errors[0], error);
    else {
      assert.equal(h.errors[0].cause, error);
      assert.match(h.errors[0].message, /保存任务进度失败.*已暂停.*恢复任务/);
    }
    assert.equal(h.saved().taskId, 'original');
    assert.equal(h.timers.size, 0);
    h.task.stop();
  });
}

test('停止后仍写完结果，成功保存游标，排空后结束', async () => {
  const h = harness();
  await h.task.start({ taskId: 'task' });
  assert.deepEqual(h.calls, ['write']);
  assert.equal(h.saved().cursor, 'cursor-1');
  await h.tick();
  assert.deepEqual(h.finished, [1]);
});

test('恢复旧任务，无新增字段也能继续排空剩余结果', async () => {
  const h = harness();
  await h.bitable.bridge.setData('test', { taskId: 'old', baseId: 'base', cursor: '',
    writtenCount: 0 });
  await h.task.resume();
  assert.deepEqual(h.calls, ['write']);
  assert.equal(h.saved().cursor, 'cursor-1');
  await h.tick();
  assert.deepEqual(h.finished, [1]);
  assert.deepEqual(h.errors, []);
});

test('终态清理响应失败后，恢复读取再次失败仍保留待清理任务，恢复成功不重新请求后端', async () => {
  let statusReads = 0, clears = 0;
  const h = harness({ getStatus: async () => { statusReads++; return { status: 3 }; }, getResults: async () => ({ items: [] }) });
  const save = h.bitable.bridge.setData;
  h.bitable.bridge.setData = async (key, value) => {
    await save(key, value);
    if (key.endsWith(':finished') && ++clears === 1) throw new Error('清理已生效但响应失败');
  };
  try {
    await h.task.start({ taskId: 'old' });
    assert.equal(h.errors.length, 1);
    assert.deepEqual(h.saved(), {});
    const read = h.bitable.bridge.getData;
    h.bitable.bridge.getData = async () => { throw new Error('读取暂时失败'); };
    await assert.rejects(h.task.resume(), /读取暂时失败/);
    h.bitable.bridge.getData = read;
    assert.equal(await h.task.resume(), true);
    assert.equal(statusReads, 1);
    assert.equal(clears, 2);
    assert.deepEqual(h.finished, [0]);
    assert.equal(h.task.getActiveTask(), null);
  } finally { h.task.stop(); }
});

test('终态清理失败后恢复记录已被另一任务替换，不得用旧收尾状态清除新任务', async () => {
  let clears = 0; const reads = [];
  const h = harness({ getStatus: async task => { reads.push(task.taskId); return { status: task.taskId === 'old' ? 3 : 0 }; }, getResults: async () => ({ items: [] }) });
  const save = h.bitable.bridge.setData;
  h.bitable.bridge.setData = async (key, value) => {
    if (key.endsWith(':finished') && ++clears === 1) throw new Error('清理失败');
    return save(key, value);
  };
  try {
    await h.task.start({ taskId: 'old' });
    await save('test', { taskId: 'new', baseId: 'base', cursor: 'new-cursor', writtenCount: 5 });
    await h.task.resume();
    assert.equal(clears, 1);
    assert.deepEqual(reads, ['old', 'new']);
    assert.equal(h.task.getActiveTask().taskId, 'new');
    assert.equal(h.saved().cursor, 'new-cursor');
    assert.deepEqual(h.finished, []);
  } finally { h.task.stop(); }
});

for (const stage of ['getStatus', 'getResults']) {
  for (const auth of [{ code: 'INVALID_API_KEY' }, { response: { status: 401 } }, { response: { status: 403 } }]) {
    test(`${stage}鉴权失败${auth.code || auth.response.status}立即暂停并可恢复原任务`, async () => {
      let invalid = true;
      const authError = Object.assign(new Error('API Key 已失效'), auth);
      const h = harness({
        getStatus: async () => { if (stage === 'getStatus' && invalid) throw authError; return { status: 0 }; },
        getResults: async () => { if (stage === 'getResults' && invalid) throw authError; return { items: [] }; },
      });
      await h.bitable.bridge.setData('test', { taskId: 'old', baseId: 'base', cursor: 'saved-cursor', writtenCount: 20 });
      try {
        await h.task.resume();
        assert.equal(h.task.getActiveTask(), null);
        assert.equal(h.errors.length, 1);
        assert.equal(h.errors[0], authError);
        assert.notEqual(h.errors[0].requiresReopen, true);
        assert.equal(h.timers.size, 0, '鉴权失败不得继续安排自动轮询');
        assert.equal(h.saved().cursor, 'saved-cursor');
        assert.equal(h.saved().writtenCount, 20);
        assert.deepEqual(h.calls, []);
        invalid = false;
        await h.task.resume();
        assert.equal(h.task.getActiveTask().taskId, 'old');
        assert.equal(h.task.getActiveTask().cursor, 'saved-cursor');
      } finally { h.task.stop(); }
    });
  }
}

for (const stage of ['getData', 'getSelection', 'getStatus']) {
  test(`${stage}只读超时可同页恢复原任务，晚响应不写入或推进游标`, async () => {
    let release, blocked = true, writes = 0, thrown;
    const gate = new Promise(resolve => { release = resolve; });
    const status = { status: 0, processed: 1 };
    const result = { items: [{ id: 'one' }], next_cursor: 'cursor-1', has_more: false };
    const h = harness({ operationTimeoutMs: 180000,
      getStatus: async () => stage === 'getStatus' && blocked ? gate : status,
      getResults: async task => {
        assert.equal(task.cursor, 'saved-cursor');
        return result;
      },
      writeBatch: async () => { writes++; },
    });
    const saved = { taskId: 'old', baseId: 'base', cursor: 'saved-cursor', writtenCount: 7 };
    await h.bitable.bridge.setData('test', saved);
    const owner = stage === 'getData' ? h.bitable.bridge : stage === 'getSelection' ? h.bitable.base : null;
    const original = owner?.[stage];
    if (owner) owner[stage] = async () => blocked ? gate : original();
    const pending = h.task.resume().catch(error => { thrown = error; });
    for (let i = 0; i < 100; i++) await Promise.resolve();
    const timer = [...h.timers.values()].find(timer => timer.delay === 180000);
    assert.ok(timer);
    timer.fn(); await pending;
    const error = thrown || h.errors[0];
    assert.notEqual(error.requiresReopen, true);
    assert.equal(error.stopPolling, true);
    assert.match(error.message, /超时.*恢复任务/);
    assert.doesNotMatch(error.message, /关闭|重新(?:打开|进入)/);
    assert.equal(writes, 0);
    assert.deepEqual(h.saved(), saved);

    blocked = false;
    release(stage === 'getData' ? saved : stage === 'getSelection' ? { baseId: 'base' } : status);
    for (let i = 0; i < 30; i++) await Promise.resolve();
    assert.equal(writes, 0, '迟到的读取结果不得重新开始写入');
    assert.deepEqual(h.saved(), saved);
    await h.task.resume();
    assert.equal(h.task.getActiveTask().taskId, 'old');
    assert.equal(writes, 1);
    assert.equal(h.saved().cursor, 'cursor-1');
    assert.equal(h.saved().writtenCount, 8);
    h.task.stop();
  });
}

test('写表失败不推进游标', async () => {
  const h = harness({ writeBatch: async () => { throw new Error('write failed'); } });
  await h.task.start({ taskId: 'task' });
  assert.deepEqual(h.calls, []);
  assert.equal(h.saved().cursor, '');
  assert.deepEqual(h.finished, []);
});

test('SDK 写入报错后暂停，后续定时器不会重写，保留上一批写入进度', async (t) => {
  for (const operationTimeoutMs of [0, 180000]) {
    await t.test(`operationTimeoutMs=${operationTimeoutMs}`, async () => {
      const rows = [];
      const h = harness({ operationTimeoutMs,
        getResults: async task => task.cursor === 'cursor-1'
          ? { items: [{ id: 'two' }], next_cursor: 'cursor-2', has_more: false }
          : { items: [{ id: 'one' }], next_cursor: 'cursor-1', has_more: true },
        writeBatch: async items => {
          rows.push(items[0].id);
          // 模拟服务端写入成功，但 SDK 返回错误，不能安全重发。
          if (items[0].id === 'two') throw new Error('SDK response lost');
        },
      });
      await h.task.start({ taskId: 'task', targetTableId: 'table', writeMode: 'append' });
      // 实际执行失败后遗留的轮询，旧实现会再次写入 two。
      for (const [id, timer] of [...h.timers]) {
        h.timers.delete(id);
        await timer.fn();
      }
      assert.deepEqual(rows, ['one', 'two']);
      assert.equal(h.saved().cursor, 'cursor-1');
      assert.equal(h.saved().writtenCount, 1);
      assert.equal(h.saved().targetTableId, 'table');
      assert.equal(h.task.getActiveTask(), null);
      assert.equal(h.timers.size, 0);
      assert.deepEqual(h.finished, []);
      assert.equal(h.errors.length, 1);
      assert.match(h.errors[0].message, /SDK response lost.*已写入的数据会保留.*恢复任务/);
      assert.doesNotMatch(h.errors[0].message, /请核对表格/);
      assert.equal(h.errors[0].cause.message, 'SDK response lost');
    });
  }
});

test('读取结果失败仍可重试，成功后只写入一次', async () => {
  let reads = 0;
  const h = harness({ getResults: async task => {
    if (++reads === 1) throw new Error('read network failed');
    return { items: task.cursor ? [] : [{ id: 'one' }], next_cursor: 'cursor-1', has_more: false };
  } });
  await h.task.start({ taskId: 'task' });
  assert.deepEqual(h.calls, []);
  await h.tick();
  await h.tick();
  assert.deepEqual(h.calls, ['write']);
  assert.deepEqual(h.finished, [1]);
  assert.deepEqual(h.errors, []);
});

test('结果读取超时自动从保存游标补查，迟到的读取结果不写表', async () => {
  let releaseRead;
  const cursors = [], rows = [];
  const h = harness({
    operationTimeoutMs: 180000,
    getResults: async task => {
      cursors.push(task.cursor);
      if (cursors.length === 1) return new Promise(resolve => { releaseRead = resolve; });
      return { items: task.cursor === 'stored' ? [{ id: 'one' }] : [], next_cursor: 'cursor-1' };
    },
    writeBatch: async items => rows.push(...items.map(item => item.id)),
  });
  try {
    await h.bitable.bridge.setData('test', { taskId: 'task', baseId: 'base', targetTableId: 'table', cursor: 'stored' });
    const running = h.task.resume();
    await flush();
    const [, timeout] = [...h.timers].find(([, timer]) => timer.delay === 180000);
    timeout.fn();
    await running;
    assert.deepEqual(h.errors, []);
    assert.equal(h.saved().cursor, 'stored');
    await h.tick();
    releaseRead({ items: [{ id: 'late' }], next_cursor: 'late-cursor' });
    await h.tick();
    assert.deepEqual(cursors, ['stored', 'stored', 'cursor-1']);
    assert.deepEqual(rows, ['one']);
    assert.deepEqual(h.finished, [1]);
    assert.deepEqual(h.saved(), {});
  } finally { h.task.stop(); }
});

test('结果读取持续超时达到原无进度时限，保留任务和游标后暂停', async t => {
  let now = Date.now(), reads = 0;
  t.mock.method(Date, 'now', () => now);
  const h = harness({
    operationTimeoutMs: 180000,
    getResults: async () => { reads++; return new Promise(() => {}); },
  });
  const expireRead = async run => {
    await flush();
    const [, timeout] = [...h.timers].find(([, timer]) => timer.delay === 180000);
    timeout.fn();
    await run;
  };
  try {
    const first = h.task.start({ taskId: 'task', targetTableId: 'table', cursor: 'stored' });
    await expireRead(first);
    assert.deepEqual(h.errors, []);
    now += 10 * 60 * 1000;
    await expireRead(h.tick());
    assert.equal(reads, 2);
    assert.match(h.errors[0]?.message, /读取获取结果超时/);
    assert.equal(h.saved().taskId, 'task');
    assert.equal(h.saved().cursor, 'stored');
    assert.deepEqual(h.calls, []);
    assert.equal(h.timers.size, 0);
  } finally { h.task.stop(); }
});

test('结果读取暂时查不到任务时，原表还在就自动继续原任务', async () => {
  let reads = 0, tableChecks = 0;
  const h = harness({
    requestStop: async () => assert.fail('不应停止后台任务'),
    getResults: async task => ++reads === 1
      ? { sta: -1, msg: '任务不存在' }
      : { items: task.cursor ? [] : [{ id: 'one' }], next_cursor: 'cursor-1' },
  });
  h.bitable.base.isTableExist = async id => { assert.equal(id, 'table'); tableChecks++; return true; };
  try {
    await h.task.start({ taskId: 'task', targetTableId: 'table' });
    assert.equal(tableChecks, 1);
    assert.equal(h.saved().taskId, 'task');
    assert.deepEqual(h.calls, []);
    await h.tick();
    await h.tick();
    assert.deepEqual(h.calls, ['write']);
    assert.deepEqual(h.finished, [1]);
    assert.deepEqual(h.errors, []);
  } finally { h.task.stop(); }
});

test('写表 Promise 不返回也能超时，不推进游标、不自动重新写入', async () => {
  const h = harness({ operationTimeoutMs: 180000, writeBatch: async () => new Promise(() => {}) });
  const running = h.task.start({ taskId: 'task' });
  for (let i = 0; i < 100; i++) await Promise.resolve();
  const timer = [...h.timers.values()].find(t => t.delay >= 60000);
  assert.ok(timer, '必须有独立超时计时器');
  timer.fn(); await running;
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0].message, /写入.*超时/);
  assert.equal(h.errors[0].requiresReopen, true);
  assert.equal(h.saved().cursor, '');
  assert.equal(h.task.getActiveTask(), null);
  assert.deepEqual(h.calls, []);
});

test('旧任务无新增控制参数也能完成', async () => {
  const h = harness();
  await h.task.start({ taskId: 'old' }); await h.tick();
  assert.deepEqual(h.calls, ['write']); assert.deepEqual(h.finished, [1]);
});

test('超时后的旧写入恢复执行时无法再发起写入或保存进度', async () => {
  let release, writes = 0;
  const h = harness({ operationTimeoutMs: 180000,
    writeBatch: async (_, task, controls) => {
      await new Promise(resolve => { release = resolve; });
      controls.assertActive();
      writes++;
      await controls.saveProgress();
    } });
  const running = h.task.start({ taskId: 'task' });
  for (let i = 0; i < 100; i++) await Promise.resolve();
  [...h.timers.values()].find(t => t.delay >= 60000).fn();
  await running;
  release();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(writes, 0);
  assert.equal(h.saved().cursor, '');
});

test('新表 ID 在写入开始前持久化，失败后恢复同一张表', async () => {
  const h = harness({ writeBatch: async (_, task, controls) => {
    task.targetTableId = 'new-table';
    await controls.saveProgress();
    assert.equal(h.saved().targetTableId, 'new-table');
    throw new Error('field setup failed');
  } });
  await h.task.start({ taskId: 'task' });
  assert.equal(h.saved().targetTableId, 'new-table');
  assert.equal(h.saved().cursor, '');
  assert.deepEqual(h.calls, []);
});

test('当前批写入并保存后直接读取下一批', async () => {
  let release;
  const events = [];
  const h = harness({
    getResults: async task => {
      events.push(`read:${task.cursor || 'start'}`);
      return task.cursor === '2' ? { items: [], has_more: false }
        : { items: [{ id: task.cursor ? 'two' : 'one' }], next_cursor: task.cursor ? '2' : '1', has_more: true };
    },
    writeBatch: async items => {
      if (items[0].id === 'one') await new Promise(resolve => { release = resolve; });
      events.push(`write:${items[0].id}`);
    },
  });
  const running = h.task.start({ taskId: 'task' });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.deepEqual(events, ['read:start']);
  release(); await running;
  assert.deepEqual(events, ['read:start', 'write:one', 'read:1', 'write:two', 'read:2']);
  assert.equal(h.saved().cursor, '2');
  assert.equal(h.saved().writtenCount, 2);
  await h.tick();
  assert.deepEqual(h.finished, [2]);
});

test('本轮写完后后台又落库在途页，最终全部写入后才结束', async () => {
  let reads = 0;
  const h = harness({ getResults: async () => {
    reads++;
    return reads <= 2 ? { items: [{ id: reads }], next_cursor: `cursor-${reads}`, has_more: false }
      : { items: [], next_cursor: '', has_more: false };
  } });
  await h.task.start({ taskId: 'task' });
  assert.deepEqual(h.finished, []);
  await h.tick(); assert.deepEqual(h.finished, []);
  await h.tick(); assert.deepEqual(h.finished, [2]);
  assert.deepEqual(h.calls, ['write', 'write']);
});

for (const blocked of ['getData', 'getSelection']) {
  test(`停止使等待中的 ${blocked} 恢复失效，晚返回不写入；之后仍可主动恢复`, async () => {
    const h = harness({ operationTimeoutMs: 180000 });
    const saved = { taskId: 'old', baseId: 'base', cursor: '', writtenCount: 0 };
    await h.bitable.bridge.setData('test', saved);
    const owner = blocked === 'getData' ? h.bitable.bridge : h.bitable.base;
    const original = owner[blocked]; let release, restores = 0;
    owner[blocked] = () => new Promise(resolve => { release = resolve; });
    const pending = h.task.resume(() => { restores++; });
    for (let i = 0; i < 30; i++) await Promise.resolve();
    h.task.stop();
    release(blocked === 'getData' ? saved : { baseId: 'base' });
    assert.equal(await pending, false);
    assert.equal(restores, 0);
    assert.deepEqual(h.calls, []);
    assert.equal(h.task.getActiveTask(), null);
    assert.deepEqual(h.saved(), saved);
    assert.equal(h.timers.size, 0);
    owner[blocked] = original;
    assert.equal(await h.task.resume(), true);
    assert.deepEqual(h.calls, ['write']);
  });
}

test('停止使等待当前表格的启动失效，不保存或执行旧任务', async () => {
  const h = harness(); let release;
  h.bitable.base.getSelection = () => new Promise(resolve => { release = resolve; });
  const pending = h.task.start({ taskId: 'old' });
  h.task.stop(); release({ baseId: 'base' }); await pending;
  assert.deepEqual(h.calls, []);
  assert.equal(h.saved(), null);
  assert.equal(h.task.getActiveTask(), null);
  assert.equal(h.timers.size, 0);
});

test('旧恢复回调晚返回不能轮询或结束后来启动的新任务', async () => {
  const h = harness(); let release;
  await h.bitable.bridge.setData('test', { taskId: 'old', baseId: 'base' });
  const pending = h.task.resume(() => new Promise(resolve => { release = resolve; }));
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await h.task.start({ taskId: 'new' });
  const snapshot = structuredClone(h.saved());
  release();
  assert.equal(await pending, false);
  assert.deepEqual(h.saved(), snapshot);
  assert.equal(h.task.getActiveTask().taskId, 'new');
  assert.deepEqual(h.finished, []);
});

test('停止后等待中的恢复读取报错，不再通知旧页面或重启任务', async () => {
  const h = harness(); let reject;
  h.bitable.bridge.getData = () => new Promise((_, fail) => { reject = fail; });
  const pending = h.task.resume(); h.task.stop(); reject(new Error('late SDK error'));
  assert.equal(await pending, false);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.errors, []);
  assert.equal(h.task.getActiveTask(), null);
});


test('仅保存新任务不执行写入，页面停止后仍可恢复并写完', async () => {
  const h = harness();
  h.task.stop();
  await h.task.saveForResume({ taskId: 'late-task', targetTableId: 'table', pendingCommentWrite: false });
  assert.equal(h.saved().taskId, 'late-task');
  assert.equal(h.saved().baseId, 'base');
  assert.equal(h.saved().cursor, '');
  assert.equal(h.task.getActiveTask(), null);
  assert.deepEqual(h.calls, []);
  assert.equal(h.timers.size, 0);
  await h.task.resume(); await h.tick();
  assert.deepEqual(h.calls, ['write']);
  assert.deepEqual(h.finished, [1]);
});

test('排空后清理超时进入异常保护，晚返回不能再通知完成', async () => {
  const h = harness({ operationTimeoutMs: 180000 });
  await h.task.start({ taskId: 'task' });
  const setData = h.bitable.bridge.setData;
  let release;
  h.bitable.bridge.setData = async (key, value) => {
    if (key.endsWith(':finished')) await new Promise(resolve => { release = resolve; });
    return setData(key, value);
  };
  const clearing = h.tick();
  for (let i = 0; i < 40; i++) await Promise.resolve();
  assert.ok(release);
  [...h.timers.values()].find(timer => timer.delay === 180000).fn();
  await clearing;
  assert.deepEqual(h.finished, []);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0].requiresReopen, true);
  assert.match(h.errors[0].message, /清除任务进度超时/);
  assert.equal(h.task.getActiveTask(), null);
  assert.equal(h.saved().cursor, 'cursor-1');
  release();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.deepEqual(h.finished, []);
  assert.equal(h.errors.length, 1);
  assert.equal(h.timers.size, 0);
  assert.deepEqual(h.calls, ['write']);
});

test('清理明确失败保持可恢复，重试清理不再写入已写入结果', async () => {
  const h = harness(); await h.task.start({ taskId: 'task' });
  const setData = h.bitable.bridge.setData;
  h.bitable.bridge.setData = async (key, value) => {
    if (!value.taskId) throw new Error('clear failed');
    return setData(key, value);
  };
  await h.tick();
  assert.deepEqual(h.finished, []);
  assert.equal(h.errors.length, 1);
  assert.equal(h.task.getActiveTask(), null);
  assert.equal(h.timers.size, 0);
  h.bitable.bridge.setData = setData;
  await h.task.resume();
  assert.deepEqual(h.calls, ['write']);
  assert.deepEqual(h.finished, [1]);
  assert.deepEqual(h.saved(), {});
});


for (const timeOut of [false, true]) {
  test(`清理${timeOut ? '超时后' : '等待期间'}切换实例，旧清理结束前不能恢复或保存新任务`, async () => {
    const h = harness({ operationTimeoutMs: 180000 });
    await h.task.start({ taskId: 'old' });
    const setData = h.bitable.bridge.setData; let release;
    h.bitable.bridge.setData = async (key, task) => {
      if (key.endsWith(':finished')) await new Promise(resolve => { release = resolve; });
      return setData(key, task);
    };
    const clearing = h.tick();
    for (let i = 0; i < 40; i++) await Promise.resolve();
    assert.ok(release);
    if (timeOut) {
      [...h.timers.values()].find(timer => timer.delay === 180000).fn();
      await clearing;
    }
    h.task.stop();
    let reads = 0; const errors = [];
    const next = h.create({ storageKey: 'test', getStatus: async () => { reads++; return { status: 0 }; },
      getResults: async () => ({ items: [] }), writeBatch: async () => assert.fail('不能写入'),
      onError: error => errors.push(error),
    });
    await assert.rejects(next.resume(), error => error.requiresReopen && error.pendingClear);
    await assert.rejects(next.saveForResume({ taskId: 'new' }), error => error.requiresReopen);
    await next.start({ taskId: 'new' });
    assert.equal(errors.length, 1);
    assert.equal(errors[0].requiresReopen, true);
    assert.equal(reads, 0);
    assert.equal(h.saved().taskId, 'old');
    release(); await clearing;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await next.start({ taskId: 'new' });
    assert.equal(h.saved().taskId, 'new');
    assert.equal(reads, 1);
    next.stop();
  });
}

test('提交成功身份在页面卸载后仍保存，新页面等待后恢复同一任务', async () => {
  const h = harness(); let release;
  const submitting = h.task.submit(() => new Promise(resolve => { release = resolve; }));
  h.task.stop();
  let writes = 0;
  const next = h.create({ storageKey: 'test', getStatus: async () => ({ status: 0 }),
    getResults: async task => ({ items: task.cursor ? [] : [{ id: 'one' }], next_cursor: '1' }),
    writeBatch: async () => { writes++; },
  });
  const restoring = next.resume();
  release({ taskId: 'created', pendingWrite: false });
  await submitting; await restoring;
  assert.equal(h.saved().taskId, 'created');
  assert.equal(writes, 1);
  assert.deepEqual(h.calls, []);
  next.stop();
});

for (const waitFor of ['任务创建', '当前表格']) {
  test(`首次保存等待${waitFor}时已有新任务，保留原游标并可恢复`, async () => {
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    const reads = [];
    const h = harness({
      getStatus: async task => { reads.push([task.taskId, task.cursor]); return { status: 0 }; },
      getResults: async () => ({ items: [] }),
      requestStop: async () => assert.fail('不得取消任一后台任务'),
      writeBatch: async () => assert.fail('本次没有待写结果'),
    });
    const wait = async () => { entered.resolve(); await release.promise; };
    if (waitFor === '当前表格') {
      h.bitable.base.getSelection = async () => { await wait(); return { baseId: 'base' }; };
    }
    const submit = h.task.submit(async () => {
      if (waitFor === '任务创建') await wait();
      return { taskId: 'original', targetTableId: 'original-table' };
    });
    await entered.promise;
    await h.bitable.bridge.setData('test', { baseId: 'base', taskId: 'newer', targetTableId: 'other', cursor: 'keep' });
    release.resolve();
    await submit;
    assert.equal(h.saved().taskId, 'newer');
    assert.equal(h.saved().cursor, 'keep');
    assert.deepEqual(reads, []);
    assert.match(h.errors[0].message, /恢复任务/);
    assert.equal(h.errors[0].endPausedTask, undefined);
    assert.equal(await h.task.resume(), true);
    assert.deepEqual(reads, [['newer', 'keep']]);
    h.task.stop();
  });
}

test('首次保存仍可替换已完成的历史任务', async () => {
  const h = harness({ getStatus: async () => ({ status: 0 }), getResults: async () => ({ items: [] }) });
  await h.bitable.bridge.setData('test', { baseId: 'base', taskId: 'finished', targetTableId: 'old-table' });
  await h.bitable.bridge.setData('test:progress:base:finished:0:finished', { finished: true });
  await h.task.submit(async () => ({ taskId: 'original', targetTableId: 'original-table' }));
  assert.equal(h.saved().taskId, 'original');
  assert.equal(h.task.getActiveTask().targetTableId, 'original-table');
  assert.deepEqual(h.errors, []);
  h.task.stop();
});

test('提交成功但保存失败：新实例补存原任务，不重新创建', async () => {
  const h = harness(); const save = h.bitable.bridge.setData; let creates = 0;
  h.bitable.bridge.setData = async () => { throw new Error('save failed'); };
  await h.task.submit(async () => { creates++; return { taskId: 'created', targetTableId: 'table', pendingWrite: false }; });
  assert.equal(h.errors.length, 1);
  h.bitable.bridge.setData = save;
  const next = h.create({ storageKey: 'test', getStatus: async () => ({ status: 0 }),
    getResults: async () => ({ items: [] }), writeBatch: async () => {},
  });
  await next.resume();
  assert.equal(h.saved().taskId, 'created');
  assert.equal(h.saved().targetTableId, 'table');
  assert.equal(creates, 1); next.stop();
});

test('首次保存失败可结束已创建任务，结束标记保存成功才退出恢复', async () => {
  let creates = 0, status = 0, stops = 0;
  const stopStarted = Promise.withResolvers(), stopReply = Promise.withResolvers();
  const h = harness({
    getStatus: async task => { assert.equal(task.taskId, 'created'); return { status }; },
    requestStop: async task => {
      assert.equal(task.taskId, 'created');
      stops++;
      stopStarted.resolve();
      return stopReply.promise;
    },
  });
  const save = h.bitable.bridge.setData;
  let rejectMarker = true;
  h.bitable.bridge.setData = async (key, value) => {
    if (key === 'test' || rejectMarker) throw new Error('save failed');
    return save(key, value);
  };
  await h.task.submit(async () => { creates++; return { taskId: 'created', targetTableId: 'table' }; });
  const end = h.errors[0].endPausedTask;
  assert.equal(typeof end, 'function');
  const retryError = await h.task.resume().catch(error => error);
  assert.match(retryError.message, /save failed/);
  assert.equal(typeof retryError.endPausedTask, 'function');
  const ending = end();
  await stopStarted.promise;
  await assert.rejects(h.task.resume(), /正在结束原任务/);
  stopReply.resolve({ status: 0 });
  await assert.rejects(ending, /正在停止/);
  assert.equal(stops, 1);
  status = 3;
  await assert.rejects(end(), /save failed/);
  rejectMarker = false;
  await end();
  assert.equal(await h.task.resume(), false);
  assert.equal(creates, 1);
  assert.deepEqual(h.calls, []);
});

test('首次保存失败后已有新任务，旧结束入口不停止它，重进从新任务的游标恢复', async () => {
  const h = harness({ requestStop: async () => assert.fail('不得停止任务') });
  const save = h.bitable.bridge.setData;
  h.bitable.bridge.setData = async () => { throw new Error('save failed'); };
  await h.task.submit(async () => ({ taskId: 'created', targetTableId: 'table' }));
  await save('test', { baseId: 'base', taskId: 'newer', targetTableId: 'other', cursor: 'keep' });
  const end = h.errors[0].endPausedTask;
  assert.equal(typeof end, 'function');
  await assert.rejects(end(), /任务进度已变化/);
  h.bitable.bridge.setData = save;
  const resumed = [];
  const next = h.create({ storageKey: 'test',
    getStatus: async task => { resumed.push([task.taskId, task.cursor]); return { status: 0 }; },
    getResults: async () => ({ items: [] }), writeBatch: async () => assert.fail('不得补写旧任务') });
  assert.equal(await next.resume(), true);
  assert.deepEqual(resumed, [['newer', 'keep']]);
  assert.equal(h.saved().cursor, 'keep');
  await assert.rejects(end(), /任务进度已变化/);
  next.stop();
});

test('旧页面SDK写入尚未返回，新实例不能恢复重复写入', async () => {
  let release;
  const h = harness({ writeBatch: () => new Promise(resolve => { release = resolve; }) });
  const running = h.task.start({ taskId: 'task' });
  for (let i = 0; i < 30; i++) await Promise.resolve();
  h.task.stop();
  const next = h.create({ storageKey: 'test', getStatus: async () => ({ status: 0 }),
    getResults: async () => ({ items: [] }), writeBatch: async () => assert.fail('旧写入未结束'),
  });
  await assert.rejects(next.resume(), error => error.requiresReopen);
  release(); await running;
  assert.equal(await next.resume(), true); next.stop();
});

test('旧页面提交明确失败，新页面不会误进入不存在任务的恢复状态', async () => {
  const h = harness(); let reject;
  const pending = h.task.submit(() => new Promise((_, fail) => { reject = fail; }));
  h.task.stop();
  const next = h.create({ storageKey: 'test', getStatus: async () => assert.fail('未创建任务'),
    getResults: async () => ({ items: [] }), writeBatch: async () => {} });
  const restoring = next.resume(); reject(new Error('创建失败'));
  await pending; assert.equal(await restoring, false);
  await next.submit(async () => ({taskId: ''}));
  assert.equal(await next.resume(), false);
});

test('新实例进入时提交正在保存身份，等待保存后自动恢复', async () => {
  const h = harness(); const save = h.bitable.bridge.setData; let release;
  h.bitable.bridge.setData = async (key, task) => { await new Promise(resolve => {release = resolve}); return save(key,task); };
  const pending = h.task.submit(async () => ({taskId:'created'}));
  for(let i=0;i<20;i++) await Promise.resolve();
  h.task.stop();
  h.bitable.bridge.setData = save;
  const next=h.create({storageKey:'test',getStatus:async()=>({status:0}),getResults:async()=>({items:[]}),writeBatch:async()=>{}});
  const restoring=next.resume();release();await pending;assert.equal(await restoring,true);
  assert.equal(h.saved().taskId,'created');next.stop();
});

for (const lateSaveSucceeded of [true, false]) {
  test(`首次保存超时后最终${lateSaveSucceeded ? '成功' : '失败'}，同一会话重进恢复原任务`, async () => {
    const h = harness({ operationTimeoutMs: 180000 });
    const save = h.bitable.bridge.setData;
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    let creates = 0, initialSaves = 0;
    h.bitable.bridge.setData = async (key, value) => {
      if (key !== 'test' || ++initialSaves > 1) return save(key, value);
      entered.resolve();
      await release.promise;
      if (!lateSaveSucceeded) throw new Error('迟到的首次保存失败');
      return save(key, value);
    };
    const submit = h.task.submit(async () => { creates++; return { taskId: 'original', targetTableId: 'table' }; });
    await entered.promise;
    [...h.timers.values()].find(timer => timer.delay === 180000).fn();
    await submit;
    const statuses = [];
    const next = h.create({ storageKey: 'test', operationTimeoutMs: 180000,
      getStatus: async task => { statuses.push([task.taskId, task.cursor]); return { status: 0 }; },
      getResults: async () => ({ items: [] }), writeBatch: async () => assert.fail('本次没有待写结果') });
    await assert.rejects(next.resume(), error => error.requiresReopen && /保存写入进度超时/.test(error.message));
    assert.equal(initialSaves, 1);
    assert.deepEqual(statuses, []);
    release.resolve();
    await new Promise(setImmediate);
    if (lateSaveSucceeded) {
      await save('test:progress:base:original:0', { ...h.saved(), cursor: 'confirmed-cursor' });
    }
    assert.equal(await next.resume(), true);
    assert.deepEqual(statuses, [['original', lateSaveSucceeded ? 'confirmed-cursor' : '']]);
    assert.equal(initialSaves, lateSaveSucceeded ? 1 : 2);
    assert.equal(creates, 1);
    next.stop();
  });
}

test('首次保存超时且迟到失败后，补存等表格时保留并恢复其他窗口的新任务', async () => {
  const resumed = [];
  const h = harness({ operationTimeoutMs: 180000,
    getStatus: async task => { resumed.push([task.taskId, task.cursor]); return { status: 0 }; },
    getResults: async () => ({ items: [] }) });
  const save = h.bitable.bridge.setData;
  const writeStarted = Promise.withResolvers(), writeReply = Promise.withResolvers();
  h.bitable.bridge.setData = async () => { writeStarted.resolve(); await writeReply.promise; throw new Error('迟到的保存失败'); };
  const submit = h.task.submit(async () => ({ taskId: 'original' }));
  await writeStarted.promise;
  [...h.timers.values()].find(timer => timer.delay === 180000).fn();
  await submit;
  writeReply.resolve();
  await new Promise(setImmediate);
  const readingBase = Promise.withResolvers(), baseReply = Promise.withResolvers();
  h.bitable.base.getSelection = () => { readingBase.resolve(); return baseReply.promise; };
  h.bitable.bridge.setData = save;
  const retry = h.task.resume();
  await readingBase.promise;
  await save('test', { baseId: 'base', taskId: 'newer', targetTableId: 'other', cursor: 'keep' });
  baseReply.resolve({ baseId: 'base' });
  assert.equal(await retry, true);
  assert.deepEqual(resumed, [['newer', 'keep']]);
  assert.equal(h.saved().taskId, 'newer');
  assert.equal(h.saved().cursor, 'keep');
  h.task.stop();
});

test('首次保存等待自动重试的 1 秒期间已有新任务，不再发布旧任务', async () => {
  const resumed = [];
  const h = harness({ getStatus: async task => { resumed.push([task.taskId, task.cursor]); return { status: 0 }; },
    getResults: async () => ({ items: [] }) });
  const save = h.bitable.bridge.setData;
  let initialWrites = 0;
  h.bitable.bridge.setData = async (key, value) => {
    if (key === 'test' && ++initialWrites === 1) throw new Error('set data error, msg: set block entity error');
    return save(key, value);
  };
  const submit = h.task.submit(async () => ({ taskId: 'original' }));
  await new Promise(setImmediate);
  await save('test', { baseId: 'base', taskId: 'newer', targetTableId: 'other', cursor: 'keep' });
  await h.tick();
  await submit;
  assert.equal(initialWrites, 1);
  assert.deepEqual(resumed, []);
  assert.match(h.errors[0].message, /恢复任务/);
  assert.equal(await h.task.resume(), true);
  assert.deepEqual(resumed, [['newer', 'keep']]);
  assert.equal(h.saved().cursor, 'keep');
  h.task.stop();
});

test('首次保存已生效但返回临时错误，自动恢复原进度且不重复保存', async () => {
  const resumed = [];
  const h = harness({ getStatus: async task => { resumed.push([task.taskId, task.cursor]); return { status: 0 }; },
    getResults: async () => ({ items: [] }) });
  const save = h.bitable.bridge.setData;
  let initialWrites = 0;
  h.bitable.bridge.setData = async (key, value) => {
    await save(key, value);
    if (key === 'test' && ++initialWrites === 1) throw new Error('set data error, msg: set block entity error');
  };
  const submit = h.task.submit(async () => ({ taskId: 'original', targetTableId: 'table' }));
  await new Promise(setImmediate);
  await save('test:progress:base:original:0', { ...h.saved(), cursor: 'keep' });
  await h.tick();
  await submit;
  assert.equal(initialWrites, 1);
  assert.deepEqual(resumed, [['original', 'keep']]);
  assert.deepEqual(h.errors, []);
  h.task.stop();
});

test('补存检查发现原记录已完成时，仍可保存新任务并继续原配置', async () => {
  const h = harness({ getStatus: async () => ({ status: 0 }), getResults: async () => ({ items: [] }) });
  const save = h.bitable.bridge.setData;
  await save('test', { baseId: 'base', taskId: 'finished', targetTableId: 'old-table' });
  await save('test:progress:base:finished:0:finished', { finished: true });
  h.bitable.bridge.setData = async () => { throw new Error('首次保存失败'); };
  await h.task.submit(async () => ({ taskId: 'original', targetTableId: 'original-table' }));
  h.bitable.bridge.setData = save;
  assert.equal(await h.task.resume(), true);
  assert.equal(h.saved().taskId, 'original');
  assert.equal(h.saved().targetTableId, 'original-table');
  h.task.stop();
});

test('补存核对旧记录的结束标记时收到新任务，继续使用新任务的检查点', async () => {
  const resumed = [];
  const h = harness({ getStatus: async task => { resumed.push([task.taskId, task.cursor]); return { status: 0 }; },
    getResults: async () => ({ items: [] }) });
  const save = h.bitable.bridge.setData;
  const read = h.bitable.bridge.getData;
  const previousMarker = 'test:progress:base:finished:0:finished';
  await save('test', { baseId: 'base', taskId: 'finished', targetTableId: 'old-table' });
  await save(previousMarker, { finished: true });
  h.bitable.bridge.setData = async () => { throw new Error('首次保存失败'); };
  await h.task.submit(async () => ({ taskId: 'original', targetTableId: 'original-table' }));
  h.bitable.bridge.setData = save;
  const markerRead = Promise.withResolvers(), markerReply = Promise.withResolvers();
  h.bitable.bridge.getData = async key => {
    if (key === previousMarker) {
      markerRead.resolve();
      await markerReply.promise;
    }
    return read(key);
  };
  const retry = h.task.resume();
  await markerRead.promise;
  await save('test', { baseId: 'base', taskId: 'newer', targetTableId: 'other', cursor: 'keep' });
  markerReply.resolve();
  assert.equal(await retry, true);
  assert.deepEqual(resumed, [['newer', 'keep']]);
  assert.equal(h.saved().cursor, 'keep');
  h.task.stop();
});

test('创建后只读表格信息超时：保留身份并允许补存，晚返回不覆盖新进度', async () => {
  const h=harness({operationTimeoutMs:180000});let release;
  h.bitable.base.getSelection=()=>new Promise(resolve=>{release=resolve});
  const pending=h.task.submit(async()=>({taskId:'created',pendingWrite:false}));
  for(let i=0;i<30;i++)await Promise.resolve();
  [...h.timers.values()].find(timer=>timer.delay===180000).fn();await pending;
  assert.equal(h.errors.length,1);assert.equal(!!h.errors[0].requiresReopen,false);
  assert.equal(h.saved(),null);
  h.bitable.base.getSelection=async()=>({baseId:'base'});
  const next=h.create({storageKey:'test',getStatus:async()=>({status:0}),getResults:async()=>({items:[]}),writeBatch:async()=>{}});
  assert.equal(await next.resume(),true);assert.equal(h.saved().taskId,'created');
  release({baseId:'old'});for(let i=0;i<20;i++)await Promise.resolve();
  assert.equal(h.saved().baseId,'base');next.stop();
});

test('停止后各批实际结果总数持续扣减，统计缺失不影响排空也不沿用旧总数', async () => {
  const progress = [];
  const h = harness({
    getResults: async task => {
      const cursor=Number(task.cursor||0);
      return cursor >= 3 ? {items:[],has_more:false}
        : {items:[{id:cursor}],next_cursor:String(cursor+1),has_more:true,...(cursor<2?{count:3}:{count:null})};
    },
    onWriting: (items, task) => progress.push([task.resultCount,task.writtenCount]),
  });
  await h.task.start({taskId:'task',resultCount:999});
  assert.deepEqual(progress,[[3,0],[3,1],[undefined,2]]);
  assert.equal(h.saved().writtenCount,3);
  assert.equal(h.saved().cursor,'3');
  await h.tick();
  assert.deepEqual(h.finished,[3]);
  assert.deepEqual(h.errors,[]);
});

for (const count of [2, null, undefined]) {
  test(`停止后连续轮询保留已确认总数，结果统计为 ${count} 时再更新或降级`, async () => {
    let release;
    const progress = [], writing = [];
    const h = harness({
      getResults: async task => {
        if (!task.cursor) return {items:[{id:'one'}],count:2,next_cursor:'1',has_more:false};
        if (task.cursor === '2') return {items:[],count:2,has_more:false};
        await new Promise(resolve => { release=resolve; });
        return {items:[{id:'two'}],count,next_cursor:'2',has_more:false};
      },
      onProgress: (_,task) => progress.push([task.resultCount,task.writtenCount]),
      onWriting: (_,task) => writing.push(task.resultCount),
    });
    await h.task.start({taskId:'task'});
    assert.deepEqual(progress.at(-1),[2,1]);
    const polling=h.tick();
    for(let i=0;i<30&&!release;i++) await Promise.resolve();
    assert.equal(typeof release,'function');
    assert.deepEqual(progress.at(-1),[2,1], '等待新结果期间不能清空已确认总数');
    release(); await polling;
    assert.equal(writing[1], count === 2 ? 2 : undefined);
    assert.equal(h.saved().cursor,'2');
    assert.equal(h.saved().writtenCount,2);
    await h.tick();
    assert.deepEqual(h.finished,[2]);
    assert.deepEqual(h.errors,[]);
  });
}

test('恢复已停止任务保留已确认总数，只写剩余批次', async () => {
  const progress = [], rows = [];
  const h = harness({
    getResults: async task => task.cursor === '101'
      ? {items:[],count:101,has_more:false}
      : {items:[{id:'remaining'}],count:101,next_cursor:'101',has_more:false},
    onProgress: (_,task) => progress.push(task.resultCount),
    writeBatch: async items => rows.push(...items.map(item=>item.id)),
  });
  await h.bitable.bridge.setData('test', {taskId:'old',baseId:'base',cursor:'100',writtenCount:100,
    latestStatus:{status:3},resultCount:101});
  await h.task.resume();
  assert.equal(progress[0],101);
  assert.deepEqual(rows,['remaining']);
  await h.tick();
  assert.deepEqual(h.finished,[101]);
});

test('旧恢复信息未确认停止时，不使用残留的结果总数', async () => {
  const progress=[];
  const h=harness({onProgress:(_,task)=>progress.push(task.resultCount)});
  await h.bitable.bridge.setData('test',{taskId:'old',baseId:'base',cursor:'',writtenCount:0,resultCount:999});
  await h.task.resume();
  assert.equal(progress[0],undefined);
  await h.tick();
  assert.deepEqual(h.finished,[1]);
});

test('终态作者失败名单只用于结果展示，恢复快照保留状态和游标', async () => {
  const failed_items = [{ url: 'author-2', reason: '作者主页不可访问' }];
  const invalid_items = [{ url: 'bad', reason: '未能从输入识别作者' }];
  let result;
  const h = harness({
    getStatus: async () => ({ status: 3, failed: 1, failed_items, invalid_items }),
    onFinish: (status, task) => { result = { status, writtenCount: task.writtenCount }; },
  });
  await h.task.start({ taskId: 'profile' });
  assert.deepEqual(h.saved().latestStatus, { status: 3, failed: 1 });
  assert.equal(h.saved().cursor, 'cursor-1');
  h.task.stop();
  await h.task.resume();
  assert.deepEqual(result, { status: { status: 3, failed: 1, failed_items, invalid_items }, writtenCount: 1 });
  assert.deepEqual(h.calls, ['write']);
});

test('原有输出表已删除时只结束本轮任务，同一任务 ID 的下一轮续跑仍可恢复', async () => {
  let writes = 0;
  const h = harness({
    requestStop: async () => assert.fail('终态不得发停止请求'),
    writeBatch: async () => {
      writes++;
      throw new Error('table not found error');
    },
  });
  h.bitable.base.isTableExist = async id => { assert.equal(id, 'deleted'); return false; };
  await h.task.start({ taskId: 'original', targetTableId: 'deleted', formData: { radio: 2 } });
  assert.equal(h.task.getActiveTask(), null);
  assert.equal(h.saved().taskId, 'original');
  assert.equal(await h.errors[0].endMissingTarget(), true);
  assert.equal(h.saved().taskId, 'original');
  assert.equal(writes, 1);
  assert.equal(h.timers.size, 0);

  const restored = [];
  const reopened = h.create({
    storageKey: 'test',
    getStatus: async task => { restored.push(task.retryGeneration); return { status: 0 }; },
    getResults: async () => ({ items: [] }),
  });
  try {
    assert.equal(await reopened.resume(), false);
    assert.deepEqual(restored, []);
    await h.bitable.bridge.setData('test', { ...h.saved(), retryGeneration: 1 });
    assert.equal(await reopened.resume(), true);
    assert.deepEqual(restored, [1]);
  } finally { reopened.stop(); }
});

for (const stage of ['运行状态', '终态', '结果列表', '在途写入']) {
  test(`另一窗口结束旧任务后，迟到的${stage}不会修改新任务进度`, async () => {
    let entered, release, writes = 0;
    const pending = new Promise(resolve => { release = resolve; });
    const waiting = new Promise(resolve => { entered = resolve; });
    const wait = value => { entered(); return pending.then(() => value); };
    const old = { taskId: 'old', baseId: 'base', targetTableId: 'target', cursor: 'old-cursor' };
    const next = { ...old, taskId: 'new', cursor: 'new-cursor' };
    const items = { items: [{ id: 'old-row' }], next_cursor: 'old-next' };
    const h = harness({
      getStatus: async () => stage === '运行状态' || stage === '终态'
        ? wait({ status: stage === '终态' ? 3 : 0 }) : { status: 0 },
      getResults: async () => stage === '结果列表' ? wait(items)
        : stage === '在途写入' ? items : { items: [] },
      writeBatch: async () => { writes++; if (stage === '在途写入') await wait(); },
    });
    await h.bitable.bridge.setData('test', old);
    const running = h.task.resume();
    try {
      await waiting;
      await h.bitable.bridge.setData('test:ended:base:target:old:0', true);
      await h.bitable.bridge.setData('test', next);
      release();
      await running;
      assert.deepEqual(h.saved(), next);
      assert.equal(writes, stage === '在途写入' ? 1 : 0);
      assert.deepEqual(h.finished, []);
      assert.equal(h.task.getActiveTask(), null);
      assert.equal(h.timers.size, 0);
      assert.match(h.errors[0]?.message, /其他窗口.*结束/);
    } finally { release(); h.task.stop(); }
  });
}


for (const operation of ['保存', '清理']) {
  test(`旧任务已发出的进度${operation}晚于新任务生效，新任务仍从原游标恢复`, async () => {
    const source = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
      .replace(/^import .*;\n/gm, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
    const load = new Function('bitable', 'shallowRef', 'triggerRef', 'setBridgeData', 'setTimeout', 'clearTimeout',
      `${source}; return useIncrementalTask;`);
    const shared = new Map([['task', { taskId: 'old', baseId: 'base', targetTableId: 'old-table', cursor: 'old-cursor' }]]);
    let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    const reply = new Promise(resolve => { release = resolve; });
    const queries = [];
    const make = old => {
      const setData = async (key, value) => {
        if (old) { entered(); await reply; }
        shared.set(key, structuredClone(value));
        return true;
      };
      const bitable = {
        base: { getSelection: async () => ({ baseId: 'base' }) },
        bridge: { getData: async key => structuredClone(shared.get(key)), setData },
      };
      return load(bitable, value => ({ value }), () => {}, setData, () => 1, () => {})({
        storageKey: 'task',
        getStatus: async task => { queries.push([task.taskId, task.cursor]); return { status: old && operation === '清理' ? 1 : 0 }; },
        getResults: async () => ({ items: [] }),
        writeBatch: async () => assert.fail('用例不应写表'),
      });
    };
    const old = make(true), next = make(false), reopened = make(false);
    const running = old.resume();
    try {
      await started;
      await next.start({ taskId: 'new', targetTableId: 'new-table', cursor: 'new-cursor' });
      release();
      await running;
      assert.equal(await reopened.resume(), true);
      assert.deepEqual(queries.at(-1), ['new', 'new-cursor']);
    } finally {
      release();
      old.stop(); next.stop(); reopened.stop();
    }
  });
}

for (const beforeWrite of [false, true]) {
  test(`同一任务已在另一窗口完成，迟到的${beforeWrite ? '写入前检查点' : '轮询进度'}不会引发重复写入`, async () => {
    const source = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
      .replace(/^import .*;\n/gm, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
    const load = new Function('bitable', 'shallowRef', 'triggerRef', 'setBridgeData', 'setTimeout', 'clearTimeout',
      `${source}; return useIncrementalTask;`);
    const saved = { taskId: 'same', baseId: 'base', targetTableId: 'table', cursor: 'previous' };
    const shared = new Map([['task', saved]]);
    const waiting = Promise.withResolvers();
    const delayed = Promise.withResolvers();
    const writes = [], errors = [], finished = [];
    let reopenQueries = 0;
    const make = role => {
      let tick;
      const setData = async (key, value) => {
        const snapshot = structuredClone(value);
        if (role === 'old' && value.taskId) {
          waiting.resolve();
          await delayed.promise;
        }
        shared.set(key, snapshot);
      };
      const bitable = {
        base: { getSelection: async () => ({ baseId: 'base' }) },
        bridge: { getData: async key => structuredClone(shared.get(key)), setData },
      };
      const task = load(bitable, value => ({ value }), () => {}, setData,
        callback => (tick = callback), () => {})({
        storageKey: 'task',
        getStatus: async () => {
          if (role === 'reopen') reopenQueries++;
          return { status: role === 'old' ? 0 : 1 };
        },
        getResults: async task => (role !== 'old' || beforeWrite) && task.cursor === 'previous'
          ? { items: ['row'], next_cursor: 'last' } : { items: [] },
        writeBatch: async (items, task, controls) => {
          await controls.saveProgress();
          writes.push(...items);
        },
        onFinish: () => finished.push(role),
        onError: error => errors.push(error),
      });
      return { task, tick: () => tick() };
    };
    const old = make('old'), current = make('current'), reopened = make('reopen');
    const pending = old.task.resume();
    try {
      await waiting.promise;
      await current.task.resume();
      await current.tick();
      assert.deepEqual(finished, ['current']);
      assert.deepEqual(writes, ['row']);
      assert.equal([...shared].filter(([key, value]) => key !== 'task' && value.taskId).length, 0,
        '完成后应清理本轮的滚动进度快照');
      delayed.resolve();
      await pending;
      assert.deepEqual(writes, ['row']);
      assert.equal(await reopened.task.resume(), false);
      assert.equal(reopenQueries, 0);
      assert.deepEqual(writes, ['row']);
      if (beforeWrite) assert.match(errors[0]?.message, /其他窗口.*结束/);
    } finally {
      delayed.resolve();
      old.task.stop(); current.task.stop(); reopened.task.stop();
      await pending;
    }
  });
}

test('超限的手动输入和历史同 ID 基线分块保存，重进仍恢复原值', async () => {
  const h = harness({ getResults: async () => ({ items: [] }), getStatus: async () => ({ status: 0 }) });
  const original = {
    taskId: 'large-task', targetTableId: 'table',
    sourceSnapshot: { manualUrls: Array.from({ length: 2800 }, (_, i) => `https://example.test/商品/${i}/"`).join('\n') },
    appendState: { pendingCount: 20, knownRecordIds: Array.from({ length: 20000 }, (_, i) => `rec${String(i).padStart(14, '0')}`) },
  };
  const save = h.bitable.bridge.setData;
  let maxBytes = 0;
  const initialParts = [];
  h.bitable.bridge.setData = async (key, value) => {
    const size = Buffer.byteLength(JSON.stringify(value));
    if (size > 102400) { maxBytes = size; return false; }
    maxBytes = Math.max(maxBytes, size);
    if (key.startsWith('test:part:') && typeof value.data === 'string') initialParts.push(key);
    await save(key, value);
    return true;
  };
  const options = {
    storageKey: 'test', getStatus: async () => ({ status: 0 }), getResults: async () => ({ items: [] }),
  };
  try {
    await h.task.start(original);
    assert.deepEqual(h.errors, []);
    const published = await h.bitable.bridge.getData('test');
    const progress = await h.bitable.bridge.getData('test:progress:base:large-task:0');
    assert.deepEqual(progress.checkpointParts.sourceSnapshot, published.checkpointParts.sourceSnapshot);
    assert.ok(initialParts.length > 1);
    h.task.stop();
    const next = h.create(options);
    try {
      assert.equal(await next.resume(task => {
        assert.deepEqual(task.sourceSnapshot, original.sourceSnapshot);
        assert.deepEqual(task.appendState, original.appendState);
      }), true);
      assert.ok(maxBytes <= 80 * 1024);
    } finally { next.stop(); }
  } finally { h.task.stop(); }
});

test('写前分块中途失败时保留原游标，恢复后只写入一次', async () => {
  let writes = 0;
  const historicalIds = Array.from({ length: 20000 }, (_, i) => `rec${String(i).padStart(14, '0')}`);
  const h = harness({
    getResults: async task => task.cursor ? { items: [] } : { items: [{ id: 'one' }], next_cursor: 'next' },
    writeBatch: async (_, task, { saveProgress }) => {
      task.pendingWrite = true;
      task.appendState = { pendingCount: 1, knownRecordIds: historicalIds };
      await saveProgress();
      writes++;
      task.pendingWrite = false;
      delete task.appendState;
    },
  });
  const save = h.bitable.bridge.setData;
  let fail = true;
  let stagedKey;
  h.bitable.bridge.setData = async (key, value) => {
    if (key.includes(':part:') && typeof value.data === 'string' && fail) {
      if (stagedKey) return false;
      stagedKey = key;
    }
    return save(key, value);
  };
  await h.task.start({ taskId: 'task', targetTableId: 'table' });
  assert.equal(writes, 0);
  assert.equal(h.saved().cursor, '');
  assert.equal(h.saved().appendState, undefined);
  assert.deepEqual(await h.bitable.bridge.getData(stagedKey), {});
  assert.match(h.errors[0]?.message, /飞书未保存任务进度/);
  fail = false;
  try {
    assert.equal(await h.task.resume(), true);
    assert.equal(writes, 1);
    assert.equal(h.saved().cursor, 'next');
    assert.equal(h.saved().checkpointParts, undefined);
  } finally { h.task.stop(); }
});

test('保存写前进度返回 false 时暂停，不能继续新增或覆盖上一份游标', async () => {
  let writes = 0;
  const h = harness({
    writeBatch: async (_, task, { saveProgress }) => {
      task.pendingWrite = true;
      await saveProgress();
      writes++;
    },
  });
  const save = h.bitable.bridge.setData;
  h.bitable.bridge.setData = async (key, value) => {
    if (key.includes(':progress:') && value.pendingWrite) return false;
    return save(key, value);
  };
  await h.task.start({ taskId: 'task', targetTableId: 'table' });
  assert.equal(writes, 0);
  assert.equal(h.saved().cursor, '');
  assert.match(h.errors[0]?.message, /保存任务进度失败.*飞书未保存任务进度/);
});
