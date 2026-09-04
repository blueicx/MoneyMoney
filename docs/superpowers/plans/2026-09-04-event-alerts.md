# 高影响事件提醒与结果通知实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将高影响事件提醒改为 24h/12h/6h/3h/1h/30m/10m/5m 节点，并在实际值首次公布后发送一次包含利好/利空判断的结果通知。

**架构：** 在独立的事件提醒模块中放置倒计时阶段、数值比较和方向判定纯函数；Telegram 监控层每 60 秒拉取事件日历并按聊天保存运行期阶段状态。服务启动时以当前阶段建立基线，不补发旧节点或已存在的结果；事件数据源失败时保持静默并等待下一轮。

**技术栈：** TypeScript、Node.js `node:test`、现有 Telegram command center、现有 `getUpcomingEventCalendar` 和 systemd 部署。

---

## 文件清单

- 创建：`src/features/event-alerts.ts` — 倒计时阶段、事件结果比较、方向判定和通知文案所需的纯函数。
- 创建：`tests/event-alerts.test.cjs` — 纯函数的失败优先测试。
- 修改：`src/web/server.ts:3060-3210` — 拆出高影响事件 60 秒监控，接入节点去重和结果通知，移除旧的“24 小时内一次”事件推送。
- 修改：`src/web/server.ts:3280-3310` — 在 Telegram monitor 启动和停止处管理新的事件定时器。
- 修改：`docs/handover-2026-09-02.md` — 记录提醒节点和部署验收结果。

### 任务 1：编写倒计时与结果判定失败测试

**文件：**
- 创建：`tests/event-alerts.test.cjs`
- 参考：`tests/event-calendar.test.cjs` 的 CommonJS 测试风格

- [ ] **步骤 1：编写失败测试**

测试必须覆盖以下可观察接口：

```js
const {
  EVENT_REMINDER_THRESHOLDS_MINUTES,
  getReachedEventReminderThreshold,
  decideEventReminder,
  compareEventValues,
  classifyEventResult,
} = require('../dist/features/event-alerts');

assert.deepEqual([...EVENT_REMINDER_THRESHOLDS_MINUTES], [1440, 720, 360, 180, 60, 30, 10, 5]);
assert.equal(getReachedEventReminderThreshold(800), 1440);
assert.equal(getReachedEventReminderThreshold(700), 720);
assert.equal(getReachedEventReminderThreshold(9), 10);
assert.equal(getReachedEventReminderThreshold(4), 5);
assert.equal(getReachedEventReminderThreshold(1500), null);

assert.deepEqual(decideEventReminder(700, null, false), { stage: 720, shouldSend: false });
assert.deepEqual(decideEventReminder(350, 720, true), { stage: 360, shouldSend: true });
assert.deepEqual(decideEventReminder(4, 720, true), { stage: 5, shouldSend: true });
assert.deepEqual(decideEventReminder(-1, 5, true), { stage: null, shouldSend: false });

assert.equal(compareEventValues('3.2%', '3.0%'), 'above');
assert.equal(compareEventValues('2.9%', '3.0%'), 'below');
assert.equal(compareEventValues('3.0%', '3.0%'), 'inline');
assert.equal(compareEventValues('N/A', '3.0%'), 'unknown');
assert.equal(classifyEventResult('CPI m/m', 'above'), 'bearish');
assert.equal(classifyEventResult('Non-Farm Employment Change', 'above'), 'bullish');
assert.equal(classifyEventResult('Unknown Indicator', 'above'), 'neutral');
```

- [ ] **步骤 2：运行测试确认红灯**

运行：`node --test tests/event-alerts.test.cjs`

预期：FAIL，原因是 `../dist/features/event-alerts` 尚不存在；不得先创建实现文件来绕过该失败。

- [ ] **步骤 3：Commit 测试**

```bash
git add tests/event-alerts.test.cjs
git commit -m "test: define event alert thresholds and result direction"
```

