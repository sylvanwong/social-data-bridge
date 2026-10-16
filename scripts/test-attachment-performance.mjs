import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/components/AttachmentPerformanceTest.vue', import.meta.url), 'utf8')
  .split('<script setup>')[1].split('</script>')[0].replace(/^import .*;\n/gm, '');
const samples = Array.from({ length: 80 }, (_, id) => ({ id, social_type: 'xhs', cover_url: `image-${id}` }));
const writes = [];
let tables = 0;
let initialized = 0;
const context = vm.createContext({
  ref: value => ({ value }), computed: get => ({ get value() { return get(); } }),
  defineProps: () => ({ api_key: 'test-only' }), defineEmits: () => () => {},
  PROFILE_FIELD_MAPPING: [{ key: 'cover_attachment', defaultSelected: true }],
  setupTableFields: async () => { initialized += 1; },
  bitable: { base: { addTable: async () => ({ tableId: `table-${++tables}` }) } },
  request: async config => ({ data: { sta: 0, data: config.method === 'get'
    ? { status: 1 } : { data: samples.slice(0, config.data.limit), has_more: false } } }),
  useSocialData: () => ({ createAndWriteData: async (items, type, taskId, tableId, keys, options) => {
    assert.equal(options.measurePerformance, true);
    assert.equal(options.stopAfterCurrentBatch, true);
    assert.equal(options.attachmentPipeline, true);
    assert.equal(initialized, tables);
    writes.push({ size: items.length, ids: items.map(item => item.id), tableId, uploadBatchSize: options.uploadBatchSize });
    return { recordIds: items.map(item => item.id), metrics: {
      records: items.length, attachmentCount: items.length, attachmentBytes: items.length * 100,
      downloadMs: 1, uploadMs: 2, writeMs: 3, totalMs: 10,
      uploadBatchSize: options.uploadBatchSize,
    } };
  } }),
});
vm.runInContext(source, context);
await vm.runInContext("taskId.value = '6acdad2d2df243fa9fe87c18'; run()", context);
assert.equal(vm.runInContext('report.value.completed', context), true);
assert.equal(tables, 4);
assert.deepEqual(writes.map(write => write.size), Array(8).fill(40));
assert.deepEqual(writes.map(write => write.tableId), [
  'table-1', 'table-1', 'table-2', 'table-2', 'table-3', 'table-3',
  'table-4', 'table-4',
]);
assert.deepEqual(writes.map(write => write.uploadBatchSize), [3, 3, 5, 5, 5, 5, 3, 3]);
for (let index = 1; index <= 4; index += 1) {
  assert.deepEqual(writes.filter(write => write.tableId === `table-${index}`).flatMap(write => write.ids), samples.map(item => item.id));
}
assert.equal(vm.runInContext('summaries.value.every(row => row.records === 160 && row.attachmentCount === 160 && row.attachmentBytes === 16000)', context), true);
context.request = async () => ({ data: { sta: 0, data: { status: 0 } } });
await vm.runInContext('run()', context);
assert.equal(vm.runInContext('report.value.completed', context), false);
assert.match(vm.runInContext('report.value.error', context), /已采集完成/);
assert.equal(tables, 4);
console.log('PASS: identical samples, fixed 40-record pages, reversed 3/5 upload order, isolated tables, aggregation, unfinished task rejected.');
