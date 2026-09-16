# 交付结果记录

## 改动文件
- `src/features/research-jobs-router.ts`: 修复了 UNKNOWN 标的兜底和固定买卖信号问题，改用真实的 K 线数据生成买卖信号，并增强了针对请求市场的标的类型校验和失败状态返回。
- `src/features/research-repository.ts`: 增加了 `assertMarketContext`，保障存储层面的数据隔离和约束。
- `src/web/server.ts`: 新增了 `/api/data/capabilities` 接口，支持根据市场作用域 (`market`) 过滤数据源健康状态。
- `tests/research-jobs-execution.test.cjs`: 补充了回归测试，验证 UNKNOWN 无法通过，无写死信号，隔离正确，路由入口完整。

## 命令运行结果
### npm test
```
ℹ tests 339
ℹ suites 2
ℹ pass 339
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
Secret scan passed: 357 tracked files checked.
```

### git diff --check
没有输出，表示格式验证通过（部分 LF 转 CRLF 属于 git clone 和 working copy 跨平台自然行为）。

## 已知限制
- TradingView/期权实时数据的自动接入未在本次实现范围内（保持其现状并遵守禁令）。
- 因为未实际连接实时数据库和远端环境进行真实行情获取，部分单元测试使用了本地静态或模拟文件；对于数据接口，如果 K 线过少仍会返回 `Unavailable data` (此行为在预期内)。
