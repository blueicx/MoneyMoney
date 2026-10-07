# MoneyMoney 2026-10-07 主线整合与 VPS 生产发布交接

## 1. 工程与部署基本信息

- **GitHub 仓库**：`git@github.com:blueicx/MoneyMoney.git`
- **当前主分支提交**：`88aa61e74420662485f08de1859afb06e24d14fb`（合并 `codex/research-closure-all` 与主线跨平台兼容性补丁）
- **发布 Release Tag**：`88aa61e-20261007-0435`
- **目标 VPS**：AWS 节点 `54.211.146.2`，SSH 端口 `22`，用户 `ubuntu`
- **本地 SSH 私钥路径**：`F:\vpsk\aws_blue.pem`（只记录路径，不记录私钥内容）
- **远端应用目录**：`/opt/moneymoney`
- **远端发布产物目录**：`/opt/moneymoney/dist`
- **系统服务**：`moneymoney.service`
- **内网健康检查**：`http://127.0.0.1:3001/api/health/live`，`http://127.0.0.1:3001/api/health/version`
- **公网入口域名**：`https://bluetrade.bbroot.com`（TLS 正常，非登录状态 302 重定向至 `/login`）
- **生产模式**：`view-only`（真实交易执行器保持禁用）

---

## 2. 发布执行与证据链

本次发布采用标准原子替换与回滚护栏脚本 `scripts/deploy-vps-dist.sh`：

1. **本地测试与门禁验证**：
   - 依赖补齐：确认 `@duckdb/node-api@1.4.5-r.1` 及其运行依赖一致；
   - 静态类型与构建：`npm run build` 成功，生成 18 个哈希压缩前端资源与 `dist/build-info.json`；
   - 完整回归测试：`npm test` **852/852 项全部通过，0 项失败**（耗时 37.3s）。

2. **产物打包与 Hash 校验**：
   - 发布归档：`/tmp/moneymoney-88aa61e-20261007.tar.gz`（仅包含顶层 `dist/`，排除源码、密钥、数据库、缓存与开发脚本）
   - **发布包 SHA-256**：`f3aeb6b73850a6217b0882451f600902d25a4fa56df03db2d49447ca18433ea2`
   - **关键文件 SHA-256**：
     - `dist/web/server.js`：`53d7b029049efa4ceafe03ea09ac0e164a2eabf3743a0554c07eb4bcb2b54e62`
     - `dist/web/public/index.html`：`deab5096a33006d27c6f3fbfbefff98ec14e9acf2bd16e5cb2d7221502b354f8`

3. **远端发布与原子切换**：
   - 发布前自动备份目录：`/opt/moneymoney/backups/dist-pre-88aa61e-20261007-0435`
   - 回滚保留目录：`/opt/moneymoney/dist.rollback-88aa61e-20261007-0435`
   - 权限及属主：恢复 `moneymoney:moneymoney`
   - 服务重启与状态：`moneymoney.service` 状态为 `active`

4. **线上健康检查与版本响应**：
   - `/api/health/version` 返回：
     ```json
     {
       "ok": true,
       "app": "MoneyMoney",
       "version": "1.0.0",
       "commit": "88aa61e74420662485f08de1859afb06e24d14fb",
       "builtAt": "2026-10-06T20:28:43.348Z",
       "source": "build artifact",
       "dataStatus": "live",
       "reason": null
     }
     ```
   - `/api/health` 返回：
     ```json
     {
       "ok": true,
       "app": "MoneyMoney",
       "mode": "view-only",
       "binding": "127.0.0.1",
       "storage": {
         "ok": true,
         "databasePath": "/opt/moneymoney/data/moneymoney.sqlite",
         "migratedDocuments": 0,
         "migrationErrors": []
       }
     }
     ```
   - 公网 `https://bluetrade.bbroot.com` HTTP 响应：`302 Found`（跳转至 `/login?next=%2F`），响应头携带 `X-Powered-By: Express` 及合法证书。

---

## 3. 本次主线整合包含的核心能力清单

| 系统模块 | 核心落地能力 |
| :--- | :--- |
| **时点数据湖与 DuckDB 引擎** | 基于 DuckDB 与 SQLite 的分片时序存储、Manifest 版本元数据、时间旅行快照（Point-in-Time Snapshot）与数据清洗工作进程（Data Lake Worker）。 |
| **多市场专属资产回测引擎** | `runAssetBacktest` 正式支持股票、加密货币与预测市场，覆盖动量/均值回归策略，输出 CAGR、Sortino Ratio、最大回撤与换手率，并纳入蒙特卡洛再现性检验。 |
| **机构大佬持仓与 13F 共识** | SEC 10-K / 13F 四个报告期持仓聚合、机构重合共识度、持仓变动重放与披露时间线。 |
| **全景图表与 K 线升级工作台** | 股票日内与多周期 K 线钻取、全屏图表工作区、缠论走势结构与关键支撑/阻力标注。 |
| **因子实验室与策略候选池** | Factor Lab、实验运行器（Experiment Runner）、策略候选人网格（Strategy Candidates）与生命周期监控。 |
| **AI Paper Runner 2.0** | 独立多 Runner 虚拟资金账户隔离、策略模型解耦、风控熔断（最大日损/回撤）与可审计模拟执行。 |
| **Telegram 交互中枢 2.0** | 市场作用域严格隔离（美股/加密/预测/期权）、带签名的安全上下文回调、K 线行情图动态发送、自选股直达与风控确认闭环。 |
| **多市场独立工作区** | 全局极光拟态主题统一控制、访客与管理员权限分级、桌面启动器（`MoneyMoney.exe`）单例防重启动。 |

---

## 4. 数据与运维安全边界

1. **零破坏与最小权限变更**：
   - 本次仅替换 `/opt/moneymoney/dist` 产物，未修改 `/etc/moneymoney/moneymoney.env` 环境变量；
   - 未改动 Nginx 配置、TLS 证书、域名解析、VPN 链路及 Telegram Bot 凭据；
   - 生产 SQLite 数据库（`data/moneymoney.sqlite`、`data/research.db`）、时序数据湖 Parquet 分区及用户自选数据完好保留；
   - 部署临时上传文件已及时清理，远端保留完整的 `backups/` 与 `dist.rollback-88aa61e-20261007-0435` 备份以备应急。
