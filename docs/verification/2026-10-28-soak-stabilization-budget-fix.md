# 2026-10-28：24 小时隔离软验收 —— 稳定窗口过窄导致的连续失败与修复

## 现象

以固定构建 `f2bee1d7ff364a4e2e0e6da31e4551638d405f78` 发起的24小时隔离软验收，连续三次均在真实来源分支下于最初几分钟内失败：

1. `E:\\MYC\\mm-eight-24h-run.json`：约 19 分钟处中断。
2. `E:\\MYC\\mm-eight-f2bee1d-24h-run.json`（runId `a48f7f09-399a-4faf-a434-672c396e8bbd`）：约 22 分钟处失败，卡在切换到 `crypto-quotes` 工作区时，`/api/binance/klines` 与另一路 Binance 请求在 5 秒窗口内未能清空（实际于约 4.6 秒清空，但窗口要求清空后再稳定 500ms，总预算仅 5000ms，数学上已不足）。
3. `E:\\MYC\\mm-eight-f2bee1d-24h-supervised` runId `825ad564-1ae3-482f-b826-7205f0a00d20`：仅约 19 秒即失败，卡在切换到 `option-chain` 工作区，单个 `/api/options/BTC` 请求在全部 11 次采样（跨整个 5 秒窗口）中始终处于 pending，从未清空。

## 根因排查

- 三次失败时 `rollingAcceptance` 与 `sourceProgressAcceptance` 均为 `passed`，且无任何单一来源请求自身超时（`httpFailures:0`），说明不是应用挂起或来源不可用。
- 期权链 `getOptionsSnapshot`（`src/features/options-market.ts`）并行调用 Deribit 的 `get_index_price`、`get_instruments`、`get_book_summary_by_currency`，每路允许至多 15000ms（`fetchResult` 的 `AbortSignal.timeout(15_000)`）；加密货币工作区并行发起 K 线、深度、成交三路 Binance 请求，每路允许至多 8000ms。
- 直接从本机探测外部真实接口（Binance ping/depth/trades、Yahoo、Deribit）证实首次连接偶发数秒延迟甚至首次失败后重试成功，属于真实、合理的外部网络往返波动，与本会话此前记录的本机 TLS/SSH 握手间歇性重置现象一致。
- `scripts/long-session-smoke.cjs` 中用于判定工作区切换已稳定的 `waitForStableProgress` 调用使用了统一的 `timeoutMs:5000,stableMs:500`，该窗口是为本地/合成转场设计的，不足以容纳真实来源分支下单个工作区自身的真实外部往返耗时（最慢可达到各来源既定超时上限）。

## 修复

- commit `8eaad1b74eae58d6d5a71cd3cd30e67b0df05b5b`：将 `scripts/long-session-smoke.cjs` 中该窗口放宽为 `timeoutMs:20000,stableMs:750`，预算高于所有来源既定超时上限（15000ms），同时仍能捕获真正远超所有来源超时的卡死。
- 同步更新 `tests/soak-progress.test.cjs` 中钉住该固定预算的回归断言与注释，记录放宽原因与证据，避免未来静默改动被忽略。
- 验证：`node --test tests/soak-progress.test.cjs`（16/16 通过）；`npx tsc --noEmit` 通过；本地针对真实来源的 3 轮快速验证（`MONEYMONEY_SOAK_CYCLES=3 MONEYMONEY_SOAK_MINUTES=0 node scripts/long-session-smoke.cjs`）由此前必现失败转为通过。

## 第四轮 24 小时验收

- 以 `git archive 8eaad1b74eae58d6d5a71cd3cd30e67b0df05b5b` 导出独立构建目录 `E:\\MYC\\mm-soak-r4-release`，`npm ci`（批准 `better-sqlite3`、`esbuild` 的安装脚本）、`MONEYMONEY_BUILD_ID=8eaad1b74eae58d6d5a71cd3cd30e67b0df05b5b npm run build`，构建身份确认为 `8eaad1b74eae58d6d5a71cd3cd30e67b0df05b5b`，`buildFingerprint=3fdc5ebbbe812f770d189139f55647df661a168a7ab1592b12bae2f4e8f60fa8`。
- 启动独立隔离轮次：`E:\\MYC\\mm-soak-r4-24h-run.json`，runId `38a5cb94-ade9-4f52-a55e-e7670f62de23`，于 2026-10-28T13:50:02.513Z 开始计时；启动后约 3 分钟已完成 3 轮测量，`rollingAcceptance` 持续 `passed`，未再复现前三轮的失败模式。
- `scripts/soak-supervisor.cjs inspect` 最终返回 `status=interrupted`、`heartbeatAgeMs=11410992`，原因固定为 `legacy run descriptor has no signed run id, OS process start identity, or supervisor heartbeat`。该轮描述符没有正式的签名运行身份、操作系统进程启动身份或 supervisor 心跳，因此官方监督器无法证明被测进程持续运行的是同一固定构建。
- 该轮实际进程树随后由 PID、命令行和隔离服务器 guard 交叉确认，并在停止后复核 PID `57236`、`34860`、`61376` 均已退出。未改动生产进程、数据或 runner。
- 保留的原始 `soak-report.json` 仍为未完成状态 `running`，`measuredElapsedMs=11310418.7334`（约 188.5 分钟，3 小时 8 分），远低于验收要求的 1440 分钟。报告中的 runId、固定构建 `8eaad1b`、`buildFingerprint=3fdc5ebbbe812f770d189139f55647df661a168a7ab1592b12bae2f4e8f60fa8`、`restarts=0`、空 `failedChecks` 与空 `pageErrors` 均一致；`rollingAcceptance` 和 `sourceProgressAcceptance` 虽为 `passed`，但均带 `progressOnly=true`，`continuousAcceptance` 与 `publicSourceAcceptance` 尚不存在。
- 644 次公开来源探针中 643 次成功：股票、虚拟币和预测市场均为 161/161，期权为 160/161；最大来源探针间隔低于五分钟。该结果只支持运行期间的外部读取进度，不构成 24 小时连续验收。
- 结论：**未通过且不可续算**。不能把 `progressOnly` 结果、未完成原始报告或中断前时长推定为 24 小时通过；不调整稳定窗口阈值，不重启或接续本轮，后续验收必须使用具备签名 runId、操作系统启动身份与 supervisor 心跳的全新固定构建轮次，并从头计满 1440 分钟。
- 原始证据保留在 `E:\\MYC\\mm-soak-r4-24h-supervised\\runs\\38a5cb94-ade9-4f52-a55e-e7670f62de23`：
  - `soak-report.json`：`4ca2b4a0f32b5d9af9f1daa2666f5d9bee80e5129403ffa770bef62724150f57`
  - `source-probes.ndjson`：`c117bd46d0580c762d809bf1aa004f80a17d3cc63ae8067c687fa1e0dfcee1b8`
  - `network.ndjson`：`140534d293bfbad134b78186d40e1c288671d4903da565772e0a90d8591e0dca`
  - `supervisor.log`：`efb5c10dca20a98ac52343c23dc7424f63b9999bc20c735ea8a449d476b63e10`
- `moneymoney-24` 自动化已停止跟踪这条不可验证且已结束的轮次；新的正式轮次需要先由用户决定是否启动。
