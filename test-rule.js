function getTestText() {
  // 返回固定中文文案，用于验证全局规则会保留中文字符而不是 Unicode 转义。
  return "中文测试";
}

module.exports = {
  getTestText,
};
