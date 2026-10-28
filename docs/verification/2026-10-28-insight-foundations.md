# 2026-10-28 总交付第一切片：证据基础与只读研究能力

起点：`b6a1bbc7cb34f9e3fc04672d179cffd512a5f3fa`。本切片覆盖“剩余 24 项”的第 1 项尾部（横截面分组、行业中性、滚动样本外）与新增 12 项中的多数只读分析能力，并为后续批次建立共享证据契约。

## 已实现

- `EvidenceRef` 共享证据契约：市场、标的、来源、发布时间、观察时间、抓取时间、内容 Hash、覆盖状态与未知原因；完整证据必须同时具备抓取时间与 Hash，时间顺序倒置被拒绝。
- 横截面因子：点时成员校验、行业中性标准化（行业内样本少于 3 个退回全局并标注）、分位组、Rank IC、非成员/缺失观测排除清单。
- 滚动样本外检验：固定训练/检验窗口，样本不足返回 `insufficient` 与原因。
- 只读洞察端点：`/api/evidence-gaps`、`/api/workspace/search`、`/api/audit/timeline`、`/api/source-health/dashboard`、`/api/methodology[/:ref]`。
- 纯计算端点：`POST /api/analysis/position-sizing/preview`（分数 Kelly / 带上限启发式，永不执行）、`POST /api/analysis/correlation-matrix/preview`（精确时间戳对齐、不插补）。
- 信号看板：`GET /api/analysis/signals` 只汇总已保存信号，展示一致/冲突、缺失证据、过期与新鲜度。
- 研究模板：版本化检查清单（期权估值、事件研究、因子检验、组合压力、预测结算），项目创建可记录 `templateRef` 并校验市场一致。
- 本地定时报告：管理员配置，固定 2–6 项引用，上海时区每日/每周生成 HTML＋JSON 与 Hash 清单，同窗口幂等、失败三次后停止重试，不发送外部通知。
- CSV 导出：证据缺口、审计时间线与相关性矩阵。

## 验证结果

- 定向测试：新增 12 个测试文件全部通过，另回归既有 historical-universe 与 research-projects 相关 9 个测试文件全部通过。
- 串行全量回归：479 个测试文件、2320 项通过，0 失败、0 取消、0 跳过。日志 `E:\MYC\mm-24-expansions-slice1-tests.log`，SHA-256 `B2F829CAA6D58D645EBCB530AC8B463CD699149604054699180D9FE4EFA1A46B`。
- `npm run build` 通过；`npm run smoke:web` 通过（健康检查、访客登录门、AI 配置脱敏与真实交易关闭边界）。
- `npm run security:scan` 通过（1187 个跟踪文件）；`git diff --check` 仅有既有行尾提示。
- 修复：洞察路由最初挂在 `/api` 并对全部路径执行管理员校验，导致 `/api/health/live` 等公共端点被拦截；现改为仅接管自身路径，并新增两条穿透回归用例。
- 提交：`70ce10ae91bfd53d8e42d06c3538c49a17a55eb0`，已推送 `codex/research-closure-all`；GitHub Actions `MoneyMoney CI` run `40706495716` 成功。
- 发布：release `70ce10a-20261028`，发布包 SHA-256 `ce837f31f1090616b10780d280dff6a4e29a3486edbec80ea7a6157beb52af50`，`server.js` `3742fd921b8b8b2e8c2e80613eabbdba5874c8bd97985c1e7c3acb9fc64ca990`，`index.html` `5c3baa8ad7ff8622e8875524f15b5ebc5fd69630fb5b18fe66b60d3d3a14e4a5`。
- 发布前备份 `/opt/moneymoney/backups/dist-pre-70ce10a-20261028`，回滚目录 `/opt/moneymoney/dist.rollback-70ce10a-20261028`；`moneymoney.service` 为 active。
- 线上只读核对：`/api/health/version` 返回 commit `70ce10a...`；服务器端 `server.js` 与 `index.html` Hash 与本地一致；未认证访问 `/api/evidence-gaps`、`/api/report-schedules`、`/api/research/templates`、`/api/analysis/signals` 均返回 401；首页未登录返回 302。
- 未完成：生产环境启用 LAN 访问令牌，因此 `/api/methodology` 未认证返回 401 属预期；四市场登录后只读冒烟因本地无生产凭据未执行。

## 尚未完成

- 24 项中第 2–6、7–12、13–19、20–24 项主体。
- 新增 12 项中的协作账号、离线加密工作包、自定义指标、可视化流程编排与回放书签界面（现有 `chart-bookmarks` 已支持 `asOf` 回放时点）。
- 20% 冷启动性能目标仍为未通过（既有证据 `E:\MYC\mm-eight-loading-bracket.json`）。
- 24 小时连续可靠性以独立轮次跟踪；本切片不改变其结论，也不以功能测试代替。
- 协作账号、离线工作包、自定义指标与流程编排尚未部署。
