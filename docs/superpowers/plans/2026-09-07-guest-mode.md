# MoneyMoney 访客只读模式实现计划

> 面向 AI 代理的工作者：必需子技能：使用 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框语法跟踪进度。

**目标：** 为现有登录门禁增加签名访客入口，并让访客只能浏览公开市场数据。

**架构：** 在现有 HMAC 登录令牌中增加 role 字段，访客通过 POST /api/auth/guest 获得 2 小时只读令牌。统一认证中间件验证令牌后，对 guest 角色执行明确的 GET allowlist；管理员保持原行为。登录页和首页读取角色并显示只读状态。

**技术栈：** TypeScript、Express、Node node:test、静态 HTML/JavaScript。

---

### 任务 1：认证令牌和访客签发接口

**文件：**
- 修改：E:/MYC/predict-fun-trader/src/web/auth.ts
- 修改：E:/MYC/predict-fun-trader/src/web/server.ts
- 测试：E:/MYC/predict-fun-trader/tests/auth.test.cjs

- [ ] 编写失败测试：断言 createLoginToken('guest', 'guest', 60000) 验证后包含 role=guest，历史无 role 令牌按 admin 兼容。
- [ ] 运行 npm run build; node --test tests/auth.test.cjs，预期因函数尚不接受角色参数而失败。
- [ ] 实现 AuthPayload.role、可选 expiryMs 和 POST /api/auth/guest；guest 有效期固定 2 小时，使用现有 Cookie。
- [ ] 重新运行测试，确认 guest 与管理员认证均通过。
- [ ] 提交：git add src/web/auth.ts src/web/server.ts tests/auth.test.cjs; git commit -m "feat: add signed guest login token"

### 任务 2：服务端只读权限

**文件：**
- 修改：E:/MYC/predict-fun-trader/src/web/auth.ts
- 修改：E:/MYC/predict-fun-trader/src/web/server.ts
- 测试：E:/MYC/predict-fun-trader/tests/auth.test.cjs

- [ ] 编写失败测试：公开行情 GET 允许，任意 POST 及 settings、secrets、telegram、wallet、paper、trade、orders、automation、research 的 GET 拒绝。
- [ ] 运行认证测试，预期因 isGuestRequestAllowed 未实现而失败。
- [ ] 实现显式公开 GET allowlist；guest 对非 allowlist 或非 GET 返回 HTTP 403、code=GUEST_READ_ONLY；健康检查和管理员路径保持不变。
- [ ] 运行认证测试和现有全量测试，确认管理员不回归。
- [ ] 提交：git add src/web/auth.ts src/web/server.ts tests/auth.test.cjs; git commit -m "feat: enforce guest read-only API access"

### 任务 3：登录页和访客状态界面

**文件：**
- 修改：E:/MYC/predict-fun-trader/src/web/public/login.html
- 修改：E:/MYC/predict-fun-trader/src/web/public/index.html
- 测试：E:/MYC/predict-fun-trader/tests/login-gate-wiring.test.cjs

- [ ] 编写失败测试：断言 login.html 调用 /api/auth/guest、包含访客入口，index.html 包含访客只读状态。
- [ ] 运行 npm run build; node --test tests/login-gate-wiring.test.cjs，预期因页面尚无入口而失败。
- [ ] 登录页添加访客进入按钮，保存服务端 Cookie 并按 next 跳转；首页读取 role=guest，显示只读横幅并隐藏设置、Telegram、交易和自动化入口。
- [ ] 运行前端 wiring 测试和构建，确认页面资源正常。
- [ ] 提交：git add src/web/public/login.html src/web/public/index.html tests/login-gate-wiring.test.cjs; git commit -m "feat: add guest mode login entry"

### 任务 4：全量验证、部署和交接

**文件：**
- 修改：E:/MYC/predict-fun-trader/docs/handover-2026-09-02.md
- 验证：E:/MYC/predict-fun-trader/dist

- [ ] 运行 npm run build; npm test; git diff --check，预期构建成功、测试全绿、无 diff 错误。
- [ ] 将 dist 部署到 /opt/moneymoney/dist，保留旧版本备份，只重启 moneymoney.service，不修改 Nginx、证书或 Xray/VPN。
- [ ] 验证域名 HTTPS、访客签发、公开行情 GET、敏感 GET/写请求 403，以及管理员登录。
- [ ] 更新交接文档，记录 guest 角色、2 小时有效期、allowlist 和验收结果，不写入凭据。
- [ ] 提交：git add docs/handover-2026-09-02.md; git commit -m "docs: record guest read-only mode"

## 计划自检

- [ ] 规格中的入口、令牌、权限边界、前端状态、兼容性、测试和部署验收均有对应任务。
- [ ] 未新增数据库表，不改变管理员令牌和 LAN 访问控制。
- [ ] 每个行为均按失败测试、最少实现、通过验证的顺序执行。
