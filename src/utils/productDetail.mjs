import { extractHttpUrls } from './sourceLinks.mjs';

export function buildProductDetailRequest(input) {
  const url = extractHttpUrls(String(input || ''))[0];
  if (url) {
    const host = new URL(url).hostname.toLowerCase();
    const belongsTo = domain => host === domain || host.endsWith(`.${domain}`);
    if (['douyin.com', 'jinritemai.com'].some(belongsTo)) return { social_type: 'douyin', url };
    if (['xiaohongshu.com', 'xhslink.com'].some(belongsTo)) return { social_type: 'xhs', url };
  }
  throw new Error('请输入有效的抖音或小红书商品链接');
}

export function createProductDetailFields({ FieldType, DateFormatter, NumberFormatter }) {
  const amount = (key, name, hint) => ({
    key, name, hint, type: FieldType.Number, defaultSelected: false, preserveOnEmpty: true,
    getValue: item => Number.isFinite(item?.[key]) ? item[key] : null,
  });
  return [
    { key: 'product_id', name: '商品ID' },
    { key: 'title', name: '商品标题' },
    { key: 'product_url', name: '商品链接', type: FieldType.Url, preserveOnEmpty: true },
    { key: 'social_type', name: '平台', preserveOnEmpty: true },
    { key: 'shop_id', name: '店铺ID', preserveOnEmpty: true },
    { key: 'shop_name', name: '店铺名称', preserveOnEmpty: true },
    { key: 'seller_id', name: '卖家ID' },
    { key: 'cover_url', name: '封面图', type: FieldType.Url, preserveOnEmpty: true },
    { key: 'main_image_urls', name: '商品图链接' },
    { key: 'detail_image_urls', name: '详情图链接' },
    { key: 'sold_count', name: '销量', type: FieldType.Number, formatter: NumberFormatter.INTEGER, preserveOnEmpty: true,
      getValue: item => item?.sold_count == null || item.sold_count === '' ? null : Number(item.sold_count) },
    { key: 'sales_text', name: '销量原文', preserveOnEmpty: true },
    { key: 'positive_review_rate', name: '好评率' },
    { key: 'assurances', name: '服务保障' },
    { key: 'sku_info', name: 'SKU信息' },
    { key: 'sku_id', name: 'SKU ID', hint: '仅小红书', defaultSelected: false, preserveOnEmpty: true },
    { key: 'shop_avatar_url', name: '店铺头像', preserveOnEmpty: true },
    amount('start_price', '起售价', '仅抖音'),
    amount('discount_start_price', '优惠后起售价', '仅抖音'),
    amount('original_price', '原价', '仅小红书'),
    amount('coupon_price', '券后价', '仅小红书'),
    { key: 'extract_time', name: '提取时间', type: FieldType.DateTime, dateFormat: DateFormatter.DATE_TIME,
      getValue: item => {
        const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(item?.extract_time || '').trim());
        if (!match) return null;
        const [, year, month, day, hour, minute, second] = match.map(Number);
        return Date.UTC(year, month - 1, day, hour - 8, minute, second);
      } },
  ].map(field => ({
    type: FieldType.Text, defaultSelected: true,
    getValue: item => item?.[field.key] ?? '', ...field,
  }));
}
