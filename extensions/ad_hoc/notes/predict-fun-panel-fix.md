# Predict.fun 面板修复复盘

## 关键教训
- 不要用 PowerShell replace 修改含 JS 模板字符串的 HTML；应使用 Node、split/join 或 AST/Babel。
- 一个缺失的右大括号会让后续函数被嵌套，浏览器 onclick 找不到全局函数。
- HTML tab 容器嵌套错误会让 active 类生效但面板仍不可见。
- Playwright 拦截 PWA 请求时应在测试 context 使用 serviceWorkers: block。
- 中文化要覆盖静态 HTML、JS 字符串、模板片段和后端提示。

## 下次更优路径
- 先解析所有 inline script，再定位语法根因。
- 用浏览器检查全局 handler 并做点击断言。
- 构建前校验源码、dist 和 Android assets 哈希一致。
