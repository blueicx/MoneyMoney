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
- 提交 `e1cecc9a550c898041d053c978261923dc43057a` 后重新构建，日志
  `E:\MYC\mm-ai-runner-hash-postcommit-build.log`，SHA-256
  `9597ef1809258194908997672e62bf967e8710c77b66619afd127bf72c0fd741`；
  `dist/build-info.json` 的提交身份为完整 `e1cecc9`。
- AI runner、自动对照与执行证据的 15 个定向测试文件共 80/80 通过；日志
  `E:\MYC\mm-ai-runner-hash-postcommit-tests-r2.log`，SHA-256
  `a82f08c95c720326005e9280a1b81caab432de8e9c7343239b39a4a3c8341965`。
- 隔离真实浏览器自动对照 smoke 通过：市场过滤、三主题、现有 runner 不变、
  私有接口权限及 `modelRequests: 0` 均符合预期；日志
  `E:\MYC\mm-automatic-comparison-smoke-e1cecc9.log`，SHA-256
  `b4e47fccd5ee2ed113002d24674e3b060de3566fff75be41308bd4b92de96ed0`。
- `npm run security:scan`：通过，1244 个跟踪文件未发现密钥。
- `git diff --check`：通过，只报告仓库既有的 CRLF/LF 转换提示。

## 提交、CI 与发布

- 提交 `e1cecc9a550c898041d053c978261923dc43057a` 已推送至
  `codex/research-closure-all`。
- GitHub Actions `MoneyMoney CI` 运行
  [40726781632](https://github.com/blueicx/MoneyMoney/actions/runs/40726781632)
  成功，耗时 6 分 30 秒；构建、全量测试、安全扫描、差异检查、Web smoke、
  导航请求 smoke、七项扩充 smoke 和八项改进 smoke 全部通过。
- 发布前状态备份是
  `/opt/moneymoney/data/backups/2026-10-28T16-39-48-048Z`：2 个 SQLite、
  77 个文件、58 个数据湖文件，15 份既有损坏原件继续隔离，数据状态为
  `partial`。隔离恢复演练通过，未修改线上状态。
- 发布包 SHA-256
  `cc072f7e2ef90516cfe1ab9bf9dda9055b428614468ef5fa0ed1f585d03c76ea`；
  部署脚本 SHA-256
  `04da12b215aa5816ed7739225ac3a2c261b3cf845f924a221a2874296cbf804e`；
  server SHA-256
  `ec98867318233bfeda74f31f047dd64f1f5b36bc2c01f664c39250bbcb09bf0c`；
  index SHA-256
  `51bc6299baa0923a6a0114bade5b02761e49d79b9a0f715405ed33f6c6b9c0f5`。
- 仅替换 `/opt/moneymoney/dist` 并重启 `moneymoney.service`。服务最终
  `active`；正式域名 `/api/health/version` 返回完整提交 `e1cecc9` 和构建
  时间 `2026-10-28T16:30:16.483Z`。部署脚本启动期第一次连接尚未监听，
  随后健康检查通过，没有触发自动回滚。
- 备份目录
  `/opt/moneymoney/backups/dist-pre-e1cecc9-20261029-ai-runner-hash` 和回滚
  目录 `/opt/moneymoney/dist.rollback-e1cecc9-20261029-ai-runner-hash`
  均存在；回滚构建核验为 `70ce10a`，server/index Hash 与发布前一致。
- 本地与生产 `dist/web` 的 396 个文件逐项 SHA-256 比对：0 缺失、0 多余、
  0 不一致。
- 4 个新增或相关私有接口匿名访问均返回 401，访客访问均返回 403：
  `/api/ai-runners/comparisons/automatic`、`/api/ai-runners`、
  `/api/evidence-gaps`、`/api/report-schedules`。
- 正式域名生产只读浏览器 canary 通过股票、期权、虚拟币、预测市场、SNDK、
  双图与手机布局；日志
  `E:\MYC\mm-ai-runner-hash-production-canary.log`，SHA-256
  `9919e3fa6e7d1ee01e37be3dc4410e0d62f9c45b79f213bd3158db02f2c1c88a`。
- 发布前后 10 个 runner 的稳定配置指纹均为
  `dd7f1d37f656f67f85ece927146bf4b1a85cc549b910cbfd74062fd212b7a721`；
  自动对照调度配置指纹均为
  `bc61c3ed1ea418c2f01e63fcdc612d04a510c686ffaa4bf921633cb0b17a2252`。
  未修改 runner、交易或通知配置。生产 `research.db` 发布前后 SHA-256 均为
  `fb0e553fda92f67d89b7690fdd5a9d485d3f12cba4816621e34534527daeb8d2`。

## 验收边界

- 功能修复与本地测试：通过。
- CI、备份、隔离恢复、部署、资源 Hash、权限、四市场只读及 runner 指纹
  复验：通过。
- 修复已经部署，但发布后的下一轮真实整点自动对照尚未发生；不能把部署或
  测试说成生产上已经产生新的 `BUY`/`SELL`。历史上 AI 自动模拟成交仍为 0。
- 20% 冷启动性能目标：此前失败，本次修复不改变该结论。
- 24 小时连续可靠性：当前没有有效通过轮次；遗留进程已结束，不能续算或把
  短时观测当作通过。
