# 研究与数据接口访客权限收紧发布记录

## 变更

- 代码提交：`575445e88e73d5a6198a4878fcd402a1dbbb5060`。
- 访客对 `/api/data/*` 改为逐路径允许；回补任务、巡检目标和身份解析不再通过宽泛前缀访问。
- `/api/research/*` 改为仅允许公开因子目录和公开价格比较；个人研究记录、日报、候选策略、实验、任务、事件流和产物对访客拒绝。
- 回补、研究记录、候选及日报处理器增加管理员校验；访客只能按公共数据湖查询时点快照，不能回退读取研究仓库快照。
- 本地未跟踪用户文件 `data/research.db` 未纳入提交、构建包或部署；本轮前后 SHA-256 均为 `27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1`。

## 验收

- `npm test`、`npm run build`、`npm run smoke:web`、`npm run smoke:auth`、`npm run smoke:browser`、`npm run security:scan`、`git diff --check` 均通过。
- 浏览器认证冒烟实测 10 个私有研究/数据路由全部返回 HTTP 403；公开巡检摘要与因子目录返回 HTTP 200。
- 正式域名只读 Chromium 验收通过：股票、期权、虚拟币、预测市场及 SNDK；生产权限抽检与本地结果一致。
- GitHub 分支 `codex/research-closure-all` 已推送至 `575445e`。
- 生产版本 `https://bluetrade.bbroot.com/api/health/version` 返回提交 `575445e88e73d5a6198a4878fcd402a1dbbb5060`；登录页 HTTP 200，健康接口 `alive`，`moneymoney.service` 为 `active`，`/api/health` 显示 `view-only`。
- 构建归档 SHA-256：`63ce1720e74958a408e5fd915ca5fbe1577deebcdd167af1d0f58fdedf578022`；上传校验一致。
- 远端 Hash：
  - `dist/web/server.js`：`1bd2009a8589944eb3f2b9ab991f3d8c300c80921439590f0a9b1f7cf8e23be4`
  - `dist/web/public/index.html`：`f2232b26f8386cb0546277cbe0c49b8dd4fb3168e3b3f31fc1f9e610f92587d8`
  - `dist/web/public/asset-manifest.json`：`48acd86b8668ac908d54ca7eb29d3c528c96f314ffaa15e0cdf3ea6f35eddd95`
- 备份：`/opt/moneymoney/backups/dist-pre-575445e-20261012-guestscope`。
- 回滚：`/opt/moneymoney/dist.rollback-575445e-20261012-guestscope`。
- 上传归档及空 staging 目录已清理；备份和回滚目录保留。发布只替换 `dist/`，未打包数据库、数据湖或密钥；未发送 Telegram 消息，未改变模拟账户或真实交易设置。

## 后续

- Telegram 结果按钮的真实用户 ACK 仍需单独验收；本次没有再次发送测试消息。
- 后续公开 API 新增时继续采用逐路径访客授权，避免重新引入宽泛 `/api/data` 或 `/api/research` 前缀。
