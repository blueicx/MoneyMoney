# Telegram 底部菜单分页实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将 Telegram 底部功能键盘改为每页最多 4 行，并为每个聊天提供独立的上一页/下一页导航。

**架构：** 新增纯函数和轻量内存状态模块负责菜单页定义、页码钳制和按聊天读取/更新页码。`src/web/server.ts` 负责把现有功能处理器接到分页键盘，并把当前聊天 ID 传入所有底部键盘回复。Bot 轮询、命令名称、业务处理和 VPN 不变。

**技术栈：** TypeScript、Node.js `node:test`、现有 Telegram reply keyboard 类型、systemd/SSH 部署。

---

## 文件清单

- 创建：`src/web/telegram-menu.ts`——分页菜单定义、页码状态和键盘生成。
- 修改：`src/web/server.ts`——使用分页键盘、注册导航文本处理器、将聊天 ID 传给回复。
- 修改：`src/features/telegram-bot.ts`——支持在发送回复时按聊天 ID生成动态底部键盘，避免遗漏异步通知路径。
- 创建：`tests/telegram-menu-pagination.test.cjs`——验证分页器真实输出、边界和聊天隔离。
- 创建：`tests/telegram-menu-wiring.test.cjs`——验证服务端保留现有菜单命令并接入导航与动态键盘。
- 修改：`docs/handover-2026-09-02.md`——追加分页部署和回滚说明，不写敏感值。

### 任务 1：为分页器编写失败测试

**文件：**
- 创建：`tests/telegram-menu-pagination.test.cjs`
- 创建：`tests/telegram-menu-wiring.test.cjs`

- [ ] **步骤 1：编写测试**

测试从 `../dist/web/telegram-menu` 加载真实构建模块，断言：默认页为 1；三页均存在；功能行最多 4 行；第一页上一页和最后一页下一页不会越界；两个聊天的页码互不影响；服务端源码包含两个导航文本和动态菜单接入点。

- [ ] **步骤 2：运行测试确认失败**

运行：`node --test tests/telegram-menu-pagination.test.cjs tests/telegram-menu-wiring.test.cjs`

预期：失败，因为 `dist/web/telegram-menu.js` 尚不存在，且服务端尚未注册分页导航。

### 任务 2：实现纯分页菜单模块

**文件：**
- 创建：`src/web/telegram-menu.ts`

- [ ] **步骤 1：实现最小分页模块**

导出 `TELEGRAM_MENU_PAGE_COUNT`、`getTelegramMenuPage(chatId)`、`setTelegramMenuPage(chatId, page)`、`moveTelegramMenuPage(chatId, delta)` 和 `buildTelegramBottomMenu(chatId)`。页码状态使用模块级 `Map<string, number>`，所有输入经过 1 到 3 钳制；生成的键盘包含最多 4 行功能键和 1 行导航键，导航文字固定为 `⬅ 上一页`、`菜单 X/3`、`下一页 ➡`。

- [ ] **步骤 2：构建并运行分页测试**

运行：`npm run build; node --test tests/telegram-menu-pagination.test.cjs`

预期：分页模块测试通过；服务端 wiring 测试仍失败，说明纯分页器已完成但尚未接入 Bot。

- [ ] **步骤 3：Commit**

运行：`git add src/web/telegram-menu.ts tests/telegram-menu-pagination.test.cjs tests/telegram-menu-wiring.test.cjs; git commit -m "feat: add Telegram menu pager"`

### 任务 3：接入 Bot 回复和导航

**文件：**
- 修改：`src/features/telegram-bot.ts`
- 修改：`src/web/server.ts`

- [ ] **步骤 1：在 Bot 发送边界解析动态菜单**

在 `TelegramReply` 增加内部 `replyKeyboard?: 'menu'` 标记；`sendReply(chatId, reply)` 发现该标记时调用菜单生成器并只把生成后的 Telegram markup 传给 transport。普通字符串和内联键盘路径保持原样。

- [ ] **步骤 2：将底部菜单回复改为动态标记**

将 `telegramReply(text)` 改为返回 `{ text, replyKeyboard: 'menu' }`，删除静态 `TELEGRAM_BOTTOM_MENU` 的直接发送。所有通过 `telegramReply` 的命令、回调、提醒和摘要消息都由 Bot 的 `chatId` 自动获得当前页。

- [ ] **步骤 3：注册导航按钮**

把 `⬅ 上一页` 和 `下一页 ➡` 加入 `TELEGRAM_MENU_COMMANDS`，对应处理器只调用 `moveTelegramMenuPage(chatId, -1/+1)` 后返回简短确认文本和新键盘；`菜单 X/3` 使用无业务动作的处理器返回当前页键盘。导航不写数据库、不触发 Telegram 外部 API 以外的业务动作。

- [ ] **步骤 4：运行 wiring 测试和 TypeScript 构建**

运行：`npm run build; node --test tests/telegram-menu-pagination.test.cjs tests/telegram-menu-wiring.test.cjs`

预期：两个分页测试通过，构建无 TypeScript 错误。

- [ ] **步骤 5：Commit**

运行：`git add src/features/telegram-bot.ts src/web/server.ts dist tests; git commit -m "feat: paginate Telegram bottom keyboard"`

### 任务 4：完整验证并更新交接

**文件：**
- 修改：`docs/handover-2026-09-02.md`

- [ ] **步骤 1：运行完整验证**

运行：`npm test; npm run build; npm run security:scan; git diff --check`

预期：所有测试通过，构建成功，Secret scan 通过，无 diff whitespace 错误。

- [ ] **步骤 2：追加交接说明**

记录每页 4 行、页码按聊天隔离、重启回到第 1 页、导航按钮不触发业务动作，以及部署回滚方式；不写 Token、密码、Cookie、私钥、UUID 或完整节点 URI。

- [ ] **步骤 3：Commit**

运行：`git add docs/handover-2026-09-02.md; git commit -m "docs: record Telegram menu pagination"`

### 任务 5：部署并做运行验证

**文件：**
- 远端：`/opt/moneymoney/dist`
- 远端：`moneymoney.service`

- [ ] **步骤 1：部署构建产物**

仅上传新的 `dist` 到 VPS 临时目录，停止 `moneymoney.service`，保留带时间戳的旧 `dist` 备份，替换并恢复 `moneymoney:moneymoney` 属主后启动服务；不修改 `/etc/moneymoney/moneymoney.env`。

- [ ] **步骤 2：验证运行边界**

确认 `moneymoney.service` active、`/api/health` 成功、`/api/auth/status` 保持非默认配置且未登录为 false；确认 Nginx、Xray 8443 和 443 端口不因本次部署改变。

- [ ] **步骤 3：验证实际 Telegram 菜单**

在允许的 Telegram 聊天中发送 `/start` 或点击菜单，确认第一页不超过 4 行；点击下一页和上一页确认页码变化；确认两个异步回复仍能收到当前聊天的键盘。若需要用户点击，向用户只给一个简短动作。

- [ ] **步骤 4：Commit/交接**

保留远端旧 dist 备份和部署时间；报告实际版本、测试结果、服务状态和用户可操作入口。
