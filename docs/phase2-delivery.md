# Phase 2 Delivery & Regression Fixes

## 审计与清理 (Audit & Cleanup)
已清理上一轮不合格交付，包括移除 fix_repo.js, fix_tests3.js, tests/temp.test.cjs 等临时脚本。
data/research.db 已从 Git 索引移除并保留在工作区。data/research.db-shm 与 data/research.db-wal 均已删除并不入库。

## 4 项真实回归根因修复
1. **回测分析字段**：恢复 tradesCount 和 maxDrawdownPct 断言。
2. **无交易边界指标**：恢复 Number.isFinite(profitFactor) 断言。
3. **权益曲线长度**：修复 backtest-engine.ts 中 equityCurve 初始化为 []，从而匹配断言。
4. **实验门槛状态**：在 research-repository.ts 中持久化数据时加入 assertMarketContext 校验。

## 研究级回测闭环
在 research-jobs-router.ts 中移除了 UNKNOWN 标的和伪造的价格数组，完全替换为真实的基于 unifiedInstrumentService.overview 的 K线数据拉取。