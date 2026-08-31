# 双 AI 链路自定义 API 端点设计

日期：2026-08-31

## 目标

让 Groq 分析链路和 OpenRouter 点评链路都支持用户自定义 API Key 与完整的 OpenAI-compatible `chat/completions` URL，同时不改变当前默认行为。

## 配置契约

```dotenv
GROQ_API_KEY=
GROQ_API_URL=https://api.groq.com/openai/v1/chat/completions

OPENROUTER_API_KEY=
OPENROUTER_API_URL=https://openrouter.ai/api/v1/chat/completions
```

URL 使用完整请求地址；空值时分别回退到当前官方默认端点。OpenRouter 继续兼容已有的 `OPENROUTER_BASE_URL`，但显式的 `OPENROUTER_API_URL` 优先级更高。

## 请求与安全

- 两条链路都发送标准 `messages`、`model`、`temperature` 和 `max_tokens` 字段。
- API Key 仅从服务端环境变量读取，仅放入 Authorization 请求头。
- 不在日志、HTTP 响应、前端资源或仓库文件中输出 API Key。
- OpenRouter 的模型回退顺序保持不变；自定义 URL 对所有回退模型生效。
- 网络、HTTP 和空响应仍按现有链路处理，不改变交易助手的本地规则逻辑。

## 验证

测试覆盖默认 URL、去除末尾斜杠、完整自定义 URL，以及 OpenRouter 旧 base URL 兼容行为；随后执行构建、全量测试和敏感信息扫描。
