# MoneyMoney 网页性能与请求治理发布交接

## 变更范围

- 代码提交：`9c4773f8683aea57c1bc2db410fdb3dedea8a1a6`，已推送至 `codex/research-closure-all`。
- Dashboard 认证与核心 runtime 等待保持不变；runtime 完成后，4 个兼容脚本改为同批下载、按插入顺序执行。现有工作区懒加载继续保留。
- `/api/stock/indices` 与股票驾驶舱指数 Provider 共用 `loadStockIndicesData()` 和 `getFreshExternal('stockIndices', 60s, ...)`，避免冷缓存并发重复访问 Tencent。两种 API 响应形状和失败语义保持兼容。
- 基准增加兼容脚本资源数、传输量、起始跨度和下载跨度；没有新增依赖、业务状态或数据库迁移。

## 验收

- `npm test`、`npm run build`、`npm run smoke:web`、`npm run smoke:auth`、`npm run smoke:browser`、`npm run smoke:live-kline`、`npm run security:scan` 和提交差异检查均通过。
- 部署后 `npm run smoke:production` 通过：四市场、SNDK、访客权限、K线历史边界和移动布局均已只读验证。
- Chromium 真实 Provider 基准：80ms RTT、750kbps、4×CPU，桌面/手机各 3 次冷/热配对。实现后兼容脚本 4 个资源的冷下载起始跨度中位数约 2.9–3.0ms，热加载为缓存命中。

| 视口 | 阶段 | 冷工作区 | 冷 K 线稳定 | 热工作区 | 热 K 线稳定 |
|---|---|---:|---:|---:|---:|
| 桌面 | 实现前 | 2746ms | 4598ms | 407ms | 1718ms |
| 桌面 | 实现后 | 3019ms | 4992ms | 494ms | 1837ms |
| 手机 | 实现前 | 2498ms | 4583ms | 454ms | 1758ms |
| 手机 | 实现后 | 2686ms | 4790ms | 478ms | 1802ms |

端到端冷/热中位数没有证明整体加载提速；Provider 波动较大，当前 K 线来源等待是主要未解决瓶颈。本轮只确认兼容脚本网络瀑布已消除、指数来源并发请求已合并，不宣称整体提速。

## VPS 发布记录

- 正式入口：`https://bluetrade.bbroot.com`；`/api/health/version` 返回提交 `9c4773f8683aea57c1bc2db410fdb3dedea8a1a6`，live health 为 `alive`，登录页 HTTP 200。
- `moneymoney.service` 为 `active`。只替换 `/opt/moneymoney/dist`，没有改动数据库、数据湖、环境密钥、Nginx/TLS、Telegram 或模拟跑单配置。
- 发布包 SHA-256：`69444fe71d9c6418e56dabdf564fa1fc99e26e44aa7bb1039db79ba69aa6c429`。
- 关键文件 SHA-256：
  - `dist/web/server.js`：`87bb03df510845e37baa4faaddd24d08e21295f37ec0dc832b0ace77c9f2aaba`
  - `dist/web/public/index.html`：`feccd691dc393a535ceb633b0c20a651a5275065677aea9ffaf67e2fb3b7eb63`
  - `dist/web/public/asset-manifest.json`：`827d0d3972f947c8f389f2de2e1e44065827de44c41110101263dfefb7c563cd`
  - `dist/build-info.json`：`ae4e8190697364ee070d55b06958a13b2b2f9ce3166ae17c2565363b86fd8b8a`
- 发布前备份：`/opt/moneymoney/backups/dist-pre-webperf-9c4773f-20261011-184057`。
- 回滚目录：`/opt/moneymoney/dist.rollback-webperf-9c4773f-20261011-184057`。
- 本地未跟踪 `data/research.db` 未加入提交；远端 `/tmp` 发布包和脚本已清理。

## 下一步

继续单独测量 `/api/stock/kline` 各 Provider 的真实耗时、缓存命中与失败状态，再决定优化点；不能通过过期回退、跨标的复用或伪造数据换取更快的图表首屏。

## 2026-10-11 股票 K 线首屏预载优化增量发布

- 代码提交：`392518128dcd8978fa74bb6c46fe16b6057c94f4`，已推送至 `codex/research-closure-all`。
- 认证完成后，只有明确的股票行情深链才预载哈希化图表脚本；脚本执行仍等待 dashboard core。加入默认关闭的阶段计时，受控 Chromium 证明图表稳定时不依赖指数、自选和模拟持仓接口。
- 验收通过：`npm test`、`npm run build`、`npm run smoke:web`、`npm run smoke:auth`、`npm run smoke:browser`、`npm run smoke:live-kline`、`npm run security:scan`、`git diff --check` 和正式域名 `npm run smoke:production`。生产浏览器矩阵覆盖四市场、SNDK、访客权限及图表历史边界。
- Chromium 真实 Provider 基准冷/热各 3 次、桌面/手机各测；冷图表中位数约为桌面 5.42 秒、手机 4.92 秒，Yahoo 响应波动明显。辅助接口门控运行中，K 线由 Yahoo 返回 300 根且状态为 `live`，图表稳定时三个辅助接口仍未完成。阶段预载已验证，但端到端冷启动 20% 改善目标未证明，不宣称整体提速达标。
- 正式域名 `https://bluetrade.bbroot.com` 返回 health `alive`，`/api/health/version` 返回上述提交。`moneymoney.service` 为 `active`。
- 发布归档 SHA-256：`79e5708d28c92bace2578b8e647178bfc5f95f3a79b780959466b8a7b8293681`。
- 远端关键文件 SHA-256 与本地构建一致：`web/server.js` `e61c05149cf9ba5cea74a6df43eba7a7d9e1be4a53f89c1e4da7ff9bed9b3eed`；`public/index.html` `b86a15c1e4714defa7c9dd974de67818936e32f3d1f4b59857d3a2daee607852`；`asset-manifest.json` `03cbf31a4bf059b1d4351945520099b2e03c3c5e2b3038d415c858e33357820f`；`build-info.json` `a872c97b7011f85f854846d5c358f746317bb998cc0720b1f4f20d7caca5b620`。
- 发布前备份：`/opt/moneymoney/backups/dist-pre-webperf-3925181-20261011`；回滚目录：`/opt/moneymoney/dist.rollback-webperf-3925181-20261011`。仅替换 `dist`，未更改服务环境、数据库、数据湖、Telegram 或交易配置。
- 首次部署脚本因 Windows CRLF 在 `set -o pipefail` 处退出，发生于任何生产操作前；转换并核验 LF 脚本 Hash 后成功部署。远端临时归档/脚本和本地临时归档均已清理。
- 本地未跟踪 `data/research.db` 未加入提交、发布包或清理。
