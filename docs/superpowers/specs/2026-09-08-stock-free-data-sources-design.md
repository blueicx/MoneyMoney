# 股票免费数据源扩展设计

## 背景

当前 MoneyMoney 已有多个股票相关适配器，但行情、财报、事件和公司事实的来源分散，部分数据缺少统一的缓存、降级和来源可见性。此次只扩展股票市场，不改变加密资产、预测市场和 VPN/Nginx/证书配置。

## 目标

- 在不强制用户配置 API Key 的前提下，扩大股票行情、财报、公司事实和事件数据覆盖。
- 复用现有 `DataSourceAdapter`/`ResilientDataSourceAdapter`，让单个源失败不影响其他卡片。
- 保持股票市场隔离：股票页面、雷达、分析和事件不混入加密资产或预测市场。
- 在网页和现有 Telegram 数据摘要中显示来源状态、数据时间和降级状态。
- 保持现有 API 兼容；新增能力作为统一的股票数据入口。

## 非目标

- 本轮不接入真实交易，不改变纸面交易逻辑。
- 本轮不要求 Nasdaq Data Link 或其他商业数据源的 Key。
- 本轮不修改 Nginx、证书、VPN、域名解析或 Telegram Bot 凭据。
- 不把非官方、不可验证或违反服务条款的抓取接口作为主数据源。

## 数据源策略

### 1. SEC EDGAR（默认免费、无 Key）

使用 SEC 官方 `data.sec.gov` API：

- `submissions`：发行人信息、CIK、申报记录、表单和申报时间。
- XBRL `companyfacts`：标准化财务事实，支撑收入、利润、资产负债和现金流等基础指标。
- 申报文件链接：为财报、8-K 和内部人交易卡片提供可追溯证据。

请求必须配置合法的 `User-Agent`，来源于运行环境配置，不写入 Git、测试夹具或日志。

### 2. 现有源保留并统一编排

- 现有行情、Nasdaq 日历、StockAnalysis 分析师共识、CBOE 延迟行情等适配器继续保留。
- 不重复造相同数据；由统一编排器按数据类型选择优先级和备用源。
- 适配器返回统一快照，调用方不直接依赖第三方响应格式。

### 3. 历史行情备用源

增加一个仅用于日线 OHLCV/基础 K 线的免费备用适配器。上线前必须通过真实端点烟囱测试、超时测试和字段完整性测试；若不可稳定验证，则保持未启用，不以脆弱的非官方抓取接口作为生产主源。

### 4. 可选增强源

Nasdaq Data Link 作为可选配置源，不作为默认依赖。它支持报价、快照、趋势和历史数据，但部分数据集需要账户 Key 或可能收费，因此只有用户显式配置后才启用，并将状态标记为 `unconfigured`/`fresh`。

## 统一模型

```ts
interface StockDataSnapshot<T> {
  symbol: string;
  dataType: 'quote' | 'bars' | 'fundamentals' | 'filings' | 'events';
  source: string;
  status: 'fresh' | 'stale' | 'failed' | 'unconfigured';
  asOf?: string;
  fetchedAt: string;
  data?: T;
  error?: string;
}
```

所有入口使用规范化的股票标的标识，例如 `stock:us:AAPL`。源适配器负责 ticker/CIK 映射、字段转换和缺失字段处理。

## 编排、缓存和降级

- 行情与短周期 K 线：TTL 5–15 分钟。
- 财报、公司事实、事件和申报记录：TTL 6–24 小时。
- 主源失败时优先使用未过期备用源，其次使用标记为 `stale` 的缓存。
- 单个数据类型失败只影响对应卡片；详情页、雷达和分析仍返回其他成功数据。
- 每次请求记录来源、延迟、状态和错误摘要；日志禁止记录 API Key、User-Agent 中的个人邮箱及完整第三方响应。

## API 与界面

保持现有接口兼容，新增统一股票数据接口，建议形态：

- `GET /api/stocks/:symbol/overview`
- `GET /api/stocks/:symbol/filings`
- `GET /api/stocks/:symbol/fundamentals`
- `GET /api/stocks/:symbol/events`
- `GET /api/stocks/:symbol/source-health`

股票详情页统一展示行情、K 线、财报/公司事实、事件、来源和更新时间。失败卡片显示可理解的降级提示，不阻塞页面其他内容。源健康面板只显示股票相关源，避免再次混入加密货币和预测市场。

## 测试设计

- ticker/CIK 映射、标的规范化和字段转换测试。
- SEC submissions/companyfacts fixture 解析测试，不依赖实时网络。
- 主源失败、重试、断路器、过期缓存和备用源选择测试。
- 缺少 CIK、无财报、字段为空、限流和超时测试。
- 股票详情 API、来源状态、数据更新时间和市场隔离测试。
- 回归执行 `npm run build`、完整 `npm test`，再做本地 HTTPS/域名冒烟测试。

## 发布边界

发布前备份远端 `dist`，只替换 MoneyMoney 的应用资源并重启 `moneymoney.service`。不修改 Nginx、TLS 证书、域名解析或 VPN。发布后验证股票页面、股票雷达、财报详情、来源健康和 Telegram 摘要；若任一新源异常，关闭该源并保留现有数据链路。

## 验收标准

1. 未配置任何新增 API Key 时，SEC 数据和现有免费源仍可工作。
2. 股票页面不出现加密货币或预测市场卡片。
3. 任一数据源失败时，其他数据卡片仍能展示，且状态可见。
4. 新增接口与现有接口同时通过测试，构建和完整测试通过。
5. VPS 只发生应用资源替换和 MoneyMoney 服务重启，Nginx、证书和 VPN 配置保持不变。
