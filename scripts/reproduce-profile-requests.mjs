import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';

// Run the real component functions with virtual time and mocked API/SDK calls.
// No network requests, credentials, backend tasks or Feishu tables are used.
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
if (args.includes('--help')) {
  console.log('node scripts/reproduce-profile-requests.mjs [--total 1059] [--timeline /tmp/profile-timeline.json]');
  process.exit(0);
}
const total = Number(option('--total', 1059));
assert(Number.isInteger(total) && total > 0, '--total must be a positive integer');
const source = readFileSync(new URL('../src/components/ProfileFetch.vue', import.meta.url), 'utf8');
const names = [
  'unwrapApiData', 'clearStreamTimer', 'saveStreamTask', 'clearSavedStreamTask',
  'stopStreamTask', 'getStreamProgressText', 'getProfileTaskStatus',
  'readAvailablePosts', 'drainAvailablePosts', 'finishStreamTask',
  'pollStreamTask', 'cancelProfileTask',
];
const functions = names.map(name => {
  const start = source.indexOf(`const ${name} = `);
  assert(start >= 0, `Missing component function: ${name}`);
  const end = source.indexOf('\nconst ', start + 1);
  assert(end > start, `Cannot extract component function: ${name}`);
  return source.slice(start, end);
}).join('\n');
const limit = Number(source.match(/const STREAM_RESULT_LIMIT = (\d+);/)?.[1]);
assert(limit > 0, 'Missing result page size');
const allItems = Array.from({ length: total }, (_, i) => ({ aweme_id: String(i + 1) }));

async function simulate(config) {
  let now = 0;
  let polls = 0;
  let failures = config.writeFailures || 0;
  let available = 0;
  let scheduled = null;
  let stopped = false;
  const events = [];
  const record = (event, details = {}) => events.push({ time_ms: now, event, ...details });
  const context = vm.createContext({
    STREAM_TASK_STORAGE_KEY: 'mock', STREAM_RESULT_LIMIT: limit,
    STREAM_ACTIVE_INTERVAL: 2000, STREAM_MAX_INTERVAL: 30000,
    STREAM_STALL_TIMEOUT: 10 * 60 * 1000,
    props: { api_key: 'mock-only' },
    streamTimer: { value: null }, loading: { value: true },
    isCancelling: { value: false }, activeProfileTaskId: { value: 'mock-profile-task' },
    Date: { now: () => now }, clearTimeout: () => {},
    console: { error: (...values) => record('error', { message: values.map(String).join(' ') }) },
    showToast: () => {}, showCompletionToast: () => {}, showErrorMsg: () => {},
    bitable: { bridge: { setData: async () => {} } },
    request: async ({ url, data }) => {
      if (url.endsWith('/cancel')) {
        record('cancel_response', { sta: 0, status: 1, status_text: 'completed', cancel_requested: false });
        return { data: { sta: 0, data: { status: 1, status_text: 'completed', cancel_requested: false } } };
      }
      if (url.includes('/social/task?')) {
        polls += 1;
        const emptyPolls = config.emptyPolls || 0;
        available = polls <= emptyPolls ? 0 : Math.min(total, (polls - emptyPolls) * (config.producePerPoll || total));
        // Live heartbeat prevents a stall during legitimate empty polling.
        const status = available === total ? 1 : 0;
        record('status', { status, available });
        return { data: { sta: 0, data: { status, processed: available, heartbeat_at: polls } } };
      }
      assert(url.endsWith('/post/list'), `Unexpected API: ${url}`);
      const after = Number(data.after_id || 0);
      const items = allItems.slice(after, Math.min(after + data.limit, available));
      const next = items.length ? String(after + items.length) : data.after_id;
      const hasMore = after + items.length < available;
      record('post/list', { task_id: data.task_id, after_id: data.after_id, count: items.length, next_cursor: next, has_more: hasMore });
      return { data: { sta: 0, data: { items, next_cursor: next, has_more: hasMore } } };
    },
    createAndWriteData: async (items) => {
      record('write_start', { first_id: items[0].aweme_id, count: items.length });
      if (config.cancelOnFirstWrite && !stopped) {
        stopped = true;
        await vm.runInContext('cancelProfileTask()', context);
      }
      if (failures > 0) {
        failures -= 1;
        record('write_failure');
        throw new Error('Simulated write failure propagated to poll loop');
      }
      record('write_complete', { count: items.length });
      return { tableId: 'mock-table' };
    },
    scheduleStreamPoll: (task, delay) => { scheduled = { task, delay }; },
  });
  vm.runInContext(`
    let streamRequestInFlight = false;
    let activeStreamTask = {
      taskId: 'mock-profile-task', cursor: '', targetTableId: 'mock-table',
      selectedFieldKeys: [], fieldMappings: [], writeMode: 'upsert', writtenCount: 0,
      lastProcessed: -1, lastHeartbeatAt: 0, lastActivityAt: 0, pollInterval: 2000,
    };
    ${functions}
  `, context);
  await vm.runInContext('pollStreamTask(activeStreamTask)', context);
  while (scheduled) {
    assert(polls < 10000, 'Simulation did not terminate');
    const pending = scheduled;
    scheduled = null;
    now += pending.delay;
    await vm.runInContext('pollStreamTask(activeStreamTask)', context);
  }
  assert.equal(vm.runInContext('activeStreamTask', context), null, 'Task must finish');
  const requests = events.filter(e => e.event === 'post/list');
  const writes = events.filter(e => e.event === 'write_complete');
  assert.equal(writes.reduce((sum, e) => sum + e.count, 0), total, 'All records must be written');
  const result = {
    scenario: config.name, total, post_requests: requests.length,
    data_responses: requests.filter(e => e.count > 0).length,
    empty_responses: requests.filter(e => e.count === 0).length,
    successful_write_batches: writes.length,
    write_failures: events.filter(e => e.event === 'write_failure').length,
  };
  assert.equal(result.post_requests, config.expected, config.name);
  return { ...result, events };
}

const pages = Math.ceil(total / limit);
const scenarios = [
  { name: 'completed: all results ready', expected: pages + 1 },
  { name: 'completed: cancel during first write', cancelOnFirstWrite: true, expected: pages + 1 },
  { name: 'streaming: 10 new results per poll', producePerPoll: 10, expected: Math.ceil(total / 10) + 1 },
  { name: 'streaming: 60 initial empty polls', emptyPolls: 60, expected: pages + 61 },
  { name: 'completed: 60 propagated write failures', writeFailures: 60, expected: pages + 61 },
];
const results = [];
for (const scenario of scenarios) results.push(await simulate(scenario));
console.table(results.map(({ events, ...summary }) => summary));
const timelinePath = option('--timeline', '');
if (timelinePath) {
  writeFileSync(timelinePath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Timeline written to ${timelinePath}`);
}
console.log('PASS: actual ProfileFetch pagination/poll/cancel functions; API and entire writer mocked.');
console.log('Write-failure scenario models errors reaching pollStreamTask, not the writer internal recursive retries.');
