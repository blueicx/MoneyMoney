# MoneyMoney K 线数据新鲜度标签修正发布记录

## 变更

股票历史 K 线适配器的 `live` 代表本次读取成功且数据为最新可用历史，不等于交易所实时行情。覆盖条现显示“最新可用（实时性未声明）”，保留延迟、缓存、部分成功、空数据、不可用和失败等独立状态。回归测试确认不会把历史请求误标为实时行情。

## Git 与验证

- 提交并推送：`126b3f19af728fc240cce00ab0387c7d5e857892`（`fix: clarify historical kline freshness status`）。仅包含 `index.html` 与两份测试；未包含工作区内的期权/预测市场变更、服务端改动或数据库。
- 从干净提交归档构建，显式指定构建 ID，生成 21 个哈希/预压缩静态资源。
- `npm test`：233 个隔离测试文件，1050/1050 通过；`smoke:web`、`smoke:auth`、`smoke:browser`、`smoke:contracts`、`smoke:live-kline`、`smoke:automatic-comparison`、`smoke:production`、`security:scan` 和 `git diff --check HEAD^ HEAD` 通过。生产 canary 为访客只读；自动对照本地 smoke 使用隔离 fixture，模型调用为 0。

## VPS 发布

- 发布包 SHA-256：`248c2807b817f6ad84395ea2a5412d2d43b990c5610715908f82061afe9fbf0c`。
- `server.js` SHA-256：`aea9ccc6f15a1f74f28f23ecd0e01e474166e281be3c5835314277db826f8c94`。
- `index.html` SHA-256：`20d0ff26dd011993931e6ee0a4600fefa196184c7047e6d2f0f4cc7a519d6a00`。
- `asset-manifest.json` SHA-256：`f92ec0fed2d779791b486fa5926f1d6ee36026ce202926820811986f05291a7a`。
- `moneymoney.service` 为 active；本机与正式域名 `/api/health/version` 均返回提交 `126b3f19af728fc240cce00ab0387c7d5e857892`，健康接口 alive。正式域名 Chromium 页面实测显示：`AAPL · 5m · 普通行情 · K线：最新可用（实时性未声明）`。
- 备份：`/opt/moneymoney/backups/dist-pre-kline-status-126b3f1-20261009-2355`；回滚目录：`/opt/moneymoney/dist.rollback-kline-status-126b3f1-20261009-2355`。仅替换应用 `dist` 并重启 `moneymoney.service`；未修改数据库、数据湖、Nginx、TLS、VPN 或真实交易配置。远端上传包与临时部署脚本已从 `/tmp` 清理。
- 本地 `data/research.db`、`-shm`、`-wal` 未纳入提交，SHA-256 与测试前基线一致。

## 仍未完成的验收

- 只读核对显示线上股票自动对照组仍启用，冻结 3 个标的，固定模型为 `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`。00:00Z 轮次为 waiting（模型扫描冷却），没有对该组重新配置。用户回答“随机”按“新建时抽取一个具体免费文本模型后冻结”理解；替换现有冻结组需要先归档旧组并创建新组，已单独向用户确认是否重建。
- 已有一条用户授权的 Telegram 验收消息，仍等待用户点击按钮确认真实 ACK；本轮没有重复发送。
- Predict.fun 缺少独立可核验的结算规则，自动新开仓与 AI 决策继续 fail-closed。未执行生产目录回滚演练，以免不必要的服务重启影响活动调度。
