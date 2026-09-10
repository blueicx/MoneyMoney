const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync('src/web/public/index.html', 'utf8');
const server = fs.readFileSync('src/web/server.ts', 'utf8');

test('macro workspace declares independent market sections', () => {
  assert.match(html, /data-collapse-key="stocks-macro" data-market-scopes="stocks crypto options overview"/);
  assert.match(html, /id="global-crypto-metrics" data-market-scopes="crypto overview"/);
  assert.match(html, /id="stablecoin-liquidity"/);
  assert.match(html, /data-market-scopes="crypto overview"><div[^>]*>😱 恐贪指数/);
  assert.match(html, /data-market-scopes="stocks overview"><div[^>]*>🏛️ CME 机构持仓雷达/);
});

test('generic function navigation preserves the selected market', () => {
  assert.match(html, /function marketScopeForTab\(\) \{ return null; \}/);
  assert.match(html, /function scopedUrl\(path\)/);
  assert.match(html, /if \(!isCurrentMarketScopeToken\(scopeToken\)\) return;/);
});

test('server exposes scoped advisor and paper contracts while keeping legacy URLs', () => {
  assert.match(server, /filterAssistantReport\(report, scope\)/);
  assert.match(server, /filterUnifiedPaperLedger\(ledger, scope\)/);
  assert.match(server, /app\.get\('\/api\/paper\/performance', \(req, res\)/);
  assert.match(server, /app\.get\('\/api\/events\/calendar', async \(req, res\)/);
});

test('analysis and risk markup declares market-specific sections', () => {
  assert.match(html, /data-analysis-scopes="prediction"/);
  assert.match(html, /data-analysis-scopes="crypto"/);
  assert.match(html, /data-analysis-scopes="stocks"/);
  assert.match(html, /data-analysis-scopes="options"/);
  assert.match(html, /scopedUrl\('\/api\/risk\/history\?limit=72'\)/);
  assert.match(html, /fetch\(scopedUrl\('\/api\/calibration'\)/);
});

test('ticker loads after scope initialization and uses market-specific data', () => {
  assert.match(html, /activeMarketScope = readInitialMarketScope\(\);[\s\S]*loadNewsTicker\(/);
  assert.match(html, /scopedUrl\('\/api\/market-ticker'\)/);
  assert.match(html, /data-market-scopes="overview stocks options crypto prediction watchlist"/);
  assert.match(html, /id="market-overview"[^>]*data-market-scopes="overview stocks options crypto prediction watchlist"/);
  assert.match(html, /function loadAll\([\s\S]*\['overview', 'prediction', 'watchlist'\]\.includes\(activeMarketScope\)/);
  assert.match(html, /activeMarketScope = readInitialMarketScope\(\);[\s\S]*loadAll\(\)/);
  assert.match(server, /app\.get\('\/api\/market-ticker'/);
  assert.match(server, /if \(scope === 'stocks'\)/);
  assert.match(server, /fetchTencentText\(`https:\/\/qt\.gtimg\.cn\/q=/);
  assert.match(server, /stockDataService\.quote/);
  assert.match(server, /if \(scope === 'options'\)/);
  assert.match(server, /getEquityOptionsSnapshot/);
});

test('market overview bar follows the selected market instead of disappearing', () => {
  assert.match(html, /id="market-overview"[^>]*data-market-scopes="overview stocks options crypto prediction watchlist"/);
  assert.match(html, /function loadMarketOverview\(\)[\s\S]*scope === 'stocks'/);
  assert.match(html, /scope === 'stocks'[\s\S]*\/api\/stock\/indices/);
  assert.match(html, /scope === 'options'[\s\S]*\/api\/market-ticker\?scope=options/);
  assert.match(html, /scope === 'prediction'[\s\S]*\/api\/prediction-radar\?cachedOnly=1/);
  assert.match(html, /scope === 'watchlist'[\s\S]*\/api\/watchlist/);
  assert.match(html, /isCurrentMarketScopeToken\(token\)/);
});

test('market overview keeps a scoped cache and exposes freshness state', () => {
  assert.match(html, /id="market-overview-status"/);
  assert.match(html, /const marketOverviewCache = new Map\(\)/);
  assert.match(html, /Date\.now\(\) - cached\.fetchedAt < MARKET_OVERVIEW_CACHE_TTL_MS/);
  assert.match(html, /marketOverviewCache\.get\(scope\)/);
  assert.match(html, /缓存 · 正在刷新/);
  assert.match(html, /market-overview-status.*数据更新时间/);
});

test('scope-sensitive heavy requests own abort controllers', () => {
  assert.match(html, /async function loadPortfolioRisk\(\)[\s\S]*currentRiskController = new AbortController\(\)[\s\S]*fetch\(scopedUrl\('\/api\/risk\/overview'\), \{ cache: 'no-store', signal \}\)/);
  assert.match(html, /fetch\(scopedUrl\('\/api\/risk\/history\?limit=72'\), \{ cache: 'no-store', signal \}\)/);
  assert.match(html, /fetch\(scopedUrl\('\/api\/advisor'\), \{ cache: 'no-store', signal \}\)/);
  assert.match(html, /if \(error\.name === 'AbortError'\) return;/);
});

test('watchlist overview never requests private risk data for guests', () => {
  assert.match(html, /if \(!window\.mm_isGuest\)\s*\{\s*requests\.push\(/);
  assert.match(html, /const counts = \{ stock: 0, option: 0, crypto: 0, prediction: 0 \}/);
  assert.match(html, /chips\.push\(chip\('期权'/);
});

test('market switches cancel every active scoped loader and stale ticker request', () => {
  assert.match(html, /function abortMarketScopedRequests\(\)[\s\S]*currentMarketOverviewController\?\.abort\(\)[\s\S]*currentNewsController\?\.abort\(\)[\s\S]*currentTickerController\?\.abort\(\)/);
  assert.match(html, /function setMarketScope\(scope, options = \{\}\) \{[\s\S]*abortMarketScopedRequests\(\)[\s\S]*marketScopeRequestEpoch \+= 1/);
  assert.match(html, /let currentTickerController = null/);
  assert.match(html, /loadNewsTicker\(\)[\s\S]*currentTickerController = new AbortController\(\)[\s\S]*fetch\(scopedUrl\('\/api\/market-ticker'\), \{ cache: 'no-store', signal \}\)/);
});

test('cross-asset correlation radar belongs to the overview workspace', () => {
  const overviewStart = html.indexOf('<div id="command-tab"');
  const overviewEnd = html.indexOf('<div id="markets-tab"', overviewStart);
  const cryptoStart = html.indexOf('<div id="binance-tab"');
  const cryptoEnd = html.indexOf('<div id="macro-tab"', cryptoStart);
  assert.ok(overviewStart >= 0 && overviewEnd > overviewStart);
  assert.ok(cryptoStart >= 0 && cryptoEnd > cryptoStart);
  const overviewMarkup = html.slice(overviewStart, overviewEnd);
  const cryptoMarkup = html.slice(cryptoStart, cryptoEnd);
  assert.match(overviewMarkup, /data-collapse-key="overview-cross-asset-correlation" data-market-scopes="overview"/);
  assert.doesNotMatch(cryptoMarkup, /binance-cross-asset-correlation/);
  const binanceLoaderStart = html.indexOf('async function loadBinanceDashboard()');
  const binanceLoaderEnd = html.indexOf('async function loadBinancePortfolio()', binanceLoaderStart);
  assert.doesNotMatch(html.slice(binanceLoaderStart, binanceLoaderEnd), /loadCrossAssetCorrelation\(\)/);
  assert.match(html, /if \(activeMarketScope === 'overview'\) loadCrossAssetCorrelation\(\);/);
  assert.match(html, /loadMarketOverview\(\);\s*if \(scope === 'overview'\) loadCrossAssetCorrelation\(\);/);
});

test('aborted analysis cannot block or reset a newer market analysis request', () => {
  assert.doesNotMatch(html, /async function loadTradeAssistant\(\) \{\n  if \(advisorLoading\) return;/);
  assert.match(html, /async function loadTradeAssistant\(\)[\s\S]*const controller = new AbortController\(\)[\s\S]*currentAnalysisController === controller/);
  assert.match(html, /if \(!isCurrentMarketScopeToken\(scopeToken\) \|\| signal\.aborted\) return;/);
});

test('research briefing owns a declared scoped controller and is cancelled on market changes', () => {
  assert.match(html, /let currentResearchBriefingController = null/);
  assert.match(html, /function abortMarketScopedRequests\(\)[\s\S]*currentResearchBriefingController\?\.abort\(\)/);
  assert.match(html, /loadResearchBriefing\(force = false\)[\s\S]*fetch\(scopedUrl\('\/api\/research\/daily-briefing'\), \{ cache: 'no-store', signal \}\)/);
  assert.match(html, /catch \(error\) \{[\s\S]*if \(error\.name === 'AbortError' \|\| !isCurrentMarketScopeToken\(token\)\) return;/);
});

test('stock dashboard requests share the market cancellation boundary', () => {
  assert.match(html, /let currentStockDashboardController = null/);
  assert.match(html, /function abortMarketScopedRequests\(\)[\s\S]*currentStockDashboardController\?\.abort\(\)/);
  assert.match(html, /async function loadStockQuotes\(\)[\s\S]*const controller = new AbortController\(\)[\s\S]*currentStockDashboardController = controller[\s\S]*Promise\.allSettled\(\[loadStockIndices\(signal\),\s*loadPopularStocks\(signal\),\s*loadStockWatchlistShortcuts\(signal\)\]\)/);
  assert.match(html, /loadStockIndices\(signal\)[\s\S]*fetch\('\/api\/stock\/indices', \{ signal \}\)/);
});

test('market overview requests have a bounded timeout and retain partial data', () => {
  assert.match(html, /const MARKET_OVERVIEW_REQUEST_TIMEOUT_MS = 12000/);
  assert.match(html, /function fetchMarketOverviewJson\(path, signal\)[\s\S]*setTimeout\(/);
  assert.match(html, /fetchMarketOverviewJson\('\/api\/stock\/indices', signal\)/);
  assert.match(html, /Promise\.allSettled\(requests\)/);
  assert.match(html, /部分成功/);
  assert.match(html, /if \(hasPartialFailure && cached\?\.html\) \{[\s\S]*显示上一份完整缓存/);
});

test('stock overview consumes the breadth contract without dropping index coverage', () => {
  assert.match(html, /indicesRes\.data\.slice\(0, 6\)/);
  assert.match(html, /bd\.leadingSectors/);
  assert.doesNotMatch(html, /bd\.hotSectors/);
});

test('macro is a common utility entry rather than the stock market entry', () => {
  assert.match(html, /\['macro', '[^']*宏观'\]/);
  assert.doesNotMatch(html, /CORE_NAV_ITEMS[\s\S]*\['stocks', '[^']*宏观'\]/);
  assert.match(html, /id="macro-tab"/);
});

test('server scopes risk history and risk exports', () => {
  assert.match(server, /filterRiskOverview\(rawOverview, scope\)/);
  assert.match(server, /getRiskHistory\(Number\.isFinite\(limit\) \? limit : 72, scope\)/);
  assert.match(server, /app\.get\('\/api\/export\/journal', \(req, res\)/);
  assert.match(server, /app\.get\('\/api\/export\/calibration', \(req, res\)/);
});

console.log('Market scope integration tests loaded');
