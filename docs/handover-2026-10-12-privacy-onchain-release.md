# 访客标的权限与链上时点发布记录

## 变更

- 提交：`c50a3eaf77beb63b028d52bd95f7256e71e36174`。
- 访客 `/api/instruments` 收紧为明确公开的只读路由；比较快照仍只返回 `visibility=public`。
- BTC 链上序列剔除晚于 `retrievedAt` 的观测，逐序列返回 `futureCount` 和原因；未来数据不参与指标与共同时间信号。
- 对应回归测试和工作区审计更新。

## 验收

- `npm test`、`npm run build`、`npm run smoke:web`、`npm run smoke:auth`、`npm run smoke:browser`、`npm run security:scan`、`git diff --check` 均通过。
- 正式域名版本：`c50a3eaf77beb63b028d52bd95f7256e71e36174`；`moneymoney.service` 为 `active`，公开 live health 返回 `alive`。
- 生产只读 Chromium canary：股票、期权、虚拟币、预测市场与 SNDK 通过；访客私有读取返回 HTTP 403。
- 生产访客权限抽检：未登记的 `/api/instruments/stock/us/AAPL/holdings` 返回 403；公开比较快照返回 200，响应不含 private 项。
- 远端 `dist/web/server.js` SHA-256：`6f800d5a7110799b0d050a8a7b30bc75eeaf1e2928cd53fc5468b3bc7bc68226`。
- 远端 `dist/web/public/index.html` SHA-256：`f2232b26f8386cb0546277cbe0c49b8dd4fb3168e3b3f31fc1f9e610f92587d8`。
- 远端 `asset-manifest.json` SHA-256：`48acd86b8668ac908d54ca7eb29d3c528c96f314ffaa15e0cdf3ea6f35eddd95`。
- 发布包 SHA-256：`c0442c78196a512bae8527bc8ca0bb66da0493c279b5abcace061b7d56b1fc9b`；上传包与部署器临时文件已清理。
- 备份：`/opt/moneymoney/backups/dist-pre-privacy-onchain-c50a3ea-20261012`。
- 回滚：`/opt/moneymoney/dist.rollback-privacy-onchain-c50a3ea-20261012`。
- 本地未跟踪用户数据库 `data/research.db` 保留，SHA-256 仍为 `27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1`；未打包、未提交、未部署。

## 未关闭事项

- Telegram 结果按钮的真实用户 ACK 仍待单独验收。此前已获准的一条测试消息超过 15 分钟回调期限；本次未重发消息，也未改变机器人或跑单配置。
- 本次验证不代表 Blockchain.com 当前在线可用率或 SLA。
