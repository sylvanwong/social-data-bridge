import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const file = new URL('../src/utils/taskStopText.js', import.meta.url);
test('五类任务区分正在停止、剩余写入和已写完，数量按结果条数计算', () => {
  assert.ok(fs.existsSync(file), '五类任务共用停止文案');
  const source = fs.readFileSync(file, 'utf8').replace('export const getTaskStoppingText', 'const getTaskStoppingText');
  const format = new Function(`${source}; return getTaskStoppingText;`)();
  for (const label of ['评论', '作品', '短剧', '作者']) {
    assert.equal(format({writtenCount:100}, label), `正在停止获取数据，已写入 100 条${label}。请勿关闭插件，关闭会中断数据写入`);
    const task = {latestStatus:{status:3},resultCount:140,writtenCount:100};
    assert.equal(format(task,label), `获取数据已停止，剩余 40 条待写入，已写入 100 条${label}。请勿关闭插件，关闭会中断数据写入`);
    task.writtenCount=120;
    assert.match(format(task,label), /剩余 20 条/);
    task.writtenCount=140;
    assert.match(format(task,label), /剩余 0 条/);
    delete task.resultCount;
    assert.equal(format(task,label), `获取数据已停止，正在写入剩余结果，已写入 140 条${label}。请勿关闭插件，关闭会中断数据写入`);
  }
});

import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';

for (const [page, engine, label] of [['CommentFetch','commentStreamTask','评论'], ['ProfileFetch','profileStreamTask','作品'],
  ['SeriesFetch','seriesStreamTask','短剧'], ['KeywordSearch','keywordStreamTask','作品'], ['BloggerSearch','searchTask','作者']]) {
  test(`${page}：实际进度回调和写入回调使用统一停止文案`, async () => {
    const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url),'utf8')).descriptor.scriptSetup.content;
    const declarations = parseJS(source,{sourceType:'module'}).program.body.filter(n=>n.type==='VariableDeclaration').flatMap(n=>n.declarations);
    const properties = declarations.find(n=>n.id.name===engine).init.arguments[0].properties;
    const formatterSource = fs.readFileSync(file,'utf8').replace('export const getTaskStoppingText','const getTaskStoppingText');
    const format = new Function(`${formatterSource};return getTaskStoppingText;`)();
    let message;
    const cancelling = {value:false};
    const bindings = { clearing:{value:false}, isCancelling:cancelling, cancelling, activeStreamTask:null, activeSeriesTask:null,
      getStoppingText:task=>format(task,label), stoppedCommentProgress:task=>format(task,label),
      showToast:text=>message=text, TASK_TOAST_SUFFIX:'请勿关闭插件，关闭将中断任务', getStreamProgressText:()=>'',
      showCompletionToast:text=>message=text, finishToast:text=>message=text,
      loading:{value:true}, hasRecoverableTask:{value:true}, recoveryRequiresReopen:{value:false},
      activeKeywordTaskId:{value:'task'}, activeCommentTaskId:{value:'task'}, activeProfileTaskId:{value:'task'},
      activeSeriesTaskId:{value:'task'}, taskId:{value:'task'} };
    const load = name => {
      const node=properties.find(n=>n.key.name===name).value;
      return new Function(...Object.keys(bindings),`return (${source.slice(node.start,node.end)});`)(...Object.values(bindings));
    };
    const onProgress=load('onProgress'), onWriting=load('onWriting');
    const task={writtenCount:100, resultCount:140,latestStatus:{status:0,cancel_requested:true}};
    onProgress(task.latestStatus,task);
    assert.equal(message,`正在停止获取数据，已写入 100 条${label}。请勿关闭插件，关闭会中断数据写入`);
    onWriting([{}],task);
    assert.equal(message,`正在停止获取数据，已写入 100 条${label}。请勿关闭插件，关闭会中断数据写入`);
    cancelling.value=false;
    task.latestStatus={status:3};
    onProgress(task.latestStatus,task);
    assert.equal(message,`获取数据已停止，剩余 40 条待写入，已写入 100 条${label}。请勿关闭插件，关闭会中断数据写入`);
    onWriting([{}],task);
    assert.equal(message,`获取数据已停止，剩余 40 条待写入，已写入 100 条${label}。请勿关闭插件，关闭会中断数据写入`);
    const onFinish=load('onFinish');
    for(const status of [3,1]) {
      await onFinish({status},{...task,writtenCount:140});
      assert.doesNotMatch(message,/请勿关闭|自动结束/);
      if(status===3) assert.equal(message,`任务已停止，已写入 140 条${label}`);
    }
  });
}
