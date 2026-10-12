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
- GitHub 推送、VPS 备份/部署、正式域名与远端资源 Hash 核验尚待发布后记录。
