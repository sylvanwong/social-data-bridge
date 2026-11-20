import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductSearchRequest, normalizeProductSearchItem, createProductSearchFields } from '../src/utils/productSearch.mjs';
import { FieldType, NumberFormatter } from '@lark-base-open/js-sdk';

test('商品搜索平台参数隔离，抖音价格为正整数且区间合法', () => {
  const form = { platform: 'xhs', keyword: ' 手机壳 ', sortType: 'price_ascending', minPrice: 10, only_live: true };
  assert.deepEqual(buildProductSearchRequest(form, '完整/token+abc'), { keyword: '手机壳', page_token: '完整/token+abc' });
  const dy = buildProductSearchRequest({ ...form, platform: 'douyin' });
  assert.equal(dy.sort_type, 'price_ascending'); assert.equal(dy.min_price, 10); assert.equal(dy.only_live, true);
  for (const values of [{ minPrice: 0 }, { maxPrice: 1.2 }, { minPrice: 20, maxPrice: 10 }]) assert.throws(() => buildProductSearchRequest({ ...form, platform: 'douyin', ...values }), /价格/);
  assert.throws(() => buildProductSearchRequest({ platform: 'douyin', keyword: ' ' }), /关键词/);
});

test('统一商品ID，小红书SKU和抖音商品ID不混用，未知值和真实零保持区别', () => {
  const xhs = normalizeProductSearchItem('xhs', { sku_id: 'sku', sold_count: 0, stock_quantity: null, purchasable: false });
  assert.equal(xhs.product_id, 'sku'); assert.equal(xhs.social_type, '小红书');
  assert.equal(xhs.sold_count, 0); assert.equal(xhs.stock_quantity, null); assert.equal(xhs.purchasable, '否');
  assert.equal(normalizeProductSearchItem('xhs', { sku_id: 'sku' }).purchasable, '');
  assert.equal(normalizeProductSearchItem('douyin', { product_id: 'p', sku_id: 's', card_type: 'live' }).product_id, 'p');
  const fields = createProductSearchFields({ FieldType, NumberFormatter });
  assert.equal(fields.length, 19);
  assert.ok(fields.every(f => f.defaultSelected));
  assert.ok(!fields.some(f => f.key === 'product_url'));
});
