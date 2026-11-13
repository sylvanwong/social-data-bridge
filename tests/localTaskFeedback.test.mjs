import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { computed, createRenderer, defineComponent, h, nextTick, ref } from 'vue';
import { parse } from '@vue/compiler-sfc';
import { parse as parseJS } from '@babel/parser';
import { useTaskFeedback } from '../src/composables/useTaskFeedback.mjs';

const pages = ['BloggerInfoFetch', 'VideoDataFetch', 'VideoCopySummary', 'XhsDownload', 'UrlToAttachment'];
const quiet = { log() {}, error() {} };
function feedback(t) {
  let f;
  const renderer = createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), insert() {}, remove() {}, setText() {}, setElementText() {}, patchProp() {}, parentNode() {}, nextSibling() {} });
  const app = renderer.createApp(defineComponent({ setup() { f = useTaskFeedback(); return () => h('div'); } }));
  app.mount({});
  t.after(() => app.unmount());
  return f;
}
function extract(page, name, bindings) {
  const source = parse(fs.readFileSync(new URL(`../src/components/${page}.vue`, import.meta.url), 'utf8')).descriptor.scriptSetup.content;
  const declarations = parseJS(source, { sourceType: 'module' }).program.body.filter(n => n.type === 'VariableDeclaration').flatMap(n => n.declarations);
  const node = declarations.find(n => n.id.name === name)?.init;
  assert.ok(node, `${page}.${name} exists`);
  return new Function(...Object.keys(bindings), `return (${source.slice(node.start, node.end)});`)(...Object.values(bindings));
}
function setup(t,page,overrides={}) {
 const f=feedback(t),b={disposed:false,assertActive:()=>{},taskFeedback:f,...f,computed,props:{api_key:'test'},console:quiet,loading:ref(false),isSubmitting:ref(false),stopRequested:ref(false),collecting:ref(false),form:ref({social_type:'xhs',outputType:1}),formData:ref({radio:2,table_id:'table',platform:'xhs'}),tableConfigReady:ref(true),tableConfigError:ref(''),selectedFieldKeys:ref(['keyword']),mappingDraft:ref([]),getActiveFieldMapping:()=>[{key:'keyword'}],fetchSuggestions:async()=>[],validateTableFields:async()=>true,createAndWriteData:async()=>({tableId:'created'}),bitable:{ui:{switchToTable:async()=>{}}},ElMessage:()=>assert.fail('重复通知'),showErrorMsg:()=>assert.fail('重复通知'),...overrides};
 b.showToast=extract(page,'showToast',b);b.hideToast=extract(page,'hideToast',b);return{f,b,run:name=>extract(page,name,b)};
}
test('热榜字段准备延迟时立即显示进度并挡住重复执行',async t=>{
 let release,calls=0;const{f,b,run}=setup(t,'HotListFetch',{validateTableFields:()=>{calls++;return new Promise(r=>{release=r;});},submit:async()=>{}});
 const commit=run('commit'),pending=commit();await nextTick();assert.equal(b.isSubmitting.value,true);assert.equal(f.toastLoading.value,true);assert.match(f.toastText.value,/请勿关闭插件/);await commit();assert.equal(calls,1);release(true);await pending;
});
test('热榜准备失败以原错误结束忙碌',async t=>{
 const{f,b,run}=setup(t,'HotListFetch',{validateTableFields:async()=>{throw new Error('SDK原始原因');},submit:async()=>assert.fail()});await run('commit')();assert.equal(f.toastType.value,'error');assert.equal(f.toastText.value,'SDK原始原因');assert.equal(b.isSubmitting.value,false);
});
test('热榜需重开时保留异常说明且禁止按钮重新启动', async t => {
  let starts = 0;
  const { f, run } = setup(t, 'HotListFetch', { submit: async () => { starts++; } });
  f.fail(Object.assign(new Error('需核对表格并重新进入插件'), { requiresReopen: true }));
  await run('commit')();
  assert.equal(starts, 0);
  assert.equal(f.noticeRequiresReopen.value, true);
});
for(const mode of ['empty','failure','mixed'])test(`推荐词${mode}终态如实分类`,async t=>{
 let calls=0;const{f,b,run}=setup(t,'SearchSuggestions',{fetchSuggestions:async()=>{calls++;if(mode==='failure'||(mode==='mixed'&&calls===1))throw new Error('真实接口错误');return mode==='mixed'?[{recommendation:'词'}]:[];}});
 await run('execute')(mode==='mixed'?['a','b']:['a']);assert.equal(f.toastType.value,{empty:'info',failure:'error',mixed:'warning'}[mode]);assert.match(f.toastText.value,mode==='empty'?/未获取到推荐词/:mode==='failure'?/真实接口错误/:/1 个关键词获取失败/);assert.equal(b.loading.value,false);
});
test('推荐词HTTP延迟时立即显示提醒',async t=>{let release;const{f,run}=setup(t,'SearchSuggestions',{fetchSuggestions:()=>new Promise(r=>{release=r;})});const pending=run('execute')(['a']);await nextTick();assert.equal(f.toastLoading.value,true);assert.match(f.toastText.value,/请勿关闭插件/);release([]);await pending;});

