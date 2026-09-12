# MoneyMoney 交接文档 -- 2026-09-12 股票上下文回归修复

## 1. 用户反馈对应关系

- 进入股票市场后，中间行情和右侧当前标的卡可能不是同一个股票。
- 直接打开带 `instrument=MSFT` 的链接，异步行情刷新可能回退到默认 AAPL。
- 首页右侧出现无可选内容的“总体标的库”空占位。

## 2. 根因

- `loadStockQuotes()` 只读取 `window._stockSelectedSymbol`，没有读取已恢复的 `currentInstrumentId`，异步完成时会重新选 AAPL。
- `restoreWorkspaceContextFromUrl()` 恢复了 URL 标的，但没有同步股票库的当前选中状态。
- `selectStockSymbol()` 更新中间行情但没有更新右侧当前股票卡。
- 总体页仍渲染跨市场空库；总体页没有单一标的选择，因此该列没有有效内容。

## 3. 修复与验证

- 股票加载优先使用当前 URL/工作区标的，保留真实选择上下文。
- URL 恢复时同步右侧股票库的当前标的。
- 统一更新中间行情、URL、左侧工作区和右侧当前标的卡。
- 总体页隐藏右侧空标的库列，进入股票/期权/虚拟币/预测市场后再显示对应库。
- 新增 3 项回归测试；`npm test`：268/268 通过。
- `npm run build`：通过。
- `npm run smoke:web`：通过。
- `npm run security:scan`：通过，321 个受跟踪文件检查完成。

真实线上浏览器验证：

- 首页：右侧库 `display:none`，布局使用完整中间宽度。
- 股票入口：AAPL 中间图表与右侧当前卡均为 AAPL。
- 切换 MSFT：中间图表为 `Microsoft · usMSFT`，右侧当前卡为 MSFT。
- 深链接 `market=stocks&workspace=stock-quotes&instrument=MSFT`：刷新后仍为 MSFT。

## 4. 发布信息

- 代码提交：`78c8a56 fix: sync stock library state with quotes`
- 分支：`codex/stock-free-data-sources`
- 线上目录：`/opt/moneymoney/dist`
- 线上备份：`/opt/moneymoney/backups/dist-78c8a56`
- 回滚目录：`/opt/moneymoney/dist.rollback-78c8a56`
- 服务：`moneymoney.service`，状态 `active`
- 健康接口：`{"ok":true,"app":"MoneyMoney","status":"alive"}`
- 线上 `web/public/index.html` SHA-256：`5f7f0e7b8d663e01292543e1625ff517d9d794bee69c444673e69c159598f02c`
