import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { File } from 'node:buffer';

const calls = [];
let active = 0;
let peak = 0;
const globals = {
  File, URLSearchParams, AbortController, setTimeout, clearTimeout,
  props: { api_key: 'mock-key' }, ATTACHMENT_DOWNLOAD_TIMEOUT: 60000,
  buildApiUrl: path => `https://api.example.test${path}`,
  fetch: async (url, options) => {
    calls.push({ url, options });
    active += 1;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, 5));
      return { ok: !url.includes('failed'), status: 503,
        blob: async () => new Blob(['image'], { type: 'image/jpeg' }) };
    } finally { active -= 1; }
  },
};
const detailSource = readFileSync(new URL('../src/components/VideoDataFetch.vue', import.meta.url), 'utf8');
const detail = vm.createContext(globals);
vm.runInContext(detailSource.slice(detailSource.indexOf('const getFileBaseName ='), detailSource.indexOf('const getAttachmentUrls =')), detail);
const downloadDetail = vm.runInContext('downloadAttachmentAsFile', detail);
const cover = { key: 'origin_cover_attachment' };
const file = await downloadDetail('https://sns-img-qc.xhscdn.com/image', 'cover.png', cover, { social_type: 'xhs' });
assert.equal(file.name, 'cover.jpg');
assert.equal(new URL(calls.at(-1).url).searchParams.get('image_mode'), 'xhs_cover');
assert.equal(calls.at(-1).options.headers.authorization, 'Bearer mock-key');
const beforeFailure = calls.length;
await assert.rejects(() => downloadDetail('https://sns-img-qc.xhscdn.com/failed', 'cover.jpg', cover, { social_type: 'xhs' }), /503/);
assert.equal(calls.length - beforeFailure, 1, 'XHS proxy failure must not fall back to the original');
await downloadDetail('https://instagram.test/image', 'cover.jpg', cover, { social_type: 'instagram' });
assert.equal(new URL(calls.at(-1).url).searchParams.has('image_mode'), false);
await downloadDetail('https://other.test/image', 'cover.jpg', cover, { social_type: 'douyin' });
assert.equal(calls.at(-1).url, 'https://other.test/image');

const xhsSource = readFileSync(new URL('../src/components/XhsDownload.vue', import.meta.url), 'utf8');
const xhs = vm.createContext({ ...globals, FieldType: { Text: 1, Attachment: 17, SingleSelect: 3 } });
vm.runInContext(xhsSource.slice(xhsSource.indexOf('const ATTACHMENT_DOWNLOAD_TIMEOUT ='), xhsSource.indexOf('const fieldOptions =')), xhs);
const downloadXhs = vm.runInContext('downloadAttachmentAsFile', xhs);
const xhsFile = await downloadXhs('https://sns-img-qc.xhscdn.com/image', 'cover.png', '封面附件', {});
assert.equal(xhsFile.name, 'cover.jpg');
assert.equal(new URL(calls.at(-1).url).searchParams.get('image_mode'), 'xhs_cover');
await downloadXhs('https://video.test/a.mp4', 'video.mp4', '下载附件', { note_type: '视频' });
assert.equal(new URL(calls.at(-1).url).searchParams.has('image_mode'), false);
peak = 0;
const originals = Array.from({ length: 9 }, (_, i) => `https://sns-img-qc.xhscdn.com/original-${i}?imageView2/2/format/png`);
const start = calls.length;
await Promise.all(originals.map(url => downloadXhs(url, 'original.png', '下载附件', { note_type: '图文' })));
assert.equal(peak, 3);
assert.deepEqual(calls.slice(start).map(call => call.url), originals);
assert(calls.slice(start).every(call => !call.options.headers));
await assert.rejects(() => downloadXhs('https://other.test/failed', 'original.jpg', '下载附件', {}), /503/);
await downloadXhs(originals[0], 'original.png', '下载附件', {});
assert.equal(vm.runInContext('activeAttachmentDownloads', xhs), 0);
console.log('PASS: both cover thumbnail proxies, JPEG filename, other-platform behavior, original image/video quality, three-slot limit and failure release.');
