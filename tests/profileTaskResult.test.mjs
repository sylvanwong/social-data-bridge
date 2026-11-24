import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileTaskResult, profileTaskResultStatus } from '../src/utils/profileTaskResult.mjs';

test('作者作品任务结果保留主页成功失败、作品数量和请求次数', () => {
  const result = buildProfileTaskResult({
    task_id: 'task-1', status: 1, total: 3, processed: 3,
    succeeded: 2, failed: 1, request_count: 3, fetched_count: 128,
    start: 100, end: 130,
  });
  assert.deepEqual(result, {
    status: 'completed', taskId: 'task-1', total: 3, processed: 3,
    succeeded: 2, failed: 1, requestCount: 3, fetchedCount: 128,
    startedAt: 100, finishedAt: 130, reason: '',
  });
});

test('作者作品最近结果兼容旧状态字段并区分停止和失败', () => {
  assert.equal(profileTaskResultStatus({ status: 3 }), 'stopped');
  assert.equal(profileTaskResultStatus({ status: 2 }), 'failed');
  const result = buildProfileTaskResult({
    status: 2, succeeded_urls: 1, failed_urls: 2, fetched_count: 4, reason: '平台失败',
  }, { taskId: 'task-2', writtenCount: 3 }, '2026-11-23T00:00:00.000Z');
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 2);
  assert.equal(result.fetchedCount, 4);
  assert.equal(result.reason, '平台失败');
  assert.equal(result.finishedAt, '2026-11-23T00:00:00.000Z');
});
