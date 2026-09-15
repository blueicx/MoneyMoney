# Telegram 市场作用域实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 让 Telegram 机器人按聊天独立保存当前市场，并使菜单、搜索、行情、风险、自选、信号和模拟盘入口严格继承该市场。

**架构：** 在现有 `TelegramCommandCenterStore` 中保存每个聊天的 `activeMarketScope`；`telegram-menu.ts` 根据作用域生成市场栏和功能栏；`server.ts` 在命令、文本菜单和回调入口统一解析/校验作用域，再调用已有按市场过滤的数据服务。旧命令继续兼容，未选择市场时使用总体市场。

**技术栈：** TypeScript、Node.js 原生测试、现有 Telegram Bot API 轮询与内联/回复键盘、SQLite/JSON 状态存储。

---

### 任务 1：建立作用域状态和菜单行为测试

**文件：**
- 修改：`tests/telegram-menu-pagination.test.cjs`
- 创建：`tests/telegram-market-scope.test.cjs`

- [ ] **步骤 1：编写失败测试**

添加以下行为断言：

```js
test('chat market scope is isolated and defaults to overview', () => {
  const chatA = `scope-a-${Date.now()}`;
  const chatB = `scope-b-${Date.now()}`;
  assert.equal(store.getActiveMarketScope(chatA), 'overview');
  assert.equal(store.setActiveMarketScope(chatA, 'stocks'), 'stocks');
  assert.equal(store.getActiveMarketScope(chatA), 'stocks');
  assert.equal(store.getActiveMarketScope(chatB), 'overview');
  assert.equal(store.setActiveMarketScope(chatA, 'invalid'), 'overview');
});

test('market menu contains selected scope and only its feature labels', () => {
  const menu = buildTelegramBottomMenu(`menu-${Date.now()}`, 'stocks');
  const labels = menu.keyboard.flat().map(button => button.text);
  assert.ok(labels.includes('📈 股票'));
  assert.ok(labels.includes('🌡️ 市场宽度'));
  assert.ok(labels.includes('🧑‍💼 内部人'));
  assert.ok(!labels.includes('🌐 预测雷达'));
});
```

测试通过依赖 `store` 和 `buildTelegramBottomMenu` 的新作用域接口；测试文件使用临时 state 文件，不能修改生产数据。

- [ ] **步骤 2：运行测试确认失败**

运行：`npm run build; node --test tests/telegram-market-scope.test.cjs`

预期：FAIL，提示 `getActiveMarketScope` 或带作用域的菜单接口不存在。

- [ ] **步骤 3：提交测试基线**

```powershell
git add tests/telegram-menu-pagination.test.cjs tests/telegram-market-scope.test.cjs
git commit -m "test: 添加 Telegram 市场作用域验收"
```

### 任务 2：实现每聊天作用域状态和动态菜单

**文件：**
- 修改：`src/features/telegram-command-center.ts`
- 修改：`src/web/telegram-menu.ts`
- 修改：`src/features/telegram-bot.ts`
- 测试：`tests/telegram-market-scope.test.cjs`

- [ ] **步骤 1：扩展状态接口**

在状态中加入 `activeMarketScopes: Record<string, MarketScope>`，读取旧版本状态时使用空对象；新增：

```ts
getActiveMarketScope(chatId: string): MarketScope;
setActiveMarketScope(chatId: string, scope: string): MarketScope;
```

无效值和空值统一回退 `overview`，写入时调用现有 `save()`，不改变已有自选、提醒和日志字段。

- [ ] **步骤 2：按作用域生成菜单**

将 `buildTelegramBottomMenu(chatId, scope = 'overview')` 改为生成：第一组固定市场切换按钮；后续页面使用当前作用域的功能表。每个市场只包含其规格中声明的功能，公共功能只在 `overview` 或作用域允许时出现。分页仍限制为每页最多 4 行，保留既有页码按钮和聊天独立分页状态。

- [ ] **步骤 3：让回复键盘读取当前作用域**

给 `TelegramInteractionBotOptions` 增加可选 `menuScope?: (chatId: string) => string`，`sendReply()` 中用该函数读取作用域并调用 `buildTelegramBottomMenu(chatId, scope)`；未提供时继续使用 `overview`，保持单元测试兼容。

- [ ] **步骤 4：运行绿灯测试**

运行：`npm run build; node --test tests/telegram-market-scope.test.cjs tests/telegram-menu-pagination.test.cjs tests/telegram-bot.test.cjs`

预期：所有 Telegram 状态、分页、回复键盘测试通过。

- [ ] **步骤 5：提交任务 2**

```powershell
git add src/features/telegram-command-center.ts src/web/telegram-menu.ts src/features/telegram-bot.ts tests/telegram-market-scope.test.cjs tests/telegram-menu-pagination.test.cjs
git commit -m "feat: 添加 Telegram 聊天市场状态和动态菜单"
```

### 任务 3：接入市场切换、命令继承和作用域回调

**文件：**
- 修改：`src/web/server.ts`
- 修改：`src/web/telegram-menu.ts`
- 测试：`tests/telegram-market-scope.test.cjs`、`tests/telegram-search-actions.test.cjs`

- [ ] **步骤 1：测试切换和搜索隔离**

增加真实 handler 测试：市场按钮将聊天状态写入 `stocks`；同一聊天的 `/search` 结果只保留股票；切到 `crypto` 后不出现股票；不同聊天仍保留各自作用域。增加非法作用域回调返回错误而不执行市场操作的断言。

- [ ] **步骤 2：实现市场切换命令**

新增 `market:<scope>` 文本/回调处理，使用 `telegramCommandCenterStore.setActiveMarketScope()`，重置该聊天菜单页为 1，并返回“已切换到 X 市场”及新的动态键盘。市场栏按钮文本映射必须由同一份 `MARKET_SCOPES` 派生，避免重复枚举。

