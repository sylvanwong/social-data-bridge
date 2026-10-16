import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { File } from 'node:buffer';
import vm from 'node:vm';

// Execute the production download helpers with mocked network responses.
const source = readFileSync(new URL('../src/composables/useSocialData.js', import.meta.url), 'utf8');
const start = source.indexOf('const ATTACHMENT_DOWNLOAD_TIMEOUT =');
const end = source.indexOf('const normalizeCellValue =', start);
assert(start >= 0 && end > start);
let active = 0;
let peak = 0;
const calls = [];
const context = vm.createContext({
  File, URLSearchParams, AbortController, setTimeout, clearTimeout,
  buildApiUrl: path => `https://api.example.test${path}`,
  console: { warn: () => {} },
  fetch: async (url, options) => {
    calls.push({ url, options });
    active += 1;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      const failed = url.includes('failed');
      return { ok: !failed, status: failed ? 403 : 200,
        blob: async () => new Blob(['mock-image'], { type: 'image/jpeg' }) };
    } finally {
      active -= 1;
    }
  },
});
vm.runInContext(source.slice(start, end), context);
const createFiles = vm.runInContext('createAttachmentFiles', context);
const config = { key: 'cover_attachment', getUrls: item => [item.cover_url], getFileName: () => 'cover' };
const items = Array.from({ length: 20 }, (_, index) => ({
  social_type: 'xhs', cover_url: `https://sns-img-qc.xhscdn.com/${index}?imageView2/2/format/png`,
}));
const files = await Promise.all(items.map(item => createFiles(config, item, 'mock-key')));
assert.equal(peak, 3, 'Downloads must overlap but never exceed three');
assert.equal(calls.length, 20, 'Exactly one proxy download per XHS cover');
for (const [index, call] of calls.entries()) {
  const url = new URL(call.url);
  assert.equal(url.origin, 'https://api.example.test');
  assert.equal(url.searchParams.get('image_mode'), 'xhs_cover');
  assert.equal(url.searchParams.get('url'), items[index].cover_url);
  assert.equal(call.options.headers.authorization, 'Bearer mock-key');
}
assert(files.every(batch => batch.length === 1 && batch[0].name === 'cover.jpg'));
const beforeFailure = calls.length;
const failed = await createFiles(config, { social_type: 'xhs', cover_url: 'https://sns-img-qc.xhscdn.com/failed' }, 'mock-key');
assert.equal(failed.length, 0);
assert.equal(calls.length, beforeFailure + 1, 'Failed XHS proxy must not fall back to original');
const next = await createFiles(config, items[0], 'mock-key');
assert.equal(next.length, 1, 'Failure must release its download slot');
const beforeOther = calls.length;
await createFiles(config, { social_type: 'douyin', cover_url: 'https://other.example.test/image.jpg' }, 'mock-key');
assert.equal(calls.length, beforeOther + 1);
assert.equal(calls.at(-1).url, 'https://other.example.test/image.jpg');
assert.equal(calls.at(-1).options.headers, undefined, 'Direct CDN requests must not carry API key');
assert.equal(active, 0);
assert.equal(vm.runInContext('activeAttachmentDownloads', context), 0);
console.log('PASS: three concurrent downloads, XHS proxy mode, failure releases slot, other-platform direct downloads.');

// Verify both benchmark batch sizes preserve file/token associations, including
// entries arriving in download completion order rather than record order.
const uploadBatch = vm.runInContext('uploadAttachmentFilesInBatch', context);
for (const size of [20, 40]) {
  const target = new Map();
  const entries = Array.from({ length: size }, (_, index) => ({
    item: { id: index }, files: [new File([String(index)], `${index}.jpg`, { type: 'image/jpeg' })], target,
  })).reverse();
  let uploaded;
  context.bitable = { base: { batchUploadFile: async files => {
    uploaded = files;
    return files.map(file => `token-${file.name}`);
  } } };
  await uploadBatch(entries);
  assert.equal(uploaded.length, size);
  for (const entry of entries) {
    assert.equal(target.get(entry.item)[0].token, `token-${entry.files[0].name}`);
    assert.equal(target.get(entry.item)[0].size, entry.files[0].size);
  }
}
context.bitable = { base: { batchUploadFile: async () => [] } };
await assert.rejects(() => uploadBatch([{ item: {}, files: files[0], target: new Map() }]), /token/);
console.log('PASS: 20/40-file batch upload preserves token mapping and rejects incomplete responses.');

