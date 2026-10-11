# MoneyMoney 全工作区内容闭环验收记录

验收日期：2026-10-12  
分支：`codex/research-closure-all`  
本地验证提交：`3b6bdd777999bb7931adcca4689b15ea8a96b436`  
构建身份：`3b6bdd777999bb7931adcca4689b15ea8a96b436`

## 结果

- `npm test`：退出码 0；隔离测试文件全部完成，无失败。
- `npm run build`：通过；生成 27 个带哈希/预压缩资源，工作区按需加载；构建身份与提交一致。
- `npm run smoke:web`：通过；健康接口、AI 设置脱敏、配置验证、真实交易禁用边界通过。
- `npm run smoke:auth`：通过；管理员 Cookie、CSRF、私有路由、退出、访客只读及 SLO 检查通过。
- `npm run smoke:browser`：通过；四市场、三主题、SEC/13F、期权报价与乘数门槛、K线、预测结算证据、回测预检、提醒、侧栏收缩恢复、390px 视口及无页面异常通过。
- `npm run smoke:experience`：通过；工作区布局/密度、摘要筛选、K线日期定位、自选、批量提醒、撤销及手机标的库抽屉通过。
- `npm run security:scan`：通过，扫描 691 个已跟踪文件。
- `git diff --check`：通过。

## 验收中修正

期权浏览器夹具最初未填写 UI 明确要求核实的合约乘数，却直接期待损益结果。产品会在乘数为空时拒绝请求，这是预期安全行为。夹具现验证空值阻断，并在显式填写测试合约乘数 `100` 后验证试算，不放宽产品校验。

## 数据保护与发布状态

- 用户数据 `data/research.db` 保持未跟踪，未加入构建、提交或测试数据集。
- 真实交易执行保持禁用；没有连接真实券商或创建实盘订单。
- 代码分支 `codex/research-closure-all` 已普通推送至 GitHub，发布提交为 `e0af93b0abbb542190d5eaa2e85e1f3f7bf61916`。
- VPS 发布标记：`e0af93b-20261012-014503`。归档仅含 `dist/`（944 项）；本地与远端归档 SHA-256 均为 `3375a047e04f9b226c101941dc6c1df0927178de8e04c43ac3fa76424f036da1`。
- 发布产物 `dist/web/server.js` SHA-256：`62366b1f731ee56768c0cd392c93a9bd389434a459afd83c08e5d7d015140075`；`dist/web/public/index.html` SHA-256：`aa0aed1c041dc961b66143df5f73e2f9544551a91338a252e7e3f184d9e89195`。远端文件 Hash 与本地一致。
- 发布前版本为 `801a5b6eca741f780af2c8da5c6ef224c0166256`。远端旧产物备份：`/opt/moneymoney/backups/dist-pre-e0af93b-20261012-014503`；回滚目录：`/opt/moneymoney/dist.rollback-e0af93b-20261012-014503`。备份中的旧 server Hash 与发布前核验值一致。
- 发布后 `moneymoney.service` 为 `active`，内网健康接口返回 `alive`；正式域名 `/api/health/version` 返回发布提交及构建时间，首页重定向到登录页，登录页 HTTP 200 且标题为“登录 - MoneyMoney”。
- `npm run smoke:production` 只读 canary 通过：股票、期权、虚拟币、预测市场及 SNDK；未配置 Telegram 通知令牌，避免巡检失败时产生外部消息。
- 发布期间首轮健康探测遇到服务切换窗口，部署脚本重试后恢复并通过健康校验；远端上传包、部署脚本和空 staging 目录已清理，备份与回滚目录保留。
- 线上应用变更仅涉及 `dist`、本次版本的备份/回滚目录和空 staging 路径，并重启 `moneymoney.service`；没有触碰数据库、数据湖、Nginx、TLS 或相邻服务。
