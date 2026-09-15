# MoneyMoney 交接文档 -- 2026-09-12 标的选择与功能区同步

## 1. 本轮目标

- 右侧标的库选中股票、期权或虚拟币后，立即进入对应的市场专属工作区。
- 在已打开某个功能区时切换标的，功能区内容跟随新标的刷新，而不是继续显示默认标的或通用内容。
- 事件与新闻区按当前标的过滤。
- 右侧标的库收缩后保留可见、可点击的展开入口。

## 2. 根因与修复

- `openWorkspace` 过去只切换视图，不把当前 `instrument` 重新传给新工作区；新增 `loadActiveWorkspaceInstrument()` 统一刷新股票、期权、虚拟币和事件工作区。
- `/api/events/timeline` 已支持 `instrumentId`，但页面此前只发送 `scope`；现在按当前市场生成规范化标的 ID 并传入 `instrumentId`。
- 期权/虚拟币标的库过去只改符号，未切换到对应的 `option-chain` / `crypto-quotes` 工作区；现在选择后会同步工作区和 URL。
- 展开按钮位于 `.layout` 外部，原 CSS 使用后代选择器导致收缩后按钮仍为 `display:none`；改为相邻兄弟选择器，并显式保证按钮可点击。

## 3. 验证结果

- `npm run build`：通过。
- `npm test`：265/265 通过。
- `npm run smoke:web`：通过，包含健康检查、AI 设置脱敏、AI 测试校验和真实交易禁用边界。
- `npm run security:scan`：通过，320 个受跟踪文件检查完成。
- 线上真实浏览器验证：
  - `stocks + events + MSFT`：事件区保持 MSFT，上下文 URL 为 `workspace=events&instrument=MSFT`，无关通用事件不再混入。
  - 切换“分析师共识”：仍显示 MSFT 的分析师数据。
  - 收缩右侧标的库：展开按钮 `display:flex`、`pointer-events:auto`；点击后右栏恢复 450px。
  - 选择期权 `SPY`：进入 `workspace=option-chain`，期权代码为 SPY。
  - 选择虚拟币 `BTCUSDT`：进入 `workspace=crypto-quotes`，行情标题为 BTC/USDT。

## 4. 发布信息

- 代码提交：`e252fda fix: bind selected instruments to workspaces`
- 分支：`codex/stock-free-data-sources`
- 线上目录：`/opt/moneymoney/dist`
- 线上备份：`/opt/moneymoney/backups/dist-e252fda`
- 回滚目录：`/opt/moneymoney/dist.rollback-e252fda`
- 服务：`moneymoney.service`，已重启且为 `active`
- 线上健康：`{"ok":true,"app":"MoneyMoney","status":"alive"}`
- 线上 `web/public/index.html` SHA-256：`64b5fe0a426b18b60da14da2874e4618c4539e3c4638e82f3a27cb6686802d7d`

## 5. 注意事项

- 本轮只提交了 `src/web/public/index.html` 与 `tests/stock-symbol-selector.test.cjs`；工作区中其他用户未提交文件未改动、未纳入提交。
- 线上部署仍保留上一版本备份；如需回滚，应停止当前服务后将 `dist.rollback-e252fda` 恢复为 `dist`，再重启并检查健康接口。
