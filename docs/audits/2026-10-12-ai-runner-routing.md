# AI 跑单报价与模型路由审计

## 改动边界

- 新建普通跑单默认使用 `best-valid`：先选来源观测时间最新的合格实时双边报价；观测时间相同则选相对点差较窄者；仍相同则按来源名称稳定排序。
- 历史 `random-valid` 值和 API 输入兼容，但会映射到同一确定性选择；`fixed` 仍只走固定来源。
- 共同快照对照组显式固定报价来源，不继承普通跑单的新默认。
- 免费模型仍按现有 `available-free` 故障回退策略运行，不修改既有模型 ID；页面明确显示路由策略和最近模型请求 ID。
- 不改任何已存在跑单的预算、冻结自选、账户/仓位、模型选择策略或启停状态；不新增模型调用、模拟订单或 Telegram 消息。

## 验收记录

- TDD 红灯：新报价/兼容断言未实现时，报价专项 4 项失败；对照组未显式固定时，对照完整性专项 6 项失败。
- 定向绿灯：`tests/ai-runner-routing.test.cjs` 9/9；`tests/ai-comparison-frozen-validation.test.cjs` 6/6；合并执行 15/15。
- 完整 `npm test` 退出码 0；`npm run build` 成功并生成 27 个带 Hash/预压缩资源。
- `npm run smoke:web`、`smoke:auth`、`smoke:browser`、`smoke:automatic-comparison`、`smoke:experience`、`smoke:practical`、`smoke:expansion` 全部通过。自动对照浏览器烟测报告 `independentRunnerUnchanged=true`、`modelRequests=0`、`automaticEnabled=false`；没有触发模型或真实/模拟订单。
- `npm run security:scan` 检查 700 个跟踪文件通过；`git diff --check` 退出码 0。
- 隔离测试前后，未跟踪的 `data/research.db` SHA-256 均为 `27FD475E523568DAA4CDCABF3146917023335A62AFFE00429BABD721B3B79FD1`。
- 代码差异审查确认仅涉及 AI 跑单报价选择兼容、共同快照固定来源、路由说明和测试/文档；没有修改账户、预算、自选、模型配置、订单或启停状态。

## 发布验收（2026-10-12）

- 提交 `9240b4724f5580a341ea4c56877562fe096a62a3` 已推送到 `origin/codex/research-closure-all`。
- 部署前服务为 `active`；归档包本地与远端 SHA-256 均为 `1980627fe163e4df076a170ae2471d2ce3b7dbbcad876471a922da299668545b`。
- 通过现有原子部署脚本发布到当前 `/opt/moneymoney`，只操作 `moneymoney.service`。备份目录：`/opt/moneymoney/backups/dist-pre-9240b47-20261012-runner-routing`；回滚目录：`/opt/moneymoney/dist.rollback-9240b47-20261012-runner-routing`。
- 部署后服务 `active`，`/api/health/live` 返回 `alive`；正式域名 `/api/health/version` 返回目标 commit `9240b4724f5580a341ea4c56877562fe096a62a3`，根路径按预期 302 到登录页。
- 远端与本地发布资源 Hash 一致：`server.js` `6f800d5a7110799b0d050a8a7b30bc75eeaf1e2928cd53fc5468b3bc7bc68226`；`index.html` `836ffa3853ec0e6eb398c47a5e82287610601984b17b4ed221c795478f3c67b1`；`asset-manifest.json` `721150083dcbfb63a8ebacc6622f1e9ae208e573b7e8b18c14ce532e928ce34c`；`build-info.json` `042148ab2ad6f4b65850ea2c5c0f5b2d9f7c499e02df4be492db9164f7c4d76c`。
- 正式站点只读 Chromium canary 通过：四市场、SNDK、K 线别名/历史时点、访客私有接口拒绝（403）、右侧库收缩/恢复及手机布局。结算证据在访客权限下正确显示仅支持只读浏览；未尝试管理员访问。运行 canary 时移除 Telegram 凭据环境变量，未发送 Telegram 通知。
- 未跟踪用户文件 `data/research.db` 发布前后 SHA-256 均为 `27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1`；未纳入提交。没有触发模型请求、Telegram 消息或模拟订单。
