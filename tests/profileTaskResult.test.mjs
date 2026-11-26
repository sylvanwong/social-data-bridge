import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfileTaskResult, profileTaskResultStatus } from '../src/utils/profileTaskResult.mjs';

test('作者作品任务结果保留主页成功失败、作品数量和请求次数', () => {
  const result = buildProfileTaskResult({
    task_id: 'task-1', status: 1, total: 3, processed: 3,
    succeeded: 2, failed: 1, request_count: 3, fetched_count: 128,
    start: 100, end: 130,
  }, { writtenCount: 120 }, '2026-11-24T09:00:00Z');
  assert.deepEqual(result, {
    status: 'partial', taskId: 'task-1', total: 3, inputCount: 3, processed: 3, skippedCount: 0, unprocessedCount: 0,
    succeeded: 2, failed: 1, requestCount: 3, fetchedCount: 128,
    executionDurationSeconds: null, finishedAt: '2026-11-24T09:00:00Z', reason: '', scopeWarning: '', scopeWarningText: '', rerunHint: '', writtenCount: 120, failedItems: [], failureReasons: [],
  });
});

test('作者作品失败原因按数量汇总，同数量保持首次出现顺序', () => {
  const result = buildProfileTaskResult({
    status: 1, succeeded: 1, failed: 4,
    failed_items: [
      { url: 'a', reason: '请求超时' }, { url: 'b', reason: '主页不可访问' },
      { url: 'c', reason: '主页不可访问' }, { url: 'd' },
    ],
    invalid_url_count: 1, invalid_items: [{ url: 'e', reason: '请求超时' }],
  });
  assert.deepEqual(result.failureReasons, [
    { reason: '请求超时', count: 2 }, { reason: '主页不可访问', count: 2 }, { reason: '未返回具体原因', count: 1 },
  ]);
});

test('作者作品最近结果兼容旧状态字段并区分停止和失败', () => {
  assert.equal(profileTaskResultStatus({ status: 3 }), 'stopped');
  assert.equal(profileTaskResultStatus({ status: 2 }), 'interrupted');
  const result = buildProfileTaskResult({
    status: 2, succeeded_urls: 1, failed_urls: 2, fetched_count: 4, reason: '平台失败',
  }, { taskId: 'task-2', writtenCount: 3 }, '2026-11-23T00:00:00.000Z');
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 2);
  assert.equal(result.fetchedCount, 4);
  assert.equal(result.reason, '平台失败');
  assert.equal(result.finishedAt, '2026-11-23T00:00:00.000Z');
});

test('按作者统计终态，停止优先；有失败但无明细的旧任务保留真实计数', () => {
  assert.equal(profileTaskResultStatus({ status: 1, failed_urls: 2, succeeded_urls: 0 }), 'failed');
  assert.equal(profileTaskResultStatus({ status: 3, failed: 2, succeeded: 1 }), 'stopped');
  assert.equal(profileTaskResultStatus({ status: 1, failed: 0 }), 'completed');
  const result = buildProfileTaskResult({ status: 1, succeeded: 1, failed: 2,
    failed_items: [{ url: 'a', reason: '主页不可访问' }, { url: 'b' }] }, { writtenCount: 0 });
  assert.deepEqual(result.failedItems, [{ url: 'a', reason: '主页不可访问' }, { url: 'b', reason: '未返回具体原因' }]);
  assert.equal(result.writtenCount, 0);
});

