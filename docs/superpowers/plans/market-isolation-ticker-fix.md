# 市场隔离垂直切片实施计划：修复 Market Ticker

## 问题背景
当前 `predict-fun-trader` 项目的 MoneyMoney 功能分支中，正进行市场隔离的开发。根据用户反馈和代码检查，`/api/market-ticker` 在处理 `scope === 'stocks'` 和 `scope === 'options'` 时未返回有效数据，导致股票和期权市场的行情条带为空，出现了数据隔离缺口。

## 目标
修复 `/api/market-ticker` 针对股票和期权范围的返回值，使其严格根据 `market scope` 从免费股票数据源（Nasdaq）和免费期权数据源（CBOE）获取并渲染对应的行情条带数据。

## 实施步骤
1. **添加失败测试**
   在 `tests/market-scope-integration.test.cjs` 中添加针对 `server.ts` 包含 `scope === 'stocks'` 和 `scope === 'options'` 股票和期权拉取数据的断言测试，或者通过测试实际逻辑，确保在尚未实现前测试失败。

2. **实现股票数据加载**
   修改 `src/web/server.ts` 中的 `/api/market-ticker`：
   - 增加 `if (scope === 'stocks')` 的分支处理。
   - 使用预设的一组股票代码（例如 `['AAPL', 'MSFT', 'NVDA', 'TSLA']`）。
   - 调用已有的 `stockDataService.overview(symbol)` 获取报价，格式化后作为行情返回。

3. **实现期权数据加载**
   修改 `src/web/server.ts` 中的 `/api/market-ticker`：
   - 增加 `if (scope === 'options')` 的分支处理。
   - 使用预设的一组期权标的（例如 `['SPY', 'QQQ', 'IWM']`）。
   - 调用已有的 `getEquityOptionsSnapshot(symbol)` 获取期权快照，提取现价和隐含波动率/持仓等关键信息，格式化后作为行情返回。

4. **运行测试与验收**
   - 运行 `npm run build` 和 `npm test`，确保所有测试通过。
   - 运行 `npm run security:scan` 和 `git diff --check` 进行代码规范与安全检查。
   - 检查 `market-scope-integration.test.cjs` 等测试的通过情况。

## 兼容性说明
- 本次修改不涉及真实交易逻辑与凭据操作。
- `overview` 仍然保持对 `crypto` 数据或全局数据的处理，不被特定的单一市场覆盖。
- 继续保持宏观数据的独立。

## 执行记录

- 股票范围调用 `StockDataService.overview`，逐个保留 Nasdaq 报价成功的标的；单个标的失败不会清空其他结果。
- 期权范围调用 CBOE 免费延迟期权快照，展示 SPY、QQQ、IWM 的现价、IV30 和变动；单个标的失败不会影响其他结果。
- 保留预测市场、虚拟币和总体范围的既有行为；未修改宏观工具、交易、通知、VPN 或基础设施。
- 验收：`npm run build`、`npm test`（123/123）、`npm run security:scan`、`git diff --check` 均通过。
