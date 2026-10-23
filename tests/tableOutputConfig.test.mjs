import test from 'node:test';
import assert from 'node:assert/strict';
import { createTableConfigSaver } from '../src/utils/tableOutputConfig.mjs';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

test('同表按提交顺序保存，提交时固定映射副本', async () => {
  const first = deferred(), calls = [];
  const save = createTableConfigSaver(async config => {
    calls.push(config);
    if (calls.length === 1) await first.promise;
    return config;
  });
  const config = { targetTableId: 'A', fieldMappings: [{ source_key: 'name', target_field_id: 'first' }] };
  const a = save(config);
  config.fieldMappings[0].target_field_id = 'second';
  const b = save(config);
  config.targetTableId = 'B';
  config.fieldMappings[0].target_field_id = 'third';
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fieldMappings[0].target_field_id, 'first');
  first.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(calls.map(item => item.targetTableId), ['A', 'A']);
  assert.equal(calls[1].fieldMappings[0].target_field_id, 'second');
});

test('不同表独立提交，失败不会取消另一表或阻塞同表后续保存', async () => {
  const first = deferred(), calls = [];
  const save = createTableConfigSaver(async config => {
    calls.push(config.targetTableId);
    if (calls.length === 1) await first.promise;
  });
  const a = save({ targetTableId: 'A' });
  const failed = assert.rejects(a, /保存失败/);
  const b = save({ targetTableId: 'B' });
  const next = save({ targetTableId: 'A' });
  await b;
  assert.deepEqual(calls, ['A', 'B']);
  first.reject(new Error('保存失败'));
  await failed;
  await next;
  assert.deepEqual(calls, ['A', 'B', 'A']);
});
