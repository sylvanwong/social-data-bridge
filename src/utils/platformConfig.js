import request from '@/utils/request'

export const PLATFORM_LABELS = {
  xhs: '小红书',
  douyin: '抖音',
  kuaishou: '快手',
  weibo: '微博',
  wechat: '微信',
  bilibili: '哔哩哔哩'
};

export const mapPlatformOptions = (platforms = []) =>
  platforms.map((platform) => ({
    value: platform,
    label: PLATFORM_LABELS[platform] || platform,
  }));

export const fetchPlatformConfigOptions = async (apiKey, name, fallbackOptions = []) => {
  const response = await request({
    url: "/social/api/v1/feishu/social/config",
    method: "get",
    params: { name },
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const res = response.data;
  if (res.sta === 0 && Array.isArray(res.data?.value)) {
    return mapPlatformOptions(res.data.value);
  }
  return [...fallbackOptions];
};
