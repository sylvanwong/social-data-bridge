import test from 'node:test';
import assert from 'node:assert/strict';
import { FieldType, DateFormatter, NumberFormatter } from '@lark-base-open/js-sdk';
import { createProductDetailFields, buildProductDetailRequest } from '../src/utils/productDetail.mjs';

test('商品详情沿用独立捷径的13个输出字段，销量保留零和未知，时间按北京时间转换', () => {
  const fields = createProductDetailFields({ FieldType, DateFormatter, NumberFormatter });
  assert.deepEqual(fields.map(f => [f.key, f.name]), [
    ['product_id', '商品ID'], ['title', '商品标题'], ['shop_id', '店铺ID'],
    ['shop_name', '店铺名称'], ['seller_id', '卖家ID'], ['cover_url', '封面图'],
    ['main_image_urls', '商品图链接'], ['detail_image_urls', '详情图链接'],
    ['sold_count', '销量'], ['positive_review_rate', '好评率'], ['assurances', '服务保障'],
    ['sku_info', 'SKU信息'], ['extract_time', '提取时间'],
  ]);
  const sales = fields.find(f => f.key === 'sold_count');
  assert.equal(sales.type, FieldType.Number);
  assert.equal(sales.getValue({ sold_count: 0 }), 0);
  assert.equal(sales.getValue({ sold_count: null }), null);
  assert.equal(sales.getValue({}), null);
  const time = fields.find(f => f.key === 'extract_time');
  assert.equal(time.getValue({ extract_time: '2026-11-19 10:20:30' }), Date.UTC(2026, 10, 19, 2, 20, 30));
  assert.equal(time.getValue({ extract_time: '' }), null);
});

for (const [input, platform, url] of [
  ['9.74 【抖音商城】https://v.douyin.com/3N9D4dqMxek/ 商品分享文案', 'douyin', 'https://v.douyin.com/3N9D4dqMxek/'],
  ['https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=1', 'douyin', 'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=1'],
  ['商品 https://www.xiaohongshu.com/goods/abc?sku_id=123 分享', 'xhs', 'https://www.xiaohongshu.com/goods/abc?sku_id=123'],
  ['https://xhslink.com/a/abc', 'xhs', 'https://xhslink.com/a/abc'],
]) test(`商品详情正确识别链接平台：${platform} ${url}`, () => {
  assert.deepEqual(buildProductDetailRequest(input), { social_type: platform, url });
});

test('商品详情不将无链接或仿冒域名当作支持的平台', () => {
  for (const input of ['无链接', 'https://douyin.com.evil.test/a', 'https://example.test/?url=douyin.com']) {
    assert.throws(() => buildProductDetailRequest(input), /抖音或小红书商品链接/);
  }
});
