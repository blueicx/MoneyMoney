# 管理单标的普通通知

网页和管理员Telegram共用SQLite静默策略；不暂停扫描、策略或账户，不改变AI配置。风险、数据源故障和模拟成交不受此策略影响。只涵盖现有网页/TG通知链，不声称新增Webhook渠道支持。

## 操作

先选具体市场，再打开网页“提醒”，填写完整身份及分钟，点击静默；已有记录可恢复。控件沿用三个主题、支持手机。旧裸代码不猜交易场所，输入框不会用它自动生成身份。

管理员私聊示例（当前须为股票市场）：

```text
/alerts mute stock:us:AAPL 60
/alerts mutes
/alerts unmute stock:us:AAPL
```

网页与所有已配置管理员私聊共用策略，不是各聊天独立静默。普通非管理员私聊不能改此状态。

## API与状态

|接口|参数|边界|
|---|---|---|
|GET /api/alerts/instrument-silences|market可选|管理员；返回当前策略及最近200条操作|
|POST /api/alerts/instrument-silences|market、instrument、until|管理员+现有CSRF；until为未来30天内ISO时间，null恢复|

策略通过现有state_documents保存，事务内读改写，跨实例读取最新值；最多500条有效策略，过期条目不永久占满容量。旧业务记录和未跟踪research.db不迁移、不删除。

股票信号outbox保存逐项身份，发送前只过滤已静默条目，不消耗重试次数；全部静默时保留排队，过期仍拒绝发送。旧排队消息缺少身份时，股票存在静默策略就暂缓，避免猜测消息归属。通用投递重试不允许绕过股票outbox的过期/静默检查；股票自动重试用尽后可重新扫描，不直接发送旧文本。

旧助手信号找不到唯一自选身份时，当前市场存在静默策略就暂缓该未关联信号。手动查询仍可见；不从标题判断身份。宏观实际结果、任务状态和来源故障不伪装成某只股票而屏蔽。

## 工作区声明

现有工作区统一声明contentOwner、主要readEndpoints、市场、上下文要求、权限及按需模块。服务端导航和构建加载器共用声明；声明不自动发请求，不替代服务端权限校验。自选、持仓、模拟账户、行动中心及实验入口对应私有权限。

## 证据与验证

- E1：新增静默、重启读取、到期、错市场、风险穿透、容量恢复回归；先验证失败，再实现。范围规则曾复现首项静默导致MSFT被漏掉，现选择未静默候选并保存真实触发身份。
- E2：outbox回归证明被暂缓时次数仍为0，部分过滤后只发送剩余条目；既有去重、退避和ACK保持。
- E3：隔离Chromium验证1440/390宽度与light/dark/money三主题的实际静默/恢复、错误市场400、访客读取/修改403。没有模型调用、生产测试订单或测试Telegram消息。
- E4：冻结代码283个隔离文件、1446项、0失败；构建、Web/认证/浏览器/实时K线/合约冒烟与差异检查通过。早期一次认证测试在构建/测试并行期间保存等待超时；独立及最终冻结重跑通过，未用加长等待掩盖问题。

复现：先`npm run build`，再`node --test tests/instrument-silence.test.cjs tests/instrument-silence-ui.test.cjs tests/telegram-signal-outbox.test.cjs tests/workspace-asset-contracts.test.cjs`和`npm run smoke:auth`。后者仅隔离本地目标执行写入，外部目标不执行静默测试。

调用路径：明确身份与管理员确认 → SQLite事务 → 普通通知匹配/预览门控 → 投递前复核；图表、证据、策略与模拟账户不使用此门控。合约资金账单和交易所级保证金参数仍缺少可核验来源，不生成伪数据。

最终性能与正式域名发布结果见下方实测记录。

## 最终冻结门槛

- 全量1446项/283个文件，构建、Web/认证/浏览器/实时K线/合约冒烟与差异检查通过，安全扫描761个跟踪文件通过。日志以`mm-silence-release-`为前缀；首次并行构建期间的认证超时没有作为通过证据。
- 同环境3次冷热、4倍CPU限速、80ms延迟、750KB/s：桌面冷页面2215.3ms/图表2914.1ms、热477.2ms/701.7ms；手机冷1875.6ms/2886.6ms、热457.5ms/755.5ms。热脚本0字节，原冷加载20%改善目标仍达成；不承诺生产网络等比例提速。
- research.db保留且未跟踪，Hash仍为27fd475e523568daa4cdcabf3146917023335a62affe00429babd721b3b79fd1。发布前VPS旧版本243cc1b，服务active，根盘18GB可用。最终新版本/Hash/回滚目录待实际发布核验。

## 已发布 955e846

- 代码955e84682e4f814a4a9f151844fd7b992cf3b45d已提交推送。VPS及正式域名版本一致，moneymoney.service active；股票/期权/虚拟币/预测市场/SNDK只读Chromium通过，日志`mm-silence-production-955e846.log`。没有向生产发测试消息、调用模型或提交测试订单。
- archive SHA a37b614fa0ff4090e72a4ffe9eeba20befdba64f4481faff9f8f949c4bba5b94；server SHA 4995a28fc8814a70eeb2341cc0392bb569ecb4685a801da9e86b8eee559b1089；index SHA eb4005200fe670c7d346c61d3652fff15f6b6307f317ec310c1294fae638a12e；manifest SHA bee18c902db90ad0eb45844081855ee59cec63400f28dc0e693c770b3b41736e，远端实测一致。
- 备份`/opt/moneymoney/backups/dist-pre-955e846-20261014-silence`，回滚`/opt/moneymoney/dist.rollback-955e846-20261014-silence`保留243cc1b。仅dist切换并重启moneymoney.service，没有改变现有AI配置或替换数据库/数据湖；服务正常运行时的采集写入不在此“未替换”声明内。
- 旧版回滚不识别新增静默策略；如后续人工回滚，应重新核对通知暂停设置，不能假定旧版仍执行此新门控。新增状态仍留在SQLite，不删除。
