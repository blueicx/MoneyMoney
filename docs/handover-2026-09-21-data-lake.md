# MoneyMoney 2026-09-21 数据湖批次交接

## 当前工程与部署

- GitHub 仓库：`git@github.com:blueicx/MoneyMoney.git`
- 当前工作分支：`codex/stock-free-data-sources`
- VPS：`54.211.146.2`，用户 `ubuntu`
- 本地 SSH 私钥路径：`F:\vpsk\aws_blue.pem`（只记录路径，不记录密钥内容）
- 应用目录：`/opt/moneymoney`
- 发布产物：`/opt/moneymoney/dist`
- 服务：`moneymoney.service`
- 健康检查：`http://127.0.0.1:3001/api/health/live`

部署使用 `scripts/deploy-vps-dist.sh`。它会校验归档、服务端和首页 Hash，按需在停止服务前安装经过校验的运行依赖，创建远端备份，原子切换 `dist`，健康检查失败时回滚。远端发布目录、备份和回滚目录均按 release tag 隔离；不要覆盖已有 tag。

本批次首次部署时 VPS 曾因没有 DuckDB 运行包而自动回滚；随后已安装 `@duckdb/node-api@1.4.5-r.1` 并成功发布。以后新增运行依赖必须作为脚本的第 6 个参数传入，例如：`@duckdb/node-api@1.4.5-r.1`，不能只更新本地 `package.json` 后直接上传 `dist`。

## 认证交接

- 生产认证不再兜底 `admin/admin123`。
- 首次管理员信息由部署环境生成并保存在 VPS：`/home/ubuntu/moneymoney-initial-admin.txt`，权限为 `600`。
- 需要时通过 SSH 在服务器上读取，不要把内容写入 Git、日志、工单或本文件；迁移到密码管理器后再由管理员手工删除该一次性文件。
- `/etc/moneymoney/moneymoney.env` 仅保存认证配置和其他运行环境变量，认证字段更新必须保留文件中其他设置。

## 本批次：时点数据湖

已加入：

- SQLite 数据目录：数据集清单、分区、质量报告和回补任务。
- DuckDB Parquet 写入与读取，使用实际可安装的 LTS 版本 `@duckdb/node-api@1.4.5-r.1`；不能写成不存在的 `1.4.5`。
- `staging → Parquet → SQLite 清单` 的提交流程、内容 Hash、质量门禁和 `asOf` 时点查询。
- 重复时间戳、乱序、缺字段、非法数值、未来时间和跨市场标的校验。
- 数据接口：`/api/data/catalog`、`/api/data/history`、`/api/data/as-of`、`/api/data/quality`、`/api/data/revisions`、`/api/data/backfills`。
- 已接入单并发 Yahoo 免费历史 Worker：当前只允许 `stocks / bars`，支持现有股票周期，按 UTC 月写入分区，并在服务启动后自动领取 `queued` 任务。
- Worker 会把来源空结果、来源不可用、周期不支持和跨市场请求保存为明确的 `failed` 原因；不跨市场回退、不生成伪数据。
- 其他市场和宏观数据源仍需后续接入；生产数据湖为空时，接口会明确返回“暂无已发布分区”。

## 安全边界

- 只允许研究、回测、信号和模拟盘；真实下单执行器保持关闭。
- TradingView 适配器默认关闭；不复制 Freqtrade、one-quant-doc 或第三方业务代码。
- 四市场在数据湖入口做标的身份校验，不允许用其他市场数据填充当前市场。
- `data/` 下的运行数据库、缓存和用户数据不应加入 Git；提交时只选择源码、测试、锁文件和交接文档。

## 验证门禁

```text
npm test
npm run build
npm run smoke:web
npm run security:scan
git diff --check
```

部署前必须保存本地与远端 Hash、远端备份路径、服务状态、健康接口和 HTTPS 登录页结果；不能仅凭测试文本报告“已发布”。