test('聚合首页API Key保存失败以顶部Message显示SDK实际原因5秒', async () => {
  const notices = [], b = { api_key: ref('key'), api_key_disabled: ref(false), API_KEY_CLEARED_MARKER:'cleared', social_type_options:ref([]), TYPE_OPTIONS:[], PLATFORM_CONFIG_NAMES:{search:'search'}, fetchPlatformConfig:async()=>[], bitable:{bridge:{setData:async()=>{throw new Error('SDK保存失败');}}}, ElMessage: n=>notices.push(n) };
  await extract('Form','saveApiKey',b)();
  assert.equal(notices.length,1);assert.equal(notices[0].message,'SDK保存失败');assert.equal(notices[0].type,'error');assert.equal(notices[0].duration,5000);assert.equal(notices[0].plain,true);
});
test('聚合首页API Key保存成功沿用原文和3秒', async () => {
  const notices=[], b={api_key:ref('key'),api_key_disabled:ref(false),API_KEY_CLEARED_MARKER:'cleared',social_type_options:ref([]),TYPE_OPTIONS:[],PLATFORM_CONFIG_NAMES:{search:'search'},fetchPlatformConfig:async()=>[],bitable:{bridge:{setData:async()=>{}}},ElMessage:n=>notices.push(n)};
  await extract('Form','saveApiKey',b)();assert.equal(notices[0].message,'保存成功');assert.equal(notices[0].duration,3000);
});
test('推荐词部分失败其余为空时保留两类摘要及重试文案', async t=>{
  let count=0;const{f,run}=setup(t,'SearchSuggestions',{fetchSuggestions:async()=>{if(++count===1)throw new Error('实际错误');return[];}});
  await run('execute')(['a','b']);assert.equal(f.toastType.value,'warning');assert.equal(f.toastText.value,'未获取到推荐词（1 个关键词无结果，1 个关键词获取失败），请稍后重试');
});

for (const auth of ['business-4001', 'http-401', 'http-403']) {
  for (const partial of [false, true]) {
    test(`聚合推荐词${auth}停止后续关键词，已有结果=${partial}按实际数量写入`, async t => {
      const calls = [], written = [];
      const { f, b, run } = setup(t, 'SearchSuggestions', {
        feishuRequest: async ({ data }) => {
          calls.push(data.keyword);
          if (partial && data.keyword === 'a') return { data: { sta: 0, data: { items: [{ keyword: 'a', recommendation: '已获取结果' }] } } };
          if (auth === 'business-4001') return { data: { sta: 4001, msg: '测试密钥已失效' } };
          throw Object.assign(new Error('HTTP 鉴权失败'), { response: { status: Number(auth.slice(-3)), data: { msg: '测试密钥已失效' } } });
        },
        buildFeishuApiPath: path => `/socialdatax/api${path}`,
        createAndWriteData: async rows => { written.push(...rows); return { tableId: 'created' }; },
      });
      b.fetchSuggestions = extract('SearchSuggestions', 'fetchSuggestions', b);
      await run('execute')(['a', 'b', 'c']);
      assert.deepEqual(calls, partial ? ['a', 'b'] : ['a']);
      assert.equal(written.length, partial ? 1 : 0);
      assert.equal(b.loading.value, false);
      assert.equal(f.toastType.value, partial ? 'warning' : 'error');
      assert.match(f.toastText.value, /测试密钥已失效/);
      assert.doesNotMatch(f.toastText.value, /关闭|重新进入/);
      if (partial) {
        assert.match(f.toastText.value, /已写入 1 条.*获取已中止/);
        assert.doesNotMatch(f.toastText.value, /^处理完成/);
      }
    });
  }
}

for (const result of ['rows', 'empty', 'failure']) {
  test(`聚合推荐词停止后等待当前请求（${result}），不再获取后续关键词并按真实结果收尾`, async t => {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const calls = [], written = [];
    const { f, b, run } = setup(t, 'SearchSuggestions', {
      fetchSuggestions: async keyword => {
        calls.push(keyword); await gate;
        if (result === 'failure') throw new Error('当前关键词失败');
        return result === 'rows' ? [{ keyword, recommendation: '结果' }] : [];
      },
      createAndWriteData: async rows => { written.push(...rows); return { tableId: 'created' }; },
    });
    const pending = run('execute')(['a', 'b']);
    try {
      await nextTick();
      assert.equal(b.collecting.value, true);
      run('requestStop')(); run('requestStop')();
      assert.equal(b.loading.value, true);
      assert.match(f.toastText.value, /正在停止/);
      release(); await pending;
      assert.deepEqual(calls, ['a']);
      assert.equal(written.length, result === 'rows' ? 1 : 0);
      assert.match(f.toastText.value, /任务已停止，已写入 [01] 条推荐词/);
      assert.doesNotMatch(f.toastText.value, /请勿关闭/);
      assert.equal(f.toastType.value, result === 'failure' ? 'warning' : 'info');
      assert.equal(b.loading.value, false);
      assert.equal(b.stopRequested.value, false);
    } finally { release(); await pending; }
  });
}

test('聚合推荐词进入写入后不可再停止，不提前释放忙碌状态', async t => {
  let release, writing;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { writing = resolve; });
  const { b, run } = setup(t, 'SearchSuggestions', {
    fetchSuggestions: async () => [{ recommendation: '结果' }],
    createAndWriteData: async () => { writing(); await gate; return { tableId: 'created' }; },
  });
  const pending = run('execute')(['a']);
  try {
    await started;
    assert.equal(run('taskActionState').value, 'submitting');
    run('requestStop')();
    assert.equal(b.stopRequested.value, false);
    assert.equal(b.loading.value, true);
  } finally { release(); await pending; }
});
