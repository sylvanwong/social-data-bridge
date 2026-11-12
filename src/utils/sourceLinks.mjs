export const extractHttpUrls = (text) => {
  // 同一行连续粘贴的 URL 也分别提取，保留首次出现的顺序。
  const urls = text.match(/https?:\/\/.*?(?=https?:\/\/|[\s,，]|$)/gi) || [];
  return [...new Set(urls)];
};

export const parseManualUrls = (text) => {
  if (!text || typeof text !== 'string') {
    return [];
  }

  return [...new Set(
    text
      .split(/[\n,，]+/)
      .map(item => item.trim())
      .filter(Boolean)
  )];
};

export const extractCellLink = (value) => {
  if (!value) return null;

  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (typeof value === 'object') {
    const keys = ['link', 'url', 'text', 'content', 'value', 'displayText'];
    for (const key of keys) {
      const nested = extractCellLink(value[key]);
      if (nested) return nested;
    }
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractCellLink(item);
      if (nested) return nested;
    }
  }

  return null;
};
