# 2026-10-29：AI 模拟执行快照 Hash 契约修复

## 生产只读结论

截至 2026-10-28T16:27:40.483Z，生产构建
`70ce10ae91bfd53d8e42d06c3538c49a17a55eb0` 的运行记录显示：

- 10 个 AI runner 共保存 2,330 条决策；动作是 `NONE` 2,313 条、`REVIEW` 17
  条，`BUY`/`SELL` 均为 0。
- 模型调用状态是 `success` 28 条、`failed` 152 条、`skipped` 2,054 条、
  `unknown` 96 条。
- AI runner 的 `trades` 为 0；10 个隔离模拟账户存在，但执行订单为 0。
- 小时级自动对照保存了 477 条记录，其中 110 条完成输入归档并记录三个账户
  结果，367 条等待；原因统计包含 131 次“观察快照 Hash 不一致”或“跑单快照
  Hash 不一致”。

因此，“模拟一直没成功”需要拆成两层：调度、行情读取和模型调用发生过，且
110 个整点对照曾完成；但 AI 自动模拟从未产生买入或卖出成交。休市期间没有
新鲜双边报价、共享免费额度耗尽、模型请求失败和模型返回 `NONE`/`REVIEW`
都是真实阻塞，不能把全部历史归因于单一缺陷。

## 根因

`buildAiRunnerComparisonSample()` 原先把规范化后的完整采样对象直接做
SHA-256。`RunnerExecutionEvidenceStore.observe()` 则只对允许进入执行证据的
字段重新序列化并生成快照 Hash。两套序列化范围不同，所以采样保存后，证据
归档会把同一个输入判为“观察快照 Hash 不一致”，共同模拟无法进入执行阶段。

## 修复

- `buildAiRunnerComparisonSample()` 和 `saveAiRunnerComparisonSample()` 统一
  调用 `runnerSnapshotHash()`，与执行证据存储使用同一份允许字段契约。
- 回归测试先用真实 `RunnerExecutionEvidenceStore.observe()` 消费共同快照，
  再验证保存、重放和无执行副作用路径。
- 不迁移或在原地改写生产历史快照。历史失败原因保留；修复只对部署后的新
  对照生效，避免为让旧记录“看起来成功”而伪造证据。

## 本地验收

- `npx tsc --pretty false`：通过。
- AI runner 与执行证据定向回归：134/134 通过。
- 串行全量隔离回归：484 个测试文件，2,347/2,347 通过，0
  failed/cancelled/skipped；日志
  `E:\MYC\mm-ai-runner-hash-full-tests.log`，SHA-256
  `7dbdea705f498f2d7b2c69a2fb92f62317c18698683121871f9ca6dfe9d57482`。
- `npm run build`：通过；提交前构建日志
  `E:\MYC\mm-ai-runner-hash-build.log`，SHA-256
  `36036332e127e3360d0f48eb672e295295fdea8e7d0bf02953506bbd39cb4f9c`。
  提交前构建身份仍指向基线 `a6282a0`，提交后须重新构建，不能把该构建当作
  最终发布身份。
- `npm run security:scan`：通过，1244 个跟踪文件未发现密钥。
- `git diff --check`：通过，只报告仓库既有的 CRLF/LF 转换提示。

## 验收边界

- 功能修复与本地测试：通过。
- 生产部署和线上只读复验：须在提交、推送、CI、备份及回滚校验完成后单独记录。
- 20% 冷启动性能目标：此前失败，本次修复不改变该结论。
- 24 小时连续可靠性：当前没有有效通过轮次；遗留进程已结束，不能续算或把
  短时观测当作通过。
