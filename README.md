<div align="center">

<img src="src/web/public/icon.svg" width="96" alt="MoneyMoney Logo" />

# MoneyMoney

**多市场研究工作台 · 预测雷达 · 智能交易仪表盘**

一个面向个人研究者的多市场工具箱：预测市场、加密货币、美股与宏观事件，
汇聚在同一块玻璃拟态面板里。

[![Author](https://img.shields.io/badge/Author-%E5%90%B4%E5%AE%B6%E5%B8%8C%EF%BC%88WJX%EF%BC%89-blue)](https://github.com/blueicx)
![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue)
![Node](https://img.shields.io/badge/Node-18+-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

</div>

## 为什么叫 MoneyMoney

取自钱落进账户的那声轻响，也时刻提醒自己：
**先懂风险，再谈收益；先做研究，再做决定。**

---

## 中文说明

### 功能一览

| 模块 | 说明 |
|------|------|
| 🎯 预测市场 | Predict.fun 预测市场交易、限价/市价单、持仓管理；开放事件按时间排序并自动隐藏过期窗口 |
| 📅 每日研究简报 | 首页自动汇总跨平台高分歧对象、模拟盘风险、策略实验室校准和研究清单；用本机热缓存快速生成，不等待慢速外部接口 |
| 🔍 全局搜索 | 一个入口同时搜功能页面、美股/A股/港股、跨平台预测市场和宏观模块；支持 Ctrl+K 呼出、键盘上下选择、最近搜索和高亮匹配 |
| 🌐 跨平台预测雷达 | Polymarket / Kalshi / Manifold / Good Judgment Open 公开行情聚合；可选接入 Metaculus 群体预测；额外扫描天气市场，自动翻译中文题目并生成“分歧 / 共识 / 谨慎解读”研究信号；卡片分层展示概率、流动性、截止时间和可展开备注；跨平台机会会核对主题与截止时间，并明确提示需人工核对结算规则 |
| ⭐ 预测关注清单 | 一键收藏预测市场，雷达支持只看关注；本地保存偏好，不要求登录 |
| 📈 概率走势记录 | 每次雷达刷新自动保留概率快照，卡片内查看短期走势和变化幅度；数据保存在本机 |
| 📡 数据源健康面板 | 汇总预测、天气、加密、AI 等数据源状态、错误原因、延迟和最近检查时间 |
| 🧪 预测策略实验室 | 自动记录系统参考概率与市场价快照；事件落地后标记发生/未发生，统计 Brier 分数、命中率、校准区间和平台/分类/信心分组表现 |
| 🧮 预测仓位计算器 | 在预测雷达卡片上用系统概率、市场价差、流动性、成交量和你的资金规则估算 YES/NO 研究仓位；支持凯利比例、单仓上限和最小优势过滤，并给出风险警告，不自动下单 |
| 🧠 AI 市场点评 | 在预测雷达一键生成中文市场点评：今日重点、概率分歧与风险、后续观察清单。支持 OpenRouter 免费额度模型，结果按市场快照短缓存 |
| 🌤️ 天气预报证据雷达 | 用 Open-Meteo 免费预报为可核对的温度、降雨、降雪和阵风预测市场生成参考概率、中文判断和置信度；只覆盖 7 天内、城市明确的问题，并明确标注它不是官方结算源 |
| 🏦 币安 | 现货/合约行情、组合概览、资金费率 |
| 📈 股票与宏观 | 美股/ETF、A股、港股中文名行情；全球代码/名称/拼音搜索，点击结果可切换K线；宏观日历、外汇、黄金、大宗商品、稳定币 |
| 🏭 行业轮动雷达 | 用 SPY 基准比较 11 个美股行业 ETF 的 10/20 日动量、20/50 日趋势和相对强弱，识别领先/落后行业并生成顺势或防守提醒 |
| 💱 外汇 / 商品 / 债券信号 | 欧元/美元等主要汇率，黄金、白银、原油、铜、农业、天然气代理 ETF，以及 TLT/IEF/SHY/LQD/HYG 债券信用代理的日线技术面提醒 |
| 📐 波动率期限雷达 | CBOE 免费 VIX 9日/1月/3月/6月/12月期限结构，识别近月高压与远月升水，并小幅调整期权策略信心 |
| 📊 市场状态检测器 | Binance K 线自动计算 ADX / ATR% / 布林带宽度 / 成交量趋势，识别强趋势、弱趋势、震荡、波动扩张与布林挤压，并联动期权策略信心微调 |
| 🎯 支撑 / 阻力雷达 | 基于摆动高低点自动聚类关键价位，按触碰次数、近期性和成交量打分，为加密货币信号提供更精准的止损止盈参考 |
| 🧭 多周期共振 | 同时检查 15 分钟 / 1 小时 / 4 小时 / 日线均线排列、偏离和动量；方向一致时增强加密信号信心，混乱时提示等待 |
| 📅 宏观事件风险护栏 | ForexFactory 免费周历检测 72 小时内高影响宏观事件，发布前自动小幅降低全球新信号信心并收缩单笔风险；数据源异常时透明使用近期缓存 |
| 💧 稳定币流动性雷达 | 汇总 DefiLlama 稳定币 1日 / 7日 / 30日净流入，生成有界的流动性分与 Risk-on / Risk-off 背景；结果只调节助手风险环境，不单独触发交易 |
| 🌾 收益质量雷达 | 用 DefiLlama 池子的 TVL、稳定币标记、无常损失、敞口、30 日均值、7 日趋势、预测置信度和激励依赖做风险调整评分；按保守 / 平衡 / 进取 / 高风险分组，避免只追短期高 APY |
| 🧑‍💼 内部人交易雷达 | 读取 SEC EDGAR Form 4，汇总近 90 天董事、高管和 10% 股东的买入/卖出金额、人数、10b5-1 预设计划占比，并生成中文信号、置信度与谨慎行动建议 |
| 📊 基本面质量雷达 | 解析 SEC EDGAR 10-K XBRL 年报，评估营收增长、毛利率、净利率、经营现金流转化、应计项目、流动比率、负债资产比和 ROE；生成 0-100 质量分、三年趋势与中文风险解读 |
| 🏛️ CME 机构持仓雷达 | 解析 CFTC 官方 CME 比特币 / 以太坊期货周报，跟踪机构净多头、净占未平仓比例、多空比与拥挤方向；结果纳入助手市场环境，并在美股页提供中文解释 |
| 🧯 永续持仓拥挤雷达 | 用 Gate.io 公共 USDT 永续数据跟踪 BTC/ETH/SOL/BNB/XRP/DOGE 的资金费率、年化成本、下次结算、多空账号比、未平仓价值和 24h 成交额；识别多头/空头拥挤并纳入助手风险环境 |
| ⚖️ 跨所资金费套利雷达 | 比较 Gate.io、HTX、Deribit 等公共永续资金费，筛选“低费做多 + 高费做空”的毛价差、扣往返费参考年化、置信度和中文风险提示；只做研究线索，不自动下单 |
| ⚡ 主动资金流与盘口雷达 | 用 Binance 现货 K 线主动买入额和实时盘口，跟踪主流币 24h 净主动流、主动买占比、近 4 小时动能、买卖挂单失衡、点差和近价承接；识别流入/流出确认、背离信号，并纳入交易助手环境 |
| ⛓️ 比特币链上健康雷达 | 用 Blockchain.com 公共图表跟踪活跃地址、链上结算额、全网算力、矿工收入和 BTC 市值；计算 52 周分位、NVT 拥挤度，并给交易助手提供有界链上环境加分 |
| 🧩 跨资产联动回撤雷达 | 用 Binance 加密日线和 Nasdaq 美股/ETF 日线跟踪 BTC、ETH、美股、黄金、美债和高收益信用债的 20/60 日涨跌、90 日回撤、30 日年化波动与对 SPY 相关性；生成分散度评分和中文风险建议，并纳入交易助手环境 |
| 🐻 空头利息雷达 | 用 Nasdaq 公共数据跟踪美股/ETF 空头利息、较上期变化、日均成交、回补天数与历史分位；识别空头拥挤、回补和逼空风险，并小幅纳入股票信号与助手环境 |
| 🌡️ 市场宽度雷达 | 用 Nasdaq 公共筛选器快照跟踪全市场上涨/下跌家数、强涨强跌占比、板块与市值分层广度；识别广泛 Risk-on/Risk-off 并纳入助手环境 |
| 🏛️ 机构持仓雷达 | 用 Nasdaq 公共机构持仓数据跟踪机构持股比例、增持/减持/新建仓/清仓家数、净增减股数和前 12 大持有人变化；识别中期筹码积累/派发并纳入股票信号与助手环境 |
| 🎯 分析师共识雷达 | 读取 StockAnalysis 公共分析师共识页，汇总买入/持有/卖出评级、覆盖人数、目标价中位数、隐含空间、近三个月评级变化和最新机构动作；生成中文信号并小幅纳入股票信号与助手环境 |
| 🌐 全球宏观现货雷达 | 用腾讯海外公共现货跟踪黄金、白银、WTI/Brent 原油，并用 Frankfurter/ECB 美元定盘价重建美元指数；输出金银比、日内位置、5/20 日趋势、宏观风险解读，并纳入助手环境 |
| 🏦 利率与债券 | 美国国债收益率曲线、关键期限变化、2s10s 倒挂监测，并用曲线变化增强债券久期信号解释 |
| 📅 财报雷达 | 美股财报日历、盘前/盘后标识、市值排序与预期 EPS |
| 🎯 期权雷达 | Deribit BTC/ETH 期权链；CBOE 美股/ETF 延迟期权链、PCR、最大痛点、Delta 与一阶 GEX，并按到期周期生成铁鹰、价差和保护性 Put 等策略观察 |
| 📊 分析引擎 | 技术分析、情绪分析、Kelly 公式回测 |
| 🧠 智能交易助手 | 汇总币安技术面、全球股票日线、美股行业轮动、市场宽度、机构持仓与分析师共识、全球宏观现货、主要外汇与商品代理 ETF、债券/信用代理 ETF 与美债曲线、美股指数/VIX 风险雷达、美股空头利息、预测市场概率、SPY/BTC 期权策略、恐贪、资金费率、永续持仓拥挤与 CFTC 机构持仓，给出买入/卖出/等待提醒、置信度、参考入场/止损/止盈与市场环境 |
| ⚠️ 助手警醒与建议 | 汇总宏观事件、全球风险、资金费率、永续拥挤度、恐贪、稳定币流动性、CFTC 拥挤度、波动状态和数据缺口，生成高/中/观察三级中文风险卡片与行动建议；先看风险，再看机会 |
| 🚪 持仓退出教练 | 对助手跟踪中的模拟持仓实时判断退出时机：结合预测盘口、币安、股票、行业和宏观现价，标出止损危险、止盈区、保护利润、预测结算倒计时，并给出中文行动建议 |
| 🛡️ 持仓巡检 | 后台每 90 秒复查模拟持仓风险；危险/止盈状态变化才推送应用与 Telegram 提醒，恢复后再恶化会重新提醒，面板汇总危险、止盈和观察计数 |
| 🧪 助手模拟账本与自适应校准 | 自动跟踪币安、Predict.fun、股票、宏观/债券、美股行业轮动和期权策略信号并模拟到期结算；按平台、策略、信心度和「环境 × 方向」总结胜率、R 值、盈利因子和经验教训，生成保守胜率经验排行，再用足够样本小幅校准新信号的信心与风险，并按当前风险环境调整看涨/防守提醒优先级 |
| 🕐 时间显示 | 市场开放、宏观事件与新闻统一显示北京时间 |
| 🗂️ 可折叠宏观工作台 | 全球股票页拆成行情选股、宏观流动性、日历情绪、DeFi 资讯四个分区；支持一键展开/收起，并记住偏好，避免单页过长 |
| 🎨 玻璃拟态界面 | 全局极光渐变背景、毛玻璃导航/卡片/折叠面板、半透明层级和高亮描边；股票 K 线按屏幕像素密度重绘，新增均线、成交量、坐标轴与 60/120/250 日切换 |
| ⚡ 快速启动 | 预测市场使用本地快照秒开，后台自动更新最新数据；顶栏指标并行加载，桌面启动器等服务就绪后立即打开面板，手动刷新仍强制拉取最新 |
| 🐋 巨鲸监控 | 大额交易追踪、异常波动检测 |
| ⚔️ 策略对比 | 多策略并行模拟与绩效排名 |
| 🔔 智能预警 | 价格/指标预警、Telegram 推送 |
| 🏆 高胜率信号推送 | 模拟账本保守胜率 ≥65% 且新信号信心达到设定阈值时，自动汇总推送到 Telegram、企业微信或 iPhone Bark；同一信号不会重复刷屏 |
| 🛡️ 统一风险指挥台 | 把模拟敞口、集中度、VaR 95%、市场风险分、助手高风险提醒、多空信号、预测雷达高分歧对象和临近截止清单合并成玻璃拟态行动台；高分歧对象可一键加入关注，自动识别重复主题集中风险，本地保存 24 小时风险趋势并在等级上升时推送站内提醒 |
| 📰 新闻聚合 | PANews 中文快讯优先，Decrypt / Bitcoin Magazine 英文补充 |
| 📅 未来事件日历 | 新闻页统一展示未来美股财报、美联储/FOMC、高影响经济数据；支持事件/影响/7-30 天筛选、北京时间、倒计时和预期前值 |
| ⚡ 分区懒加载 | 预测分类卡片按可视区域加载统计与盘口，股票研究分区展开才拉取数据；市场盘口短缓存去重，减少接口排队 |
| 🖥️ 桌面客户端 | `MoneyMoney.exe` 托盘启动器：无黑窗启动、重复打开只唤起面板 |
| 🧪 模拟盘 | 无风险纸面交易与日志记录，含夏普比率、盈亏比、VaR 95%、期望收益、赔率比等风险分析面板 |
| 🏠 风险指挥台 | 将风险等级、模拟资产、VaR、助手警醒、预测分歧与临近截止事件集中到首页行动台，保留当前玻璃拟态主题 |
| 📚 研究证据工作台 | 为市场、资产和主题保存研究状态、来源快照与研究笔记，形成可持续复盘的本地证据链 |
| ⚙️ 自动化运营台 | 查看雷达刷新、风险巡检、助手刷新和 AI 模拟运行任务的状态、最近运行结果，并支持手动重跑 |

### 快速开始

```bash
npm install
npm run build
npm run web        # 打开 http://localhost:3000
```

### 免费数据源

核心行情与研究数据以无密钥免费 API 为主；预测雷达和 AI 点评另支持可选的免费额度服务：
- Polymarket Gamma Public API（预测市场行情）
- Predict.fun Public GraphQL（Predict 分类、统计和盘口备用源）
- Metaculus API（可选群体预测源；需在官网申请免费账号 Token）
- Kalshi Public Market API（预测市场行情）
- Manifold Public API（预测市场行情）
- 搜狗翻译 / 有道翻译 / MyMemory（预测题目中文辅助翻译；本地缓存结果）
- Good Judgment Open 公共群体预测页（二元问题共识概率）
- Deribit Public API（期权）
- CBOE Delayed Quotes（美股/ETF 期权链、标的报价与 Greeks）
- ForexFactory JSON（高影响宏观日历与事件风险护栏）
- Coinlore（全局加密指标）
- alternative.me（恐贪指数）
- OpenRouter API（可选 AI 中文点评；需注册免费额度 Key）

### Metaculus / OpenRouter / Bark 可选配置

- **Metaculus**：在 Metaculus 账号设置里生成 API Token，写入 `.env`：`METACULUS_API_TOKEN=...`。未配置时雷达仍会用其他平台继续工作。
- **OpenRouter**：在 OpenRouter 创建 Key 后写入 `.env`：`OPENROUTER_API_KEY=...`。可用 `OPENROUTER_API_URL=...` 指向完整的 OpenAI-compatible `/chat/completions` 接口；留空时使用官方地址，也兼容旧的 `OPENROUTER_BASE_URL`。
- **Groq**：如需启用市场分析链路，填写 `GROQ_API_KEY=...`；可用 `GROQ_API_URL=...` 自定义完整接口，模型由 `GROQ_MODEL=...` 控制。
- **iPhone Bark**：安装 Bark 后复制它的推送 URL 中的 device key，写入 `.env`：`BARK_DEVICE_KEY=...`。之后可在设置页测试全部通知通道。

### Telegram 高胜率推送

完整的私聊、群组、频道 Chat ID 获取方式与排错清单见 [`docs/telegram-setup.md`](docs/telegram-setup.md)。

1. 在 Telegram 搜索 `@BotFather`，发送 `/newbot` 创建机器人并复制 Bot Token。
2. 先给你的机器人发送一条任意消息；用浏览器或 `curl` 调用 `https://api.telegram.org/bot<TOKEN>/getUpdates` 找到 `chat.id`。
3. 在 `.env` 中填写：
   `TELEGRAM_BOT_TOKEN=...`
   `TELEGRAM_CHAT_ID=...`
   可选：`HIGH_SUCCESS_WIN_RATE=65`
   若本机直连 Telegram 超时，另填 `TELEGRAM_PROXY_URL=http://127.0.0.1:10808`（端口以你的代理软件为准）。
4. 若要接收指令，在 `.env` 追加 `TELEGRAM_POLLING_ENABLED=true` 和 `TELEGRAM_ALLOWED_CHAT_IDS=你的ChatID`，然后重启 MoneyMoney。发送 `/start` 后，输入框下方会出现功能菜单；支持总览、风险、信号详情、市场搜索、事件日历、数据源健康、模拟盘二次确认、提醒订阅、历史表现和自然语言快捷查询。所有交易动作仅限本地模拟盘。

### 企业微信高胜率推送

1. 在企业微信建一个群（可以只拉自己）。
2. 进入「群设置 → 群机器人 → 添加机器人」，创建后复制 Webhook 地址。
3. 把地址写入 `.env`：`WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`
4. 重启 MoneyMoney，保持「Telegram 通知」总开关开启；设置页点「测试全部通知通道」确认企业微信显示已发送。
- Binance Public API（资金费率、行情）
- Gate.io Public API（资金费率情绪）
- Gate.io Public API（USDT 永续合约持仓拥挤与资金费率）
- Gate.io / HTX / Deribit Public API（跨所 USDT 永续资金费对比）
- Binance Public Spot Market Data（主流币主动买入/卖出流、实时买卖盘深度和近价承接）
- Blockchain.com Public Charts（比特币链上活跃地址、结算额、算力、矿工收入和市值）
- Tencent Finance Public Quotes / Smartbox（美股 / ETF、A 股、港股行情、日线技术面与代码搜索；美股卡片显示官方英文名，接口按 GBK/UTF-8 正确解码）
- Frankfurter / European Central Bank（主要外汇历史时间序列）
- Tencent Finance Public Quotes（商品代理 ETF：GLD/SLV/USO/CPER/DBA/UNG）
- Nasdaq Public ETF History（债券/信用代理：TLT/IEF/SHY/LQD/HYG；美股行业轮动：XLK/XLF/XLE 等 11 个行业与 SPY）
- Nasdaq Public ETF History + Binance Public Klines（跨资产联动回撤雷达的 BTC/ETH、SPY/QQQ/GLD/TLT/HYG 历史行情）
- Nasdaq Public Short Interest（美股/ETF 空头利息、日均量与回补天数）
- Nasdaq Public Screener（美股市场宽度）
- Nasdaq Public Institutional Holdings（美股机构持仓）
- StockAnalysis Public Analyst Consensus（美股分析师评级、目标价与近期动作）
- Tencent Finance Public Overseas Spot（现货黄金/白银与 WTI/Brent 原油）
- Frankfurter / European Central Bank USD Fixings（官方篮子权重重建美元指数）
- CBOE Delayed Index Quotes（标普500、纳指100、道琼斯、罗素2000、VIX）
- CFTC Commitments of Traders（CME 比特币 / 以太坊机构期货持仓）
- SEC EDGAR（公司代码映射、Form 4 内部人申报与 10-K XBRL 基本面数据）
- DefiLlama（TVL、风险调整收益质量、稳定币供应与净流入历史）
- CoinGecko / CoinPaprika（股票与加密报价）
- PANews RSS（中文加密/宏观新闻）
- U.S. Department of the Treasury（官方美债收益率曲线）
- Nasdaq Public Calendar（美股财报日历）
- CBOE Delayed Volatility Indices（VIX 9D/1M/3M/6M/12M）

### 环境联动经验权重

助手会把每次模拟开仓时的 Risk-on / Risk-off / Neutral 环境记录下来，并汇总「环境 × 看涨/防守」的保守胜率和期望值。只有同一环境至少积累 5 笔样本、且方向优先级差距达到 2 分时才会启用联动排序；权重只影响优先提醒顺序，不放大信号信心或建议仓位。这样偏多环境更关注顺势证据，偏空/震荡环境也更尊重防守和反转经验。

### 桌面客户端

桌面版入口是 `MoneyMoney.exe`：

- 启动后只在系统托盘显示小图标，不弹出黑色 CMD 窗口。
- 首次打开会自动拉起仪表盘；再次双击只会打开已有页面，不会重复开进程。若后台核心意外退出，下次打开会先自动重启核心。
- 启动器会检查 `/api/health`，避免把别的本地网页误认为 MoneyMoney。
- 直接启动 `MoneyMoney.exe` 时，15 秒内只会自动打开一次面板，避免快速重复点击产生多个标签页。
- 托盘图标右键可“打开面板”或“退出”。退出会停止由它启动的核心程序。
- 桌面核心会从自身目录向上查找最近的 `.env`，所以放在项目根目录的配置也能被 `release\core` 工作目录使用。
- `MoneyMoney.ini` 可指定核心路径和工作目录：

```ini
path=E:\MYC\predict-fun-trader\release\core\MoneyMoneyCore.exe
workdir=E:\MYC\predict-fun-trader
```

---

## English

### Features

| Module | Description |
|--------|-------------|
| 🎯 Prediction Markets | Predict.fun trading with limit/market orders, position management; open events time-sorted with expired windows hidden |
| 📅 Daily Research Briefing | The homepage summarizes cross-platform divergence candidates, simulated risk, forecast-lab calibration, and a research checklist from warm local snapshots without waiting on slow external APIs |
| 🔍 Global Search | Searches features, US/China/HK equities, cross-platform prediction markets, and macro modules from one command palette; supports Ctrl+K, keyboard selection, recent queries, and match highlighting |
| 🌐 Cross-Platform Radar | Keyless Polymarket/Kalshi/Manifold/Good Judgment Open aggregation with optional Metaculus coverage, a supplemental weather sweep, Chinese titles, divergence/consensus/caution signals, layered market cards, category filters, model probabilities, cross-platform consensus, activity ranking, and deadline-aware spread screening |
| ⭐ Prediction Watchlist | Star prediction markets, filter the radar to watched items only, and keep preferences locally without an account |
| 📈 Probability History | Keeps local probability snapshots on every successful radar refresh and shows short-term trend/change directly on market cards |
| 📡 Source Health Panel | Summarizes prediction, weather, crypto, and AI data sources with status, error reasons, latency, and last-check time |
| 🧪 Forecast Strategy Lab | Records model and market probability snapshots; after events settle, mark outcomes to review Brier scores, hit rates, calibration buckets, and platform/category/confidence groups |
| 🧮 Prediction Position Sizer | Estimates a YES/NO research stake on radar cards using model probability, market price, spread, liquidity, volume, and your bankroll rules; supports fractional Kelly, per-position caps, minimum-edge filtering, and plain risk warnings without auto-trading |
| 🧠 AI Market Commentary | Generates an on-demand Chinese research digest on the prediction radar—today’s focus, probability divergence/risk, and follow-up checks—using OpenRouter free-tier models with short snapshot caching |
| 🌤️ Weather Forecast Evidence Radar | Uses free Open-Meteo forecasts to add reference probabilities and Chinese judgments for verifiable temperature, rain, snow, and wind-gust prediction markets. Coverage is intentionally limited to city-specific questions resolving within seven days, with a clear non-official-resolution disclaimer |
| 🏦 Binance | Spot/futures data, portfolio overview, funding rates |
| 📈 Stocks & Macro | Properly localized US equity/ETF, China A-share, and Hong Kong quotes; global code/name/pinyin search with click-to-chart; macro calendar, FX, gold, commodities, stablecoins |
| 🏭 Sector Rotation Radar | Compares 11 US sector ETFs against SPY using 10/20-day momentum, 20/50-day trend filters, and relative strength to highlight leaders/laggards and generate trend-following or defensive reminders |
| 💱 FX / Commodity / Bond Signals | Daily technical reminders for major FX pairs; gold, silver, oil, copper, agriculture, and natural-gas proxy ETFs; and TLT/IEF/SHY/LQD/HYG duration and credit proxies |
| 📐 Volatility Term Radar | Keyless CBOE VIX 9-day/1-month/3-month/6-month/12-month structure to detect near-term stress or deferred premium, with bounded option-confidence adjustments |
| 📊 Market Regime Detector | Binance kline–powered ADX, ATR%, and Bollinger Band Width classification into strong/weak trend, ranging, volatile expansion, or squeeze—with regime-aware option-confidence adjustments |
| 🎯 Support / Resistance Radar | Swing high/low auto-clustering scored by touch count, recency, and volume—giving crypto signals smarter stop-loss and take-profit anchors |
| 🧭 Multi-Timeframe Confluence | Checks MA alignment, deviation, and momentum across 15m/1h/4h/daily; reinforces crypto conviction when timeframes agree and suggests waiting when they conflict |
| 📅 Macro Event-Risk Guard | Uses the free ForexFactory weekly calendar to detect high-impact releases within 72 hours, then modestly lowers global new-signal confidence and position risk before release; a clearly labeled recent cache covers provider outages |
| 🏦 Rates & Bonds | U.S. Treasury yield curve, key-tenor changes, and 2s10s inversion monitoring, with curve change context for duration signals |
| 📅 Earnings Radar | US earnings calendar with pre/post-market badges, market-cap ranking, and consensus EPS |
| 🌾 Yield Quality Radar | Scores DefiLlama pools on risk-adjusted sustainability using TVL, stablecoin flags, impermanent loss, exposure, 30-day averages, 7-day trends, prediction confidence, and incentive dependence; groups results into conservative/balanced/aggressive/high-risk instead of chasing short-term APY |
| 🧑‍💼 Insider Transaction Radar | Reads SEC EDGAR Form 4 filings to summarize 90-day buying/selling by directors, officers, and 10% owners, including value, participant breadth, 10b5-1 plan ratio, a Chinese signal, confidence, and cautious next actions |
| 📊 Fundamental Quality Radar | Parses SEC EDGAR 10-K XBRL annual facts to evaluate revenue growth, gross/operating/net margins, operating-cash conversion, accruals, current ratio, liabilities/assets, and ROE; produces a 0-100 quality score, three-year trend, and Chinese risk interpretation |
| 🏛️ CME Positioning Radar | Parses the official CFTC CME weekly report for Bitcoin/Ether futures, tracking institutional net length, net share of open interest, long/short ratio, and crowding; feeds the advisor regime and renders Chinese explanations on the stocks page |
| 🧯 Perpetual Crowding Radar | Uses keyless Gate.io USDT futures data to track BTC/ETH/SOL/BNB/XRP/DOGE funding cost, annualized funding, next settlement, long/short account ratio, open-interest value, and 24h volume; detects crowded sides and feeds advisor risk context |
| ⚖️ Funding Carry Radar | Compares public perpetual funding across Gate.io, HTX, Deribit, and other reachable venues; ranks low-funding long plus high-funding short leads with gross spread, roundtrip-cost-adjusted annualized reference, confidence, and Chinese risk notes. Research only—never an auto-trade trigger |
| ⚡ Order-Flow & Book Liquidity Radar | Uses Binance spot taker-buy kline volume and live depth to track 24h net taker flow, active buy share, recent flow acceleration, bid/ask imbalance, spread, and near-touch liquidity for major coins; confirms inflow/outflow, flags divergence, and feeds advisor context |
| ⛓️ Bitcoin On-chain Health Radar | Uses Blockchain.com public charts to track active addresses, on-chain settlement volume, hash rate, miner revenue, and BTC market cap; computes 52-week percentiles, NVT pressure, and a bounded on-chain regime boost for the trade advisor |
| 🧩 Cross-Asset Correlation & Drawdown Radar | Tracks BTC, ETH, equities, gold, Treasuries, and high-yield credit with Binance and Nasdaq public daily history: 20/60-day change, 90-day drawdown, 30-day annualized volatility, correlation to SPY, diversification scoring, Chinese guidance, and advisor regime context |
| 🐻 Short-Interest Radar | Uses keyless Nasdaq data to track US equity/ETF short interest, period change, average daily volume, days-to-cover, and history percentile; classifies crowding, covering, and squeeze risk while adding a bounded stock-signal and advisor context |
| 🌡️ Market Breadth Radar | Uses the keyless Nasdaq screener snapshot to track advance/decline breadth, strong gainers and losers, sector groups, and market-cap tiers; detects broad risk-on/risk-off regimes and feeds advisor context |
| 🏛️ Institutional Ownership Radar | Uses keyless Nasdaq institutional-holdings data to track ownership percentage, increased/decreased/new/sold-out positions, net share flow, and the largest holders; detects medium-term accumulation/distribution and feeds stock signals plus advisor context |
| 🎯 Analyst Consensus Radar | Reads StockAnalysis public forecast pages to summarize buy/hold/sell ratings, analyst coverage, median price targets, implied upside, three-month rating shifts, and recent actions; produces a Chinese signal with bounded stock-signal and advisor context |
| 🌐 Global Macro Spot Radar | Tracks spot gold/silver and WTI/Brent crude with Tencent public overseas quotes, rebuilds the dollar index from Frankfurter/ECB USD fixings using official basket weights, and interprets gold-silver ratio, day ranges, 5/20-day trends, and macro risk for advisor context |
| 🎯 Options Radar | Deribit BTC/ETH options; CBOE delayed US equity/ETF chains with PCR, max pain, delta, first-order GEX, and per-expiry strategy observations such as iron condors, spreads, and protective puts |
| 📊 Analysis Engine | Technical analysis, sentiment analysis, Kelly criterion backtest |
| 🧠 Smart Trade Advisor | Combines Binance technicals, global stock daily signals, US sector rotation, market breadth, institutional ownership and analyst consensus, global macro spot anchors, major FX/commodity proxies, bond and credit proxies with the Treasury curve, US index/VIX risk radar, US short interest, prediction probabilities, SPY/BTC option strategies, Fear & Greed, funding bias, stablecoin liquidity, and CFTC positioning into buy/sell/wait reminders with confidence, entry/stop/target levels, and regime context |
| ⚠️ Advisor Caution Flags | Turns macro-event, global-risk, funding, Fear & Greed, stablecoin-liquidity, CFTC-crowding, volatility-regime, and missing-data inputs into prioritized Chinese caution cards with practical next actions—risk first, opportunity second |
| 🚪 Exit Coach | Adds live exit guidance to tracked paper positions using current prediction/order-book, crypto, stock, sector, and macro prices; highlights stop-loss danger, take-profit zones, profit protection, settlement countdowns, and concrete Chinese next actions |
| 🛡️ Position Risk Patrol | Rechecks simulated positions every 90 seconds in the background; pushes app and Telegram notices only when a danger/take-profit state changes, re-alerts after recovery and relapse, and summarizes danger/profit/watch counts in the advisor panel |
| 💧 Stablecoin Liquidity Radar | Aggregates DefiLlama 1d/7d/30d stablecoin net flow into a bounded liquidity score and Risk-on / Risk-off backdrop; it adjusts advisor risk context and is never a standalone trigger |
| 🧪 Assistant Paper Journal & Adaptive Calibration | Automatically tracks Binance, Predict.fun, stock, macro/bond, US sector rotation, and option-strategy signals through simulated settlement; summarizes win rate, R multiples, profit factor, and lessons by venue, strategy, confidence, and regime-direction evidence, builds a conservative win-rate experience ranking, then uses sufficient paper history to make bounded confidence/risk adjustments and prioritize bullish or defensive reminders for the current risk regime |
| 🕐 Time Display | Market opens, macro events, and news use explicit Asia/Shanghai time |
| 🗂️ Collapsible Macro Workbench | The global stock page is split into market/screening, macro liquidity, calendar/sentiment, and DeFi/news sections with one-click expand/collapse and remembered preferences to prevent excessive page length |
| 🎨 Glassmorphism UI | Adds a global aurora gradient, frosted navigation/cards/collapsible panels, translucent hierarchy, and highlight borders; stock candles now render at native display density with moving averages, volume, axes, and 60/120/250-day ranges |
| ⚡ Fast Startup | Paints prediction markets instantly from a local snapshot while refreshing live data in the background; loads overview chips in parallel, opens the desktop dashboard as soon as the server is healthy, and keeps manual refresh on a forced live fetch |
| 🐋 Whale Monitor | Large trade tracking, anomaly detection |
| ⚔️ Strategy Comparison | Multi-strategy parallel simulation & performance ranking |
| 🔔 Smart Alerts | Price/indicator alerts, Telegram push notifications |
| 🏆 High Win-Rate Signal Push | When simulated conservative win rate is at least 65% and a new signal reaches your confidence threshold, MoneyMoney sends a deduplicated digest to Telegram, WeCom, or iPhone Bark |
| 🛡️ Unified Risk Command Center | Combines simulated exposure, concentration, VaR 95%, market risk score, assistant cautions, signal balance, high-divergence radar watchlist, and expiring predictions into a glassmorphic action center; add radar focuses in one click, detect overlapping theme clusters, store local 24-hour risk history, and raise an in-app notice when the level deteriorates |
| 📰 News Aggregator | Chinese-first PANews flash news with Decrypt / Bitcoin Magazine fallback |
| 📅 Upcoming Event Calendar | A news-page timeline for future US earnings, Fed/FOMC decisions, and high-impact macro data with category/impact/7–30 day filters, Beijing time, countdowns, and forecast/previous values |
| ⚡ Section Lazy Loading | Prediction cards load stats and order books near the viewport; stock research panels fetch only after expansion, with short-lived order-book caches to reduce request queueing |
| 🖥️ Desktop Client | `MoneyMoney.exe` tray launcher: hidden-console startup and single-dashboard reuse |
| 🧪 Paper Trading | Risk-free paper trading with journal logging and a risk analytics dashboard (Sharpe, profit factor, VaR 95%, expectancy, payoff ratio) |

### Quick Start

```bash
npm install
npm run build
npm run web        # Open http://localhost:3000
```

### Free Data Sources

Core market and research data comes primarily from keyless free APIs; the prediction radar and AI commentary also support optional free-tier services:
- Polymarket Gamma Public API (prediction-market data)
- Predict.fun Public GraphQL (fallback categories, statistics, and order books)
- Metaculus API (optional crowd forecasts; requires a free account token)
- Kalshi Public Market API (prediction-market data)
- Manifold Public API (prediction-market data)
- Sogou Translate / Youdao Translate / MyMemory (Chinese titles and research notes; results cached locally)
- Good Judgment Open public crowd forecasts (binary consensus probabilities)
- Deribit Public API (options)
- CBOE Delayed Quotes (US equity/ETF option chains, underlying quotes, and Greeks)
- ForexFactory JSON (high-impact macro calendar and event-risk guard)
- Coinlore (global crypto metrics)
- alternative.me (Fear & Greed Index)
- OpenRouter API (optional AI commentary; requires a free-tier key)

### Optional Metaculus / OpenRouter / Bark Setup

- **Metaculus**: create an API token from your account settings and set `METACULUS_API_TOKEN=...`. Without it, the radar still works from other platforms.
- **OpenRouter**: set `OPENROUTER_API_KEY=...`; optionally set `OPENROUTER_API_URL=...` to a complete OpenAI-compatible `/chat/completions` endpoint. The official URL is used when blank, and the legacy `OPENROUTER_BASE_URL` is still supported.
- **Groq**: set `GROQ_API_KEY=...` to enable the market-analysis chain; optionally set `GROQ_API_URL=...` and choose `GROQ_MODEL=...`.
- **iPhone Bark**: install Bark, copy its device key from the push URL, and set `BARK_DEVICE_KEY=...`. Test all channels from Settings.

### Telegram High Win-Rate Push

1. Create a bot with `@BotFather` in Telegram, then copy the Bot Token.
2. Send any message to your bot, call `https://api.telegram.org/bot<TOKEN>/getUpdates`, and copy `chat.id`.
3. Set these keys in `.env`:
   `TELEGRAM_BOT_TOKEN=...`
   `TELEGRAM_CHAT_ID=...`
   Optional: `HIGH_SUCCESS_WIN_RATE=65`
   If Telegram is unreachable directly, add `TELEGRAM_PROXY_URL=http://127.0.0.1:10808` (use your local proxy port).
4. To receive commands, also set `TELEGRAM_POLLING_ENABLED=true` and `TELEGRAM_ALLOWED_CHAT_IDS=<your chat id>`, then restart MoneyMoney. Send `/start` to show the persistent menu. It covers overview, risk, signal details, market search, events, source health, paper-trading confirmation, subscriptions, history, natural-language shortcuts, watchlists, advanced alerts, signal explanations, research notes, paper-trading review, and scheduled digests. Trading actions remain local paper trading only.

   Personal trading-console commands include `/watchlist`, `/watch add <market>`, `/watch remove <market>`, `/alerts`, `/alert smart ...`, `/explain <market>`, `/portfolio`, `/positions`, `/close <position>`, `/reset`, `/review`, `/export`, `/note <text>`, `/journal`, `/journal ai`, `/digest`, `/digest on`, `/digest off`, `/digest time HH:mm`, and `/health`. Account-changing operations remain confirmation-protected and are written to the local audit log.

### WeCom High Win-Rate Push

1. Create a WeCom group (you can be its only member).
2. Open group settings, add a group robot, and copy its webhook URL.
3. Put the URL in `.env`: `WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...`
4. Restart MoneyMoney, keep the notification master switch enabled, and use "Test All Notification Channels" on the settings page.
- Binance Public API (funding rates, market data)
- Gate.io Public API (funding-rate sentiment and USDT futures crowding)
- Gate.io / HTX / Deribit Public APIs (cross-exchange USDT perpetual funding comparison)
- Binance Public Spot Market Data (major-coin taker flow, live book depth, and near-touch liquidity)
- Blockchain.com Public Charts (Bitcoin active addresses, settlement volume, hash rate, miner revenue, and market cap)
- Tencent Finance Public Quotes / Smartbox (US/ETF, China A-share, and Hong Kong localized names, daily technicals, and symbol search)
- Frankfurter / European Central Bank (major FX historical time series)
- Tencent Finance Public Quotes (commodity-proxy ETFs: GLD/SLV/USO/CPER/DBA/UNG)
- Nasdaq Public ETF History (bond/credit proxies: TLT/IEF/SHY/LQD/HYG; US sector rotation: XLK/XLF/XLE plus the other 8 sectors and SPY)
- Nasdaq Public ETF History + Binance Public Klines (BTC/ETH, SPY/QQQ/GLD/TLT/HYG history for the cross-asset radar)
- Nasdaq Public Short Interest (US equity/ETF short interest, average volume, and days-to-cover)
- Nasdaq Public Screener (US market breadth)
- Nasdaq Public Institutional Holdings (US institutional ownership)
- StockAnalysis Public Analyst Consensus (US ratings, targets, and recent analyst actions)
- Tencent Finance Public Overseas Spot (spot gold/silver and WTI/Brent crude)
- Frankfurter / European Central Bank USD Fixings (official-basket dollar-index reconstruction)
- CBOE Delayed Index Quotes (S&P 500, Nasdaq 100, Dow, Russell 2000, and VIX)
- CFTC Commitments of Traders (institutional CME Bitcoin/Ether futures positioning)
- SEC EDGAR (company ticker mapping, insider Form 4 filings, and 10-K XBRL fundamentals)
- DefiLlama (TVL, risk-adjusted yield quality, stablecoin supply and net-flow history)
- CoinGecko / CoinPaprika (stock & crypto quotes)
- PANews RSS (Chinese crypto/macro news)
- U.S. Department of the Treasury (official Treasury yield curve)
- Nasdaq Public Calendar (US earnings calendar)
- CBOE Delayed Volatility Indices (VIX 9D/1M/3M/6M/12M)

### Regime-linked experience weights

The assistant records the Risk-on / Risk-off / Neutral regime when each paper trade opens and aggregates conservative win rates and expectancy by regime and bullish/defensive direction. Linking turns on only when the current regime has at least five samples and the directional priority gap reaches two points. The weight changes reminder ordering only; it does not inflate signal confidence or position size. This keeps trend evidence more visible in risk-on conditions while respecting defensive and reversal experience in weaker regimes.

### Desktop client

Use `MoneyMoney.exe` as the desktop entry:

- It runs from the system tray without opening a black CMD window.
- The first launch starts the dashboard; later launches reopen the same dashboard instead of spawning another process. If the backend exits unexpectedly, the next open revives it first.
- It checks `/api/health` so another local web page is not mistaken for MoneyMoney.
- A direct `MoneyMoney.exe` launch auto-opens the dashboard at most once every 15 seconds, preventing repeated tabs from rapid double-clicks.
- The dashboard service worker self-heals stale pages and no longer falls back to outdated stock quotes/search results when the local core reconnects.
- Right-click the tray icon to open the dashboard or exit. Exiting also stops a core process that the tray started.
- The packaged core searches upward from its own folder for the nearest `.env`, so a root project config remains discoverable even when the working directory is `release\core`.
- `MoneyMoney.ini` can point to the backend and working directory:

```ini
path=E:\MYC\predict-fun-trader\release\core\MoneyMoneyCore.exe
workdir=E:\MYC\predict-fun-trader
```

### Configuration

Copy `.env.example` to `.env` and fill in your keys (all optional for read-only mode):

```
PRIVATE_KEY=           # Predict.fun wallet private key
BINANCE_API_KEY=       # Binance API key
BINANCE_API_SECRET=    # Binance secret
TELEGRAM_BOT_TOKEN=    # Telegram bot token (optional)
TELEGRAM_CHAT_ID=      # Telegram chat ID (optional)
TELEGRAM_POLLING_ENABLED=false
TELEGRAM_ALLOWED_CHAT_IDS=
TELEGRAM_ADMIN_CHAT_IDS=
```

本地默认只监听 `127.0.0.1:3000`。如需在手机或局域网设备打开 PWA，可在 `.env` 中设置 `APP_HOST=0.0.0.0`，并按需修改 `APP_PORT`；这只改变监听地址，不会开启真实交易。

### License

MIT © 2024-2026 **吴家希（WJX）**

> 作者：吴家希（WJX） · GitHub [@blueicx](https://github.com/blueicx)

### Risk Notice / 风险提示

MoneyMoney is research software. Market data, rankings, signals, and cross-platform matches can be delayed, incomplete, or wrong. Trading involves substantial risk.

MoneyMoney 属于研究工具；行情、排名、信号和跨平台匹配可能延迟、不完整或有误。交易存在重大风险。
