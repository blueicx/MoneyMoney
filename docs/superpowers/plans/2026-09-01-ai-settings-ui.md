# AI 设置页接入口实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 MoneyMoney 现有设置页中提供两条 OpenAI-compatible AI 链路的 URL 和模型配置，并让修改立即作用于后端，同时不在网页中保存或回显 API Key。

**架构：** API Key 继续只从本机 `.env` 读取；URL 和模型作为非敏感运行时设置保存到现有设置存储。AI 模块每次请求读取当前运行时配置，连接测试只返回成功/失败和模型名称，不返回密钥。

**技术栈：** TypeScript、Express、现有 `SettingsManager`、Node test runner、单文件 HTML 设置页。

---

### 任务 1：配置解析与安全边界测试

**文件：**
- 创建：`tests/ai-runtime-config.test.cjs`
- 创建：`src/features/ai-runtime-config.ts`

- [x] **步骤 1：编写失败的测试**

覆盖默认端点、URL 优先级、模型覆盖、API Key 只暴露 `configured` 状态，以及空值回退。

- [x] **步骤 2：运行测试验证失败**

运行：`npm run build; node --test tests/ai-runtime-config.test.cjs`

预期：因运行时配置模块尚未提供而失败。

- [x] **步骤 3：实现最少配置解析代码**

实现 `getAiRuntimeConfig()`、`getAiConfigurationStatus()` 和 `AiChain` 类型；配置对象包含 `apiKey`、`apiUrl`、`model`，状态对象只包含 `configured`、`apiUrl`、`model`。

- [x] **步骤 4：运行测试验证通过**

运行：`npm run build; node --test tests/ai-runtime-config.test.cjs`

预期：配置解析和密钥不回显测试通过。

### 任务 2：后端 AI 模块改为读取运行时配置

**文件：**
- 修改：`src/features/ai-commentary.ts`
- 修改：`src/features/ai-social.ts`
- 修改：`src/features/news-settings.ts`

- [x] **步骤 1：为设置字段增加默认值和白名单**

新增 `openRouterApiUrl`、`openRouterModel`、`groqApiUrl`、`groqModel`；`SettingsManager.update()` 只接受已知策略字段和这四个非敏感 AI 字段。

- [x] **步骤 2：让两条链路使用当前 URL 和模型**

移除模块级固定 URL/模型读取；每次请求从 `getAiRuntimeConfig()` 读取。API Key 仍来自进程环境变量。

- [x] **步骤 3：运行回归测试**

运行：`npm run build; npm test`

预期：原有测试和 AI 配置测试全部通过。

### 任务 3：增加设置 API 的 AI 状态和连接测试

**文件：**
- 修改：`src/web/server.ts`
- 修改：`src/features/ai-runtime-config.ts`
- 修改：`scripts/web-smoke.cjs`

- [x] **步骤 1：测试状态脱敏和输入限制**

验证 `GET /api/settings` 返回配置状态但没有 `apiKey` 字段，`POST /api/settings` 不会持久化 `openRouterApiKey` 或 `groqApiKey`。

- [x] **步骤 2：实现接口**

让 `/api/settings` 返回 `ai` 状态；新增 `POST /api/ai/test`，只接受 `openrouter` 或 `groq`，使用当前配置发出最小兼容请求，并返回脱敏结果。

- [x] **步骤 3：运行接口和全量测试**

运行：`npm run build; npm test`

预期：接口测试通过，未配置或失败时返回可读错误，不泄露密钥。

### 任务 4：设置页增加两个 AI 配置卡片

**文件：**
- 修改：`src/web/public/index.html`

- [x] **步骤 1：增加 OpenRouter 和 Groq/OpenAI-compatible 表单**

沿用当前玻璃拟态紫色主题，显示 API URL、模型、密钥配置状态、保存按钮和测试连接按钮。

- [x] **步骤 2：处理保存和结果提示**

保存只提交 URL 和模型；连接测试调用 `/api/ai/test`；页面明确提示 API Key 需放在本机 `.env`，不在页面显示。

- [x] **步骤 3：构建并检查页面资产**

运行：`npm run build; npm run smoke:web`

预期：页面资源复制成功，Web smoke 通过，现有主题和其他设置不受影响。

### 任务 5：最终验证与提交

**文件：**
- 修改：`.env.example`
- 修改：`README.md`
- 修改：`docs/telegram-setup.md`

- [x] **步骤 1：更新配置文档**

说明设置页 URL/模型入口、`.env` API Key 位置、修改即时生效方式和安全边界。

- [x] **步骤 2：执行完整验证**

运行：`npm run build; npm test; npm run smoke:web; npm run security:scan; git diff --check`

预期：构建、测试、smoke、密钥扫描和 diff 检查全部通过。

- [ ] **步骤 3：提交变更**

提交信息：`feat: 增加 AI 模型设置入口`
