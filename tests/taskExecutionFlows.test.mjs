import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { nextTick } from 'vue';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { useTaskExecutionResult } from '../src/composables/useTaskExecutionResult.mjs';
import { buildTaskExecutionResult } from '../src/utils/taskExecutionResult.mjs';

// 执行原组件的完整执行函数，只替换网络/宿主边界，避免重写流程作断言。
function expression(page, name) {
  const script = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declarations = parseJS(script, { sourceType: 'module' }).program.body.flatMap(n => n.declarations || []);
  const init = declarations.find(n => n.id.name === name)?.init;
  assert.ok(init, `${page}.${name}`);
  return script.slice(init.start, init.end);
}
function fn(page, name, scope) { return new Function(...Object.keys(scope), `return (${expression(page, name)})`)(...Object.values(scope)); }

for (const [page, name] of [['VideoDataFetch', 'fetchVideoDataByRows'], ['BloggerInfoFetch', 'fetchBloggerInfoByRows'], ['VideoCopySummary', 'fetchSummaryByEntries'], ['XhsDownload', 'fetchXhsByRows']]) {
  test(`${page} 逐条结果区分网络失败与无法确认的写入，停止不把剩余输入算失败`, async () => {
    const executionResult = useTaskExecutionResult({ outputUnit: '数据' });
    const stopRequested = { value: false };
    let calls = 0;
    const run = fn(page, name, {
      executionResult, stopRequested, props: { api_key: 'test', productDetail: false },
      showToast() {}, taskFeedback: { recordFailure() {} }, buildFeishuApiPath: x => x,
      feishuRequest: async () => { calls++; return calls === 2 ? { data: { sta: 1, msg: '链接失效' } } : { data: { sta: 0, data: { id: calls } } }; },
      assertMounted: x => x, createMediaTask: async url => { calls++; if (calls === 2) throw new Error('链接失效'); return url; }, pollMediaTask: async () => ({}),
    });
    let writes = 0;
    await run(['a', 'b', 'c', 'd'].map(url => ({ url })), { activeFieldConfigs: [], onSuccess: async () => {
      writes++; if (writes === 2) { stopRequested.value = true; throw Object.assign(new Error('写入超时'), { writeUncertain: true }); }
      return 1;
    } });
    executionResult.finish({ stopped: true });
    const r = executionResult.result.value;
    assert.equal(r.writtenCount, 1);
    assert.equal(r.failed, 1);
    assert.deepEqual(r.failedItems.map(x => x.url), ['b', 'c']);
    assert.deepEqual(r.stats.map(x => [x.label, x.value]), [['成功', 1], ['失败', 1], ['写入待核对', 1], ['未执行', 1]]);
  });
}

for (const [page, engineName, kind] of [['KeywordSearch', 'keywordStreamTask', 'keyword'], ['BloggerSearch', 'searchTask', 'bloggerSearch'], ['ProductSearch', 'searchTask', 'productSearch'], ['CommentFetch', 'commentStreamTask', 'comment'], ['SeriesFetch', 'seriesStreamTask', 'series']]) {
  test(`${page} 原任务完成回调发布已确认结果`, async () => {
    const latestExecutionResult = { value: null };
    const scope = { latestExecutionResult, buildTaskExecutionResult,
      ref: value => ({ value }), useIncrementalTask: options => options,
      componentUnmounted: false, disposed: false, clearing: {}, hasRecoverableTask: {}, loading: {}, cancelling: {}, taskId: {},
      isCancelling: {}, activeKeywordTaskId: {}, activeCommentTaskId: {}, recoveryRequiresReopen: {}, activeSeriesTaskId: {}, activeSeriesTask: null,
      stopping: {}, activeTaskId: {}, form: { value: {} }, feedback: { fail() {}, finish() {} }, showCompletionToast() {}, finishToast() {},
      STREAM_TASK_STORAGE_KEY: 'test', getSeriesTask() {}, getSeriesResults() {}, storageKey: 'test', KEYWORD_TASK_STORAGE_KEY: 'test', COMMENT_TASK_STORAGE_KEY: 'test', SERIES_TASK_STORAGE_KEY: 'test',
      getPendingWriteLimit() {},
    };
    const selectedKeys = { value: ['title'] };
    if (page === 'ProductSearch') {
      scope.restoreUserOutputSelection = fn(page, 'restoreUserOutputSelection', {
        selectedKeysBeforeRecovery: ['product_id'], selectedKeys, nextTick,
      });
    }
    // 引擎参数中的依赖闭包不会在构造时执行，仅调用真正的完成回调。
    const options = fn(page, engineName, scope);
    await options.onFinish({ status: 1, total: 2, processed: 2, succeeded: 1, failed: 1 }, { writtenCount: 5 });
    assert.equal(latestExecutionResult.value?.writtenCount, 5);
    assert.equal(latestExecutionResult.value.status, 'partial');
    assert.equal(latestExecutionResult.value.outputUnit, buildTaskExecutionResult({}, {}, { kind }).outputUnit);
    if (page === 'ProductSearch') assert.deepEqual(selectedKeys.value, ['product_id']);
  });
}

