import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderer, defineComponent, h, nextTick } from 'vue';

function renderer() {
  return createRenderer({
    createElement: type => ({ type, children: [], props: {}, parent: null }),
    createText: text => ({ text, parent: null }),
    createComment: text => ({ comment: text, parent: null }),
    setText: (node, text) => { node.text = text; },
    setElementText: (node, text) => { node.text = text; node.children = []; },
    patchProp: (node, key, oldValue, value) => { node.props[key] = value; },
    insert(node, parent, anchor = null) {
      if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = parent;
      const index = anchor ? parent.children.indexOf(anchor) : -1;
      if (index < 0) parent.children.push(node); else parent.children.splice(index, 0, node);
    },
    remove(node) { if (node.parent) node.parent.children.splice(node.parent.children.indexOf(node), 1); node.parent = null; },
    parentNode: node => node.parent,
    nextSibling: node => node.parent?.children[node.parent.children.indexOf(node) + 1] || null,
  });
}

async function mountFeedback(t) {
  const { useTaskFeedback } = await import('../src/composables/useTaskFeedback.mjs');
  let feedback;
  const Component = defineComponent({
    setup() {
      feedback = useTaskFeedback();
      return () => h('main', {}, [
        feedback.toastVisible.value ? h('div', { role: 'status', kind: feedback.toastType.value }, feedback.toastText.value) : null,
        feedback.taskNotice.value ? h('p', {}, feedback.taskNotice.value) : null,
      ]);
    },
  });
  const root = { children: [] };
  const app = renderer().createApp(Component);
  app.mount(root);
  t.after(() => app.unmount());
  return { feedback, app, root };
}

for (const [message, duration] of [
  ['处理失败：输出字段"作品链接" 类型不匹配，仅支持文本类型，请修正目标字段类型后重试', 8000],
  ['字段类型错误: "标题" 类型不匹配，仅支持文本', 8000],
  ['字段类型不匹配:字段"评论ID" 的类型是数字，仅支持文本', 8000],
  ['目标字段读取失败', 5000],
]) {
  test(`${message} 的浮动提示仅在${duration}毫秒后隐藏`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { feedback: f } = await mountFeedback(t);
    f.fail(new Error(message));
    t.mock.timers.tick(duration - 1);
    assert.equal(f.toastVisible.value, true);
    assert.equal(f.taskNotice.value, '');
    assert.equal(f.noticeRequiresReopen.value, false);
    t.mock.timers.tick(1);
    assert.equal(f.toastVisible.value, false);
  });
}

test('执行进度始终保留一次勿关闭提醒，最终结果不残留执行提醒', async t => {
  const { feedback: f } = await mountFeedback(t);
  f.begin('正在读取目标表字段…');
  assert.equal(f.toastText.value, '正在读取目标表字段…请勿关闭插件，关闭将中断任务');
  f.progress(f.toastText.value);
  assert.equal(f.toastText.value.match(/请勿关闭插件/g).length, 1);
  f.finish('处理完成，已写入 3 条，请勿关闭插件，关闭将中断任务');
  assert.equal(f.toastText.value, '处理完成，已写入 3 条');
  assert.equal(f.toastType.value, 'success');
});

test('旧结果计时器不能隐藏新任务，真实Vue卸载会取消提示计时器', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { feedback: f, app, root } = await mountFeedback(t);
  f.finish('处理完成，已写入 1 条');
  t.mock.timers.tick(2000);
  f.begin('正在获取作者…');
  t.mock.timers.tick(6000);
  await nextTick();
  assert.equal(f.toastVisible.value, true);
  assert.match(root.children[0].children.find(node => node.props?.role === 'status').text, /正在获取作者/);
  f.finish('处理完成，已写入 2 条');
  app.unmount();
  t.mock.timers.tick(6000);
  assert.equal(f.toastVisible.value, false);
});

for (const [successCount, failCount, kind, duration] of [[2, 1, 'warning', 5000], [0, 1, 'warning', 5000], [2, 0, 'info', 3000]]) {
  test(`最终停止成功${successCount}失败${failCount}按唯一优先级分类和隐藏`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const { feedback: f } = await mountFeedback(t);
    f.finish(`任务已停止：成功 ${successCount} 条，失败 ${failCount} 条`, { stopped: true, successCount, failCount });
    assert.equal(f.toastType.value, kind);
    t.mock.timers.tick(duration - 1);
    assert.equal(f.toastVisible.value, true);
    t.mock.timers.tick(1);
    assert.equal(f.toastVisible.value, false);
  });
}

test('写入待核对或需重开的异常在浮层隐藏后仍保留原始操作要求', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { feedback: f, root } = await mountFeedback(t);
  const error = Object.assign(new Error('写入表格超时，请关闭当前插件后重新打开并核对写入结果，勿重复启动任务'), { requiresReopen: true });
  f.fail(error);
  t.mock.timers.tick(5000);
  await nextTick();
  assert.equal(f.toastVisible.value, false);
  assert.equal(f.taskNotice.value, error.message);
  assert.equal(f.noticeRequiresReopen.value, true);
  assert.equal(root.children[0].children.find(node => node.type === 'p').text, error.message);
  assert.doesNotMatch(f.taskNotice.value, /请勿关闭/);
});

test('单条非致命失败保留整批加载、原错误和提醒，最终按真实统计汇总', async t => {
  const { feedback: f } = await mountFeedback(t);
  f.begin('正在处理第 1/3 条...');
  f.recordFailure(new Error('请求失败'), { index: 1 });
  f.progress('正在处理第 2/3 条...');
  assert.equal(f.toastLoading.value, true);
  assert.match(f.toastText.value, /请勿关闭插件/);
  assert.equal(f.taskNotice.value, '第 1 条处理失败：请求失败，整批任务继续执行。');
  f.finish('处理完成：成功 2 条，失败 1 条', { successCount: 2, failCount: 1 });
  assert.equal(f.toastType.value, 'warning');
  assert.equal(f.taskNotice.value, '');
});
