import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function harness(options = {}) {
  let saved = null;
  const timers = new Map(); let seq = 0;
  const source = fs.readFileSync(new URL('../src/composables/useIncrementalTask.js', import.meta.url), 'utf8')
    .replace(/^import .*;\n/, '').replace('export const useIncrementalTask', 'const useIncrementalTask');
  const bitable = { bridge: { setData: async (_, value) => { saved = structuredClone(value); }, getData: async () => saved },
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
  return { task, create, calls, finished, errors, bitable, timers, saved: () => saved,
    tick: async () => { const [id, timer] = [...timers].find(([, timer]) => timer.delay < 60000); timers.delete(id); await timer.fn(); } };
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
      assert.match(h.errors[0].message, /核对/);
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
    if (!value.taskId) await new Promise(resolve => { release = resolve; });
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
      if (!task.taskId) await new Promise(resolve => { release = resolve; });
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