test('侧栏只预览前五条失败输入，全部和部分明细均可完整复制链接和账号 ID', async t => {
  const { readFileSync } = await import('node:fs');
  const { Window } = await import('happy-dom');
  const window = new Window();
  for (const name of ['window', 'document', 'Element', 'SVGElement', 'navigator']) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? window : window[name] });
    t.after(() => original ? Object.defineProperty(globalThis, name, original) : delete globalThis[name]);
  }
  const Vue = await import('vue');
  const { parse } = await import('@vue/compiler-sfc');
  const { parse: parseJS } = await import('@babel/parser');
  const { descriptor } = parse(readFileSync(new URL('../src/components/ProfileFetch.vue', import.meta.url), 'utf8'));
  const styles = window.document.createElement('style');
  styles.textContent = [
    readFileSync(new URL('../src/assets/typography.css', import.meta.url), 'utf8'),
    ...descriptor.styles.map(style => style.content),
  ].join('\n');
  window.document.head.append(styles);
  const root = descriptor.template.ast.children.find(node => node.tag === 'div');
  const card = root.children.find(node => node.props?.some(prop => prop.value?.content?.includes('profile-result-manager')));
  const script = descriptor.scriptSetup.content;
  const declarations = parseJS(script, { sourceType: 'module' }).program.body
    .filter(node => node.type === 'VariableDeclaration').flatMap(node => node.declarations);
  const functionBody = name => {
    const { start, end } = declarations.find(node => node.id.name === name).init;
    return script.slice(start, end);
  };
  const inputs = ['https://weibo.com/u/123456789', '123456789', 'gh_demo', 'demo@finder',
    'https://example.com/user/4', 'https://example.com/user/5', 'gh_last'];
  const failedItems = inputs.map((url, i) => ({ url, reason: '原因' + i }));
  const latestProfileResult = Vue.ref(null), manualCopyLinks = Vue.ref(''), manualCopyInput = Vue.ref(null);
  const copyingFailedInputs = Vue.ref(false);
  const latestProfileResultExpanded = Vue.ref(true);
  const notices = [];
  const copyFailedProfileLinks = new Function('latestProfileResult', 'manualCopyLinks', 'manualCopyInput',
    'nextTick', 'latestProfileResultExpanded', 'copyingFailedInputs', 'componentUnmounted', 'ElMessage', 'return ' + functionBody('copyFailedProfileLinks'))(
    latestProfileResult, manualCopyLinks, manualCopyInput, Vue.nextTick, latestProfileResultExpanded, copyingFailedInputs, false, value => notices.push(value));
  const statusLabels = new Function('return ' + functionBody('profileResultStatusLabels'))();
  const profileResultStatusLabel = new Function('profileResultStatusLabels', 'return ' + functionBody('profileResultStatusLabel'))(statusLabels);
  const profileResultTone = new Function('return ' + functionBody('profileResultTone'))();
  const profileFailureReasonSummary = new Function('PROFILE_FAILURE_REASON_LIMIT', 'return ' + functionBody('profileFailureReasonSummary'))(
    Number(functionBody('PROFILE_FAILURE_REASON_LIMIT')));
  const profileFailuresOpen = Vue.ref(true);
  const canRetryProfilePages = Vue.ref(true);
  Vue.watch(latestProfileResult, () => {
    latestProfileResultExpanded.value = true;
    profileFailuresOpen.value = true;
    manualCopyLinks.value = '';
  }, { flush: 'sync' });
  const app = Vue.createApp({
    setup: () => ({ latestProfileResult, manualCopyLinks, manualCopyInput, copyFailedProfileLinks, copyingFailedInputs,
      profileResultTone, profileFailureReasonSummary, profileFailuresOpen,
      latestProfileResultExpanded, toggleLatestProfileResult() {}, canRetryProfilePages,
      taskActionState: 'idle', resumeFailedProfilePages() {},
      profileResultStatusLabel, profileResultDuration: new Function('return ' + functionBody('profileResultDuration'))(), formatProfileResultTime: new Function('return ' + functionBody('formatProfileResultTime'))() }),
    render: Vue.compile(card.loc.source),
  });
  app.component('el-button', { template: '<button><slot /></button>' });
  const container = window.document.createElement('div');
  window.document.body.append(container);
  app.mount(container);
  t.after(() => { app.unmount(); window.close(); });
  assert.equal(container.querySelector('details'), null);
  let copied;
  const clipboard = {};
  Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: clipboard });
  const scrollIntoView = t.mock.method(window.Element.prototype, 'scrollIntoView');
  for (const failed of [7, 9]) {
    latestProfileResult.value = buildProfileTaskResult({
      status: 1, failed: failed - 2, succeeded: 2, failed_items: failedItems.slice(0, 5),
      invalid_url_count: 2, invalid_items: failedItems.slice(5),
    }, { writtenCount: 12 });
    await Vue.nextTick();
    assert.equal(container.querySelectorAll('li').length, 5);
    assert.match(container.textContent, /原因4/);
    assert.doesNotMatch(container.textContent, /原因5/);
    const summary = container.querySelector('[aria-live="polite"]');
    const [counts, written] = summary.children;
    assert.equal(counts.textContent, `成功 2 条 · 失败 ${failed} 条`);
    assert.equal(counts.querySelector('.profile-result-failed-count').textContent, `失败 ${failed} 条`);
    assert.equal(written.textContent, '已写入 12 条作品');
    assert.equal(summary.nextElementSibling.tagName, 'DETAILS');
    assert.equal(container.querySelector('summary').textContent, '查看失败输入（7）');
    assert.equal(container.querySelector('details p:not(.profile-result-reasons)').textContent, '已返回 7 条失败明细，展示前 5 条');
    const actions = container.querySelector('.profile-result-actions');
    assert.ok(actions, '重试和复制需要在失败明细外共用一行');
    const [retry, button] = actions.querySelectorAll('button');
    assert.deepEqual([retry.textContent.trim(), button.textContent.trim()], ['重试失败输入', '复制失败输入']);
    assert.equal(retry.disabled, false);
    assert.equal(button.disabled, false);
    const details = container.querySelector('details');
    assert.equal(details.contains(actions), false);
    profileFailuresOpen.value = false;
    await Vue.nextTick();
    assert.equal(details.open, false);
    copied = '';
    notices.length = 0;
    let finishCopy;
    clipboard.writeText = t.mock.fn(text => {
      copied = text;
      return new Promise(resolve => { finishCopy = resolve; });
    });
    button.click();
    button.click();
    await Vue.nextTick();
    assert.equal(clipboard.writeText.mock.callCount(), 1, '剪贴板请求未结束时只允许一次复制');
    assert.equal(button.disabled, true);
    finishCopy();
    await new Promise(setImmediate);
    assert.equal(button.disabled, false);
    assert.equal(copied, inputs.join('\n'));
    assert.deepEqual(notices, [{ message: failed === 7 ? '已复制失败输入' : '已复制 7 条失败输入', type: 'success' }]);
    clipboard.writeText = async () => { throw new Error('clipboard unavailable'); };
    button.click();
    await new Promise(setImmediate);
    assert.equal(button.disabled, false, '自动复制失败后可以再次复制');
    const input = container.querySelector('textarea');
    assert.equal(container.querySelector('label').textContent.trim(), '请手动复制失败输入');
    assert.equal(details.contains(input), false);
    assert.equal(input.value, copied);
    assert.ok(window.document.activeElement === input, '手动复制框需要自动聚焦');
    assert.equal(input.selectionStart, 0);
    assert.equal(input.selectionEnd, copied.length);
    assert.equal(notices.length, 1);
    clipboard.writeText = async () => {};
    button.click();
    await new Promise(setImmediate);
    assert.ok(!container.querySelector('textarea'), '再次复制成功后收起手动复制框');
  }

  assert.equal(scrollIntoView.mock.callCount(), 2);
  for (const call of scrollIntoView.mock.calls) {
    assert.equal(call.this.className, 'profile-result-copy-fallback');
    assert.deepEqual(call.arguments, [{ block: 'nearest', inline: 'nearest' }]);
  }
  let rejectCopy;
  clipboard.writeText = () => new Promise((_, reject) => { rejectCopy = reject; });
  container.querySelector('.profile-result-actions button:last-child').click();
  latestProfileResultExpanded.value = false;
  rejectCopy(new Error('clipboard unavailable'));
  await new Promise(setImmediate);
  assert.ok(window.document.activeElement !== container.querySelector('textarea'));
  assert.equal(scrollIntoView.mock.callCount(), 2, '主动收起结果卡片后不再滚动');

  canRetryProfilePages.value = false;
  const remainingFailures = [
    { url: 'https://example.test/a?full=1', reason: '请求超时' },
    { url: 'https://example.test/b', reason: '积分不足' },
  ];
  for (const [status, completed, title, reason] of [
    [3, 0, '已停止', '用户主动停止'],
    [3, 1, '已停止', '用户主动停止'],
    [2, 0, '任务中断', '保存作品时连接中断'],
  ]) {
    const failedItems = remainingFailures.slice(completed);
    latestProfileResult.value = buildProfileTaskResult({
      status, total: 3, processed: 3, succeeded: 1 + completed, failed: failedItems.length,
      cancel_requested: true, reason, failed_items: failedItems,
    }, { writtenCount: 4 + completed });
    await Vue.nextTick();
    assert.equal(container.querySelector('.profile-result-status').textContent, title);
    assert.equal(container.querySelector('.profile-result-reason').textContent, reason);
    assert.equal(container.querySelector('.profile-result-failed-count').textContent, `失败 ${failedItems.length} 条`);
    assert.deepEqual([...container.querySelectorAll('details li')].map(item => item.textContent),
      failedItems.map(item => item.url + item.reason));
    profileFailuresOpen.value = false;
    await Vue.nextTick();
    const [retry, copy] = container.querySelectorAll('.profile-result-actions button');
    assert.equal(retry.disabled, true);
    assert.equal(copy.disabled, false);
    copied = '';
    clipboard.writeText = async text => { copied = text; };
    copy.click();
    await new Promise(setImmediate);
    assert.equal(copied, failedItems.map(item => item.url).join('\n'));
  }

  latestProfileResult.value = buildProfileTaskResult({ status: 1, succeeded: 1, failed: 1 });
  await Vue.nextTick();
  assert.match(container.textContent, /本次任务未返回失败输入明细/);
  assert.deepEqual([...container.querySelectorAll('.profile-result-actions button')]
    .map(button => [button.textContent.trim(), button.disabled]), [['重试失败输入', true], ['复制失败输入', true]]);
  latestProfileResult.value = buildProfileTaskResult({ status: 1, succeeded: 1, failed: 0 });
  await Vue.nextTick();
  assert.equal(container.querySelector('.profile-result-actions'), null);

  latestProfileResult.value = buildProfileTaskResult({
    status: 1, total: 2, processed: 2, succeeded: 1, failed: 1,
    failed_items: [{ url: 'gh_demo', reason: '主页不可访问' }],
    invalid_url_count: 1, invalid_items: [{ url: 'bad', reason: '未能从输入识别作者' }],
  });
  await Vue.nextTick();
  assert.equal(container.querySelector('.profile-result-status').textContent, '部分失败');
  assert.equal(container.querySelector('.profile-result-count').textContent, '成功 1 条 · 失败 2 条');
  const [input, inputReason] = container.querySelector('details li').children;
  assert.equal(input?.textContent, 'gh_demo');
  assert.equal(inputReason?.textContent, '主页不可访问');
  assert.equal(window.getComputedStyle(input).fontSize, '14px');
  const inputReasonStyle = window.getComputedStyle(inputReason);
  assert.equal(inputReasonStyle.fontSize, '12px');
  assert.equal(inputReasonStyle.color.toLowerCase(), '#646a73');
  assert.equal(window.getComputedStyle(container.querySelector('details ul')).listStyleType, 'none');
  assert.equal(container.querySelector('summary').textContent, '查看失败输入（2）');
  assert.ok(container.querySelector('summary .expand-arrow svg[aria-hidden="true"]'));
  assert.equal(latestProfileResult.value.requestCount, 2);

  // 有失败时明细默认展开并先显示原因汇总；用户收起后，新结果再次默认展开。
  const details = container.querySelector('details');
  assert.equal(details.open, true);
  assert.equal(container.querySelector('.profile-result-reasons').textContent, '失败原因：主页不可访问 1 条 · 未能从输入识别作者 1 条');
  details.open = false;
  details.dispatchEvent(new window.Event('toggle'));
  await Vue.nextTick();
  assert.equal(profileFailuresOpen.value, false);
  assert.equal(container.querySelector('details').open, false);
  const reasonItems = Array.from({ length: 7 }, (_, i) => ({ url: 'u' + i, reason: '原因' + Math.min(i, 5) }));
  latestProfileResult.value = buildProfileTaskResult({ status: 1, succeeded: 1, failed: 7, failed_items: reasonItems });
  await Vue.nextTick();
  assert.equal(container.querySelector('details').open, true);
  assert.equal(container.querySelector('.profile-result-reasons').textContent,
    '失败原因：原因5 2 条 · 原因0 1 条 · 原因1 1 条 · 原因2 1 条 · 原因3 1 条 等 6 类');
  latestProfileResult.value = buildProfileTaskResult({ status: 1, succeeded: 1, failed: 1, failed_items: [{ url: 'x', reason: '请求超时' }] });
  await Vue.nextTick();
  assert.equal(container.querySelector('.profile-result-reasons'), null);

  // 停止且有失败用警告色，纯停止保持中性色。
  for (const [failed, color] of [[1, '#a64b00'], [0, '#646a73']]) {
    latestProfileResult.value = buildProfileTaskResult({ status: 3, total: 3, processed: 2, succeeded: 2 - failed, failed, reason: '用户主动停止' });
    await Vue.nextTick();
    const label = container.querySelector('.profile-result-status');
    assert.equal(label.textContent, '已停止');
    assert.equal(window.getComputedStyle(label).color.toLowerCase(), color);
    assert.equal(window.getComputedStyle(container.querySelector('.profile-result-reason')).color.toLowerCase(), color);
  }

  const invalid = { url: 'bad-input', reason: '未能从输入识别作者' };
  const fetchFailure = { url: 'gh_demo', reason: '主页不可访问' };
  for (const [fetchItems, invalidItems] of [
    [[], [invalid]], [[fetchFailure], []], [[fetchFailure], [invalid]],
  ]) {
    const items = [...fetchItems, ...invalidItems];
    latestProfileResult.value = buildProfileTaskResult({
      status: 1, input_count: items.length, total: fetchItems.length, processed: fetchItems.length, failed: fetchItems.length,
      failed_items: fetchItems, invalid_url_count: invalidItems.length, invalid_items: invalidItems,
    });
    await Vue.nextTick();
    assert.equal(container.querySelector('.profile-result-status').textContent, '全部失败');
    assert.equal(container.querySelector('.profile-result-count').textContent, `成功 0 条 · 失败 ${items.length} 条`);
    assert.deepEqual(Array.from(container.querySelectorAll('li'), li => li.textContent),
      items.map(item => item.url + item.reason));
    copied = '';
    clipboard.writeText = async text => { copied = text; };
    container.querySelector('.profile-result-actions button:last-child').click();
    await Vue.nextTick();
    assert.equal(copied, items.map(item => item.url).join('\n'));
  }

  const complete = { status: 1, total: 2, processed: 2, succeeded: 2, failed: 0 };
  for (const [changes, title, explanation] of [
    [{}, '全部成功'],
    [{ invalid_url_count: 1 }, '部分失败', '本次任务未返回失败输入明细。'],
    [{ scope_warning: '积分不足，本次获取范围已缩减' }, '部分完成', '积分不足，本次获取范围已缩减'],
    [{ total: 3 }, '部分完成', '未完成 1 条'],
    [{ total: 3, reason: '剩余输入未执行' }, '部分完成', '剩余输入未执行'],
    [{ total: 0, processed: 0, succeeded: 0 }, '已完成'],
    [{ total: undefined, processed: undefined }, '已完成'],
    [{ succeeded: 1, failed: 1 }, '部分失败'],
    [{ succeeded: 0, failed: 2 }, '全部失败', '本次任务未返回失败输入明细。'],
    [{ total: undefined, succeeded: 0, failed: 2 }, '获取失败', '本次任务未返回失败输入明细。'],
    [{ total: 0, succeeded: 0, failed: 1, invalid_url_count: 1 }, '获取失败'],
    [{ total: 1, processed: 1, succeeded: 0, failed: 1, invalid_url_count: 1,
      input_count: 2, scope_warning: '积分不足，本次获取页数已减少' }, '全部失败', '积分不足，本次获取页数已减少'],
    [{ total: 1, processed: 1, succeeded: 0, failed: 1, invalid_url_count: 1,
      input_count: 3, scope_warning: '积分不足，部分作者未执行' }, '获取失败', '积分不足，1 条输入未执行'],
    [{ total: 1, processed: 1, succeeded: 0, failed: 1,
      scope_warning: '积分不足，本次获取范围已缩减，部分作者或页数未执行' }, '获取失败'],
    [{ succeeded: 0, failed: 1, processed: 1 }, '获取失败', '未完成 1 条'],
    [{ status: 3 }, '已停止'],
    [{ status: 2 }, '任务中断'],
  ]) {
    latestProfileResult.value = buildProfileTaskResult({ ...complete, ...changes });
    await Vue.nextTick();
    const statusLabel = container.querySelector('.profile-result-status');
    assert.equal(statusLabel.textContent, title);
    const statusStyle = window.getComputedStyle(statusLabel);
    const toneColor = {
      全部成功: '#087a32',
      部分失败: '#a64b00',
      部分完成: '#a64b00',
      全部失败: '#b42327',
      获取失败: '#b42327',
      任务中断: '#b42327',
    }[title] || '#646a73';
    assert.deepEqual([statusStyle.fontSize, statusStyle.color.toLowerCase(), statusStyle.fontWeight], ['12px', toneColor, '400']);
    const count = container.querySelector('.profile-result-count');
    const countStyle = window.getComputedStyle(count);
    assert.deepEqual([countStyle.fontSize, countStyle.lineHeight, countStyle.fontWeight], ['14px', '20px', '400']);
    const failed = latestProfileResult.value.failed;
    const failedCount = [...count.querySelectorAll('span')].find(span => span.textContent === `失败 ${failed} 条`);
    assert.ok(failedCount);
    const failedStyle = window.getComputedStyle(failedCount);
    assert.equal(failedStyle.color.toLowerCase(), failed > 0 ? '#a64b00' : '#1d2129');
    assert.equal(failedStyle.fontWeight, failed > 0 ? '600' : '400');
    if (explanation) assert.ok(container.textContent.includes(explanation));
  }

  // 同一份终态计数，有链接就可展开，即使没有逐条原因。
  const status = { status: 1, succeeded: 2, failed: 1, fetched_count: 38, start: 100, end: 113 };
  const url = 'https://example.com/failed-author';
  const finish = new Date(2026, 10, 24, 14, 32, 18);
  t.mock.timers.enable({ apis: ['Date'], now: finish.getTime() });
  latestProfileResult.value = buildProfileTaskResult({ ...status, failed_items: [{ url }] },
    { writtenCount: 35, executionStartedAt: finish.getTime() - 138000 }, finish.toISOString());
  await Vue.nextTick();
  const timingLines = () => Array.from(container.querySelector('.profile-result-timing').children, line => line.textContent);
  assert.deepEqual(timingLines(), ['执行耗时 2 分 18 秒', '结束于 2026/11/24 14:32']);
  const cardText = container.textContent;
  assert.match(cardText, /成功 2 条 · 失败 1 条.*已写入 35 条作品.*查看失败输入（1）.*执行耗时 2 分 18 秒.*结束于/s);
  assert.match(container.querySelector('li').textContent, /https:\/\/example.com\/failed-author.*未返回具体原因/s);
  assert.doesNotMatch(cardText, /未返回失败输入明细|获取作品|待写入|继续写入/);
  for (const [seconds, expected] of [
    [3599, '59 分 59 秒'], [3600, '1 小时'], [3660, '1 小时 1 分'],
    [7205, '2 小时 5 秒'], [7385, '2 小时 3 分 5 秒'],
  ]) {
    latestProfileResult.value = buildProfileTaskResult(status,
      { executionStartedAt: finish.getTime() - seconds * 1000 }, finish.toISOString());
    await Vue.nextTick();
    assert.deepEqual(timingLines(), [`执行耗时 ${expected}`, '结束于 2026/11/24 14:32']);
  }
  for (const legacy of [status, { ...status, failed_items: [] }]) {
    latestProfileResult.value = buildProfileTaskResult(legacy, { writtenCount: 35 }, new Date(2026, 10, 23, 23, 59, 58).toISOString());
    await Vue.nextTick();
    assert.equal(container.querySelector('details'), null);
    assert.deepEqual(timingLines(), ['结束于 2026/11/23 23:59']);
    assert.match(container.textContent, /成功 2 条 · 失败 1 条.*已写入 35 条作品.*本次任务未返回失败输入明细。/s);
  }

  latestProfileResult.value = buildProfileTaskResult({ status: 2, succeeded: 1, failed: 0, fetched_count: 20, reason: '任务执行中断，请重新创建任务' }, { writtenCount: 12 });
  await Vue.nextTick();
  assert.equal(container.querySelector('.profile-result-status').textContent, '任务中断');
  assert.equal(container.querySelector('.profile-result-count').textContent, '成功 1 条 · 失败 0 条');
  assert.equal(container.querySelector('.profile-result-info').textContent, '已写入 12 条作品');
  assert.equal(window.getComputedStyle(container.querySelector('.profile-result-reason')).color.toLowerCase(), '#b42327');
  assert.doesNotMatch(container.textContent, /获取作品|获取耗时|待写入|继续写入/);

  const warning = '积分不足，本次获取范围已缩减，部分作者或页数未执行';
  latestProfileResult.value = buildProfileTaskResult({
    status: 1, failed: 2, succeeded: 0, reason: '请求超时', scope_warning: warning, invalid_url_count: 1,
    failed_items: [{ url: 'A', reason: '主页不可访问' }, { url: 'B', reason: '请求超时' }],
  });
  await Vue.nextTick();
  assert.equal(container.querySelector('.profile-result-status').textContent, '获取失败');
  assert.match(container.textContent, /成功 0 条 · 失败 3 条.*已写入 0 条作品/s);
  assert.match(container.querySelector('details').textContent, /主页不可访问/);
  assert.match(container.querySelector('details').textContent, /请求超时/);
  assert.ok(container.textContent.includes(warning));
  assert.match(container.textContent, /已返回 2 条失败明细/);
  const order = Array.from(container.querySelectorAll('.profile-result-list > div > *'), node => node.className || node.tagName);
  assert.ok(order.indexOf('profile-result-scope-warning') < order.indexOf('profile-result-failures'));
  assert.doesNotMatch(container.textContent, /已跳过/);

  latestProfileResult.value = buildProfileTaskResult({ status: 1, succeeded: 1, failed: 0, scope_warning: warning });
  await Vue.nextTick();
  assert.equal(latestProfileResult.value.status, 'incomplete');
  assert.equal(container.querySelector('.profile-result-status').textContent, '部分完成');
  const scopeLine = container.querySelector('.profile-result-scope-warning');
  assert.equal(scopeLine.textContent, warning);
  assert.equal(window.getComputedStyle(scopeLine).color.toLowerCase(), '#a64b00');
  assert.match(container.textContent, /成功 1 条 · 失败 0 条/);
  assert.equal(container.querySelector('.profile-result-failed-count'), null);
  assert.ok(container.textContent.includes(warning));
  assert.equal(container.querySelector('details'), null);
  assert.doesNotMatch(container.textContent, /未能解析的输入/);

  const rerunHint = '充值后，如果输入范围不变，点击「立即执行」会重新处理该范围内的全部输入。';
  for (const [changes, title, counts, scopeText] of [
    [{ input_count: 10 }, '部分完成', '成功 2 条 · 失败 0 条 · 未执行 8 条', '积分不足，8 条输入未执行'],
    [{ input_count: 10, invalid_url_count: 1 }, '部分失败', '成功 2 条 · 失败 1 条 · 未执行 7 条', '积分不足，7 条输入未执行'],
    [{ input_count: 10, scope_warning: '积分不足，部分作者未执行，本次获取页数已减少' }, '部分完成', '成功 2 条 · 失败 0 条 · 未执行 8 条',
      '积分不足，8 条输入未执行，本次获取页数已减少'],
    [{ input_count: 2, scope_warning: '积分不足，本次获取页数已减少' }, '部分完成', '成功 2 条 · 失败 0 条', '积分不足，本次获取页数已减少'],
    [{}, '部分完成', '成功 2 条 · 失败 0 条', '积分不足，部分作者未执行'],
    [{ total: 3 }, '部分完成', '成功 2 条 · 失败 0 条 · 未完成 1 条', '积分不足，部分作者未执行'],
    [{ status: 3, total: 4, input_count: 10, invalid_url_count: 1 }, '已停止', '成功 2 条 · 失败 1 条 · 未执行 5 条 · 未完成 2 条', '积分不足，5 条输入未执行'],
    [{ status: 2, total: 4, input_count: 10, invalid_url_count: 1 }, '任务中断', '成功 2 条 · 失败 1 条 · 未执行 5 条 · 未完成 2 条', '积分不足，5 条输入未执行'],
    [{ status: 3, total: 4, processed: 3, succeeded: 2, failed: 1, input_count: 10 }, '已停止', '成功 2 条 · 失败 1 条 · 未执行 6 条 · 未完成 1 条',
      '积分不足，6 条输入未执行'],
  ]) {
    latestProfileResult.value = buildProfileTaskResult({
      status: 1, total: 2, processed: 2, succeeded: 2, failed: 0,
      scope_warning: '积分不足，部分作者未执行', ...changes,
    });
    await Vue.nextTick();
    assert.equal(container.querySelector('.profile-result-status').textContent, title);
    assert.equal(container.querySelector('.profile-result-count').textContent, counts);
    assert.equal(container.querySelector('.profile-result-scope-warning').textContent, scopeText);
    const skipped = counts.match(/未执行 (\d+) 条/)?.[1];
    const hint = container.querySelector('.profile-result-hint');
    if (skipped) {
      assert.equal(latestProfileResult.value.rerunHint, rerunHint);
      assert.equal(hint.textContent, rerunHint);
      assert.equal(hint.previousElementSibling, container.querySelector('.profile-result-scope-warning'));
    } else {
      assert.equal(hint, null);
    }
  }

  latestProfileResult.value = buildProfileTaskResult({ status: 3, total: 1, processed: 0 }, { writtenCount: 1 });
  await Vue.nextTick();
  assert.match(container.textContent, /未完成 1 条/);
  assert.match(container.textContent, /已写入 1 条作品/);
  assert.doesNotMatch(container.textContent, /未能解析的输入|积分不足/);
});