context.performance = performance;
const pipeline = vm.runInContext('prepareAttachmentPipeline', context);
const target = new Map();
const entries = items.map(item => ({ item, config, target }));
let uploadCalls = 0;
let simultaneousUploads = 0;
let maxUploads = 0;
let overlapped = false;
context.bitable = { base: { batchUploadFile: async batch => {
  uploadCalls += 1;
  simultaneousUploads += 1;
  maxUploads = Math.max(maxUploads, simultaneousUploads);
  overlapped ||= active > 0;
  await new Promise(resolve => setTimeout(resolve, 15));
  simultaneousUploads -= 1;
  return batch.map((file, index) => `token-${uploadCalls}-${index}`);
} } };
const metrics = {};
await pipeline(entries, 'mock-key', metrics);
assert.equal(uploadCalls, 2);
assert.equal(maxUploads, 1);
assert.equal(overlapped, true, 'Uploads must start before remaining downloads finish');
assert.equal(metrics.attachmentCount, 20);
assert.equal(metrics.attachmentMode, 'pipeline');
assert(entries.every(entry => target.get(entry.item)[0].token));
context.bitable = { base: { batchUploadFile: async () => { throw new Error('upload failed'); } } };
await assert.rejects(() => pipeline(entries, 'mock-key', {}), /upload failed/);
assert.equal(active, 0, 'Downloads must settle before upload failure is propagated');
console.log('PASS: pipelined downloads/uploads overlap, SDK uploads remain serial, failures settle before returning.');

const failedItem = { social_type: 'xhs', aweme_id: 'failed-work', cover_url: 'https://sns-img-qc.xhscdn.com/failed' };
const beforePermanent = calls.length;
await assert.rejects(() => pipeline([{ item: failedItem, config, target: new Map() }], 'mock-key', {}), /failed-work.*3 次.*HTTP 403/);
assert.equal(calls.length - beforePermanent, 3, 'Permanent download failures must stop after three attempts');
const originalFetch = context.fetch;
let transientAttempts = 0;
context.fetch = async (...args) => {
  transientAttempts += 1;
  if (transientAttempts === 1) return { ok: false, status: 503 };
  return originalFetch(...args);
};
context.bitable = { base: { batchUploadFile: async batch => batch.map(() => 'recovered-token') } };
const retryMetrics = {};
await pipeline([{ item: items[0], config, target: new Map() }], 'mock-key', retryMetrics);
assert.equal(transientAttempts, 2);
assert.equal(retryMetrics.downloadRetryCount, 1);
assert.equal(retryMetrics.attachmentCount, 1);
console.log('PASS: transient failures retry, permanent failures preserve HTTP reason and work ID, retries counted.');

const fullPageEntries = [...entries, ...entries].map(entry => ({ ...entry, item: { ...entry.item }, target: new Map() }));
for (const uploadSize of [3, 5]) {
  const sizes = [];
  context.bitable = { base: { batchUploadFile: async batch => {
    sizes.push(batch.length);
    return batch.map(() => 'group-token');
  } } };
  const batchMetrics = {};
  await pipeline(fullPageEntries, 'mock-key', batchMetrics, uploadSize);
  assert.equal(sizes.length, Math.ceil(fullPageEntries.length / uploadSize));
  assert.equal(sizes.reduce((sum, size) => sum + size, 0), fullPageEntries.length);
  assert(sizes.every(size => size <= uploadSize));
  assert.equal(batchMetrics.uploadBatchSize, uploadSize);
}
console.log('PASS: 3/5-file uploads include the last partial group without missing attachments.');