- [ ] **步骤 3：统一解析当前作用域**

新增服务端辅助函数：

```ts
function telegramScopeForChat(chatId: string): MarketScope;
function telegramScopeFromArgs(chatId: string, args: string[]): { scope: MarketScope; args: string[] };
function telegramScopeHeader(scope: MarketScope): string;
```

支持 `/search stocks AAPL` 这类显式作用域；无显式作用域时读取聊天状态。非法作用域不执行搜索，返回明确错误和菜单入口。

- [ ] **步骤 4：让搜索、详情和回调传递作用域**

股票、期权、虚拟币和预测市场结果必须分别通过已有统一标的类型过滤；预测雷达只在 `prediction`/`overview` 查询。所有动态按钮回调带 `scope` 前缀，处理时校验标的类型与 scope 一致；不一致返回“标的与当前市场不匹配”。

- [ ] **步骤 5：运行绿灯测试**

运行：`npm run build; node --test tests/telegram-market-scope.test.cjs tests/telegram-search-actions.test.cjs tests/telegram-detail.test.cjs tests/telegram-watchlist.test.cjs`

预期：市场切换、搜索、详情、自选按钮均不跨市场。

- [ ] **步骤 6：提交任务 3**

```powershell
git add src/web/server.ts src/web/telegram-menu.ts tests/telegram-market-scope.test.cjs tests/telegram-search-actions.test.cjs
git commit -m "feat: 隔离 Telegram 市场搜索和回调"
```

### 任务 4：隔离 TG 风险、信号、自选、模拟盘和通知

**文件：**
- 修改：`src/web/server.ts`
- 修改：`src/features/telegram-command-center.ts`
- 测试：`tests/telegram-market-scope.test.cjs`、`tests/telegram-portfolio.test.cjs`、`tests/telegram-ai-runner.test.cjs`

- [ ] **步骤 1：先补命令输出测试**

断言 `/risk`、`/signals`、`/watchlist`、`/portfolio` 在股票 scope 下不包含预测雷达字段；预测 scope 仍能看到预测雷达/校准相关内容；自选列表只返回当前 scope 的标的。

- [ ] **步骤 2：实现命令级过滤**

为 `telegramActions()`、`formatTelegramWatchlist()`、`formatTelegramPortfolio()`、风险与历史处理器加入 scope 参数，复用 `filterAssistantReport`、`filterRiskOverview`、`filterUnifiedPaperLedger` 和统一标的类型映射，不复制过滤规则。

- [ ] **步骤 3：限制写操作**

模拟开仓、平仓、重置以及 `watch:add/remove` 回调校验当前聊天 scope。预测模拟盘保持兼容；股票、期权、虚拟币暂不伪造预测订单，返回明确“不支持该市场模拟下单”的提示。所有确认码仍绑定 chatId。

- [ ] **步骤 4：隔离后台通知**

后台信号、风险、摘要和价格提醒读取聊天 scope；价格提醒按标的类型选择对应行情源，禁止用 Binance 价格检查股票或预测标的。通知文本带市场标题，失败时只发送当前 scope 的降级信息。

- [ ] **步骤 5：运行绿灯测试**

运行：`npm run build; node --test tests/telegram-market-scope.test.cjs tests/telegram-portfolio.test.cjs tests/telegram-ai-runner.test.cjs tests/telegram-timeline.test.cjs`

预期：命令输出和后台通知均保持市场隔离，既有预测模拟盘流程通过。

- [ ] **步骤 6：提交任务 4**

```powershell
git add src/web/server.ts src/features/telegram-command-center.ts tests/telegram-market-scope.test.cjs tests/telegram-portfolio.test.cjs tests/telegram-ai-runner.test.cjs
git commit -m "feat: 隔离 Telegram 风险持仓和通知"
```

### 任务 5：全量验证、审查和发布

**文件：**
- 修改：仅在测试发现问题时修改前述文件
- 验证：`package.json` 脚本、VPS `moneymoney.service`

- [ ] **步骤 1：运行完整验证**

运行：

```powershell
npm run build
npm test
npm run security:scan
git diff --check
```

预期：构建成功，所有测试通过，安全扫描通过，差异检查无错误。

- [ ] **步骤 2：审查变更边界**

检查 `git diff HEAD~4..HEAD --stat` 和 `git status --short`，确认没有凭据、运行时数据库、`dist` 以外的发布文件或无关工作树变更；保留现有未跟踪文档，不将其误加入功能提交。

- [ ] **步骤 3：构建并推送 GitHub**

将最终 `dist` 打包，推送当前 `codex/stock-free-data-sources` 分支；若 Git LFS pre-push 在无 LFS 文件时因远端协议阻塞，使用 `git push --no-verify`，再用 `git ls-remote` 核验远端提交哈希。

- [ ] **步骤 4：部署 VPS**

只上传最终 `dist` tarball；将 `/opt/moneymoney/dist` 移至带提交号的 `/opt/moneymoney/backups/`，解包新产物，保持 `moneymoney:moneymoney` 权限，重启 `moneymoney.service`，检查 `systemctl is-active`、`http://127.0.0.1:3001/api/health` 和本地/远端文件哈希。

- [ ] **步骤 5：浏览器验收**

在已认证线上页面确认网页端仍正常；Telegram 端若受既有 polling 冲突影响，使用 handler/transport 测试验证逻辑，并单独报告无法进行真实聊天点击的边界，不把 `configured=true` 当作消息投递证明。

- [ ] **步骤 6：提交发布记录**

```powershell
git status --short --branch
git log -5 --oneline
```

记录 GitHub 提交、VPS 服务状态、健康响应、备份目录和 Telegram 轮询冲突（若仍存在）。