### 任务 2：实现事件提醒纯函数

**文件：**
- 创建：`src/features/event-alerts.ts`
- 测试：`tests/event-alerts.test.cjs`

- [ ] **步骤 1：实现固定节点和阶段选择**

实现以下接口，节点保持降序，阶段表示“最近已经到达的节点”：

```ts
export const EVENT_REMINDER_THRESHOLDS_MINUTES = [1440, 720, 360, 180, 60, 30, 10, 5] as const;
export type EventReminderThreshold = typeof EVENT_REMINDER_THRESHOLDS_MINUTES[number];
export type EventResultComparison = 'above' | 'below' | 'inline' | 'unknown';
export type EventResultDirection = 'bullish' | 'bearish' | 'neutral';

export function getReachedEventReminderThreshold(minutesUntil: number): EventReminderThreshold | null;
export function decideEventReminder(minutesUntil: number, previousStage: EventReminderThreshold | null, initialized: boolean): {
  stage: EventReminderThreshold | null;
  shouldSend: boolean;
};
```

`decideEventReminder` 首次观察只返回当前阶段且 `shouldSend:false`；运行中阶段从较大节点下降到较小节点时只报告当前节点，因此跨过多个节点不会补发一串提醒。

- [ ] **步骤 2：实现实际值比较和方向判定**

解析带 `%`、逗号和 `K/M/B/T` 后缀的单个数值；无法解析返回 `unknown`。标题关键词使用保守映射：就业/GDP/零售/工业产出/PMI/消费者信心/职位空缺等高于预期为 `bullish`；CPI/PPI/PCE/通胀/失业率/失业金申请等高于预期为 `bearish`；未匹配、缺少预期或“符合预期”返回 `neutral`。

```ts
export function compareEventValues(actual: string | null, forecast: string | null): EventResultComparison;
export function classifyEventResult(title: string, comparison: EventResultComparison): EventResultDirection;
```

- [ ] **步骤 3：运行测试确认绿灯**

运行：`npm run build; node --test tests/event-alerts.test.cjs`

预期：新测试全部 PASS，且 TypeScript 编译退出码为 0。

- [ ] **步骤 4：Commit 纯函数**

```bash
git add src/features/event-alerts.ts tests/event-alerts.test.cjs
git commit -m "feat: add event alert threshold and result helpers"
```

### 任务 3：接入 Telegram 事件监控

**文件：**
- 修改：`src/web/server.ts:3060-3210`
- 修改：`src/web/server.ts:3280-3310`
- 依赖：`src/features/event-alerts.ts`

- [ ] **步骤 1：添加运行期状态和 60 秒定时器**

增加以下状态，不写数据库：

```ts
const telegramEventReminderStages = new Map<string, EventReminderThreshold | null>();
const telegramEventResultStates = new Map<string, boolean>();
const telegramEventResultPushes = new Set<string>();
let telegramEventMonitor: NodeJS.Timeout | null = null;
```

事件键使用 `chatId + ':' + event.date + ':' + event.title`，避免不同聊天互相去重。

- [ ] **步骤 2：实现提醒和结果轮询**

新增 `monitorTelegramEventAlerts()`：

1. 只在至少一个聊天开启 `notifications.events` 时请求 `getUpcomingEventCalendar(2)`。
2. 对 `impact === 'high'` 的事件计算剩余分钟，调用 `decideEventReminder`；首次观察只建立基线。
3. 阶段触发时发送“提前 X 小时/分钟”并在成功调用 `sendToChat` 后更新阶段状态。
4. 对 `actual` 状态首次观察只建立基线；从无实际值变为有实际值时发送实际值、预期值、比较结果和“偏利好/偏利空/方向不明”，成功发送后加入 `telegramEventResultPushes`。
5. 沿用 `telegramAlertSuppressed`、事件偏好和 HTML 转义；拉取或发送异常不打断下一轮。

结果文案格式固定为：

