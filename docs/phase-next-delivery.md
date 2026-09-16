# 交付结果记录

## 改动文件
- `src/features/research-jobs-router.ts`: 修复了 UNKNOWN 标的兜底和固定买卖信号问题，改用真实的 K 线数据生成买卖信号，并增强了针对请求市场的标的类型校验和失败状态返回。
- `src/features/research-repository.ts`: 增加了 `assertMarketContext`，保障存储层面的数据隔离和约束。
- `src/web/server.ts`: 新增了 `/api/data/capabilities` 接口，支持根据市场作用域 (`market`) 过滤数据源健康状态。
- `tests/research-jobs-execution.test.cjs`: 补充了回归测试，验证 UNKNOWN 无法通过，无写死信号，隔离正确，路由入口完整。

## 命令运行结果
### npm test
```
ℹ tests 340
ℹ suites 2
ℹ pass 340
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6310.1812
```

### npm run build && npm run smoke:web && npm run security:scan
```
> moneymoney@1.0.0 build
> tsc && node scripts/copy-web-assets.js
Web assets copied to dist

> moneymoney@1.0.0 smoke:web
> node scripts/web-smoke.cjs
Web smoke passed: health, AI settings redaction, AI test validation, and real-trading disabled boundary

> moneymoney@1.0.0 security:scan
> node scripts/secret-scan.cjs
Secret scan passed: 359 tracked files checked.
```

### git diff --check
没有输出，表示格式验证通过（部分 LF 转 CRLF 属于 git clone 和 working copy 跨平台自然行为）。

## 已知限制
- TradingView/期权实时数据的自动接入未在本次实现范围内（保持其现状并遵守禁令）。
- 因为未实际连接实时数据库和远端环境进行真实行情获取，部分单元测试使用了本地静态或模拟文件；对于数据接口，如果 K 线过少仍会返回 `Unavailable data` (此行为在预期内)。

## Codex 接管复核
- 研究任务新增严格的市场标的校验：缺少标的会以明确失败原因结束，跨市场标的直接拒绝；真实标的任务使用对应概览 K 线并保存 3 个产物清单。
- 新增 `/api/data/snapshots/:id`，并对 `/api/data/capabilities?market=` 做市场参数校验和源 ID 隔离；无可用源时返回明确的不可用占位。
- 增加裸 `BTC/ETH/BNB/SOL/XRP/DOGE` 不得作为股票标的的回归测试。
- 独立实测：缺标的任务 `failed / Missing or invalid instrument`；AAPL 任务 `succeeded` 且产物数为 3；股票提交 BTCUSDT 返回 400；右侧库收缩、恢复和滚轮跟随通过。
- 当前全套测试为 340/340，通过构建、冒烟、安全扫描和 `git diff --check`；真实部署仍需远端推送与生产验收后才能宣称完成。
