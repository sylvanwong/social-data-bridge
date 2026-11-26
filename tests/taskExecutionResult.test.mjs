import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskExecutionResult } from '../src/utils/taskExecutionResult.mjs';
import { useTaskExecutionResult } from '../src/composables/useTaskExecutionResult.mjs';

test('作者搜索失败请求与成功页分开，不从作品数量推算成功输入', () => {
  const r = buildTaskExecutionResult({ status: 1, total: 3, processed: 2, succeeded: 2, failed: 4, fetched_count: 80 }, { writtenCount: 71 }, { kind: 'bloggerSearch' });
  assert.equal(r.status, 'partial');
  assert.deepEqual(r.stats, [
    { label: '成功', value: 2, unit: '页' }, { label: '失败请求', value: 4, unit: '次', tone: 'warning' },
  ]);
  assert.equal(r.writtenCount, 71);
  assert.equal(r.outputUnit, '作者');
});

test('各后台接口保持实际输入单位及真实失败明细', () => {
  const cases = [['keyword', '页', '作品'], ['comment', '个作品', '评论'], ['series', '位作者', '短剧'], ['productReview', '个商品', '商品评价']];
  for (const [kind, unit, outputUnit] of cases) {
    const r = buildTaskExecutionResult({ status: 1, succeeded_urls: 1, failed_urls: 1, total: 2, processed: 2,
      failed_items: [{ url: 'https://example.test/a', reason: '不可访问' }] }, { writtenCount: 0 }, { kind });
    assert.equal(r.status, 'partial');
    assert.deepEqual(r.stats.slice(0, 2), [{ label: '成功', value: 1, unit }, { label: '失败', value: 1, unit, tone: 'warning' }]);
    assert.equal(r.outputUnit, outputUnit);
    assert.equal(r.writtenCount, 0);
    assert.deepEqual(r.failedItems, [{ url: 'https://example.test/a', reason: '不可访问' }]);
  }
});

test('未知统计不补零，停止和中断优先且不推算失败输入', () => {
  const unknown = buildTaskExecutionResult({ status: 1 }, {}, { kind: 'keyword' });
  assert.equal(unknown.status, 'completed');
  assert.deepEqual(unknown.stats, []);
  assert.equal(unknown.writtenCount, undefined);
  assert.equal(buildTaskExecutionResult({ status: 3, succeeded: 1, failed: 1 }, { writtenCount: 8 }).status, 'stopped');
  const interrupted = buildTaskExecutionResult({ status: 2, reason: '额度不足' }, { writtenCount: 8 });
  assert.equal(interrupted.status, 'interrupted');
  assert.equal(interrupted.reason, '额度不足');
  assert.deepEqual(interrupted.stats, []);
});

test('结果耗时不使用分页游标，只有可靠执行时间才显示', () => {
  assert.equal(buildTaskExecutionResult({ status: 1, start: 100, end: 200 }, {}).executionDurationSeconds, null);
  const r = buildTaskExecutionResult({ status: 1 }, { executionStartedAt: Date.now() - 5100 });
  assert.ok(r.executionDurationSeconds >= 5 && r.executionDurationSeconds < 8);
});

test('逐条收集器保留成功写入、输入失败及尚未执行的数量', () => {
  const task = useTaskExecutionResult({ inputUnit: '条', outputUnit: '作品' });
  task.begin(5); task.success(); task.written(1); task.failure('bad-input', new Error('链接错误'));
  task.finish({ stopped: true });
  assert.equal(task.result.value.status, 'stopped');
  assert.equal(task.result.value.writtenCount, 1);
  assert.deepEqual(task.result.value.stats, [
    { label: '成功', value: 1, unit: '条' }, { label: '失败', value: 1, unit: '条', tone: 'warning' }, { label: '未执行', value: 3, unit: '条' },
  ]);
  assert.deepEqual(task.result.value.failedItems, [{ url: 'bad-input', reason: '链接错误' }]);
  task.begin(1);
  assert.equal(task.result.value, null);
  task.success(); task.written(0); task.finish();
  assert.equal(task.result.value.status, 'completed');
  assert.deepEqual(task.result.value.failedItems, []);
});

test('写入响应不确定时标记待核对，不将它当作普通失败或成功', () => {
  const task = useTaskExecutionResult({ inputUnit: '条', outputUnit: '附件' });
  task.begin(3); task.success(); task.written(1);
  task.failure('input-2', new Error('写入超时'), { writeUncertain: true });
  task.fail(new Error('请先核对表格'), { paused: true });
  assert.equal(task.result.value.status, 'paused');
  assert.equal(task.result.value.writtenCount, 1);
  assert.deepEqual(task.result.value.stats, [
    { label: '成功', value: 1, unit: '条' }, { label: '失败', value: 0, unit: '条' },
    { label: '写入待核对', value: 1, unit: '条', tone: 'warning' }, { label: '未执行', value: 1, unit: '条' },
  ]);
});


test('搜索页数上限不当成未执行输入，空输出和未知失败数不显示全部成功', () => {
  const r = buildTaskExecutionResult({ status: 1, total: 10, processed: 1, succeeded: 1, failed: 0 }, { writtenCount: 0 });
  assert.equal(r.status, 'completed');
  assert.deepEqual(r.stats.map(x => x.label), ['成功', '失败']);
  assert.equal(buildTaskExecutionResult({ status: 1, succeeded: 1 }, { writtenCount: 3 }).status, 'completed');
  assert.equal(buildTaskExecutionResult(null, null).status, 'completed');
  assert.equal(buildTaskExecutionResult({ duration_seconds: 6 }).executionDurationSeconds, 6);
});