test('热榜获取成功但写入超时，保留获取条数且不虚报写入成功', async () => {
  const executionResult = useTaskExecutionResult({ outputUnit: '热榜数据' });
  const run = fn('HotListFetch', 'submit', {
    executionResult, latestExecutionResult: executionResult.result, props: { api_key: 'test' },
    formData: { value: { platform: 'xhs' } }, loading: {}, getActiveFieldMapping: () => [{}], showErrorMsg() {}, showToast() {},
    feishuRequest: async () => ({ data: { sta: 0, data: ['a', 'b'] } }), buildFeishuApiPath: x => x, extractList: x => x,
    componentUnmounted: false, bitable: { base: { getTableById: async () => ({}) } },
    writeDataToTable: async () => { throw Object.assign(new Error('写入超时'), { writeUncertain: true }); }, taskFeedback: { fail() {} },
  });
  await run('existing', [{}]);
  const r = executionResult.result.value;
  assert.equal(r.status, 'paused');
  assert.equal(r.writtenCount, 0);
  assert.ok(r.notes.some(x => x.includes('获取 2 条')));
});

test('推荐词续写后沿用原关键词统计和确认写入量，不重复计算', async () => {
  const executionResult = useTaskExecutionResult({ inputUnit: '个关键词', outputUnit: '推荐词' });
  const pendingWrite = { value: null }, taskFeedback = { finish() {}, fail() {}, recordFailure() {} };
  let writeAttempt = 0;
  const run = fn('SearchSuggestions', 'execute', {
    executionResult, latestExecutionResult: executionResult.result, pendingWrite, taskFeedback, disposed: false, loading: {}, collecting: {}, stopRequested: {}, selectedFieldKeys: { value: ['recommendation'] },
    form: { value: { outputType: 1, social_type: 'xhs' } }, mappingDraft: { value: [] }, showToast() {}, assertActive() {},
    fetchSuggestions: async keyword => { if (keyword === 'bad') throw new Error('获取失败'); return [{ recommendation: '1' }, { recommendation: '2' }]; },
    validateTableFields: async () => true, bitable: { ui: { switchToTable: async () => {} } },
    createAndWriteData: async (rows, mode, id, tableId, fields, options) => {
      writeAttempt++; options.onTargetTableReady('table');
      if (writeAttempt === 1) { options.onBatchWritten(1); throw new Error('写入中断'); }
      options.onBatchWritten(rows.length); return { tableId: 'table', recordIds: ['r2'] };
    },
  });
  await run(['good', 'bad']);
  assert.equal(executionResult.result.value.status, 'paused');
  assert.equal(executionResult.result.value.writtenCount, 1);
  await run();
  const r = executionResult.result.value;
  assert.equal(r.writtenCount, 2); assert.equal(r.failed, 1); assert.equal(r.status, 'partial');
  assert.deepEqual(r.failedItems, [{ url: 'bad', reason: '获取失败' }]);
});

for (const [page, name] of [['VideoDataFetch', 'fetchVideoDataByRows'], ['BloggerInfoFetch', 'fetchBloggerInfoByRows'], ['VideoCopySummary', 'fetchSummaryByEntries'], ['XhsDownload', 'fetchXhsByRows']]) {
  test(`${page} 输出准备失败计入失败，回调未写入时不虚报一条写入`, async () => {
    const executionResult = useTaskExecutionResult();
    let calls = 0;
    const run = fn(page, name, { executionResult, stopRequested: { value: false }, props: { api_key: 'test' },
      showToast() {}, taskFeedback: { recordFailure() {} }, buildFeishuApiPath: x => x, assertMounted: x => x,
      feishuRequest: async () => ({ data: { sta: 0, data: {} } }), createMediaTask: async () => ({}), pollMediaTask: async () => ({}),
    });
    await run([{ url: 'no-write' }, { url: 'invalid-output' }], { onSuccess: async () => {
      if (calls++) throw new Error('输出字段类型不匹配');
      return 0;
    } });
    executionResult.finish();
    assert.equal(executionResult.result.value.writtenCount, 0);
    assert.equal(executionResult.result.value.failed, 1);
    assert.equal(executionResult.result.value.stats.some(x => x.label === '写入待核对'), false);
  });
}

test('链接转附件沿用原批次结果，确认写入、失败、待核对和未执行分别显示', async () => {
  const executionResult = useTaskExecutionResult({ outputUnit: '附件记录' });
  const run = fn('UrlToAttachment', 'handleManualModeSubmit', {
    executionResult, componentUnmounted: false, props: { api_key: 'test' }, loading: {}, stopRequested: {}, taskNotice: {},
    formData: { value: { manualUrls: 'a b c d', targetType: 'new' } }, extractHttpUrls: text => text.split(' '), isAttachmentUrl: () => true,
    showToast: (text, loading, options) => { if (options?.begin) executionResult.begin(); }, nextTick: async () => {}, assertMounted: x => x,
    ensureOutputConfigReady: async () => true, resolveTargetTableId: async () => 'target', finishToast() {}, taskFeedback: { fail: e => assert.fail(e.message) },
    appendRecordsToTable: async () => ({ writtenCount: 1, failCount: 1, failures: [{ index: 2, url: 'b', reason: '下载失败' }],
      interruption: { index: 3, url: 'c', reason: '写入超时', writeUncertain: true }, unprocessedCount: 1, stopped: true }),
  });
  await run();
  const r = executionResult.result.value;
  assert.equal(r.status, 'paused');
  assert.equal(r.writtenCount, 1);
  assert.deepEqual(r.stats.map(x => [x.label, x.value]), [['成功', 1], ['失败', 1], ['写入待核对', 1], ['未执行', 1]]);
  assert.deepEqual(r.failedItems.map(x => x.url), ['b', 'c']);
});