```text
📊 高影响事件结果
事件标题
实际值：... · 预期值：...
结果：高于预期 · 判断：偏利好
```

- [ ] **步骤 3：移除旧事件推送路径**

删除 `monitorTelegramSlowAlerts` 中原有的 `hours >= 0 && hours <= 24 && !telegramEventPushes.has(eventKey)` 逻辑，避免旧的一次性 24 小时提醒与新节点提醒重复；保留慢提醒中的风险、信号和数据源恢复逻辑。

- [ ] **步骤 4：启动和停止新定时器**

在 `startTelegramCommandCenterMonitor()` 中增加：

```ts
if (!telegramEventMonitor) telegramEventMonitor = setInterval(() => {
  void monitorTelegramEventAlerts().catch(() => {});
}, 60_000);
```

在 `stopTelegramCommandCenterMonitor()` 中清理并置空 `telegramEventMonitor`。

- [ ] **步骤 5：运行现有测试和构建**

运行：`npm run build; npm test; git diff --check`

预期：构建退出码 0，全部现有测试和新测试通过，diff 检查无错误。

- [ ] **步骤 6：Commit Telegram 监控**

```bash
git add src/features/event-alerts.ts src/web/server.ts tests/event-alerts.test.cjs
git commit -m "feat: schedule high impact event reminders and results"
```

### 任务 4：部署到 MoneyMoney VPS

**文件/环境：**
- 本地构建输出：`dist/`
- 远端服务：`moneymoney.service`
- 远端目录：`/opt/moneymoney/dist`

- [ ] **步骤 1：构建并记录校验值**

运行：`npm run build; Get-FileHash dist/web/server.js -Algorithm SHA256`

预期：构建退出码 0；不输出任何 Token 或密码。

- [ ] **步骤 2：备份并同步远端 dist**

使用现有 SSH/SCP 部署方式，在 VPS 执行：

```bash
sudo cp -a /opt/moneymoney/dist /opt/moneymoney/dist-backup-YYYYMMDD-event-alerts
```

再将本地 `dist/` 同步为 `/opt/moneymoney/dist`，保留属主和现有环境文件，不改 Nginx、证书、VPN 或端口。

- [ ] **步骤 3：重启并检查服务**

运行：`sudo systemctl restart moneymoney.service; sudo systemctl is-active moneymoney.service`

预期：返回 `active`；Telegram journal 出现新的轮询启动记录。

### 任务 5：部署验收与交接记录

**文件：**
- 修改：`docs/handover-2026-09-02.md`

- [ ] **步骤 1：执行 VPS 脱敏验收**

运行：

```bash
sudo systemctl is-active moneymoney.service
curl -fsS http://127.0.0.1:3001/api/health
sudo ss -ltnp | grep ':3001'
sudo journalctl -u moneymoney.service -n 80 --no-pager | grep -E 'interactive polling started|error|Error' || true
```

预期：服务 active、健康接口 `ok:true`、3001 监听存在；日志不输出 Token、密码或私钥。

- [ ] **步骤 2：做纯函数回归验收**

运行：`npm test; npm run build; git diff --check`

预期：全部测试通过，构建成功，diff 无空白错误。

- [ ] **步骤 3：更新交接文档**

记录：固定 8 个节点、B 重启策略、结果通知比较规则、方向不明兜底、60 秒监控、远端备份目录和服务验收结果；不记录用户聊天内容、Token、密码或其他私密值。

- [ ] **步骤 4：Commit 交接记录**

```bash
git add docs/handover-2026-09-02.md
git commit -m "docs: record event alert deployment"
```

## 计划自检

- 规格中的 8 个提醒节点、重启不补发、跨节点不轰炸、结果通知、实际/预期比较、方向映射、去重、异常处理和测试均有对应任务。
- 已扫描计划内容，没有未完成标记或未定义接口占位符。
- `EventReminderThreshold`、`decideEventReminder`、`compareEventValues`、`classifyEventResult` 的名称和类型在测试、实现、监控任务中一致。
