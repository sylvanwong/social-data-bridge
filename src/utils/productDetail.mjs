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
  return [
    { key: 'product_id', name: '商品ID' },
    { key: 'title', name: '商品标题' },
    { key: 'shop_id', name: '店铺ID' },
    { key: 'shop_name', name: '店铺名称' },
    { key: 'seller_id', name: '卖家ID' },
    { key: 'cover_url', name: '封面图', type: FieldType.Url },
    { key: 'main_image_urls', name: '商品图链接' },
    { key: 'detail_image_urls', name: '详情图链接' },
    { key: 'sold_count', name: '销量', type: FieldType.Number, formatter: NumberFormatter.INTEGER,
      getValue: item => item?.sold_count == null || item.sold_count === '' ? null : Number(item.sold_count) },
    { key: 'positive_review_rate', name: '好评率' },
    { key: 'assurances', name: '服务保障' },
    { key: 'sku_info', name: 'SKU信息' },
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
