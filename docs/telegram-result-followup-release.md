# Telegram 结果跟踪与移动操作：本批交付

## 已接线

- 原机器人的倒计时保留，事件结束后继续查询结果；跨天后从 SQLite 恢复跟踪。
- 首次观察已经带实际值的近期事件也会通知。结果投递失败指数退避重试最多七次，重启后保留去重状态。
- 缺少实际值超过十五分钟通知真实原因，后续取得已核验结果可继续推送。暂停不消耗投递重试次数。
- BLS 非农、失业率、CPI 和核心 CPI 只采用同发布日期、同国家、同指标原文；未匹配不得使用上一期。
- `/eventresults` 查看本聊天结果投递记录；`/daily` 共用本聊天自选变化摘要。
- `/chart <代码>` 对已接入股票日线、Binance 小时线发送真实 OHLC PNG 和均线数值；异常数据不绘图，上传失败提供文字原因。
- `/actioncenter` 已读、置顶、明天处理按钮使用短签名、聊天绑定、市场校验、一次性消费及过期时间，复用网页处理状态。
- `/tasks <任务ID>` 的进度、证据包、取消和恢复按钮复用现有任务状态。
- `/contracts` 接入只读永续与交割研究服务；`/guru <股票>` 显示已披露 13F 报告期、申报日、可比变化和 SEC 原文，加入自选后纳入已有摘要。
- 时间线空状态保留来源状态与原因，拒绝当前市场之外的标的。

## 明确未完成的覆盖

免费周日历没有实际值字段，财报日历当前也没有实际值。GDP、财报和未接入结果适配器的其他事件仍显示结果来源不可用，不假称获取结果。BLS 被拒绝访问时同样明确说明。

九项扩充还需要后续批次：图片周期/日期按钮与形态标注、完整会话式组合提醒、可配置盘前/盘后摘要、单独机构订阅、任务文件直接传输、投递人工重试/ACK，以及逐命令真实 Telegram 交互验收。本批不能替代上述全部完成。

## 验证与保护

原工作区首页和浏览器脚本存在用户改动，保留不提交。验证构建使用隔离目录、已提交首页及本批修改；不拷贝密钥和用户数据库。研究数据、数据湖和 scratch 保留。

`telegram-release-smoke.cjs` 默认仅检查真实 K 线与配置；明确传入 `--send` 才向配置中的私聊管理员发送真实数据图片和说明。它不启动轮询、不创建事件、不创建订单。

上线须核对测试、构建、Web/认证/四市场 Chromium 冒烟、安全扫描、构建版本、产物 Hash、正式域名及备份回滚路径。Telegram API 接受图片和消息不等于用户已经点击所有按钮，也不等于所有宏观事件结果源覆盖完成。

## 2026-10-09 结果时间核验补充

- funding/research/prediction 等类型化结果只有在来源提供可解析、且不早于事件时间、不晚于检查时刻的发布时间后才会标成“已发布”；缺失或无效时间继续待核验，不展示实际值。预测结算会从官方结算时间、裁定时间中选取符合事件时间边界的证据时间。
- 持久化的损坏事件日期现在生成明确“无法核验”终态，不调用来源、不被历史清理静默丢弃。
- 验证：`npm test` 1017/1017；build、`smoke:web`、`smoke:auth`、`smoke:browser`、`smoke:contracts`、`smoke:automatic-comparison`、`smoke:live-kline`、security scan、`git diff --check` 均通过。生产私有图表 canary 报告 `businessWrites=0`、`modelCalls=0`、自动对照关闭；独立 AI 跑单配置与状态未变。
- 代码提交：`d6863c611c24a227ad0604063d227f2f4ded239d`；发布标记：`telegram-result-d6863c6-20261009-0137`。
- dist 包 SHA-256：`c06dcbde7f5542a54b0424f3906877a01220b012acb9b47623ccffedf78e3b4a`；server SHA-256：`85a1421abae03514aa8359a00c2b2d759ef077ff3585e0396cb8e11db315b268`；index SHA-256：`d29dfd84c352c0244a55b27bfbbca1b270a99cc233df980785bc2c855398baff`。
- VPS 备份：`/opt/moneymoney/backups/dist-pre-telegram-result-d6863c6-20261009-0137`；回滚目录：`/opt/moneymoney/dist.rollback-telegram-result-d6863c6-20261009-0137`；`moneymoney.service` active，正式域名版本与构建提交一致。
- 该 VPS 未安装 `/opt/moneymoney/scripts/deploy-vps-dist.sh`；发布时通过 SSH 上传版本唯一的 `/tmp/deploy-vps-dist-telegram-result-d6863c6-20261009-0137.sh`，核对脚本 Hash 后执行 CRLF 规范化的 stdin 脚本。以后部署前仍应检查安装状态，不覆盖远端临时文件。
