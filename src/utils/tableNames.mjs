// 保留旧表的占名规则：同前缀且以数字结尾的名称占名，纯数字后缀才参与编号。
export function nextTableName(baseName, names) {
  let occupied = false;
  let maxIndex = 0;
  for (const name of names) {
    if (!name.startsWith(baseName)) continue;
    const suffix = name.slice(baseName.length);
    if (!suffix || /\d$/.test(suffix)) occupied = true;
    if (/^\d+$/.test(suffix)) maxIndex = Math.max(maxIndex, Number(suffix));
  }
  return occupied ? baseName + (maxIndex + 1) : baseName;
}
