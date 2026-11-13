import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { loadRequestModule } from './helpers/requestService.mjs';

function handler(name, bindings) {
  const source = parse(fs.readFileSync(new URL('../src/components/CommentFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declaration = parseJS(source, { sourceType: 'module' }).program.body
    .filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations).find(n => n.id.name === name).init;
  return new Function(...Object.keys(bindings), `return (${source.slice(declaration.start, declaration.end)});`)(...Object.values(bindings));
}

test('实际评论写入函数先保存新表 ID，再读取/准备目标字段', async () => {
  const events = [];
  const write = handler('createAndWriteData', {
    getActiveFieldConfigs: () => [{ name: '评论内容' }], buildFieldPayload: config => config,
    createSequentialTable: async () => ({ tableId: 'created' }),
    bitable: { base: { getTable: async () => { events.push('prepare'); throw new Error('SDK unavailable'); } } },
    console: { error() {} },
  });
  await assert.rejects(write([{}], '', 'task', '', { stopAfterCurrentBatch: true,
    onTargetTableReady: async id => events.push(`saved:${id}`) }), /SDK unavailable/);
  assert.deepEqual(events, ['saved:created', 'prepare']);
});

test('实际评论写入函数的字段查询晚返回后，不再修改字段', async () => {
  let resolveMeta, active = true, writes = 0;
  const write = handler('createAndWriteData', {
    getActiveFieldConfigs: () => [{ name: '评论内容' }], buildFieldPayload: config => config,
    createSequentialTable: async () => ({ tableId: 'created' }),
    bitable: { base: { getTable: async () => ({
      getFieldMetaList: () => new Promise(resolve => { resolveMeta = resolve; }),
      setField: async () => { writes++; },
    }) }, ui: { switchToTable: async () => {} } }, console: { error() {} },
  });
  const pending = write([{}], '', 'task', '', { stopAfterCurrentBatch: true,
    assertActive: () => { if (!active) throw new Error('inactive'); } });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  active = false; resolveMeta([{ id: 'first' }]);
  await assert.rejects(pending, /inactive/); assert.equal(writes, 0);
});

const stopSource = fs.readFileSync(new URL('../src/utils/taskStopText.js', import.meta.url), 'utf8')
  .replace('export const getTaskStoppingText', 'const getTaskStoppingText');
const getTaskStoppingText = new Function(`${stopSource}; return getTaskStoppingText;`)();

test('评论停止文案缺总数时只显示已写数量', () => {
  const format = handler('stoppedCommentProgress', { getTaskStoppingText });
  assert.match(format({ latestStatus: { status: 3 }, writtenCount: 120 }), /已写入 120 条/);
  assert.doesNotMatch(format({ latestStatus: { status: 3 }, writtenCount: 120 }), /剩余 \d+ 条/);
  assert.equal(format({ latestStatus:{status:3}, resultCount:140, writtenCount:100 }),
    '获取数据已停止，剩余 40 条待写入，已写入 100 条评论。请勿关闭插件，关闭会中断数据写入');
});

test('评论只在停止确认后请求总数，旧接口没有总数也能返回结果', async () => {
  const source = parse(fs.readFileSync(new URL('../src/components/CommentFetch.vue', import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const node = parseJS(source, { sourceType: 'module' }).program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations)
    .find(n => n.id.name === 'commentStreamTask').init.arguments[0].properties.find(n => n.key.name === 'getResults').value;
  const response = { data: { sta: 0, data: { data: [{ cid: 'one' }], next_cursor: '1' } } };
  let config;
  const bindings = { ...loadRequestModule(), props: { api_key: 'test' },
    feishuRequest: async options => { config = options; return response; } };
  bindings.commentTaskApiPath = handler('commentTaskApiPath', bindings);
  const read = new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
  const task = { taskId: 'task', writtenCount: 100 };
  assert.deepEqual(await read(task), response.data);
  assert.equal(config.data.include_count, false);
  task.latestStatus = { status: 0, cancel_requested: true };
  await read(task);
  assert.equal(config.data.include_count, false);
  task.latestStatus = { status: 3 };
  assert.deepEqual(await read(task), response.data);
  assert.equal(config.data.include_count, true);
});
