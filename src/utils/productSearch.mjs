export const PRODUCT_SEARCH_SORTS = [
  { value: 'general', label: '综合排序' }, { value: 'sales_descending', label: '销量降序' },
  { value: 'price_ascending', label: '价格升序' }, { value: 'price_descending', label: '价格降序' },
];
export const PRODUCT_SEARCH_SERVICES = [
  { key: 'only_live', label: '直播中' }, { key: 'dispatch_within_24h', label: '24小时内发货' },
  { key: 'shipping_insurance', label: '运费险' }, { key: 'seven_day_return', label: '7天无理由退货' },
  { key: 'official_store', label: '抖音旗舰' },
];
export function buildProductSearchRequest(form, token = '') {
  if (!['douyin', 'xhs'].includes(form.platform)) throw new Error('请选择商品平台');
  const keyword = String(form.keyword || '').trim();
  if (!keyword) throw new Error('请输入商品关键词');
  const data = { keyword, page_token: token };
  if (form.platform === 'xhs') return data;
  data.sort_type = form.sortType || 'general';
  if (!PRODUCT_SEARCH_SORTS.some(item => item.value === data.sort_type)) throw new Error('请选择商品排序');
  for (const [input, key] of [['minPrice', 'min_price'], ['maxPrice', 'max_price']]) {
    if (form[input] == null || form[input] === '') continue;
    const value = Number(form[input]);
    if (!Number.isInteger(value) || value <= 0) throw new Error('价格须为大于0的整数，单位为元');
    data[key] = value;
  }
  if (data.min_price != null && data.max_price != null && data.min_price > data.max_price) throw new Error('最低价格不能大于最高价格');
  for (const { key } of PRODUCT_SEARCH_SERVICES) data[key] = form[key] === true;
  data.selling_point = form.sellingPoint || 'all';
  if (!['all', 'high_sales', 'high_rating'].includes(data.selling_point)) throw new Error('请选择卖点筛选');
  return data;
}
export function createProductSearchFields({ FieldType, NumberFormatter }) {
  return [
    { key: 'product_id', name: '商品ID', required: true },
    { key: 'title', name: '商品标题' },
    { key: 'shop_id', name: '店铺ID' },
    { key: 'shop_name', name: '店铺名称', hint: '仅小红书' },
    { key: 'image_url', name: '封面图' },
    { key: 'sold_count', name: '销量', type: FieldType.Number, formatter: NumberFormatter.INTEGER, hint: '仅小红书' },
    { key: 'social_type', name: '平台' },
    { key: 'sku_id', name: 'SKU ID' },
    { key: 'spu_id', name: 'SPU ID', hint: '仅小红书' },
    { key: 'description', name: '商品描述', hint: '仅小红书' },
    { key: 'price', name: '价格（元）', type: FieldType.Number },
    { key: 'coupon_price', name: '券后价（元）', type: FieldType.Number, hint: '仅小红书' },
    { key: 'shop_avatar_url', name: '店铺头像', hint: '仅小红书' },
    { key: 'sales_text', name: '销量原文', hint: '仅小红书' },
    { key: 'stock_quantity', name: '库存', type: FieldType.Number, formatter: NumberFormatter.INTEGER, hint: '仅小红书' },
    { key: 'purchasable', name: '是否可购买', hint: '仅小红书' },
    { key: 'card_type', name: '商品卡类型', hint: '仅抖音' },
    { key: 'video_id', name: '视频ID', hint: '仅抖音' },
    { key: 'live_room_id', name: '直播间ID', hint: '仅抖音' },
  ].map(field => ({ type: FieldType.Text, defaultSelected: true, ...field }));
}
export function normalizeProductSearchItem(platform, item) {
  const productId = platform === 'xhs' ? item.sku_id : item.product_id;
  if (!String(productId || '').trim()) throw new Error('商品搜索结果缺少商品ID');
  return { ...item, product_id: String(productId), social_type: platform === 'xhs' ? '小红书' : '抖音',
    purchasable: item.purchasable == null ? '' : item.purchasable ? '是' : '否',
    card_type: ({ product: '普通商品', video: '视频商品', live: '直播商品' })[item.card_type] || item.card_type || '',
  };
}
