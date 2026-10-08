#!/usr/bin/env ts-node

/**

 * 💰 MONEYMONEY TRADING DASHBOARD

 */



import express from 'express';
import cors from 'cors';
import zlib from 'zlib';
import iconv from 'iconv-lite';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { config, isJwtSecretDefault, validateLoginConfiguration } from '../config';
import { buildEventEvidence, filterTimelineItems, type EventEvidence } from '../features/event-evidence';
import { assembleHistory } from '../features/portfolio-history';
import { FinancialTextIndex } from '../storage/financial-text-index';
import { createFinancialResearchRouter } from './financial-research-routes';
import { ResearchCommittee } from '../features/research-committee';
import { createResearchCommitteeRouter } from './research-committee-routes';
import { LiveKlineHub, liveKlineScope } from '../features/live-kline-stream';
import { createLiveKlineRouter } from './live-kline-routes';

import { getRuntimeTelegramConfig, parseChatIds, runtimeSecrets } from '../config/runtime-secrets';
import { api } from '../api';
import { createCacheEtag, globalCache } from '../features/performance-cache';

import { tradingEngine } from '../trading';

import { DataCollector } from '../analysis/collector';

import { AnalysisEngine } from '../analysis/engine';
import { paperEngine } from '../features/paper-trading';
import { telegram } from '../features/telegram';
import {
  TelegramInteractionBot,
  TelegramApiTransport,
  type TelegramCallbackHandler,
  type TelegramCommandHandler,
  type TelegramInlineKeyboardButton,
  type TelegramReply,
  escapeTelegramHtml,
  parseAllowedChatIds,
} from '../features/telegram-bot';
import { getTelegramMarketButtons, getTelegramMenuEntries, moveTelegramMenuPage, resetTelegramMenuPage } from './telegram-menu';
import { buildTelegramDeepLink, buildTelegramStockSearchRows, isTelegramWatchableStockId, telegramPublicBaseUrl } from './telegram-search';
import { handleTelegramStockSignalsCommand, type TelegramStockMoverDiscovery } from '../features/telegram-stock-signal-command';
import { TelegramStockSignalScanner, selectTelegramStockSignalAlerts, telegramStockSignalNotificationKey, paginateTelegramStockSignals } from '../features/telegram-stock-signals';
import { StockSignalSchedule, stockExchangeSession, stockQuoteObservationTime, isStockSignalNotificationFresh } from '../features/stock-signal-schedule';
import { TelegramSignalOutbox } from '../features/telegram-signal-outbox';
import { priceTracker } from '../features/price-tracker';
import { kellySizer, backtester, ASSET_BACKTEST_STRATEGY_VERSION } from '../features/kelly-backtest';
import { pushNotification } from '../features/notifications';
import { newsFeed, settingsManager } from '../features/news-settings';
import { getStockNews, getStockNewsSnapshot } from '../features/stock-news';
import { reportScheduler } from '../features/report-scheduler';
import { binanceFeed, alertManager, anomalyDetector } from '../features/binance';
import { llmAnalyzer, redditSentiment, whaleMonitor, strategyComparison, tradeJournal } from '../features/ai-social';
import { binancePortfolio } from '../features/binance-portfolio';
import { getEquityOptionsSnapshot, getOptionsSnapshot } from '../features/options-market';
import { getMacroCalendar, getGlobalCryptoMetrics } from '../features/external-market-data';
import { getStablecoinLiquidity } from '../features/stablecoin-liquidity';
import { getYieldQuality } from '../features/yield-quality';
import { getCotRadar } from '../features/cftc-positioning';
import { getInsiderRadar } from '../features/insider-transactions';
import { getAnalystConsensusSnapshot } from '../features/analyst-consensus';
import { getFundamentalQuality } from '../features/fundamental-quality';
import { getShortInterestSnapshot } from '../features/short-interest';
import { getMarketBreadthSnapshot } from '../features/market-breadth';
import { getInstitutionalOwnershipSnapshot } from '../features/institutional-ownership';
import { createGuruHoldingsRouter } from '../features/guru-holdings-router';
import * as guruHoldings from '../features/guru-holdings';
import { buildMarketChangeDigest, calculateEvidencePriceChanges, type MarketChangeRecord } from '../features/market-change-digest';
import { ActionCenterStore, buildActionCenter, type ActionCenterItem } from '../features/action-center';
import { startGuruHoldingsRefreshMonitor, stopGuruHoldingsRefreshMonitor } from '../features/guru-holdings-refresh-monitor';
import { getFearGreed, getFundingRates } from '../features/market-sentiment';
import { getGlobalMacroSpotSnapshot } from '../features/global-macro-spot';
import { getCrossAssetCorrelationRadar } from '../features/cross-asset-correlation';
import { getPerpetualCrowding } from '../features/perpetual-crowding';
import { ContractResearchService, contractIdentity, contractScenario } from '../features/contract-research';
import { loadContractPanelHistory } from '../features/contract-panel-history';
import { klinePageWindow, klinePageStatus } from '../features/kline-page-window';
import { contractCapacity, compareContractSnapshots } from '../features/contract-comparison';
import { compareAiRunnerReports } from '../features/ai-runner-comparison';
import { createAiRunnerComparison, getAiRunnerComparison, validateAiRunnerComparison, validateScheduledAiRunnerComparison, buildAiRunnerComparisonSample, saveAiRunnerComparisonSample, listAiRunnerComparisonSamples, replayAiRunnerComparisonSample, type AiRunnerComparisonSample } from '../features/ai-runner-comparison-group';
import { portfolioAttribution } from '../features/portfolio-attribution';
import { getFundingCarryRadar } from '../features/funding-carry';
import { getOrderFlowLiquidityRadar } from '../features/order-flow-liquidity';
import { getBitcoinOnchainRadar } from '../features/bitcoin-onchain';
import { getEconomicIndicators } from '../features/economic-indicators';
import { getTreasuryYields } from '../features/treasury-yields';
import { getEarningsCalendar } from '../features/earnings-calendar';
import { getUpcomingEventCalendar } from '../features/event-calendar';
import {
  decideEventReminder,
  type EventReminderThreshold,
} from '../features/event-alerts';
import { getCrossAssetRisk } from '../features/cross-asset-risk';
import { getMarketRegime } from '../features/market-regime';
import { getSupportResistance } from '../features/support-resistance';
import { getMultiTimeframeConfluence } from '../features/multi-timeframe';
import { getEventRisk } from '../features/event-risk';
import { getCachedPredictionRadarSlice, getPredictionRadar, warmPredictionRadarCache, type PredictionMarket, type PredictionRadar } from '../features/prediction-radar';
import { getPredictionHistory } from '../features/prediction-history';
import { getForecastLabReport, resolveForecastCase } from '../features/forecast-lab';
import { calculatePredictionPosition } from '../features/prediction-position-sizer';
import { aiCommentaryConfigured, getAiMarketCommentary } from '../features/ai-commentary';
import { getAiConfigurationStatus, testAiConnection, type AiChain } from '../features/ai-runtime-config';
import { unifiedInstrumentService, normalizeInstrumentRef, summarizeTimelineAvailability, filterEventsForInstrument, type InstrumentType } from '../features/unified-instruments';
import { stockDataService } from '../features/stock-data-service';
import { buildStockCoverageMap } from '../features/instrument-coverage';
import { MARKET_SCOPES, filterInstrumentResults, type MarketScope } from '../features/market-scope';
import { defaultWorkspace, isWorkspaceAllowed, resolveWorkspaceNavigation, type WorkspaceId } from '../features/market-workspace';
import { collectDashboardResults, resolveMarketDashboardCards, type DashboardProviderResult } from '../features/market-workspace-dashboard';
import { marketDepthCapabilities } from '../features/market-depth-capabilities';
import { filterAssistantReport, filterRiskOverview, filterUnifiedPaperLedger, scopeForAction } from '../features/market-scope-view';
import { unifiedAlertStore, triggerUnifiedAlerts, previewUnifiedAlerts, alertMetricFields, validateUnifiedAlertRule, evaluateUnifiedAlert, explainMetricConditions, type UnifiedAlertRule, type UnifiedAlertObservation } from '../features/unified-alerts';
import { completedBarMetrics } from '../features/alert-metrics';
import { buildPortfolioRiskOverview } from '../features/risk-overview';
import { getRiskHistory, recordRiskHistory } from '../features/risk-history';
import { buildDailyResearchBriefing } from '../features/research-briefing';
import { getAssistantCalibration, getAssistantJournalTrades, saveTradeNote } from '../features/assistant-journal';
import { exportJournalCsv, exportPaperCsv, exportCalibrationCsv, exportForecastLabCsv } from '../features/data-export';
import { analyzeStockSignalCandidate, generateAssistantReport } from '../features/trade-assistant';
import { getSourceHealth, refreshSourceHealth } from '../features/source-health';
import { summarizeSourceSlo } from '../features/source-health-slo';
import { zonedDigestClock } from '../features/digest-clock';
import { filterStockBarsForTradingDate, resolveStockExchangeTimeZone } from '../features/stock-intraday-kline';
import { buildBacktestPreflight } from '../features/backtest-preflight';
import { assessResearchFreshness } from '../features/research-freshness';
import { testNotificationChannels } from '../features/notification-channels';
import { runResearchExperiment } from '../features/experiment-runner';
import { compareExperiments } from '../features/experiment-comparison';
import { compareOptionSnapshots, summarizeMarketHistory } from '../features/market-history-comparison';
import { MarketHistoryCaptureScheduler } from '../features/market-history-scheduler';
import { mergeStockDisclosureTimeline } from '../features/stock-disclosure-timeline';
import { observeForwardSignal } from '../features/signal-forward';
import { assertMarketContext, createResearchJob, MARKET_IDS, type MarketId } from '../features/research-contracts';
import {
  analyzePortfolio,
  analyzeSignalQuality,
  canTransitionSignalStatus,
  buildDecisionReviewDraft,
  buildDueDecisionReviewDrafts,
  createDecisionRecord,
  createEvidenceSnapshot,
  createSavedWorkspace,
  getEvidenceChanges,
  importPortfolioRows,
  reviewDecision,
  runScenario,
  summarizeNegativeKnowledge,
  type PortfolioRow,
  type ScenarioDefinition,
} from '../features/decision-intelligence';
import { decisionIntelligenceStore } from '../features/decision-intelligence-store';
import { capturePortfolioSnapshots, comparePortfolioSnapshots } from '../features/portfolio-snapshot-history';
import { acknowledgeTelegramTestDelivery, listTelegramTestDeliveries, runTelegramTestDelivery } from '../features/telegram-test-delivery';
import { buildDecisionMobileSummary } from '../features/decision-mobile-summary';
import { researchRepository } from '../features/research-repository';
import { analyzeFactor, getFactorCatalog } from '../features/factor-lab';
import { StrategyCandidateRegistry } from '../features/strategy-candidates';
import { globalStrategyRegistry } from '../features/strategy-registry';
import { riskPatrol } from '../features/risk-patrol';
import { createAccessMiddleware, validateAccessConfiguration } from './access-control';
import { verifyLoginToken, extractAuthToken } from './auth';
import { registerApiAuthProtection, registerAuthRoutes } from './auth-routes';
import { registerBuiltAssets, sendBuiltPage } from './static-assets';
import { stateStore, getStorageHealth } from '../storage/sqlite-state';
import { TelegramEventResultMonitor, lookupOfficialEventResult } from '../features/telegram-event-results';
import { lookupTrackedResult, resultTrackingDisabledReason } from '../features/telegram-result-adapters';
import type { EventRecord as TelegramTrackedResult } from '../features/telegram-event-results';
import { renderTelegramKline } from '../features/telegram-kline-image';
import { DATA_ROOT } from '../utils/paths';
import { paperTradingExecutor } from '../features/trading-executor';
import { unifiedPaperLedgerStore, calculateUnifiedPerformance, replayUnifiedPaperOrders, type UnifiedPaperOrder } from '../features/unified-paper-trading';
import { paperChartLineage, resolvePaperChartInstrument } from '../features/paper-chart-lineage';
import { RunnerExecutionEvidenceStore, runnerSnapshotHash, runnerExecutionSnapshotId } from '../features/runner-execution-evidence';
import { predictionOutcomeQuote } from '../features/runner-prediction-quotes';
const runnerExecutionEvidence = new RunnerExecutionEvidenceStore(stateStore);
import { stockChartDisclosure } from '../features/stock-chart-disclosure';
import { logger } from '../utils/logger';
import { buildSourceSlo, runtimeObservability } from '../features/runtime-observability';
import { createDataEnvelope } from '../features/data-status';
import { dataLakeCatalog } from '../storage/data-lake';
import { dataLakeWorker } from '../storage/data-lake-worker';
import { EventStudyRepository, buildEventStudyCohort, classifyEventCategory, runEventStudy } from '../features/event-study';
import { PredictionSettlementRepository, buildPolymarketResolutionEndpoint, buildSettlementEndpoint, normalizeSettlementEvidence, settlementPayloadMatches } from '../features/prediction-settlement';
import { analyzePaperDrift, analyzePaperDriftByStrategy, collectPaperDriftSamples, summarizePaperDriftCoverage, samePaperInstrument, StrategyDriftGate } from '../features/paper-drift';
import { DataCoverageCanary, DEFAULT_DATA_COVERAGE_CANARY_TARGETS, shouldRunOncePerShanghaiDay, summarizeCoverageCanaryHistory, toPublicCoverageCanarySummary, type CanaryCapabilityResult, type CanaryDataStatus, type DataCoverageCanaryTarget, type DataCoverageCanaryRun } from '../features/data-coverage-canary';
import { summarizePublishedCoverage, type CoverageSourceObservation } from '../features/data-coverage-status';
import { buildEventEntities, clusterEventEntities, selectResearchEvent } from '../features/event-intelligence';
import { curlCommand } from '../utils/platform-command';
import { STOCK_KLINE_PERIODS, createYahooStockKlineAdapter } from '../data/yahoo-adapter';
import { createBinanceKlineAdapter } from '../data/binance-kline-adapter';
import { actionsForScreener, fieldsForScreener, filterRows, isScreenerScope, paginateRows, serializeTemplate, sortRows, type ScreenerFilter, type ScreenerScope, type ScreenerSort } from '../features/market-screener';
import { compareInstruments, createCompareSnapshot, type CompareInstrument, type CompareScope } from '../features/instrument-compare';
import { diffScreenerMembership } from '../features/workspace-experience';
import { ScreenerTrackingStore } from '../features/screener-tracking';
import {
  addResearchNote,
  addResearchSnapshot,
  getResearchEntry,
  listResearchEntries,
  summarizeResearchEntry,
  upsertResearchEntry,
} from '../features/research-workspace';
import {
  getAutomationJobs,
  getAutomationOverview,
  saveAutomationRun,
} from '../features/automation-ops';
import {
  parsePriceAlertArgs,
  parseSmartAlertArgs,
  parseWatchCommandArgs,
  parseDigestTime,
  routeNaturalLanguage,
  sparkline,
  isTelegramBareSymbol,
  isTelegramBareQueryScope,
  shouldSuppressTelegramAlert,
  telegramCommandCenterStore,
} from '../features/telegram-command-center';
import type { Category } from '../types';
import QRCode from 'qrcode';
import os from 'os';
import { parseRssItems } from '../utils/rss';

export const app = express();
const telegramStockSignalScanner = new TelegramStockSignalScanner({ store: stateStore, concurrency: 4, ttlMs: 15 * 60_000 });
const stockSignalSchedule = new StockSignalSchedule(stateStore);
const telegramStockSignalOutbox = new TelegramSignalOutbox(researchRepository,stateStore);
dataLakeWorker.start();
const strategyCandidateRegistry = new StrategyCandidateRegistry();
const eventStudyRepository = new EventStudyRepository(stateStore);
const predictionSettlementRepository = new PredictionSettlementRepository(stateStore);
const marketHistoryCaptureScheduler = new MarketHistoryCaptureScheduler(stateStore, 3);
const predictionSettlementRefreshes = new Map<string, Promise<ReturnType<typeof normalizeSettlementEvidence>>>();
const driftGate = new StrategyDriftGate(stateStore);
const dataCoverageCanary = new DataCoverageCanary(stateStore, checkCoverageCanaryTarget);
const cryptoCoverageAdapters = new Map<string, ReturnType<typeof createBinanceKlineAdapter>>();
let coverageCanaryRadarPromise: Promise<PredictionRadar> | null = null;
let coverageCanaryTimer: NodeJS.Timeout | null = null;
let coverageCanaryTask: Promise<DataCoverageCanaryRun | null> | null = null;
let paperDriftMonitorTimer: NodeJS.Timeout | null = null;
let paperDriftMonitorTask: Promise<unknown> | null = null;
let marketHistoryCaptureTimer: NodeJS.Timeout | null = null;
let marketHistoryCaptureTask: Promise<unknown> | null = null;
// A rejected optional/background data refresh must not take down the dashboard.
// Route handlers still report their own errors; this last-resort observer keeps
// long-lived local sessions alive and records the source error without secrets.
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled_promise_rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});
// The dashboard is local-first. Same-origin browser requests work normally;
// cross-origin callers must be explicitly enabled by the deployment layer.
app.use(cors({ origin: false }));
app.use(express.json());
app.use('/api', createAccessMiddleware({
  enabled: config.lanMode,
  token: config.accessToken,
  maxRequests: 180,
}));
// Every JSON API response gets the same request correlation field. This keeps
// source failures, retries, and browser/Telegram reports traceable without
// requiring each legacy route to hand-copy the request id.
app.use((req, res, next) => {
  const requestId = String(res.getHeader('X-Request-Id') || req.headers['x-request-id'] || crypto.randomUUID());
  res.setHeader('X-Request-Id', requestId);
  const originalJson = res.json.bind(res);
  res.json = ((body: any) => {
    if (body && typeof body === 'object' && !Array.isArray(body) && body.requestId == null) {
      return originalJson({ ...body, requestId });
    }
    return originalJson(body);
  }) as typeof res.json;
  next();
});
app.use('/api', (req, res, next) => {
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const isHealthEndpoint = req.path === '/health' || req.path.startsWith('/health/');
  if (isWrite && !isHealthEndpoint && !getStorageHealth().ok) {
    res.status(503).json({
      success: false,
      error: '状态存储不可用，系统已进入只读模式',
      requestId: res.getHeader('X-Request-Id') || null,
      storage: getStorageHealth(),
    });
    return;
  }
  next();
});
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const latencyMs = Date.now() - startedAt;
    runtimeObservability.recordHttp({ method: req.method, path: req.path, status: res.statusCode, latencyMs });
    logger.info('http_request', {
      requestId: res.getHeader('X-Request-Id') || null,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      latencyMs,
    });
  });
  next();
});

// Compress large text responses (the single-file dashboard is ~400KB raw).
app.use((req, res, next) => {
  if (!/\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''))) return next();
  if (res.headersSent) return next();
  const originalSend = res.send.bind(res);
  (res as any).send = (body: any) => {
    const contentType = String(res.getHeader('Content-Type') || '');
    const compressible = /text\/html|application\/json|javascript|text\/css|image\/svg/i.test(contentType);
    if (!compressible || res.getHeader('Content-Encoding')) return originalSend(body);
    const raw = Buffer.isBuffer(body)
      ? body
      : Buffer.from(typeof body === 'object' && body !== null ? JSON.stringify(body) : String(body ?? ''), 'utf8');
    if (raw.length < 2048) return originalSend(raw);
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Vary', 'Accept-Encoding');
    res.removeHeader('Content-Length');
    return originalSend(zlib.gzipSync(raw));
  };
  next();
});

app.use('/api', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
// Serve the main page before static middleware so it goes through compression.
app.get('/', (req, res) => {
  try {
    const token = extractAuthToken(req as any);
    if (!token || !verifyLoginToken(token)) {
      res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/'));
      return;
    }
  } catch {
    res.redirect('/login?next=' + encodeURIComponent(req.originalUrl || '/'));
    return;
  }
  sendBuiltPage(req, res, path.join(__dirname, 'public'), 'index.html');
});
// --- MoneyMoney 登录鉴权（与 LAN token 共存） ---
app.get('/login', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  try {
    const token = extractAuthToken(req as any);
    if (token && verifyLoginToken(token)) {
      res.redirect('/');
      return;
    }
  } catch {}
  sendBuiltPage(req, res, path.join(__dirname, 'public'), 'login.html');
});
registerAuthRoutes(app);
registerApiAuthProtection(app);
const liveKlineHub = new LiveKlineHub({ enabled: process.env.MONEYMONEY_KLINE_STREAM_ENABLED !== 'false' });
app.use('/api/kline-stream', createLiveKlineRouter(liveKlineHub));
app.use('/api/research/committee', createResearchCommitteeRouter(new ResearchCommittee({
  store: stateStore, evidence: id => decisionIntelligenceStore.getEvidence(id), runtime: () => getAiRuntimeConfig('openrouter'),
  resolve: (market, instrument) => dataLakeCatalog.resolveInstrument(market, instrument),
})));
let financialTextIndex: FinancialTextIndex | null = null;
app.use('/api/research/filings', createFinancialResearchRouter({
  index: () => financialTextIndex || (financialTextIndex = new FinancialTextIndex(stateStore.health.databasePath)),
}));

registerBuiltAssets(app, path.join(__dirname, 'public'));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));


// API Routes

// Market-scoped workspace contract shared by the dashboard and other clients.
app.get('/api/workspace/navigation', (req, res) => {
  const rawScope = String(req.query.scope || 'overview');
  if (!MARKET_SCOPES.includes(rawScope as MarketScope)) {
    return res.status(400).json({ success: false, error: '未知市场 scope' });
  }
  const scope = rawScope as MarketScope;
  return res.json({ success: true, scope, groups: resolveWorkspaceNavigation(scope) });
});

async function dashboardStockIndices(): Promise<DashboardProviderResult> {
  try {
    let data = getCached('stockIndices');
    let fetchedAt = responseCache.get('stockIndices')?.ts || null;
    if (!Array.isArray(data)) {
      const text = await fetchTencentText('https://qt.gtimg.cn/q=sh000001,sz399001,hkHSI,usDJI,usIXIC,usINX');
      data = await sanitizeUsQuoteNames(text.split(';').map(row => parseTencentStock(row.trim())).filter(Boolean));
      if (data.length) setCached('stockIndices', data);
      fetchedAt = responseCache.get('stockIndices')?.ts || Date.now();
    }
    const rows = (Array.isArray(data) ? data : []).filter((row: any) => Number(row.price) > 0);
    return {
      market: 'stocks', source: 'Tencent Finance', fetchedAt: fetchedAt ? new Date(fetchedAt).toISOString() : null,
      status: rows.length ? 'live' : 'empty', reason: rows.length ? '行情来源未暴露源端时间戳；展示 MoneyMoney 接收时间。' : 'Tencent Finance 请求成功，但没有可用指数记录。',
      metrics: rows.slice(0, 6).map((row: any) => ({ label: String(row.nameCN || row.name || row.code), value: Number(row.price), changePct: Number.isFinite(Number(row.changePct)) ? Number(row.changePct) : null })),
      data: rows.slice(0, 6).map((row: any) => ({ code: row.code, name: row.name, price: row.price, changePct: row.changePct })),
    };
  } catch (error) {
    return { market: 'stocks', status: 'failed', source: 'Tencent Finance', reason: error instanceof Error ? error.message : '股票指数请求失败', metrics: [], evidenceRefs: [] };
  }
}

function dashboardOptionsCoverage(): DashboardProviderResult {
  const rows = dataLakeCatalog.listCoverage('options').filter(row => row.dataset.toLowerCase().includes('options-chain'));
  const count = rows.reduce((sum, row) => sum + row.rowCount, 0);
  return {
    market: 'options', source: 'MoneyMoney 本地数据湖', status: rows.length ? 'historical' : 'empty',
    updatedAt: rows.map(row => row.latestPublishedAt).sort().at(-1) || null,
    metrics: rows.length ? [{ label: '已存合约行', value: count }, { label: '覆盖标的', value: new Set(rows.map(row => row.instrument)).size }, { label: '分区', value: rows.reduce((sum, row) => sum + row.partitionCount, 0) }] : [],
    reason: rows.length ? '只展示已提交的真实期权链快照；历史不足时不推算 IV/Greeks。' : '本地尚无真实期权链快照，不回填推测历史。', data: rows,
  };
}

async function buildDashboardProviderMap(scope: MarketScope, guest: boolean): Promise<Record<string, () => Promise<DashboardProviderResult> | DashboardProviderResult>> {
  const providers: Record<string, () => Promise<DashboardProviderResult> | DashboardProviderResult> = {};
  if (scope === 'overview') {
    providers['overview-markets'] = async () => {
      const [stockResult, cryptoResult] = await Promise.allSettled([dashboardStockIndices(), binanceFeed.getMultiplePrices(['BTCUSDT', 'ETHUSDT'])]);
      const metrics: NonNullable<DashboardProviderResult['metrics']> = [];
      const sources: string[] = [];
      const missing: string[] = [];
      if (stockResult.status === 'fulfilled' && stockResult.value.metrics?.length) { metrics.push(...stockResult.value.metrics.slice(0, 3)); sources.push('Tencent Finance'); } else missing.push('股票指数');
      if (cryptoResult.status === 'fulfilled' && Object.keys(cryptoResult.value).length) {
        Object.values(cryptoResult.value).forEach((ticker: any) => metrics.push({ label: ticker.symbol, value: ticker.price, changePct: ticker.change24hPct })); sources.push('Binance Public');
      } else missing.push('虚拟币行情');
      const prediction = getCachedPredictionRadarSlice('', 240);
      if (prediction) { metrics.push({ label: '预测市场机会', value: prediction.opportunities.length }); sources.push('预测市场缓存'); } else missing.push('预测市场缓存');
      return { market: 'overview', source: sources.join(' / ') || '跨市场摘要', status: !sources.length ? 'unavailable' : missing.length ? 'partial' : 'cached',
        updatedAt: prediction?.updatedAt || (stockResult.status === 'fulfilled' ? stockResult.value.fetchedAt || null : null), metrics: metrics.slice(0, 8),
        reason: missing.length ? `未取得${missing.join('、')}；仅展示当前成功来源。` : '各市场数据分别读取，不跨市场填充。' };
    };
    providers['overview-events'] = async () => {
      const calendar = await getUpcomingEventCalendar(2);
      const states = Object.values(calendar.sourceStatus || {});
      const succeeded = states.filter(value => ['live', 'cached', 'partial'].includes(value)).length;
      return { market: 'overview', source: calendar.source, fetchedAt: calendar.fetchedAt,
        status: !succeeded ? 'unavailable' : calendar.events.length ? (succeeded < states.length ? 'partial' : 'live') : 'empty',
        metrics: calendar.events.length ? [{ label: '未来两天事件', value: calendar.events.length }, ...calendar.events.slice(0, 3).map(item => ({ label: item.categoryLabel, value: item.titleZh || item.title }))] : [],
        reason: calendar.events.length ? calendar.warnings.join('；') || null : succeeded ? '事件源成功响应，未来两天暂无记录。' : Object.values(calendar.sourceReasons || {}).join('；') || '事件来源不可用。', data: calendar.events.slice(0, 10) };
    };
  } else if (scope === 'stocks') {
    providers['stock-indices'] = dashboardStockIndices;
    providers['stock-breadth'] = async () => {
      const data = await getMarketBreadthSnapshot();
      return { market: 'stocks', source: data.source, updatedAt: data.generatedAt, status: 'live',
        metrics: [{ label: '上涨占比', value: data.advancersPct, unit: '%' }, { label: '上涨/下跌', value: `${data.advancers}/${data.decliners}` }, { label: '平均涨跌', value: data.averageChangePct, unit: '%' }, ...data.leadingSectors.slice(0, 2).map(item => ({ label: item.nameZh || item.name, value: item.advancersPct, unit: '%' }))],
        reason: data.summaryZh, data };
    };
    providers['stock-events'] = async () => {
      const data = await getEarningsCalendar();
      return { market: 'stocks', source: data.source, fetchedAt: data.fetchedAt, status: data.count ? 'live' : 'empty',
        metrics: data.count ? [{ label: '当日财报公司', value: data.count }, ...data.items.slice(0, 3).map(item => ({ label: item.symbol, value: item.timingLabel }))] : [],
        reason: data.count ? 'Nasdaq 当日财报日历；这是市场级数据，不代表任一单只股票已发布事件。' : 'Nasdaq 请求成功，但当前日期暂无日历记录。', data: data.items.slice(0, 20) };
    };
    if (!guest) providers['stock-guru-watchlist'] = async () => {
      const symbols = [...new Set(unifiedAlertStore.listWatchlist().flatMap(id => { const match = String(id || '').match(/^stock:us:([A-Z][A-Z0-9.-]{0,9})$/i); return match ? [match[1].toUpperCase()] : []; }))].slice(0, 20);
      if (!symbols.length) return { market: 'stocks', status: 'empty', source: 'SEC EDGAR Form 13F', reason: '自选中没有可比较的美股标的。', metrics: [] };
      const snapshots = await Promise.all(symbols.map(symbol => guruHoldings.getGuruStockHolders(symbol).catch(error => ({ market: 'stocks' as const, instrument: symbol, dataStatus: 'failed' as const, source: 'SEC EDGAR Form 13F', updatedAt: null, reason: error instanceof Error ? error.message : '读取 SEC 快照失败', evidenceRefs: [], mapping: null, holders: [], caveats: [] }))));
      const rows = snapshots.flatMap(snapshot => snapshot.holders.map(holder => ({ symbol: snapshot.instrument, manager: holder.manager.personAssociation || holder.manager.filingName, reportPeriod: holder.reportPeriod, filedAt: holder.filedAt, change: holder.change, shareDelta: holder.shareDelta, sourceUrl: holder.sourceUrl })));
      const hasFailure = snapshots.some(snapshot => ['failed', 'unavailable', 'partial'].includes(snapshot.dataStatus));
      return { market: 'stocks', source: 'SEC EDGAR Form 13F', status: rows.length ? hasFailure ? 'partial' : 'historical' : hasFailure ? 'unavailable' : 'empty',
        updatedAt: snapshots.map(snapshot => snapshot.updatedAt).filter((value): value is string => Boolean(value)).sort().at(-1) || null,
        metrics: [{ label: '自选股票', value: symbols.length }, { label: '机构披露行', value: rows.length }, { label: '报告变化', value: rows.filter(row => !['unchanged', 'unavailable'].includes(row.change)).length }],
        reason: rows.length ? '13F 是季度滞后披露；逐机构呈现，不汇总成市场总持仓。' : snapshots.map(snapshot => snapshot.reason).filter(Boolean).slice(0, 3).join('；') || '已读取 SEC 快照，但当前自选无可比较披露。',
        evidenceRefs: [...new Set(snapshots.flatMap(snapshot => snapshot.evidenceRefs || []))], data: rows.slice(0, 30) };
    };
  } else if (scope === 'options') {
    providers['option-chain'] = dashboardOptionsCoverage;
    providers['option-volatility'] = () => { const result = dashboardOptionsCoverage(); return { ...result, reason: result.status === 'historical' ? '仅展示真实期权链历史覆盖；没有足够快照时不推算 IV/Greeks。' : '没有可验证的本地期权链历史，IV/Greeks 暂不可用。' }; };
    providers['option-events'] = () => ({ market: 'options', status: 'unsupported', source: '期权事件映射', reason: '尚未指定期权及底层标的；不会将股票市场事件直接填入期权看板。' });
  } else if (scope === 'crypto') {
    providers['crypto-prices'] = async () => {
      const data = await binanceFeed.getMultiplePrices(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']);
      const rows = Object.values(data);
      return { market: 'crypto', source: 'Binance Public', fetchedAt: new Date().toISOString(), status: rows.length ? 'live' : 'unavailable',
        metrics: rows.map(item => ({ label: item.symbol, value: item.price, changePct: item.change24hPct })), data: rows,
        reason: rows.length ? 'Binance 适配器未提供源端时间戳；时间为 MoneyMoney 接收时间。' : 'Binance 公共行情未返回数据；适配器没有区分空响应和请求失败。' };
    };
    providers['crypto-derivatives'] = async () => {
      const data = await getPerpetualCrowding(); const rows = data.rows || [];
      return { market: 'crypto', source: data.source, fetchedAt: data.generatedAt, status: rows.length ? 'cached' : 'empty',
        metrics: rows.slice(0, 4).map(item => ({ label: `${item.symbol} 资金费率`, value: item.fundingRatePct, unit: '%' })), reason: rows.length ? '公开永续快照来自现有适配器缓存。' : '来源成功，但当前没有可展示永续合约记录。', data: rows };
    };
    providers['crypto-chain'] = async () => {
      const data = await getBitcoinOnchainRadar();
      return { market: 'crypto', source: data.source, fetchedAt: data.generatedAt, status: 'cached', metrics: data.metrics.slice(0, 3).map(item => ({ label: item.labelZh, value: item.displayZh })), reason: data.summaryZh, data };
    };
  } else if (scope === 'prediction') {
    const cachedPrediction = (): DashboardProviderResult => {
      const data = getCachedPredictionRadarSlice('', 240);
      if (!data) return { market: 'prediction', status: 'unavailable', source: '预测市场公共雷达缓存', reason: '当前进程没有预测市场缓存；看板不主动触发上游抓取。' };
      const sourceStates = Object.values(data.sources || {}); const succeeded = sourceStates.filter(item => item.ok).length;
      return { market: 'prediction', source: 'Predict.fun / 公共雷达缓存', updatedAt: data.updatedAt || null, status: !succeeded ? 'unavailable' : data.opportunities.length ? 'cached' : 'empty',
        metrics: [{ label: '有效市场', value: data.markets.length }, { label: '可查看机会', value: data.opportunities.length }],
        reason: data.opportunities.length ? '读取预测市场自身的公共缓存。' : succeeded ? '来源成功响应，但当前快照没有可展示机会。' : '预测市场来源不可用。', data: { markets: data.markets.length, opportunities: data.opportunities.length } };
    };
    providers['prediction-probability'] = cachedPrediction;
    providers['prediction-liquidity'] = cachedPrediction;
  } else if (scope === 'watchlist' && !guest) {
    providers['watchlist-summary'] = () => {
      const ids = unifiedAlertStore.listWatchlist(); const counts = { stocks: 0, options: 0, crypto: 0, prediction: 0 };
      ids.forEach(id => { if (/^stock:/i.test(id)) counts.stocks += 1; else if (/^option:/i.test(id)) counts.options += 1; else if (/^(crypto|binance):/i.test(id)) counts.crypto += 1; else if (/^(prediction|predict|market):/i.test(id)) counts.prediction += 1; });
      return { market: 'watchlist', source: '管理员自选库', status: ids.length ? 'historical' : 'empty', metrics: Object.entries(counts).map(([label, value]) => ({ label, value })), reason: ids.length ? '按显式市场 ID 分组显示，不跨市场填充。' : '管理员自选库为空。' };
    };
    providers['watchlist-events'] = () => ({ market: 'watchlist', status: 'unsupported', source: '市场专属事件源', reason: '自选页包含多个市场；请切换至具体市场查看事件。' });
  }
  return providers;
}

app.get('/api/workspace/dashboard', async (req, res) => {
  const rawScope = String(req.query.scope || 'overview');
  if (!MARKET_SCOPES.includes(rawScope as MarketScope)) {
    return res.status(400).json({ success: false, error: '未知市场 scope' });
  }
  const scope = rawScope as MarketScope;
  const guest = (req as any).user?.role === 'guest';
  try {
    const providers = await buildDashboardProviderMap(scope, guest);
    const results = await collectDashboardResults(providers);
    return res.json({ success: true, scope, cards: resolveMarketDashboardCards(scope, results, { guest }) });
  } catch (error) {
    const cards = resolveMarketDashboardCards(scope, {}, { guest }).map(card => ({ ...card, status: 'failed' as const, reason: error instanceof Error ? error.message : '看板数据聚合失败' }));
    return res.json({ success: true, scope, cards });
  }
});

const MARKET_DIGEST_PENDING_KEY = 'market-change-digest:pending';
const MARKET_DIGEST_ACK_KEY = 'market-change-digest:acknowledged';
const MARKET_DIGEST_VIEWED_KEY = 'market-change-digest:last-viewed';

function canonicalDigestWatchlist(ids: string[]): Array<{ market: MarketId; instrument: string; symbol?: string }> {
  const result = new Map<string, { market: MarketId; instrument: string; symbol?: string }>();
  for (const raw of ids.slice(0, 100)) {
    const id = String(raw || '').trim();
    if (!id) continue;
    let ref = telegramRefFromId(id);
    if (!ref && isTelegramWatchableStockId(id)) {
      const match = id.match(/^(us|hk|sh|sz|bj)(.+)$/i);
      if (match) {
        const venue = ({ us: 'us', hk: 'hk', sh: 'sh', sz: 'sz', bj: 'bj' } as Record<string, string>)[match[1].toLowerCase()];
        ref = normalizeInstrumentRef({ type: 'stock', venue, symbol: /^(sh|sz|bj)$/i.test(match[1]) ? `${match[1]}${match[2]}` : match[2], title: id, aliases: [] });
      }
    }
    if (!ref) continue;
    const market: MarketId = ref.type === 'stock' ? 'stocks' : ref.type === 'option' ? 'options' : ref.type === 'crypto' ? 'crypto' : 'prediction';
    const instrument = String(ref.id || '').trim();
    if (!instrument) continue;
    result.set(`${market}:${instrument}`, { market, instrument, ...(ref.type === 'stock' ? { symbol: String(ref.symbol || '').toUpperCase() } : {}) });
  }
  return [...result.values()];
}

async function buildSharedMarketChangeDigest(ids: string[], since: string): Promise<MarketChangeRecord[]> {
  const watched = canonicalDigestWatchlist(ids);
  const watchedByMarket = new Map<MarketId, Set<string>>();
  watched.forEach(item => watchedByMarket.set(item.market, new Set([...(watchedByMarket.get(item.market) || []), item.instrument])));
  const records: MarketChangeRecord[] = [];
  const markets: MarketId[] = ['stocks', 'options', 'crypto', 'prediction'];

  for (const market of markets) {
    const marketWatchlist = [...(watchedByMarket.get(market) || new Set<string>())];
    const evidence = decisionIntelligenceStore.listEvidence(market).slice(0, 2_000);
    const canonicalEvidence = evidence.map(item => {
      const identity = item.instrument ? canonicalDigestWatchlist([item.instrument]).find(row => row.market === market) : undefined;
      return identity ? { ...item, instrument: identity.instrument } : item;
    });
    records.push(...calculateEvidencePriceChanges(canonicalEvidence.map(item => ({
      id: item.id, market: item.market, instrument: item.instrument, source: item.source,
      fetchedAt: item.fetchedAt, fields: item.fields, dataStatus: item.dataStatus,
    })), { since, watchlist: marketWatchlist, minimumChangePct: 1 }));

    for (const item of canonicalEvidence) {
      if (!item.instrument || !marketWatchlist.includes(item.instrument)) continue;
      const title = typeof item.fields.title === 'string' ? item.fields.title : '';
      if (!title || item.workspace !== 'event-intelligence') continue;
      const publishedAt = typeof item.fields.publishedAt === 'string' ? item.fields.publishedAt : item.observedAt;
      const sourceUrl = typeof item.fields.sourceUrl === 'string' ? item.fields.sourceUrl : item.source.url || undefined;
      const kind = /news|headline/i.test(String(item.fields.kind || '')) ? 'news' : 'event';
      records.push({
        id: `evidence:${item.id}`, dedupeKey: item.id, market, instrument: item.instrument, kind,
        title, summary: item.reason || undefined, source: item.source.name, sourceUrl,
        occurredAt: typeof item.fields.occurredAt === 'string' ? item.fields.occurredAt : undefined,
        publishedAt, observedAt: item.observedAt, evidenceRefs: [item.id, ...(sourceUrl ? [sourceUrl] : [])], dataStatus: item.dataStatus,
      });
    }

    for (const signal of decisionIntelligenceStore.listSignalOutcomes(market).slice(0, 5_000)) {
      const identity = canonicalDigestWatchlist([signal.instrument]).find(row => row.market === market);
      if (!identity || !marketWatchlist.includes(identity.instrument)) continue;
      const triggeredMillis = Number(signal.triggeredAt);
      if (!Number.isFinite(triggeredMillis)) continue;
      const triggeredAt = new Date(triggeredMillis).toISOString();
      records.push({ id: `signal:${signal.id}`, dedupeKey: signal.id, market, instrument: identity.instrument,
        kind: 'signal', title: signal.pattern || signal.strategyId || '策略信号',
        summary: `${signal.status || 'generated'} · ${signal.source} · ${signal.timeframe}`,
        source: signal.source, observedAt: triggeredAt, evidenceRefs: signal.evidenceRefs || [],
        dataStatus: 'historical' });
    }

    for (const event of researchRepository.listSourceHealthEvents(market, 200)) {
      if (!['outage', 'recovery'].includes(String(event.kind)) || !event.at) continue;
      records.push({ id: `source:${event.id}`, dedupeKey: event.id, market,
        kind: event.kind === 'recovery' ? 'source-recovery' : 'source-outage',
        title: `${event.sourceName || event.sourceId || '数据源'}${event.kind === 'recovery' ? '已恢复' : '故障'}`,
        summary: event.detail || `${event.from || 'unknown'} → ${event.to || 'unknown'}`,
        source: event.sourceName || event.sourceId, observedAt: event.at, dataStatus: event.to || 'unavailable' });
    }
  }

  // Public Yahoo news is queried only for a bounded set of explicitly watched US stocks.
  const watchedStocks = watched.filter(item => item.market === 'stocks' && item.symbol).slice(0, 5);
  const newsResults = await Promise.allSettled(watchedStocks.map(async item => ({ item, snapshot: await getStockNewsSnapshot(item.symbol!) })));
  for (const result of newsResults) {
    if (result.status !== 'fulfilled') {
      const item = watchedStocks[newsResults.indexOf(result)];
      if (!item) continue;
      const observedAt = new Date().toISOString();
      const reason = result.reason instanceof Error ? result.reason.message : '新闻来源请求失败';
      records.push({ id: `source-failure:news:${item.instrument}:${observedAt.slice(0, 13)}`, dedupeKey: `news:${item.instrument}:${observedAt.slice(0, 13)}`,
        market: 'stocks', instrument: item.instrument, kind: 'source-failure', title: 'Yahoo Finance 新闻请求失败',
        summary: reason.slice(0, 240), source: 'Yahoo Finance', observedAt, dataStatus: 'failed' });
      continue;
    }
    const { item, snapshot } = result.value;
    for (const news of snapshot.items.slice(0, 3)) {
      const observedAt = snapshot.retrievedAt || news.publishedAt;
      const id = crypto.createHash('sha256').update(`${item.instrument}:${news.url}`).digest('hex').slice(0, 20);
      records.push({ id: `news:${id}`, dedupeKey: news.url, market: 'stocks', instrument: item.instrument,
        kind: 'news', title: news.title, source: news.source, sourceUrl: news.url,
        publishedAt: news.publishedAt, observedAt, dataStatus: snapshot.status });
    }
  }

  // SEC 13F rows are already locally cached and identity-mapped; expose each manager separately.
  const guruStocks = watchedStocks.slice(0, 5);
  const guruResults = await Promise.allSettled(guruStocks.map(async item => ({ item, snapshot: await guruHoldings.getGuruStockHolders(item.symbol!) })));
  for (const result of guruResults) {
    if (result.status !== 'fulfilled') {
      const item = guruStocks[guruResults.indexOf(result)];
      if (!item) continue;
      const observedAt = new Date().toISOString();
      const reason = result.reason instanceof Error ? result.reason.message : 'SEC 13F 快照读取失败';
      records.push({ id: `source-failure:13f:${item.instrument}:${observedAt.slice(0, 13)}`, dedupeKey: `13f:${item.instrument}:${observedAt.slice(0, 13)}`,
        market: 'stocks', instrument: item.instrument, kind: 'source-failure', title: 'SEC 13F 来源请求失败',
        summary: reason.slice(0, 240), source: 'SEC EDGAR Form 13F', observedAt, dataStatus: 'failed' });
      continue;
    }
    const { item, snapshot } = result.value;
    for (const row of snapshot.holders) {
      if (!row.filedAt || ['unchanged', 'unavailable'].includes(row.change)) continue;
      records.push({ id: `13f:${item.instrument}:${row.manager.cik}:${row.reportPeriod}`, dedupeKey: `${row.manager.cik}:${row.reportPeriod}:${item.instrument}`,
        market: 'stocks', instrument: item.instrument, kind: '13f-change',
        title: `${row.manager.personAssociation || row.manager.filingName}：${row.change}`,
        summary: `报告期 ${row.reportPeriod} · 申报 ${row.filedAt}${row.shareDelta == null ? '' : ` · 股数变化 ${row.shareDelta > 0 ? '+' : ''}${row.shareDelta}`}`,
        source: 'SEC EDGAR Form 13F', sourceUrl: row.sourceUrl, publishedAt: row.filedAt, observedAt: row.filedAt,
        evidenceRefs: [row.sourceUrl], dataStatus: snapshot.dataStatus });
    }
  }

  return buildMarketChangeDigest({ records, watchlist: watched.map(item => item.instrument), since, limit: 60 });
}

const actionCenterStore = new ActionCenterStore(stateStore);
async function collectWatchlistActions(ids: string[], suppliedDigest?: MarketChangeRecord[]): Promise<ActionCenterItem[]> {
  const now = new Date().toISOString();
  const watched = canonicalDigestWatchlist(ids);
  const digest = suppliedDigest || await buildSharedMarketChangeDigest(ids, new Date(Date.now() - 7 * 86400_000).toISOString());
  const items: ActionCenterItem[] = digest.map(row => ({
    id: row.id, market: row.market, instrument: row.instrument,
    kind: row.kind === '13f-change' ? '13f' : row.kind === 'price-change' ? 'price' : row.kind.startsWith('source-') ? 'source' : row.kind === 'signal' ? 'signal' : 'event',
    title: row.title, summary: row.summary, occurredAt: row.occurredAt, publishedAt: row.publishedAt,
    observedAt: row.observedAt, source: row.source || '未声明来源', sourceUrl: row.sourceUrl,
    dataStatus: row.dataStatus || 'cached', evidenceRefs: row.evidenceRefs || [],
  }));
  const watchedSet = new Set(watched.map(row => row.instrument));
  for (const row of unifiedAlertStore.listHistory(100).filter(row => row.ownerId === 'admin' && watchedSet.has(row.instrumentId))) {
    const ref = watched.find(item => item.instrument === row.instrumentId)!;
    items.push({ id: `alert:${row.id}`, market: ref.market, instrument: ref.instrument, kind: 'alert', title: row.message,
      observedAt: row.createdAt, source: 'MoneyMoney 提醒记录', dataStatus: 'historical', evidenceRefs: [] });
  }
  for (const row of loadScreenerTracking()) {
    if (!watched.some(item => item.market === row.scope)) continue;
    items.push({ id: `screener:${row.runId || row.templateId + ':' + row.attemptedAt}`, market: row.scope as MarketId, kind: 'screener', title: `筛选跟踪：${row.name}`,
      summary: row.lastStatus === 'failed' ? row.reason || '来源失败' : `新进 ${row.entered.length} · 退出 ${row.exited.length}`, observedAt: row.attemptedAt,
      source: row.source || '筛选跟踪历史', dataStatus: row.dataStatus, reason: row.reason || undefined, evidenceRefs: [] });
  }
  for (const market of MARKET_IDS) for (const decision of decisionIntelligenceStore.listDecisions(market)) {
    if (decision.status !== 'open' || Date.parse(decision.horizonAt) > Date.now() || !watchedSet.has(decision.instrument)) continue;
    items.push({ id: `review:${decision.id}`, market, instrument: decision.instrument, kind: 'review', title: '决策已到期，等待复盘', summary: decision.thesis,
      observedAt: decision.horizonAt, source: '私人决策日记', dataStatus: 'historical', evidenceRefs: decision.evidenceIds, decisionId: decision.id });
  }
  if (watched.some(row => row.market === 'stocks')) {
    try {
      const calendar = await getUpcomingEventCalendar(7);
      for (const ref of watched.filter(row => row.market === 'stocks')) {
        for (const event of filterEventsForInstrument(calendar.events, { type: 'stock', symbol: ref.symbol || '' })) {
          items.push({ id: `upcoming:${ref.instrument}:${event.id}`, market: 'stocks', instrument: ref.instrument, kind: 'event', title: event.titleZh || event.title,
            summary: event.detailZh || event.detail, occurredAt: event.date, observedAt: calendar.fetchedAt, source: event.source,
            dataStatus: calendar.sourceStatus?.earnings || (calendar.stale ? 'cached' : 'delayed'), evidenceRefs: [], eventId: event.id,
            reason: calendar.sourceReasons?.earnings });
        }
      }
    } catch (error) {
      items.push({ id: 'source:upcoming-calendar', market: 'stocks', kind: 'source', title: '未来事件来源请求失败', observedAt: now,
        source: '事件日历', dataStatus: 'failed', reason: error instanceof Error ? error.message : '请求失败', evidenceRefs: [] });
    }
  }
  return items;
}

app.get('/api/watchlist/action-center', async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = req.query.market ? decisionMarket(req.query.market) : undefined;
    const records = await collectWatchlistActions(unifiedAlertStore.listWatchlist());
    const result = buildActionCenter(records, { market, states: actionCenterStore.states('admin') });
    stateStore.set('action-center:items:admin', records);
    const failures = result.items.some(row => ['failed', 'unavailable', 'partial'].includes(row.dataStatus));
    return res.json({ success: true, ...result, market: market || 'overview', source: '自选、提醒、筛选、13F与决策记录',
      dataStatus: failures ? 'partial' : result.dataStatus, evidenceRefs: [...new Set(result.items.flatMap(row => row.evidenceRefs))] });
  } catch (error) { return res.status(500).json({ success: false, dataStatus: 'failed', reason: error instanceof Error ? error.message : '行动中心加载失败' }); }
});
app.patch('/api/watchlist/action-center/:id', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const item = (stateStore.get<ActionCenterItem[]>('action-center:items:admin') || []).find(row => row.id === String(req.params.id));
  if (!item) return res.status(404).json({ success: false, reason: '记录不存在，请刷新行动中心' });
  try {
    const change = req.body || {};
    if (Object.keys(change).some(key => !['read', 'pinned', 'snoozedUntil'].includes(key))) throw new Error('不支持的处理字段');
    return res.json({ success: true, id: item.id, market: item.market, data: actionCenterStore.update('admin', item, change), source: 'SQLite 私人处理状态', dataStatus: 'cached' });
  } catch (error) { return res.status(400).json({ success: false, reason: error instanceof Error ? error.message : '处理失败' }); }
});

app.get('/api/changes/digest', async (req, res) => {
  const guest = (req as any).user?.role === 'guest';
  const now = new Date().toISOString();
  try {
    const requestedSince = String(req.query.since || '').trim();
    const since = requestedSince && Number.isFinite(Date.parse(requestedSince))
      ? new Date(requestedSince).toISOString()
      : (guest ? new Date(Date.now() - 24 * 60 * 60_000).toISOString() : stateStore.get<string>(MARKET_DIGEST_VIEWED_KEY) || new Date(Date.now() - 24 * 60 * 60_000).toISOString());
    const watchlist = guest ? [] : unifiedAlertStore.listWatchlist();
    const fresh = await buildSharedMarketChangeDigest(watchlist, since);
    const acknowledged = new Set(guest ? [] : stateStore.get<string[]>(MARKET_DIGEST_ACK_KEY) || []);
    const pending = guest ? [] : stateStore.get<MarketChangeRecord[]>(MARKET_DIGEST_PENDING_KEY) || [];
    const merged = new Map<string, MarketChangeRecord>();
    [...pending, ...fresh].forEach(item => { if (!acknowledged.has(item.id)) merged.set(item.id, item); });
    const records = [...merged.values()].sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt)).slice(0, 60);
    const hasFailures = records.some(item => item.kind === 'source-failure' || item.kind === 'source-outage');
    if (!guest) {
      stateStore.set(MARKET_DIGEST_PENDING_KEY, records, 1);
      stateStore.set(MARKET_DIGEST_VIEWED_KEY, now, 1);
    }
    return res.json({ success: true, market: 'overview', instrument: null, data: records, records,
      dataStatus: records.length ? hasFailures ? 'partial' : fresh.length ? 'live' : 'cached' : 'empty', source: 'shared web/Telegram market-change digest',
      updatedAt: now, reason: hasFailures ? '摘要包含来源故障记录；其余有效变化仍按市场与标的隔离展示。' : records.length ? null : guest ? '访客摘要不读取私人自选；当前没有公开来源故障记录。' : '自上次查看以来暂无新的自选变化。',
      evidenceRefs: [...new Set(records.flatMap(item => item.evidenceRefs || []))], guest });
  } catch (error) {
    return res.status(500).json({ success: false, market: 'overview', instrument: null, data: [], records: [],
      dataStatus: 'failed', source: 'shared web/Telegram market-change digest', updatedAt: now,
      reason: error instanceof Error ? error.message : '变化摘要生成失败', evidenceRefs: [] });
  }
});

app.post('/api/changes/digest/ack', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const id = String(req.body?.id || '').trim();
  if (!id || id.length > 160) return res.status(400).json({ success: false, error: '摘要记录 ID 无效' });
  const pending = stateStore.get<MarketChangeRecord[]>(MARKET_DIGEST_PENDING_KEY) || [];
  if (!pending.some(item => item.id === id)) return res.status(404).json({ success: false, error: '摘要记录不存在或已确认' });
  const acknowledged = stateStore.get<string[]>(MARKET_DIGEST_ACK_KEY) || [];
  stateStore.set(MARKET_DIGEST_ACK_KEY, [...new Set([...acknowledged, id])].slice(-5_000), 1);
  stateStore.set(MARKET_DIGEST_PENDING_KEY, pending.filter(item => item.id !== id), 1);
  stateStore.appendAudit({ id: `market-digest-ack:${crypto.randomUUID()}`, action: 'market_change_digest_ack', detail: `管理员已确认摘要记录 ${id}` });
  return res.json({ success: true, id, acknowledgedAt: new Date().toISOString(), dataStatus: 'live', source: 'MoneyMoney local digest state', reason: null });
});

app.get('/api/market-depth/capabilities', (req, res) => {
  const rawScope = String(req.query.scope || 'overview');
  if (!MARKET_SCOPES.includes(rawScope as MarketScope)) {
    return res.status(400).json({ success: false, error: '未知市场 scope' });
  }
  const scope = rawScope as MarketScope;
  return res.json({ success: true, scope, capabilities: marketDepthCapabilities(scope) });
});

app.get('/api/workspace/context', (req, res) => {
  const rawScope = String(req.query.scope || 'overview');
  if (!MARKET_SCOPES.includes(rawScope as MarketScope)) {
    return res.status(400).json({ success: false, error: '未知市场 scope' });
  }
  const scope = rawScope as MarketScope;
  const workspace = String(req.query.workspace || defaultWorkspace(scope)) as WorkspaceId;
  if (!isWorkspaceAllowed(scope, workspace)) {
    return res.status(400).json({ success: false, scope, workspace, error: '当前市场不支持该工作区' });
  }
  const instrument = String(req.query.instrument || '').trim();
  return res.json({ success: true, scope, workspace, instrument: instrument || null });
});

app.get('/api/data/capabilities', async (req, res) => {
  try {
    const marketId = typeof req.query.market === 'string' ? req.query.market : undefined;
    if (marketId && !MARKET_IDS.includes(marketId as MarketId)) {
      return res.status(400).json({ success: false, error: 'Invalid market context' });
    }
    const sources = await getSourceHealth(marketId || 'all');
    const sourceIdsByMarket: Record<MarketId, string[]> = {
      stocks: ['nasdaq-', 'sec-edgar-', 'stock-'],
      options: ['option-', 'cboe-', 'deribit-'],
      crypto: ['binance-', 'crypto-'],
      prediction: ['predict-', 'polymarket', 'kalshi', 'manifold', 'good-judgment', 'metaculus', 'open-meteo'],
    };
    const items = marketId
      ? sources.items.filter(item => sourceIdsByMarket[marketId as MarketId].some(prefix => item.id === prefix || item.id.startsWith(prefix)))
      : sources.items;
    const scopedItems = items.length || !marketId ? items : [{
      id: `${marketId}-capabilities`, name: `${marketId} 数据能力`, group: marketId,
      ok: false, configured: false, latencyMs: null, detail: '当前市场暂无已启用的数据源',
      checkedAt: sources.updatedAt, status: 'unavailable' as const, capabilities: [],
    }];
    res.json({ success: true, market: marketId || 'all', data: scopedItems, updatedAt: sources.updatedAt });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/data/snapshots/:id', (req, res) => {
  try {
    const snapshot = require('../features/research-repository').researchRepository.getDataSnapshot(String(req.params.id)) || dataLakeCatalog.getSnapshot(String(req.params.id));
    if (!snapshot) return res.status(404).json({ success: false, error: 'Data snapshot not found' });
    const context = snapshot.context || snapshot;
    res.json({ success: true, data: snapshot, market: context.market, instrument: context.instrument || null, dataStatus: context.dataStatus || 'historical', source: snapshot.source || 'MoneyMoney point-in-time snapshot', updatedAt: context.updatedAt || snapshot.createdAt || null, reason: null });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Lightweight identity check used by the desktop launcher.
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    app: 'MoneyMoney',
    mode: config.privateKey ? 'paper-only-wallet-readonly' : 'view-only',
    binding: config.appHost,
    lanProtected: config.lanMode,
    storage: getStorageHealth(),
  });
});

app.get('/api/health/live', (_req, res) => {
  res.json({ ok: true, app: 'MoneyMoney', status: 'alive' });
});

app.get('/api/health/version', (_req, res) => {
  try {
    const infoPath = path.resolve(__dirname, '..', 'build-info.json');
    const info = fs.existsSync(infoPath) ? JSON.parse(fs.readFileSync(infoPath, 'utf8')) : {};
    res.json({ ok: true, app: 'MoneyMoney', version: String(info.version || 'unknown'), commit: String(info.commit || 'unknown'), builtAt: String(info.builtAt || ''), source: 'build artifact', dataStatus: info.commit ? 'live' : 'unavailable', reason: info.commit ? null : '构建产物未包含提交版本信息' });
  } catch (error: any) {
    res.status(500).json({ ok: false, app: 'MoneyMoney', dataStatus: 'failed', reason: error.message });
  }
});

const SCREENER_STOCK_SYMBOLS = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'];
const SCREENER_OPTION_SYMBOLS = ['SPY', 'QQQ', 'IWM'];
const SCREENER_CRYPTO_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT'];
function withScreenerTimeout<T>(promise: Promise<T>, timeoutMs = 8000): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('筛选数据源超时')), timeoutMs))]);
}

async function loadScopedScreenerRows(scope: ScreenerScope): Promise<Record<string, unknown>[]> {
  if (scope === 'stocks') {
    const settled = await Promise.allSettled(SCREENER_STOCK_SYMBOLS.map(symbol => withScreenerTimeout(stockDataService.quote(symbol))));
    return settled.flatMap((result, index) => {
      if (result.status !== 'fulfilled' || !result.value.quote) return [];
      const quote = result.value.quote;
      // Keep the identity requested by the screener. Some upstream quote
      // fallbacks echo the last completed symbol when requests are concurrent.
      const symbol = SCREENER_STOCK_SYMBOLS[index];
      return [{ id: `stock:us:${symbol}`, symbol, title: symbol, price: quote.price, changePct: quote.changePct, marketCap: null, dataTime: quote.asOf, source: result.value.snapshot.source, _sourceIncomplete: settled.some(item => item.status === 'rejected' || !item.value.quote) }];
    });
  }
  if (scope === 'options') {
    const settled = await Promise.allSettled(SCREENER_OPTION_SYMBOLS.map(symbol => withScreenerTimeout(getEquityOptionsSnapshot(symbol))));
    return settled.flatMap(result => {
      if (result.status !== 'fulfilled') return [];
      const snapshot = result.value;
      return [{ id: `option:cboe:${snapshot.asset}`, symbol: snapshot.asset, title: `${snapshot.asset} 期权`, price: snapshot.spot, changePct: snapshot.quote?.changePercent ?? null, impliedVolPct: snapshot.quote?.iv30Pct ?? null, openInterest: snapshot.totalCallOpenInterest + snapshot.totalPutOpenInterest, putCallOIRatio: snapshot.totalPutCallOIRatio, dataTime: snapshot.fetchedAt, source: snapshot.source, _sourceIncomplete:settled.some(item => item.status === 'rejected') }];
    });
  }
  if (scope === 'crypto') {
    try {
      const prices = await withScreenerTimeout(binanceFeed.getMultiplePrices(SCREENER_CRYPTO_SYMBOLS));
      return Object.values(prices).map(ticker => ({ id: `crypto:binance:${ticker.symbol}`, symbol: ticker.symbol, title: `${ticker.symbol.replace(/USDT$/, '')}/USDT`, price: ticker.price, changePct: ticker.change24hPct, fundingRate: null, openInterest: null, dataTime: new Date().toISOString(), source: 'Binance public REST' }));
    } catch { return []; }
  }
  let radar;
  try { radar = getCachedPredictionRadarSlice('', 40) || await withScreenerTimeout(getPredictionRadar('', 40)); } catch { return []; }
  return radar.markets.map(market => ({ id: `prediction:${String(market.platform).toLowerCase().replace(/\s+/g, '-')}:${market.id}`, symbol: market.id, title: market.titleZh || market.title, yesPrice: market.yesPrice, noPrice: market.noPrice, liquidity: market.liquidity, dataTime: radar.updatedAt, source: market.platform }));
}

function queryJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try { return JSON.parse(value) as T; } catch { throw new Error('查询参数 JSON 无效'); }
}

interface StoredScreenerTemplate {
  id: string;
  ownerId: string;
  createdAt: string;
  name: string;
  scope: ScreenerScope;
  filters: Record<string, ScreenerFilter>;
  sort?: ScreenerSort;
}

function loadScreenerTemplates(): StoredScreenerTemplate[] {
  return stateStore.get<StoredScreenerTemplate[]>('screener-templates') || [];
}

function saveScreenerTemplates(value: StoredScreenerTemplate[]): void {
  stateStore.set('screener-templates', value.slice(-100), 1);
}

function adminOnly(req: express.Request, res: express.Response): boolean {
  const role = (req as any).user?.role;
  if (role === 'admin') return true;
  if (role === 'guest') {
    res.status(403).json({ success: false, error: '访客模式仅支持公开读取', code: 'GUEST_READ_ONLY' });
  } else {
    res.status(401).json({ success: false, error: '需要管理员登录', code: 'UNAUTHORIZED' });
  }
  return false;
}

const screenerTrackingStore = new ScreenerTrackingStore(stateStore);
function loadScreenerTracking() { return screenerTrackingStore.list(); }
async function refreshScreenerTemplateTracking(template: StoredScreenerTemplate) {
  return screenerTrackingStore.run(template, () => loadScopedScreenerRows(template.scope),
    () => loadScreenerTemplates().some(item => item.id === template.id && item.ownerId === 'admin'));
}

function decisionMarket(value: unknown): MarketId {
  const market = String(value || '').trim() as MarketId;
  if (!MARKET_IDS.includes(market)) throw new Error('Invalid market context');
  return market;
}

function decisionEnvelope(input: { market: MarketId; instrument?: string | null; data: unknown; dataStatus?: unknown; source?: string; reason?: string | null; updatedAt?: string; evidenceRefs?: string[]; requestId?: string | null }) {
  return createDataEnvelope({
    market: input.market,
    instrument: input.instrument,
    data: input.data,
    dataStatus: input.dataStatus || 'live',
    source: input.source || 'MoneyMoney research state',
    updatedAt: input.updatedAt || new Date().toISOString(),
    reason: input.reason,
    evidenceRefs: input.evidenceRefs,
    requestId: input.requestId,
  });
}

const SCENARIO_PRESETS: ScenarioDefinition[] = [
  { id: 'equity-risk-off', name: '股票风险收缩', market: 'stocks', shocks: [{ target: 'market', kind: 'pricePct', value: -10 }, { target: 'rate', kind: 'rateBps', value: 50 }, { target: 'volatility', kind: 'absolute', value: 8 }] },
  { id: 'options-vol-spike', name: '隐含波动率跳升', market: 'options', shocks: [{ target: 'volatility', kind: 'absolute', value: 15 }] },
  { id: 'crypto-liquidation', name: '加密连锁爆仓', market: 'crypto', shocks: [{ target: 'market', kind: 'pricePct', value: -18 }, { target: 'funding', kind: 'fundingPct', value: 1.5 }, { target: 'volatility', kind: 'absolute', value: 20 }] },
  { id: 'prediction-reprice', name: '预测概率重估', market: 'prediction', shocks: [{ target: 'probability', kind: 'probabilityPp', value: -12 }] },
];

app.get('/api/evidence', async (req, res) => {
  try {
    const market = decisionMarket(req.query.market);
    const instrument = String(req.query.instrument || '').trim() || undefined;
    assertMarketContext({ market, workspace: 'evidence', instrument });
    const stored = (req as any).user?.role === 'guest' ? [] : decisionIntelligenceStore.listEvidence(market, instrument);
    const health = await getSourceHealth(market);
    const live = health.items.map(item => createEvidenceSnapshot({
      market,
      instrument,
      workspace: 'evidence',
      dataStatus: item.ok ? (item.status === 'stale' ? 'cached' : 'live') : item.status === 'unconfigured' ? 'empty' : 'unavailable',
      source: { id: item.id, name: item.name },
      observedAt: item.checkedAt,
      fetchedAt: health.updatedAt,
      fields: { status: item.status || (item.ok ? 'live' : 'unavailable'), latencyMs: item.latencyMs, detail: item.detail, capabilities: item.capabilities || [] },
      expectedFields: ['status', 'latencyMs', 'detail', 'capabilities'],
      reason: item.ok ? undefined : item.detail,
    }));
    const byId = new Map([...stored, ...live].map(item => [item.id, item]));
    const savedHashes = new Map(stored.map(item => [item.id, item.hash]));
    const data = [...byId.values()].sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt)).map(item => ({ ...item, persisted: savedHashes.get(item.id) === item.hash }));
    res.json(decisionEnvelope({ market, instrument, data, dataStatus: data.some(item => item.dataStatus === 'live') ? 'live' : data.length ? 'partial' : 'empty', source: 'scoped source health + saved evidence', reason: data.length ? null : '暂无证据' }));
  } catch (error: any) {
    res.status(/market|Instrument/.test(error.message) ? 400 : 500).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.get('/api/data/catalog', (req, res) => {
  const rawMarket = typeof req.query.market === 'string' ? req.query.market : undefined;
  if (rawMarket && !MARKET_IDS.includes(rawMarket as MarketId)) return res.status(400).json({ success: false, error: 'Invalid market context' });
  const partitions = dataLakeCatalog.listPartitions().filter(item => !rawMarket || item.market === rawMarket);
  res.json({ success: true, data: partitions, market: rawMarket || 'all', dataStatus: partitions.length ? 'cached' : 'empty', source: 'MoneyMoney local Parquet catalog', updatedAt: new Date().toISOString(), reason: partitions.length ? null : '本地数据湖暂无已发布分区' });
});

async function readHistoricalBars(req: express.Request, res: express.Response): Promise<void> {
  const market = String(req.query.market || '') as MarketId;
  const instrument = String(req.query.instrument || '').trim();
  const timeframe = String(req.query.timeframe || '').trim();
  const asOf = String(req.query.asOf || '').trim();
  if (!MARKET_IDS.includes(market) || !instrument || !timeframe || !asOf) {
    res.status(400).json({ success: false, error: 'market、instrument、timeframe、asOf 均为必填项' });
    return;
  }
  try {
    const result = await dataLakeCatalog.queryBarsAsOf({ market, instrument, timeframe, asOf });
    res.json({ success: true, market, instrument, timeframe, asOf, ...result, reason: result.reason || null });
  } catch (error: any) { res.status(400).json({ success: false, market, instrument, dataStatus: 'unavailable', source: 'MoneyMoney local Parquet catalog', updatedAt: null, reason: error.message }); }
}

app.get('/api/data/history', readHistoricalBars);
app.get('/api/data/as-of', readHistoricalBars);

app.get('/api/data/quality', (req, res) => {
  const rawMarket = typeof req.query.market === 'string' ? req.query.market : undefined;
  const instrument = typeof req.query.instrument === 'string' ? req.query.instrument.trim() : undefined;
  if (rawMarket && !MARKET_IDS.includes(rawMarket as MarketId)) return res.status(400).json({ success: false, error: 'Invalid market context' });
  if (instrument && !rawMarket) return res.status(400).json({ success: false, error: 'Instrument quality requires market context' });
  const reports = dataLakeCatalog.listQuality(rawMarket as MarketId | undefined, instrument);
  const conflicts = rawMarket ? dataLakeCatalog.listDiscrepancies(rawMarket as MarketId, instrument) : [];
  res.json({ success: true, data: reports, market: rawMarket || 'all', instrument: instrument || null, dataStatus: conflicts.length ? 'partial' : reports.length ? 'cached' : 'empty', source: 'MoneyMoney local quality reports', updatedAt: new Date().toISOString(), reason: conflicts.length ? `${conflicts.length} 条来源差异待核对` : reports.length ? null : '本地数据湖暂无质量报告', discrepancyCount: conflicts.length });
});

app.get('/api/data/slo', (req, res) => {
  const rawMarket = typeof req.query.market === 'string' ? req.query.market : 'stocks';
  if (!MARKET_IDS.includes(rawMarket as MarketId)) return res.status(400).json({ success: false, error: 'Invalid market context', dataStatus: 'failed', reason: '必须指定有效市场' });
  const window = String(req.query.window || '7d');
  const match = /^(1|7|14|30)d$/.exec(window);
  if (!match) return res.status(400).json({ success: false, error: 'window must be 1d, 7d, 14d, or 30d', dataStatus: 'failed', reason: '时间窗仅支持 1d、7d、14d、30d' });
  const days = Number(match[1]);
  const now = new Date();
  const samples = researchRepository.listSourceHealthSamples(rawMarket, new Date(now.getTime() - days * 86_400_000).toISOString(), now.toISOString());
  const summary = summarizeSourceSlo(samples, { market: rawMarket, now, windowMs: days * 86_400_000 });
  const coverage = dataLakeCatalog.listCoverage(rawMarket as MarketId);
  res.json({ success: true, ...summary, window, coverage: coverage.map(item => ({ instrument: item.instrument, dataset: item.dataset, timeframe: item.timeframe, status: item.status, latestPublishedAt: item.latestPublishedAt, partitionCount: item.partitionCount, rowCount: item.rowCount })), dataStatus: summary.sources.length ? (summary.sources.some(item => item.failed) ? 'partial' : 'historical') : 'empty', source: 'SQLite source health samples + local data lake coverage', updatedAt: now.toISOString(), reason: summary.reason });
});

app.get('/api/data/revisions', (req, res) => {
  const rawMarket = typeof req.query.market === 'string' ? req.query.market : undefined;
  if (rawMarket && !MARKET_IDS.includes(rawMarket as MarketId)) return res.status(400).json({ success: false, error: 'Invalid market context' });
  const revisions = dataLakeCatalog.listRevisions(rawMarket as MarketId | undefined);
  res.json({ success: true, data: revisions, market: rawMarket || 'all', dataStatus: revisions.length ? 'cached' : 'empty', source: 'MoneyMoney local revision catalog', updatedAt: new Date().toISOString(), reason: revisions.length ? null : '本地数据湖暂无修订记录' });
});

app.get('/api/data/corporate-actions', (req, res) => {
  const rawMarket = typeof req.query.market === 'string' ? req.query.market : undefined;
  const instrument = typeof req.query.instrument === 'string' ? req.query.instrument.trim() : undefined;
  if (rawMarket && rawMarket !== 'stocks') return res.status(400).json({ success: false, market: rawMarket, dataStatus: 'unsupported', reason: '公司行动仅支持股票市场' });
  const data = dataLakeCatalog.listCorporateActions('stocks', instrument);
  res.json({ success: true, data, market: 'stocks', instrument: instrument || null, dataStatus: data.length ? 'historical' : 'empty', source: 'MoneyMoney corporate action catalog', updatedAt: new Date().toISOString(), reason: data.length ? null : '当前股票暂无公司行动记录' });
});

app.get('/api/data/providers', (req, res) => {
  const rawMarket = typeof req.query.market === 'string' ? req.query.market : undefined;
  if (rawMarket && !MARKET_IDS.includes(rawMarket as MarketId)) return res.status(400).json({ success: false, error: 'Invalid market context' });
  const data = dataLakeCatalog.listProviderContracts(rawMarket as MarketId | undefined);
  res.json({ success: true, data, market: rawMarket || 'all', dataStatus: data.length ? 'cached' : 'empty', source: 'MoneyMoney provider contract catalog', updatedAt: new Date().toISOString(), reason: data.length ? null : '当前作用域暂无 Provider 契约' });
});

app.get('/api/data/coverage', (req, res) => {
  const rawMarket = typeof req.query.market === 'string' ? req.query.market : undefined;
  const instrument = typeof req.query.instrument === 'string' ? req.query.instrument.trim() : undefined;
  const timeframe = typeof req.query.timeframe === 'string' ? req.query.timeframe.trim() : undefined;
  if (rawMarket && !MARKET_IDS.includes(rawMarket as MarketId)) return res.status(400).json({ success: false, error: 'Invalid market context' });
  const data = dataLakeCatalog.listCoverage(rawMarket as MarketId | undefined, instrument, timeframe);
  const conflicts = rawMarket ? dataLakeCatalog.listDiscrepancies(rawMarket as MarketId, instrument).filter(item => !timeframe || item.timeframe === timeframe) : [];
  const isGuest = (req as any).user?.role === 'guest';
  const runs = dataCoverageCanary.listRuns(90);
  const inScope = (item: { market: MarketId; instrument: string }) => (!rawMarket || item.market === rawMarket) && (!instrument || item.instrument === instrument);
  const sourceObservations: CoverageSourceObservation[] = runs.flatMap(run => run.results
    .filter(inScope)
    .map(item => ({ market: item.market, instrument: item.instrument, checkedAt: item.checkedAt, status: item.status, reason: item.reason, capabilities: item.capabilities })));
  const coverageStatus = summarizePublishedCoverage({ market: rawMarket as MarketId | undefined, instrument, partitions: data, discrepancyCount: conflicts.length, observations: sourceObservations });
  const scopedRuns = runs.map(run => {
    const results = run.results.filter(inScope);
    const byMarket = { stocks: 0, options: 0, crypto: 0, prediction: 0 } as Record<MarketId, number>;
    const byStatus = { live: 0, delayed: 0, cached: 0, partial: 0, empty: 0, unavailable: 0, unsupported: 0, failed: 0 } as Record<CanaryDataStatus, number>;
    results.forEach(item => { byMarket[item.market] += 1; byStatus[item.status] += 1; });
    return { ...run, results, summary: { total: results.length, byMarket, byStatus } };
  }).filter(run => run.results.length > 0);
  const canaryHistory = !isGuest ? {
    windows: {
      '7d': summarizeCoverageCanaryHistory(scopedRuns, 7),
      '30d': summarizeCoverageCanaryHistory(scopedRuns, 30),
    },
    lastRun: toPublicCoverageCanarySummary(scopedRuns[0] || null),
  } : toPublicCoverageCanarySummary(scopedRuns[0] || null);
  const publicData = isGuest ? data.map(item => ({ market: item.market, dataset: item.dataset, timeframe: item.timeframe, status: item.status, partitionCount: item.partitionCount, rowCount: item.rowCount })) : data;
  res.json({ success: true, data: publicData, market: rawMarket || 'all', instrument: isGuest ? null : instrument || null, timeframe: timeframe || null, dataStatus: coverageStatus.dataStatus, partitionStatus: coverageStatus.partitionStatus, sourceStatus: coverageStatus.sourceStatus, sourceCheckedAt: coverageStatus.sourceCheckedAt, source: 'MoneyMoney local data coverage catalog + scheduled source canary', updatedAt: new Date().toISOString(), reason: coverageStatus.reason, discrepancyCount: isGuest ? undefined : conflicts.length, ...(isGuest ? {} : { sourceObservations }), canary: canaryHistory });
});

const predictionSourceKey: Partial<Record<PredictionMarket['platform'], keyof PredictionRadar['sources']>> = {
  Polymarket: 'polymarket', Kalshi: 'kalshi', Manifold: 'manifold',
  'Good Judgment Open': 'gjopen', Metaculus: 'metaculus',
};
const predictionVenue: Record<PredictionMarket['platform'], string> = {
  Polymarket: 'polymarket', Kalshi: 'kalshi', Manifold: 'manifold',
  'Good Judgment Open': 'gjopen', Metaculus: 'metaculus',
};

function mapCoverageStatus(status: string): CanaryDataStatus {
  if (status === 'fresh' || status === 'live') return 'live';
  if (status === 'stale' || status === 'cached') return 'cached';
  if (['partial', 'empty', 'unavailable', 'unsupported', 'failed', 'delayed'].includes(status)) return status as CanaryDataStatus;
  return 'unavailable';
}

function coverageCapability(input: {
  status: CanaryDataStatus; source: string; updatedAt?: string | null; retrievedAt?: string | null;
  count?: number | null; coverage?: { from?: string | null; to?: string | null }; reason?: string | null;
}): CanaryCapabilityResult {
  return { ...input, updatedAt: input.updatedAt || null, retrievedAt: input.retrievedAt || null, count: input.count ?? null };
}

function coverageCryptoAdapter(symbol: string): ReturnType<typeof createBinanceKlineAdapter> {
  const normalized = symbol.toUpperCase();
  let adapter = cryptoCoverageAdapters.get(normalized);
  if (!adapter) {
    adapter = createBinanceKlineAdapter({ limit: 30 });
    cryptoCoverageAdapters.set(normalized, adapter);
  }
  return adapter;
}

async function getCanaryPredictionRadar(): Promise<PredictionRadar> {
  if (!coverageCanaryRadarPromise) coverageCanaryRadarPromise = getPredictionRadar('', 250);
  return coverageCanaryRadarPromise;
}

function predictionTargetSource(market: PredictionMarket): keyof PredictionRadar['sources'] | null {
  return predictionSourceKey[market.platform] || null;
}

function predictionPlatformForVenue(venue: string): PredictionMarket['platform'] | null {
  return (Object.entries(predictionVenue) as Array<[PredictionMarket['platform'], string]>).find(([, value]) => value === venue)?.[0] || null;
}

async function checkCoverageCanaryTarget(target: DataCoverageCanaryTarget): Promise<{ capabilities: Record<string, CanaryCapabilityResult>; reason?: string | null }> {
  const identity = target.instrument.match(/^([^:]+):([^:]+):(.+)$/)!;
  const venue = identity[2];
  const symbol = identity[3];
  if (target.market === 'stocks') {
    const stockSymbol = symbol.toUpperCase();
    const [overview, news, insider] = await Promise.allSettled([
      stockDataService.overview(stockSymbol), getStockNewsSnapshot(stockSymbol), getInsiderRadar(stockSymbol),
    ]);
    const map = buildStockCoverageMap(stockSymbol, {
      overview,
      news: news.status === 'fulfilled' ? { status: 'fulfilled', value: news.value.items } : news,
      insider,
    });
    const capabilities = Object.fromEntries(Object.entries(map.capabilities).map(([name, item]) => [name, coverageCapability({
      status: mapCoverageStatus(item.status), source: item.source, updatedAt: item.updatedAt,
      retrievedAt: item.retrievedAt, count: item.count, coverage: item.coverage, reason: item.reason,
    })]));
    if (news.status === 'fulfilled') capabilities.news = coverageCapability({
      status: news.value.status, source: news.value.source, updatedAt: news.value.updatedAt,
      retrievedAt: news.value.retrievedAt, count: news.value.items.length,
      reason: news.value.items.length ? null : 'Yahoo Finance 已响应，但没有该标的相关新闻',
    });
    return { capabilities };
  }
  if (target.market === 'options') {
    if (venue !== 'cboe') return { capabilities: { optionsChain: coverageCapability({ status: 'unsupported', source: 'CBOE delayed options', reason: `当前期权巡检不支持交易场所 ${venue}` }) } };
    try {
      const snapshot = await getEquityOptionsSnapshot(symbol);
      const rows = snapshot.expiries.flatMap(expiry => expiry.rows);
      const expiries = snapshot.expiries.map(expiry => new Date(expiry.expiryMs).toISOString());
      return { capabilities: {
        optionsChain: coverageCapability({ status: rows.length ? 'delayed' : 'empty', source: snapshot.source, retrievedAt: snapshot.fetchedAt, count: rows.length, coverage: { from: expiries[0] || null, to: expiries.at(-1) || null }, reason: rows.length ? null : 'CBOE 已响应，但该标的没有返回期权合约记录' }),
        underlyingQuote: coverageCapability({ status: 'delayed', source: snapshot.source, retrievedAt: snapshot.fetchedAt, count: Number.isFinite(snapshot.spot) ? 1 : 0, reason: 'CBOE 未提供该快照对应的底层报价时间戳' }),
      } };
    } catch (error: any) {
      const reason = String(error?.message || 'CBOE 期权链请求失败');
      const noRecords = /暂无|HTTP 404/i.test(reason);
      const status: CanaryDataStatus = noRecords ? 'empty' : 'unavailable';
      return { capabilities: { optionsChain: coverageCapability({ status, source: 'CBOE Delayed Quotes', reason }) }, reason };
    }
  }
  if (target.market === 'crypto') {
    if (venue !== 'binance') return { capabilities: { bars: coverageCapability({ status: 'unsupported', source: 'Binance public history', reason: `当前加密数据巡检不支持交易场所 ${venue}` }) } };
    const snapshot = await coverageCryptoAdapter(symbol).fetch({ symbol, period: '1d', limit: 30 });
    const bars = snapshot.data || [];
    const first = bars[0];
    const last = bars.at(-1);
    const status: CanaryDataStatus = !bars.length
      ? snapshot.status === 'unavailable' ? 'unavailable' : 'empty'
      : snapshot.status === 'stale' ? 'cached' : snapshot.status === 'live' ? 'live' : 'unavailable';
    return { capabilities: { bars: coverageCapability({
      status, source: snapshot.source,
      updatedAt: last ? new Date(last.time).toISOString() : null,
      retrievedAt: snapshot.fetchedAt, count: bars.length,
      coverage: { from: first ? new Date(first.time).toISOString() : null, to: last ? new Date(last.time).toISOString() : null },
      reason: snapshot.error || (bars.length ? null : '来源成功响应，但没有历史K线记录'),
    }) } };
  }
  const radar = await getCanaryPredictionRadar();
  const selected = radar.markets.find(item => predictionVenue[item.platform] === venue && item.id === symbol);
  if (!selected) {
    const platform = predictionPlatformForVenue(venue);
    const providerKey = platform ? predictionSourceKey[platform] : null;
    const provider = providerKey ? radar.sources[providerKey] : null;
    const status: CanaryDataStatus = !provider ? 'unsupported' : provider.ok ? 'empty' : 'unavailable';
    return { capabilities: { probability: coverageCapability({ status, source: providerKey || 'prediction source', retrievedAt: provider?.checkedAt || radar.updatedAt, reason: provider?.error || (provider?.ok ? '来源已响应，但当前没有该活动事件' : '预测市场事件来源不可用') }) } };
  }
  const key = predictionTargetSource(selected);
  const provider = key ? radar.sources[key] : null;
  const checkedAt = provider?.checkedAt || radar.updatedAt;
  const ageMs = Date.now() - Date.parse(checkedAt || '');
  const status: CanaryDataStatus = !provider ? 'unsupported' : !provider.ok ? 'unavailable' : ageMs > 15 * 60_000 ? 'cached' : 'live';
  return { capabilities: { probability: coverageCapability({
    status, source: selected.platform, retrievedAt: checkedAt, count: 1,
    reason: provider?.error || (status === 'cached' ? '显示最近一次来源快照；来源检查时间已超过15分钟' : null),
  }) } };
}

async function resolveCoverageCanaryInputs(): Promise<{ targets: DataCoverageCanaryTarget[]; marketReasons?: DataCoverageCanaryRun['marketReasons'] }> {
  const targets = dataCoverageCanary.listTargets();
  if (targets.some(item => item.market === 'prediction')) return { targets };
  try {
    const radar = await getCanaryPredictionRadar();
    const active = radar.markets.filter(item => {
      const sourceKey = predictionTargetSource(item);
      const source = sourceKey ? radar.sources[sourceKey] : null;
      const closeAt = item.endDate ? Date.parse(item.endDate) : NaN;
      const isOpen = !Number.isFinite(closeAt) || closeAt > Date.now();
      const hasActivity = Number(item.activityScore) > 0 || Number(item.volume24h) > 0 || Number(item.liquidity) > 0;
      return Boolean(source?.ok && item.id && item.title && isOpen && hasActivity && Number.isFinite(item.yesPrice) && item.yesPrice > 0 && item.yesPrice < 1);
    }).sort((a, b) => Number(b.activityScore) - Number(a.activityScore));
    const first = active[0];
    if (first) {
      const venue = predictionVenue[first.platform];
      return { targets: [...targets, { market: 'prediction', instrument: `prediction:${venue}:${first.id}`, label: `活动预测事件 · ${(first.titleZh || first.title).slice(0, 90)}`, requiredCapabilities: ['probability'] }] };
    }
    const sources = Object.values(radar.sources);
    const succeeded = sources.filter(item => item.ok).length;
    const failed = sources.filter(item => !item.ok).length;
    const status: CanaryDataStatus = failed && succeeded ? 'partial' : failed ? 'unavailable' : 'empty';
    const details = sources.filter(item => !item.ok && item.error).map(item => item.error).slice(0, 3).join('；');
    return { targets, marketReasons: { prediction: { status, source: 'prediction venue radar', reason: status === 'empty' ? '来源响应成功，但没有符合条件的活动事件' : details || '预测市场来源部分或全部不可用' } } };
  } catch (error: any) {
    return { targets, marketReasons: { prediction: { status: 'unavailable', source: 'prediction venue radar', reason: error?.message || '预测市场来源巡检失败' } } };
  }
}

async function runCoverageCanaryNow(): Promise<DataCoverageCanaryRun> {
  coverageCanaryRadarPromise = null;
  try {
    return await dataCoverageCanary.runResolved(resolveCoverageCanaryInputs, new Date());
  } finally {
    coverageCanaryRadarPromise = null;
  }
}

async function runCoverageCanaryIfDue(): Promise<DataCoverageCanaryRun | null> {
  if (coverageCanaryTask) return null;
  coverageCanaryRadarPromise = null;
  coverageCanaryTask = dataCoverageCanary.runIfDue(new Date(), resolveCoverageCanaryInputs)
    .catch(error => {
      if (!/already running/i.test(String(error?.message || error))) logger.warn('coverage_canary_run_failed', { error: String(error?.message || error) });
      return null;
    })
    .finally(() => { coverageCanaryTask = null; coverageCanaryRadarPromise = null; });
  return coverageCanaryTask as Promise<DataCoverageCanaryRun | null>;
}

function startCoverageCanaryMonitor(): void {
  if (coverageCanaryTimer) return;
  void runCoverageCanaryIfDue();
  coverageCanaryTimer = setInterval(() => { void runCoverageCanaryIfDue(); }, 15 * 60_000);
  coverageCanaryTimer.unref?.();
}

function stopCoverageCanaryMonitor(): void {
  if (coverageCanaryTimer) clearInterval(coverageCanaryTimer);
  coverageCanaryTimer = null;
}

app.get('/api/data/canaries/summary', (_req, res) => {
  const latest = dataCoverageCanary.listRuns(1)[0] || null;
  res.json({ success: true, data: toPublicCoverageCanarySummary(latest), dataStatus: latest?.status || 'empty', source: 'daily four-market data coverage canary', updatedAt: latest?.completedAt || null, reason: latest ? null : '尚无覆盖巡检记录' });
});

app.get('/api/data/canaries', (req, res) => {
  if (!adminOnly(req, res)) return;
  const market = typeof req.query.market === 'string' ? req.query.market as MarketId : undefined;
  if (market && !MARKET_IDS.includes(market)) return res.status(400).json({ success: false, dataStatus: 'failed', reason: '市场范围无效' });
  const limit = Math.max(1, Math.min(90, Number(req.query.limit) || 30));
  const runs = dataCoverageCanary.listRuns(90).map(run => market ? { ...run, results: run.results.filter(item => item.market === market) } : run).slice(0, limit);
  const now = new Date();
  res.json({ success: true, data: runs, windows: {
    '7d': summarizeCoverageCanaryHistory(dataCoverageCanary.listRuns(90), 7, now).filter(item => !market || item.market === market),
    '30d': summarizeCoverageCanaryHistory(dataCoverageCanary.listRuns(90), 30, now).filter(item => !market || item.market === market),
  }, market: market || 'all', dataStatus: runs.length ? 'historical' : 'empty', source: 'SQLite persisted daily coverage canary', updatedAt: runs[0]?.completedAt || null, reason: runs.length ? null : '暂无覆盖巡检历史' });
});

app.get('/api/data/canaries/targets', (req, res) => {
  if (!adminOnly(req, res)) return;
  const data = dataCoverageCanary.listTargets();
  res.json({ success: true, data, dataStatus: data.length ? 'cached' : 'empty', source: 'SQLite coverage canary target registry', updatedAt: new Date().toISOString(), reason: null });
});

app.put('/api/data/canaries/targets', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const data = dataCoverageCanary.saveTargets(Array.isArray(req.body?.targets) ? req.body.targets : []);
    stateStore.appendAudit({ id: `coverage-canary-targets-${crypto.randomUUID()}`, action: 'coverage_canary_targets_updated', detail: `管理员更新了 ${data.length} 个巡检标的` });
    res.json({ success: true, data, dataStatus: 'cached', source: 'SQLite coverage canary target registry', updatedAt: new Date().toISOString(), reason: null });
  } catch (error: any) {
    res.status(400).json({ success: false, dataStatus: 'failed', source: 'SQLite coverage canary target registry', updatedAt: new Date().toISOString(), reason: error?.message || '巡检标的配置无效' });
  }
});

app.post('/api/data/canaries/run', async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const run = await runCoverageCanaryNow();
    stateStore.appendAudit({ id: `coverage-canary-run-${run.id}`, action: 'coverage_canary_run', detail: `管理员手动完成 ${run.summary.total} 个标的的覆盖巡检` });
    res.json({ success: true, data: run, dataStatus: run.status, source: 'live provider coverage canary', updatedAt: run.completedAt, reason: null });
  } catch (error: any) {
    const conflict = /already running/i.test(String(error?.message || error));
    res.status(conflict ? 409 : 503).json({ success: false, dataStatus: conflict ? 'partial' : 'unavailable', source: 'live provider coverage canary', updatedAt: new Date().toISOString(), reason: conflict ? '已有覆盖巡检任务运行中' : error?.message || '覆盖巡检失败' });
  }
});

app.get('/api/data/discrepancies', (req, res) => {
  const market = String(req.query.market || '') as MarketId;
  const instrument = typeof req.query.instrument === 'string' ? req.query.instrument.trim() : undefined;
  if (!MARKET_IDS.includes(market)) return res.status(400).json({ success: false, dataStatus: 'failed', reason: '必须指定有效市场' });
  const data = dataLakeCatalog.listDiscrepancies(market, instrument);
  res.json({ success: true, data, market, instrument: instrument || null, dataStatus: data.length ? 'partial' : 'empty', source: 'MoneyMoney provider discrepancy catalog', updatedAt: new Date().toISOString(), reason: data.length ? '来源收盘价存在差异，争议分区未发布' : '当前标的没有已记录的来源差异' });
});

app.get('/api/data/instruments/resolve', (req, res) => {
  if (!adminOnly(req, res)) return;
  const market = String(req.query.market || '') as MarketId;
  const query = String(req.query.query || '').trim();
  if (!MARKET_IDS.includes(market)) return res.status(400).json({ success: false, dataStatus: 'failed', reason: '必须指定有效市场' });
  try {
    const instrument = query ? dataLakeCatalog.resolveInstrument(market, query) : null;
    const quarantine = dataLakeCatalog.listInstrumentQuarantine(market).filter(item => !query || item.instrument.toUpperCase() === query.toUpperCase());
    res.json({ success: true, market, instrument: instrument?.id || query || null, data: { resolved: instrument, quarantine }, dataStatus: quarantine.length ? 'partial' : instrument ? 'cached' : 'empty', source: 'MoneyMoney instrument registry', updatedAt: new Date().toISOString(), reason: quarantine.length ? '旧数据交易场所待管理员确认' : instrument ? null : '当前市场暂无已确认的标的身份' });
  } catch (error: any) {
    res.status(409).json({ success: false, market, instrument: query || null, dataStatus: 'partial', reason: error.message || '标的身份有歧义，请指定交易场所' });
  }
});

app.post('/api/data/instruments/confirm', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const market = String(req.body?.market || '') as MarketId;
  const type = String(req.body?.type || '') as InstrumentType;
  const venue = String(req.body?.venue || '').trim();
  const symbol = String(req.body?.symbol || '').trim();
  const expected = ({ stocks: 'stock', options: 'option', crypto: 'crypto', prediction: 'prediction' } as const)[market];
  if (!expected || type !== expected || !venue || !symbol) return res.status(400).json({ success: false, dataStatus: 'failed', reason: '市场、类型、交易场所和标的必须一致且完整' });
  try {
    const ref = dataLakeCatalog.registerInstrument({ type, venue, symbol, title: String(req.body?.title || symbol), aliases: [] });
    res.json({ success: true, market, instrument: ref.id, data: ref, dataStatus: 'cached', source: 'administrator-confirmed instrument registry', updatedAt: new Date().toISOString(), reason: null });
  } catch (error: any) {
    res.status(400).json({ success: false, market, instrument: symbol, dataStatus: 'failed', reason: error.message || '标的身份确认失败' });
  }
});

app.post('/api/data/backfills', (req, res) => {
  if(!adminOnly(req,res))return;
  try {
    const job = dataLakeCatalog.createBackfill(req.body || {});
    res.status(202).json({ success: true, data: job, market: job.market, instrument: job.instrument, dataStatus: 'queued', source: 'MoneyMoney data worker queue', updatedAt: job.updatedAt, reason: job.reason });
  } catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});

app.get('/api/data/backfills/:id', (req, res) => {
  const job = dataLakeCatalog.getBackfill(String(req.params.id));
  if (!job) return res.status(404).json({ success: false, error: 'backfill job not found' });
  res.json({ success: true, data: job, market: job.market, instrument: job.instrument, dataStatus: job.status, source: 'MoneyMoney data worker queue', updatedAt: job.updatedAt, reason: job.reason || null });
});

function normalizeEventStudyBars(rows: Array<Record<string, unknown>>): Array<{ timestamp: string; open: number; high: number; low: number; close: number; volume?: number }> {
  return rows.map(row => {
    const timestamp = row.timestamp instanceof Date ? row.timestamp.toISOString() : new Date(String(row.timestamp)).toISOString();
    return {
      timestamp,
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      ...(row.volume == null ? {} : { volume: Number(row.volume) }),
    };
  });
}

app.get('/api/event-studies', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market);
    const instrument = String(req.query.instrument || '').trim() || undefined;
    const data = eventStudyRepository.list(market, instrument);
    res.json(decisionEnvelope({ market, instrument, data, dataStatus: data.length ? 'cached' : 'empty', source: 'private historical event studies', reason: data.length ? null : '暂无事件研究记录' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/event-studies', express.json(), async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const body = req.body || {};
    const market = decisionMarket(body.market);
    const instrument = String(body.instrument || '').trim();
    let eventAt = String(body.eventAt || '').trim();
    const eventId = String(body.eventId || '').trim();
    const timeframe = String(body.timeframe || '1d').trim();
    const requestedAsOf = Date.parse(String(body.asOf || new Date().toISOString()).trim());
    if (!Number.isFinite(requestedAsOf)) throw new Error('asOf must be a valid timestamp');
    const asOf = new Date(Math.min(requestedAsOf, Date.now())).toISOString();
    assertMarketContext({ market, workspace: 'event-study', instrument });
    let selectedEvent: ReturnType<typeof selectResearchEvent> | null = null;
    let selectedEventEvidenceId: string | null = null;
    let eventEntities: ReturnType<typeof buildEventEntities> = [];
    let cohortInstrument = instrument;
    if (market === 'stocks') {
      const ref = eventInstrumentRef(market, instrument.includes(':') ? instrument : `stock:us:${instrument.toUpperCase()}`);
      const timeline = await loadStockEventTimeline(ref);
      eventEntities = buildEventEntities(timeline.items, { market, instrument: ref.id, retrievedAt: timeline.generatedAt, asOf });
      cohortInstrument = ref.id;
      if (eventId) {
        selectedEvent = selectResearchEvent(eventEntities, eventId, asOf);
        selectedEventEvidenceId = persistTimelineEventEvidence(selectedEvent).id;
        eventAt = new Date(Math.max(Date.parse(selectedEvent.occurredAt), Date.parse(selectedEvent.publishedAt!))).toISOString();
      }
    } else if (eventId) {
      throw new Error('当前市场事件研究尚无可靠的标的事件来源');
    }
    if (!eventAt) throw new Error('eventAt is required');
    const historical = await dataLakeCatalog.queryBarsAsOf({ market, instrument, timeframe, asOf });
    if (!historical.rows.length) {
      return res.status(422).json(decisionEnvelope({ market, instrument, data: [], dataStatus: historical.dataStatus, source: historical.source || 'MoneyMoney local Parquet catalog', updatedAt: historical.updatedAt || undefined, reason: historical.reason || '历史数据不可用' }));
    }
    const bars = normalizeEventStudyBars(historical.rows);
    const afterBars = Number(body.afterBars ?? 20);
    const benchmarkInstrument = market === 'stocks' ? String(body.benchmarkInstrument || 'SPY').trim().toUpperCase() : '';
    let benchmarkBars: ReturnType<typeof normalizeEventStudyBars> | undefined;
    let benchmarkReason: string | null = null;
    if (benchmarkInstrument && benchmarkInstrument !== instrument.toUpperCase()) {
      try {
        const benchmark = await dataLakeCatalog.queryBarsAsOf({ market, instrument: benchmarkInstrument, timeframe, asOf });
        if (benchmark.rows.length) benchmarkBars = normalizeEventStudyBars(benchmark.rows);
        else benchmarkReason = benchmark.reason || `${benchmarkInstrument} 基准历史数据不可用`;
      } catch (error: any) { benchmarkReason = error?.message || `${benchmarkInstrument} 基准历史数据不可用`; }
    }
    const result = runEventStudy({ market, instrument, eventAt, bars, benchmarkBars, beforeBars: Number(body.beforeBars ?? 20), afterBars });
    const targetTitle = selectedEvent?.title || (typeof body.title === 'string' ? body.title.trim() : '');
    const eventCategory = targetTitle ? classifyEventCategory(targetTitle) : undefined;
    const cohort = market === 'stocks' && targetTitle
      ? buildEventStudyCohort({ market, instrument: cohortInstrument, eventAt, title: targetTitle, bars, events: eventEntities, afterBars, benchmarkBars })
      : undefined;
    const record = eventStudyRepository.save({
      ...result,
      asOf,
      title: targetTitle || undefined,
      eventCategory,
      cohort,
      warnings: [...result.warnings, ...(cohort?.warnings || []), ...(!targetTitle && market === 'stocks' ? ['未提供事件标题或关联来源事件，未计算同类历史事件分布。'] : []), ...(benchmarkReason ? [`基准数据不可用：${benchmarkReason}`] : [])],
      source: selectedEvent?.source.name || (typeof body.source === 'string' ? body.source.trim() || historical.source || undefined : historical.source || undefined),
      sourceUrl: selectedEvent?.source.url || (typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() || undefined : undefined),
      evidenceRefs: selectedEvent ? [selectedEvent.id, ...(selectedEventEvidenceId ? [selectedEventEvidenceId] : []), ...(historical.snapshot ? [historical.snapshot.id] : [])] : historical.snapshot ? [historical.snapshot.id] : [],
    });
    res.status(201).json(decisionEnvelope({ market, instrument, data: record, dataStatus: 'historical', source: historical.source || 'MoneyMoney local Parquet catalog', updatedAt: historical.updatedAt || undefined, reason: null }));
  } catch (error: any) {
    const status = /market|instrument|eventAt|historical bars|ordered|OHLC|published|asOf|evidence|来源/i.test(error.message) ? 400 : 500;
    res.status(status).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.get('/api/event-studies/:id', (req, res) => {
  if (!adminOnly(req, res)) return;
  const record = eventStudyRepository.get(String(req.params.id));
  if (!record) return res.status(404).json({ success: false, error: 'event study not found', dataStatus: 'empty', reason: '事件研究不存在' });
  res.json(decisionEnvelope({ market: record.market, instrument: record.instrument, data: record, dataStatus: 'cached', source: record.source || 'private historical event studies', updatedAt: record.createdAt, reason: null }));
});

app.get('/api/events/:id/evidence', (req, res) => {
  if (!adminOnly(req, res)) return;
  const record = eventStudyRepository.get(String(req.params.id));
  if (!record) return res.status(404).json({ success: false, error: 'event study not found', dataStatus: 'empty', reason: '事件研究不存在' });
  res.json(decisionEnvelope({ market: record.market, instrument: record.instrument, data: { eventStudyId: record.id, title: record.title || null, source: record.source || null, sourceUrl: record.sourceUrl || null, evidenceRefs: record.evidenceRefs || [], asOf: record.asOf || null }, dataStatus: record.evidenceRefs?.length ? 'historical' : 'empty', source: record.source || 'private historical event studies', updatedAt: record.createdAt, reason: record.evidenceRefs?.length ? null : '该事件研究没有关联证据快照' }));
});

app.get('/api/ops/slo', async (_req, res) => {
  try {
    const sourceHealth = await getSourceHealth('all');
    res.json({
      success: true,
      data: {
        runtime: runtimeObservability.snapshot(),
        sources: buildSourceSlo(sourceHealth.items.map(item => ({
          id: item.id,
          ok: item.ok,
          latencyMs: item.latencyMs,
          checkedAt: item.checkedAt,
          status: item.status || (item.ok ? 'live' : 'unavailable'),
        }))),
        storage: getStorageHealth(),
      },
      updatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/ops/data-lake', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const data = dataLakeCatalog.getDiagnostics();
    res.json({ success: true, data, dataStatus: data.quotaState === 'blocked' ? 'degraded' : 'cached', source: 'MoneyMoney local Parquet catalog', updatedAt: data.generatedAt, reason: data.quotaState === 'blocked' ? '数据湖已达到容量停止阈值，非必要采集应暂停' : data.quotaState === 'warning' ? '数据湖已达到容量告警阈值' : null });
  } catch (error: any) {
    res.status(503).json({ success: false, dataStatus: 'unavailable', source: 'MoneyMoney local Parquet catalog', updatedAt: new Date().toISOString(), reason: error?.message || '数据湖诊断不可用' });
  }
});

app.post('/api/evidence', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const item = createEvidenceSnapshot(req.body || {});
    decisionIntelligenceStore.saveEvidence(item);
    res.status(201).json(decisionEnvelope({ market: item.market, instrument: item.instrument, data: item, dataStatus: item.dataStatus, source: item.source.name, updatedAt: item.fetchedAt }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.get('/api/evidence/changes', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market);
    const instrument = String(req.query.instrument || '').trim() || undefined;
    const since = String(req.query.since || '');
    assertMarketContext({ market, workspace: 'evidence', instrument });
    const data = getEvidenceChanges(decisionIntelligenceStore.listEvidence(market, instrument), market, instrument, since);
    res.json(decisionEnvelope({ market, instrument, data, dataStatus: data.dataStatus, source: 'saved evidence changes', reason: data.reason }));
  } catch (error: any) {
    res.status(/market|Instrument|instrument/i.test(error.message) ? 400 : 500).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.get('/api/evidence/source-health/history', (req, res) => {
  try {
    const market = decisionMarket(req.query.market);
    const data = researchRepository.listSourceHealthEvents(market, Number(req.query.limit || 100));
    res.json(decisionEnvelope({ market, data, dataStatus: data.length ? 'cached' : 'empty', source: 'persisted source health timeline', reason: data.length ? null : '暂无来源故障或恢复记录' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/evidence/source-health/retry', express.json(), async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.body?.market);
    const data = await refreshSourceHealth(market);
    res.json(decisionEnvelope({ market, data, dataStatus: data.online ? (data.online === data.total ? 'live' : 'partial') : 'unavailable', source: 'forced source health refresh', reason: data.online ? null : '重试后仍无可用来源' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.get('/api/paper/execution-evidence',(req,res)=>{
  if(!adminOnly(req,res))return;
  try{
    const market=decisionMarket(String(req.query.market||'')),instrument=String(req.query.instrument||'');
    const expected={market,instrument,accountId:String(req.query.accountId||''),orderId:String(req.query.orderId||''),signalId:String(req.query.signalId||''),snapshotId:String(req.query.snapshotId||'')};
    if(!instrument||![expected.accountId,expected.orderId,expected.signalId,expected.snapshotId].every(Boolean))return res.status(400).json({success:false,market,instrument,dataStatus:'failed',reason:'成交证据请求缺少完整的市场、标的、账户、订单、信号或快照身份'});
    const data=runnerExecutionEvidence.executionForOrder(unifiedPaperLedgerStore.get(),expected);
    if(!data)return res.status(404).json({success:false,market,instrument,dataStatus:'unavailable',reason:'成交、账户、决策或时点快照未能按持久ID完整核验'});
    return res.json(decisionEnvelope({market,instrument,data,dataStatus:String(data.snapshot.fields.status||data.decision.dataStatus||'historical'),source:String(data.decision.source||'成交时证据'),updatedAt:data.snapshot.at,reason:'仅返回与该模拟成交精确关联且早于成交时点的决策和来源证据',evidenceRefs:[data.snapshot.id]}));
  }catch(error:any){return res.status(400).json({success:false,dataStatus:'failed',reason:error.message});}
});

app.get('/api/evidence/:id', (req, res) => {
  if (!adminOnly(req, res)) return;
  const archived = runnerExecutionEvidence.snapshot(String(req.params.id));
  if (archived) return res.json(decisionEnvelope({ market:archived.market,instrument:archived.instrument,data:{ ...archived,fields:archived.payload,dataStatus:archived.payload.status,source:{id:archived.payload.source,name:archived.payload.source},observedAt:archived.payload.dataAt,fetchedAt:archived.payload.quote?.fetchedAt || null,capturedAt:archived.at,reason:'成交时归档的来源快照；未计算独立可信度评分' },dataStatus:archived.payload.status,source:archived.payload.source,updatedAt:archived.at,evidenceRefs:[archived.id] }));
  const item = MARKET_IDS.flatMap(market => decisionIntelligenceStore.listEvidence(market)).find(row => row.id === String(req.params.id));
  if (!item) return res.status(404).json({ success:false,reason:'证据快照不存在' });
  return res.json(decisionEnvelope({ market:item.market,instrument:item.instrument,data:item,dataStatus:item.dataStatus,source:item.source.name,updatedAt:item.fetchedAt,evidenceRefs:[item.id] }));
});
app.get('/api/scenarios', (req, res) => {
  try {
    const market = decisionMarket(req.query.market);
    const stored = (req as any).user?.role === 'guest' ? [] : decisionIntelligenceStore.listScenarios(market);
    const byId = new Map([...SCENARIO_PRESETS.filter(item => item.market === market), ...stored].map(item => [item.id, item]));
    res.json(decisionEnvelope({ market, data: [...byId.values()], source: 'MoneyMoney deterministic scenario catalog' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/scenarios', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const scenario = req.body as ScenarioDefinition;
    const market = decisionMarket(scenario?.market);
    if (!scenario.id?.trim() || !scenario.name?.trim() || !Array.isArray(scenario.shocks) || !scenario.shocks.length) throw new Error('Scenario definition is incomplete');
    scenario.shocks.forEach(shock => { if (!Number.isFinite(Number(shock.value))) throw new Error('Scenario shock must be finite'); });
    const saved = decisionIntelligenceStore.saveScenario({ ...scenario, market, shocks: scenario.shocks.map(shock => ({ ...shock, value: Number(shock.value) })) });
    res.status(201).json(decisionEnvelope({ market, data: saved, source: 'MoneyMoney scenario catalog' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/scenarios/run', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.body?.market || req.body?.scenario?.market);
    const scenarioId = String(req.body?.scenarioId || '');
    const scenario = req.body?.scenario || [...SCENARIO_PRESETS, ...decisionIntelligenceStore.listScenarios(market)].find(item => item.id === scenarioId);
    if (!scenario) throw new Error('Scenario not found');
    let positions = Array.isArray(req.body?.positions) ? req.body.positions : decisionIntelligenceStore.listPortfolio(market);
    if (!positions.length) {
      const typeByMarket: Record<string, string> = { stocks: 'stock', options: 'option', crypto: 'crypto', prediction: 'prediction' };
      positions = unifiedPaperLedgerStore.get().positions.filter(item => item.instrumentType === typeByMarket[market]).map(item => ({ instrument: item.instrumentId, market, quantity: item.quantity, price: item.currentPrice }));
    }
    if (!positions.length) throw new Error('当前市场暂无可用于压力测试的模拟或导入仓位');
    const result = runScenario({ ...scenario, market }, positions);
    res.json(decisionEnvelope({ market, data: result, source: 'MoneyMoney deterministic stress engine' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'empty', reason: error.message });
  }
});

app.get('/api/decisions', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market);
    const instrument = String(req.query.instrument || '').trim() || undefined;
    assertMarketContext({ market, workspace: 'decision-journal', instrument });
    const data = decisionIntelligenceStore.listDecisions(market, instrument);
    res.json(decisionEnvelope({ market, instrument, data, dataStatus: data.length ? 'cached' : 'empty', source: 'private decision journal', reason: data.length ? null : '暂无决策记录' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/decisions', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const record = createDecisionRecord(req.body || {});
    decisionIntelligenceStore.saveDecision(record);
    res.status(201).json(decisionEnvelope({ market: record.market, instrument: record.instrument, data: record, source: 'private decision journal' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/decisions/:id/review', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const current = decisionIntelligenceStore.getDecision(String(req.params.id));
  if (!current) return res.status(404).json({ success: false, error: 'Decision not found', dataStatus: 'empty', reason: 'Decision not found' });
  try {
    const reviewed = reviewDecision(current, req.body?.observed || {}, req.body?.at);
    const reviewDraft = buildDecisionReviewDraft(current, req.body?.observed || {}, req.body?.at);
    decisionIntelligenceStore.saveDecision(reviewed);
    res.json(decisionEnvelope({ market: current.market, instrument: current.instrument, data: { ...reviewed, reviewDraft }, source: 'private decision journal' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/decisions/review-due', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.body?.market);
    const result = buildDueDecisionReviewDrafts(decisionIntelligenceStore.listDecisions(market), decisionIntelligenceStore.listEvidence(market), req.body?.at);
    result.drafts.forEach(item => decisionIntelligenceStore.saveReviewDraft(item));
    res.json(decisionEnvelope({ market, data: result, dataStatus: result.drafts.length ? 'cached' : 'empty', source: 'evidence-linked review draft generator', reason: result.drafts.length ? null : result.skipped[0]?.reason || '暂无到期决策' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

async function monitorDueDecisionReviewDrafts(): Promise<void> {
  const now = new Date().toISOString();
  for (const market of MARKET_IDS) {
    const existing = new Set(decisionIntelligenceStore.listReviewDrafts(market).map(item => item.decisionId));
    const due = decisionIntelligenceStore.listDecisions(market).filter(item => item.status === 'open' && Date.parse(item.horizonAt) <= Date.parse(now) && !existing.has(item.id));
    if (!due.length) continue;
    const result = buildDueDecisionReviewDrafts(due, decisionIntelligenceStore.listEvidence(market), now);
    result.drafts.forEach(item => decisionIntelligenceStore.saveReviewDraft(item));
  }
}

async function sampleSourceHealth(): Promise<void> {
  if (sourceHealthSampling) return;
  sourceHealthSampling = true;
  try {
    sourceHealthSampleRuns += 1;
    await Promise.allSettled([getSourceHealth('stocks'), getSourceHealth('all')]);
    if (sourceHealthSampleRuns % 5 === 1) await getSourceHealth('options').catch(() => null);
  } finally { sourceHealthSampling = false; }
}

app.get('/api/decisions/negative-knowledge', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market);
    const drafts = [
      ...decisionIntelligenceStore.listReviewDrafts(market),
      ...decisionIntelligenceStore.listDecisions(market).filter(item => item.review).map(item => buildDecisionReviewDraft(item, item.review!.observed, item.review!.at)),
    ];
    const data = summarizeNegativeKnowledge(drafts);
    res.json(decisionEnvelope({ market, data, dataStatus: data.length ? 'cached' : 'empty', source: 'reviewed private decision journal', reason: data.length ? null : '暂无重复失败模式' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/portfolio/import', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const result = importPortfolioRows(Array.isArray(req.body?.rows) ? req.body.rows : []);
  let snapshotsRecorded = 0;
  if (req.body?.commit === true && result.accepted.length) {
    const existing = decisionIntelligenceStore.listPortfolio();
    const committed = [...existing, ...result.accepted];
    decisionIntelligenceStore.replacePortfolio(committed);
    snapshotsRecorded = decisionIntelligenceStore.savePortfolioSnapshots(capturePortfolioSnapshots(committed)).length;
  }
  res.status(result.rejected.length && !result.accepted.length ? 400 : 200).json({ success: result.accepted.length > 0 || result.rejected.length === 0, data: { ...result, snapshotsRecorded }, dataStatus: result.accepted.length ? (result.rejected.length ? 'partial' : 'cached') : 'empty', source: 'manual/CSV portfolio import', updatedAt: new Date().toISOString(), reason: result.rejected.length ? `${result.rejected.length} 条记录未通过校验` : null });
});

app.get('/api/portfolio/snapshots', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market);
    const accountSource = typeof req.query.accountSource === 'string' ? req.query.accountSource.trim() || undefined : undefined;
    const accountId = typeof req.query.accountId === 'string' ? req.query.accountId.trim() || undefined : undefined;
    const rawLimit = Number(req.query.limit || 50);
    if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 200) throw new Error('limit 必须为 1–200');
    const data = decisionIntelligenceStore.listPortfolioSnapshots(market, accountSource, accountId).slice(0, rawLimit);
    res.json(decisionEnvelope({ market, data, dataStatus: data.length ? 'historical' : 'empty', source: 'committed manual/CSV valuation snapshots', reason: data.length ? '快照记录的是导入时估值，不代表投资收益。' : '该市场暂无已提交的组合估值快照' }));
  } catch (error: any) {
    res.status(400).json({ success: false, dataStatus: 'failed', reason: error.message });
  }
});

app.get('/api/portfolio/snapshots/compare', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const beforeId = String(req.query.before || '').trim();
    const afterId = String(req.query.after || '').trim();
    if (!beforeId || !afterId || beforeId === afterId) throw new Error('请选择两条不同的组合快照');
    const before = decisionIntelligenceStore.getPortfolioSnapshot(beforeId);
    const after = decisionIntelligenceStore.getPortfolioSnapshot(afterId);
    if (!before || !after) throw new Error('快照不存在或已过期');
    const data = comparePortfolioSnapshots(before, after);
    res.json(decisionEnvelope({ market: data.market, data, dataStatus: data.dataStatus, source: 'private committed portfolio valuation snapshots', reason: data.reason }));
  } catch (error: any) {
    res.status(400).json({ success: false, dataStatus: 'unavailable', reason: error.message });
  }
});

app.get('/api/research/price-comparison', async (req, res) => {
  if (!adminOnly(req,res)) return;
  try {
    const market=decisionMarket(req.query.market), instruments=String(req.query.instruments || '').split(',').filter(Boolean);
    if (instruments.length<2 || instruments.length>6) throw new Error('请选择 2–6 个同市场标的');
    const data=await assembleHistory(dataLakeCatalog,market,instruments,String(req.query.asOf || new Date().toISOString()),Number(req.query.days || 365));
    res.json(decisionEnvelope({market,data,dataStatus:data.dataStatus as any,source:'已发布日线分区',reason:data.reason || undefined,evidenceRefs:data.evidenceRefs}));
  } catch(error:any) {res.status(400).json({success:false,dataStatus:'failed',reason:error.message});}
});

app.get('/api/portfolio/analytics', async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market);
    const imported = decisionIntelligenceStore.listPortfolio(market);
    const typeByMarket: Record<string, string> = { stocks: 'stock', options: 'option', crypto: 'crypto', prediction: 'prediction' };
    const paper: PortfolioRow[] = unifiedPaperLedgerStore.get().positions.filter(item => item.instrumentType === typeByMarket[market]).map(item => ({ instrument: item.instrumentId, market, quantity: item.quantity, price: item.currentPrice, currency: item.currency || 'UNKNOWN', averageCost: item.averageEntryPrice, accountSource: 'paper', accountId: 'unified-paper-ledger' }));
    const selection = String(req.query.accountSource || 'paper');
    if (!['paper', 'imported', 'combined'].includes(selection)) throw new Error('请选择模拟盘、导入仓位或显式合并');
    const rows = (selection === 'combined' ? [...imported, ...paper] : selection === 'imported' ? imported : paper).map(row=>({...row, datedReturns: undefined as PortfolioRow['datedReturns']}));
    let history: Awaited<ReturnType<typeof assembleHistory>> | null = null;
    if (req.query.history === '1' && rows.length && rows.length <= 20) {
      history=await assembleHistory(dataLakeCatalog,market,[...new Set(rows.map(row=>row.instrument))],new Date().toISOString(),Number(req.query.days || 365));
      for (const row of rows) {
        const actual=history.series.find(item=>item.instrument===row.instrument);
        if (actual?.dataStatus==='historical' && actual.datedReturns.length) row.datedReturns=actual.datedReturns;
      }
    }
    const data = analyzePortfolio(rows, {
      ...(req.query.benchmarkReturnPct == null ? {} : { benchmarkReturnPct: Number(req.query.benchmarkReturnPct) }),
      ...(req.query.portfolioReturnPct == null ? {} : { portfolioReturnPct: Number(req.query.portfolioReturnPct) }),
    });
    const tailRisk = { ...data.tailRisk,
      source: history ? '已发布本地日线分区与当前仓位' : '尚未装配已核验的历史收益',
      evidenceRefs: history?.evidenceRefs || [],
    };
    if (!history) tailRisk.reason = '请读取本地历史与风险序列；用户导入的收益数组不冒充已核验日线';
    data.tailRisk = tailRisk;
    const cashFlows=rows.flatMap(row=>(row.cashFlows || []).map(flow=>({...flow,instrument:row.instrument,accountId:row.accountId || null})));
    const costCoverage=rows.map(row=>({instrument:row.instrument,currency:row.currency,averageCost:row.averageCost ?? null,unrealizedPnl:row.averageCost == null ? null : (row.price-row.averageCost)*row.quantity,reason:row.averageCost == null ? '旧记录未关联成本，未推算盈亏':null}));
    res.json(decisionEnvelope({ market, data: { ...data, positions: rows, accounts: { imported, paper }, accountSource: selection,history,cashFlows,costCoverage,historyReason:history ? '历史曲线用于当前持仓的风险研究；缺少完整历史仓位、现金流或汇率时，不作为实际账户收益。' : '可读取本地历史装配风险序列' }, dataStatus: rows.length ? data.currencyReason || history?.dataStatus === 'partial' || history?.dataStatus === 'unavailable' ? 'partial' : 'cached' : 'empty', source: selection === 'paper' ? '统一模拟账本' : selection === 'imported' ? '校验后的导入仓位' : '用户显式选择合并', reason: rows.length ? data.currencyReason || data.returnReason : '所选账户当前市场暂无仓位' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.get('/api/portfolio/attribution',(req,res)=>{
  if(!adminOnly(req,res))return;
  try {
    const market=decisionMarket(req.query.market),selection=String(req.query.accountSource || 'paper');
    if(!['paper','imported','combined'].includes(selection))throw new Error('请选择模拟盘、导入仓位或显式合并');
    const type=({stocks:'stock',options:'option',crypto:'crypto',prediction:'prediction'} as const)[market],ledger=unifiedPaperLedgerStore.get();
    const imported=decisionIntelligenceStore.listPortfolio(market),paper:PortfolioRow[]=ledger.positions.filter(row=>row.instrumentType===type).map(row=>({market,instrument:row.instrumentId,quantity:row.quantity,price:row.currentPrice,averageCost:row.averageEntryPrice,currency:row.currency || 'UNKNOWN',accountId:'unified-paper-ledger',accountSource:'paper'}));
    const rows=selection==='paper' ? paper:selection==='imported' ? imported:[...paper,...imported],orders=selection==='imported' ? []:ledger.orders.filter(order=>order.instrumentType===type);
    const data=portfolioAttribution(market,rows,orders);
    res.json(decisionEnvelope({market,data:{...data,accountSource:selection},dataStatus:data.dataStatus as any,source:selection==='paper'?'统一模拟账本':'显式选择的账户与原始记录',reason:data.reason}));
  }catch(error:any){res.status(400).json({success:false,dataStatus:'unavailable',reason:error.message});}
});
app.get('/api/signals/forward', async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market), now = new Date().toISOString();
    const signals = decisionIntelligenceStore.listSignalOutcomes(market).slice(-30);
    const histories = new Map<string, Promise<Awaited<ReturnType<typeof dataLakeCatalog.queryBarsAsOf>>>>();
    const data = [];
    for (const signal of signals) {
      const key = `${signal.instrument}:${signal.timeframe}`;
      if (!histories.has(key)) histories.set(key, dataLakeCatalog.queryBarsAsOf({ market,instrument:signal.instrument,timeframe:signal.timeframe,asOf:now }));
      try {
        const history = await histories.get(key)!;
        data.push({ ...observeForwardSignal(signal, history.rows.map(row => ({ time: String(row.timestamp), high:Number(row.high),low:Number(row.low),close:Number(row.close) }))), historyReason:history.reason || null });
      } catch (error) { data.push({ id:signal.id,instrument:signal.instrument,dataStatus:'unavailable',reason:error instanceof Error ? error.message : '历史来源不可用',points:[] }); }
    }
    return res.json({ success:true,market,data,dataStatus:data.length ? 'historical' : 'empty',source:'已发布数据湖分区',updatedAt:now,reason:data.length ? null : '尚无前向观察信号' });
  } catch (error) { return res.status(400).json({ success:false,reason:error instanceof Error ? error.message : '观察失败' }); }
});
app.get('/api/signals/quality', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market);
    const instrument = String(req.query.instrument || '').trim() || undefined;
    assertMarketContext({ market, workspace: 'signal-quality', instrument });
    const signals = decisionIntelligenceStore.listSignalOutcomes(market, instrument);
    const data = analyzeSignalQuality(signals, {
      minimumSamples: Number(req.query.minimumSamples || 30),
      ...(req.query.benchmarkReturnPct==null ? {} : {benchmarkReturnPct:Number(req.query.benchmarkReturnPct)}),
      ...(req.query.buyHoldReturnPct == null ? {} : { buyHoldReturnPct: Number(req.query.buyHoldReturnPct) }),
      ...(req.query.randomBaselineReturnPct == null ? {} : { randomBaselineReturnPct: Number(req.query.randomBaselineReturnPct) }),
    });
    res.json(decisionEnvelope({ market, instrument, data, dataStatus: signals.length ? 'cached' : 'empty', source: 'persisted signal outcomes', reason: signals.length ? null : '暂无已完成的信号样本' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/signals/outcomes', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const signal = req.body || {};
    const market = decisionMarket(signal.market);
    assertMarketContext({ market, workspace: 'signal-quality', instrument: signal.instrument });
    if (!signal.id || !signal.strategyId || !signal.timeframe || !signal.source || !Number.isFinite(Number(signal.triggeredAt)) || !Number.isFinite(Number(signal.entryPrice))) throw new Error('Signal outcome is incomplete');
    const previous = decisionIntelligenceStore.getSignalOutcome(String(signal.id));
    if (previous && (previous.market !== market || previous.instrument !== signal.instrument)) throw new Error('Signal identity and market cannot change');
    if (signal.status && !['generated', 'confirmed', 'paper-filled', 'tracking', 'invalidated', 'closed', 'expired', 'reviewed'].includes(String(signal.status))) throw new Error('Signal status is invalid');
    if (previous && signal.status && signal.status !== previous.status) {
      if (!String(signal.statusReason || signal.invalidationReason || '').trim()) throw new Error('Signal status changes require a reason');
      if (previous.status && !canTransitionSignalStatus(previous.status, signal.status)) throw new Error(`Invalid signal status transition: ${previous.status} -> ${signal.status}`);
    }
    const saved = decisionIntelligenceStore.saveSignalOutcome({ ...signal, market, triggeredAt: Number(signal.triggeredAt), entryPrice: Number(signal.entryPrice) });
    res.status(201).json(decisionEnvelope({ market, instrument: signal.instrument, data: saved, source: signal.source }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.get('/api/signals/:id/history', (req, res) => {
  if (!adminOnly(req, res)) return;
  const signal = decisionIntelligenceStore.getSignalOutcome(String(req.params.id));
  if (!signal) return res.status(404).json({ success: false, dataStatus: 'empty', reason: '信号不存在' });
  const data = researchRepository.listSignalHistory(signal.market, signal.id);
  res.json(decisionEnvelope({ market: signal.market, instrument: signal.instrument, data, dataStatus: data.length ? 'cached' : 'empty', source: 'persistent signal lifecycle history', reason: data.length ? null : '这是迁移前的旧信号记录，未保存历史状态变化' }));
});

app.post('/api/signals/:id/status', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const signal = decisionIntelligenceStore.getSignalOutcome(String(req.params.id));
    if (!signal) return res.status(404).json({ success: false, dataStatus: 'empty', reason: '信号不存在' });
    const market = decisionMarket(req.body?.market || signal.market);
    if (market !== signal.market || String(req.body?.instrument || signal.instrument) !== signal.instrument) throw new Error('Signal market and instrument cannot change');
    const status = String(req.body?.status || '') as NonNullable<typeof signal.status>;
    const reason = String(req.body?.reason || '').trim();
    if (!['generated', 'confirmed', 'paper-filled', 'tracking', 'invalidated', 'closed', 'expired', 'reviewed'].includes(status)) throw new Error('Signal status is invalid');
    if (!reason) throw new Error('状态变更必须填写原因');
    const current = signal.status || (signal.exitPrice != null ? 'closed' : signal.invalidationReason ? 'invalidated' : 'generated');
    if (!canTransitionSignalStatus(current, status)) throw new Error(`不允许的信号状态转换：${current} → ${status}`);
    const evidenceRefs = Array.isArray(req.body?.evidenceRefs) ? req.body.evidenceRefs.map(String).filter(Boolean).slice(0, 30) : [];
    const saved = decisionIntelligenceStore.saveSignalOutcome({ ...signal, status, statusReason: reason, evidenceRefs: [...new Set([...(signal.evidenceRefs || []), ...evidenceRefs])] });
    res.json(decisionEnvelope({ market, instrument: signal.instrument, data: saved, source: 'persistent signal lifecycle history' }));
  } catch (error: any) { res.status(400).json({ success: false, dataStatus: 'failed', reason: error.message || '信号状态更新失败' }); }
});

app.get('/api/workspaces', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market);
    const data = decisionIntelligenceStore.listWorkspaces(market);
    res.json(decisionEnvelope({ market, data, dataStatus: data.length ? 'cached' : 'empty', source: 'private saved workspaces', reason: data.length ? null : '暂无保存的工作区' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/workspaces', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const workspace = createSavedWorkspace(req.body || {});
    decisionIntelligenceStore.saveWorkspace(workspace);
    res.status(201).json(decisionEnvelope({ market: workspace.market, instrument: workspace.instrument, data: workspace, source: 'private saved workspaces' }));
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message, dataStatus: 'unavailable', reason: error.message });
  }
});

app.post('/api/workspaces/:id/share', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const workspace = decisionIntelligenceStore.getWorkspace(String(req.params.id));
  if (!workspace) return res.status(404).json({ success: false, error: 'Workspace not found', dataStatus: 'empty', reason: 'Workspace not found' });
  const shared = decisionIntelligenceStore.saveSharedWorkspace({ ...workspace, id: `shared_${crypto.randomUUID()}`, visibility: 'public', updatedAt: new Date().toISOString() });
  res.status(201).json(decisionEnvelope({ market: shared.market, instrument: shared.instrument, data: shared, dataStatus: 'cached', source: 'read-only shared workspace snapshot' }));
});

app.get('/api/workspaces/shared/:id', (req, res) => {
  const workspace = decisionIntelligenceStore.getSharedWorkspace(String(req.params.id));
  if (!workspace) return res.status(404).json({ success: false, error: 'Shared workspace not found', dataStatus: 'empty', reason: 'Shared workspace not found' });
  res.json(decisionEnvelope({ market: workspace.market, instrument: workspace.instrument, data: workspace, dataStatus: 'cached', source: 'read-only shared workspace snapshot' }));
});

app.get('/api/screener', async (req, res) => {
  const scope = String(req.query.scope || '') as ScreenerScope;
  if (!isScreenerScope(scope)) return res.status(400).json({ success: false, error: '筛选市场无效', data: [] });
  try {
    const filters = queryJson<Record<string, ScreenerFilter>>(req.query.filters, {});
    const rawSort = queryJson<ScreenerSort | null>(req.query.sort, null);
    const cachedRows = await globalCache.fetch(`scope:${scope}:screener:rows`, () => loadScopedScreenerRows(scope), { ttl: 15_000, staleTtl: 60_000 });
    if (!Array.isArray(cachedRows.data)) throw cachedRows.error || new Error('筛选数据暂不可用');
    let rows = cachedRows.data;
    rows = filterRows(scope, rows, filters);
    if (rawSort) rows = sortRows(scope, rows, rawSort);
    const page = paginateRows(rows, Number(req.query.pageSize) || 50, Number(req.query.page) || 1);
    sendPerformanceJson(req, res, {
      success: true,
      data: { scope, fields: fieldsForScreener(scope), actions: actionsForScreener(scope), ...page },
      freshness: { fetchedAt: new Date().toISOString(), status: cachedRows.status },
      sourceStatus: page.rows.length ? 'ok' : 'unavailable',
    }, cachedRows.status);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error?.message || '筛选失败', data: [] });
  }
});

app.get('/api/screener/templates', (req, res) => {
  const templates = loadScreenerTemplates();
  const isGuest = (req as any).user?.role === 'guest';
  res.json({ success: true, data: isGuest ? templates.filter(item => item.ownerId === 'public') : templates });
});

app.post('/api/screener/templates', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const body = req.body || {};
    const template = serializeTemplate({ name: String(body.name || ''), scope: String(body.scope || '') as ScreenerScope, filters: body.filters || {}, sort: body.sort });
    const stored: StoredScreenerTemplate = { ...template, id: `scr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ownerId: 'admin', createdAt: new Date().toISOString() };
    saveScreenerTemplates([...loadScreenerTemplates(), stored]);
    res.status(201).json({ success: true, data: stored });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || '模板无效' }); }
});

app.delete('/api/screener/templates/:id', (req, res) => {
  if (!adminOnly(req, res)) return;
  const before = loadScreenerTemplates();
  saveScreenerTemplates(before.filter(item => item.id !== String(req.params.id)));
  screenerTrackingStore.stop(String(req.params.id));
  res.json({ success: true, removed: before.length !== loadScreenerTemplates().length });
});

app.get('/api/screener/tracking', (req, res) => {
  if (!adminOnly(req, res)) return;
  res.json({ success: true, data: loadScreenerTracking() });
});

app.post('/api/screener/tracking/:id/run', async (req, res) => {
  if (!adminOnly(req, res)) return;
  const template = loadScreenerTemplates().find(item => item.id === String(req.params.id) && item.ownerId === 'admin');
  if (!template) return res.status(404).json({ success: false, error: '筛选模板不存在或不属于当前管理员' });
  const result = await refreshScreenerTemplateTracking(template);
  if (result.busy || result.cancelled) return res.status(409).json({ success: false, dataStatus: result.busy ? 'partial' : 'empty', error: result.busy ? '当前模板已在检查中' : '模板已停止或删除，本次结果未保存' });
  if (result.success) return res.json({ success: true, data: result.record });
  return res.status(result.record?.dataStatus === 'empty' ? 503 : 502).json({ success: false, data: result.record, error: result.record?.reason });
});

app.get('/api/screener/tracking/:id/history', (req, res) => {
  if (!adminOnly(req, res)) return;
  res.json({ success: true, data: screenerTrackingStore.history(String(req.params.id)), dataStatus: 'historical', source: 'SQLite screener run history' });
});

app.delete('/api/screener/tracking/:id', (req, res) => {
  if (!adminOnly(req, res)) return;
  return res.json({ success: true, removed: screenerTrackingStore.stop(String(req.params.id)) });
});

let screenerMonitorCycleRunning = false;
async function runDueScreenerMonitorCycle(): Promise<void> {
  if (screenerMonitorCycleRunning) return;
  screenerMonitorCycleRunning = true;
  try {
    const now = Date.now();
    const templates = new Map(loadScreenerTemplates().filter(item => item.ownerId === 'admin').map(item => [item.id, item]));
    const due = loadScreenerTracking().filter(item => now - Date.parse(item.attemptedAt || item.lastRunAt) >= 24 * 60 * 60_000).slice(0, 3);
    for (const tracked of due) {
      const template = templates.get(tracked.templateId);
      if (!template) {
        screenerTrackingStore.stop(tracked.templateId);
        continue;
      }
      const result = await refreshScreenerTemplateTracking(template);
      if (result.success && result.record && screenerTrackingStore.claimNotification(result.record)) {
        const entered = result.record.entered.slice(0, 5).map(id => id.split(':').pop()).join('、');
        const exited = result.record.exited.slice(0, 5).map(id => id.split(':').pop()).join('、');
        const delta = [entered ? `新进入 ${entered}` : '', exited ? `已离开 ${exited}` : ''].filter(Boolean).join('；');
        pushNotification('alert', `筛选监控「${result.record.name}」(${result.record.scope})：${delta}`);
      }
    }
  } finally { screenerMonitorCycleRunning = false; }
}
const screenerMonitorTimer = setInterval(() => { void runDueScreenerMonitorCycle(); }, 60 * 60_000);
screenerMonitorTimer.unref?.();

function parseCompareId(value: string, scope: CompareScope): { type: CompareInstrument['type']; venue: string; symbol: string; id: string } | null {
  const raw = decodeURIComponent(String(value || '').trim());
  if (!raw) return null;
  const expectedType = scope === 'stocks' ? 'stock' : scope === 'options' ? 'option' : scope === 'crypto' ? 'crypto' : 'prediction';
  const canonical = raw.match(/^(stock|option|crypto|prediction):([^:]+):(.+)$/i);
  if (canonical) {
    const type = canonical[1].toLowerCase() as CompareInstrument['type'];
    if (type !== expectedType) return null;
    return { type, venue: canonical[2], symbol: canonical[3], id: raw };
  }
  const type = expectedType;
  const venue = scope === 'stocks' ? 'us' : scope === 'options' ? 'cboe' : scope === 'crypto' ? 'binance' : 'predictfun';
  return { type, venue, symbol: raw, id: `${type}:${venue}:${raw}` };
}

app.get('/api/instruments/compare', async (req, res) => {
  const scope = String(req.query.scope || '') as CompareScope;
  if (!['stocks', 'options', 'crypto', 'prediction'].includes(scope)) return res.status(400).json({ success: false, error: '比较市场无效' });
  const ids = String(req.query.ids || '').split(',').map(item => item.trim()).filter(Boolean).slice(0, 7);
  if (!ids.length) return res.status(400).json({ success: false, error: '至少提供一个标的 ID' });
  if (ids.length > 6) return res.status(400).json({ success: false, error: '最多同时比较 6 个标的' });
  try {
    const parsed = ids.map(id => parseCompareId(id, scope));
    if (parsed.some(item => !item)) return res.status(400).json({ success: false, error: '标的 ID 无效' });
    const settled = await Promise.allSettled(parsed.map(async item => {
      if (!item) throw new Error('标的 ID 无效');
      if (scope === 'options') {
        const snapshot = await getEquityOptionsSnapshot(item.symbol);
        return { id: item.id, type: 'option' as const, symbol: item.symbol, title: `${item.symbol} 期权`, quote: { price: snapshot.spot, changePct: snapshot.quote?.changePercent ?? null, openInterest: snapshot.totalCallOpenInterest + snapshot.totalPutOpenInterest }, dataTime: snapshot.fetchedAt, sourceStatus: { source: snapshot.source } };
      }
      const ref = normalizeInstrumentRef({ type: item.type === 'option' ? 'stock' : item.type, venue: item.venue, symbol: item.symbol, title: item.symbol, aliases: [], marketId: scope === 'prediction' ? item.symbol : undefined });
      const overview = await unifiedInstrumentService.overview(ref);
      const quote = overview.quote ? { ...overview.quote, changePct: overview.quote.changePct ?? overview.quote.change24hPct ?? null } : null;
      return { id: overview.instrument.id, type: overview.instrument.type, symbol: overview.instrument.symbol, title: overview.instrument.title, quote, dataTime: overview.freshness.fetchedAt, sourceStatus: overview.sourceStatus };
    }));
    const items = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (!items.length) return res.status(503).json({ success: false, error: '比较数据暂不可用', data: [] });
    res.json({ success: true, data: compareInstruments(scope, items) });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || '比较失败' }); }
});

app.get('/api/instruments/compare/snapshots', (req, res) => {
  const snapshots = stateStore.get<Array<Record<string, unknown>>>('instrument-compare-snapshots') || [];
  const isGuest = (req as any).user?.role === 'guest';
  res.json({ success: true, data: isGuest ? snapshots.filter(item => item.visibility === 'public') : snapshots });
});

app.post('/api/instruments/compare/snapshots', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const body = req.body || {};
    const snapshot = createCompareSnapshot(String(body.scope || '') as CompareScope, body.instruments || []);
    const stored = { ...snapshot, visibility: body.visibility === 'public' ? 'public' : 'private' };
    const previous = stateStore.get<Array<Record<string, unknown>>>('instrument-compare-snapshots') || [];
    stateStore.set('instrument-compare-snapshots', [...previous, stored].slice(-50), 1);
    res.status(201).json({ success: true, data: stored });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || '比较快照无效' }); }
});

app.get('/api/health/readiness', async (_req, res) => {
  try {
    const sources = await getSourceHealth();
    const storage = getStorageHealth();
    const ready = storage.ok && sources.items.some(item => item.ok || item.configured);
    res.status(ready ? 200 : 503).json({ ok: ready, status: ready ? 'ready' : 'degraded', storage, sources });
  } catch (error) {
    res.status(503).json({ ok: false, status: 'unavailable', error: error instanceof Error ? error.message : String(error) });
  }
});

type CategorySnapshot = { data: Category[]; fetchedAt?: string };
const CATEGORY_CACHE_FILE = path.join(process.cwd(), 'data', 'predict-categories-cache.json');
let categorySnapshot: CategorySnapshot = (() => {
  try {
    const raw = fs.readFileSync(CATEGORY_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as CategorySnapshot;
    return Array.isArray(parsed.data) ? parsed : { data: [] };
  } catch {
    return { data: [] };
  }
})();
let categoryRefresh: Promise<boolean> | null = null;

async function refreshCategorySnapshot(): Promise<boolean> {
  if (categoryRefresh) return categoryRefresh;
  categoryRefresh = (async () => {
    try {
      // Ask the API for OPEN records directly, then follow a few pages so newly
      // published events are not pushed out by older unresolved categories.
      const collected: Category[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 3; page++) {
        const response = await api.getCategories(50, cursor, 'OPEN');
        collected.push(...response.data);
        cursor = response.cursor || undefined;
        if (!cursor) break;
      }

      // Some recurring markets stay OPEN briefly after their trading window ends.
      // Keep a short settlement grace period, but hide clearly stale cards.
      const staleCutoff = Date.now() - 15 * 60_000;
      const openCategories = collected
        .filter(c => c.status === 'OPEN' && c.isVisible !== false)
        .filter(c => !c.endsAt || new Date(c.endsAt).getTime() > staleCutoff)
        .sort((a, b) => new Date(a.endsAt || a.startsAt).getTime()
          - new Date(b.endsAt || b.startsAt).getTime());
      if (!openCategories.length) return false;

      categorySnapshot = { data: openCategories, fetchedAt: new Date().toISOString() };
      await fs.promises.mkdir(path.dirname(CATEGORY_CACHE_FILE), { recursive: true });
      await fs.promises.writeFile(CATEGORY_CACHE_FILE, JSON.stringify(categorySnapshot), 'utf8');
      return true;
    } catch {
      // Keep the last good snapshot; the next UI refresh will try again.
      return false;
    } finally {
      categoryRefresh = null;
    }
  })();
  return categoryRefresh;
}

// Get all open categories with markets. A disk snapshot makes repeat launches
// paint instantly; the live source refreshes in the background.
app.get('/api/categories', async (req, res) => {
  const force = req.query.refresh === '1';
  if (categorySnapshot.data.length && !force) {
    void refreshCategorySnapshot();
    res.json({ success: true, data: categorySnapshot.data, cached: true, fetchedAt: categorySnapshot.fetchedAt });
    return;
  }

  const refreshed = await refreshCategorySnapshot();
  if (categorySnapshot.data.length) {
    res.json({ success: true, data: categorySnapshot.data, cached: !refreshed, fetchedAt: categorySnapshot.fetchedAt });
    return;
  }
  res.json({ success: false, error: 'Predict.fun 数据源暂时不可用，且暂无本地快照' });
});


// Get market stats and orderbooks through short shared caches. The category list
// can create hundreds of card updates, so duplicate requests must not multiply
// upstream traffic or crowd out slower dashboard sections.
app.get('/api/markets/:id/stats', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const response = await getFreshExternal(`market-stats:${id}`, 30_000,
      () => api.getMarketStats(id));
    res.json({ success: true, data: response.data });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/markets/:id/orderbook', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const response = await getFreshExternal(`market-orderbook:${id}`, 20_000,
      () => api.getOrderbook(id));
    res.json({ success: true, data: response.data });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});


// --- Binance Extended ---

app.get('/api/binance/klines', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTCUSDT').toUpperCase();
    const interval = String(req.query.interval || '1h');
    const limit = Number(req.query.limit || '100');
    liveKlineScope('crypto', symbol, interval);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Error('K线数量须为 1–1000');
    const page=req.query.before===undefined?undefined:klinePageWindow('crypto',interval,Number(req.query.before),limit);
    const previous = binanceFeed.klineCachedAt(symbol,interval,limit,page?.before);
    const klines = await binanceFeed.getKlines(symbol, interval, limit,{before:page?.before});
    const updatedAt = binanceFeed.klineCachedAt(symbol,interval,limit,page?.before);
    res.json({ success: !!klines.length, market: 'crypto', instrument: 'crypto:binance:' + symbol, timeframe: interval, data: klines, history:{nextBefore:klines[0]?.time??null,requestedWindow:page??null,hasEarlier:null},source: 'Binance Public Klines', updatedAt, dataStatus: !klines.length ? 'unavailable' : previous === updatedAt ? 'cached' : page?'historical':'delayed', reason: klines.length ? 'REST 快照，不代表交易所实时推流；更早记录是否存在以来源响应为准' : 'Binance K线来源未返回有效记录' });
  } catch (e: any) { res.json({ success: false, error: e.message }); }
});

app.get('/api/binance/depth', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTCUSDT');
    const depthLimit = parseInt(String(req.query.limit || '20'));
    const depth = await binanceFeed.getDepth(symbol, depthLimit);
    res.json({ success: !!depth && depth.sourceStatus === 'ok', data: depth });
  } catch (e: any) { res.json({ success: false, error: e.message }); }
});

app.get('/api/binance/movers', async (req, res) => {
  try {
    const movers = await binanceFeed.getTopMovers();
    res.json({ success: true, data: movers });
  } catch (e: any) { res.json({ success: false, error: e.message }); }
});

app.get('/api/binance/trades', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'BTCUSDT');
    const tradesLimit = parseInt(String(req.query.limit || '15'));
    const trades = await binanceFeed.getRecentTrades(symbol, tradesLimit);
    res.json({ success: true, data: trades });
  } catch (e: any) { res.json({ success: false, error: e.message }); }
});

// --- Market Sentiment ---

app.get('/api/sentiment', async (req, res) => {
  try {
    const cached = getCached('sentiment');
    if (cached) return res.json({ success: true, data: cached });
    const apiRes = await fetch('https://api.alternative.me/fng/?limit=7', { signal: AbortSignal.timeout(10000) });
    if (!apiRes.ok) throw new Error('F&G API failed');
    const d: any = await apiRes.json();
    setCached('sentiment', d.data);
    res.json({ success: true, data: d.data });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/heatmap', async (req, res) => {
  try {
    const cached = getCached('heatmap');
    if (cached) return res.json({ success: true, data: cached });
    // Get top coins by volume
    const movers = await binanceFeed.getTopMovers();
    const all = [...movers.gainers, ...movers.losers];

    // Also get specific popular coins
    const popular = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','LINKUSDT','MATICUSDT','UNIUSDT'];
    const tickers: any[] = [];
    await Promise.all(popular.map(async (sym) => {
      const t = await binanceFeed.getPrice(sym);
      if (t) tickers.push({ symbol: sym, changePct: t.change24hPct, price: t.price, volumeUsd: Math.round(t.volume24hUsd) });
    }));

    const result = { heatmap: tickers, movers: all };
    setCached('heatmap', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Crypto Paper Trading ---

interface CryptoPaperPosition {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  amountUsd: number;
  quantity: number;
  openedAt: number;
}

const cryptoPositions: CryptoPaperPosition[] = [];

app.post('/api/binance/paper-trade', async (req, res) => {
  try {
    const { symbol, side, amountUsd } = req.body;
    const ticker = await binanceFeed.getPrice(symbol);
    if (!ticker) { res.json({ success: false, message: '无法获取价格' }); return; }

    const pos: CryptoPaperPosition = {
      id: 'cp_' + Date.now(),
      symbol,
      side,
      entryPrice: ticker.price,
      amountUsd,
      quantity: amountUsd / ticker.price,
      openedAt: Date.now(),
    };
    cryptoPositions.unshift(pos);
    if (cryptoPositions.length > 50) cryptoPositions.pop();

    pushNotification('trade', `模拟${side === 'BUY' ? '买入' : '卖出'} ${symbol} @ ${ticker.price}`);
    res.json({ success: true, data: pos });
  } catch (e: any) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/api/binance/paper-positions', async (req, res) => {
  try {
    const positionsWithPnl = await Promise.all(
      cryptoPositions.map(async (pos) => {
        const t = await binanceFeed.getPrice(pos.symbol);
        const currentPrice = t?.price || pos.entryPrice;
        const pnl = pos.side === 'BUY'
          ? (currentPrice - pos.entryPrice) * pos.quantity
          : (pos.entryPrice - currentPrice) * pos.quantity;
        return { ...pos, currentPrice, pnl: Math.round(pnl * 100) / 100 };
      })
    );
    res.json({ success: true, data: positionsWithPnl });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Stock Market (Tencent Finance API) ---

function decodeTencentResponse(buffer: ArrayBuffer, charset = 'gb18030'): string {
  const bytes = Buffer.from(buffer);
  return iconv.decode(bytes, /utf-?8/i.test(charset) ? 'utf8' : 'gb18030');
}

async function fetchTencentText(url: string, timeoutMs = 10000): Promise<string> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error('API failed');
  // qt.gtimg.cn always serves legacy GBK, while smartbox serves UTF-8. Do not
  // rely on content-type sniffing: some local networks/proxies strip or rewrite
  // the header and turn Chinese issuer names into mojibake.
  const charset = url.includes('smartbox.gtimg.cn') ? 'utf-8' : 'gb18030';
  return decodeTencentResponse(
    await response.arrayBuffer(),
    charset
  );
}

function parseTencentStock(raw: string): any {
  // Format: v_sh000001="1~name~code~current~prevClose~open~volume~..."
  const match = raw.match(/v_\w+="([^"]+)"/);
  if (!match) return null;
  const parts = match[1].split("~");
  if (parts.length < 10) return null;
  const isUsQuote = raw.toLowerCase().startsWith('v_us');
  const englishName = String(parts[46] || '').trim();
  return {
    code: parts[2],
    // US cards stay readable even if a legacy cache/proxy mangles Chinese text;
    // Tencent provides the official English issuer name at zero-based field 46.
    name: isUsQuote && /^[A-Za-z][A-Za-z .,&'-]{2,}$/.test(englishName) ? englishName : parts[1],
    nameCN: parts[1],
    price: parseFloat(parts[3]) || 0,
    prevClose: parseFloat(parts[4]) || 0,
    open: parseFloat(parts[5]) || 0,
    volume: parseInt(parts[6]) || 0,
    high: parseFloat(parts[33]) || 0,
    low: parseFloat(parts[34]) || 0,
    change: parseFloat(parts[31]) || 0,
    changePct: parseFloat(parts[32]) || 0,
    market: raw.startsWith("v_us") ? "us" : raw.startsWith("v_hk") ? "hk" : "cn",
  };
}

function parseTencentSearch(raw: string): any[] {
  const match = raw.match(/v_hint="([^"]*)"/);
  if (!match || match[1] === 'N') return [];

  const decoded = match[1].replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );

  return decoded.split('^').map((item) => {
    const [market, symbol, name, rawAlias, securityType] = item.split('~');
    const normalizedMarket = String(market || '').toLowerCase();
    const normalizedSymbol = String(symbol || '');
    let code = '';
    let exchangeSymbol = '';
    let marketLabel = normalizedMarket.toUpperCase();
    let alias = rawAlias || '';

    if (normalizedMarket === 'us') {
      code = 'us' + normalizedSymbol.toUpperCase().replace(/\.[A-Z]+$/, '');
      exchangeSymbol = normalizedSymbol.toUpperCase();
      marketLabel = '美股';
      // "pg" is a pinyin shortcut, not useful in the UI. The exchange ticker is clearer.
      if (/^[a-z]{1,6}$/i.test(alias)) alias = exchangeSymbol;
    } else if (normalizedMarket === 'hk') {
      code = 'hk' + normalizedSymbol;
      marketLabel = '港股';
    } else if (['sh', 'sz', 'bj'].includes(normalizedMarket)) {
      code = normalizedMarket + normalizedSymbol;
      marketLabel = normalizedMarket === 'sh' ? 'A股' : normalizedMarket === 'sz' ? 'A股' : '北交所';
    }

    if (!code || !name) return null;
    return {
      code,
      name,
      alias: alias || '',
      market: marketLabel,
      exchangeSymbol,
      type: securityType || '',
    };
  }).filter(Boolean);
}

interface SecTickerRecord {
  ticker: string;
  title: string;
}

interface UsDirectoryRecord {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
}

let secTickerCache: { ts: number; value: SecTickerRecord[] } | null = null;

let usDirectoryCache: { ts: number; value: Promise<UsDirectoryRecord[]> } | null = null;
const US_DIRECTORY_CACHE_FILE = path.join(process.cwd(), 'data', 'us-directory-cache.json');
const execFileAsync = promisify(execFile);
const US_INDEX_NAMES: Record<string, { name: string; nameCN: string }> = {
  'DJI': { name: 'Dow Jones Industrial Average', nameCN: '道琼斯工业平均指数' },
  'IXIC': { name: 'Nasdaq Composite', nameCN: '纳斯达克综合指数' },
  'INX': { name: 'S&P 500', nameCN: '标普500指数' },
};

function hasBrokenUsName(value: any): boolean {
  const text = String(value || '');
  return !text.trim()
    || text.includes('\uFFFD')
    // Tencent's US names should be readable English. CJK/replacement chars in
    // this field indicate a legacy decode problem and are replaced below.
    || /[\u4e00-\u9fff\u3040-\u30ff]/.test(text);
}

async function getUsStockDirectory(): Promise<UsDirectoryRecord[]> {
  if (usDirectoryCache && Date.now() - usDirectoryCache.ts < 6 * 60 * 60_000) {
    return usDirectoryCache.value;
  }

  const request = (async (): Promise<UsDirectoryRecord[]> => {
    // The public screener is reliable but can take several seconds on its
    // first download. Keep a local copy so app restarts stay instant.
    try {
      const cachedRaw = await fs.promises.readFile(US_DIRECTORY_CACHE_FILE, 'utf8');
      const cachedPayload = JSON.parse(cachedRaw) as { savedAt?: number; rows?: UsDirectoryRecord[] };
      if (cachedPayload?.savedAt && Date.now() - cachedPayload.savedAt < 7 * 86_400_000
        && Array.isArray(cachedPayload.rows) && cachedPayload.rows.length >= 100) {
        return cachedPayload.rows;
      }
    } catch {
      // A missing or damaged cache is normal on the first run.
    }
    // Nasdaq challenges Node fetch on some networks, while system curl passes.
    // The download is about 2MB, so maxBuffer must leave enough headroom.
    const { stdout } = await execFileAsync(
      curlCommand(),
      [
        '--fail', '--silent', '--show-error', '--max-time', '20',
        '-A', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 MoneyMoney/1.0',
        '-H', 'Accept: application/json, text/plain, */*',
        '-H', 'Accept-Language: en-US,en;q=0.9',
        'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=100&download=true',
      ],
      { timeout: 25_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
    );
    const payload = JSON.parse(stdout) as any;
    const rows = payload?.data?.rows;
    if (!Array.isArray(rows) || rows.length < 100) throw new Error('US directory empty');

    const seen = new Set<string>();
    const directory = rows.map((row: any): UsDirectoryRecord | null => {
      const ticker = String(row.symbol || '').trim().toUpperCase();
      const name = String(row.name || '').replace(/\s+/g, ' ').trim();
      if (!ticker || !name || seen.has(ticker)) return null;
      seen.add(ticker);
      return {
        ticker,
        name,
        sector: String(row.sector || '').trim(),
        industry: String(row.industry || '').trim(),
      };
    }).filter(Boolean) as UsDirectoryRecord[];
    if (directory.length < 100) throw new Error('US directory invalid');
    void fs.promises.writeFile(US_DIRECTORY_CACHE_FILE, JSON.stringify({
      savedAt: Date.now(),
      rows: directory,
    })).catch(() => {});
    return directory;
  })();

  usDirectoryCache = { ts: Date.now(), value: request };
  try {
    return await request;
  } catch (error) {
    // Do not keep a failed promise cached for six hours.
    if (usDirectoryCache?.value === request) usDirectoryCache = null;
    throw error;
  }
}

async function searchNasdaqUsEquities(query: string): Promise<any[]> {
  const normalizedQuery = query.toUpperCase().replace(/[^A-Z0-9.&-]/g, '');
  if (!normalizedQuery) return [];
  const rows = await getUsStockDirectory();
  const words = query.toUpperCase().split(/\s+/).filter(Boolean);
  const scored = rows.map(row => {
    const ticker = row.ticker.toUpperCase();
    const name = row.name.toUpperCase();
    let score = 0;
    if (ticker === normalizedQuery) score = 130;
    else if (ticker.startsWith(normalizedQuery)) score = 110 - Math.min(30, ticker.length - normalizedQuery.length);

    if (words.length && words.every(word => name.includes(word))) {
      score = Math.max(score, words[0] === normalizedQuery ? 105 : 92 - Math.min(35, Math.max(0, name.indexOf(words[0]))));
    }
    if (!score) return null;
    return { row, score };
  }).filter(Boolean) as Array<{ row: UsDirectoryRecord; score: number }>;

  return scored.sort((a, b) => b.score - a.score || a.row.ticker.localeCompare(b.row.ticker))
    .slice(0, 10)
    .map(({ row }) => ({
      code: 'us' + row.ticker,
      name: row.name,
      alias: row.ticker,
      market: '美股',
      exchangeSymbol: row.ticker,
      type: 'GP',
    }));
}

async function sanitizeUsQuoteNames(stocks: any[]): Promise<any[]> {
  const usQuotes = stocks.filter(item => item?.market === 'us' && item?.code);
  if (!usQuotes.length) return stocks;
  // Resolve known indices first: Tencent intentionally provides readable
  // Chinese labels for them, and this avoids downloading the equity directory.
  const withIndices = stocks.map(item => {
    if (item?.market !== 'us') return item;
    const indexName = US_INDEX_NAMES[String(item.code || '')
      .replace(/^us/i, '')
      .replace(/[^A-Z0-9]/gi, '')];
    return indexName ? { ...item, name: indexName.nameCN, nameEN: indexName.name } : item;
  });

  // Tencent already supplies an official English issuer name for equities.
  // Download the larger directory only when one of those names is unreadable.
  const needsDirectory = withIndices.some(item => item?.market === 'us'
    && !US_INDEX_NAMES[String(item.code || '').replace(/^us/i, '').replace(/[^A-Z0-9]/gi, '')]
    && hasBrokenUsName(item.name));
  if (!needsDirectory) return withIndices;
  try {
    const directory = await getUsStockDirectory();
    const byTicker = new Map(directory.map(row => [row.ticker, row]));
    return withIndices.map(item => {
      if (item?.market !== 'us') {
        return item;
      }
      const ticker = String(item.code || '').replace(/^us/i, '').replace(/\.[A-Z]+$/i, '').toUpperCase();
      const match = byTicker.get(ticker);
      if (!match) {
        if (hasBrokenUsName(item.name)) return { ...item, name: ticker };
        return item;
      }
      const validChinese = item.nameCN && /[\u4e00-\u9fff]/.test(String(item.nameCN))
        ? item.nameCN
        : match.name;
      return { ...item, name: match.name, nameCN: validChinese };
    });
  } catch {
    return withIndices.map(item => item?.market === 'us' && hasBrokenUsName(item.name)
      ? { ...item, name: String(item.code || '').replace(/^us/i, '') }
      : item);
  }
}

async function getSecTickerDirectory(): Promise<SecTickerRecord[]> {
  // SEC's ticker file is large but stable. It gives MoneyMoney a keyless
  // fallback when Tencent's suggestion box rate-limits regional requests.
  if (secTickerCache && Date.now() - secTickerCache.ts < 6 * 60 * 60_000) {
    return secTickerCache.value;
  }
  const response = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'MoneyMoney Research support@example.com',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`SEC HTTP ${response.status}`);
  const payload = await response.json() as Record<string, { ticker?: string; title?: string }>;
  const rows = Object.values(payload)
    .map(item => ({
      ticker: String(item.ticker || '').toUpperCase(),
      title: String(item.title || '').replace(/\s*\/[A-Z0-9]+\s*$/, '').trim(),
    }))
    .filter(item => /^[A-Z0-9.-]{1,8}$/.test(item.ticker) && item.title);
  if (!rows.length) throw new Error('SEC directory empty');
  secTickerCache = { ts: Date.now(), value: rows };
  return rows;
}

async function enrichUsSearchNames(results: any[]): Promise<any[]> {
  const usResults = results.filter(item => item?.market === '美股' && item?.code);
  if (!usResults.length) return results;
  try {
    const text = await fetchTencentText(`https://qt.gtimg.cn/q=${usResults.map(item => item.code).join(',')}`);
    const quotes = text.split(';')
      .map(item => parseTencentStock(item.trim()))
      .filter(Boolean) as any[];
    const byCode = new Map(quotes.map(quote => [String(quote.code || '').toUpperCase(), quote]));
    return results.map(item => {
      if (item?.market !== '美股') return item;
      const quote = byCode.get(String(item.exchangeSymbol || item.code.replace(/^us/i, '')).toUpperCase());
      if (quote?.name && /^[A-Za-z][A-Za-z .,&'-]{2,}$/.test(quote.name)) {
        return { ...item, name: quote.name, nameCN: quote.nameCN || item.name };
      }
      return item;
    });
  } catch {
    return results;
  }
}

async function searchSecUsEquities(query: string): Promise<any[]> {
  const normalizedQuery = query.toUpperCase().replace(/[^A-Z0-9.&-]/g, '');
  if (normalizedQuery.length < 1) return [];
  const rows = await getSecTickerDirectory();
  const scored = rows.map(row => {
    const ticker = row.ticker.toUpperCase();
    const title = row.title.toUpperCase().replace(/[^A-Z0-9.& ]/g, ' ');
    let score = 0;
    if (ticker === normalizedQuery) score = 120;
    else if (ticker.startsWith(normalizedQuery)) score = 100 - Math.min(30, ticker.length - normalizedQuery.length);
    if (title.includes(` ${normalizedQuery} `)) score = Math.max(score, 95);
    else if (title.startsWith(`${normalizedQuery} `) || title.endsWith(` ${normalizedQuery}`)) score = Math.max(score, 90);
    else if (title.includes(normalizedQuery)) score = Math.max(score, 65 - Math.min(35, Math.max(0, title.indexOf(normalizedQuery))));
    return { row, score };
  }).filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.row.ticker.localeCompare(b.row.ticker))
    .slice(0, 10);
  return scored.map(({ row }) => ({
    code: 'us' + row.ticker,
    name: row.title,
    alias: row.ticker,
    market: '美股',
    exchangeSymbol: row.ticker,
    type: 'GP',
  }));
}

app.get('/api/stock/quotes', async (req, res) => {
  try {
    // Accept both internal IDs (usAAPL) and plain tickers (AAPL), so a stale
    // page or manual API call does not silently turn into an empty response.
    const symbols = String(req.query.symbols || 'sh000001,sz399001,hkHSI,usAAPL,usMSFT,usNVDA')
      .split(',')
      .map(s => s.trim())
      .map(s => !/^us/i.test(s) && /^[a-z]{1,6}$/i.test(s) ? 'us' + s.toUpperCase() : s)
      .filter(Boolean)
      .join(',');
    const cacheKey = 'stockQuotes:' + symbols.toLowerCase();
    const cached = getCached(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const url = `https://qt.gtimg.cn/q=${symbols}`;
    const text = await fetchTencentText(url);
    const stocks = await sanitizeUsQuoteNames(text.split(';')
      .map(s => parseTencentStock(s.trim()))
      .filter(Boolean));

    if (stocks.length) setCached(cacheKey, stocks);
    res.json({ success: true, data: stocks });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/stock/indices', async (req, res) => {
  try {
    const cached = getCached('stockIndices');
    if (cached) return res.json({ success: true, data: cached });

    // Major indices
    const indices = 'sh000001,sz399001,hkHSI,usDJI,usIXIC,usINX';
    const url = `https://qt.gtimg.cn/q=${indices}`;
    const text = await fetchTencentText(url);
    const stocks = await sanitizeUsQuoteNames(text.split(';')
      .map(s => parseTencentStock(s.trim()))
      .filter(Boolean));

    if (stocks.length) setCached('stockIndices', stocks);
    res.json({ success: true, data: stocks });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

function fastStockSearch(query: string): Array<Record<string, string>> {
  const normalized = String(query || '').trim().toUpperCase();
  if (!normalized) return [];
  const common = [
    { code: 'usAAPL', exchangeSymbol: 'AAPL.OQ', name: 'Apple', nameCN: '苹果', market: '美股' },
    { code: 'usMSFT', exchangeSymbol: 'MSFT.OQ', name: 'Microsoft', nameCN: '微软', market: '美股' },
    { code: 'usNVDA', exchangeSymbol: 'NVDA.OQ', name: 'NVIDIA', nameCN: '英伟达', market: '美股' },
    { code: 'usAMZN', exchangeSymbol: 'AMZN.OQ', name: 'Amazon', nameCN: '亚马逊', market: '美股' },
    { code: 'usGOOGL', exchangeSymbol: 'GOOGL.OQ', name: 'Alphabet', nameCN: '谷歌', market: '美股' },
    { code: 'usMETA', exchangeSymbol: 'META.OQ', name: 'Meta', nameCN: 'Meta', market: '美股' },
    { code: 'usTSLA', exchangeSymbol: 'TSLA.OQ', name: 'Tesla', nameCN: '特斯拉', market: '美股' },
  ];
  return common.filter(item => [item.code, item.name, item.nameCN].some(value => value.toUpperCase().includes(normalized)));
}

app.get('/api/stock/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) { res.json({ success: true, data: [] }); return; }

    const cacheKey = 'stockSearch:' + q.toLowerCase();
    const cached = getCached(cacheKey);
    if (cached) { res.json({ success: true, data: cached }); return; }
    const fastResults = fastStockSearch(q);
    if (fastResults.length) {
      setCached(cacheKey, fastResults);
      res.json({ success: true, data: fastResults });
      return;
    }

    try {
      // Smartbox occasionally rate-limits a burst of requests. Two light
      // attempts keep ordinary typing reliable without slowing failures much.
      let liveResults: any[] = [];
      for (let attempt = 0; attempt < 2 && !liveResults.length; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 300));
        const text = await fetchTencentText(
          `https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(q)}&t=all`,
          8000
        );
        liveResults = parseTencentSearch(text).slice(0, 10);
      }
      if (liveResults.length) {
        const enrichedResults = await enrichUsSearchNames(liveResults);
        // Smartbox is good for Chinese and pinyin searches, but regional
        // networks can return an empty or region-biased result for US tickers.
        // SEC is authoritative for US issuers, so merge it into normal searches.
        let secMatches: any[] = [];
        try {
          secMatches = await searchSecUsEquities(q);
        } catch {
          secMatches = [];
        }
        let nasdaqMatches: any[] = [];
        if (!enrichedResults.some(item => item?.market === '美股')) {
          try {
            nasdaqMatches = await searchNasdaqUsEquities(q);
          } catch {
            nasdaqMatches = [];
          }
        }
        const combined = [...enrichedResults, ...nasdaqMatches, ...secMatches]
          .filter((item, index, array) => array.findIndex(other => other.code === item.code) === index);
        const normalizedQuery = q.toUpperCase();
        combined.sort((a, b) => {
          const aExact = String(a.code || '').toUpperCase() === 'us' + normalizedQuery ? 0 : 1;
          const bExact = String(b.code || '').toUpperCase() === 'us' + normalizedQuery ? 0 : 1;
          return aExact - bExact;
        });
        const rankedResults = combined.slice(0, 10);
        setCached(cacheKey, rankedResults);
        res.json({ success: true, data: rankedResults });
        return;
      }
    } catch {
      // Fall back to the offline list so search still works during short network issues.
    }

    // If the suggestion endpoint is unavailable but the ticker is valid, the
    // quote endpoint can still identify it (for example during smartbox outages).
    if (/^[a-z]{1,6}$/i.test(q)) {
      try {
        const quoteText = await fetchTencentText(`https://qt.gtimg.cn/q=us${q.toUpperCase()}`, 6000);
        const quote = parseTencentStock(quoteText);
        const englishName = quoteText.match(/~([A-Za-z][A-Za-z .,&'-]{2,})~/)?.[1] || '';
        if (quote?.price > 0) {
          const directResult = [{
            code: 'us' + q.toUpperCase(),
            name: quote.name || englishName || q.toUpperCase(),
            alias: englishName,
            market: '美股',
            exchangeSymbol: quote.code,
            type: 'GP',
          }];
          setCached(cacheKey, directResult);
          res.json({ success: true, data: directResult });
          return;
        }
      } catch {
        // Continue to the offline list.
      }
    }

    // If both Tencent endpoints are blocked, Nasdaq's public screener still
    // provides a keyless US equity directory and keeps search usable.
    try {
      const nasdaqResults = await searchNasdaqUsEquities(q);
      if (nasdaqResults.length) {
        setCached(cacheKey, nasdaqResults);
        res.json({ success: true, data: nasdaqResults });
        return;
      }
    } catch {
      // Continue to the offline list.
    }

    // Popular stocks fallback
    const db = [
      { code: 'usAAPL', exchangeSymbol: 'AAPL.OQ', name: 'Apple', nameCN: '苹果', market: '美股' },
      { code: 'usMSFT', exchangeSymbol: 'MSFT.OQ', name: 'Microsoft', nameCN: '微软', market: '美股' },
      { code: 'usNVDA', exchangeSymbol: 'NVDA.OQ', name: 'NVIDIA', nameCN: '英伟达', market: '美股' },
      { code: 'usTSLA', exchangeSymbol: 'TSLA.OQ', name: 'Tesla', nameCN: '特斯拉', market: '美股' },
      { code: 'usGOOG', exchangeSymbol: 'GOOG.OQ', name: 'Google', nameCN: '谷歌', market: '美股' },
      { code: 'usAMZN', exchangeSymbol: 'AMZN.OQ', name: 'Amazon', nameCN: '亚马逊', market: '美股' },
      { code: 'usMETA', exchangeSymbol: 'META.OQ', name: 'Meta', nameCN: 'Meta', market: '美股' },
      { code: 'usBAC', exchangeSymbol: 'BAC.N', name: 'Bank of America', nameCN: '美国银行', market: '美股' },
      { code: 'usJPM', exchangeSymbol: 'JPM.N', name: 'JPMorgan Chase', nameCN: '摩根大通', market: '美股' },
      { code: 'usCOF', exchangeSymbol: 'COF.N', name: 'Capital One', nameCN: '第一资本', market: '美股' },
      { code: 'usSPY', exchangeSymbol: 'SPY', name: 'SPDR S&P 500 ETF', nameCN: '标普500 ETF', market: '美股' },
      { code: 'usQQQ', exchangeSymbol: 'QQQ', name: 'Invesco QQQ Trust', nameCN: '纳指100 ETF', market: '美股' },
      { code: 'usGLD', exchangeSymbol: 'GLD', name: 'SPDR Gold Shares', nameCN: '黄金 ETF', market: '美股' },
      { code: 'usTLT', exchangeSymbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', nameCN: '20+年美债 ETF', market: '美股' },
      { code: 'usHYG', exchangeSymbol: 'HYG', name: 'iShares iBoxx High Yield Corporate Bond ETF', nameCN: '高收益信用 ETF', market: '美股' },
      { code: 'sh600519', name: '600519', nameCN: '贵州茅台', market: 'A股' },
      { code: 'sz000001', name: '000001', nameCN: '平安银行', market: 'A股' },
      { code: 'sh601398', name: '601398', nameCN: '工商银行', market: 'A股' },
      { code: 'hk00700', name: '00700', nameCN: '腾讯控股', market: '港股' },
      { code: 'hkHSI', name: 'HSI', nameCN: '恒生指数', market: '港股' },
    ];

    const query = q.toUpperCase();
    const results = db.filter(s =>
      s.code.toUpperCase().includes(query) ||
      s.name.toUpperCase().includes(query) ||
      s.nameCN.includes(q)
    ).slice(0, 10);

    // The offline list above covers common tickers. SEC fills the long tail so
    // searches such as "Palantir", "Shopify", or an uncommon ticker still work.
    const [secResults, nasdaqFallback] = await Promise.allSettled([
      searchSecUsEquities(q),
      searchNasdaqUsEquities(q),
    ]);
    const extraResults = [
      ...(secResults.status === 'fulfilled' ? secResults.value : []),
      ...(nasdaqFallback.status === 'fulfilled' ? nasdaqFallback.value : []),
    ];
    if (extraResults.length) {
      const merged = [...results, ...extraResults]
        .filter((item, index, array) => array.findIndex(other => other.code === item.code) === index)
        .slice(0, 10);
      setCached(cacheKey, merged);
      res.json({ success: true, data: merged });
      return;
    }

    res.json({ success: true, data: results });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: [] });
  }
});

app.get('/api/stock/insider/:symbol', async (req, res) => {
  try {
    const data = await getInsiderRadar(String(req.params.symbol || ''));
    res.json({ success: true, market: 'stocks', instrument: `stock:us:${data.symbol}`, dataStatus: data.dataStatus, source: 'SEC EDGAR Form 4', updatedAt: data.updatedAt, reason: data.reason, data });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/stock/analyst/:symbol', async (req, res) => {
  try {
    res.json({ success: true, data: await getAnalystConsensusSnapshot(String(req.params.symbol || '')) });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/stock/fundamentals/:symbol', async (req, res) => {
  try {
    res.json({ success: true, data: await getFundamentalQuality(String(req.params.symbol || '')) });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/stock/short-interest/:symbol', async (req, res) => {
  try {
    res.json({ success: true, data: await getShortInterestSnapshot(String(req.params.symbol || '')) });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/stock/institutional/:symbol', async (req, res) => {
  try {
    res.json({ success: true, data: await getInstitutionalOwnershipSnapshot(String(req.params.symbol || '')) });
  } catch (e: any) {
    res.status(404).json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/stock/market-breadth', async (_req, res) => {
  try {
    res.json({ success: true, data: await getMarketBreadthSnapshot() });
  } catch (e: any) {
    res.status(503).json({ success: false, error: e.message, data: null });
  }
});

// --- Stock K-line ---

const stockKlineAdapters = new Map<string, ReturnType<typeof createYahooStockKlineAdapter>>();
const telegramCryptoKlineAdapters = new Map<string, ReturnType<typeof createBinanceKlineAdapter>>();
function getStockKlineAdapter(period: string, symbol: string) {
  const key = `${period}:${symbol}`;
  let adapter = stockKlineAdapters.get(key);
  if (!adapter) {
    adapter = createYahooStockKlineAdapter();
    stockKlineAdapters.set(key, adapter);
  }
  return adapter;
}
function getTelegramCryptoKlineAdapter(period: string, symbol: string, tradingDate: string) {
  const key=`${symbol}:${period}:${tradingDate || 'latest'}`;
  let adapter=telegramCryptoKlineAdapters.get(key);
  if(!adapter){
    adapter=createBinanceKlineAdapter({limit:1000});
    telegramCryptoKlineAdapters.set(key,adapter);
    while(telegramCryptoKlineAdapters.size>100) telegramCryptoKlineAdapters.delete(telegramCryptoKlineAdapters.keys().next().value!);
  }
  return adapter;
}

app.get('/api/stock/kline', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || 'sh600519');
    const rawApiSymbol = String(req.query.api || '').trim().toUpperCase();
    const period = String(req.query.period || req.query.interval || '1d').trim().toLowerCase();
    const tradingDate = String(req.query.date || '').trim();
    const intradayPeriod = String(req.query.intradayPeriod || period).trim().toLowerCase();
    const effectivePeriod = tradingDate ? intradayPeriod : period;
    const asOf = String(req.query.asOf || '').trim();
    if(req.query.before!==undefined&&(asOf||tradingDate))throw Error('来源历史分页不能混用本地时点或指定交易日');
    const page=req.query.before===undefined?undefined:klinePageWindow('stocks',effectivePeriod,Number(req.query.before),Number(req.query.limit||200));
    const adjustment=String(req.query.adjustment||'source');
    if(!asOf && adjustment!=='source')return res.status(422).json({success:false,data:null,market:'stocks',instrument:symbol,dataStatus:'unsupported',source:'股票K线来源口径',updatedAt:new Date().toISOString(),reason:'当前源尚未声明可转换复权口径；请使用来源口径'});
    const periodConfig = STOCK_KLINE_PERIODS[effectivePeriod as keyof typeof STOCK_KLINE_PERIODS];
    if (tradingDate && asOf) return res.status(400).json({ success: false, data: null, dataStatus: 'unsupported', source: 'Yahoo Finance 历史K线', updatedAt: new Date().toISOString(), reason: '本地历史时点与外部日内区间不能混用；请退出数据时点后再查看日内K线' });
    if (tradingDate && !/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) return res.status(400).json({ success: false, data: null, dataStatus: 'failed', source: 'Yahoo Finance 历史K线', updatedAt: new Date().toISOString(), reason: 'date 必须为 YYYY-MM-DD' });
    if (tradingDate && !['1m', '5m', '15m'].includes(intradayPeriod)) return res.status(400).json({ success: false, data: null, dataStatus: 'unsupported', source: 'Yahoo Finance 历史K线', updatedAt: new Date().toISOString(), reason: '日内周期仅支持 1m、5m、15m' });
    if (!periodConfig) {
      return res.json({
        success: false,
        data: null,
        dataStatus: 'unavailable',
        source: 'Yahoo Finance 历史K线',
        updatedAt: new Date().toISOString(),
        reason: `当前股票周期不支持：${effectivePeriod}`,
      });
    }
    const requestedSymbol = rawApiSymbol || symbol;
    if (asOf) {
      const historical = await dataLakeCatalog.queryBarsAsOf({ market: 'stocks', instrument: requestedSymbol.trim().toUpperCase(), timeframe: period, asOf });
      const data = historical.rows.map(row => {
        const time = row.timestamp instanceof Date ? row.timestamp.getTime() : Date.parse(String(row.timestamp));
        return { time, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0) };
      }).filter(row => [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite));
      const historicalReason = data.length ? undefined : (historical.reason || '历史股票K线数据不可用，未回退到实时数据');
      return res.json({
        success: data.length > 0,
        data: data.length ? data : null,
        dataStatus: data.length ? 'historical' : historical.dataStatus,
        source: historical.source || 'MoneyMoney 本地时点数据湖',
        updatedAt: historical.updatedAt || asOf,
        asOf,
        snapshotId: historical.snapshot?.id || null,
        ...stockChartDisclosure(data,adjustment,historical.adjustment),
        reason: historicalReason,
      });
    }
    const adapter = getStockKlineAdapter(effectivePeriod, requestedSymbol);
    const snapshot = await adapter.fetch({ symbol: requestedSymbol, period: effectivePeriod,...(page?{startTime:page.startTime,endTime:page.endTime+1}:{} ) });
    const updatedAt = snapshot.fetchedAt || new Date().toISOString();
    if (!snapshot.data?.length) {
      return res.json({ success: false, data: null, dataStatus: snapshot.status, source: snapshot.source, updatedAt, reason: snapshot.error || `暂无${periodConfig.label}股票K线数据` });
    }
    if (tradingDate) {
      const timezone = resolveStockExchangeTimeZone(requestedSymbol);
      const session = filterStockBarsForTradingDate(snapshot.data, tradingDate, timezone);
      return res.json({ success: session.bars.length > 0, data: session.bars,...stockChartDisclosure(session.bars,adjustment), dataStatus: session.bars.length ? snapshot.status : 'empty', market: 'stocks', instrument: requestedSymbol, timeframe: effectivePeriod, date: tradingDate, timezone, session, source: snapshot.source, updatedAt, reason: session.bars.length ? undefined : `来源 ${snapshot.source} 当前覆盖 ${session.availableDateRange ? `${session.availableDateRange.from} 至 ${session.availableDateRange.to}` : '暂无可用交易日'}；未提供 ${tradingDate} 的 ${effectivePeriod} 日内数据` });
    }
    const bars=page?snapshot.data.slice(-page.limit):snapshot.data;
    res.json({ success: true,market:'stocks',instrument:requestedSymbol,timeframe:effectivePeriod, data: bars,...stockChartDisclosure(bars,adjustment), history:{nextBefore:bars[0]?.time??null,requestedWindow:page??null,hasEarlier:null},dataStatus: klinePageStatus(snapshot.status,!!page), source: snapshot.source, updatedAt, timezone: resolveStockExchangeTimeZone(requestedSymbol), reason: snapshot.error || undefined });
  } catch (e: any) {
    res.json({
      success: false,
      data: null,
      dataStatus: 'unavailable',
      source: 'Yahoo Finance 历史K线',
      updatedAt: new Date().toISOString(),
      reason: `股票K线来源不可用：${e.message || '请求失败'}`,
      error: e.message,
    });
  }
});

app.use('/api/stocks/guru-holdings', createGuruHoldingsRouter(guruHoldings, adminOnly, () => unifiedAlertStore.listWatchlist()));

app.get('/api/diagnostics', async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = req.query.market && MARKET_IDS.includes(String(req.query.market) as MarketId) ? String(req.query.market) as MarketId : undefined;
    const sources = await getSourceHealth(market || 'all');
    const jobs = researchRepository.listJobs(market).slice(0, 50);
    const telegramConfig = getRuntimeTelegramConfig();
    const coverageRuns = dataCoverageCanary.listRuns(90);
    const coverageLatest = coverageRuns[0] || null;
    let recoveryDrill: unknown = null;
    try {
      const drillPath = path.join(DATA_ROOT, 'recovery-drill-last.json');
      if (fs.existsSync(drillPath)) recoveryDrill = JSON.parse(fs.readFileSync(drillPath, 'utf8'));
    } catch { recoveryDrill = { status: 'unavailable', reason: '恢复演练记录无法读取' }; }
    res.json({
      success: true,
      data: {
        generatedAt: new Date().toISOString(),
        version: process.env.APP_VERSION || process.env.npm_package_version || 'unknown',
        storage: getStorageHealth(),
        dataLake: dataLakeCatalog.getDiagnostics(),
        coverageCanary: {
          latest: coverageLatest,
          windows: {
            '7d': summarizeCoverageCanaryHistory(coverageRuns, 7).filter(item => !market || item.market === market),
            '30d': summarizeCoverageCanaryHistory(coverageRuns, 30).filter(item => !market || item.market === market),
          },
        },
        paperDriftMonitor: {
          lastRunAt: stateStore.get<string>(PAPER_DRIFT_MONITOR_LAST_RUN_KEY),
          lease: stateStore.getLease(PAPER_DRIFT_MONITOR_LEASE_KEY),
          pausedStrategies: driftGate.list(market).filter(item => item.paused),
          latestEvaluations: driftGate.listHistory(market, undefined, undefined, 30),
        },
        marketHistoryCapture: {
          enabled: process.env.MONEYMONEY_DISABLE_HISTORY_CAPTURE !== 'true',
          lastRun: stateStore.get(MARKET_HISTORY_CAPTURE_LAST_RUN_KEY),
          scheduler: marketHistoryCaptureScheduler.state(),
          lease: stateStore.getLease('market-history:capture-scheduler:lease'),
          intervalMinutes: 30,
          maxInstrumentsPerRun: 3,
        },
        recoveryDrill,
        sources: { total: sources.total, online: sources.online, updatedAt: sources.updatedAt, unavailable: sources.items.filter(item => !item.ok).map(item => ({ id: item.id, detail: item.detail })) },
        researchJobs: jobs.reduce<Record<string, number>>((acc, job) => { acc[job.status] = (acc[job.status] || 0) + 1; return acc; }, {}),
        telegram: { configured: telegram.isConfigured, pollingEnabled: telegramConfig.pollingEnabled, pollingRunning: telegramInteractionBot?.isRunning || false, polling: telegramInteractionBot?.pollingStatus || null, lease: stateStore.getLease('telegram:getUpdates'), stockScanSchedules:parseChatIds(telegramConfig.allowedChatIds,telegramConfig.chatId).filter(isTelegramAdmin).map(chatId=>({chatId,config:stockSignalSchedule.get(chatId),history:stockSignalSchedule.history(chatId).slice(-5),lease:stateStore.getLease('telegram:stock-signal-schedule-lease:'+chatId)})) },
        realTrading: 'disabled',
      },
    });
  } catch (error: any) {
    res.status(503).json({ success: false, error: error.message, reason: error.message, dataStatus: 'unavailable' });
  }
});

// --- DeFi Data (DeFiLlama, free) ---

app.get('/api/defi/tvl', async (req, res) => {
  try {
    const cached = getCached('defiTvl');
    if (cached) return res.json({ success: true, data: cached });

    const response = await fetch('https://api.llama.fi/v2/historicalChainTvl', {
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error('API failed');

    const data: any[] = await response.json() as any[];
    // Get last 30 days
    const recent = data.slice(-30).map((d: any) => ({
      date: d.date,
      tvl: Math.round(d.tvl),
    }));

    setCached('defiTvl', recent);
    res.json({ success: true, data: recent });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/defi/protocols', async (req, res) => {
  try {
    const cached = getCached('defiProtocols');
    if (cached) return res.json({ success: true, data: cached });

    const response = await fetch('https://api.llama.fi/protocols', {
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('API failed');

    const all: any[] = await response.json() as any[];
    const top = all
      .filter((p: any) => p.tvl > 0)
      .sort((a: any, b: any) => b.tvl - a.tvl)
      .slice(0, 15)
      .map((p: any) => ({
        name: p.name,
        tvl: Math.round(p.tvl),
        chain: p.chain || 'Multi-chain',
        category: p.category || 'Other',
      }));

    setCached('defiProtocols', top);
    res.json({ success: true, data: top });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Macro Indicators ---

function handleOptionsHistory(req: express.Request, res: express.Response) {
  try {
    const market = String(req.query.market || '') as MarketId;
    const instrument = String(req.query.instrument || '').trim();
    const from = String(req.query.from || '').trim();
    const to = String(req.query.to || '').trim();
    if (market !== 'options') return res.status(400).json({ success: false, market, dataStatus: 'unsupported', reason: '期权历史快照必须指定 market=options；加密期权也归入期权链，不会混入虚拟币现货' });
    if (!instrument) return res.status(400).json({ success: false, market, dataStatus: 'failed', reason: '必须指定规范期权标的 ID，例如 option:cboe:AAPL 或 option:deribit:BTC' });
    for (const date of [from, to].filter(Boolean)) if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) return res.status(400).json({ success: false, market, instrument, dataStatus: 'failed', reason: 'from/to 必须为有效 YYYY-MM-DD 日期' });
    if (from && to && from > to) return res.status(400).json({ success: false, market, instrument, dataStatus: 'failed', reason: 'from 不能晚于 to' });
    const data = dataLakeCatalog.listOptionSnapshots({ market: 'options', instrument, from: from || undefined, to: to || undefined });
    const dates = [...new Set(data.map(item => item.tradeDate))].sort();
    const start = from || dates[0] || null;
    const end = to || dates.at(-1) || null;
    const calendarGaps: string[] = [];
    if (start && end) {
      const cursor = new Date(`${start}T00:00:00.000Z`);
      const last = Date.parse(`${end}T00:00:00.000Z`);
      const observed = new Set(dates);
      while (cursor.getTime() <= last && calendarGaps.length < 366) {
        const day = cursor.toISOString().slice(0, 10);
        if (!observed.has(day)) calendarGaps.push(day);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    res.json({ success: true, market, instrument, data, coverage: { observedDates: dates, calendarGaps, gapNote: '日历缺口未区分周末、交易所假日与采集缺失，不能据此认定来源故障。', from: start, to: end }, dataStatus: data.length ? 'historical' : 'empty', source: [...new Set(data.map(item => item.source))].join(', ') || 'CBOE Delayed Quotes / Deribit Public API', updatedAt: data.at(-1)?.fetchedAt || new Date().toISOString(), reason: data.length ? null : '本地尚无该期权标的的真实历史快照；从当前来源成功读取后才会开始积累，不回填推测历史' });
  } catch (error: any) { res.status(400).json({ success: false, market: String(req.query.market || 'options'), dataStatus: 'failed', reason: error.message }); }
}

app.get('/api/options/history', handleOptionsHistory);

app.get('/api/options/history/compare', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const instrument = String(req.query.instrument || '');
    const data = compareOptionSnapshots(dataLakeCatalog.listOptionSnapshots({ market: 'options', instrument, from: req.query.from ? String(req.query.from) : undefined, to: req.query.to ? String(req.query.to) : undefined }));
    return res.json({ success: true, market: 'options', instrument, data, dataStatus: data.coverage.length ? 'historical' : 'empty', source: data.coverage.at(-1)?.source || '本地真实期权快照', updatedAt: data.coverage.at(-1)?.at || null, reason: data.reason });
  } catch (error) { return res.status(400).json({ success: false, dataStatus: 'failed', reason: error instanceof Error ? error.message : '比较失败' }); }
});
app.get('/api/market-history', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market), instrument = String(req.query.instrument || '');
    const data = summarizeMarketHistory(decisionIntelligenceStore.listEvidence(market, instrument).filter(row => row.workspace === 'market-history'), market, instrument);
    return res.json({ success: true, ...data, source: [...new Set(data.series.map(row => row.source.name))].join(', ') || '本地证据快照', updatedAt: data.series.at(-1)?.observedAt || null });
  } catch (error) { return res.status(400).json({ success: false, dataStatus: 'failed', reason: error instanceof Error ? error.message : '查询失败' }); }
});
async function captureMarketHistoryEvidence(market: MarketId, instrument: string, mode: 'daily' | 'manual' = 'manual') {
  assertMarketContext({ market, instrument, workspace: 'market-history' });
  const previous = decisionIntelligenceStore.listEvidence(market, instrument).find(row => row.workspace === 'market-history');
  if (previous && Date.now() - Date.parse(previous.fetchedAt) < 120_000) return { evidence: previous, reused: true };
  const leaseKey = `market-history:capture:${market}:${instrument}`;
  const owner = `history-item-${process.pid}-${crypto.randomUUID()}`;
  if (!stateStore.acquireLease(leaseKey, owner, Date.now(), 180_000)) throw new Error('该标的的历史快照正在由另一个请求采集');
  try {
    let fields: Record<string, unknown> = {}, source = '', observedAt = '', sourceUrl = '', dataStatus: 'cached' | 'delayed' | 'live' = 'cached';
    let optionSnapshotId: string | undefined;
    if (market === 'options') {
      const parts = instrument.match(/^option:(cboe|deribit):([A-Z][A-Z0-9.]{0,14})$/i);
      if (!parts) throw new Error('期权快照只接受 option:cboe:SYMBOL 或 option:deribit:BTC/ETH');
      const venue = parts[1].toLowerCase(), asset = parts[2].toUpperCase();
      if (venue === 'deribit' && !['BTC', 'ETH'].includes(asset)) throw new Error('Deribit 当前只支持 BTC、ETH 期权链');
      const snapshot = venue === 'cboe' ? await getEquityOptionsSnapshot(asset) : await getOptionsSnapshot(asset);
      const contractCount = snapshot.expiries.reduce((sum, expiry) => sum + expiry.rows.length, 0);
      if (!contractCount) throw new Error(`${snapshot.source} 没有返回可保存的真实期权合约`);
      const saved = dataLakeCatalog.saveOptionsChainSnapshot({ market: 'options', instrument, underlyingMarket: venue === 'cboe' ? 'stocks' : 'crypto', source: snapshot.source as any, fetchedAt: snapshot.fetchedAt, timezone: venue === 'cboe' ? 'America/New_York' : 'UTC', mode, snapshot: snapshot as any });
      optionSnapshotId = saved.id;
      fields = { spot: snapshot.spot, expiryCount: snapshot.expiries.length, contractCount, totalCallOpenInterest: snapshot.totalCallOpenInterest, totalPutOpenInterest: snapshot.totalPutOpenInterest, putCallOpenInterestRatio: snapshot.totalPutCallOIRatio, iv30Pct: snapshot.quote?.iv30Pct ?? null, snapshotId: saved.id, contentHash: saved.contentHash };
      source = snapshot.source; observedAt = snapshot.fetchedAt; sourceUrl = venue === 'cboe' ? 'https://www.cboe.com' : 'https://www.deribit.com';
      dataStatus = venue === 'cboe' ? 'delayed' : 'live';
    } else if (market === 'crypto') {
      const parts = instrument.match(/^crypto:(binance|gateio):([A-Z0-9_]+)$/i);
      if (!parts) throw new Error('当前仅支持 Binance 现货深度或 Gate.io 永续，必须明确交易场所');
      if (parts[1].toLowerCase() === 'binance') {
        const data = await getOrderFlowLiquidityRadar();
        const requestedBase = parts[2].toUpperCase().replace(/(?:USDT|USDC)$/, '');
        const row = data.rows.find(row => row.symbol.toUpperCase() === requestedBase);
        if (!row) throw new Error('当前 Binance 来源未覆盖该标的');
        fields = { bidDepthUsd: row.bidUsd, askDepthUsd: row.askUsd, spreadPct: row.spreadBps / 100, price: row.price, pair: parts[2].toUpperCase() };
        source = data.source; observedAt = data.generatedAt; sourceUrl = 'https://www.binance.com';
      } else {
        const data = await getPerpetualCrowding();
        const row = data.rows.find(row => row.contract.toUpperCase() === parts[2].toUpperCase());
        if (!row) throw new Error('当前 Gate.io 来源未覆盖该永续合约');
        fields = { fundingRatePct: row.fundingRatePct, openInterestUsd: row.openInterestUsd, price: row.price, contract: row.contract };
        source = data.source; observedAt = data.generatedAt; sourceUrl = 'https://www.gate.io';
      }
    } else if (market === 'prediction') {
      const ref = telegramRefFromId(instrument);
      if (!ref) throw new Error('预测市场身份无法解析');
      const radar = getCachedPredictionRadarSlice('', 240);
      const row = radar?.markets.find(row => row.id === (ref.marketId || ref.symbol) && row.platform.toLowerCase().replace(/\s+/g, '-') === ref.venue.toLowerCase());
      if (!row || !radar) throw new Error('当前预测来源缓存未覆盖该事件；请先打开或刷新当前事件');
      if (!Number.isFinite(row.yesPrice)) throw new Error('来源未提供真实概率');
      const settlement = predictionSettlementRepository.latest(row.platform, row.id);
      fields = { probability: row.yesPrice, liquidity: row.liquidity, deadline: row.endDate || null, rules: settlement?.rulesText || null,
        settlementStatus: settlement?.status || 'unknown', settlementEvidenceUrl: settlement?.sourceUrl || null, settlementEvidenceOfficial: Boolean(settlement?.sourceUrl) };
      source = row.platform; observedAt = radar.updatedAt; sourceUrl = row.url || '';
    } else throw new Error('当前市场不支持该历史快照采集能力');
    const fetchedAt = new Date().toISOString();
    const evidence = createEvidenceSnapshot({ market, instrument, workspace: 'market-history', dataStatus, source: { id: `${market}:${instrument.split(':')[1]}`, name: source, url: sourceUrl || null }, observedAt, fetchedAt, fields, expectedFields: Object.keys(fields) });
    decisionIntelligenceStore.saveEvidence(evidence);
    return { evidence, reused: false, optionSnapshotId };
  } finally { stateStore.releaseLease(leaseKey, owner); }
}

const MARKET_HISTORY_CAPTURE_LAST_RUN_KEY = 'market-history:capture-scheduler:last-run';
async function runMarketHistoryCaptureCycle(): Promise<unknown> {
  if (marketHistoryCaptureTask) return marketHistoryCaptureTask;
  marketHistoryCaptureTask = (async () => {
    const ids = unifiedAlertStore.listWatchlist();
    const result = await marketHistoryCaptureScheduler.runOnce(ids, async target => {
      const { evidence } = await captureMarketHistoryEvidence(target.market, target.instrument, 'daily');
      return { status: evidence.dataStatus, reason: evidence.reason };
    });
    stateStore.set(MARKET_HISTORY_CAPTURE_LAST_RUN_KEY, { at: new Date().toISOString(), attempted: result.attempted, acquired: result.acquired, results: result.results });
    return result;
  })().finally(() => { marketHistoryCaptureTask = null; });
  return marketHistoryCaptureTask;
}

function startMarketHistoryCaptureMonitor(): void {
  if (process.env.MONEYMONEY_DISABLE_HISTORY_CAPTURE === 'true' || marketHistoryCaptureTimer) return;
  marketHistoryCaptureTimer = setInterval(() => { void runMarketHistoryCaptureCycle().catch(error => logger.warn('market-history capture cycle failed', { reason: error instanceof Error ? error.message : String(error) })); }, 30 * 60_000);
  marketHistoryCaptureTimer.unref();
  void runMarketHistoryCaptureCycle().catch(error => logger.warn('market-history initial capture failed', { reason: error instanceof Error ? error.message : String(error) }));
}

async function stopMarketHistoryCaptureMonitor(): Promise<void> {
  if (marketHistoryCaptureTimer) clearInterval(marketHistoryCaptureTimer);
  marketHistoryCaptureTimer = null;
  await marketHistoryCaptureTask?.catch(() => {});
}

app.post('/api/market-history/capture', express.json(), async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.body?.market), instrument = String(req.body?.instrument || '');
    assertMarketContext({ market, instrument, workspace: 'market-history' });
    const { evidence, reused, optionSnapshotId } = await captureMarketHistoryEvidence(market, instrument, 'manual');
    return res.json(decisionEnvelope({ market, instrument, data: evidence, dataStatus: reused ? 'cached' : evidence.dataStatus, source: evidence.source.name, updatedAt: evidence.observedAt, reason: reused ? '两分钟采集冷却期间使用已有真实快照' : evidence.reason, evidenceRefs: [evidence.id, ...(optionSnapshotId ? [optionSnapshotId] : [])] }));
  } catch (error) { return res.status(503).json({ success: false, dataStatus: 'unavailable', reason: error instanceof Error ? error.message : '来源不可用' }); }
});
app.get('/api/options/:asset', async (req, res) => {
  try {
    const asset = String(req.params.asset || 'BTC').trim().toUpperCase();
    if (!['BTC', 'ETH'].includes(asset)) return res.status(400).json({ success: false, dataStatus: 'unsupported', market: 'options', instrument: `option:deribit:${asset}`, reason: 'Deribit 当前只支持 BTC、ETH 期权链' });
    const data = await getOptionsSnapshot(asset);
    let persistence: any = { status: 'unavailable', reason: '该来源尚未提供可保存的合约' };
    try {
      const saved = dataLakeCatalog.saveOptionsChainSnapshot({ market: 'options', instrument: `option:deribit:${asset}`, underlyingMarket: 'crypto', source: data.source as any, fetchedAt: data.fetchedAt, timezone: 'UTC', mode: 'daily', snapshot: data as any });
      persistence = { status: 'saved', id: saved.id, tradeDate: saved.tradeDate, contentHash: saved.contentHash };
    } catch (error: any) { persistence = { status: 'unavailable', reason: error.message || '期权快照写入失败' }; }
    res.json({ success: true, market: 'options', instrument: `option:deribit:${asset}`, dataStatus: data.expiries.some(expiry => expiry.rows.length) ? 'live' : 'empty', source: data.source, updatedAt: data.fetchedAt, data, snapshotPersistence: persistence, reason: persistence.status === 'saved' ? null : persistence.reason });
  } catch (e: any) {
    res.status(503).json({ success: false, market: 'options', dataStatus: 'unavailable', source: 'Deribit Public API', updatedAt: new Date().toISOString(), error: e.message, reason: e.message || 'Deribit 期权来源不可用' });
  }
});

app.get('/api/equity-options/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol || 'AAPL').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) return res.status(400).json({ success: false, market: 'options', dataStatus: 'failed', reason: '股票期权标的代码无效' });
    const data = await getEquityOptionsSnapshot(symbol);
    let persistence: any = { status: 'unavailable', reason: '该来源尚未提供可保存的合约' };
    try {
      const saved = dataLakeCatalog.saveOptionsChainSnapshot({ market: 'options', instrument: `option:cboe:${symbol}`, underlyingMarket: 'stocks', source: data.source as any, fetchedAt: data.fetchedAt, timezone: 'America/New_York', mode: 'daily', snapshot: data as any });
      persistence = { status: 'saved', id: saved.id, tradeDate: saved.tradeDate, contentHash: saved.contentHash };
    } catch (error: any) { persistence = { status: 'unavailable', reason: error.message || '期权快照写入失败' }; }
    res.json({ success: true, market: 'options', instrument: `option:cboe:${symbol}`, dataStatus: data.expiries.some(expiry => expiry.rows.length) ? 'delayed' : 'empty', source: data.source, updatedAt: data.fetchedAt, data, snapshotPersistence: persistence, reason: persistence.status === 'saved' ? null : persistence.reason });
  } catch (e: any) {
    res.status(503).json({ success: false, market: 'options', dataStatus: 'unavailable', source: 'CBOE Delayed Quotes', updatedAt: new Date().toISOString(), error: e.message, reason: e.message || 'CBOE 期权来源不可用' });
  }
});

app.post('/api/options/history/save', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const instrument = String(req.body?.instrument || '').trim();
    const match = instrument.match(/^option:(cboe|deribit):([A-Z0-9.]+)$/i);
    if (!match) throw new Error('instrument 必须是 option:cboe:SYMBOL 或 option:deribit:BTC/ETH');
    const venue = match[1].toLowerCase();
    const asset = match[2].toUpperCase();
    const isEquity = venue === 'cboe';
    const dataPromise = isEquity ? getEquityOptionsSnapshot(asset) : getOptionsSnapshot(asset);
    void dataPromise.then(snapshot => {
      const saved = dataLakeCatalog.saveOptionsChainSnapshot({ market: 'options', instrument: `option:${venue}:${asset}`, underlyingMarket: isEquity ? 'stocks' : 'crypto', source: snapshot.source as any, fetchedAt: snapshot.fetchedAt, timezone: isEquity ? 'America/New_York' : 'UTC', mode: 'manual', snapshot: snapshot as any });
      res.status(201).json({ success: true, market: 'options', instrument: saved.instrument, data: saved, dataStatus: 'historical', source: saved.source, updatedAt: saved.fetchedAt, reason: null });
    }).catch(error => res.status(503).json({ success: false, market: 'options', instrument, dataStatus: 'unavailable', source: isEquity ? 'CBOE Delayed Quotes' : 'Deribit Public API', updatedAt: new Date().toISOString(), reason: error?.message || '真实期权快照不可用' }));
  } catch (error: any) { res.status(400).json({ success: false, market: 'options', dataStatus: 'failed', reason: error.message }); }
});

// --- Cross-platform Prediction Radar ---

app.get('/api/prediction-radar', async (req, res) => {
  try {
    const query = String(req.query.query || '');
    const limit = Math.min(500, Math.max(10, parseInt(String(req.query.limit || '60'), 10) || 60));
    const cachedOnly = String(req.query.cachedOnly || '') === '1';
    const radar = cachedOnly
      ? (getCachedPredictionRadarSlice(query, Math.min(24, limit)) || {
          updatedAt: '', markets: [],
          opportunities: [],
          sources: { polymarket: { ok: true, count: 0 }, kalshi: { ok: true, count: 0 }, manifold: { ok: true, count: 0 }, gjopen: { ok: true, count: 0 }, metaculus: { ok: true, count: 0 }, weather: { ok: true, count: 0 } },
        })
      : await getPredictionRadar(query, limit);
    res.json({ success: true, data: radar });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/prediction-history', (req, res) => {
  const platform = String(req.query.platform || '');
  const id = String(req.query.id || '');
  const data = getPredictionHistory(platform, id);
  if (!data) return res.json({ success: false, error: '还没有这个市场的走势快照；刷新雷达后会自动开始记录。' });
  res.json({ success: true, data });
});

async function refreshPredictionSettlement(platform:'Kalshi'|'Polymarket',marketId:string) {
  const sourceUrl=buildSettlementEndpoint(platform,marketId);
  const cached = predictionSettlementRepository.latest(platform, platform === 'Kalshi' ? marketId.toUpperCase() : marketId);
  if (cached && Date.now() - Date.parse(cached.capturedAt) < 5 * 60_000) {
    return cached;
  }
  const cacheKey = `${platform}:${platform === 'Kalshi' ? marketId.toUpperCase() : marketId}`;
  let refresh = predictionSettlementRefreshes.get(cacheKey);
  if (!refresh) {
    refresh = (async () => {
      const response = await fetch(sourceUrl, { headers: { accept: 'application/json', 'user-agent': 'MoneyMoney/1.0 (+https://github.com/blueicx/MoneyMoney)' }, signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`官方结算来源 HTTP ${response.status}`);
      const raw = await response.json() as Record<string, unknown>;
      const payload = raw && typeof raw.market === 'object' && raw.market !== null ? raw.market as Record<string, unknown> : raw;
      if (!settlementPayloadMatches(platform, marketId, payload)) throw new Error('官方来源返回的市场身份与请求标的不一致。');
      let resolutionPayload: Record<string, unknown> | undefined;
      let determinationSourceUrl: string | null = null;
      let resolutionReason: string | null = null;
      if (platform === 'Polymarket') {
        const conditionId = typeof payload.conditionId === 'string' ? payload.conditionId : typeof payload.condition_id === 'string' ? payload.condition_id : '';
        if (conditionId) {
          try {
            determinationSourceUrl = buildPolymarketResolutionEndpoint(conditionId);
            const resolutionResponse = await fetch(determinationSourceUrl, { headers: { accept: 'application/json', 'user-agent': 'MoneyMoney/1.0 (+https://github.com/blueicx/MoneyMoney)' }, signal: AbortSignal.timeout(8_000) });
            if (!resolutionResponse.ok) throw new Error(`官方 resolution 来源 HTTP ${resolutionResponse.status}`);
            resolutionPayload = await resolutionResponse.json() as Record<string, unknown>;
            const rows = Array.isArray(resolutionPayload.data) ? resolutionPayload.data : [];
            const matchingRows = rows.filter((row: any) => row && String(row.condition_id || '').toLowerCase() === conditionId.toLowerCase());
            if (matchingRows.length !== 1) resolutionReason = '官方 resolution 接口未返回唯一匹配的 condition 裁定记录。';
          } catch (error: any) {
            resolutionReason = error?.message || '官方 resolution 来源请求失败。';
          }
        } else resolutionReason = '市场详情未提供有效 condition ID，无法查询官方裁定记录。';
      }
      return predictionSettlementRepository.save(normalizeSettlementEvidence({ platform, marketId: cacheKey.slice(platform.length + 1), payload, resolutionPayload, determinationSourceUrl, resolutionReason, capturedAt: new Date().toISOString() }));
    })();
    predictionSettlementRefreshes.set(cacheKey, refresh);
  }
  try {
    return await refresh;
  } finally {
    if (predictionSettlementRefreshes.get(cacheKey) === refresh) predictionSettlementRefreshes.delete(cacheKey);
  }
}

app.get('/api/forecast-lab', (_req, res) => {
  try {
    res.json({ success: true, data: getForecastLabReport() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/forecast-lab/resolve', async (req, res) => {
  try {
    const key = String(req.body?.key || '');
    const outcome = String(req.body?.outcome || '');
    const data = await resolveForecastCase(key, outcome);
    if (!data) return res.json({ success: false, error: '没有找到这条待复盘预测，或结果标记无效。' });
    res.json({ success: true, data });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/prediction-position-size', (req, res) => {
  try {
    const data = calculatePredictionPosition(req.body || {});
    res.json({ success: true, data });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/stocks/:symbol/overview', async (req, res) => {
  try {
    res.json({ success: true, data: await stockDataService.overview(String(req.params.symbol || '')) });
  } catch (error: any) {
    res.status(502).json({ success: false, error: error?.message || '股票详情暂不可用', data: null });
  }
});

app.get('/api/stocks/:symbol/filings', async (req, res) => {
  try {
    const data = await stockDataService.overview(String(req.params.symbol || ''));
    res.json({ success: true, data: { symbol: data.symbol, filings: data.filings, sources: data.sources } });
  } catch (error: any) {
    res.status(502).json({ success: false, error: error?.message || '股票申报暂不可用', data: null });
  }
});

app.get('/api/stocks/:symbol/fundamentals', async (req, res) => {
  try {
    const data = await stockDataService.overview(String(req.params.symbol || ''));
    res.json({ success: true, data: { symbol: data.symbol, fundamentals: data.fundamentals, sources: data.sources } });
  } catch (error: any) {
    res.status(502).json({ success: false, error: error?.message || '股票公司事实暂不可用', data: null });
  }
});

app.get('/api/stocks/:symbol/source-health', async (req, res) => {
  try {
    const data = await stockDataService.overview(String(req.params.symbol || ''));
    res.json({ success: true, data: data.sources.map(snapshot => ({
      id: snapshot.source,
      status: snapshot.status,
      detail: snapshot.error || snapshot.status,
      fetchedAt: snapshot.fetchedAt,
      expiresAt: snapshot.expiresAt,
      latencyMs: snapshot.latencyMs,
    })) });
  } catch (error: any) {
    res.status(502).json({ success: false, error: error?.message || '股票数据源状态暂不可用', data: [] });
  }
});

app.get('/api/source-health', async (req, res) => {
  try {
    res.json({ success: true, data: await getSourceHealth(String(req.query.scope || 'all')) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/funding-carry', async (_req, res) => {
  try {
    res.json({ success: true, data: await getFundingCarryRadar() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/calendar', async (req, res) => {
  try {
    const result = await getMacroCalendar();
    const impact = String(req.query.impact || 'all').toLowerCase();
    const upcoming = String(req.query.upcoming || 'false') === 'true';
    let events = result.events;
    if (impact !== 'all') events = events.filter(event => event.impact.toLowerCase() === impact);
    if (upcoming) {
      const now = Date.now();
      events = events.filter(event => new Date(event.date).getTime() >= now - 60 * 60 * 1000);
    }
    res.json({ success: true, data: { ...result, count: events.length, events } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});


app.get('/api/events/timeline', async (req, res) => {
  const scope = String(req.query.scope || 'overview');
  const instrumentId = String(req.query.instrumentId || '');
  if (!['overview', 'stocks', 'options', 'crypto', 'prediction'].includes(scope)) {
    return res.status(400).json({ success: false, error: '市场范围无效', data: [] });
  }
  const evidences: EventEvidence[] = [];
  const sourceStatus: Record<string, string> = { events: 'unavailable', news: 'unavailable' };

  if (scope === 'overview' || scope === 'stocks') try {
    const cal = await getUpcomingEventCalendar(7, false);
    for (const ev of cal.events) {
      const earningsSymbol = ev.id.match(/^earnings-\d{4}-\d{2}-\d{2}-(.+)$/)?.[1] || null;
      evidences.push(buildEventEvidence({
        title: ev.titleZh || ev.title,
        actual: ev.actual,
        forecast: ev.forecast,
        previous: ev.previous,
        source: ev.source,
        url: null,
        scope: scope === 'stocks' ? 'stocks' : (ev.category === 'earnings' ? 'stocks' : 'overview'),
        instrumentId: earningsSymbol ? `stock:us:${earningsSymbol}` : null,
      }));
      const evidence = evidences[evidences.length - 1];
      evidence.id = ev.id;
      evidence.kind = 'event';
      evidence.date = ev.date;
    }
    sourceStatus.events = cal.stale ? 'stale' : 'ok';
  } catch {
    sourceStatus.events = 'unavailable';
  }

  if (scope === 'overview') try {
    const news = await newsFeed.getNews();
    for (const n of news) {
      const evidence = buildEventEvidence({
        title: n.title,
        actual: null, forecast: null, previous: null,
        source: n.source,
        url: n.url,
        scope: 'overview',
      });
      evidences.push({ ...evidence, kind: 'news', date: n.publishedAt, id: `news:${n.publishedAt}:${n.title}` });
    }
    sourceStatus.news = 'ok';
  } catch {
    sourceStatus.news = 'unavailable';
  }

  if (scope === 'stocks' && instrumentId) try {
    const symbol = instrumentId.match(/^stock:[^:]+:([A-Z0-9.-]+)$/i)?.[1] || '';
    if (symbol) {
      const news = await getStockNews(symbol);
      for (const item of news) {
        evidences.push(buildEventEvidence({
          title: item.title,
          actual: null,
          forecast: null,
          previous: null,
          source: item.source,
          url: item.url,
          scope: 'stocks',
          instrumentId,
          kind: 'news',
          date: item.publishedAt,
          id: `stock-news:${symbol}:${item.publishedAt}:${item.title}`,
        }));
      }
      sourceStatus.news = 'ok';
    }
  } catch {
    sourceStatus.news = 'unavailable';
  }

  const filtered = filterTimelineItems(evidences, scope, instrumentId);
  sendPerformanceJson(req, res, {
    success: true,
    data: filtered,
    scope,
    sourceStatus,
    updatedAt: new Date().toISOString(),
    freshness: { fetchedAt: new Date().toISOString(), status: Object.values(sourceStatus).some(value => value === 'ok' || value === 'stale') ? 'live' : 'unavailable' },
  }, Object.values(sourceStatus).includes('unavailable') ? 'unavailable' : 'ok');
});

app.get('/api/stocks/:symbol/coverage', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase().replace(/^US(?=[A-Z])/, '');
  try {
    const [overview, news, insider] = await Promise.allSettled([
      stockDataService.overview(symbol),
      getStockNews(symbol),
      getInsiderRadar(symbol),
    ]);
    const data = buildStockCoverageMap(symbol, { overview, news, insider });
    const values = Object.values(data.capabilities);
    const available = values.filter(item => item.status === 'live' || item.status === 'cached').length;
    const canaryRuns = dataCoverageCanary.listRuns(90);
    const canary = {
      '7d': summarizeCoverageCanaryHistory(canaryRuns, 7).find(item => item.market === 'stocks' && item.instrument === data.instrument) || null,
      '30d': summarizeCoverageCanaryHistory(canaryRuns, 30).find(item => item.market === 'stocks' && item.instrument === data.instrument) || null,
    };
    res.json({ ...createDataEnvelope({
      market: 'stocks', instrument: data.instrument, data,
      dataStatus: available === values.length ? 'live' : available ? 'partial' : 'unavailable',
      source: 'instrument coverage map', updatedAt: data.updatedAt,
      reason: available ? null : '该标的当前没有可用数据能力',
    }), canary });
  } catch (error: any) {
    res.status(400).json({ success: false, market: 'stocks', instrument: `stock:us:${symbol}`, dataStatus: 'failed', source: 'instrument coverage map', updatedAt: null, reason: error?.message || '覆盖地图不可用' });
  }
});

function eventInstrumentRef(market: MarketId, instrumentId: string) {
  const match = instrumentId.match(/^([^:]+):([^:]+):(.+)$/);
  if (!match) throw new Error('instrumentId 必须使用 market:venue:symbol 格式');
  const [type, venue, symbol] = match.slice(1);
  const expected: Record<MarketId, InstrumentType> = { stocks: 'stock', options: 'option', crypto: 'crypto', prediction: 'prediction' };
  if (type !== expected[market]) throw new Error(`Instrument ${instrumentId} does not belong to market ${market}`);
  return normalizeInstrumentRef({ type: type as InstrumentType, venue, symbol, title: symbol, aliases: [] });
}

async function loadStockEventTimeline(ref: ReturnType<typeof eventInstrumentRef>) {
  if (ref.type !== 'stock') throw new Error('股票披露时间线只接受股票标的');
  const timeline = await unifiedInstrumentService.timeline(ref);
  const [form4Result, form13fResult] = await Promise.allSettled([
    getInsiderRadar(ref.symbol),
    guruHoldings.getGuruStockHolders(ref.symbol),
  ]);
  const form4 = form4Result.status === 'fulfilled' ? form4Result.value : null;
  const form13f = form13fResult.status === 'fulfilled' ? form13fResult.value : null;
  const merged = mergeStockDisclosureTimeline({
    market: 'stocks',
    instrument: ref.id,
    retrievedAt: timeline.generatedAt,
    baseItems: timeline.items,
    form4: form4?.transactions || [],
    form4Status: form4 ? ({ live: 'ok', empty: 'empty', partial: 'partial', unavailable: 'unavailable' } as const)[form4.dataStatus] : 'unavailable',
    form4Reason: form4?.reason || (form4Result.status === 'rejected' ? String(form4Result.reason instanceof Error ? form4Result.reason.message : form4Result.reason) : null),
    form4RetrievedAt: form4?.updatedAt,
    form13f: (form13f?.holders || []).map(row => ({
      mapped: Boolean(form13f?.mapping), managerName: row.manager.filingName,
      reportPeriod: row.reportPeriod, filedAt: row.filedAt,
      previousReportPeriod: row.previousReportPeriod, previousShares: row.previousShares,
      shares: row.shares, shareDelta: row.shareDelta, change: row.change, sourceUrl: row.sourceUrl,
    })),
    form13fStatus: form13f?.dataStatus || 'unavailable',
    form13fReason: form13f?.reason || (form13fResult.status === 'rejected' ? String(form13fResult.reason instanceof Error ? form13fResult.reason.message : form13fResult.reason) : null),
    form13fRetrievedAt: form13f?.updatedAt,
  });
  return {
    ...timeline,
    items: merged.items,
    sourceStatus: { ...timeline.sourceStatus, ...merged.sourceStatus },
    sectionReasons: { ...(timeline.sectionReasons || {}), ...merged.sectionReasons },
  };
}

function persistTimelineEventEvidence(entity: ReturnType<typeof buildEventEntities>[number]) {
  const retrievedAt = new Date(entity.retrievedAt).getTime();
  const publishedAt = entity.publishedAt && Date.parse(entity.publishedAt) <= retrievedAt ? entity.publishedAt : null;
  const hasPublishedEvidence = Boolean(publishedAt);
  const evidence = createEvidenceSnapshot({
    id: `event-evidence-${entity.id}`,
    market: entity.market,
    instrument: entity.instrument,
    workspace: 'event-intelligence',
    dataStatus: hasPublishedEvidence ? 'historical' : 'partial',
    source: {
      id: `event-source:${String(entity.source.name || 'unknown').toLowerCase().replace(/[^a-z0-9.-]+/g, '-')}`,
      name: entity.source.name || '事件来源未标明',
      url: entity.source.url,
    },
    observedAt: publishedAt || entity.retrievedAt,
    fetchedAt: entity.retrievedAt,
    fields: {
      title: entity.title,
      kind: entity.kind,
      occurredAt: entity.occurredAt,
      publishedAt: entity.publishedAt,
      retrievedAt: entity.retrievedAt,
      asOf: entity.asOf,
      sourceName: entity.source.name,
      sourceUrl: entity.source.url,
    },
    expectedFields: ['title', 'kind', 'occurredAt', 'publishedAt', 'retrievedAt', 'asOf', 'sourceName', 'sourceUrl'],
    ...(hasPublishedEvidence ? {} : { reason: '来源未提供可核实且不晚于抓取时间的发布时间；不能用于时点回测入场条件' }),
  });
  decisionIntelligenceStore.saveEvidence(evidence);
  return evidence;
}

async function readEventIntelligence(req: express.Request, res: express.Response, grouped: boolean): Promise<void> {
  const market = String(req.query.market || req.query.scope || '') as MarketId;
  const instrument = String(req.query.instrument || req.query.instrumentId || '').trim();
  if (!MARKET_IDS.includes(market) || !instrument) {
    res.status(400).json({ success: false, market: MARKET_IDS.includes(market) ? market : undefined, dataStatus: 'unavailable', reason: 'market 和 instrumentId 均为必填项' });
    return;
  }
  try {
    const ref = eventInstrumentRef(market, instrument);
    if (market !== 'stocks' && (req as any).user?.role === 'admin') {
      const now = new Date().toISOString();
      let rows: Array<Record<string, unknown>> = [], reason: string | null = null, source = '当前市场历史快照';
      if (market === 'options') {
        const comparison = compareOptionSnapshots(dataLakeCatalog.listOptionSnapshots({ market:'options',instrument:ref.id }));
        rows = comparison.changes.map(change => ({ kind:'event',at:change.toAt,title:`期权链快照变化：${change.contracts.length} 个可比合约`,source:comparison.coverage.find(row => row.id === change.to)?.source, publishedAt:null }));
        reason = comparison.reason;
        source = comparison.coverage.at(-1)?.source || '真实期权链归档';
      } else {
        const history = summarizeMarketHistory(decisionIntelligenceStore.listEvidence(market,ref.id).filter(row => row.workspace === 'market-history'),market,ref.id);
        rows = history.changes.map(change => ({ kind:'event',at:change.at,publishedAt:null,source:change.source,
          title:market === 'crypto' ? `同源资金/深度变化：${Object.entries(change.deltas).map(([key,value]) => `${key} ${value >= 0 ? '+' : ''}${value}`).join(' · ') || '字段暂无可比变化'}` : `概率/规则/结算变化：${Object.entries(change.deltas).map(([key,value]) => `${key} ${value >= 0 ? '+' : ''}${value}`).join(' · ')} ${change.revisions.join('、')}` }));
        reason = history.reason || (history.series.length < 2 ? '真实快照不足两个，暂无可比事件；结算结果未知时不推断' : null);
        source = [...new Set(history.series.map(row => row.source.name))].join(', ') || source;
      }
      const entities = buildEventEntities(rows,{ market,instrument:ref.id,retrievedAt:now,asOf:now });
      const data = grouped ? clusterEventEntities(entities) : entities;
      res.json(decisionEnvelope({ market,instrument:ref.id,data,dataStatus:data.length ? 'historical' : 'empty',source,updatedAt:now,reason:reason || (data.length ? '采集变化事件，不代表官方新闻发布时间；不用于推断历史入场条件' : '当前历史区间没有可比快照事件') }));
      return;
    }
    const timeline = market === 'stocks' ? await loadStockEventTimeline(ref) : await unifiedInstrumentService.timeline(ref);
    const entities = buildEventEntities(timeline.items, { market, instrument: ref.id, retrievedAt: timeline.generatedAt, asOf: timeline.generatedAt });
    const data = grouped ? clusterEventEntities(entities) : entities;
    const availability = summarizeTimelineAvailability({ market, itemCount: data.length, sourceStatus: timeline.sourceStatus, sectionReasons: timeline.sectionReasons });
    res.json({ ...decisionEnvelope({ market, instrument: ref.id, data, dataStatus: availability.dataStatus, source: '标的事件时间线 · 行情新闻 / 财报日历 / SEC Form 4 / 13F', updatedAt: timeline.generatedAt, reason: availability.reason }), sourceStatus: availability.sourceStatuses, sectionReasons: timeline.sectionReasons || {} });
  } catch (error: any) {
    res.status(400).json({ success: false, market, instrument, dataStatus: 'unavailable', source: 'scoped instrument event timeline', updatedAt: null, reason: error?.message || '事件数据不可用' });
  }
}

app.get('/api/events/entities', async (req, res) => { await readEventIntelligence(req, res, false); });
app.get('/api/events/clusters', async (req, res) => { await readEventIntelligence(req, res, true); });
app.get('/api/events/calendar', async (req, res) => {
  try {
    const scope = requestedMarketScope(req.query.scope);
    if (scope && !['overview', 'stocks', 'options'].includes(scope)) return res.json({ success: true, data: { events: [], count: 0 } });
    const result = await getUpcomingEventCalendar(Number(req.query.days) || 7, req.query.refresh === '1');
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message || '未来事件日历暂时不可用' });
  }
});

app.get('/api/crypto/global', async (_req, res) => {
  try {
    res.json({ success: true, data: await getGlobalCryptoMetrics() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/sentiment/fear-greed', async (_req, res) => {
  try {
    res.json({ success: true, data: await getFearGreed() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/funding-rates', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    res.json({ success: true, data: await getFundingRates(limit) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

const contractResearchService = new ContractResearchService();
app.get('/api/contracts/catalog', async (req,res)=>{
  try { if(req.query.market && req.query.market!=='crypto') throw new Error('合约工作区仅支持虚拟币市场');
    res.json({success:true,...await contractResearchService.catalog(String(req.query.kind || 'perpetual') as 'perpetual'|'delivery',String(req.query.q || ''))});
  } catch(error:any) {res.status(400).json({success:false,market:'crypto',dataStatus:'failed',reason:error.message});}
});
app.get('/api/contracts/detail', async (req,res)=>{
  try {
    if(req.query.market && req.query.market!=='crypto')throw new Error('合约市场不一致');
    const panels=req.query.panels===undefined?undefined:String(req.query.panels).split(',').filter(Boolean),instrument=String(req.query.instrument||'');
    let detail=await contractResearchService.detail(instrument,panels);
    if((req as any).user?.role==='admin'&&panels?.some(key=>['openInterest','basis'].includes(key))){
      const lease='contract-history:'+instrument,owner='contract-history-'+crypto.randomUUID();let archiveReason:string|null=null;
      if(detail.dataStatus!=='cached'&&stateStore.acquireLease(lease,owner,Date.now(),60000)){
        try{await dataLakeCatalog.stageContractMetrics(detail);}catch(error:any){archiveReason=error.message;}finally{stateStore.releaseLease(lease,owner);}
      }
      detail=await loadContractPanelHistory(detail,panels,async()=>{
        const history=await dataLakeCatalog.queryContractMetrics({market:'crypto',instrument});
        if(archiveReason){history.dataStatus='partial';history.reason=archiveReason+'；'+history.reason;}
        return history;
      });
    }
    res.json({success:true,...detail});
  }
  catch(error:any){res.status(400).json({success:false,market:'crypto',dataStatus:'failed',reason:error.message});}
});
app.get('/api/contracts/history',async(req,res)=>{
  if(!adminOnly(req,res))return;
  try{if(req.query.market!=='crypto')throw Error('合约历史必须指定虚拟币市场');const instrument=String(req.query.instrument||'');contractIdentity(instrument);
    const data=await dataLakeCatalog.queryContractMetrics({market:'crypto',instrument,from:req.query.from?String(req.query.from):undefined,to:req.query.to?String(req.query.to):undefined,asOf:req.query.asOf?String(req.query.asOf):undefined,before:req.query.before?String(req.query.before):undefined,limit:req.query.limit?Number(req.query.limit):undefined});
    res.json({success:true,...data,updatedAt:data.coverage.to,evidenceRefs:data.rows.map(row=>row.evidenceRef)});
  }catch(error:any){res.status(400).json({success:false,market:'crypto',dataStatus:'failed',reason:error.message});}
});
app.post('/api/contracts/scenario', express.json(),(req,res)=>{
  if(!adminOnly(req,res))return;
  if(String(req.body.instrument || '').startsWith('crypto:gateio-delivery:') && (Number(req.body.fundingRate || 0)!==0 || Number(req.body.fundingPeriods || 0)!==0))return res.status(400).json({success:false,dataStatus:'failed',reason:'交割合约不适用永续资金费率，请将资金费率和期数设为零'});
  try {if(req.body.market!=='crypto')throw new Error('合约市场不一致');contractIdentity(String(req.body.instrument || ''));res.json({success:true,market:'crypto',instrument:req.body.instrument,data:contractScenario(req.body),dataStatus:'historical',source:'明确输入的压力情景假设',updatedAt:new Date().toISOString(),reason:'压力测试，不是行情预测或真实订单'});}
  catch(error:any){res.status(400).json({success:false,dataStatus:'failed',reason:error.message});}
});
app.get('/api/contracts/compare',async(req,res)=>{
  try {
    if(req.query.market!=='crypto')throw new Error('合约市场不一致');
    const instruments=String(req.query.instruments || '').split(',').filter(Boolean);
    if(instruments.length<2 || instruments.length>6 || new Set(instruments).size!==instruments.length)throw new Error('请选择2–6个不同合约');
    const identities=instruments.map(contractIdentity);
    if(new Set(identities.map(row=>row.contract.replace(/_USDT(?:_\d{8})?$/,''))).size!==1)throw new Error('仅比较同一底层的Gate USDT合约');
    const rows=await Promise.all(instruments.map(instrument=>contractResearchService.detail(instrument)));
    res.json({success:true,...compareContractSnapshots(rows),updatedAt:new Date().toISOString()});
  }catch(error:any){res.status(400).json({success:false,dataStatus:'unavailable',reason:error.message});}
});
app.get('/api/prediction/settlement/:platform/:marketId', async (req,res)=>{
  const platform=String(req.params.platform||''),marketId=String(req.params.marketId||'');
  const context={market:'prediction',instrument:`prediction:${platform.toLowerCase()}:${marketId}`,source:platform||'unknown',updatedAt:new Date().toISOString()};
  if(platform!=='Kalshi'&&platform!=='Polymarket')return res.status(422).json({success:false,...context,dataStatus:'unsupported',reason:'当前平台没有可核验的官方结算证据'});
  let sourceUrl:string;try{sourceUrl=buildSettlementEndpoint(platform,marketId);}catch(error:any){return res.status(400).json({success:false,...context,dataStatus:'failed',reason:error.message});}
  const cached=predictionSettlementRepository.latest(platform,platform==='Kalshi'?marketId.toUpperCase():marketId);
  try{const evidence=await refreshPredictionSettlement(platform,marketId);res.json({success:true,data:evidence,history:predictionSettlementRepository.history(platform,evidence.marketId),market:'prediction',instrument:evidence.instrument,dataStatus:evidence.capturedAt===cached?.capturedAt?'cached':'historical',source:evidence.sourceUrl,updatedAt:evidence.capturedAt,reason:evidence.reason});}
  catch(error:any){if(cached)return res.json({success:true,data:cached,history:predictionSettlementRepository.history(platform,cached.marketId),market:'prediction',instrument:cached.instrument,dataStatus:'cached',source:cached.sourceUrl,updatedAt:cached.capturedAt,reason:'官方来源刷新失败，显示最近快照：'+error.message});res.status(503).json({success:false,...context,dataStatus:'unavailable',source:sourceUrl,reason:error.message});}
});
app.get('/api/contracts/kline',async(req,res)=>{
  try {if(req.query.market && req.query.market!=='crypto')throw new Error('合约市场不一致');res.json({success:true,...await contractResearchService.chart(String(req.query.instrument || ''),String(req.query.interval || '5m'))});}
  catch(error:any){res.status(400).json({success:false,market:'crypto',dataStatus:'failed',reason:error.message});}
});
app.post('/api/contracts/capacity',express.json(),async(req,res)=>{
  if(!adminOnly(req,res))return;
  try {
    if(req.body.market!=='crypto')throw new Error('合约市场不一致');
    const snapshot=await contractResearchService.detail(String(req.body.instrument || ''));
    res.json({success:true,...contractCapacity(snapshot,{side:req.body.side,quantity:req.body.quantity})});
  }catch(error:any){res.status(400).json({success:false,dataStatus:'unavailable',reason:error.message});}
});
app.get('/api/perpetual-crowding', async (_req, res) => {
  try {
    res.json({ success: true, data: await getPerpetualCrowding() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/order-flow-liquidity', async (_req, res) => {
  try {
    res.json({ success: true, data: await getOrderFlowLiquidityRadar() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/bitcoin-onchain', async (_req, res) => {
  try {
    res.json({ success: true, data: await getBitcoinOnchainRadar() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/cross-asset-correlation', async (_req, res) => {
  try {
    res.json({ success: true, data: await getCrossAssetCorrelationRadar() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/crypto/cot', async (_req, res) => {
  try {
    res.json({ success: true, data: await getCotRadar() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/economic-indicators', async (_req, res) => {
  try {
    res.json({ success: true, data: await getEconomicIndicators() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/treasury-yields', async (_req, res) => {
  try {
    res.json({ success: true, data: await getTreasuryYields() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/cross-asset-risk', async (_req, res) => {
  try {
    res.json({ success: true, data: await getCrossAssetRisk() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/regime', async (req, res) => {
  try {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : 'BTCUSDT';
    const interval = typeof req.query.interval === 'string' ? req.query.interval : '4h';
    res.json({ success: true, data: await getMarketRegime(symbol, interval) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/support-resistance', async (req, res) => {
  try {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : 'BTCUSDT';
    const interval = typeof req.query.interval === 'string' ? req.query.interval : '4h';
    res.json({ success: true, data: await getSupportResistance(symbol, interval) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/confluence', async (req, res) => {
  try {
    const symbol = typeof req.query.symbol === 'string' ? req.query.symbol : 'BTCUSDT';
    res.json({ success: true, data: await getMultiTimeframeConfluence(symbol) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/event-risk', async (_req, res) => {
  try {
    res.json({ success: true, data: await getEventRisk() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/stock/earnings', async (req, res) => {
  try {
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    res.json({ success: true, data: await getEarningsCalendar(date) });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/fx', async (req, res) => {
  try {
    const cached = getCached('fxRates');
    if (cached) return res.json({ success: true, data: cached });
    const response = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('API failed');
    const d: any = await response.json();
    const result = { CNY: d.rates?.CNY || 0, EUR: d.rates?.EUR || 0, JPY: d.rates?.JPY || 0 };
    setCached('fxRates', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/gold', async (req, res) => {
  try {
    const cached = getCached('goldPrice');
    if (cached) return res.json({ success: true, data: cached });
    const response = await fetch(
      'https://hq.sinajs.cn/list=hf_GC',
      { headers: { Referer: 'https://finance.sina.com.cn' }, signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error('API failed');
    const text = await response.text();
    // hf_GC format: price,,bid,,high,low...
    const match = text.match(/"([^"]+)"/);
    if (!match) throw new Error('Parse error');
    const parts = match[1].split(',');
    const result = { price: parseFloat(parts[0]) || 0, prevClose: parseFloat(parts[7] || parts[2]) || 0 };
    setCached('goldPrice', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/global-spot', async (_req, res) => {
  try {
    res.json({ success: true, data: await getGlobalMacroSpotSnapshot() });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/stablecoins', async (req, res) => {
  try {
    const result = await getStablecoinLiquidity();
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});


app.get('/api/crypto-news', async (req, res) => {
  try {
    const cached = getCached('cryptoNews');
    if (cached) return res.json({ success: true, data: cached });

    const loadFeed = async (url: string): Promise<string> => {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!response.ok) throw new Error(`RSS failed (${response.status})`);
      return response.text();
    };

    let xml: string;
    try {
      // PANews provides a free, keyless Simplified Chinese feed.
      xml = await loadFeed('https://www.panewslab.com/rss.xml?lang=zh&type=NEWS');
    } catch {
      xml = await loadFeed('https://cointelegraph.com/rss');
    }

    const items = parseRssItems(xml, 10);
    if (!items.length) throw new Error('Empty RSS');

    setCached('cryptoNews', items);
    res.json({ success: true, data: items });
  } catch (e: any) {
    try {
      const response = await fetch('https://cointelegraph.com/rss', {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const items = response.ok ? parseRssItems(await response.text(), 10) : [];
      if (items.length) {
        setCached('cryptoNews', items);
        return res.json({ success: true, data: items });
      }
    } catch {}
    res.json({ success: false, error: e.message });
  }
});

// --- On-chain & Commodities ---

app.get('/api/macro/btc-chain', async (req, res) => {
  try {
    const cached = getCached('btcChain');
    if (cached) return res.json({ success: true, data: cached });

    const [heightRes, diffRes] = await Promise.all([
      fetch('https://mempool.space/api/blocks/tip/height', { signal: AbortSignal.timeout(8000) }),
      fetch('https://mempool.space/api/v1/difficulty-adjustment', { signal: AbortSignal.timeout(8000) })
    ]);

    const height = heightRes.ok ? parseInt(await heightRes.text()) : 0;
    const diffData = diffRes.ok ? await diffRes.json() as any : null;

    const result = {
      blockHeight: height,
      difficultyChangePct: diffData ? Math.round((diffData.difficultyChange || 0) * 100) / 100 : 0,
      retargetDate: diffData?.estimatedRetargetDate || '',
    };
    setCached('btcChain', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/commodities', async (req, res) => {
  try {
    const cached = getCached('commodities');
    if (cached) return res.json({ success: true, data: cached });

    const response = await fetch(
      'https://hq.sinajs.cn/list=hf_CL,hf_SI,hf_GC,hf_NG',
      { headers: { Referer: 'https://finance.sina.com.cn' }, signal: AbortSignal.timeout(8000) }
    );
    if (!response.ok) throw new Error('API failed');

    const text = await response.text();
    const parsePrice = (name: string): number => {
      const re = new RegExp(name + '="([0-9.]+)');
      const m = text.match(re);
      return m ? parseFloat(m[1]) : 0;
    };

    const result = {
      crudeOil: parsePrice('hf_CL'),
      naturalGas: parsePrice('hf_NG'),
      silver: parsePrice('hf_SI'),
      gold: parsePrice('hf_GC'),
    };
    setCached('commodities', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/macro/eth-gas', async (_req, res) => {
  try {
    const cached = getCached('ethGas');
    if (cached) return res.json({ success: true, data: cached });
    const response = await fetch('https://ethgasprice.org/api/gas', {
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('API failed');
    const json: any = await response.json();
    const d = json?.data;
    if (!d) throw new Error('Empty');
    const result = {
      rapidGwei: Number(d.rapid) || 0,
      standardGwei: Number(d.standard) || 0,
      slowGwei: Number(d.slow) || 0,
      ethPriceUsd: Number(d.priceUSD) || 0,
    };
    setCached('ethGas', result);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Chain TVL & Volume Rankings ---

app.get('/api/defi/chains', async (req, res) => {
  try {
    const cached = getCached('defiChains');
    if (cached) return res.json({ success: true, data: cached });
    const response = await fetch('https://api.llama.fi/v2/chains', { signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('API failed');
    const all: any[] = await response.json() as any[];
    const top = all
      .filter((c: any) => c.tvl > 0)
      .sort((a: any, b: any) => b.tvl - a.tvl)
      .slice(0, 10)
      .map((c: any) => ({ name: c.name, tvl: Math.round(c.tvl) }));
    setCached('defiChains', top);
    res.json({ success: true, data: top });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/binance/volume-ranking', async (req, res) => {
  try {
    // Check long-term cache first
    const entry = responseCache.get('volRankV2');
    if (entry && Date.now() - entry.ts < 300000) {
      return res.json({ success: true, data: entry.data });
    }

    // Predefined top 50 USDT pairs - much faster than fetching all 3684
    const topPairs = [
      'BTCUSDT','ETHUSDT','SOLUSDT','XRPUSDT','BNBUSDT',
      'DOGEUSDT','ADAUSDT','AVAXUSDT','DOTUSDT','LINKUSDT',
      'MATICUSDT','LTCUSDT','TRXUSDT','ATOMUSDT','NEARUSDT',
      'APTUSDT','ARBUSDT','OPUSDT','INJUSDT','SUIUSDT',
      'PEPEUSDT','SHIBUSDT','FLOKIUSDT','BONKUSDT','WIFUSDT'
    ];

    // Fetch in parallel batches of 10
    const results: any[] = [];
    for (let i = 0; i < topPairs.length; i += 10) {
      const batch = topPairs.slice(i, i + 10);
      const batchResults = await Promise.all(
        batch.map(async (sym) => {
          try {
            const r = await fetch(`${'https://data-api.binance.vision'}/api/v3/ticker/24hr?symbol=${sym}`,
              { signal: AbortSignal.timeout(8000) });
            if (!r.ok) return null;
            const d: any = await r.json();
            return {
              symbol: d.symbol.replace('USDT', ''),
              price: parseFloat(d.lastPrice),
              changePct: parseFloat(d.priceChangePercent),
              volumeUsd: Math.round(parseFloat(d.quoteVolume)),
            };
          } catch { return null; }
        })
      );
      results.push(...batchResults.filter(Boolean));
    }

    // Sort by volume descending
    results.sort((a, b) => b.volumeUsd - a.volumeUsd);

    responseCache.set('volRankV2', { data: results, ts: Date.now() });
    res.json({ success: true, data: results });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/defi/yields', async (req, res) => {
  try {
    const cached = getCached('defiYields');
    if (cached) return res.json({ success: true, data: cached });
    const response = await fetch('https://yields.llama.fi/pools', {
      signal: AbortSignal.timeout(25000)
    });
    if (!response.ok) throw new Error('API failed');
    const json: any = await response.json();
    const pools = (json.data || [])
      .filter((p: any) => p.tvlUsd > 10000000 && p.apy > 5 && p.apy < 500)
      .sort((a: any, b: any) => b.tvlUsd * b.apy - a.tvlUsd * a.apy)
      .slice(0, 10)
      .map((p: any) => ({
        project: p.project,
        symbol: p.symbol,
        apy: Math.round(p.apy * 10) / 10,
        tvlUsd: Math.round(p.tvlUsd),
        chain: p.chain,
      }));
    setCached('defiYields', pools);
    res.json({ success: true, data: pools });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.get('/api/defi/yield-quality', async (_req, res) => {
  try {
    res.json({ success: true, data: await getYieldQuality() });
  } catch (e: any) {
    res.json({ success: false, error: e.message, data: null });
  }
});

app.get('/api/crypto-news-decrypt', async (req, res) => {
  try {
    const cached = getCached('decryptNews');
    if (cached) return res.json({ success: true, data: cached });

    const response = await fetch('https://decrypt.co/feed', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!response.ok) throw new Error('RSS failed');

    const xml = await response.text();
    const items = parseRssItems(xml, 10);

    setCached('decryptNews', items);
    res.json({ success: true, data: items });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});


app.get('/api/crypto-news-btc-mag', async (req, res) => {
  try {
    const cached = getCached('btcMagNews');
    if (cached) return res.json({ success: true, data: cached });

    const response = await fetch('https://bitcoinmagazine.com/feed', {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', 'Accept': 'application/rss+xml, application/xml, text/xml, */*', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (!response.ok) throw new Error('RSS failed');

    const xml = await response.text();
    const items = parseRssItems(xml, 8);

    setCached('btcMagNews', items);
    res.json({ success: true, data: items });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Get balance

app.get('/api/balance', async (req, res) => {

  try {

    const balance = await tradingEngine.getBalance();

    // Convert BigInt to string for JSON serialization

    res.json({

      success: true,

      data: {

        wei: balance.wei.toString(),

        formatted: balance.formatted,

        usdtWei: balance.usdtWei.toString(),

        usdtFormatted: balance.usdtFormatted

      }

    });

  } catch (error: any) {

    console.error('[Balance] Error:', error.message);

    res.json({ success: false, error: error.message });

  }

});



// Get positions

app.get('/api/positions', async (req, res) => {

  try {

    const response = await api.getPositions();

    res.json({ success: true, data: response.data });

  } catch (error: any) {

    res.json({ success: false, error: error.message });

  }

});



// Get orders

app.get('/api/orders', async (req, res) => {

  try {

    const response = await api.getOrders('OPEN');

    res.json({ success: true, data: response.data });

  } catch (error: any) {

    res.json({ success: false, error: error.message });

  }

});



// Get wallet address

app.get('/api/wallet', async (req, res) => {

  try {

    const address = tradingEngine.getSignerAddress();

    const walletInfo = tradingEngine.getWalletInfo();

    res.json({ success: true, data: { address, ...walletInfo } });

  } catch (error: any) {

    res.json({ success: false, error: error.message });

  }

});



// Set approvals (required before trading)
app.post('/api/approvals', async (_req, res) => {
  res.status(403).json({ success: false, error: '真实交易执行器已禁用；当前仅支持纸面交易' });
});



// Get market by ID

app.get('/api/markets/:id', async (req, res) => {

  try {

    const response = await api.getMarketById(parseInt(req.params.id));

    res.json({ success: true, data: response.data });

  } catch (error: any) {

    res.json({ success: false, error: error.message });

  }

});



// Place order
app.post('/api/trade', async (_req, res) => {
  res.status(403).json({ success: false, error: '真实交易执行器已禁用；请使用 /api/paper/preview 和 /api/paper/open' });
});

// Cancel order
app.post('/api/orders/cancel', async (_req, res) => {
  res.status(403).json({ success: false, error: '真实交易执行器已禁用' });
});

app.get('/api/real-trading/status', (_req, res) => {
  res.json({ success: true, data: { enabled: false, reason: '当前版本只允许纸面交易，真实下单/审批/撤单均已禁用' } });
});


// Market analysis endpoint

const dataCollector = new DataCollector(30);

const analysisEngine = new AnalysisEngine(dataCollector);



app.get('/api/analysis', async (req, res) => {
  try {
    const scope = requestedMarketScope(req.query.scope) || 'overview';

    if (scope !== 'overview' && scope !== 'prediction') {
      sendPerformanceJson(req, res, {
        success: true,
        data: {
          timestamp: new Date().toISOString(),
          totalMarkets: 0,
          analyzedMarkets: 0,
          recommendations: [],
          topOpportunities: []
        },
        scope,
        sourceStatus: 'unavailable',
        message: `暂无 ${scope} 市场专用分析源`,
        updatedAt: new Date().toISOString()
      }, 'ok');
      return;
    }

    const report = await analysisEngine.analyzeAll();
    sendPerformanceJson(req, res, {
      success: true,
      data: report,
      scope,
      sourceStatus: 'ok',
      updatedAt: new Date().toISOString()
    }, 'ok');
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// Cross-market assistant: transparent reminders, not autonomous live orders.
let lastAdvisorReport: Awaited<ReturnType<typeof generateAssistantReport>> | null = null;
let advisorReportRefreshing = false;
let telegramInteractionBot: TelegramInteractionBot | null = null;
let telegramReloadPromise: Promise<void> = Promise.resolve();
let telegramPriceMonitor: NodeJS.Timeout | null = null;
let telegramSlowMonitor: NodeJS.Timeout | null = null;
let telegramDigestMonitor: NodeJS.Timeout | null = null;
let telegramEventMonitor: NodeJS.Timeout | null = null;
let sourceHealthMonitor: NodeJS.Timeout | null = null;
let dueDecisionReviewMonitor: NodeJS.Timeout | null = null;
let sourceHealthSampling = false;
let sourceHealthSampleRuns = 0;
const telegramRateLimit = new Map<string, number[]>();
function isTelegramRateLimited(chatId: string): boolean {const now=Date.now();const list=telegramRateLimit.get(String(chatId))||[];const recent=list.filter((t: number)=>now-t<60000);if(recent.length>=10){telegramRateLimit.set(String(chatId),recent);return true;}recent.push(now);telegramRateLimit.set(String(chatId),recent);return false;}

function refreshAdvisorReportInBackground(): void {
  if (advisorReportRefreshing) return;
  advisorReportRefreshing = true;
  void generateAssistantReport()
    .then(report => {
      lastAdvisorReport = report;
    })
    .catch(() => {})
    .finally(() => {
      advisorReportRefreshing = false;
    });
}

const TELEGRAM_HELP = [
  '<b>MoneyMoney 交互机器人</b>',
  '',
  '<b>快捷指令表</b>',
  '',
  '<b>市场与风险</b>',
  '/start   选择当前市场（股票、期权、虚拟币、预测市场）',
  '/market  切换当前市场，例如 /market stocks',
  '/session 查看或清空私聊上下文，例如 /session reset',
  '/today   今日总览（行情、风险、事件）',
  '/status  查看服务与配置状态',
  '/risk    查看模拟盘风险摘要',
  '/signals 扫描固定热门、美股异动和当前聊天股票自选；/signals 2 翻页，/signals continue 续扫，/signals refresh 刷新',
  '/signal  查看单条信号详情，例如 /signal 1',
  '/search  同时搜索预测市场和股票，例如 /search AAPL 或 election',
  '/q       快速查询代码，例如直接发送 SNDK、AAPL、BTC 或 /q SNDK',
  '/detail  查看统一标的详情，例如 /detail stock:us:AAPL',
  '/timeline 查看统一标的时间线，例如 /timeline stock:us:AAPL',
  '/events  查看未来 7 天事件日历',
  '/sources 查看数据源健康',
  '/history 查看风险历史与表现',
  '',
  '<b>自选与模拟盘</b>',
  '/watchlist 查看自选市场和股票；/watch add|remove &lt;ID&gt;',
  '/explain 解释当前信号，例如 /explain 1',
  '/portfolio 查看模拟盘账户总览',
  '/paper    预测市场开仓，或 /paper buy|sell <InstrumentRef> <价格> <数量> 提交股票/虚拟币纸面订单',
  '/positions 查看或关闭当前持仓',
  '/close    请求模拟平仓，例如 /close &lt;持仓ID&gt; &lt;价格&gt;',
  '/reset    请求重置模拟账户（需二次确认）',
  '/review   查看模拟交易复盘',
  '',
  '<b>研究、提醒与自动化</b>',
  '/research 查看研究工作区',
  '/tasks    查看研究/回测任务；/tasks <ID> 查看详情；/tasks cancel|resume <ID>',
  '/note     记录研究笔记，例如 /note 观察到概率变化',
  '/journal  查看研究和交易日志',
  '/alerts  查看或修改通知订阅',
  '/alert   直接建提醒；/alert draft 先预览再确认',
  '/inbox   查看私聊提醒并确认/重试',
  '/digest   查看或配置定时摘要',
  '/ops     查看自动化任务状态',
  '/strategies 查看 AI 模拟策略',
  '/backtest   只读策略回测；/backtest start <策略> <标的> 创建可跟踪任务',
  '',
  '<b>工具与诊断</b>',
  '/export   查看最近模拟交易记录',
  '/health   查看 Telegram、行情、AI 和数据源健康',
  '/ask     自然语言快捷查询，例如 /ask 看一下风险',
  '/chart   /chart <代码> [周期] [日期] 生成真实K线图与形态说明',
  '/replay   打开标的K线回放，例如 /replay stock:us:AAPL',
  '/audit   查看自己的操作审计',
  '/whoami  查看当前 Chat ID',
  '/web     获取可从手机打开的网页面板地址',
  '/test    测试机器人回复链路',
  '',
  '所有交易指令仅作用于本地模拟盘，不会触发真实下单。',
].join('\n');

function formatTelegramNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '-';
}
function getEventImpactZh(impact: string): string {
  const v = String(impact || '').toLowerCase();
  if (v === 'high') return '高';
  if (v === 'medium') return '中';
  if (v === 'low') return '低';
  if (v === 'holiday') return '假日';
  return impact || '-';
}
function formatEventLineZh(event: any): string {
  const date = escapeTelegramHtml(String(event.date || '').slice(0, 16));
  const imp = getEventImpactZh(event.impact);
  const cat = escapeTelegramHtml(event.categoryLabel || '');
  const title = escapeTelegramHtml(event.titleZh || event.title || '');
  const src = escapeTelegramHtml(event.source || '');
  return `· ${date} · ${imp}·${cat} · ${title} · ${src}`;
}
function telegramInlineReply(text: string, inlineKeyboard: TelegramInlineKeyboardButton[][]): TelegramReply {
  return { text, replyMarkup: { inline_keyboard: inlineKeyboard } as any };
}

function telegramMarketSelectorReply(chatId: string): TelegramReply {
  const labels: Record<string, string> = { stocks: '📈 股票', options: '🎯 期权', crypto: '₿ 虚拟币', prediction: '🎯 预测市场' };
  const scopes: Array<MarketScope> = ['stocks', 'options', 'crypto', 'prediction'];
  const session = telegramCommandCenterStore.getSession(chatId);
  return telegramInlineReply([
    '<b>MoneyMoney 移动研究台</b>',
    '请选择当前市场。选择后，查询、提醒、任务和模拟盘只显示该市场内容。',
    session.marketScope === 'overview' ? '当前尚未选择市场。' : `上次市场：${TELEGRAM_SCOPE_LABELS[session.marketScope]}`,
  ].join('\n'), [
    scopes.slice(0, 2).map(scope => ({ text: labels[scope], callback_data: `market:${scope}` })),
    scopes.slice(2).map(scope => ({ text: labels[scope], callback_data: `market:${scope}` })),
  ]);
}
function buildPaperPickRows(chatId: string): TelegramInlineKeyboardButton[][] {
  const watchIds = telegramCommandCenterStore.listWatchlist(chatId);
  const watchMarkets = watchIds.map(id => telegramFindMarket(id)).filter(Boolean) as any[];
  const picks = (watchMarkets.length ? watchMarkets : telegramRadarMarkets().slice(0, 8)).slice(0, 8);
  const rows: TelegramInlineKeyboardButton[][] = [];
  for (let i = 0; i < picks.length; i += 2) {
    const row: TelegramInlineKeyboardButton[] = [];
    for (let j = i; j < Math.min(i + 2, picks.length); j++) {
      const m: any = picks[j];
      const label = String(m.titleZh || m.title).slice(0, 14) || String(m.id).slice(0, 12);
      row.push({ text: label, callback_data: telegramPaperCallback('paper:pick', String(m.id), chatId) });
    }
    rows.push(row);
  }
  if (!picks.length) rows.push([{ text: '点击刷新雷达快照', callback_data: 'view:signals' }]);
  return rows;
}
function buildPaperSideRows(marketId: string, chatId: string): TelegramInlineKeyboardButton[][] {
  return [[
    { text: 'YES 看涨', callback_data: telegramPaperCallback('paper:side', `${marketId}:YES`, chatId) },
    { text: 'NO 看跌', callback_data: telegramPaperCallback('paper:side', `${marketId}:NO`, chatId) },
  ]];
}
function buildPaperAmountRows(marketId: string, side: string, chatId: string): TelegramInlineKeyboardButton[][] {
  const s = String(side).toUpperCase() === 'NO' ? 'NO' : 'YES';
  const combos: Array<[string,string,string]> = s === 'YES'
    ? [['0.55','10','YES 0.55 $10'], ['0.55','50','YES 0.55 $50'], ['0.65','10','YES 0.65 $10'], ['0.65','50','YES 0.65 $50']]
    : [['0.45','10','NO 0.45 $10'], ['0.45','50','NO 0.45 $50'], ['0.35','10','NO 0.35 $10'], ['0.35','50','NO 0.35 $50']];
  const rows: TelegramInlineKeyboardButton[][] = [];
  for (let i=0;i<combos.length;i+=2){
    rows.push(combos.slice(i,i+2).map(([price,amt,label])=>({ text: label, callback_data: telegramPaperCallback('paper:do', `${marketId}:${s}:${price}:${amt}`, chatId) })));
  }
  rows.push([{ text: `自定义：/paper open ${marketId} ${s.toLowerCase()} <价格> <金额>`, callback_data: 'menu:home' }]);
  return rows;
}

const TELEGRAM_MENU_COMMANDS: Record<string, string> = {
  '🏠 总览': 'help',
  '📊 风险中心': 'risk',
  '📋 今日总览': 'today',
  '📡 最新信号': 'signals',
  '🔎 搜索市场': 'search',
  '📅 事件日历': 'events',
  '⭐ 自选市场': 'watchlist',
  '🧠 信号解释': 'explain',
  '📒 模拟盘': 'portfolio',
  '🔬 研究工作区': 'research',
  '📚 交易复盘': 'review',
  '📝 研究日志': 'journal',
  '🩺 数据源健康': 'sources',
  '📈 历史表现': 'history',
  '🔔 提醒设置': 'alerts',
  '🗓 定时摘要': 'digest',
  '⚙ 自动化状态': 'ops',
  '🩺 系统状态': 'health',
  '🔔 通知测试': 'test',
  '❓ 帮助': 'help',
  '⬅ 上一页': 'menu_prev',
  '菜单 1/3': 'menu_page',
  '菜单 2/3': 'menu_page',
  '菜单 3/3': 'menu_page',
  '下一页 ➡': 'menu_next',
};

const TELEGRAM_SCOPE_LABELS: Record<MarketScope, string> = {
  overview: '总体',
  stocks: '股票',
  options: '期权',
  crypto: '虚拟币',
  prediction: '预测市场',
  watchlist: '自选',
};

function telegramScopeForChat(chatId: string): MarketScope {
  return telegramCommandCenterStore.getActiveMarketScope(chatId);
}

function telegramScopeHeader(scope: MarketScope): string {
  return `当前市场：${TELEGRAM_SCOPE_LABELS[scope]} · scope=${scope}`;
}

function telegramScopedCallback(prefix: string, scope: MarketScope, instrumentId: string, chatId?: string): string {
  return issueTelegramCallback(prefix, { scope, id: instrumentId, workspace: 'analysis', chatId });
}

function telegramPaperCallback(action: string, payload: string, chatId: string, scope: MarketScope = 'prediction'): string {
  return issueTelegramCallback(action, { scope, id: String(payload || ''), workspace: 'paper', chatId });
}

const TELEGRAM_CONTEXT_WORKSPACES: Record<string, string> = {
  stock: 'stock-quotes',
  option: 'option-chain',
  crypto: 'crypto-quotes',
  prediction: 'prediction-radar',
};
const TELEGRAM_CONTEXT_WORKSPACE_CODES: Record<string, string> = {
  'stock-quotes': 'sq',
  'option-chain': 'oq',
  'crypto-quotes': 'cq',
  'prediction-radar': 'pr',
  analysis: 'an',
};

function telegramWorkspaceForType(type: string): string {
  return TELEGRAM_CONTEXT_WORKSPACES[type] || 'analysis';
}

interface TelegramCallbackRecord {
  token: string;
  action: string;
  scope: MarketScope;
  id: string;
  timeframe: string;
  workspace: string;
  chatId?: string;
  expiresAt: number;
  signature: string;
}

const TELEGRAM_CALLBACK_STATE_KEY = 'telegram-callback-records';
const TELEGRAM_CALLBACK_TTL_MS = 15 * 60_000;

function telegramCallbackSignature(record: Omit<TelegramCallbackRecord, 'signature'>): string {
  const canonical = [record.action, record.scope, record.id, record.timeframe, record.workspace, record.chatId || '', record.expiresAt, record.token].join('|');
  return crypto.createHmac('sha256', config.jwtSecret).update(canonical).digest('base64url').slice(0, 12);
}

function safeTelegramCallbackSignature(left: string, right: string): boolean {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function saveTelegramCallbackRecord(record: TelegramCallbackRecord): void {
  stateStore.transaction(() => {
    const now = Date.now();
    const records = (stateStore.get<TelegramCallbackRecord[]>(TELEGRAM_CALLBACK_STATE_KEY) || [])
      .filter(item => item.expiresAt > now && item.token !== record.token)
      .slice(-499);
    stateStore.set(TELEGRAM_CALLBACK_STATE_KEY, [...records, record], 1);
  });
}

function issueTelegramCallback(action: string, input: { scope: MarketScope; id: string; timeframe?: string; workspace?: string; chatId?: string }): string {
  const token = crypto.randomBytes(6).toString('base64url');
  const unsigned: Omit<TelegramCallbackRecord, 'signature'> = {
    token,
    action,
    scope: input.scope,
    id: String(input.id || ''),
    timeframe: input.timeframe || '1h',
    workspace: input.workspace || 'analysis',
    ...(input.chatId ? { chatId: String(input.chatId) } : {}),
    expiresAt: Date.now() + TELEGRAM_CALLBACK_TTL_MS,
  };
  const record = { ...unsigned, signature: telegramCallbackSignature(unsigned) };
  saveTelegramCallbackRecord(record);
  return `${action}:${token}:${record.signature}`;
}

function consumeTelegramCallback(data: string, action: string, chatId?: string): TelegramCallbackRecord | null {
  const raw = String(data || '').slice(action.length + 1);
  const parts = raw.split(':');
  if (parts.length !== 2) return null;
  const [token, signature] = parts;
  return stateStore.transaction(() => {
    const now = Date.now();
    const records = stateStore.get<TelegramCallbackRecord[]>(TELEGRAM_CALLBACK_STATE_KEY) || [];
    const activeRecords = records.filter(item => item.expiresAt > now);
    const record = activeRecords.find(item => item.token === token) || null;
    if (!record || record.action !== action) {
      if (activeRecords.length !== records.length) stateStore.set(TELEGRAM_CALLBACK_STATE_KEY, activeRecords, 1);
      return null;
    }
    if (record.chatId && String(record.chatId) !== String(chatId || '')) {
      if (activeRecords.length !== records.length) stateStore.set(TELEGRAM_CALLBACK_STATE_KEY, activeRecords, 1);
      return null;
    }
    if (!safeTelegramCallbackSignature(record.signature, signature) || record.signature !== telegramCallbackSignature({
      token: record.token,
      action: record.action,
      scope: record.scope,
      id: record.id,
      timeframe: record.timeframe,
      workspace: record.workspace,
      ...(record.chatId ? { chatId: record.chatId } : {}),
      expiresAt: record.expiresAt,
    })) {
      if (activeRecords.length !== records.length) stateStore.set(TELEGRAM_CALLBACK_STATE_KEY, activeRecords, 1);
      return null;
    }
    stateStore.set(TELEGRAM_CALLBACK_STATE_KEY, activeRecords.filter(item => item.token !== token), 1);
    return record;
  });
}

/**
 * New quick-lookup callbacks carry the complete mobile context. Keep the
 * compact workspace code so callback_data remains below Telegram's limit.
 */
function telegramContextCallback(action: string, ref: any, workspace: string, timeframe = '1h', chatId?: string): string {
  const scope = telegramInstrumentScope(ref.type);
  return issueTelegramCallback(action, { scope, id: ref.id, timeframe, workspace, chatId });
}

function parseTelegramContextCallback(data: string, action: string, chatId?: string): { scope: MarketScope; id: string; timeframe: string; workspace: string; ref: any } | null {
  const signed = consumeTelegramCallback(data, action, chatId);
  if (signed) {
    const ref = telegramRefFromId(signed.id);
    if (!ref || telegramInstrumentScope(ref.type) !== signed.scope) return null;
    if (signed.workspace !== 'analysis' && signed.workspace !== telegramWorkspaceForType(ref.type)) return null;
    return { scope: signed.scope, id: signed.id, timeframe: signed.timeframe, workspace: signed.workspace, ref };
  }
  const raw = String(data || '').slice(action.length + 1);
  const parts = raw.split(':');
  if (![4, 6].includes(parts.length) || !MARKET_SCOPES.includes(parts[0] as MarketScope)) return null;
  if (parts.length === 6) {
    const expiresAt = Number.parseInt(parts[4], 36);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || !/^[a-z0-9]{4,8}$/i.test(parts[5])) return null;
  }
  const scope = parts[0] as MarketScope;
  const id = decodeURIComponent(parts[1] || '');
  const timeframe = decodeURIComponent(parts[2] || '');
  const workspace = Object.entries(TELEGRAM_CONTEXT_WORKSPACE_CODES).find(([, code]) => code === parts[3])?.[0];
  const ref = telegramRefFromId(id);
  if (!workspace || !/^\d+(?:m|h|d|w)$/i.test(timeframe) || !ref || telegramInstrumentScope(ref.type) !== scope) return null;
  if (workspace !== 'analysis' && workspace !== telegramWorkspaceForType(ref.type)) return null;
  return { scope, id, timeframe, workspace, ref };
}

function parseScopedTelegramCallback(data: string, prefix: string, chatId?: string): { scope: MarketScope | null; id: string } {
  const signed = consumeTelegramCallback(data, prefix, chatId);
  if (signed) return { scope: signed.scope, id: signed.id };
  const raw = String(data || '').slice(prefix.length + 1);
  const separator = raw.indexOf(':');
  if (separator > 0) {
    const maybeScope = raw.slice(0, separator) as MarketScope;
    if (MARKET_SCOPES.includes(maybeScope)) {
      return { scope: maybeScope, id: decodeURIComponent(raw.slice(separator + 1)) };
    }
    // A short-token callback with a bad signature must not be reinterpreted
    // as a legacy unscoped instrument ID.
    if (raw.split(':').length === 2) return { scope: null, id: '' };
  }
  return { scope: null, id: decodeURIComponent(raw) };
}

function parseTelegramCallbackPayload(data: string, action: string, chatId: string): string | null {
  const signed = consumeTelegramCallback(data, action, chatId);
  if (signed) {
    if (signed.workspace !== 'paper') return null;
    if (action.startsWith('paper:') && signed.scope !== 'prediction') return null;
    return signed.id;
  }
  // Paper and confirmation callbacks never accept legacy plaintext payloads.
  // Old inline keyboards must expire instead of allowing a forged market/order ID.
  return null;
}

function telegramScopeForWatchId(id: string): MarketScope | null {
  const value = String(id || '').trim().toLowerCase();
  if (!value) return null;
  if (value.startsWith('stock:') || isTelegramWatchableStockId(value)) return 'stocks';
  if (value.startsWith('option:')) return 'options';
  if (value.startsWith('crypto:')) return 'crypto';
  if (value.startsWith('prediction:') || /^\d+$/.test(value)) return 'prediction';
  return null;
}

function telegramScopedWatchIds(chatId: string, scope: MarketScope): string[] {
  const ids = [...new Set(telegramCommandCenterStore.listWatchlist(chatId))];
  if (scope === 'overview' || scope === 'watchlist') return ids;
  return ids.filter(id => telegramScopeForWatchId(id) === scope);
}

function telegramPendingReply(text: string, nonce: string, chatId: string, scope: MarketScope = 'overview'): TelegramReply {
  const confirmCallback = telegramPaperCallback('pending:confirm', nonce, chatId, scope);
  const cancelCallback = telegramPaperCallback('pending:cancel', nonce, chatId, scope);
  return {
    text,
    replyMarkup: { inline_keyboard: [[{ text: '✅ 确认 ' + nonce, callback_data: confirmCallback }, { text: '❌ 取消', callback_data: cancelCallback }]] } as any,
  };
}
function telegramReply(text: string): TelegramReply {
  return { text, replyKeyboard: 'menu' };
}

function telegramActions(scope: MarketScope = 'overview') {
  if (!lastAdvisorReport) return [];
  const scopedReport = filterAssistantReport(lastAdvisorReport, scope);
  return [
    ...scopedReport.cryptoActions,
    ...scopedReport.stockActions,
    ...scopedReport.macroActions,
    ...scopedReport.sectorActions,
    ...scopedReport.predictionPicks,
    ...scopedReport.optionActions,
  ].filter(action => scope === 'overview' || scope === 'watchlist' || scopeForAction(action) === scope);
}

function telegramAdminChatIds(): Set<string> {
  const telegramConfig = getRuntimeTelegramConfig();
  if (telegramConfig.adminChatIds.trim()) return new Set(parseChatIds(telegramConfig.adminChatIds));
  return new Set(parseChatIds(telegramConfig.allowedChatIds, telegramConfig.chatId));
}

function isTelegramAdmin(chatId: string): boolean {
  const configured = telegramAdminChatIds();
  return configured.size === 0 || configured.has(String(chatId));
}

telegramCommandCenterStore.bindOwnerWatchlist({
  isOwnerChat:chatId=>telegramAdminChatIds().has(chatId),
  normalize:id=>canonicalDigestWatchlist([/^\d+$/.test(id) ? `prediction:predictfun:${id}` : id])[0]?.instrument || null,
  list:()=>unifiedAlertStore.listWatchlist(),
  add:id=>unifiedAlertStore.addWatchlist(id),
  remove:id=>unifiedAlertStore.removeWatchlist(id),
});
for(const chatId of telegramAdminChatIds()) telegramCommandCenterStore.listWatchlist(chatId);

function localDashboardUrl(): string {
  if (config.appHost !== '0.0.0.0') return `http://localhost:${config.appPort}`;
  const interfaces = os.networkInterfaces();
  const address = Object.values(interfaces).flat().find(item => item && item.family === 'IPv4' && !item.internal)?.address;
  return `http://${address || 'localhost'}:${config.appPort}`;
}

function formatTelegramPreferences(chatId: string): string {
  const prefs = telegramCommandCenterStore.getPreferences(chatId).notifications;
  const mark = (value: boolean) => value ? '✅' : '⛔';
  const alerts = telegramCommandCenterStore.listPriceAlerts(chatId).filter(item => !item.triggered);
  const smartAlerts = telegramCommandCenterStore.listSmartAlerts(chatId).filter(item => item.enabled);
  return [
    '<b>提醒与订阅</b>',
    `${mark(prefs.signals)} 信号更新`,
    `${mark(prefs.dailyReport)} 每日报告`,
    `${mark(prefs.riskAlerts)} 风险预警`,
    `${mark(prefs.events)} 事件提醒`,
    `${mark(prefs.priceAlerts)} 价格提醒`,
    `${mark(settingsManager.get().telegramEnabled)} 全局出站通知`,
    '',
    alerts.length ? '<b>价格提醒</b>' : '暂无价格提醒。',
    ...alerts.slice(0, 8).map(item => `· ${item.id} · ${item.symbol} ${item.direction === 'ABOVE' ? '≥' : '≤'} ${item.price}`),
    ...(smartAlerts.length ? ['<b>智能提醒</b>', ...smartAlerts.slice(0, 8).map(item => `· ${item.id} · ${telegramAlertDescription(item)} · 冷却 ${item.cooldownMinutes}m`)] : []),
    '',
    formatTelegramAlertPolicy(chatId),
    '',
    '用法：/alerts signals|daily|risk|events|price|all on|off；/alerts pause 60；/alerts resume；/alerts quiet on 22:00-07:00；/alerts cooldown &lt;id&gt; 120',
  ].join('\n');
}

function telegramRadarMarkets() {
  return getCachedPredictionRadarSlice('', 240)?.markets || [];
}

function telegramFindMarket(marketId: string) {
  return telegramRadarMarkets().find(item => String(item.id) === String(marketId).replace(/^prediction:predictfun:/,''));
}

function telegramWatchLabel(marketId: string, market?: any): string {
  if (market) return String(market.titleZh || market.title || marketId);
  const normalized = String(marketId || '');
  const ref=telegramRefFromId(normalized);
  if(ref)return String(ref.symbol);
  return isTelegramWatchableStockId(normalized)
    ? normalized.replace(/^(us|hk|sh|sz|bj)/i, '').toUpperCase()
    : normalized;
}

function formatTelegramWatchlist(chatId: string, scope: MarketScope = 'watchlist'): string {
  const ids = telegramScopedWatchIds(chatId, scope);
  if (!ids.length) return `<b>⭐ ${TELEGRAM_SCOPE_LABELS[scope]}自选</b>\n当前作用域暂无自选标的。\n用法：/watch add &lt;市场ID&gt;，市场 ID 可从当前市场的 /search 结果获取。`;
  const lines = ids.map((id, index) => {
    const market = telegramFindMarket(id);
    if (!market) {
      return telegramScopeForWatchId(id)==='stocks'
        ? (index + 1) + '. 股票 ' + escapeTelegramHtml(telegramWatchLabel(id)) + ' · ' + escapeTelegramHtml(id)
        : (index + 1) + '. 市场 ' + escapeTelegramHtml(id) + ' · 当前快照未找到';
    }
    return (index + 1) + '. ' + escapeTelegramHtml(telegramWatchLabel(String(market.id), market)) + '\n   ' + escapeTelegramHtml(market.platform) + ' · YES ' + formatTelegramNumber(market.yesPrice * 100, 1) + '% · 模型 ' + formatTelegramNumber(market.modelProbability * 100, 1) + '%\n   /explain ' + escapeTelegramHtml(String(market.id));
  });
  return [`<b>⭐ ${TELEGRAM_SCOPE_LABELS[scope]}自选</b>`, telegramScopeHeader(scope), ...lines, '', '添加：/watch add &lt;市场ID&gt; · 删除：/watch remove &lt;市场ID&gt;'].join('\n');
}

function formatTelegramPortfolio(scope: MarketScope = 'overview'): string {
  const portfolio = paperEngine.getPortfolio();
  const positions = paperEngine.getOpenPositions();
  const unifiedLedger = filterUnifiedPaperLedger(unifiedPaperLedgerStore.get(), scope);
  const unifiedPerformance = scope === 'overview' ? unifiedPaperLedgerStore.performance() : calculateUnifiedPerformance(unifiedLedger);
  const unifiedPositions = unifiedLedger?.positions || [];
  const unifiedCounts = unifiedPositions.reduce((counts, position) => {
    const label = position.instrumentType === 'stock' ? '股票' : position.instrumentType === 'crypto' ? '加密货币' : '预测市场';
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const lines = [
    `<b>💼 ${TELEGRAM_SCOPE_LABELS[scope]}模拟盘账户</b>`,
    telegramScopeHeader(scope),
  ];
  if (scope === 'overview' || scope === 'prediction') lines.push(
    '权益：$' + formatTelegramNumber(portfolio.equity) + ' · 现金：$' + formatTelegramNumber(portfolio.cashBalance),
    '已实现盈亏：' + (portfolio.totalPnl >= 0 ? '+' : '') + '$' + formatTelegramNumber(portfolio.totalPnl) + ' · 未实现：' + (portfolio.unrealizedPnl >= 0 ? '+' : '') + '$' + formatTelegramNumber(portfolio.unrealizedPnl),
    '持仓：' + positions.length + ' · 胜率：' + formatTelegramNumber(portfolio.winRate * 100, 1) + '%',
    '',
    positions.length ? '<b>当前持仓</b>' : '暂无开放持仓。',
    ...positions.slice(0, 8).map(position => {
      const current = position.currentPrice ?? position.entryPrice;
      const pnl = (current - position.entryPrice) * position.quantity;
      return '· ' + escapeTelegramHtml(position.id) + ' · ' + escapeTelegramHtml(position.marketTitle) + ' · ' + escapeTelegramHtml(position.outcomeName) + ' · ' + (pnl >= 0 ? '+' : '') + '$' + formatTelegramNumber(pnl);
    }),
    '',
  );
  lines.push(
    '<b>📊 统一纸面账本</b>',
    '权益：$' + formatTelegramNumber(unifiedPerformance.equity) + ' · 现金：$' + formatTelegramNumber(unifiedPerformance.cash),
    '总盈亏：' + (unifiedPerformance.totalPnl >= 0 ? '+' : '') + '$' + formatTelegramNumber(unifiedPerformance.totalPnl) + ' · 持仓：' + unifiedPerformance.positions,
    '交易数：' + unifiedPerformance.totalTrades + ' · 胜率：' + formatTelegramNumber(unifiedPerformance.winRate * 100, 1) + '%',
    '按类型：' + (Object.entries(unifiedCounts).map(([label, count]) => `${label} ${count}`).join(' · ') || '暂无持仓'),
    '',
    scope === 'prediction' || scope === 'overview'
      ? '开仓：/paper open &lt;市场ID&gt; &lt;yes|no&gt; &lt;价格0-1&gt; &lt;金额USD&gt; · 平仓：/close &lt;持仓ID&gt; &lt;价格0-1&gt;'
      : '当前市场仅展示该作用域的统一模拟持仓；预测市场开仓命令不会在此作用域执行。',
  );
  return lines.join('\n');
}

function formatTelegramReview(): string {
  const metrics = paperEngine.getRiskMetrics();
  const closed = paperEngine.getClosedPositions();
  const durations = closed.map(item => item.exitTime ? new Date(item.exitTime).getTime() - new Date(item.entryTime).getTime() : 0).filter(value => value > 0);
  const averageHoldHours = durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length / 3600000 : 0;
  const byMarket = new Map<string, { trades: number; pnl: number }>();
  for (const position of closed) {
    const group = byMarket.get(position.marketTitle) || { trades: 0, pnl: 0 };
    group.trades += 1;
    group.pnl += position.pnlUsd || 0;
    byMarket.set(position.marketTitle, group);
  }
  return [
    '<b>📚 模拟交易复盘</b>',
    '已平仓：' + metrics.totalTrades + ' · 胜率：' + formatTelegramNumber(metrics.winRate * 100, 1) + '%',
    '总盈亏：' + (paperEngine.getPortfolio().totalPnl >= 0 ? '+' : '') + '$' + formatTelegramNumber(paperEngine.getPortfolio().totalPnl) + ' · 盈亏因子：' + formatTelegramNumber(metrics.profitFactor),
    '平均每笔：' + (metrics.expectancyUsd >= 0 ? '+' : '') + '$' + formatTelegramNumber(metrics.expectancyUsd) + ' · 盈亏比：' + formatTelegramNumber(metrics.payoffRatio),
    '最大回撤：' + formatTelegramNumber(metrics.maxDrawdownPct, 1) + '% · VaR95：$' + formatTelegramNumber(metrics.var95Usd),
    '平均持仓：' + (averageHoldHours ? formatTelegramNumber(averageHoldHours, 1) + ' 小时' : '暂无数据'),
    '',
    '<b>按市场</b>',
    ...(byMarket.size ? [...byMarket.entries()].slice(0, 6).map(([title, item]) => '· ' + escapeTelegramHtml(title) + ' · ' + item.trades + ' 笔 · ' + (item.pnl >= 0 ? '+' : '') + '$' + formatTelegramNumber(item.pnl)) : ['· 暂无已平仓记录']),
    '',
    '结果只代表本地模拟盘，不代表真实收益。',
  ].join('\n');
}

function formatTelegramAlertPolicy(chatId: string): string {
  const policy = telegramCommandCenterStore.getAlertPolicy(chatId);
  const paused = policy.pausedUntil && new Date(policy.pausedUntil).getTime() > Date.now() ? '暂停至 ' + policy.pausedUntil : '未暂停';
  const digest = policy.digest;
  return '免打扰：' + (policy.quietHours.enabled ? policy.quietHours.start + '-' + policy.quietHours.end : '关闭') + '\n摘要：' + (digest.enabled ? '每日 ' + digest.time : '关闭') + ` · 盘前 ${digest.preOpenEnabled ? digest.preOpenTime : '关闭'} · 盘后 ${digest.postCloseEnabled ? digest.postCloseTime : '关闭'}` + '\n提醒状态：' + paused;
}

function telegramAlertDescription(alert: any): string {
  if (alert.type === 'PROBABILITY') return alert.symbol + ' 概率 ' + (alert.direction === 'ABOVE' ? '≥' : '≤') + ' ' + alert.threshold + '%';
  if (alert.type === 'RISK') return '风险 ' + (alert.direction === 'ABOVE' ? '≥' : '≤') + ' ' + alert.threshold + '%';
  if (alert.type === 'EVENT') return '事件在 ' + alert.threshold + ' 小时内';
  return '信号反转';
}

async function buildTelegramDigest(chatId: string, cadenceLabel = '每日'): Promise<string> {
  const ids = telegramCommandCenterStore.listWatchlist(chatId);
  const radar = getCachedPredictionRadarSlice('', 240);
  const calendar = await getUpcomingEventCalendar(2).catch(() => null);
  const portfolio = paperEngine.getPortfolio();
  const alerts = telegramCommandCenterStore.listPriceAlerts(chatId).filter(item => !item.triggered);
  const smartAlerts = telegramCommandCenterStore.listSmartAlerts(chatId).filter(item => item.enabled);
  const sources = await getSourceHealth().catch(() => null);
  const ai = radar ? await getAiMarketCommentary(radar).catch(() => null) : null;
  const previousDigest = telegramCommandCenterStore.listAudits(chatId, 100).find(item => item.action === 'digest_sent');
  const since = previousDigest?.at || new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const marketIds: MarketId[] = ['stocks', 'options', 'crypto', 'prediction'];
  const marketNames: Record<MarketId, string> = { stocks: '股票', options: '期权', crypto: '虚拟币', prediction: '预测市场' };
  const sharedChanges = await buildSharedMarketChangeDigest(ids, since);
  const actionSummary = buildActionCenter(await collectWatchlistActions(ids,sharedChanges),{ states:actionCenterStore.states('admin') });
  const pendingActions = actionSummary.items.filter(row => !row.read && !row.snoozed);
  const evidenceSummary = marketIds.map(market => {
    const changes = sharedChanges.filter(item => item.market === market);
    if (!changes.length) return `<b>${marketNames[market]}</b> · 自上次摘要后暂无自选变化`;
    const rows = changes.slice(0, 4).map(item => {
      const workspace = item.kind === '13f-change' ? 'guru-holdings' : item.kind === 'news' || item.kind === 'event' ? 'events' : item.kind === 'signal' ? 'decision-intelligence' : market === 'stocks' ? 'stock-quotes' : `${market}-market`;
      const href = buildTelegramDeepLink(telegramPublicBaseUrl(), { market, instrument: item.instrument || '', timeframe: '1d', workspace });
      const title = `${item.title}${item.summary ? ` · ${item.summary}` : ''}`;
      const linked = href ? `<a href="${escapeTelegramHtml(href)}">${escapeTelegramHtml(title)}</a>` : escapeTelegramHtml(title);
      const sourceUrl = telegramSafeExternalUrl(item.sourceUrl);
      const original = sourceUrl ? ` <a href="${escapeTelegramHtml(sourceUrl)}">${escapeTelegramHtml(item.source || '来源')}</a>` : item.source ? ` · ${escapeTelegramHtml(item.source)}` : '';
      return `· ${linked}${original} · ${escapeTelegramHtml(item.observedAt.slice(0, 16))}`;
    });
    return `<b>${marketNames[market]}</b> · ${changes.length} 项变化\n${rows.join('\n')}`;
  });
  const watchItems = ids.slice(0, 12).map(id => {
    let ref = telegramRefFromId(id);
    if (!ref && isTelegramWatchableStockId(id)) {
      const match = id.match(/^(us|hk|sh|sz|bj)(.+)$/i)!;
      const venue = ({ us: 'us', hk: 'hk', sh: 'sh', sz: 'sz', bj: 'bj' } as Record<string, string>)[match[1].toLowerCase()];
      ref = normalizeInstrumentRef({ type: 'stock', venue, symbol: /^(sh|sz|bj)$/i.test(match[1]) ? `${match[1]}${match[2]}` : match[2], title: id, aliases: [] });
    }
    const scope: MarketId | null = ref ? (ref.type === 'stock' ? 'stocks' : ref.type === 'option' ? 'options' : ref.type === 'crypto' ? 'crypto' : 'prediction') : telegramFindMarket(id) ? 'prediction' : null;
    return { id, ref, scope };
  });
  const watchLines: string[] = watchItems.filter(item => !item.scope).map(item => `· ${escapeTelegramHtml(item.id)} · 未识别自选，未归入任何市场`);
  for (const market of marketIds) {
    const items = watchItems.filter(item => item.scope === market).slice(0, 4);
    if (!items.length) { watchLines.push(`<b>${marketNames[market]}</b> · 暂无自选`); continue; }
    watchLines.push(`<b>${marketNames[market]}</b>`);
    const checked = await Promise.all(items.map(async item => {
      const prediction = telegramFindMarket(item.id) || (item.ref?.type === 'prediction' ? telegramFindMarket(item.ref.symbol) : undefined);
      let price: number | null = null;
      let change: number | null = null;
      let source = '';
      let capturedAt = '';
      let reason = '';
      let label = telegramWatchLabel(item.id, prediction);
      if (prediction) {
        price = Number(prediction.yesPrice) * 100;
        change = null;
        source = String(prediction.platform || '预测市场来源');
        capturedAt = String(radar?.updatedAt || '');
        label = String(prediction.titleZh || prediction.title || item.id);
      } else if (item.ref) {
        try {
          const overview = await unifiedInstrumentService.overview(item.ref);
          const quote: any = overview.quote || overview.marketData || {};
          const priceValue = quote.price ?? quote.yesPrice;
          price = Number.isFinite(Number(priceValue)) ? Number(priceValue) : null;
          change = Number.isFinite(Number(quote.changePct)) ? Number(quote.changePct) : null;
          source = market === 'stocks' ? '股票行情聚合源' : market === 'crypto' ? 'Binance 公共行情' : market === 'options' ? String((overview.marketData as any)?.source || 'CBOE 延迟期权') : '预测市场来源';
          capturedAt = overview.freshness.fetchedAt || '';
          reason = overview.status.reason || '';
          label = item.ref.title || item.ref.symbol;
        } catch (error: any) { reason = error?.message || '来源不可用'; }
      } else {
        reason = '标的 ID 无法识别，未跨市场猜测';
      }
      const deepMarket = market;
      const href = buildTelegramDeepLink(telegramPublicBaseUrl(), { market: deepMarket, instrument: item.ref?.id || item.id, timeframe: '1d', workspace: deepMarket === 'stocks' ? 'stock-quotes' : `${deepMarket}-market` });
      const dataText = price == null ? escapeTelegramHtml(reason || '暂无数据') : `${market === 'prediction' ? 'YES ' : ''}${formatTelegramNumber(price, market === 'prediction' ? 1 : 2)}${market === 'prediction' ? '%' : ''}${change == null ? '' : ` · ${change >= 0 ? '+' : ''}${formatTelegramNumber(change, 2)}%`}`;
      return `· ${href ? `<a href="${escapeTelegramHtml(href)}">${escapeTelegramHtml(label)}</a>` : escapeTelegramHtml(label)} · ${dataText}${source ? ` · ${escapeTelegramHtml(source)}` : ''}${capturedAt ? ` · ${escapeTelegramHtml(capturedAt.slice(0, 16))}` : ''}`;
    }));
    watchLines.push(...checked);
  }
  const digestScope = telegramScopeForChat(chatId);
  const decisionMarketScope = MARKET_IDS.includes(digestScope as MarketId) ? digestScope as MarketId : null;
  const decisionSummary = decisionMarketScope ? buildDecisionMobileSummary({
    market: decisionMarketScope,
    evidence: decisionIntelligenceStore.listEvidence(decisionMarketScope),
    openDecisions: decisionIntelligenceStore.listDecisions(decisionMarketScope).filter(item => item.status === 'open').length,
    signalQuality: analyzeSignalQuality(decisionIntelligenceStore.listSignalOutcomes(decisionMarketScope), { minimumSamples: 30 }),
    outages: researchRepository.listSourceHealthEvents(decisionMarketScope, 50).filter((item: any) => item.kind === 'outage').length,
    deepLink: buildTelegramDeepLink(telegramPublicBaseUrl(), { market: decisionMarketScope, instrument: '', workspace: 'decision-intelligence' })?.replace(/&/g, '&amp;'),
  }) : null;
  const lines = [
    `<b>🗓 MoneyMoney ${escapeTelegramHtml(cadenceLabel)}摘要</b>`,
    '生成时间：' + new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) + '（上海时间）',
    '',
    '<b>⭐ 自选简报（按市场分组）</b>',
    ...(ids.length ? watchLines : ['· 暂无自选标的']),
    '',
    '<b>📌 自选行动</b>',
    `待处理 ${pendingActions.length} 项 · 未来七天 ${actionSummary.counts.upcoming} 项`,
    ...pendingActions.slice(0,5).map(row => `· ${escapeTelegramHtml(row.title)} · ${escapeTelegramHtml(row.source)} · ${escapeTelegramHtml(row.dataStatus)}`),
    '查看与处理：/actioncenter',
    '',
    '<b>🧾 自上次摘要以来</b>',
    ...evidenceSummary,
    '',
    '<b>💼 模拟盘</b>',
    '权益 $' + formatTelegramNumber(portfolio.equity) + ' · 总盈亏 ' + (portfolio.totalPnl >= 0 ? '+' : '') + '$' + formatTelegramNumber(portfolio.totalPnl) + ' · 持仓 ' + paperEngine.getOpenPositions().length,
    '',
    '<b>🔔 活跃提醒</b>',
    ...(alerts.length || smartAlerts.length ? [...alerts.slice(0, 4).map(item => item.symbol + ' ' + (item.direction === 'ABOVE' ? '≥' : '≤') + ' ' + item.price), ...smartAlerts.slice(0, 4).map(item => telegramAlertDescription(item))] : ['· 暂无活跃提醒']),
    '',
    '<b>📅 近期事件</b>',
    ...(calendar?.events?.length ? calendar.events.slice(0, 4).map(event => formatEventLineZh(event)) : ['· 暂无事件或日历暂不可用']),
    '',
    '数据源：' + (sources ? sources.online + '/' + sources.total + ' 在线' : '检查失败') + ' · 雷达：' + (radar ? '有快照' : '暂无快照'),
    lastAdvisorReport ? '助手状态：' + escapeTelegramHtml(lastAdvisorReport.regime.labelZh) : '助手状态：暂无最新报告',
    '',
    '<b>🤖 AI 简要总结</b>',
    ai?.analysis ? escapeTelegramHtml(ai.analysis.slice(0, 700)) : 'AI 点评暂不可用或未配置。',
    ...(decisionSummary ? ['', decisionSummary] : []),
  ];
  return lines.join('\n');
}

async function stockSignalsForChat(chatId: string, args: string[], automatic = false): Promise<string> {
  const scope=telegramScopeForChat(chatId),isAdmin=isTelegramAdmin(chatId);
  const text=await handleTelegramStockSignalsCommand({
    chatId,scope,args,isAdmin,schedule:stockSignalSchedule,
    telegramWatchlistIds:telegramCommandCenterStore.listWatchlist(chatId),
    administratorWatchlistIds:isAdmin ? unifiedAlertStore.listWatchlist() : [],
    scanner:telegramStockSignalScanner,
    analyze:async candidate=>{
      if(automatic && !stockExchangeSession(candidate.market==='us' ? 'us':candidate.market==='hk' ? 'hk':'cn',Date.now()).open) return {candidate,status:'unavailable',dataStatus:'unavailable',action:null,source:'交易所常规时段校验',updatedAt:null,reason:'该交易所当前不在常规时段，自动扫描未请求行情'};
      return analyzeStockSignalCandidate(candidate, automatic ? { maxQuoteAgeMs: 30 * 60000 } : {});
    },
    discoverMovers:async()=>{
      const breadth=await getMarketBreadthSnapshot(),updatedAt=String(breadth.generatedAt || ''),generatedAt=Date.parse(updatedAt);
      if(!Number.isFinite(generatedAt) || generatedAt>Date.now()+300000) return {movers:[],status:'unavailable',source:breadth.source || 'Nasdaq Public Screener',updatedAt:null,reason:'异动来源更新时间无效'};
      const movers=[...(breadth.gainers || []),...(breadth.losers || [])].map(row=>({symbol:row.symbol,name:row.name,changePct:row.changePct,volume:row.volume,marketCapUsd:row.marketCapUsd}));
      const age=Date.now()-generatedAt,freshness=age>7200000 ? 'stale' : age>300000 ? 'cached':'live';
      return {movers,status:movers.length ? freshness:'empty',source:breadth.source || 'Nasdaq Public Screener',updatedAt,...(freshness==='stale' ? {reason:'异动数据超过两小时，结果可能过期'} : {})};
    },
  });
  // Recording runs after completion; it never creates an order or guesses an old pairing.
  void telegramStockSignalScanner.wait(chatId).then(snapshot=>{
    if(!isAdmin || !snapshot)return;
    for(const row of selectTelegramStockSignalAlerts(snapshot)) {
      const entry=Number(row.action?.entry),triggeredAt=Date.parse(snapshot.createdAt),id=`stock-scan:${snapshot.id}:${row.candidate.instrumentId}`;
      if(!Number.isFinite(entry) || entry<=0 || !row.updatedAt || decisionIntelligenceStore.getSignalOutcome(id))continue;
      const evidence=createEvidenceSnapshot({market:'stocks',workspace:'signals',instrument:row.candidate.instrumentId,dataStatus:row.dataStatus==='cached' ? 'cached':row.dataStatus==='live' ? 'live':'delayed',source:{id:'stock-signal-scan',name:row.source},observedAt:row.updatedAt,fetchedAt:snapshot.updatedAt,fields:{entry,action:row.action?.action,reasons:row.action?.reasons,metrics:row.action?.metrics,scanId:snapshot.id,pools:row.candidate.sources}});
      decisionIntelligenceStore.saveEvidence(evidence);
      decisionIntelligenceStore.saveSignalOutcome({id,market:'stocks',instrument:row.candidate.instrumentId,strategyId:'stock-technical-scan',strategyVersion:'technical-v1',timeframe:'1d',source:row.source,triggeredAt,entryPrice:entry,sample:'live',status:'generated',statusReason:'扫描生成；前向观察是标的走势，不代表模拟成交或做空',evidenceRefs:[evidence.id]});
    }
  }).catch(error=>telegramCommandCenterStore.recordAudit(chatId,'stock_signal_lineage_error',String(error instanceof Error ? error.message:'信号血缘保存失败').slice(0,160)));
  return text;
}

export function getTelegramCommandHandlers(): Record<string, TelegramCommandHandler> {
  const rawHandlers: Record<string, TelegramCommandHandler> = {
    stocks: async ({ chatId }) => {
      const scope = telegramScopeForChat(chatId);
      if (scope !== 'stocks') return `当前为${TELEGRAM_SCOPE_LABELS[scope]}市场，请先点击“📈 股票”切换。`;
      try {
        const snapshot = await getMarketBreadthSnapshot();
        return [`<b>📈 股票工作区</b>`, telegramScopeHeader(scope), `市场宽度：${escapeTelegramHtml(snapshot.summaryZh || snapshot.advisorBiasZh || '暂无摘要')}`, `上涨 ${snapshot.gainers?.length || 0} · 下跌 ${snapshot.losers?.length || 0}`, '', '可继续使用：/search 搜索股票 · /watchlist 查看股票自选 · /portfolio 查看股票模拟持仓。'].join('\n');
      } catch (error) {
        return `<b>📈 股票工作区</b>\n${telegramScopeHeader(scope)}\n股票宽度数据暂不可用：${escapeTelegramHtml(error instanceof Error ? error.message : '未知错误')}`;
      }
    },
    options: async ({ chatId, args }) => {
      const scope = telegramScopeForChat(chatId);
      if (scope !== 'options') return `当前为${TELEGRAM_SCOPE_LABELS[scope]}市场，请先点击“🎯 期权”切换。`;
      const symbol = String(args[0] || 'AAPL').toUpperCase();
      const snapshot = await getEquityOptionsSnapshot(symbol).catch(() => null);
      return snapshot
        ? [`<b>🎯 期权工作区</b>`, telegramScopeHeader(scope), `${snapshot.asset} 现价：${formatTelegramNumber(snapshot.spot, 2)}`, `Call/Put 未平仓比：${snapshot.totalPutCallOIRatio == null ? '暂无' : formatTelegramNumber(snapshot.totalPutCallOIRatio, 2)}`, `到期日：${snapshot.expiries.length} 个`, '', '搜索：/search &lt;股票代码&gt; · 自选：/watchlist'].join('\n')
        : `<b>🎯 期权工作区</b>\n${telegramScopeHeader(scope)}\n${escapeTelegramHtml(symbol)} 的期权数据暂不可用。`;
    },
    binance: async ({ chatId }) => {
      const scope = telegramScopeForChat(chatId);
      if (scope !== 'crypto') return `当前为${TELEGRAM_SCOPE_LABELS[scope]}市场，请先点击“₿ 虚拟币”切换。`;
      const prices = await binanceFeed.getMultiplePrices(['BTCUSDT', 'ETHUSDT']).catch(() => ({}));
      const rows = Object.values(prices).map(item => `· ${item.symbol}：$${formatTelegramNumber(item.price, item.price >= 100 ? 2 : 4)}`);
      return [`<b>₿ 虚拟币工作区</b>`, telegramScopeHeader(scope), ...(rows.length ? rows : ['· 币安行情暂不可用']), '', '搜索：/search &lt;币种&gt; · 自选：/watchlist · 模拟持仓：/portfolio'].join('\n');
    },
    radar: ({ chatId }) => {
      const scope = telegramScopeForChat(chatId);
      if (scope !== 'prediction') return `当前为${TELEGRAM_SCOPE_LABELS[scope]}市场，请先点击“🎯 预测市场”切换。`;
      const markets = getCachedPredictionRadarSlice('', 240)?.markets || [];
      return [`<b>🌐 预测市场雷达</b>`, telegramScopeHeader(scope), `当前快照：${markets.length} 个市场`, ...markets.slice(0, 5).map((item, index) => `${index + 1}. ${escapeTelegramHtml(item.titleZh || item.title)} · YES ${formatTelegramNumber(item.yesPrice * 100, 1)}%`), '', '搜索：/search &lt;关键词&gt; · 自选：/watchlist'].join('\n');
    },
    macro: async ({ chatId }) => {
      const scope = telegramScopeForChat(chatId);
      const snapshot = await getGlobalMacroSpotSnapshot().catch(() => null);
      return [`<b>🌍 宏观（通用工具）</b>`, telegramScopeHeader(scope), snapshot ? `宏观数据已更新：${escapeTelegramHtml(String((snapshot as any).fetchedAt || (snapshot as any).updatedAt || '当前'))}` : '宏观数据暂不可用。', '宏观属于通用工具，不改变当前市场作用域。'].join('\n');
    },
    news: async ({ chatId }) => {
      const calendar = await getUpcomingEventCalendar(7).catch(() => null);
      const events = calendar?.events?.slice(0, 5) || [];
      const text = [`<b>📰 ${TELEGRAM_SCOPE_LABELS[telegramScopeForChat(chatId)]}新闻/事件</b>`, telegramScopeHeader(telegramScopeForChat(chatId)), ...(events.length ? events.map(event => `· ${escapeTelegramHtml(String(event.date || '').slice(0, 10))} ${escapeTelegramHtml(event.titleZh || event.title)}${event.source ? ` · ${escapeTelegramHtml(event.source)}` : ''}`) : ['· 暂无事件；新闻日历暂不可用或当前时间范围没有结果。'])].join('\n');
      const sourceButtons = events.map((event, index) => {
        const url = telegramSafeExternalUrl((event as any).url || (event as any).link || (event as any).sourceUrl);
        return url ? [{ text: `原文 ${String(event.source || index + 1).slice(0, 12)}`, url }] : [];
      }).filter(row => row.length).slice(0, 6);
      return sourceButtons.length ? telegramInlineReply(text, sourceButtons) : text;
    },
    market: ({ chatId, args }) => {
      const requested = String(args[0] || '').trim().toLowerCase() as MarketScope;
      const scope = MARKET_SCOPES.includes(requested) ? requested : 'overview';
      telegramCommandCenterStore.updateSession(chatId, {
        marketScope: scope,
        workspace: scope === 'stocks' ? 'stock-quotes' : scope === 'options' ? 'option-chain' : scope === 'crypto' ? 'crypto-quotes' : scope === 'prediction' ? 'prediction-radar' : 'analysis',
        instrumentId: undefined,
        timeframe: '1h',
        menuPage: 1,
      });
      resetTelegramMenuPage(chatId);
      return telegramReply(`✅ 已切换到${TELEGRAM_SCOPE_LABELS[scope]}市场。\n${telegramScopeHeader(scope)}\n当前菜单、搜索、雷达、分析、风险、自选和模拟持仓均按此市场隔离。`);
    },
    menu_prev: ({ chatId }) => {
      moveTelegramMenuPage(chatId, -1);
      return telegramReply('已切换到上一页菜单。');
    },
    menu_next: ({ chatId }) => {
      moveTelegramMenuPage(chatId, 1);
      return telegramReply('已切换到下一页菜单。');
    },
    menu_page: () => telegramReply('当前菜单页。'),
    start: ({ chatId }) => telegramMarketSelectorReply(chatId),
    actioncenter: async ({ chatId, args }) => {
      const scope = telegramScopeForChat(chatId);
      const key = `action-center:telegram:${chatId}`;
      if (['read','pin','later'].includes(String(args[0]))) {
        const saved = stateStore.get<{ at:string; scope:string; items:ActionCenterItem[] }>(key);
        const index = Number(args[1]);
        if (!saved || saved.scope !== scope || Date.now() - Date.parse(saved.at) > 15 * 60_000 || !Number.isInteger(index) || index < 1 || !saved.items[index - 1]) return '条目已过期或市场已切换，请先发送 /actioncenter 刷新。';
        const item = saved.items[index-1];
        const state = actionCenterStore.update('admin',item,args[0] === 'read' ? { read:true } : args[0] === 'pin' ? { pinned:true } : { snoozedUntil:new Date(Date.now()+86400_000).toISOString() });
        return `✅ 已同步网页处理状态：${escapeTelegramHtml(item.title)}\n${state.read ? '已读' : ''}${state.pinned ? ' · 置顶' : ''}${state.snoozedUntil ? ' · 稍后处理' : ''}`;
      }
      const items = await collectWatchlistActions(telegramScopedWatchIds(chatId,scope));
      const result = buildActionCenter(items,{ market:MARKET_IDS.includes(scope as MarketId) ? scope as MarketId : undefined,states:actionCenterStore.states('admin') });
      const shown = result.items.filter(row => !row.read && !row.snoozed).slice(0,8);
      stateStore.set(key,{ at:new Date().toISOString(),scope,items:shown });
      const lines = shown.map((row,index) => {
        const href = buildTelegramDeepLink(telegramPublicBaseUrl(),{ market:row.market,instrument:row.instrument || '',workspace:'action-center' });
        const chart = row.market==='stocks' && row.instrument ? buildTelegramDeepLink(telegramPublicBaseUrl(),{market:row.market,instrument:row.instrument,workspace:'stock-quotes',timeframe:'1d',focusDate:(row.occurredAt || row.publishedAt || '').slice(0,10)}):null;
        const status=({live:'实时',delayed:'延迟',cached:'缓存',partial:'部分成功',empty:'来源成功但无记录',unavailable:'来源不可用',failed:'请求失败',unsupported:'不支持',historical:'历史数据'} as Record<string,string>)[row.dataStatus] || row.dataStatus;
        return `${index+1}. ${escapeTelegramHtml(row.title)} · ${escapeTelegramHtml(status)}\n${escapeTelegramHtml(row.source)} · ${escapeTelegramHtml(row.observedAt)}${row.reason ? '\n原因：'+escapeTelegramHtml(row.reason):''}${href ? `\n<a href="${escapeTelegramHtml(href)}">网页与证据</a>` : ''}${chart ? ` · <a href="${escapeTelegramHtml(chart)}">对应日期图表</a>`:''}`;
      });
      const text = ['<b>自选行动中心</b>',...lines,shown.length ? '下方按钮与网页共享状态，15分钟内有效。' : '当前没有待处理条目；来源无记录与来源故障分别展示。'].join('\n');
      const buttons = shown.map((row,index) => ['read','pin','later'].map((action,i) => ({text:`${index+1} ${['已读','置顶','明天处理'][i]}`,callback_data:issueTelegramCallback('action:handle',{scope,id:JSON.stringify([action,row.id]),workspace:'action-center',chatId})})));
      return buttons.length ? telegramInlineReply(text,buttons) : text;
    },
    session: ({ chatId, args }) => {
      if (String(args[0] || '').toLowerCase() === 'reset') {
        telegramCommandCenterStore.resetSession(chatId);
        resetTelegramMenuPage(chatId);
        telegramCommandCenterStore.recordAudit(chatId, 'session_reset', 'manual');
        return telegramReply('✅ 已清空当前私聊的市场、标的、周期和菜单上下文。发送 /start 重新选择市场。');
      }
      const session = telegramCommandCenterStore.getSession(chatId);
      return telegramReply(`<b>当前 Telegram 会话</b>\n市场：${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[session.marketScope])}\n工作区：${escapeTelegramHtml(session.workspace)}\n标的：${escapeTelegramHtml(session.instrumentId || '未选择')}\n周期：${escapeTelegramHtml(session.timeframe)}\n菜单页：${session.menuPage}/3\n\n清空：/session reset`);
    },
    help: () => TELEGRAM_HELP + '\n新增：/eventresults 结果投递记录 · /trackresult task|funding|prediction 跟踪实际结果 · /actioncenter 自选行动 · /contracts 永续/交割合约 · /chart <代码> 聊天K线图片',
    trackresult: async ({chatId,args})=>{
      const disabledReason=resultTrackingDisabledReason(telegramCommandCenterStore.getPreferences(chatId).notifications.events);
      if(disabledReason)return disabledReason;
      const scope=telegramScopeForChat(chatId);let event:TelegramTrackedResult;
      try{
        if(args[0]==='task'){
          const job=researchRepository.getJob(String(args[1]||''));if(!job||job.market!==scope)return '任务不存在或不属于当前市场；请先选择对应市场。';
          event={kind:'research',market:job.market,resourceId:job.id,title:'研究任务 '+job.id,date:job.createdAt};
        }else if(args[0]==='funding'){
          if(scope!=='crypto')return '资金结算只属于虚拟币市场，请先 /market crypto。';
          const instrument=String(args[1]||''),identity=contractIdentity(instrument);if(identity.kind!=='perpetual')return '交割合约不支持永续资金结算。';
          const detail=await contractResearchService.detail(instrument,[]);if(!detail.quote.nextFundingAt)return '来源未提供下一次资金结算时间，不能猜测倒计时。';
          event={kind:'funding',market:'crypto',instrument,title:identity.contract+' 实际资金结算',date:detail.quote.nextFundingAt};
        }else if(args[0]==='prediction'){
          if(scope!=='prediction')return '预测结算只属于预测市场，请先 /market prediction。';
          const platform=String(args[1]||'');if(platform!=='Kalshi'&&platform!=='Polymarket')return '仅支持已有官方证据适配的 Kalshi / Polymarket。';
          const evidence=await refreshPredictionSettlement(platform,String(args[2]||'')),date=evidence.closeAt||evidence.determinationAt||evidence.settlementAt;
          if(!date)return '官方未提供明确截止或裁定时间，不能猜测倒计时。';
          event={kind:'prediction',market:'prediction',instrument:evidence.instrument,resourceId:evidence.marketId,platform,title:evidence.marketId+' 官方结算',date};
        }else return '用法：/trackresult task <任务ID> · /trackresult funding <crypto:gateio:BTC_USDT> · /trackresult prediction <Kalshi|Polymarket> <市场ID>。';
        if(!telegramInteractionBot)return 'Telegram 暂不可用，未启动结果追踪。';
        const messageId=await telegramInteractionBot.sendToChat(chatId,telegramReply('<b>已请求跟踪实际结果</b>\n'+escapeTelegramHtml(event.title)+'\n时间：'+escapeTelegramHtml(event.date)+'\n结果将回复此消息；来源不可用或超出72小时将明确说明，不使用预期或概率代替。'));
        if(typeof messageId!=='number')return '消息已发送但未取得可核验消息ID，未启动追踪；请稍后重试。';
        telegramEventResults.registerReminder(chatId,event,messageId);return undefined;
      }catch(error:any){return '结果追踪未启动：'+escapeTelegramHtml(error.message);}
    },
    contracts: async ({ args, chatId }) => {
      if (telegramScopeForChat(chatId) !== 'crypto') return '当前市场不支持合约查询，请先 /market crypto。';
      const instrument = String(args[0] || '');
      if (!instrument.startsWith('crypto:')) {
        const kind = instrument === 'delivery' ? 'delivery' : 'perpetual';
        const catalog = await contractResearchService.catalog(kind,String(args[1] || 'BTC'));
        return [`<b>${kind==='delivery' ? '交割':'永续'}合约</b> · ${escapeTelegramHtml(catalog.dataStatus)}`,escapeTelegramHtml(catalog.source),escapeTelegramHtml(catalog.reason || ''),...catalog.items.slice(0,8).map((item:{instrument:string})=>'/contracts '+escapeTelegramHtml(item.instrument)),'按规范身份查询；不会用现货价格补位，不会下单。'].filter(Boolean).join('\n');
      }
      try {
        contractIdentity(instrument);
        const result = await contractResearchService.detail(instrument);
        const q = result.quote;
        return [`<b>合约研究</b> · ${escapeTelegramHtml(instrument)}`,`${escapeTelegramHtml(result.source)} · ${escapeTelegramHtml(result.dataStatus)} · ${escapeTelegramHtml(result.updatedAt)}`,`标记：${q.markPrice ?? '暂无'} · 指数：${q.indexPrice ?? '暂无'} · 基差：${q.basisPct?.toFixed(3) ?? '暂无'}%`,`OI：${q.openInterestUsd ?? '暂无'} USD · 买/卖深度：${result.depth.bids.length}/${result.depth.asks.length}`,result.kind==='delivery' ? '到期：'+(q.expiresAt || '来源未提供') : `资金费率：${q.fundingRatePct ?? '暂无'}% · 下次结算：${q.nextFundingAt || '未知'}`,result.reason ? '原因：'+escapeTelegramHtml(result.reason):'', '仅研究，真实交易关闭。'].filter(Boolean).join('\n');
      } catch { return '合约身份无效或来源不可用；现货、永续和交割合约不能混用。'; }
    },
    guru: async ({ args, chatId }) => {
      if (telegramScopeForChat(chatId)!=='stocks') return '大神持仓仅属于股票市场，请先 /market stocks。';
      const query=String(args[0] || '');
      if (!query) return '用法：/guru AAPL；展示 SEC 已披露持仓，可加入自选并在每日摘要跟踪13F变化。';
      const candidates=await telegramQuickCandidates(query,'stocks');
      if(candidates.length!==1)return candidates.length ? telegramQuickCandidateReply(query,candidates,chatId):'未找到当前股票标的。';
      const ref=candidates[0], snapshot=await guruHoldings.getGuruStockHolders(ref.symbol);
      const rows=snapshot.holders.slice(0,6).map(row=>`${escapeTelegramHtml(row.manager.filerName || row.manager.filingName)} · 报告期 ${escapeTelegramHtml(row.reportPeriod)} · 申报 ${escapeTelegramHtml(row.filedAt)}\n股数：${row.shares ?? '未知'} · 变化：${escapeTelegramHtml(row.change)} ${row.shareDelta ?? '不可比'} · 权重：${row.portfolioWeightPct ?? '未知'}%${telegramSafeExternalUrl(row.sourceUrl) ? '\n<a href="'+escapeTelegramHtml(row.sourceUrl)+'">SEC 原文</a>':''}`);
      const text=[`<b>大神持仓 · ${escapeTelegramHtml(ref.symbol)}</b>`,escapeTelegramHtml(snapshot.source)+' · '+escapeTelegramHtml(snapshot.dataStatus),snapshot.reason ? escapeTelegramHtml(snapshot.reason):'',...rows, '13F 季度滞后，并非实时仓位；不汇总成市场总持仓。'].filter(Boolean).join('\n\n');
      return telegramInlineReply(text,[[{text:'加入自选 / 摘要跟踪13F变化',callback_data:telegramContextCallback('quick:watch',ref,'stock-quotes','1d',chatId)}]]);
    },
    detail: async ({ args }) => {
      const id = String(args[0] || '').trim();
      const [type, venue, ...symbolParts] = id.split(':');
      if (!id || !['stock', 'option', 'crypto', 'prediction'].includes(type) || !venue || !symbolParts.join(':').trim()) {
        return '用法：/detail <InstrumentRef>\n支持 stock:us:AAPL、option:cboe:SPY、crypto:binance:BTCUSDT、prediction:predictfun:<marketId>';
      }
      const detailInfo = await unifiedInstrumentService.overview({ id, type: type as any, venue, symbol: symbolParts.join(':'), title: '', aliases: [] }).catch(() => null);
      if (!detailInfo) return '标的详情暂不可用';
      const q = detailInfo.quote || detailInfo.marketData || {};
      const scope = telegramInstrumentScope(detailInfo.instrument.type);
      const link = telegramQuickDeepLink(detailInfo.instrument, detailInfo.instrument.type === 'crypto' ? 'crypto-quotes' : detailInfo.instrument.type === 'prediction' ? 'prediction-radar' : detailInfo.instrument.type === 'option' ? 'option-chain' : 'stock-quotes');
      const text = `<b>标的详情</b>\n${escapeTelegramHtml(detailInfo.instrument.title)}\n${escapeTelegramHtml(detailInfo.instrument.id)}\n市场：${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[scope])}\n价格/概率：${escapeTelegramHtml(String((q as any).price ?? (q as any).yesPrice ?? '暂无'))}\nAI：${escapeTelegramHtml(detailInfo.analysis.text.slice(0, 500))}`;
      return link ? telegramInlineReply(text, [[{ text: '📈 打开网页详情/K线', url: link }]]) : text;
    },
    timeline: async ({ args, chatId }) => {
      const id = String(args[0] || '').trim();
      const [type, venue, ...symbolParts] = id.split(':');
      if (!id || !['stock', 'option', 'crypto', 'prediction'].includes(type) || !venue || !symbolParts.join(':').trim()) {
        return '用法：/timeline <InstrumentRef>\n支持 stock:us:AAPL、option:cboe:SPY、crypto:binance:BTCUSDT、prediction:predictfun:<marketId>';
      }
      const scope = telegramInstrumentScope(type as any);
      if (!['overview', scope].includes(telegramScopeForChat(chatId))) return '该标的不属于当前市场，请先 /market 切换市场。';
      const data = await unifiedInstrumentService.timeline({ id, type: type as any, venue, symbol: symbolParts.join(':'), title: '', aliases: [] }).catch(() => null);
      if (!data) return '时间线数据暂不可用';
      const items = data.items.slice(0, 10);
      if (items.length === 0) return `<b>时间线</b>\n${escapeTelegramHtml(data.instrument.title)}\n${escapeTelegramHtml(data.instrument.id)}\n来源状态：${escapeTelegramHtml(JSON.stringify(data.sourceStatus))}\n${escapeTelegramHtml(Object.values(data.sectionReasons || {}).filter(Boolean).join('；') || '来源已响应，当前标的没有匹配事件。')}`;

      const lines = items.map(item => {
        const time = (String(item.at || '')).slice(0, 10);
        const title = String(item.title || '');
        const source = String(item.source || item.kind || '');
        return `· ${escapeTelegramHtml(time)} · [${escapeTelegramHtml(source)}] ${escapeTelegramHtml(title)}`;
      });
      const text = `<b>时间线</b>\n${escapeTelegramHtml(data.instrument.title)}\n${escapeTelegramHtml(data.instrument.id)}\n\n${lines.join('\n')}`;
      const sourceButtons = items.map((item, index) => {
        const url = telegramSafeExternalUrl(item.url);
        return url ? [{ text: `原文 ${String(item.source || item.kind || index + 1).slice(0, 12)}`, url }] : [];
      }).filter(row => row.length).slice(0, 6);
      return sourceButtons.length ? telegramInlineReply(text, sourceButtons) : text;
    },
    tasks: ({ chatId, args }) => {
      const scope = telegramScopeForChat(chatId);
      const market = scope === 'overview' || scope === 'watchlist' ? undefined : scope === 'stocks' ? 'stocks' : scope === 'options' ? 'options' : scope === 'crypto' ? 'crypto' : 'prediction';
      const action = String(args[0] || '').toLowerCase();
      const actionJobId = ['cancel', 'resume', 'events', 'artifact', 'artifacts'].includes(action) ? String(args[1] || '') : '';
      const jobId = actionJobId || String(args[0] || '');
      if (jobId) {
        const job = researchRepository.getJob(jobId);
        if (!job) return `未找到任务 ${escapeTelegramHtml(jobId)}。发送 /tasks 查看当前作用域任务。`;
        if (market && job.market !== market) return `该任务属于${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[job.market as MarketScope] || job.market)}市场，当前为${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[scope])}，已拒绝跨市场操作。`;
        if (action === 'cancel') {
          if (['succeeded', 'failed', 'cancelled'].includes(job.status)) return `任务已结束：${escapeTelegramHtml(job.status)}。`;
          if (job.status === 'cancelling') return `任务已经在取消中：<code>${escapeTelegramHtml(job.id)}</code>。`;
          try {
            researchRepository.updateJobStatus(job.id, job.status === 'queued' || job.status === 'paused' ? 'cancelled' : 'cancelling');
            const updated = researchRepository.getJob(job.id);
            return `✅ 已请求取消任务 <code>${escapeTelegramHtml(job.id)}</code>，当前状态：${escapeTelegramHtml(updated?.status || 'unknown')}。`;
          } catch (error: any) {
            return `任务取消失败：${escapeTelegramHtml(error?.message || '状态转换失败')}`;
          }
        }
        if (action === 'resume') {
          if (job.status === 'running') return `任务正在运行：<code>${escapeTelegramHtml(job.id)}</code> · ${formatTelegramNumber(Number(job.progress || 0), 0)}%。`;
          if (job.status !== 'paused') return `只有 paused 任务可以恢复，当前状态为 ${escapeTelegramHtml(job.status)}。`;
          try {
            researchRepository.updateJobStatus(job.id, 'running');
            return `✅ 已恢复任务 <code>${escapeTelegramHtml(job.id)}</code>。`;
          } catch (error: any) {
            return `任务恢复失败：${escapeTelegramHtml(error?.message || '状态转换失败')}`;
          }
        }
        if (action === 'events') {
          const events = researchRepository.getEvents(job.id).slice(-8);
          return ['<b>🛰 任务事件</b>', `<code>${escapeTelegramHtml(job.id)}</code> · ${escapeTelegramHtml(job.status)} · ${formatTelegramNumber(Number(job.progress || 0), 0)}%`, ...(events.length ? events.map((event: any) => `· ${escapeTelegramHtml(String(event.createdAt || '').slice(0, 19))} · ${escapeTelegramHtml(event.eventType)} · ${escapeTelegramHtml(JSON.stringify(event.payload || {}).slice(0, 260))}`) : ['· 暂无事件'])].join('\n');
        }
        if (action === 'artifact' || action === 'artifacts') {
          const artifacts = researchRepository.getArtifacts(job.id);
          if (!artifacts.length) return ['<b>📦 任务证据包</b>', `<code>${escapeTelegramHtml(job.id)}</code>`, '暂无证据包；任务可能仍在运行或没有可导出产物。'].join('\n');
          const requestedName = String(args[2] || '').trim();
          if (!requestedName) return ['<b>📦 任务证据包</b>', `<code>${escapeTelegramHtml(job.id)}</code>`, ...artifacts.slice(0, 8).map(item => `· <code>${escapeTelegramHtml(item.uri.replace(/^file:\/\//, ''))}</code> · hash ${escapeTelegramHtml(item.hash || '-')}`), '', `发送文件：/tasks artifact ${escapeTelegramHtml(job.id)} result.json|trades.csv|report.md`].join('\n');
          const allowedUri = /^file:\/\/(result\.json|trades\.csv|report\.md)$/;
          if (!/^[a-zA-Z0-9_-]{1,128}$/.test(job.id)) return '任务标识不符合本地证据文件规则。';
          const fileName = requestedName.match(/^(result\.json|trades\.csv|report\.md)$/)?.[1];
          if (!fileName) return '只允许下载 result.json、trades.csv 或 report.md。';
          const manifest = artifacts.find(item => allowedUri.test(String(item.uri)) && item.uri === `file://${fileName}`);
          if (!manifest) return `该任务没有 ${escapeTelegramHtml(fileName)} 产物。`;
          const artifactRoot = path.resolve(DATA_ROOT, 'research-artifacts', job.id);
          const target = path.resolve(artifactRoot, fileName);
          if (!target.startsWith(artifactRoot + path.sep) || !fs.existsSync(target) || fs.lstatSync(target).isSymbolicLink()) return '证据文件尚未持久化或不可用；旧任务可能只有清单记录。';
          const stat = fs.statSync(target);
          if (!stat.isFile() || stat.size > 8_000_000) return '证据文件不是普通文件或超过 Telegram 发送大小限制。';
          return { text: `📦 任务 ${escapeTelegramHtml(job.id)} 证据文件：${escapeTelegramHtml(fileName)}\nSHA-256：${escapeTelegramHtml(manifest.hash || '清单未提供')}`, document: { data: fs.readFileSync(target), filename: fileName } };
        }
        return ['<b>🧰 研究任务详情</b>', `<code>${escapeTelegramHtml(job.id)}</code>`, `市场：${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[job.market as MarketScope] || job.market)} · 工作区：${escapeTelegramHtml(job.workspace)}`, `状态：${escapeTelegramHtml(job.status)} · 进度：${formatTelegramNumber(Number(job.progress || 0), 0)}%`, `说明：${escapeTelegramHtml(job.inputSummary || '未提供')}`, job.errorReason ? `失败原因：${escapeTelegramHtml(job.errorReason)}` : '', '', '事件：/tasks events ' + escapeTelegramHtml(job.id), '证据包：/tasks artifact ' + escapeTelegramHtml(job.id), job.status === 'paused' ? '恢复：/tasks resume ' + escapeTelegramHtml(job.id) : ['queued', 'running'].includes(job.status) ? '取消：/tasks cancel ' + escapeTelegramHtml(job.id) : '该任务已结束。'].filter(Boolean).join('\n');
      }
      const jobs = researchRepository.listJobs(market as any).slice(0, 10);
      if (!jobs.length) return `<b>🧰 研究任务</b>\n${telegramScopeHeader(scope)}\n暂无可恢复的研究/回测任务。`;
      return [
        '<b>🧰 研究任务</b>',
        telegramScopeHeader(scope),
        ...jobs.map((job, index) => `${index + 1}. <code>${escapeTelegramHtml(job.id)}</code> · ${escapeTelegramHtml(job.status)} · ${formatTelegramNumber(Number(job.progress || 0), 0)}%\n   ${escapeTelegramHtml(job.inputSummary || '未提供任务说明')}${job.errorReason ? `\n   原因：${escapeTelegramHtml(job.errorReason)}` : ''}`),
        '',
        '网页端可继续查看任务事件、取消/恢复和证据包；Telegram 只复用同一任务状态。',
      ].join('\n');
    },
    backtest: async ({ args, chatId }) => {
      const chatScope = telegramScopeForChat(chatId);
      if (chatScope === 'options') {
        return '<b>🧪 期权策略回测</b>\n当前期权历史链、隐含波动率和 Greeks 数据源尚未覆盖，暂不生成伪造结果。';
      }
      if (String(args[0] || '').toLowerCase() === 'start') {
        const strategy = String(args[1] || 'momentum').trim();
        const instrument = String(args[2] || '').trim();
        const strategyAliases: Record<string, string> = { momentum: 'momentum', mean: 'meanReversion', mr: 'meanReversion', meanreversion: 'meanReversion', 'mean-reversion': 'meanReversion' };
        const strategyId = strategyAliases[strategy.toLowerCase()];
        if (!strategyId || !instrument) return `用法：/backtest start [momentum|meanReversion] ${chatScope === 'stocks' ? '<股票代码或InstrumentRef>' : chatScope === 'crypto' ? '<交易对或InstrumentRef>' : '<预测市场ID>'}`;
        if (!['stocks', 'crypto', 'prediction'].includes(chatScope)) return `当前为${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[chatScope])}市场，暂不支持创建该类回测任务。`;
        let scopedInstrument = instrument;
        if (chatScope === 'prediction' && /^\d+$/.test(instrument)) scopedInstrument = `prediction:predictfun:${instrument}`;
        try {
          assertMarketContext({ market: chatScope as MarketId, workspace: 'backtest', instrument: scopedInstrument });
          const job = createResearchJob({ market: chatScope as MarketId, workspace: 'backtest', inputSummary: JSON.stringify({ instrument: scopedInstrument, timeframe: '1d', strategy: strategyId }) });
          researchRepository.saveJob(job);
          telegramCommandCenterStore.recordAudit(chatId, 'research_job_create', `${job.id}:${chatScope}:${scopedInstrument}`);
          return `<b>✅ 回测任务已创建</b>\n任务：<code>${escapeTelegramHtml(job.id)}</code>\n市场：${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[chatScope])}\n标的：<code>${escapeTelegramHtml(scopedInstrument)}</code>\n策略：${escapeTelegramHtml(strategyId)}\n\n后台将使用真实历史数据执行；查看：/tasks ${escapeTelegramHtml(job.id)}\n取消：/tasks cancel ${escapeTelegramHtml(job.id)}`;
        } catch (error: any) {
          return `回测任务创建失败：${escapeTelegramHtml(error?.message || '市场或标的无效')}`;
        }
      }
      if (chatScope === 'stocks' || chatScope === 'crypto') {
        const firstAssetArg = String(args[0] || '').trim();
        const secondAssetArg = String(args[1] || '').trim();
        const assetAliases: Record<string, 'momentum' | 'meanReversion'> = { momentum: 'momentum', mean: 'meanReversion', mr: 'meanReversion', meanreversion: 'meanReversion', 'mean-reversion': 'meanReversion' };
        const firstAssetKey = firstAssetArg.toLowerCase();
        const assetStrategy = assetAliases[firstAssetKey] || 'momentum';
        const assetSymbol = assetAliases[firstAssetKey] ? secondAssetArg : firstAssetArg;
        if (!assetSymbol || (secondAssetArg && !assetAliases[firstAssetKey])) {
          return `用法：/backtest [momentum|meanReversion] ${chatScope === 'stocks' ? '[股票代码]' : '[交易对]'}\n只读取当前${TELEGRAM_SCOPE_LABELS[chatScope]}真实历史数据，不会创建交易。`;
        }
        try {
          const stats = chatScope === 'stocks'
            ? await backtester.runStockBacktest(assetStrategy, assetSymbol)
            : await backtester.runCryptoBacktest(assetStrategy, assetSymbol);
          if (stats.totalTrades === 0) return `${escapeTelegramHtml(stats.instrumentId)} 暂无足够真实历史数据进行回测。`;
          return `<b>🧪 ${TELEGRAM_SCOPE_LABELS[chatScope]}策略回测</b> · ${escapeTelegramHtml(stats.strategyName)}\n标的：${escapeTelegramHtml(stats.instrumentId)}\n数据源：${escapeTelegramHtml(stats.dataSource)} · K线 ${stats.barCount}\n交易数：${stats.totalTrades} · 胜率：${formatTelegramNumber(stats.winRate * 100, 1)}%\n收益：${formatTelegramNumber(stats.totalReturnPct, 2)}% · 最大回撤：${formatTelegramNumber(stats.maxDrawdownPct, 2)}%\nSharpe：${formatTelegramNumber(stats.sharpeRatio, 2)} · 平均持仓：${formatTelegramNumber(stats.avgHoldMinutes, 1)} 分钟`;
        } catch (error: any) {
          return `当前${TELEGRAM_SCOPE_LABELS[chatScope]}回测不可用：${escapeTelegramHtml(error?.message || '真实历史数据暂不可用')}`;
        }
      }
      const first = String(args[0] || '').trim();
      const second = String(args[1] || '').trim();
      const aliases: Record<string, 'momentum' | 'meanReversion'> = {
        momentum: 'momentum',
        mean: 'meanReversion',
        mr: 'meanReversion',
        meanreversion: 'meanReversion',
        'mean-reversion': 'meanReversion',
      };
      const firstKey = first.toLowerCase();

      if (firstKey === 'compare') {
        const compareMarketIdInput = second;
        const compareMarketId = /^\d+$/.test(compareMarketIdInput) ? parseInt(compareMarketIdInput, 10) : undefined;
        if (compareMarketIdInput && compareMarketId == null) {
          return '用法：/backtest compare [市场ID]\n只读查看策略对比，不会创建交易。';
        }

        const statsMom = backtester.runMomentumBacktest(10, 0.03, 5, 1000, compareMarketId);
        const statsMr = backtester.runMeanReversionBacktest(10, 0.03, 5, 1000, compareMarketId);

        if (statsMom.totalTrades === 0 && statsMr.totalTrades === 0) {
           return `${compareMarketIdInput ? `市场 ${escapeTelegramHtml(compareMarketIdInput)}` : '当前范围'}暂无足够历史数据进行回测。`;
        }

        const formatStats = (s: any) => `${escapeTelegramHtml(s.strategyName)}: 收益 ${formatTelegramNumber(s.totalReturnPct, 2)}%, 胜率 ${formatTelegramNumber(s.winRate * 100, 1)}%, 最大回撤 ${formatTelegramNumber(s.maxDrawdownPct, 2)}%, Sharpe ${formatTelegramNumber(s.sharpeRatio, 2)}`;

        return `<b>⚖️ 策略对比回测</b>\n范围：${compareMarketIdInput ? `市场 ${escapeTelegramHtml(compareMarketIdInput)}` : '全部市场'}\n${formatStats(statsMom)}\n${formatStats(statsMr)}`;
      }

      const strategy = aliases[firstKey] || 'momentum';
      const firstIsMarketId = /^\d+$/.test(first);
      const marketIdInput = firstIsMarketId ? first : second;
      const hasUnsupportedStrategy = Boolean(first) && !firstIsMarketId && !aliases[firstKey];
      const marketId = /^\d+$/.test(marketIdInput) ? parseInt(marketIdInput, 10) : undefined;

      if (hasUnsupportedStrategy || (marketIdInput && marketId == null)) {
        return '用法：/backtest [momentum|meanReversion] [市场ID]\n只读查看策略回测，不会创建交易。';
      }

      const stats = strategy === 'meanReversion'
        ? backtester.runMeanReversionBacktest(10, 0.03, 5, 1000, marketId)
        : backtester.runMomentumBacktest(10, 0.03, 5, 1000, marketId);

      if (stats.totalTrades === 0) return `${marketIdInput ? `市场 ${escapeTelegramHtml(marketIdInput)}` : '当前范围'}暂无足够历史数据进行回测。`;

      return `<b>🧪 策略回测</b> · ${escapeTelegramHtml(stats.strategyName)}\n范围：${marketIdInput ? `市场 ${escapeTelegramHtml(marketIdInput)}` : '全部市场'}\n交易数：${stats.totalTrades} · 胜率：${formatTelegramNumber(stats.winRate * 100, 1)}%\n收益：${formatTelegramNumber(stats.totalReturnPct, 2)}% · 最大回撤：${formatTelegramNumber(stats.maxDrawdownPct, 2)}%\nSharpe：${formatTelegramNumber(stats.sharpeRatio, 2)} · 平均持仓：${formatTelegramNumber(stats.avgHoldMinutes, 1)} 分钟`;
    },
    watchlist: ({ chatId }) => {
      const scope = telegramScopeForChat(chatId);
      const ids = telegramScopedWatchIds(chatId, scope);
      if (!ids.length) return '<b>⭐ 自选市场</b>\n暂无自选市场。\n用法：发送 /search 搜索后点“加自选”。';
      const lines = [`<b>⭐ ${TELEGRAM_SCOPE_LABELS[scope]}自选</b>`, telegramScopeHeader(scope), ...ids.map((id, i) => {
        const m = telegramFindMarket(id);
        return m ? `${i+1}. ${escapeTelegramHtml(m.titleZh || m.title)}\n   ID ${escapeTelegramHtml(String(m.id))} · ${escapeTelegramHtml(m.platform)}` : `${i+1}. 市场 ${escapeTelegramHtml(id)}`;
      })];
      const kb = ids.slice(0, 8).map(id => {
        const m = telegramFindMarket(id);
        const label = String(m?.titleZh || m?.title || id).slice(0,8);

        let canonicalId: string | null = null;
        if (/^(stock:us|crypto:binance|prediction:predictfun):/.test(id)) {
          canonicalId = id;
        } else if (isTelegramWatchableStockId(id)) {
          canonicalId = `stock:us:${id.replace(/^us/i, '')}`;
        } else if (m) {
          canonicalId = `prediction:predictfun:${id}`;
        }

        const row: TelegramInlineKeyboardButton[] = [
          { text: `移除 ${label}`, callback_data: `watch:remove:${id}` }
        ];

        if (canonicalId) {
          row.push({ text: '查看详情', callback_data: `unified:show:${canonicalId}` });
        }

        row.push({ text: `解释`, callback_data: `explain:${id}` });
        if (telegramScopeForWatchId(id) === 'prediction') row.push({ text: `开仓`, callback_data: telegramPaperCallback('paper:pick', String(id), chatId, 'prediction') });

        return row;
      });
      return telegramInlineReply(lines.join('\n'), kb);
    },
    watch: ({ chatId, args }) => {
      const scope = telegramScopeForChat(chatId);
      const parsed = parseWatchCommandArgs(args);
      if (!parsed) return '用法：/watch add &lt;市场ID&gt; 或 /watch remove &lt;市场ID&gt;；查看：/watchlist';
      if (parsed.action === 'list') return formatTelegramWatchlist(chatId, scope);
      const market = telegramFindMarket(parsed.marketId || '');
      if (parsed.action === 'add' && !market && !isTelegramWatchableStockId(parsed.marketId || '') && !telegramRefFromId(parsed.marketId || '')) return '未找到该市场。请先用 /search &lt;关键词&gt; 确认市场 ID。';
      const itemScope = telegramScopeForWatchId(parsed.marketId || '');
      if (itemScope && scope !== 'overview' && scope !== 'watchlist' && itemScope !== scope) {
        return `当前为${TELEGRAM_SCOPE_LABELS[scope]}市场，不能操作${TELEGRAM_SCOPE_LABELS[itemScope]}标的。请先切换市场后重试。`;
      }
      const changed = parsed.action === 'add'
        ? telegramCommandCenterStore.addWatchlistMarket(chatId, parsed.marketId || '')
        : telegramCommandCenterStore.removeWatchlistMarket(chatId, parsed.marketId || '');
      telegramCommandCenterStore.recordAudit(chatId, 'watchlist_update', parsed.action + ':' + parsed.marketId);
      return changed
        ? (parsed.action === 'add' ? '✅ 已加入自选：' : '✅ 已移出自选：') + escapeTelegramHtml(telegramWatchLabel(parsed.marketId || '', market))
        : (parsed.action === 'add' ? '该市场已经在自选列表中。' : '该市场不在自选列表中。');
    },
    portfolio: ({ chatId }) => formatTelegramPortfolio(telegramScopeForChat(chatId)),
    positions: ({ chatId }) => {
      const scope = telegramScopeForChat(chatId);
      if (scope !== 'overview' && scope !== 'watchlist') return formatTelegramPortfolio(scope);
      const positions = paperEngine.getOpenPositions();
      if (!positions.length) return '<b>当前持仓</b>\n暂无开放持仓。';
      return ['<b>当前持仓</b>', ...positions.map(position => {
        const current = position.currentPrice ?? position.entryPrice;
        const pnl = (current - position.entryPrice) * position.quantity;
        return '· ' + escapeTelegramHtml(position.id) + ' · ' + escapeTelegramHtml(position.marketTitle) + ' · ' + escapeTelegramHtml(position.outcomeName) + ' · ' + (pnl >= 0 ? '+' : '') + '$' + formatTelegramNumber(pnl) + '\n  平仓：/close ' + escapeTelegramHtml(position.id) + ' &lt;价格0-1&gt;';
      })].join('\n');
    },
    close: ({ chatId, args }) => {
      const positionId = args[0] || '';
      const exitPrice = Number(args[1]);
      const position = paperEngine.getOpenPositions().find(item => item.id === positionId);
      if (!position || !Number.isFinite(exitPrice) || exitPrice <= 0 || exitPrice > 1) return '用法：/close &lt;持仓ID&gt; &lt;平仓价格0-1&gt;\n先发送 /positions 查看持仓。';
      const pending = telegramCommandCenterStore.createPendingAction(chatId, { type: 'paper_close', positionId, price: exitPrice });
      return '⚠️ 请确认模拟平仓\n' + escapeTelegramHtml(position.marketTitle) + ' · ' + escapeTelegramHtml(position.outcomeName) + '\n价格：' + exitPrice + '\n\n确认：/confirm ' + pending.nonce + '\n取消：/cancel';
    },
    reset: ({ chatId }) => {
      const pending = telegramCommandCenterStore.createPendingAction(chatId, { type: 'paper_reset' });
      return '⚠️ <b>危险操作：重置模拟账户</b>\n这会清空当前持仓、历史交易和盈亏统计，恢复为初始余额。\n\n确认：/confirm ' + pending.nonce + '\n取消：/cancel';
    },
    review: () => formatTelegramReview(),
    export: () => {
      const trades = paperEngine.getRecentTrades(20);
      if (!trades.length) return '<b>模拟交易记录</b>\n暂无记录。';
      return ['<b>最近模拟交易记录</b>', ...trades.map(item => '· ' + escapeTelegramHtml(item.timestamp.slice(0, 19)) + ' · ' + escapeTelegramHtml(item.action) + ' · ' + escapeTelegramHtml(item.marketTitle) + ' · ' + escapeTelegramHtml(item.outcomeName) + ' · $' + formatTelegramNumber(item.price, 4) + ' × ' + item.quantity + '\n  ' + escapeTelegramHtml(item.reason)), '', '完整 CSV 可通过本地面板的导出接口获取。'].join('\n');
    },
    note: ({ chatId, args }) => {
      if (!args.length) return '用法：/note &lt;研究内容&gt;\n也可以：/note &lt;市场ID&gt; &lt;研究内容&gt;';
      let marketId: string | undefined;
      let textArgs = args;
      const maybeMarket = telegramFindMarket(args[0]);
      if (maybeMarket) { marketId = String(maybeMarket.id); textArgs = args.slice(1); }
      const text = textArgs.join(' ').trim();
      if (!text) return '日志内容不能为空。用法：/note &lt;研究内容&gt;';
      const market = marketId ? telegramFindMarket(marketId) : undefined;
      const entry = telegramCommandCenterStore.createJournalEntry(chatId, {
        text,
        marketId,
        marketTitle: market?.titleZh || market?.title,
        snapshot: market ? { price: market.yesPrice, probabilityPct: market.modelProbability * 100, signal: market.signalZh, sourceStatus: 'prediction-radar', capturedAt: new Date().toISOString() } : undefined,
      });
      telegramCommandCenterStore.recordAudit(chatId, 'journal_note_create', entry.id);
      return '✅ 已记录研究笔记：' + entry.id + (market ? '\n市场：' + escapeTelegramHtml(market.titleZh || market.title) : '');
    },
    journal: async ({ chatId, args }) => {
      if (String(args[0] || '').toLowerCase() === 'ai') {
        const radar = getCachedPredictionRadarSlice('', 240);
        if (!radar) return '暂无预测雷达快照，暂时无法生成 AI 复盘。';
        const ai = await getAiMarketCommentary(radar).catch(() => null);
        return ai?.analysis ? '<b>🤖 AI 研究复盘</b>\n' + escapeTelegramHtml(ai.analysis) : 'AI 复盘暂不可用，请检查 AI API 配置。';
      }
      const entries = telegramCommandCenterStore.listJournalEntries(chatId, 12);
      if (!entries.length) return '<b>📝 研究日志</b>\n暂无记录。用 /note <内容> 开始记录。';
      return ['<b>📝 研究日志</b>', ...entries.map(entry => '· ' + escapeTelegramHtml(entry.createdAt.slice(0, 19)) + (entry.marketTitle ? ' · ' + escapeTelegramHtml(entry.marketTitle) : '') + '\n  ' + escapeTelegramHtml(entry.text))].join('\n');
    },
    digest: async ({ chatId, args }) => {
      const action = String(args[0] || '').toLowerCase();
      if (action === 'on' || action === 'off') {
        telegramCommandCenterStore.updateAlertPolicy(chatId, { digest: { enabled: action === 'on', time: telegramCommandCenterStore.getAlertPolicy(chatId).digest.time } });
        telegramCommandCenterStore.recordAudit(chatId, 'digest_update', action);
        return '定时摘要已' + (action === 'on' ? '开启' : '关闭') + '\n' + formatTelegramAlertPolicy(chatId);
      }
      if (action === 'time') {
        const time = parseDigestTime(args[1] || '');
        if (!time) return '用法：/digest time HH:mm，例如 /digest time 08:30';
        telegramCommandCenterStore.updateAlertPolicy(chatId, { digest: { enabled: true, time } });
        telegramCommandCenterStore.recordAudit(chatId, 'digest_update', 'time=' + time);
        return '✅ 定时摘要时间已设置为 ' + time + '\n' + formatTelegramAlertPolicy(chatId);
      }
      if (action === 'preopen' || action === 'postclose') {
        const policy=telegramCommandCenterStore.getAlertPolicy(chatId), field=action==='preopen'?'preOpen':'postClose';
        const enabledKey=field==='preOpen'?'preOpenEnabled':'postCloseEnabled',timeKey=field==='preOpen'?'preOpenTime':'postCloseTime';
        const operation=String(args[1]||'').toLowerCase();
        if(operation==='on'||operation==='off'){
          telegramCommandCenterStore.updateAlertPolicy(chatId,{digest:{...policy.digest,[enabledKey]:operation==='on'}});
          telegramCommandCenterStore.recordAudit(chatId,'digest_schedule_update',`${field}=${operation}`);
          return `✅ ${field==='preOpen'?'盘前':'盘后'}摘要已${operation==='on'?'开启':'关闭'}（上海时间 ${policy.digest[timeKey] || (field==='preOpen'?'21:00':'05:00')}）。\n${formatTelegramAlertPolicy(chatId)}`;
        }
        if(operation==='time'){
          const time=parseDigestTime(args[2]||'');if(!time)return `用法：/digest ${action} time HH:mm（上海时间）`;
          telegramCommandCenterStore.updateAlertPolicy(chatId,{digest:{...policy.digest,[enabledKey]:true,[timeKey]:time}});
          telegramCommandCenterStore.recordAudit(chatId,'digest_schedule_update',`${field}=time:${time}`);
          return `✅ ${field==='preOpen'?'盘前':'盘后'}摘要已设为上海时间 ${time}，并已开启。\n${formatTelegramAlertPolicy(chatId)}`;
        }
        return `用法：/digest ${action} on|off 或 /digest ${action} time HH:mm（上海时间；美国市场存在夏令时，时间可自行调整）`;
      }
      if (action === 'now') return buildTelegramDigest(chatId);
      return '<b>🗓 定时摘要</b>\n' + formatTelegramAlertPolicy(chatId) + '\n\n每日：/digest on|off · /digest time 08:30\n盘前：/digest preopen on|off · /digest preopen time 21:00\n盘后：/digest postclose on|off · /digest postclose time 05:00\n立即查看：/digest now（全部使用上海时间）';
    },
    health: async () => {
      try {
        const report = await getSourceHealth();
        const settings = settingsManager.get();
        return ['<b>🩺 系统健康</b>', 'Telegram 轮询：' + (telegramInteractionBot?.isRunning ? '运行中' : '未运行'), '出站通知：' + (telegram.isConfigured && settings.telegramEnabled ? '已启用' : '未启用'), '模拟盘：' + (settings.paperTradingEnabled ? '已启用' : '未启用'), '数据源：' + report.online + '/' + report.total + ' 在线', 'AI：' + (aiCommentaryConfigured() ? '已配置' : '未配置'), '检查时间：' + report.updatedAt, '', ...report.items.slice(0, 12).map(item => (item.ok ? '✅ ' : '⚠️ ') + escapeTelegramHtml(item.name) + ' · ' + escapeTelegramHtml(item.detail))].join('\n');
      } catch (error) {
        return '系统健康检查失败：' + escapeTelegramHtml(error instanceof Error ? error.message : '未知错误');
      }
    },
    explain: async ({ chatId, args }) => {
      const scope = telegramScopeForChat(chatId);
      const actions = telegramActions(scope).filter(action => action.action !== 'WAIT');
      const index = Number(args[0]);
      const action = Number.isInteger(index) && index > 0 ? actions[index - 1] : undefined;
      if (action) {
        const actionRadar = getCachedPredictionRadarSlice('', 240);
        const ai = actionRadar ? await getAiMarketCommentary(actionRadar).catch(() => null) : null;
        return ['<b>🧠 信号解释</b>', escapeTelegramHtml(action.title || action.symbol), '结论：' + escapeTelegramHtml(action.actionZh), '置信度：' + formatTelegramNumber(action.confidencePct, 1) + '%', action.probabilityPct == null ? '' : '概率：' + formatTelegramNumber(action.probabilityPct, 1) + '%', '', '<b>支持证据</b>', ...(action.reasons || []).slice(0, 6).map(reason => '· ' + escapeTelegramHtml(reason)), '', '风险：' + escapeTelegramHtml((action as any).riskNote || '请结合数据新鲜度和仓位风险判断'), '结论失效条件：行情、事件或来源状态发生明显变化。', ...(ai?.analysis ? ['', '<b>AI 参考</b>', escapeTelegramHtml(ai.analysis.slice(0, 500))] : [])].filter(Boolean).join('\n');
      }
      const market = args[0] ? telegramFindMarket(args[0]) : undefined;
      if (!market) {
        const list = telegramActions(scope).filter(a=>a.action!=="WAIT").slice(0,6);
        if(list.length){
          const lines = ["<b>请选择要解释的信号</b>", ...list.map((a,i)=>`${i+1}. ${escapeTelegramHtml(a.title||a.symbol)}`)];
          const kb = list.map((_,i)=>[{ text: `解释 #${i+1}`, callback_data: `explain:${i+1}` }]);
          return telegramInlineReply(lines.join("\n"), kb);
        }
        return '用法：/explain <信号序号> 或 /explain <市场ID>\n先发送 /signals 或 /search。';
      }
      const radar = getCachedPredictionRadarSlice('', 240);
      const ageMinutes = Math.max(0, Math.round((Date.now() - new Date(radar?.updatedAt || Date.now()).getTime()) / 60000));
      const ai = radar ? await getAiMarketCommentary(radar).catch(() => null) : null;
      const mText = ['<b>🧠 市场解释</b>', escapeTelegramHtml(market.titleZh || market.title), '平台：' + escapeTelegramHtml(market.platform), 'YES：' + formatTelegramNumber(market.yesPrice * 100, 1) + '% · 模型：' + formatTelegramNumber(market.modelProbability * 100, 1) + '%', '模型信心：' + formatTelegramNumber(market.probabilityConfidence, 1) + '%', '数据年龄：' + ageMinutes + ' 分钟' + (ageMinutes > 10 ? ' · ⚠️ 数据可能已过期' : ''), '', '<b>支持与风险</b>', '· ' + escapeTelegramHtml(market.probabilityZh || '模型概率与市场概率已进行对比'), '· 流动性：$' + formatTelegramNumber(market.liquidity, 0), '· 价差：' + formatTelegramNumber((market.spread || 0) * 100, 2) + 'pp', '', '失效条件：市场流动性骤降、来源过期或事件信息出现反转。', ...(ai?.analysis ? ['', '<b>AI 参考</b>', escapeTelegramHtml(ai.analysis.slice(0, 500))] : [])].join('\n');
      return telegramInlineReply(mText, [[{ text: '加自选', callback_data: `watch:add:${market.id}` }, { text: '开仓', callback_data: telegramPaperCallback('paper:pick', String(market.id), chatId) }]]);
    },
    today: async () => {
      const [prices, calendar] = await Promise.allSettled([
        binanceFeed.getMultiplePrices(['BTCUSDT', 'ETHUSDT']),
        getUpcomingEventCalendar(7),
      ]);
      const portfolio = paperEngine.getPortfolio();
      const history = getRiskHistory(24);
      const priceMap = prices.status === 'fulfilled' ? prices.value : {};
      const priceLines = Object.values(priceMap).map(item => `· ${item.symbol}: $${formatTelegramNumber(item.price, item.price >= 100 ? 2 : 4)}`);
      const events = calendar.status === 'fulfilled' ? calendar.value.events.slice(0, 3) : [];
      return [
        '<b>今日总览</b>',
        `模拟盘权益：$${formatTelegramNumber(portfolio.equity)} · 持仓 ${paperEngine.getOpenPositions().length}`,
        `总盈亏：${portfolio.totalPnl >= 0 ? '+' : ''}$${formatTelegramNumber(portfolio.totalPnl)} · 风险趋势：${escapeTelegramHtml(history.trend.headlineZh)}`,
        '',
        '<b>加密行情</b>',
        ...(priceLines.length ? priceLines : ['· 行情暂不可用']),
        '',
        '<b>近期事件</b>',
        ...(events.length ? events.map(event => `· ${escapeTelegramHtml(event.date.slice(0, 16))} ${escapeTelegramHtml(event.titleZh || event.title)} · ${escapeTelegramHtml(event.impact)}`) : ['· 暂无事件或日历暂不可用']),
        '',
        lastAdvisorReport ? `助手状态：${escapeTelegramHtml(lastAdvisorReport.regime.labelZh)} · 更新于 ${escapeTelegramHtml(lastAdvisorReport.generatedAt)}` : '助手状态：后台尚未生成最新报告',
      ].join('\n');
    },
    status: () => {
      const settings = settingsManager.get();
      const jobs = getAutomationOverview();
      return [
        '<b>系统状态</b>',
        `模式：${escapeTelegramHtml(config.network === 'testnet' ? '测试网' : '主网配置')}`,
        `运行：${telegramInteractionBot?.isRunning ? '交互轮询运行中' : '仅出站/未启动'}`,
        `出站通知：${telegram.isConfigured && settings.telegramEnabled ? '已启用' : '未启用'}`,
        `模拟盘：${settings.paperTradingEnabled ? '已启用' : '未启用'}`,
        `自动化：${jobs.enabledJobs}/${jobs.totalJobs} 个任务启用，累计 ${jobs.totalRuns} 次运行`,
        '',
        '提示：行情和预测数据是否最新，取决于对应数据源的认证与可用性。',
      ].join('\n');
    },
    risk: ({ chatId }) => {
      const scope = telegramScopeForChat(chatId);
      if (scope !== 'overview' && scope !== 'prediction') {
        const ledger = calculateUnifiedPerformance(filterUnifiedPaperLedger(unifiedPaperLedgerStore.get(), scope));
        return [`<b>${TELEGRAM_SCOPE_LABELS[scope]}市场风险摘要</b>`, telegramScopeHeader(scope), `权益：$${formatTelegramNumber(ledger.equity)}`, `总盈亏：${ledger.totalPnl >= 0 ? '+' : ''}$${formatTelegramNumber(ledger.totalPnl)}`, `统一持仓：${ledger.positions} · 交易数：${ledger.totalTrades}`, '', '以上为当前市场作用域的统一模拟盘统计，不代表真实账户风险。'].join('\n');
      }
      const portfolio = paperEngine.getPortfolio();
      const metrics = paperEngine.getRiskMetrics();
      return [
        '<b>模拟盘风险摘要</b>',
        `权益：$${formatTelegramNumber(portfolio.equity)}`,
        `未实现盈亏：${portfolio.unrealizedPnl >= 0 ? '+' : ''}$${formatTelegramNumber(portfolio.unrealizedPnl)}`,
        `已实现盈亏：${portfolio.totalPnl >= 0 ? '+' : ''}$${formatTelegramNumber(portfolio.totalPnl)}`,
        `胜率：${formatTelegramNumber(metrics.winRate * 100, 1)}%（${metrics.totalTrades} 笔已平仓）`,
        `最大回撤：${formatTelegramNumber(metrics.maxDrawdownPct, 1)}%`,
        `VaR95：$${formatTelegramNumber(metrics.var95Usd)}`,
        '',
        '以上为本地模拟盘统计，不代表实时市场或真实账户风险。',
      ].join('\n');
    },
    signal: ({ chatId, args }) => {
      const scope = telegramScopeForChat(chatId);
      if (scope === 'stocks') {
        const snapshot = telegramStockSignalScanner.get(chatId);
        if (!snapshot) return '股票扫描尚无可用快照。请发送 /signals 启动扫描。';
        const parsed = Number.parseInt(String(args[0] || '1'), 10);
        const index = Number.isFinite(parsed) && parsed > 0 ? parsed - 1 : 0;
        const row = snapshot.candidates[index];
        if (!row) return `未找到第 ${index + 1} 个股票候选，共 ${snapshot.candidates.length} 个。发送 /signals 查看列表。`;
        const candidate = row.candidate;
        const state = row.status === 'pending' ? '等待扫描' : row.status === 'unavailable' ? '数据不可用' : row.action?.actionZh || row.action?.action || 'WAIT';
        const sourceNames: Record<string, string> = { fixed: '固定热门', mover: '美股异动', watchlist: '自选' };
        return [
          `<b>股票信号详情 #${index + 1}</b>`,
          `${escapeTelegramHtml(candidate.name || candidate.symbol)} · ${escapeTelegramHtml(candidate.instrumentId)}`,
          `状态：${escapeTelegramHtml(state)} · 来源池：${candidate.sources.map(item => sourceNames[item] || item).join('＋')}`,
          row.dataStatus ? `数据状态：${escapeTelegramHtml(row.dataStatus)}` : '',
          row.source ? `行情源：${escapeTelegramHtml(row.source)}` : '',
          row.updatedAt ? `数据时间：${escapeTelegramHtml(row.updatedAt)}` : '',
          row.reason ? `原因：${escapeTelegramHtml(row.reason)}` : '',
          ...(row.action?.reasons || []).slice(0, 6).map(reason => `· ${escapeTelegramHtml(reason)}`),
          '', '仅作研究信息，不构成投资建议，不会自动下单。',
        ].filter(Boolean).join('\n');
      }
      if (!lastAdvisorReport) {
        refreshAdvisorReportInBackground();
        return '助手报告尚未准备好，已在后台刷新。稍后再次发送 /signal 1。';
      }
      const actions = telegramActions(scope).filter(action => action.action !== 'WAIT');
      const index = Math.max(1, Number(args[0] || 1)) - 1;
      const action = actions[index];
      if (!action) return actions.length ? `未找到第 ${index + 1} 条信号，共 ${actions.length} 条。发送 /signals 查看列表。` : '暂无可展开的非 WAIT 信号。';
      return [
        `<b>信号详情 #${index + 1}</b>`,
        `${escapeTelegramHtml(action.title || action.symbol)} · ${escapeTelegramHtml(action.venue)}`,
        `动作：<b>${escapeTelegramHtml(action.actionZh)}</b> · 置信度 ${formatTelegramNumber(action.confidencePct, 1)}%`,
        action.probabilityPct == null ? '' : `概率：${formatTelegramNumber(action.probabilityPct, 1)}%`,
        action.entry == null ? '' : `入场：${formatTelegramNumber(action.entry, 4)} · 止损：${formatTelegramNumber(action.stopLoss ?? NaN, 4)} · 止盈：${formatTelegramNumber(action.takeProfit ?? NaN, 4)}`,
        `建议风险：${formatTelegramNumber(action.suggestedRiskPct, 1)}% · 周期：${escapeTelegramHtml(action.horizon)}`,
        '',
        '<b>依据</b>',
        ...action.reasons.slice(0, 6).map(reason => `· ${escapeTelegramHtml(reason)}`),
        '',
        '该信号仅作研究提醒，不构成投资建议，也不会自动下单。',
      ].filter(Boolean).join('\n');
    },
    quick: async ({ args, chatId }) => {
      const query = args.join(' ').trim();
      if (!query || (!isTelegramBareSymbol(query) && !telegramRefFromId(query))) {
        return '用法：直接发送股票/期权/虚拟币代码，例如 SNDK、AAPL、BTC；或使用 /q <代码>。也支持完整 InstrumentRef。';
      }
      const scope = telegramScopeForChat(chatId);
      if (!isTelegramBareQueryScope(scope)) return '请先发送 /start 或 /market stocks|options|crypto|prediction 选择当前市场，再查询标的。';
      const candidates = await telegramQuickCandidates(query, scope);
      if (!candidates.length) return `未找到“${escapeTelegramHtml(query)}”。没有可用数据时不会生成伪行情。`;
      if (candidates.length !== 1) return telegramQuickCandidateReply(query, candidates, chatId);
      telegramCommandCenterStore.setActiveMarketScope(chatId, telegramInstrumentScope(candidates[0].type));
      const detail = await unifiedInstrumentService.overview(candidates[0]).catch(() => null);
      if (!detail) return `已找到${escapeTelegramHtml(candidates[0].id)}，但当前来源不可用：暂无详情数据。`;
      telegramCommandCenterStore.updateSession(chatId, { marketScope: scope, workspace: telegramWorkspaceForType(detail.instrument.type), instrumentId: detail.instrument.id, timeframe: '1h' });
      return telegramQuickReply(chatId, detail.instrument, detail, query);
    },
    q: async (context) => rawHandlers.quick(context),
    search: async ({ chatId, args }) => {
      const scope = telegramScopeForChat(chatId);
      const query = args.join(' ').trim().toLowerCase();
      if (!query) {
        const scopedHot = scope === 'stocks' ? [['NVDA','search:q:NVDA'],['AAPL','search:q:AAPL'],['MSFT','search:q:MSFT'],['TSLA','search:q:TSLA']]
          : scope === 'crypto' ? [['BTC','search:q:BTC'],['ETH','search:q:ETH'],['SOL','search:q:SOL']]
            : scope === 'prediction' ? [['election','search:q:election'],['AI','search:q:AI']]
              : [['BTC','search:q:BTC'],['ETH','search:q:ETH'],['NVDA','search:q:NVDA'],['AAPL','search:q:AAPL'],['election','search:q:election'],['AI','search:q:AI']];
        return telegramInlineReply(`<b>搜索${TELEGRAM_SCOPE_LABELS[scope]}</b>\n${telegramScopeHeader(scope)}\n输入当前市场关键词搜索，或点击热门词快速搜索`, scopedHot.map(([label,data])=>[{ text: label, callback_data: data }]));
      }
      const unified = filterInstrumentResults(await unifiedInstrumentService.search(query).catch(() => []), scope);
      if (unified.length) {
        const lines = [`<b>${TELEGRAM_SCOPE_LABELS[scope]}标的搜索</b> · ${escapeTelegramHtml(query)}`, telegramScopeHeader(scope), ...unified.slice(0, 8).map((item, index) => `${index + 1}. ${escapeTelegramHtml(item.title)}\n   ${escapeTelegramHtml(item.id)} · ${escapeTelegramHtml(item.subtitle || '')}${item.price == null ? '' : ` · ${formatTelegramNumber(item.price, item.type === 'prediction' ? 3 : 4)}`}`)];
        const kb = unified.slice(0, 8).map(item => [{ text: `加自选 ${String(item.title).slice(0, 8)}`, callback_data: telegramScopedCallback('watch:add', scope, item.id, chatId) }, { text: '查看详情', callback_data: telegramScopedCallback('unified:show', scope, item.id, chatId) }]);
        return telegramInlineReply(lines.join('\n'), kb);
      }
      if (scope === 'options' && /^[a-z][a-z0-9.-]{0,9}$/i.test(query)) {
        const snapshot = await getEquityOptionsSnapshot(query.toUpperCase()).catch(() => null);
        if (snapshot) return [`<b>期权搜索</b> · ${escapeTelegramHtml(snapshot.asset)}`, telegramScopeHeader(scope), `现价：${formatTelegramNumber(snapshot.spot, 2)}`, `Call/Put 未平仓比：${snapshot.totalPutCallOIRatio == null ? '暂无' : formatTelegramNumber(snapshot.totalPutCallOIRatio, 2)}`, `到期日：${snapshot.expiries.length} 个`].join('\n');
      }
      const radar = scope === 'overview' || scope === 'prediction' || scope === 'watchlist' ? getCachedPredictionRadarSlice('', 240) : null;
      const matches = radar?.markets.filter(item => `${item.title} ${item.titleZh || ''} ${item.category} ${item.platform}`.toLowerCase().includes(query)).slice(0, 8) || [];
      let stockLines: string[] = [];
      let stockKb: TelegramInlineKeyboardButton[][] = [];
      if (scope === 'overview' || scope === 'stocks' || scope === 'watchlist') try {
        const tRaw = await fetchTencentText('https://smartbox.gtimg.cn/s3/?v=2&q='+encodeURIComponent(query)+'&t=all', 6000);
        const tList = parseTencentSearch(tRaw).slice(0,4);
        if(tList.length){
          stockLines = tList.map((it, idx)=> `${idx+1}. ${escapeTelegramHtml(it.zhName||it.name||it.code)} (${escapeTelegramHtml(it.code)}) · ${escapeTelegramHtml(it.market||'')} ${it.price?(' ¥'+formatTelegramNumber(it.price,2)):''}`);
          stockKb = buildTelegramStockSearchRows(tList, scope === 'watchlist' ? 'watchlist' : 'stocks');
          for (let i = 0; i < tList.length; i++) {
            if (tList[i].market === '美股' || String(tList[i].code).startsWith('us')) {
              const ticker = String(tList[i].exchangeSymbol || tList[i].code).replace(/^us/i, '').replace(/\.[A-Z]+$/i, '').toUpperCase();
              if (ticker && stockKb[i]) stockKb[i].push({ text: '查看详情', callback_data: telegramScopedCallback('unified:show', scope === 'watchlist' ? 'watchlist' : 'stocks', 'stock:us:' + ticker, chatId) });
            }
          }
        }
      } catch {}
      if (!matches.length && !stockLines.length) return `当前${TELEGRAM_SCOPE_LABELS[scope]}市场未找到“${escapeTelegramHtml(query)}”的结果。请更换当前市场的关键词重试。`;
      const radarLines = matches.length ? [
        `<b>\u5e02\u573a\u641c\u7d22</b> \u00b7 ${escapeTelegramHtml(query)} \u00b7 \u9884\u6d4b ${matches.length}`,
        ...matches.map((item, index) => `${index + 1}. ${escapeTelegramHtml(item.titleZh || item.title)}\n   ID ${escapeTelegramHtml(item.id)} \u00b7 ${escapeTelegramHtml(item.platform)} \u00b7 YES ${formatTelegramNumber(item.yesPrice * 100, 1)}% \u00b7 \u6d41\u52a8\u6027 ${formatTelegramNumber(item.liquidity, 0)}`),
      ] : [];
      const stockHeader = stockLines.length ? [`<b>${scope === 'options' ? '期权' : '股票'}搜索</b> · ${escapeTelegramHtml(query)}`, ...stockLines] : [];
      const allLines = [...radarLines, ...(radarLines.length && stockHeader.length ? [''] : []), ...stockHeader, '', (matches.length? '\u9884\u6d4b\u7ed3\u679c\u6765\u81ea\u96f7\u8fbe\u5feb\u7167\uff1b' : '') + (stockLines.length? '\u80a1\u7968\u884c\u60c5\u6765\u81ea\u817e\u8baf\u884c\u60c5\uff1b':'') + '\u70b9\u51fb\u6309\u94ae\u53ef\u5feb\u901f\u52a0\u5165\u81ea\u9009/\u89e3\u91ca/\u5f00\u4ed3/\u67e5\u770b\u884c\u60c5\u3002'].join('\n');
      const kb = [];
      for(const item of matches){
        kb.push([{ text: `\u52a0\u81ea\u9009 ${String(item.titleZh || item.title).slice(0,8)}`, callback_data: telegramScopedCallback('watch:add', scope, `prediction:predictfun:${item.id}`, chatId) }, { text: `\u89e3\u91ca`, callback_data: `explain:${item.id}` }, { text: `\u5f00\u4ed3`, callback_data: telegramPaperCallback('paper:pick', String(item.id), chatId) }, { text: `查看详情`, callback_data: telegramScopedCallback('unified:show', scope, `prediction:predictfun:${item.id}`, chatId) }]);
      }
      for(const row of stockKb) kb.push(row);
      if(!kb.length) return telegramReply(allLines || '\u6682\u65e0\u7ed3\u679c');
      return telegramInlineReply(allLines, kb);
    },
    events: async () => {
      try {
        const calendar = await getUpcomingEventCalendar(7);
        return [
          `<b>未来 7 天事件日历</b> · ${calendar.count} 项${calendar.stale ? ' · 使用缓存' : ''}`,
          ...calendar.events.slice(0, 10).map(event => formatEventLineZh(event)),
          ...(calendar.warnings.length ? ['', ...calendar.warnings.map(item => `⚠️ ${escapeTelegramHtml(item)}`)] : []),
        ].join('\n');
      } catch (error) {
        return `事件日历暂时不可用：${escapeTelegramHtml(error instanceof Error ? error.message : '未知错误')}`;
      }
    },
    sources: async () => {
      try {
        const report = await getSourceHealth();
        return [
          `<b>数据源健康</b> · 在线 ${report.online}/${report.total} · 可选已配置 ${report.configuredOptional}`,
          ...report.items.map(item => `${item.ok ? '✅' : '⚠️'} ${escapeTelegramHtml(item.name)} · ${escapeTelegramHtml(item.detail)}${item.latencyMs == null ? '' : ` · ${item.latencyMs}ms`}`),
        ].join('\n');
      } catch (error) {
        return `数据源检查失败：${escapeTelegramHtml(error instanceof Error ? error.message : '未知错误')}`;
      }
    },
    history: () => {
      const portfolio = paperEngine.getPortfolio();
      const metrics = paperEngine.getRiskMetrics();
      const history = getRiskHistory(72);
      return [
        '<b>历史表现与风险趋势</b>',
        `风险：${escapeTelegramHtml(history.trend.headlineZh)}`,
        `趋势：${sparkline(history.points.map(point => point.riskScore))} · ${escapeTelegramHtml(history.trend.detailZh)}`,
        `已平仓：${metrics.totalTrades} · 胜率：${formatTelegramNumber(metrics.winRate * 100, 1)}% · 盈亏因子：${formatTelegramNumber(metrics.profitFactor, 2)}`,
        `最大回撤：${formatTelegramNumber(portfolio.maxDrawdownPct, 1)}% · VaR95：$${formatTelegramNumber(metrics.var95Usd)}`,
        '',
        '统计仅针对本地模拟盘，历史结果不代表未来表现。',
      ].join('\n');
    },
    signals: async ({ chatId, args }) => {
      const scope = telegramScopeForChat(chatId);
      if (scope === 'stocks') {
        const text=await stockSignalsForChat(chatId,args),snapshot=telegramStockSignalScanner.get(chatId);
        if(!snapshot || ['auto','history'].includes(args[0]))return text;
        const filters=Object.fromEntries(args.filter(arg=>arg.includes('=')).map(arg=>arg.split('=')));
        let page;try{page=paginateTelegramStockSignals(snapshot,Number(args[0]) || 1,8,filters);}catch{return text;}
        const button=(label:string,commands:string[])=>({text:label,callback_data:issueTelegramCallback('stock-signal:handle',{scope:'stocks',workspace:'signals',chatId,id:JSON.stringify({args:commands,scanId:snapshot.id})})});
        const suffix=args.filter(arg=>arg.includes('='));
        return telegramInlineReply(text,[
          [button('全部',[]),button('自选',['pool=watchlist']),button('异动',['pool=mover'])],
          [button('BUY',['direction=BUY']),button('SELL',['direction=SELL']),button('不可用',['status=unavailable'])],
          [...(page.page>1 ? [button('上一页',[String(page.page-1),...suffix])]:[]),...(page.page<page.pageCount ? [button('下一页',[String(page.page+1),...suffix])]:[]),button(snapshot.status==='partial' ? '继续扫描':'刷新',[snapshot.status==='partial' ? 'continue':'refresh'])],
        ]);
      }
      if (!lastAdvisorReport) {
        refreshAdvisorReportInBackground();
        return '助手报告尚未准备好，已在后台刷新。稍后再次发送 /signals。';
      }
      const actionable = telegramActions(scope).filter(action => action.action !== 'WAIT').slice(0, 8);
      if (!actionable.length) return `<b>最近信号</b>\n当前没有非 WAIT 建议。\n市场状态：${escapeTelegramHtml(lastAdvisorReport.regime.labelZh)}`;
      const sigLines = [
        `<b>${TELEGRAM_SCOPE_LABELS[scope]}市场信号</b> · ${escapeTelegramHtml(lastAdvisorReport.regime.labelZh)}`,
        telegramScopeHeader(scope),
        ...actionable.map((action, index) => `${index + 1}. ${escapeTelegramHtml(action.title || action.symbol)}：<b>${escapeTelegramHtml(action.actionZh)}</b> · 置信度 ${formatTelegramNumber(action.confidencePct, 0)}%`),
        '',
        '信号仅作研究提醒，不会由机器人自动下单。点按钮查看解释。',
      ].join('\n');
      const kb = actionable.map((_, idx) => [{ text: `解释 #${idx+1}`, callback_data: `explain:${idx+1}` }]);
      return telegramInlineReply(sigLines, kb);
    },
    paper: async ({ chatId, args }) => {
      const currentScope = telegramScopeForChat(chatId);
      const paperVerb = String(args[0] || '').toLowerCase();
      if (!paperVerb && ['stocks', 'options', 'crypto'].includes(currentScope)) return formatTelegramPortfolio(currentScope);
      if (['buy', 'sell', 'order'].includes(paperVerb)) {
        const isExplicitOrder = paperVerb === 'order';
        const refText = String(args[1] || '').trim();
        const side = (isExplicitOrder ? String(args[2] || '') : paperVerb).toUpperCase();
        const priceIndex = isExplicitOrder ? 3 : 2;
        const quantityIndex = isExplicitOrder ? 4 : 3;
        const price = Number(args[priceIndex]);
        const quantity = Number(args[quantityIndex]);
        if (!refText || !['BUY', 'SELL'].includes(side) || !Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
          return '用法：/paper buy|sell <InstrumentRef> <价格> <数量>\n例如：/paper buy stock:us:AAPL 200 1\n或：/paper order crypto:binance:BTCUSDT BUY 60000 0.01';
        }
        // A complete InstrumentRef is intentionally resolved before the scope
        // check so a cross-market paper order receives the explicit rejection
        // below. Bare-symbol lookup remains strictly limited to currentScope.
        const candidates = await telegramQuickCandidates(refText, currentScope, true);
        if (candidates.length !== 1) return candidates.length ? telegramQuickCandidateReply(refText, candidates, chatId) : `未找到“${escapeTelegramHtml(refText)}”，请使用完整 InstrumentRef。`;
        const ref = candidates[0];
        const itemScope = telegramInstrumentScope(ref.type);
        if (itemScope === 'options') return '期权纸面订单需要期权链、Greeks 和合约乘数，当前 Telegram 入口暂不可用，请从网页期权工作区操作。';
        if (!['stock', 'crypto'].includes(ref.type)) return '该 Telegram 订单入口只支持股票和虚拟币；预测市场请使用 /paper open，期权请从网页工作区操作。';
        if (currentScope !== 'overview' && currentScope !== 'watchlist' && currentScope !== itemScope) return `当前为${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[currentScope])}市场，不能提交${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[itemScope])}纸面订单。`;
        const pending = telegramCommandCenterStore.createPendingAction(chatId, {
          type: 'unified_paper_order',
          instrumentId: ref.id,
          instrumentType: ref.type as 'stock' | 'crypto',
          instrumentTitle: ref.title || ref.symbol,
          side: side as 'BUY' | 'SELL',
          price,
          quantity,
        });
        telegramCommandCenterStore.setActiveMarketScope(chatId, itemScope);
        telegramCommandCenterStore.recordAudit(chatId, 'unified_paper_order_form', `${ref.id}:${side}:${price}:${quantity}`);
        return telegramPendingReply(`⚠️ 请确认股票/虚拟币纸面订单\n标的：${escapeTelegramHtml(ref.title || ref.symbol)} · <code>${escapeTelegramHtml(ref.id)}</code>\n方向：${side} · 价格 ${formatTelegramNumber(price, ref.type === 'crypto' ? 4 : 2)} · 数量 ${formatTelegramNumber(quantity, 8)}\n\n确认码：${pending.nonce}（5分钟有效）`, pending.nonce, chatId, itemScope);
      }
      if (args[0] === 'open') {
        if (!['overview', 'prediction'].includes(currentScope)) return `当前为${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[currentScope])}市场，预测市场纸面开仓不能跨市场执行。`;
        const marketId = Number(args[1]);
        const outcome = String(args[2] || '').toLowerCase();
        const outcomeIndex = outcome === 'no' ? 1 : 0;
        const price = Number(args[3]);
        const amountUsd = Number(args[4]);
        if (!Number.isInteger(marketId) || !['yes', 'no'].includes(outcome) || !Number.isFinite(price) || !Number.isFinite(amountUsd) || price <= 0 || price > 1 || amountUsd <= 0) {
          if (args[1] && Number.isInteger(Number(args[1]))) {
            const mid = String(args[1]);
            const m = telegramFindMarket(mid);
            return telegramInlineReply(`\u5df2\u9009\u5e02\u573a\uFF1A${escapeTelegramHtml(m?.titleZh || m?.title || mid)}\n\u8bf7\u9009\u62e9\u65b9\u5411`, buildPaperSideRows(mid, chatId));
          }
          const txt = ['<b>\u6a21\u62df\u5f00\u4ed3</b>','\u70b9\u51fb\u4e0b\u65b9\u6309\u94ae\u9009\u62e9\u5e02\u573a\uFF0C\u7136\u540e\u9009 YES/NO \u518d\u9009\u4ef7\u683c\u91d1\u989d','\u6216\u76f4\u63a5\u8f93\u5165\uFF1A/paper open <\u5e02\u573aID> <yes|no> <\u4ef7\u683c> <\u91d1\u989d>'].join('\n');
          return telegramInlineReply(txt, buildPaperPickRows(chatId));
        }
        const market = getCachedPredictionRadarSlice('', 240)?.markets.find(item => String(item.id) === String(marketId));
        const pending = telegramCommandCenterStore.createPendingAction(chatId, {
          type: 'paper_open', marketId, outcomeIndex: outcomeIndex as 0 | 1,
          outcomeName: outcomeIndex === 0 ? 'YES' : 'NO', price, amountUsd,
        });
        return telegramPendingReply(`\u26a0\uFE0F \u8bf7\u786e\u8ba4\u6a21\u62df\u5f00\u4ed3\n\u5e02\u573a\uFF1A${escapeTelegramHtml(market?.titleZh || market?.title || `\u5e02\u573a ${marketId}`)}\n\u65b9\u5411\uFF1A${outcomeIndex === 0 ? 'YES' : 'NO'} \u00b7 \u4ef7\u683c ${price} \u00b7 \u91d1\u989D ${amountUsd}\n\n\u786e\u8ba4\u7801\uFF1A${pending.nonce}\uFF085\u5206\u949F\u6709\u6548\uFF09`, pending.nonce, chatId, 'prediction');
      }
      if (args[0] === 'close') {
        if (!['overview', 'prediction'].includes(currentScope)) return `当前为${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[currentScope])}市场，预测市场纸面平仓不能跨市场执行。`;
        const positionId = args[1] || '';
        const exitPrice = Number(args[2]);
        const position = paperEngine.getOpenPositions().find(item => item.id === positionId);
        if (!position || !Number.isFinite(exitPrice) || exitPrice <= 0 || exitPrice > 1) {
          const positions = paperEngine.getOpenPositions();
          if(!positions.length) return '<b>\u5f53\u524d\u6301\u4ed3</b>\n\u6682\u65e0\u5f00\u653e\u6301\u4ed3\u3002';
          const rows: TelegramInlineKeyboardButton[][] = positions.slice(0,6).map(p=>[{ text: `\u5e73\u4ed3 ${String(p.marketTitle).slice(0,12)}`, callback_data: telegramPaperCallback('paper:close:pick', String(p.id), chatId, 'prediction') }]);
          return telegramInlineReply('<b>\u9009\u62e9\u8981\u5e73\u4ed3\u7684\u6301\u4ed3</b>', rows);
        }
        const pending = telegramCommandCenterStore.createPendingAction(chatId, { type: 'paper_close', positionId, price: exitPrice });
        return telegramPendingReply(`\u26a0\uFE0F \u8bf7\u786e\u8ba4\u6a21\u62df\u5e73\u4ed3\n${escapeTelegramHtml(position.marketTitle)} \u00b7 ${escapeTelegramHtml(position.outcomeName)}\n\u4ef7\u683c\uFF1A${exitPrice}\n\n\u786e\u8ba4\u7801\uFF1A${pending.nonce}`, pending.nonce, chatId, 'prediction');
      }
      const portfolio = paperEngine.getPortfolio();
      const positions = paperEngine.getOpenPositions();
      const lines = positions.slice(0, 8).map(position => {
        const current = position.currentPrice ?? position.entryPrice;
        const pnl = (current - position.entryPrice) * position.quantity;
        return `\u00b7 ${escapeTelegramHtml(position.marketTitle)} | ${escapeTelegramHtml(position.outcomeName)} | ${pnl >= 0 ? '+' : ''}${formatTelegramNumber(pnl)}`;
      });
      const text = [
        '<b>\u6a21\u62df\u76d8</b>',
        `\u6743\u76ca\uFF1A${formatTelegramNumber(portfolio.equity)} \u00b7 \u73b0\u91d1\uFF1A${formatTelegramNumber(portfolio.cashBalance)}`,
        `\u6301\u4ed3\uFF1A${positions.length} \u00b7 \u603b\u76c8\u4e8f\uFF1A${portfolio.totalPnl >= 0 ? '+' : ''}${formatTelegramNumber(portfolio.totalPnl)}`,
        ...(lines.length ? ['', ...lines] : ['', '\u6682\u65e0\u5f00\u653e\u6a21\u62df\u6301\u4ed3\u3002']),
        '',
        '\u70b9\u51fb\u6309\u94ae\u5feb\u901f\u5f00\u4ed3\uFF0C\u6216\u8f93\u5165 /paper open \u547d\u4ee4\u3002',
      ].join('\n');
      const pickRows = buildPaperPickRows(chatId);
      const closeRows: TelegramInlineKeyboardButton[][] = positions.slice(0,4).map(p=>[{ text: `\u5e73\u4ed3 ${String(p.id).slice(0,8)}`, callback_data: telegramPaperCallback('paper:close:pick', String(p.id), chatId, 'prediction') }]);
      return telegramInlineReply(text, [...pickRows, ...closeRows]);
    },
    research: async ({ args }) => {
      const entries = listResearchEntries(6);
      if (!entries.length) return '<b>研究工作区</b>\n暂无研究条目。';
      if (args[0]) {
        const selected = getResearchEntry(args[0]) || entries[Number(args[0]) - 1];
        if (!selected) return '未找到该研究条目。发送 /research 查看列表。';
        const summary = summarizeResearchEntry(selected);
        return [
          `<b>研究详情</b> · ${escapeTelegramHtml(summary.title)}`,
          `状态：${escapeTelegramHtml(summary.status)} · 最新：${escapeTelegramHtml(summary.latestAt)}`,
          `市场概率：${summary.marketProbabilityPct == null ? '-' : `${summary.marketProbabilityPct}%`} · 模型概率：${summary.modelProbabilityPct == null ? '-' : `${summary.modelProbabilityPct}%`}`,
          `论点：${escapeTelegramHtml(selected.thesis || '未填写')}`,
          '',
          selected.notes.length ? '<b>最新笔记</b>' : '暂无研究笔记。',
          ...selected.notes.slice(0, 5).map(note => `· ${escapeTelegramHtml(note.text)}`),
        ].join('\n');
      }
      return [
        '<b>研究工作区</b>',
        ...entries.map((entry, index) => {
          const summary = summarizeResearchEntry(entry);
          const edge = summary.edgePct == null ? '-' : `${summary.edgePct >= 0 ? '+' : ''}${summary.edgePct.toFixed(1)}pp`;
          return `${index + 1}. ${escapeTelegramHtml(summary.title)} · ${escapeTelegramHtml(summary.status)} · edge ${edge} · /research ${index + 1}`;
        }),
        '',
        '研究条目来自本地工作区，需结合来源新鲜度自行判断。',
      ].join('\n');
    },
    ops: () => {
      const jobs = getAutomationJobs();
      const overview = getAutomationOverview();
      return [
        '<b>自动化任务</b>',
        `启用 ${overview.enabledJobs}/${overview.totalJobs} · 运行 ${overview.totalRuns} · 失败 ${overview.failedRuns}`,
        ...jobs.map(job => `· ${escapeTelegramHtml(job.nameZh)}：${escapeTelegramHtml(job.lastStatus)}（${escapeTelegramHtml(job.lastMessage)}）`),
        '',
        'Telegram 目前只读展示任务状态，不远程触发任务。',
      ].join('\n');
    },
    alerts: ({ chatId, args }) => {
      const key = String(args[0] || '').toLowerCase();
      const value = String(args[1] || '').toLowerCase();
      if (!key) return formatTelegramPreferences(chatId);
      if (key === 'pause') {
        const minutes = Math.max(1, Math.min(24 * 60, Number(args[1] || 60)));
        if (!Number.isFinite(minutes)) return '用法：/alerts pause &lt;分钟&gt;';
        const until = new Date(Date.now() + minutes * 60000).toISOString();
        telegramCommandCenterStore.updateAlertPolicy(chatId, { pausedUntil: until });
        telegramCommandCenterStore.recordAudit(chatId, 'alerts_pause', until);
        return '提醒已暂停至 ' + until;
      }
      if (key === 'resume') {
        telegramCommandCenterStore.updateAlertPolicy(chatId, { pausedUntil: undefined });
        telegramCommandCenterStore.recordAudit(chatId, 'alerts_resume', 'manual');
        return '✅ 提醒已恢复。\n\n' + formatTelegramPreferences(chatId);
      }
      if (key === 'quiet') {
        const enabled = value === 'on';
        if (!enabled && value !== 'off') return '用法：/alerts quiet on 22:00-07:00 或 /alerts quiet off';
        const range = String(args[2] || '').split('-');
        const currentQuiet = telegramCommandCenterStore.getAlertPolicy(chatId).quietHours;
        const start = range[0] ? parseDigestTime(range[0]) : currentQuiet.start;
        const end = range[1] ? parseDigestTime(range[1]) : currentQuiet.end;
        if (!start || !end) return '时间格式无效，用法：/alerts quiet on 22:00-07:00';
        telegramCommandCenterStore.updateAlertPolicy(chatId, { quietHours: { enabled, start, end } });
        telegramCommandCenterStore.recordAudit(chatId, 'alerts_quiet', enabled ? start + '-' + end : 'off');
        return '免打扰已' + (enabled ? '开启：' + start + '-' + end : '关闭') + '\n\n' + formatTelegramPreferences(chatId);
      }
      if (key === 'cooldown') {
        const minutes = Number(args[2]);
        if (!args[1] || !Number.isFinite(minutes) || minutes < 1 || minutes > 1440) return '用法：/alerts cooldown &lt;智能提醒ID&gt; &lt;分钟&gt;';
        const updated = telegramCommandCenterStore.updateSmartAlert(args[1], { cooldownMinutes: minutes });
        return updated ? '✅ 冷却时间已更新为 ' + updated.cooldownMinutes + ' 分钟。' : '未找到该智能提醒。';
      }
      if (!['on', 'off'].includes(value)) return '用法：/alerts signals|daily|risk|events|price|all on|off';
      const enabled = value === 'on';
      if (key === 'all') {
        settingsManager.update({ telegramEnabled: enabled });
        telegramCommandCenterStore.updatePreferences(chatId, { notifications: {
          signals: enabled, dailyReport: enabled, riskAlerts: enabled, events: enabled, priceAlerts: enabled,
        } });
      } else {
        const field = ({ signals: 'signals', daily: 'dailyReport', risk: 'riskAlerts', events: 'events', price: 'priceAlerts' } as Record<string, keyof ReturnType<typeof telegramCommandCenterStore.getPreferences>['notifications']>)[key];
        if (!field) return '用法：/alerts signals|daily|risk|events|price|all on|off';
        telegramCommandCenterStore.updatePreferences(chatId, { notifications: { [field]: enabled } });
      }
      telegramCommandCenterStore.recordAudit(chatId, 'alerts_update', `${key}=${value}`);
      return `已更新提醒设置：${key} ${value === 'on' ? '开启' : '关闭'}\n\n${formatTelegramPreferences(chatId)}`;
    },
    alert: async ({ chatId, args }) => {
      if (args[0] === 'off') {
        const removedPrice = args[1] ? telegramCommandCenterStore.removePriceAlert(chatId, args[1]) : false;
        const removedSmart = args[1] ? telegramCommandCenterStore.removeSmartAlert(chatId, args[1]) : false;
        return removedPrice || removedSmart ? '✅ 提醒已删除。' : '未找到该提醒。用 /alerts 查看提醒 ID。';
      }
      if (String(args[0] || '').toLowerCase() === 'draft') {
        const draftArgs = args.slice(1);
        const smartArgs = draftArgs[0]?.toLowerCase() === 'smart' ? draftArgs.slice(1) : draftArgs;
        const smart = parseSmartAlertArgs(smartArgs);
        const scope = telegramScopeForChat(chatId);
        let kind: 'smart' | 'price';
        let payload: any;
        let currentValue = '';
        if (smart) {
          const requiredScope = smart.type === 'PROBABILITY' ? 'prediction' : 'overview';
          if (scope !== requiredScope) return `该智能提醒只在${TELEGRAM_SCOPE_LABELS[requiredScope]}作用域创建；当前为${TELEGRAM_SCOPE_LABELS[scope]}。切换后重试 /alert draft smart ${smartArgs.join(' ')}。`;
          if (smart.type === 'PROBABILITY') {
            const radar = getCachedPredictionRadarSlice('',240);
            const match = radar?.markets.find(item => String(item.id) === smart.symbol || item.title.toLowerCase().includes(String(smart.symbol || '').toLowerCase()));
            if (!match) return '当前预测市场快照中找不到匹配事件，未创建提醒。请用事件ID或标题关键词后重试。';
            payload = { ...smart, symbol: String(match.id) };
            currentValue = `事件：${escapeTelegramHtml(match.title)} · 当前模型概率 ${formatTelegramNumber(match.modelProbability*100,1)}%`;
          } else payload = smart;
          kind = 'smart';
        } else {
          const parsed = parsePriceAlertArgs(smartArgs);
          if (!parsed) return '用法：/alert draft BTC above 120000\n智能提醒：/alert draft smart risk above 10 或 /alert draft smart event within 24；确认前不会启用。';
          if (scope !== 'crypto') return '价格提醒目前仅接入 Binance 虚拟币行情；请先 /market crypto。股票/期权不能套用加密币价格监控。';
          const quote = await binanceFeed.getPrice(parsed.symbol);
          if (!quote) return `Binance 当前无法验证 ${escapeTelegramHtml(parsed.symbol)} 行情，未创建提醒。`;
          kind = 'price'; payload = parsed;
          currentValue = `当前价：${formatTelegramNumber(quote.price, quote.price >= 1 ? 4 : 8)} USDT`;
        }
        const draftId = crypto.randomBytes(8).toString('base64url');
        stateStore.set(`telegram-alert-draft:${chatId}`, { draftId, scope, kind, payload, expiresAt: Date.now()+5*60_000 });
        const description = kind === 'price'
          ? `${escapeTelegramHtml(payload.symbol)} ${payload.direction==='ABOVE'?'≥':'≤'} ${formatTelegramNumber(payload.price,8)}`
          : escapeTelegramHtml(telegramAlertDescription(payload));
        const keyboard = [[
          { text:'✅ 确认创建', callback_data:issueTelegramCallback('alert:handle',{scope,id:JSON.stringify(['confirm',draftId]),workspace:'alerts',chatId}) },
          { text:'取消', callback_data:issueTelegramCallback('alert:handle',{scope,id:JSON.stringify(['cancel',draftId]),workspace:'alerts',chatId}) },
        ]];
        return telegramInlineReply(`<b>提醒创建预览</b>\n${description}\n${currentValue}\n有效期：5 分钟\n确认后才会启用；真实交易不会执行。`,keyboard);
      }
      const smartArgs = args[0] === 'smart' ? args.slice(1) : args;
      const smart = parseSmartAlertArgs(smartArgs);
      if (smart) {
        const scope=telegramScopeForChat(chatId);
        const requiredScope=smart.type==='PROBABILITY'?'prediction':'overview';
        if(scope!==requiredScope)return `该智能提醒只在${TELEGRAM_SCOPE_LABELS[requiredScope]}作用域创建；当前为${TELEGRAM_SCOPE_LABELS[scope]}。`;
        let scopedSmart:any=smart;
        if(smart.type==='PROBABILITY'){
          const radar=getCachedPredictionRadarSlice('',240),match=radar?.markets.find(item=>String(item.id)===smart.symbol||item.title.toLowerCase().includes(String(smart.symbol||'').toLowerCase()));
          if(!match)return '当前预测市场快照中找不到匹配事件，未创建提醒。';
          scopedSmart={...smart,symbol:String(match.id)};
        }
        const created = telegramCommandCenterStore.createSmartAlert(chatId, scopedSmart);
        telegramCommandCenterStore.updatePreferences(chatId, { notifications: { riskAlerts: true, events: true, signals: true } });
        telegramCommandCenterStore.recordAudit(chatId, 'smart_alert_create', telegramAlertDescription(created));
        return '✅ 已创建智能提醒：' + telegramAlertDescription(created) + '\n提醒 ID：' + created.id + '\n冷却：' + created.cooldownMinutes + ' 分钟';
      }
      const parsed = parsePriceAlertArgs(args);
      if (!parsed) return '用法：/alert BTC above 120000\n预览确认：/alert draft BTC above 120000\n智能提醒：/alert draft smart risk above 10 或 /alert draft smart event within 24\n删除：/alert off &lt;提醒ID&gt;';
      if(telegramScopeForChat(chatId)!=='crypto')return '价格提醒目前只支持当前虚拟币市场的 Binance 行情；请先 /market crypto。股票/期权不能复用加密币价格提醒。';
      if(!await binanceFeed.getPrice(parsed.symbol))return `Binance 暂无 ${escapeTelegramHtml(parsed.symbol)} 行情，未创建价格提醒。`;
      const created = telegramCommandCenterStore.createPriceAlert(chatId, parsed);
      telegramCommandCenterStore.updatePreferences(chatId, { notifications: { priceAlerts: true } });
      telegramCommandCenterStore.recordAudit(chatId, 'price_alert_create', `${created.symbol} ${created.direction} ${created.price}`);
      return `✅ 已创建价格提醒：${created.symbol} ${created.direction === 'ABOVE' ? '≥' : '≤'} ${created.price}\n提醒 ID：${created.id}`;
    },
    confirm: ({ chatId, args }) => {
      const pending = args[0] ? telegramCommandCenterStore.consumePendingAction(chatId, args[0]) : null;
      if (!pending) return '确认码不存在、已使用或已过期。请重新发送模拟盘操作。';
      if (pending.type === 'unified_paper_order') {
        if (!pending.instrumentId || !pending.instrumentType || !pending.side || !Number.isFinite(Number(pending.price)) || !Number.isFinite(Number(pending.quantity))) return '纸面订单数据不完整，已拒绝执行。';
        try {
          const ledger = unifiedPaperLedgerStore.apply({
            instrumentId: pending.instrumentId,
            instrumentType: pending.instrumentType,
            title: pending.instrumentTitle || pending.instrumentId,
            side: pending.side,
            price: Number(pending.price),
            quantity: Number(pending.quantity),
            timestamp: new Date().toISOString(),
            reason: 'Telegram 二次确认',
          });
          telegramCommandCenterStore.recordAudit(chatId, 'unified_paper_order_confirm', `${pending.instrumentId}:${pending.side}`);
          return `✅ 纸面订单已提交：${escapeTelegramHtml(pending.instrumentId)} · ${pending.side} · 数量 ${formatTelegramNumber(Number(pending.quantity), 8)} · 价格 ${formatTelegramNumber(Number(pending.price), 8)}\n当前权益：$${formatTelegramNumber(calculateUnifiedPerformance(ledger).equity)}`;
        } catch (error: any) {
          return `❌ 纸面订单未成交：${escapeTelegramHtml(error?.message || '模拟撮合失败')}`;
        }
      }
      if (pending.type === 'paper_open') {
        const result = paperEngine.openPosition(
          pending.marketId || 0,
          getCachedPredictionRadarSlice('', 240)?.markets.find(item => String(item.id) === String(pending.marketId))?.titleZh || `市场 ${pending.marketId}`,
          pending.outcomeIndex || 0,
          pending.outcomeName || 'YES', pending.price || 0, pending.amountUsd || 0, 'Telegram 二次确认',
        );
        telegramCommandCenterStore.recordAudit(chatId, 'paper_open_confirm', result.message);
        return result.success ? `✅ ${escapeTelegramHtml(result.message)}` : `❌ ${escapeTelegramHtml(result.message)}`;
      }
      if (pending.type === 'paper_reset') {
        const portfolio = paperEngine.reset();
        telegramCommandCenterStore.recordAudit(chatId, 'paper_reset_confirm', 'startingBalance=' + portfolio.startingBalance);
        return '✅ 模拟账户已重置。初始余额：$' + formatTelegramNumber(portfolio.startingBalance) + '。';
      }
      const result = paperEngine.closePosition(pending.positionId || '', pending.price || 0);
      telegramCommandCenterStore.recordAudit(chatId, 'paper_close_confirm', result.message);
      return result.success ? `✅ ${escapeTelegramHtml(result.message)}` : `❌ ${escapeTelegramHtml(result.message)}`;
    },
    cancel: ({ chatId }) => {
      const cancelled = telegramCommandCenterStore.cancelPendingAction(chatId);
      return cancelled ? '已取消待确认的模拟盘操作。' : '当前没有待确认操作。';
    },
    strategies: ({ chatId, args }) => {
      const action = String(args[0] || 'list').toLowerCase();
      const targetId = String(args[1] || '');
      if (action === 'pause' && targetId) {
        const runner = pauseAiRunner(targetId, 'Telegram 手动暂停');
        return runner ? `✅ 已暂停策略：${escapeTelegramHtml(runner.title)}` : '未找到策略。';
      }
      if (action === 'resume' && targetId) {
        const runner = resumeAiRunner(targetId);
        return runner ? `✅ 已恢复策略：${escapeTelegramHtml(runner.title)}` : '未找到策略，或仍处于熔断状态。';
      }
      if (action === 'reset-circuit' && targetId) {
        const runner = resetAiRunnerCircuit(targetId);
        return runner ? `✅ 已清除策略熔断标记，当前保持停止：${escapeTelegramHtml(runner.title)}` : '未找到策略。';
      }
      if (action === 'start') {
        if (!config.aiPaperTradingEnabled) return 'AI 自动纸面交易当前关闭，可设置 AI_PAPER_TRADING_ENABLED=true 启用模拟能力。';
        const venue = String(args[1] || '') as 'Binance' | 'Predict.fun' | 'Stocks';
        const symbol = String(args[2] || '');
        const budget = Number(args[3]);
        if (!['Binance', 'Predict.fun', 'Stocks'].includes(venue) || !symbol || !Number.isFinite(budget) || budget < 1) return '用法：/strategies start [Stocks|Binance|Predict.fun] [代码] [预算] (例如: /strategies start Stocks AAPL 100)';
        const runner = createAiRunner(venue, symbol, symbol, budget);
        telegramCommandCenterStore.recordAudit(chatId, 'strategies_start', runner.id + ':' + venue + ':' + symbol);
        return `✅ 已启动 AI 纸面策略：${escapeTelegramHtml(runner.id)}
标的：${escapeTelegramHtml(runner.symbolOrMarketId)} · 预算：$${formatTelegramNumber(runner.budgetUsd)}
暂停：/strategies pause ${escapeTelegramHtml(runner.id)}`;
      }
      const runners = getAiRunners();
      if (!runners.length) return '<b>AI 模拟策略</b>\n暂无策略账户。可在网页面板创建。';
      return [
        '<b>AI 模拟策略</b>',
        ...runners.slice(0, 8).map(runner => {
          const summary = summarizeRunner(runner);
          return `· ${escapeTelegramHtml(runner.title)} · ${runner.status} · 权益 $${formatTelegramNumber(summary.equityUsd)} · PnL ${summary.totalPnlUsd >= 0 ? '+' : ''}$${formatTelegramNumber(summary.totalPnlUsd)}\n  限额：单笔 $${formatTelegramNumber(runner.policy.maxTradeUsd)} · 持仓 ${runner.policy.maxPositions} · 日损 $${formatTelegramNumber(runner.policy.maxDailyLossUsd)}${runner.circuitBreakerReason ? `\n  熔断：${escapeTelegramHtml(runner.circuitBreakerReason)}` : ''}`;
        }),
        '',
        '启动：/strategies start [Stocks|Binance|Predict.fun] [代码] [预算]\n暂停：/strategies pause <策略ID>\n恢复：/strategies resume <策略ID>\n清除熔断：/strategies reset-circuit <策略ID>',
      ].join('\n');
    },
    ask: ({ chatId, args, message, update }) => {
      const input = args.join(' ');
      const route = routeNaturalLanguage(input);
      if (!route) return '我目前支持：风险、信号、事件、持仓、研究、数据源、今日总览、提醒、历史、待确认、模拟盘。\n例如：/ask 看一下风险 或 /ask 我的持仓 或 /ask 待确认';
      const handler = rawHandlers[route];
      return handler ? handler({ chatId, command: route, args: [], message, update }) : '暂不支持该查询。';
    },
    chart: async ({ args, chatId }) => {
      const query = String(args[0] || '').trim();
      if (query) {
        const timeframe = String(args[1] || (telegramScopeForChat(chatId) === 'crypto' ? '1h' : '1d')).toLowerCase();
        const tradingDate = String(args[2] || '').trim();
        const candidates = await telegramQuickCandidates(query, telegramScopeForChat(chatId));
        if (candidates.length !== 1) return candidates.length ? telegramQuickCandidateReply(query, candidates, chatId) : `未找到“${escapeTelegramHtml(query)}”，无法打开K线。`;
        const ref = candidates[0];
        const scope = telegramInstrumentScope(ref.type);
        telegramCommandCenterStore.setActiveMarketScope(chatId, scope);
        telegramCommandCenterStore.updateSession(chatId, { marketScope: scope, workspace: ref.type === 'crypto' ? 'crypto-quotes' : 'stock-quotes', instrumentId: ref.id, timeframe });
        const link = buildTelegramDeepLink(telegramPublicBaseUrl(), { market: scope, instrument: ref.id, workspace: ref.type === 'crypto' ? 'crypto-quotes' : 'stock-quotes', timeframe, focusDate: tradingDate || undefined });
        if (ref.type !== 'stock' && !(ref.type === 'crypto' && ref.venue === 'binance')) return '当前标的没有已接入的真实K线图片来源；期权链和预测概率不能冒充股票K线。' + (link ? '\n详情：' + escapeTelegramHtml(link) : '');
        const stockPeriods = ['1m', '5m', '15m', '1h', '1d'];
        const cryptoPeriods = ['1m', '5m', '15m', '1h', '4h', '1d'];
        const supported = ref.type === 'stock' ? stockPeriods : cryptoPeriods;
        if (!supported.includes(timeframe)) return `该市场不支持周期 ${escapeTelegramHtml(timeframe)}；可选：${supported.join('、')}。`;
        if (tradingDate && !/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) return '日期格式必须为 YYYY-MM-DD。';
        try {
          let source = '', dataStatus = '', updatedAt = '', bars: Array<{time:number;open:number;high:number;low:number;close:number;volume:number}> = [];
          let dateBars: Array<{time:number;open:number;high:number;low:number;close:number;volume:number}> = [];
          if (ref.type === 'stock') {
            const snapshot = await getStockKlineAdapter(timeframe, ref.symbol).fetch({ symbol: ref.symbol, period: timeframe });
            source = snapshot.source; dataStatus = snapshot.status; updatedAt = snapshot.fetchedAt;
            if (!snapshot.data?.length) return `股票K线来源不可用：${escapeTelegramHtml(snapshot.error || '来源没有返回K线')} · ${escapeTelegramHtml(source)} · ${escapeTelegramHtml(dataStatus)}`;
            bars = snapshot.data;
            if (tradingDate) bars = filterStockBarsForTradingDate(bars, tradingDate, resolveStockExchangeTimeZone(ref.symbol)).bars;
            if (timeframe !== '1d') {
              const daily = await getStockKlineAdapter('1d', ref.symbol).fetch({ symbol: ref.symbol, period: '1d' });
              dateBars = daily.data || [];
            } else dateBars = bars;
          } else {
            if(tradingDate){
              const startTime=Date.parse(`${tradingDate}T00:00:00.000Z`),endTime=startTime+86_399_999;
              const snapshot=await getTelegramCryptoKlineAdapter(timeframe,ref.symbol,tradingDate).fetch({symbol:ref.symbol,period:timeframe,limit:1000,startTime,endTime});
              source=snapshot.source;dataStatus=snapshot.status==='live'?'delayed':snapshot.status==='stale'?'cached':'unavailable';updatedAt=snapshot.fetchedAt;
              bars=(snapshot.data||[]).map((bar:any)=>({time:Number(bar.time),open:Number(bar.open),high:Number(bar.high),low:Number(bar.low),close:Number(bar.close),volume:Number(bar.volume||0)})).filter(bar=>new Date(bar.time).toISOString().slice(0,10)===tradingDate);
              if(!bars.length && snapshot.error)return `Binance 日内K线不可用：${escapeTelegramHtml(snapshot.error)} · ${escapeTelegramHtml(source)}`;
            } else {
              bars = (await binanceFeed.getKlines(ref.symbol, timeframe, 200)).map((bar:any) => ({ time:Number(bar.time),open:Number(bar.open),high:Number(bar.high),low:Number(bar.low),close:Number(bar.close),volume:Number(bar.volume || 0) }));
              source = 'Binance Public Klines'; dataStatus = bars.length ? 'delayed' : 'unavailable'; updatedAt = binanceFeed.klineCachedAt(ref.symbol,timeframe,200) || '';
            }
            dateBars = timeframe === '1d' && !tradingDate ? bars : (await binanceFeed.getKlines(ref.symbol,'1d',30)).map((bar:any) => ({time:Number(bar.time),open:Number(bar.open),high:Number(bar.high),low:Number(bar.low),close:Number(bar.close),volume:Number(bar.volume||0)}));
          }
          if (!bars.length) return `所选日期/周期暂无真实K线：${escapeTelegramHtml(tradingDate || timeframe)}。来源：${escapeTelegramHtml(source)}；数据覆盖范围以来源实际返回为准，未生成替代数据。`;
          const chartBars = bars.slice(-80);
          const image = renderTelegramKline(chartBars);
          const overlays = chartAnalysis.buildChartOverlays({ bars: chartBars, config: { signals:false,patterns:true,structures:false,volume:false,indicators:{ma:false,boll:false,macd:false} }, signals:[] });
          const periodLabel:Record<string,string> = {'1m':'1分','5m':'5分','15m':'15分','1h':'1小时','4h':'4小时','1d':'日线'};
          const last = chartBars[chartBars.length - 1];
          const zone = ref.type === 'stock' ? resolveStockExchangeTimeZone(ref.symbol) : 'UTC';
          const formatDate = (time:number) => new Intl.DateTimeFormat('zh-CN',{timeZone:zone,month:'2-digit',day:'2-digit'}).format(new Date(time));
          const dates = [...new Set(dateBars.map(bar => new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(bar.time))))].slice(-4);
          const annotations = overlays.patterns.slice(-5).reverse().map((pattern:any) => {
            const time = Number(pattern.time);
            return `· ${escapeTelegramHtml(pattern.label)} ${Number.isFinite(time) ? formatDate(time) : ''} · OHLC ${pattern.open}/${pattern.high}/${pattern.low}/${pattern.close}\n  ${escapeTelegramHtml(pattern.meaning)} · 置信度 ${escapeTelegramHtml(String(pattern.confidence || '未评估'))}`;
          });
          const link = buildTelegramDeepLink(telegramPublicBaseUrl(), { market: scope, instrument: ref.id, workspace: ref.type === 'crypto' ? 'crypto-quotes' : 'stock-quotes', timeframe, focusDate: tradingDate || undefined });
          const text = `<b>📈 ${escapeTelegramHtml(ref.title)}</b> · ${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[scope])}\n周期：${periodLabel[timeframe]} · ${tradingDate ? '交易日 '+tradingDate+' · '+zone : `最近 ${chartBars.length} 根`}\nMA5（橙）：${image.ma5?.toFixed(4) ?? '不足5根'} · MA10（紫）：${image.ma10?.toFixed(4) ?? '不足10根'} · MA20（蓝）：${image.ma20?.toFixed(4) ?? '不足20根'}\n最新 OHLC：${last.open}/${last.high}/${last.low}/${last.close}\n数据时间：${escapeTelegramHtml(new Date(last.time).toISOString())} · 抓取：${escapeTelegramHtml(updatedAt)}\n来源：${escapeTelegramHtml(source)} · 状态：${escapeTelegramHtml(dataStatus)}${tradingDate && timeframe!=='1d' ? `\n日期内时间：${formatDate(last.time)} · ${zone}` : ''}\n${annotations.length ? '<b>近期蜡烛形态</b>\n'+annotations.join('\n') : '近期未识别到已确认蜡烛形态。'}\n图片仅用于研究，不构成交易指令。`;
          const periodButtons = supported.map(interval => ({ text: periodLabel[interval], callback_data: issueTelegramCallback('chart:period',{scope,id:JSON.stringify([ref.id,interval,tradingDate]),workspace:'chart',timeframe:interval,chatId}) }));
          const rows: TelegramInlineKeyboardButton[][] = [];
          for(let index=0;index<periodButtons.length;index+=3) rows.push(periodButtons.slice(index,index+3));
          if (dateBars.length) rows.push(dates.map(date => ({text:`${date}${date===tradingDate?' ✓':''}`,callback_data:issueTelegramCallback('chart:period',{scope,id:JSON.stringify([ref.id,ref.type==='stock'?'5m':'1h',date]),workspace:'chart',timeframe:ref.type==='stock'?'5m':'1h',chatId})})));
          if(link) rows.push([{text:'全屏 / Replay',url:link}]);
          return { text, photo:image.png, replyMarkup:{inline_keyboard:rows} };
        } catch (error:any) { return `真实K线数据不足或来源不可用，未生成图片。原因：${escapeTelegramHtml(error?.message || '请求失败')}。请稍后重试 /chart ${escapeTelegramHtml(query)}`; }
      }
      const history = getRiskHistory(72);
      return `<b>风险趋势</b>\n${sparkline(history.points.map(point => point.riskScore))}\n${escapeTelegramHtml(history.trend.headlineZh)}\n${escapeTelegramHtml(history.trend.detailZh)}`;
    },
    replay: async ({ args, chatId }) => {
      const query = args.join(' ').trim();
      if (!query) return '用法：/replay <代码或InstrumentRef>，例如 /replay stock:us:AAPL 或 /replay BTCUSDT';
      const candidates = await telegramQuickCandidates(query, telegramScopeForChat(chatId));
      if (candidates.length !== 1) return candidates.length ? telegramQuickCandidateReply(query, candidates, chatId) : `未找到“${escapeTelegramHtml(query)}”，无法打开回放。`;
      const ref = candidates[0];
      const scope = telegramInstrumentScope(ref.type);
      telegramCommandCenterStore.setActiveMarketScope(chatId, scope);
      const link = telegramQuickDeepLink(ref, ref.type === 'crypto' ? 'crypto-quotes' : ref.type === 'prediction' ? 'prediction-radar' : ref.type === 'option' ? 'option-chain' : 'stock-quotes');
      if (!link) return '尚未配置可从手机打开的公共网页地址。请设置 MONEYMONEY_PUBLIC_URL 后重试。';
      const replayUrl = new URL(link);
      replayUrl.searchParams.set('replay', '1');
      return telegramInlineReply(`<b>⏯ K线回放</b>\n${escapeTelegramHtml(ref.title)}\n市场：${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[scope])}\n已同步当前市场作用域。`, [[{ text: '打开回放', url: replayUrl.toString() }]]);
    },
    audit: ({ chatId }) => {
      if (!isTelegramAdmin(chatId)) return '无权限查看审计记录。';
      const entries = telegramCommandCenterStore.listAudits(undefined, 12);
      return entries.length
        ? ['<b>最近操作审计</b>', ...entries.map(item => `· ${escapeTelegramHtml(item.at.slice(0, 19))} · chat ${escapeTelegramHtml(item.chatId)} · ${escapeTelegramHtml(item.action)} · ${escapeTelegramHtml(item.detail)}`)].join('\n')
        : '<b>最近操作审计</b>\n暂无记录。';
    },
    whoami: ({ chatId }) => `当前 Chat ID：<code>${escapeTelegramHtml(chatId)}</code>\n已在允许列表中。`,
    web: () => {
      const publicUrl = telegramPublicBaseUrl();
      return publicUrl
        ? `网页面板：${escapeTelegramHtml(publicUrl)}\n已使用部署环境配置的公共地址。`
        : '尚未配置可从手机打开的公共网页地址。请设置 MONEYMONEY_PUBLIC_URL（仅允许 http/https，不能是 localhost），再发送 /web。';
    },
    daily: async ({ chatId }) => buildTelegramDigest(chatId),
    eventresults: ({ chatId }) => {
      const rows = telegramEventResults.history(chatId).slice(-10).reverse();
      if (!rows.length) return '暂无事件结果投递记录；高影响事件结束后会继续查询，缺少实际值时说明来源原因。';
      const text='<b>事件结果通知记录</b>\n'+rows.map(row=>`${escapeTelegramHtml(row.event.titleZh || row.event.title)} · ${escapeTelegramHtml(row.event.date)}\n${({sent:'已发送',pending:'待发送/重试',failed:'发送失败',acknowledged:'已确认'})[row.status]} · 尝试 ${row.attempts} 次${row.error ? ' · '+escapeTelegramHtml(row.error):''}`).join('\n\n');
      const buttons=rows.map(row=>{
        const actions: Array<'ack'|'retry'> = row.status==='failed'||row.status==='pending' ? ['retry'] : row.status==='acknowledged' ? [] : ['ack'];
        return actions.map(action=>({text:action==='ack'?'确认已读':'重试',callback_data:issueTelegramCallback('event-result:handle',{scope:telegramScopeForChat(chatId),id:JSON.stringify([action,row.id]),workspace:'events',chatId})}));
      }).filter(row=>row.length);
      return buttons.length ? telegramInlineReply(text,buttons):text;
    },
    inbox: ({chatId}) => {
      const rows=researchRepository.listAlertDeliveries(200).filter((item:any)=>item.payload?.chatId===chatId).slice(0,12);
      if(!rows.length) return '收件箱暂无提醒记录。';
      const text=['<b>提醒收件箱</b>',...rows.map((row:any)=>`${escapeTelegramHtml(row.id)} · ${escapeTelegramHtml(row.context.market)} · ${escapeTelegramHtml(row.status)}\n${escapeTelegramHtml(row.payload?.message || '提醒内容不可用')}${row.lastError ? '\n原因：'+escapeTelegramHtml(row.lastError):''}`)].join('\n\n');
      const buttons=rows.map((row:any)=>{
        const actions=row.status==='failed'||row.status==='queued' ? ['retry'] : row.status==='sent' ? ['ack']:[];
        return actions.map((action:string)=>({text:action==='retry'?'重试':'确认',callback_data:issueTelegramCallback('delivery:handle',{scope:row.context.market==='stocks'?'stocks':row.context.market==='options'?'options':row.context.market==='crypto'?'crypto':'prediction',id:JSON.stringify([action,row.id]),workspace:'alerts',chatId})}));
      }).filter((row:any[])=>row.length);
      return buttons.length ? telegramInlineReply(text,buttons):text;
    },
    delivery: async ({chatId,args})=>{
      const action=String(args[0]||'').toLowerCase(),id=String(args[1]||'');
      const item=researchRepository.getAlertDelivery(id);
      if(!item || item.payload?.chatId!==chatId) return '未找到属于当前私聊的投递记录。';
      if(action==='ack') {const updated=researchRepository.updateAlertDeliveryStatus(id,'acknowledged',new Date().toISOString());return updated?'✅ 已确认该提醒。':'提醒记录不存在。';}
      if(action==='retry') {
        try { const queued=researchRepository.retryAlertDelivery(id);if(!queued?.payload?.chatId || !telegramInteractionBot) return 'Telegram 暂不可用，投递保留在队列中。';
          await telegramInteractionBot.sendToChat(chatId,telegramReply(escapeTelegramHtml(queued.payload.message||'MoneyMoney 提醒')));
          researchRepository.saveAlertDelivery({...queued,status:'sent',deliveredAt:new Date().toISOString(),lastError:undefined});return '✅ 提醒已重试并发送。';
        } catch(error:any) {return '重试失败：'+escapeTelegramHtml(error?.message||'投递失败');}
      }
      return '用法：/delivery retry <ID> 或 /delivery ack <ID>。';
    },
    test: () => '✅ 交互机器人回复链路正常。',
  };
  const handlers: Record<string, TelegramCommandHandler> = {};
  for (const [command, handler] of Object.entries(rawHandlers)) {
    handlers[command] = async (context) => {
      const result = await handler(context);
      if (typeof result !== 'string') return result;
      if (command === 'tasks') {
        const scope = telegramScopeForChat(context.chatId);
        const id = context.args.length>1 ? context.args[1]:context.args[0];
        const job = id ? researchRepository.getJob(id):null;
        if (job && (['overview','watchlist'].includes(scope) || job.market===scope)) {
          const operations = ['events','artifact',...(['queued','running','paused'].includes(job.status) ? [job.status==='paused'?'resume':'cancel']:[])];
          return telegramInlineReply(result,[operations.map(action=>({text:({events:'进度',artifact:'证据包',resume:'恢复',cancel:'取消'} as Record<string,string>)[action],callback_data:issueTelegramCallback('task:handle',{scope,id:JSON.stringify([action,job.id]),workspace:'research',chatId:context.chatId})}))]);
        }
      }
      return telegramReply(result);
    };
  }
  return handlers;
}

function getTelegramCallbackHandlers(commandHandlers: Record<string, TelegramCommandHandler>): Record<string, TelegramCallbackHandler> {
  const mapping: Record<string, string> = {
    'menu:home': 'help',
    'view:status': 'status',
    'view:risk': 'risk',
    'view:signals': 'signals',
    'view:paper': 'paper',
    'view:research': 'research',
    'view:ops': 'ops',
    'action:test': 'test',
    'action:refresh': 'help',
  };
  const handlers: Record<string, TelegramCallbackHandler> = {};
  for (const [callbackData, command] of Object.entries(mapping)) {
    handlers[callbackData] = async (context) => commandHandlers[command]({
      chatId: context.chatId,
      command,
      args: [],
      message: context.message,
      update: context.update,
    });
  }
  handlers['telegram-test:ack:'] = async ({ chatId, data }) => {
    const record = consumeTelegramCallback(data, 'telegram-test:ack', chatId);
    if (!record || record.workspace !== 'telegram-test' || record.scope !== telegramScopeForChat(chatId)) return telegramReply('验收按钮已过期或私聊上下文已变化；请从网页重新发起一次测试。');
    const result = acknowledgeTelegramTestDelivery(stateStore, record.id, chatId);
    if (result.status === 'acknowledged' || result.status === 'duplicate') return undefined;
    return telegramReply('验收确认未通过：' + escapeTelegramHtml(result.reason));
  };
  for (const button of getTelegramMarketButtons()) {
    handlers[`market:${button.scope}`] = async (context) => commandHandlers.market({
      chatId: context.chatId,
      command: 'market',
      args: [button.scope],
      message: context.message,
      update: context.update,
    });
  }
  return handlers;
}

function startTelegramInteractionBot(): void {
  const telegramConfig = getRuntimeTelegramConfig();
  if (!telegramConfig.pollingEnabled) return;
  const allowedChatIds = new Set(parseChatIds(telegramConfig.allowedChatIds, telegramConfig.chatId));
  if (!telegramConfig.botToken || allowedChatIds.size === 0) {
    console.warn('  [telegram] polling enabled but token or allowed Chat ID is missing');
    return;
  }
  const commandHandlers = getTelegramCommandHandlers();
  const textHandlers: Record<string, TelegramCommandHandler> = {};
  for (const [label, command] of Object.entries(TELEGRAM_MENU_COMMANDS)) {
    textHandlers[label] = commandHandlers[command];
  }
  for (const button of getTelegramMarketButtons()) {
    textHandlers[button.text] = async (context) => commandHandlers.market({ ...context, command: 'market', args: [button.scope] });
  }
  for (const scope of MARKET_SCOPES) {
    for (const entry of getTelegramMenuEntries(scope)) {
      const handler = commandHandlers[entry.command];
      if (handler) textHandlers[entry.text] = handler;
    }
  }
  telegramInteractionBot = new TelegramInteractionBot({
    token: telegramConfig.botToken,
    proxyUrl: telegramConfig.proxyUrl,
    allowedChatIds,
    pollLease: stateStore,
    pollStateStore: stateStore,
    pollLeaseKey: 'telegram:getUpdates',
    handlers: commandHandlers,
    textHandlers,
    textFallback: async (context) => {
      const text = String(context.message.text || '').trim();
      if (!isTelegramBareSymbol(text)) return undefined;
      return commandHandlers.quick({ ...context, command: 'quick', args: [text] });
    },
    callbackHandlers: getTelegramCallbackHandlers(commandHandlers),
    menuScope: chatId => telegramCommandCenterStore.getActiveMarketScope(chatId),
    unknownCallbackHandler: async (ctx: any) => {
      const data = String(ctx?.data || '');
      if (data.startsWith('action:handle:')) {
        const record = consumeTelegramCallback(data, 'action:handle', ctx.chatId);
        if (!record || record.workspace !== 'action-center' || record.scope !== telegramScopeForChat(ctx.chatId)) return telegramReply('条目按钮已过期或市场已切换，请刷新 /actioncenter。');
        const saved = stateStore.get<{at:string;scope:string;items:ActionCenterItem[]}>(`action-center:telegram:${ctx.chatId}`);
        if (!saved || saved.scope !== record.scope || Date.now()-Date.parse(saved.at)>15*60000) return telegramReply('条目已过期，请刷新 /actioncenter。');
        let action: string, itemId: string;
        try { [action,itemId] = JSON.parse(record.id); } catch { return telegramReply('无效条目按钮。'); }
        const item = saved.items.find(item => item.id === itemId);
        if (!item || !['read','pin','later'].includes(action)) return telegramReply('该条目已变化，请刷新。');
        actionCenterStore.update('admin',item,action==='read' ? {read:true}:action==='pin' ? {pinned:true}:{snoozedUntil:new Date(Date.now()+86400000).toISOString()});
        return telegramReply('✅ 已同步网页处理状态：'+escapeTelegramHtml(item.title));
      }
      if(data.startsWith('stock-signal:handle:')) {
        const record=consumeTelegramCallback(data,'stock-signal:handle',ctx.chatId);
        if(!record || record.workspace!=='signals' || record.scope!=='stocks' || telegramScopeForChat(ctx.chatId)!=='stocks')return telegramReply('股票信号按钮已过期或市场已切换。');
        let payload;try{payload=JSON.parse(record.id);}catch{return telegramReply('信号按钮无效。');}
        if(!Array.isArray(payload.args) || payload.args.length>4 || !payload.args.every((arg:unknown)=>typeof arg==='string') || telegramStockSignalScanner.get(ctx.chatId)?.id!==payload.scanId)return telegramReply('扫描结果已更新，请重新发送 /signals。');
        return commandHandlers.signals({chatId:ctx.chatId,command:'signals',args:payload.args,message:ctx.message,update:ctx.update});
      }
      if (data.startsWith('task:handle:')) {
        const record = consumeTelegramCallback(data, 'task:handle', ctx.chatId);
        if (!record || record.workspace !== 'research' || record.scope !== telegramScopeForChat(ctx.chatId)) return telegramReply('任务按钮已过期或市场已切换。');
        let args: string[]; try { args = JSON.parse(record.id); } catch { return telegramReply('任务按钮无效。'); }
        if (!Array.isArray(args) || args.length>2 || !args.every(item=>typeof item==='string')) return telegramReply('任务按钮无效。');
        return commandHandlers.tasks({chatId:ctx.chatId,command:'tasks',args,message:ctx.message,update:ctx.update});
      }
      if (data.startsWith('event-result:handle:')) {
        const record = consumeTelegramCallback(data,'event-result:handle',ctx.chatId);
        if (!record || record.workspace !== 'events' || record.scope !== telegramScopeForChat(ctx.chatId)) return telegramReply('事件结果按钮已过期或市场已切换，请刷新 /eventresults。');
        let action:string,id:string; try { [action,id] = JSON.parse(record.id); } catch { return telegramReply('事件结果按钮无效。'); }
        if (!['ack','retry'].includes(action) || !telegramEventResults.update(ctx.chatId,id,action as 'ack'|'retry')) return telegramReply('该结果当前不能确认或重试；请刷新 /eventresults。');
        if (action === 'ack') return telegramReply('✅ 已确认这条事件结果通知。');
        const history=telegramEventResults.history(ctx.chatId);
        await telegramEventResults.run(ctx.chatId,history.map(row=>row.event),async (text,originalMessageId)=>{if(!telegramInteractionBot)throw new Error('Telegram 暂不可用');return telegramInteractionBot.sendToChat(ctx.chatId,{...telegramReply(text),replyToMessageId:originalMessageId});});
        const current=telegramEventResults.history(ctx.chatId).find(row=>row.id===id);
        return telegramReply(current?.status==='sent' ? '✅ 事件结果已重新发送。' : '已加入事件结果重试队列；来源暂不可用时不会编造结果。');
      }
      if (data.startsWith('delivery:handle:')) {
        const record=consumeTelegramCallback(data,'delivery:handle',ctx.chatId);
        if(!record || record.workspace!=='alerts') return telegramReply('提醒按钮无效或已过期，请刷新 /inbox。');
        let action:string,id:string;try{[action,id]=JSON.parse(record.id);}catch{return telegramReply('提醒按钮无效。');}
        const delivery=researchRepository.getAlertDelivery(id);
        const expectedScope=delivery?.context.market==='stocks'?'stocks':delivery?.context.market==='options'?'options':delivery?.context.market==='crypto'?'crypto':delivery?.context.market==='prediction'?'prediction':null;
        if(!delivery || delivery.payload?.chatId!==ctx.chatId || expectedScope!==record.scope || !['ack','retry'].includes(action)) return telegramReply('该投递不属于当前私聊或市场上下文不匹配，已拒绝操作。');
        return commandHandlers.delivery({chatId:ctx.chatId,command:'delivery',args:[action,id],message:ctx.message,update:ctx.update});
      }
      if (data.startsWith('alert:handle:')) {
        const record=consumeTelegramCallback(data,'alert:handle',ctx.chatId);
        if(!record || record.workspace!=='alerts' || record.scope!==telegramScopeForChat(ctx.chatId)) return telegramReply('提醒预览已过期或市场已切换；请重新运行 /alert draft。');
        let action:string,draftId:string;try{[action,draftId]=JSON.parse(record.id);}catch{return telegramReply('提醒预览按钮无效。');}
        const key=`telegram-alert-draft:${ctx.chatId}`,draft=stateStore.get<any>(key);
        if(!draft || draft.draftId!==draftId || draft.scope!==record.scope || Date.now()>draft.expiresAt) return telegramReply('提醒预览已过期或已处理，请重新运行 /alert draft。');
        stateStore.set(key,null);
        if(action==='cancel') return telegramReply('已取消提醒创建，没有新增监控。');
        if(action!=='confirm') return telegramReply('未知的提醒操作。');
        if(draft.kind==='price') {
          if(record.scope!=='crypto' || !draft.payload || !Number.isFinite(Number(draft.payload.price))) return telegramReply('价格提醒市场或数值无效，未创建。');
          const quote=await binanceFeed.getPrice(String(draft.payload.symbol));
          if(!quote) return telegramReply('确认时 Binance 行情不可用，提醒未创建；请重新预览。');
          const created=telegramCommandCenterStore.createPriceAlert(ctx.chatId,draft.payload);
          telegramCommandCenterStore.updatePreferences(ctx.chatId,{notifications:{priceAlerts:true}});
          telegramCommandCenterStore.recordAudit(ctx.chatId,'price_alert_create',`${created.symbol}:${created.direction}:${created.price}`);
          return telegramReply(`✅ 已创建价格提醒：${created.symbol} ${created.direction==='ABOVE'?'≥':'≤'} ${created.price}\n提醒 ID：${created.id}`);
        }
        if(draft.kind==='smart' && draft.payload && ((draft.payload.type==='PROBABILITY' && record.scope==='prediction') || (draft.payload.type!=='PROBABILITY' && record.scope==='overview'))) {
          const created=telegramCommandCenterStore.createSmartAlert(ctx.chatId,draft.payload);
          telegramCommandCenterStore.updatePreferences(ctx.chatId,{notifications:{riskAlerts:true,events:true,signals:true}});
          telegramCommandCenterStore.recordAudit(ctx.chatId,'smart_alert_create',telegramAlertDescription(created));
          return telegramReply(`✅ 已创建智能提醒：${telegramAlertDescription(created)}\n提醒 ID：${created.id} · 冷却 ${created.cooldownMinutes} 分钟`);
        }
        return telegramReply('提醒类型与市场不匹配，未创建。');
      }
      if(data.startsWith('chart:period:')) {
        const record=consumeTelegramCallback(data,'chart:period',ctx.chatId);
        if(!record || record.workspace!=='chart' || record.scope!==telegramScopeForChat(ctx.chatId)) return telegramReply('K线周期按钮已过期或市场已切换，请重新发送 /chart。');
        let instrument:string,period:string,date:string;try{[instrument,period,date]=JSON.parse(record.id);}catch{return telegramReply('K线按钮无效。');}
        const ref=telegramRefFromId(instrument);
        const allowed=record.scope==='stocks'?['1m','5m','15m','1h','1d']:record.scope==='crypto'?['1m','5m','15m','1h','4h','1d']:[];
        if(!ref || telegramInstrumentScope(ref.type)!==record.scope || !allowed.includes(period) || record.timeframe!==period || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))) return telegramReply('K线周期或标的校验失败。');
        telegramCommandCenterStore.updateSession(ctx.chatId,{marketScope:record.scope,workspace:ref.type==='crypto'?'crypto-quotes':'stock-quotes',instrumentId:ref.id,timeframe:period});
        return commandHandlers.chart({chatId:ctx.chatId,command:'chart',args:[ref.id,period,date||''],message:ctx.message,update:ctx.update});
      }
      if (data.startsWith('quick:select:')) {
        const parsed = parseTelegramContextCallback(data, 'quick:select', ctx.chatId);
        if (!parsed) return telegramReply('按钮上下文已失效，请重新发送代码查询。');
        telegramCommandCenterStore.setActiveMarketScope(ctx.chatId, parsed.scope);
        return commandHandlers.quick({ chatId: ctx.chatId, command: 'quick', args: [parsed.id], message: ctx.message, update: ctx.update });
      }
      if (data.startsWith('quick:watch:')) {
        const parsed = parseTelegramContextCallback(data, 'quick:watch', ctx.chatId);
        if (!parsed) return telegramReply('自选按钮上下文已失效，请重新查询标的。');
        telegramCommandCenterStore.setActiveMarketScope(ctx.chatId, parsed.scope);
        telegramCommandCenterStore.updateSession(ctx.chatId, { marketScope: parsed.scope, workspace: parsed.workspace, instrumentId: parsed.ref.id, timeframe: parsed.timeframe });
        const changed = telegramCommandCenterStore.addWatchlistMarket(ctx.chatId, parsed.id);
        telegramCommandCenterStore.recordAudit(ctx.chatId, 'watchlist_update', 'add:' + parsed.id);
        return telegramReply(changed ? `✅ 已加入${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[parsed.scope])}自选：${escapeTelegramHtml(parsed.ref.title || parsed.ref.symbol)}` : '该标的已在自选中。');
      }
      if (data.startsWith('quick:backtest:')) {
        const parsed = parseTelegramContextCallback(data, 'quick:backtest', ctx.chatId);
        if (!parsed) return telegramReply('回测按钮上下文已失效，请重新查询标的。');
        telegramCommandCenterStore.setActiveMarketScope(ctx.chatId, parsed.scope);
        telegramCommandCenterStore.updateSession(ctx.chatId, { marketScope: parsed.scope, workspace: parsed.workspace, instrumentId: parsed.ref.id, timeframe: parsed.timeframe });
        if (parsed.scope === 'options') return telegramReply('期权回测需要历史期权链、IV 和 Greeks，当前来源不可用，不生成伪造结果。');
        return commandHandlers.backtest({ chatId: ctx.chatId, command: 'backtest', args: [parsed.ref.symbol], message: ctx.message, update: ctx.update });
      }
      if (data.startsWith('quick:alert:')) {
        const parsed = parseTelegramContextCallback(data, 'quick:alert', ctx.chatId);
        if (!parsed) return telegramReply('提醒按钮上下文已失效，请重新查询标的。');
        telegramCommandCenterStore.setActiveMarketScope(ctx.chatId, parsed.scope);
        telegramCommandCenterStore.updateSession(ctx.chatId, { marketScope: parsed.scope, workspace: parsed.workspace, instrumentId: parsed.ref.id, timeframe: parsed.timeframe });
        if(parsed.scope!=='crypto')return telegramReply(`${escapeTelegramHtml(parsed.ref.symbol)} 已识别。当前 Telegram 价格提醒监控只接入 Binance 虚拟币行情；股票/期权请在对应网页工作区创建提醒，避免把币价监控误套到其他市场。`);
        return telegramReply(`已识别${escapeTelegramHtml(parsed.ref.symbol)}。可先预览确认：/alert draft ${escapeTelegramHtml(parsed.ref.symbol)} above <价格> 或 /alert draft ${escapeTelegramHtml(parsed.ref.symbol)} below <价格>。`);
      }
      if (data.startsWith('quick:timeline:')) {
        const parsed = parseTelegramContextCallback(data, 'quick:timeline', ctx.chatId);
        if (!parsed) return telegramReply('时间线按钮已过期，请重新查询标的。');
        telegramCommandCenterStore.updateSession(ctx.chatId, { marketScope: parsed.scope, workspace: parsed.workspace, instrumentId: parsed.ref.id, timeframe: parsed.timeframe });
        return commandHandlers.timeline({ chatId: ctx.chatId, command: 'timeline', args: [parsed.id], message: ctx.message, update: ctx.update });
      }
      if (data.startsWith('paper:pick:')) {
        if (!['overview', 'prediction'].includes(telegramScopeForChat(ctx.chatId))) return telegramReply('模拟开仓目前只允许在总体或预测市场作用域使用。');
        const marketId = parseTelegramCallbackPayload(data, 'paper:pick', ctx.chatId);
        if (!marketId) return telegramReply('按钮已过期或签名无效，请重新发送 /paper。');
        const m = telegramFindMarket(marketId);
        if(!m) return telegramReply('未找到该市场，请先 /search 刷新。');
        return telegramInlineReply(`已选市场：${escapeTelegramHtml(m.titleZh || m.title)}
平台：${escapeTelegramHtml(m.platform)} · YES ${formatTelegramNumber(m.yesPrice*100,1)}%
请选择方向`, buildPaperSideRows(String(m.id), ctx.chatId));
      }
      if (data.startsWith('paper:side:')) {
        const payload = parseTelegramCallbackPayload(data, 'paper:side', ctx.chatId);
        if (!payload) return telegramReply('按钮已过期或签名无效，请重新发送 /paper。');
        const separator = payload.lastIndexOf(':');
        if (separator <= 0) return telegramReply('纸面交易按钮数据无效，请重新发送 /paper。');
        const marketId = payload.slice(0, separator);
        const side = payload.slice(separator + 1);
        if (!['YES', 'NO'].includes(side)) return telegramReply('纸面交易方向无效，请重新发送 /paper。');
        const m = telegramFindMarket(marketId);
        return telegramInlineReply(`市场：${escapeTelegramHtml(m?.titleZh || m?.title || marketId)} · 方向 ${side}
请选择快捷价格/金额，或输入自定义命令`, buildPaperAmountRows(marketId, side, ctx.chatId));
      }
      if (data.startsWith('paper:do:')) {
        const payload = parseTelegramCallbackPayload(data, 'paper:do', ctx.chatId);
        if (!payload) return telegramReply('按钮已过期或签名无效，请重新发送 /paper。');
        const parts = payload.split(':');
        if (parts.length !== 4) return telegramReply('纸面交易参数无效，请重新发送 /paper。');
        const marketId = Number(parts[0]);
        const side = parts[1];
        const price = Number(parts[2]);
        const amt = Number(parts[3]);
        if (!Number.isInteger(marketId) || !['YES', 'NO'].includes(side) || !Number.isFinite(price) || !Number.isFinite(amt) || price <= 0 || price > 1 || amt <= 0) return telegramReply('纸面交易参数无效，请重新发送 /paper。');
        const outcomeIndex = side === 'NO' ? 1 : 0;
        const m = telegramFindMarket(String(marketId));
        const pending = telegramCommandCenterStore.createPendingAction(ctx.chatId, { type: 'paper_open', marketId, outcomeIndex: outcomeIndex as 0|1, outcomeName: side, price, amountUsd: amt });
        telegramCommandCenterStore.recordAudit(ctx.chatId, 'paper_open_form', `${marketId}:${side}:${price}:${amt}`);
        return telegramPendingReply(`⚠️ 请确认模拟开仓
市场：${escapeTelegramHtml(m?.titleZh || m?.title || `市场 ${marketId}`)}
方向：${side} · 价格 ${price} · 金额 ${amt}

确认码：${pending.nonce}`, pending.nonce, ctx.chatId, 'prediction');
      }
      if (data.startsWith('paper:close:pick:')) {
        const pid = parseTelegramCallbackPayload(data, 'paper:close:pick', ctx.chatId);
        if (!pid) return telegramReply('按钮已过期或签名无效，请重新发送 /paper。');
        const position = paperEngine.getOpenPositions().find(p=>p.id===pid);
        if(!position) return telegramReply('持仓不存在或已平仓');
        const vals=['0.45','0.55','0.65','0.75'];
        const kb=[];
        for(let i=0;i<vals.length;i+=2) kb.push(vals.slice(i,i+2).map(v=>({ text: `平仓 ${v}`, callback_data: telegramPaperCallback('paper:close:do', `${pid}:${v}`, ctx.chatId, 'prediction') })));
        return telegramInlineReply(`选择平仓价格
${escapeTelegramHtml(position.marketTitle)} · ${escapeTelegramHtml(position.outcomeName)}`, kb);
      }
      if (data.startsWith('paper:close:do:')) {
        const rem = parseTelegramCallbackPayload(data, 'paper:close:do', ctx.chatId);
        if (!rem) return telegramReply('按钮已过期或签名无效，请重新发送 /paper。');
        const idx = rem.lastIndexOf(':');
        if (idx <= 0) return telegramReply('平仓参数无效，请重新发送 /paper。');
        const pid = rem.slice(0, idx);
        const price = Number(rem.slice(idx+1));
        if (!Number.isFinite(price) || price <= 0 || price > 1) return telegramReply('平仓价格无效，请重新发送 /paper。');
        const position = paperEngine.getOpenPositions().find(p=>p.id===pid);
        if(!position) return telegramReply('持仓不存在');
        const pending = telegramCommandCenterStore.createPendingAction(ctx.chatId, { type: 'paper_close', positionId: pid, price });
        return telegramPendingReply(`⚠️ 请确认模拟平仓
${escapeTelegramHtml(position.marketTitle)} · ${escapeTelegramHtml(position.outcomeName)}
价格：${price}`, pending.nonce, ctx.chatId, 'prediction');
      }
      if (data.startsWith('unified:show:')) {
        const currentScope = telegramScopeForChat(ctx.chatId);
        const parsed = parseScopedTelegramCallback(data, 'unified:show', ctx.chatId);
        const id = parsed.id;
        if (parsed.scope && parsed.scope !== 'overview' && parsed.scope !== 'watchlist' && currentScope !== 'overview' && currentScope !== 'watchlist' && parsed.scope !== currentScope) {
          return telegramReply(`该按钮属于${TELEGRAM_SCOPE_LABELS[parsed.scope]}市场，请先切换当前市场。`);
        }
        const [type, venue, ...symbolParts] = id.split(':');
        if (!['stock', 'option', 'crypto', 'prediction'].includes(type) || !symbolParts.length) return telegramReply('统一标的 ID 无效');
        const itemScope = type === 'stock' ? 'stocks' : type === 'option' ? 'options' : type === 'crypto' ? 'crypto' : 'prediction';
        if (currentScope !== 'overview' && currentScope !== 'watchlist' && itemScope !== currentScope) return telegramReply(`当前为${TELEGRAM_SCOPE_LABELS[currentScope]}市场，不能查看${TELEGRAM_SCOPE_LABELS[itemScope]}标的。`);
        const detail = await unifiedInstrumentService.overview({ id, type: type as any, venue, symbol: symbolParts.join(':'), title: '', aliases: [] }).catch(() => null);
        if (!detail) return telegramReply('标的详情暂不可用');
        const q = detail.quote || detail.marketData || {};
        return telegramReply(`<b>标的详情</b>\n${escapeTelegramHtml(detail.instrument.title)}\n${escapeTelegramHtml(detail.instrument.id)}\n价格/概率：${escapeTelegramHtml(String((q as any).price ?? (q as any).yesPrice ?? '暂无'))}\nAI：${escapeTelegramHtml(detail.analysis.text.slice(0, 500))}`);
      }
      if (data.startsWith('watch:add:')) {
        const currentScope = telegramScopeForChat(ctx.chatId);
        const parsed = parseScopedTelegramCallback(data, 'watch:add', ctx.chatId);
        const mid = parsed.id;
        if (parsed.scope && parsed.scope !== 'overview' && parsed.scope !== 'watchlist' && currentScope !== 'overview' && currentScope !== 'watchlist' && parsed.scope !== currentScope) {
          return telegramReply(`该按钮属于${TELEGRAM_SCOPE_LABELS[parsed.scope]}市场，请先切换当前市场。`);
        }
        const itemScope = telegramScopeForWatchId(mid);
        if (itemScope && currentScope !== 'overview' && currentScope !== 'watchlist' && itemScope !== currentScope) return telegramReply(`当前为${TELEGRAM_SCOPE_LABELS[currentScope]}市场，不能把${TELEGRAM_SCOPE_LABELS[itemScope]}标的加入此处自选。`);
        const m = telegramFindMarket(mid);
        if (!m && !isTelegramWatchableStockId(mid) && !/^(stock|option|crypto|prediction):/i.test(mid)) return telegramReply('未找到该市场');
        const changed = telegramCommandCenterStore.addWatchlistMarket(ctx.chatId, mid);
        telegramCommandCenterStore.recordAudit(ctx.chatId, 'watchlist_update', 'add:'+mid);
        return telegramReply(changed ? `✅ 已加入自选：${escapeTelegramHtml(telegramWatchLabel(mid, m))}` : '该市场已在自选中');
      }
      if (data.startsWith('watch:remove:')) {
        const mid = data.slice('watch:remove:'.length);
        const changed = telegramCommandCenterStore.removeWatchlistMarket(ctx.chatId, mid);
        telegramCommandCenterStore.recordAudit(ctx.chatId, 'watchlist_update', 'remove:'+mid);
        return telegramReply(changed ? `✅ 已移出自选：${escapeTelegramHtml(mid)}` : '该市场不在自选中');
      }
      if (data.startsWith('explain:')) {
        const mid = data.slice('explain:'.length);
        const m = telegramFindMarket(mid) || telegramRadarMarkets().find(x=>String(x.id)===mid);
        if(!m) return telegramReply('未找到该市场');
        const txt = [`<b>🧠 市场解释</b>`, escapeTelegramHtml(m.titleZh || m.title), `平台：${escapeTelegramHtml(m.platform)}`, `YES：${formatTelegramNumber(m.yesPrice*100,1)}% · 模型：${formatTelegramNumber(m.modelProbability*100,1)}%`, `信号：${escapeTelegramHtml(m.signalZh || (m as any).signal || '-')}`].join('\n');
        return telegramInlineReply(txt, [[{ text: '加自选', callback_data: `watch:add:${m.id}` }, { text: '开仓', callback_data: telegramPaperCallback('paper:pick', String(m.id), ctx.chatId) }]]);
      }
      if (data.startsWith('search:q:')) {
        const q = data.slice('search:q:'.length).toLowerCase();
        return commandHandlers.search({ chatId: ctx.chatId, command: 'search', args: [q], message: ctx.message, update: ctx.update });
      }
      if (data.startsWith('stock:view:')) {
        const code = data.slice('stock:view:'.length);
        try {
          const raw = await fetchTencentText(`https://qt.gtimg.cn/q=${encodeURIComponent(code)}`, 6000);
          const m = raw.match(/v_[^=]*="([^"]+)"/);
          if(!m) return telegramReply(`\u672a\u627e\u5230 ${escapeTelegramHtml(code)} \u884c\u60c5`);
          const txt = [`<b>\u80a1\u7968\u884c\u60c5</b> ${escapeTelegramHtml(code)}`, `\u539f\u59cb: ${escapeTelegramHtml(m[1].slice(0,200))}`].join('\n');
          return telegramReply(txt);
        } catch(e){ return telegramReply(`\u884c\u60c5\u83b7\u53d6\u5931\u8d25: ${escapeTelegramHtml(String(e))}`); }
      }
      if (data.startsWith('pending:confirm:')) {
        const nonce = parseTelegramCallbackPayload(data, 'pending:confirm', ctx.chatId);
        if (!nonce) return telegramReply('确认按钮已过期或签名无效，请重新发送模拟盘操作。');
        const pending = telegramCommandCenterStore.consumePendingAction(ctx.chatId, nonce);
        if (!pending) return telegramReply('确认码不存在、已使用或已过期。请重新发送模拟盘操作。');
        if (pending.type === 'unified_paper_order') {
          if (!pending.instrumentId || !pending.instrumentType || !pending.side || !Number.isFinite(Number(pending.price)) || !Number.isFinite(Number(pending.quantity))) return telegramReply('纸面订单数据不完整，已拒绝执行。');
          try {
            const ledger = unifiedPaperLedgerStore.apply({
              instrumentId: pending.instrumentId,
              instrumentType: pending.instrumentType,
              title: pending.instrumentTitle || pending.instrumentId,
              side: pending.side,
              price: Number(pending.price),
              quantity: Number(pending.quantity),
              timestamp: new Date().toISOString(),
              reason: 'Telegram 二次确认',
            });
            telegramCommandCenterStore.recordAudit(ctx.chatId, 'unified_paper_order_confirm', `${pending.instrumentId}:${pending.side}`);
            return telegramReply(`✅ 纸面订单已提交：${escapeTelegramHtml(pending.instrumentId)} · ${pending.side} · 数量 ${formatTelegramNumber(Number(pending.quantity), 8)} · 价格 ${formatTelegramNumber(Number(pending.price), 8)}\n当前权益：$${formatTelegramNumber(calculateUnifiedPerformance(ledger).equity)}`);
          } catch (error: any) {
            return telegramReply(`❌ 纸面订单未成交：${escapeTelegramHtml(error?.message || '模拟撮合失败')}`);
          }
        }
        if (pending.type === 'paper_open') {
          const result = paperEngine.openPosition(pending.marketId || 0, getCachedPredictionRadarSlice('', 240)?.markets.find(item => String(item.id) === String(pending.marketId))?.titleZh || `市场 ${pending.marketId}`, pending.outcomeIndex || 0, pending.outcomeName || 'YES', pending.price || 0, pending.amountUsd || 0, 'Telegram 内联确认');
          telegramCommandCenterStore.recordAudit(ctx.chatId, 'paper_open_confirm', result.message);
          return telegramReply(result.success ? `✅ ${escapeTelegramHtml(result.message)}` : `❌ ${escapeTelegramHtml(result.message)}`);
        }
        if (pending.type === 'paper_reset') {
          const portfolio = paperEngine.reset();
          telegramCommandCenterStore.recordAudit(ctx.chatId, 'paper_reset_confirm', 'startingBalance=' + portfolio.startingBalance);
          return telegramReply('✅ 模拟账户已重置。初始余额：$' + formatTelegramNumber(portfolio.startingBalance) + '。');
        }
        const result = paperEngine.closePosition(pending.positionId || '', pending.price || 0);
        telegramCommandCenterStore.recordAudit(ctx.chatId, 'paper_close_confirm', result.message);
        return telegramReply(result.success ? `✅ ${escapeTelegramHtml(result.message)}` : `❌ ${escapeTelegramHtml(result.message)}`);
      }
      if (data.startsWith('pending:cancel:')) {
        const nonce = parseTelegramCallbackPayload(data, 'pending:cancel', ctx.chatId);
        if (!nonce) return telegramReply('取消按钮已过期或签名无效，请重新发送模拟盘操作。');
        const cancelled = telegramCommandCenterStore.cancelPendingAction(ctx.chatId, nonce);
        return telegramReply(cancelled ? '已取消待确认的模拟盘操作。' : '当前没有待确认操作。');
      }
      return telegramReply('按钮已过期，请发送 /start 重新打开功能菜单。');
    },
    logger: console,
  });
  telegramInteractionBot.start();
  console.log(`  [telegram] interactive polling started (${allowedChatIds.size} allowed chat${allowedChatIds.size === 1 ? '' : 's'})`);
}

function reloadTelegramIntegration(): Promise<void> {
  telegramReloadPromise = telegramReloadPromise.catch(() => undefined).then(async () => {
    stopTelegramCommandCenterMonitor();
    const current = telegramInteractionBot;
    telegramInteractionBot = null;
    if (current) await current.stop();
    startTelegramInteractionBot();
    startTelegramCommandCenterMonitor();
    void sampleSourceHealth().catch(() => {});
    if (!sourceHealthMonitor) {
      sourceHealthMonitor = setInterval(() => { void sampleSourceHealth().catch(() => {}); }, 60_000);
      sourceHealthMonitor.unref?.();
    }
    void monitorDueDecisionReviewDrafts().catch(() => {});
    if (!dueDecisionReviewMonitor) {
      dueDecisionReviewMonitor = setInterval(() => { void monitorDueDecisionReviewDrafts().catch(() => {}); }, 5 * 60_000);
      dueDecisionReviewMonitor.unref?.();
    }
  });
  return telegramReloadPromise;
}

const telegramSignalPushes = new Set<string>();
const telegramEventReminderStages = new Map<string, EventReminderThreshold | null>();
const telegramEventResults = new TelegramEventResultMonitor(stateStore,event=>event.kind&&event.kind!=='macro'
  ?lookupTrackedResult(event,{job:id=>researchRepository.getJob(id),contract:instrument=>contractResearchService.detail(instrument,['funding']),settlement:refreshPredictionSettlement})
  :lookupOfficialEventResult(event));
const telegramDigestPushes = new Set<string>();
const telegramSourceStates = new Map<string, boolean>();
let consecutivePollFail = 0;

function telegramAlertSuppressed(chatId: string, priority: 'high' | 'normal' = 'normal'): boolean {
  return shouldSuppressTelegramAlert(telegramCommandCenterStore.getAlertPolicy(chatId), priority);
}

function telegramSmartAlertOnCooldown(alert: { lastTriggeredAt?: string; cooldownMinutes: number }): boolean {
  if (!alert.lastTriggeredAt) return false;
  return Date.now() - new Date(alert.lastTriggeredAt).getTime() < alert.cooldownMinutes * 60000;
}

async function monitorTelegramSmartAlerts(): Promise<void> {
  if (!telegramInteractionBot) return;
  const alerts = telegramCommandCenterStore.listSmartAlerts().filter(item => item.enabled && !telegramSmartAlertOnCooldown(item));
  if (!alerts.length) return;
  const radar = getCachedPredictionRadarSlice('', 240);
  const portfolio = paperEngine.getPortfolio();
  const events = alerts.some(item => item.type === 'EVENT') ? (await getUpcomingEventCalendar(2).catch(() => null))?.events || [] : [];
  const actions = telegramActions();
  for (const alert of alerts) {
    if (telegramAlertSuppressed(alert.chatId, alert.type === 'RISK' ? 'high' : 'normal')) continue;
    const prefs = telegramCommandCenterStore.getPreferences(alert.chatId).notifications;
    if ((alert.type === 'RISK' && !prefs.riskAlerts) || (alert.type === 'EVENT' && !prefs.events) || (alert.type === 'SIGNAL' && !prefs.signals) || (alert.type === 'PROBABILITY' && !prefs.signals)) continue;
    let message = '';
    if (alert.type === 'PROBABILITY' && radar && alert.symbol) {
      const market = radar.markets.find(item => item.platform === 'Polymarket' && item.title.toUpperCase().includes(alert.symbol!)) || radar.markets.find(item => item.id === alert.symbol);
      const probability = market ? market.modelProbability * 100 : NaN;
      const hit = alert.direction === 'ABOVE' ? probability >= (alert.threshold || 0) : probability <= (alert.threshold || 0);
      if (hit && market) message = '当前模型概率 ' + formatTelegramNumber(probability, 1) + '%，达到条件 ' + telegramAlertDescription(alert);
    } else if (alert.type === 'RISK') {
      const value = portfolio.maxDrawdownPct;
      const hit = alert.direction === 'ABOVE' ? value >= (alert.threshold || 0) : value <= (alert.threshold || 0);
      if (hit) message = '当前最大回撤 ' + formatTelegramNumber(value, 1) + '%，达到条件 ' + telegramAlertDescription(alert);
    } else if (alert.type === 'EVENT') {
      const limit = alert.threshold || 24;
      const upcoming = events.find(event => { const hours = (new Date(event.date).getTime() - Date.now()) / 3600000; return hours >= 0 && hours <= limit; });
      if (upcoming) message = '[' + getEventImpactZh(upcoming.impact) + (upcoming.categoryLabel ? '·' + escapeTelegramHtml(upcoming.categoryLabel) : '') + '] ' + escapeTelegramHtml(upcoming.titleZh || upcoming.title) + ' 将在 ' + formatTelegramNumber((new Date(upcoming.date).getTime() - Date.now()) / 3600000, 1) + ' 小时内发生';
    } else if (alert.type === 'SIGNAL') {
      const reversal = actions.find(action => /反转|reversal|reverse/i.test(String(action.actionZh || '') + ' ' + String((action as any).reasons || '')));
      if (reversal) message = escapeTelegramHtml(reversal.title || reversal.symbol) + ' 出现信号反转：' + escapeTelegramHtml(reversal.actionZh);
    }
    if (!message) continue;
    const triggered = telegramCommandCenterStore.markSmartAlertTriggered(alert.id);
    if (!triggered) continue;
    telegramCommandCenterStore.recordAudit(alert.chatId, 'smart_alert_triggered', alert.id);
    await telegramInteractionBot.sendToChat(alert.chatId, telegramReply('🔔 <b>智能提醒触发</b>\n' + message + '\n条件：' + escapeTelegramHtml(telegramAlertDescription(alert))));
  }
}

async function monitorTelegramDigests(): Promise<void> {
  if (!telegramInteractionBot) return;
  const telegramConfig = getRuntimeTelegramConfig();
  const chats = new Set(parseChatIds(telegramConfig.allowedChatIds, telegramConfig.chatId));
  const now = new Date();
  const clock = zonedDigestClock(now, 'Asia/Shanghai');
  const minute = clock.minute;
  const day = clock.date;
  for (const chatId of chats) {
    const policy = telegramCommandCenterStore.getAlertPolicy(chatId);
    const schedules=[
      {id:'daily',label:'每日',enabled:policy.digest.enabled,time:policy.digest.time},
      {id:'preopen',label:'盘前',enabled:policy.digest.preOpenEnabled===true,time:policy.digest.preOpenTime||'21:00'},
      {id:'postclose',label:'盘后',enabled:policy.digest.postCloseEnabled===true,time:policy.digest.postCloseTime||'05:00'},
    ];
    for(const schedule of schedules){
      const key=schedule.id==='daily'?chatId+':'+day+':'+schedule.time:chatId+':'+day+':'+schedule.id+':'+schedule.time;
      const alreadySent=telegramDigestPushes.has(key)||telegramCommandCenterStore.listAudits(chatId,100).some(item=>item.action==='digest_sent'&&item.detail===key);
      if(!schedule.enabled||schedule.time!==minute||alreadySent||telegramAlertSuppressed(chatId))continue;
      if(!telegramCommandCenterStore.getPreferences(chatId).notifications.dailyReport)continue;
      await telegramInteractionBot.sendToChat(chatId,telegramReply(await buildTelegramDigest(chatId,schedule.label)));
      telegramDigestPushes.add(key);
      telegramCommandCenterStore.recordAudit(chatId,'digest_sent',key);
    }
  }
}

async function monitorTelegramSourceRecovery(chatId: string): Promise<void> {
  if (telegramAlertSuppressed(chatId) || !telegramCommandCenterStore.getPreferences(chatId).notifications.events) return;
  const report = await getSourceHealth().catch(() => null);
  if (!report) return;
  for (const item of report.items) {
    const key = chatId + ':' + item.id;
    const previous = telegramSourceStates.get(key);
    telegramSourceStates.set(key, item.ok);
    if (previous === false && item.ok) {
      await telegramInteractionBot?.sendToChat(chatId, telegramReply('🟢 <b>数据源恢复</b>\n' + escapeTelegramHtml(item.name) + ' 已恢复：' + escapeTelegramHtml(item.detail)));
    }
  }
}

function eventReminderThresholdLabel(stage: EventReminderThreshold): string {
  return stage >= 60 ? `${stage / 60}小时` : `${stage}分钟`;
}

function eventCountdownLabel(minutesUntil: number): string {
  return minutesUntil >= 60
    ? `${formatTelegramNumber(minutesUntil / 60, 1)}小时`
    : `${Math.max(0, Math.round(minutesUntil))}分钟`;
}

function eventAlertKey(chatId: string, event: { date: string; title: string }): string {
  return `${chatId}:${event.date}:${event.title}`;
}

async function monitorTelegramEventAlerts(): Promise<void> {
  if (!telegramInteractionBot) return;
  const telegramConfig = getRuntimeTelegramConfig();
  const chats = [...new Set(parseChatIds(telegramConfig.allowedChatIds, telegramConfig.chatId))]
    .filter(chatId => telegramCommandCenterStore.getPreferences(chatId).notifications.events);
  if (!chats.length) return;
  let calendar;
  try {
    calendar = await getUpcomingEventCalendar(2);
  } catch {
    calendar = null;
  }
  const highImpactEvents = calendar?.events.filter(event => event.impact === 'high') ?? [];
  for (const chatId of chats) {
    const suppressed = telegramAlertSuppressed(chatId, 'high');
    for (const event of highImpactEvents) {
      const key = eventAlertKey(chatId, event);
      const minutesUntil = (new Date(event.date).getTime() - Date.now()) / 60_000;
      const initialized = telegramEventReminderStages.has(key);
      const previousStage = telegramEventReminderStages.get(key) ?? null;
      const reminder = decideEventReminder(minutesUntil, previousStage, initialized);
      if (!initialized) {
        telegramEventReminderStages.set(key, reminder.stage);
      } else if (reminder.shouldSend && reminder.stage !== null && !suppressed) {
        try {
          const messageId=await telegramInteractionBot.sendToChat(chatId, telegramReply(
            `📅 <b>高影响事件提醒</b>\n${formatEventLineZh(event)}\n提醒节点：提前 ${eventReminderThresholdLabel(reminder.stage)}\n距离：${eventCountdownLabel(minutesUntil)}`,
          ));
          if(typeof messageId==='number')telegramEventResults.registerReminder(chatId,event,messageId);
          telegramEventReminderStages.set(key, reminder.stage);
        } catch {}
      } else if (reminder.stage !== previousStage && reminder.stage !== null && !reminder.shouldSend) {
        telegramEventReminderStages.set(key, reminder.stage);
      } else if (reminder.stage !== previousStage && reminder.stage === null) {
        telegramEventReminderStages.set(key, null);
      }

    }
    await telegramEventResults.run(chatId, highImpactEvents, async (text,originalMessageId) => {
      if (!telegramInteractionBot) throw new Error('Bot unavailable');
      return telegramInteractionBot.sendToChat(chatId, {...telegramReply(text),replyToMessageId:originalMessageId});
    }, !suppressed);
  }
}

async function monitorTelegramPriceAlerts(): Promise<void> {
  if (!telegramInteractionBot) return;
  const alerts = telegramCommandCenterStore.listPriceAlerts().filter(item => !item.triggered);
  if (!alerts.length) return;
  const prices = await binanceFeed.getMultiplePrices([...new Set(alerts.map(item => item.symbol))]);
  for (const alert of alerts) {
    const preference = telegramCommandCenterStore.getPreferences(alert.chatId).notifications;
    if (telegramAlertSuppressed(alert.chatId)) continue;
    const ticker = prices[alert.symbol];
    if (!preference.priceAlerts || !ticker) continue;
    const hit = alert.direction === 'ABOVE' ? ticker.price >= alert.price : ticker.price <= alert.price;
    if (!hit) continue;
    const triggered = telegramCommandCenterStore.markPriceAlertTriggered(alert.id);
    if (!triggered) continue;
    telegramCommandCenterStore.recordAudit(alert.chatId, 'price_alert_triggered', `${alert.symbol} ${ticker.price}`);
    await telegramInteractionBot.sendToChat(alert.chatId, telegramReply(`🔔 <b>价格提醒触发</b>\n${alert.symbol} 当前 $${formatTelegramNumber(ticker.price, 4)}，已${alert.direction === 'ABOVE' ? '达到' : '跌至'} $${formatTelegramNumber(alert.price, 4)}`));
  }
}

async function metricObservation(rule: Partial<UnifiedAlertRule>):Promise<UnifiedAlertObservation> {
  const id=String(rule.instrumentId || ''),fields=alertMetricFields(id);
  if(!fields.length) return {kind:'metric',scope:rule.scope,dataStatus:'unsupported',reason:'当前交易场所不支持组合条件'};
  const clauses=rule.condition?.clauses || [], wantsTechnical=clauses.some(c=>['volume','rsi','pattern'].includes(c.field));
  try {
    if(id.startsWith('stock:us:')) {
      const symbol=id.split(':')[2],quote=await stockDataService.quote(symbol);
      const metrics:Record<string,number|string>={};if(quote.quote?.price!=null) metrics.price=Number(quote.quote.price);
      let technical:any=null;
      if(wantsTechnical) {const history=await dataLakeCatalog.queryBarsAsOf({market:'stocks',instrument:symbol,timeframe:'1d',asOf:new Date().toISOString()});technical=completedBarMetrics(history.rows.map(row=>({...row,time:Date.parse(String(row.timestamp))})));Object.assign(metrics,technical.metrics);}
      return {kind:'metric',scope:'stocks',metrics,observedAt:quote.snapshot.fetchedAt,dataStatus:['live','fallback'].includes(quote.snapshot.status) ? 'delayed':'unavailable',source:quote.snapshot.source,reason:quote.snapshot.error || technical?.reason || undefined};
    }
    if(id.startsWith('crypto:binance:')) {
      const symbol=id.split(':')[2],price=await binanceFeed.getPrice(symbol);
      const metrics:Record<string,number|string>={};if(price) metrics.price=price.price;
      const technical=wantsTechnical ? completedBarMetrics(await binanceFeed.getKlines(symbol,'1d',30)):null;
      if(technical) Object.assign(metrics,technical.metrics);
      return {kind:'metric',scope:'crypto',metrics,observedAt:binanceFeed.cachedAt(symbol) || undefined,dataStatus:price ? 'delayed':'unavailable',source:'Binance Public',reason:technical?.reason || undefined};
    }
    const radar=await getPerpetualCrowding(),contract=id.split(':')[2],row=radar.rows.find(item=>item.contract===contract);
    return {kind:'metric',scope:'crypto',metrics:row ? {price:row.price,fundingRatePct:row.fundingRatePct,openInterestUsd:row.openInterestUsd}:{},observedAt:radar.generatedAt,dataStatus:row ? 'delayed':'unavailable',source:radar.source,reason:row ? undefined:'该永续合约没有真实来源记录'};
  } catch(error:any) {return {kind:'metric',scope:rule.scope,dataStatus:'unavailable',reason:error.message};}
}
let unifiedAlertMonitorBusy=false;
let unifiedAlertMonitorTimer: NodeJS.Timeout | null=null;
let unifiedAlertMonitorLeaseOwned=false;
const unifiedAlertMonitorOwner='web-alerts:'+process.pid+':'+crypto.randomUUID();
function startUnifiedAlertMonitor(): void {
  if(!unifiedAlertMonitorTimer) unifiedAlertMonitorTimer=setInterval(()=>{void monitorUnifiedAlertRules().catch(error=>logger.warn('Unified alert monitor failed',error));},60_000);
}
function stopUnifiedAlertMonitor(): void {
  if(unifiedAlertMonitorTimer) clearInterval(unifiedAlertMonitorTimer);
  unifiedAlertMonitorTimer=null;
}
async function monitorUnifiedAlertRules(): Promise<void> {
  if(unifiedAlertMonitorBusy || !unifiedAlertStore.listRules().some(rule=>rule.enabled)) return;
  if(!stateStore.acquireLease('unified-alert-monitor',unifiedAlertMonitorOwner,Date.now(),90_000)) return;
  unifiedAlertMonitorBusy=true;
  unifiedAlertMonitorLeaseOwned=true;
  const heartbeat=setInterval(()=>{unifiedAlertMonitorLeaseOwned=stateStore.refreshLease('unified-alert-monitor',unifiedAlertMonitorOwner,Date.now(),90_000);},30_000);
  try { await runUnifiedAlertMonitor(); } finally {clearInterval(heartbeat);stateStore.releaseLease('unified-alert-monitor',unifiedAlertMonitorOwner);unifiedAlertMonitorLeaseOwned=false;unifiedAlertMonitorBusy=false;}
}
async function runUnifiedAlertMonitor(): Promise<void> {
  const rules = unifiedAlertStore.listRules().filter(rule => rule.enabled && (!rule.expiresAt || Date.parse(rule.expiresAt)>Date.now()));
  if (!rules.length) return;
  const radar = getCachedPredictionRadarSlice('', 240);
  const calendar = await getUpcomingEventCalendar(2).catch(() => null);
  const news = await newsFeed.getNews().catch(() => []);
  const observations: Array<{ instrumentId: string; observation: any }> = [];
  const metricCache=new Map<string,Promise<UnifiedAlertObservation>>();
  for (const rule of rules) {
    if(rule.kind==='metric') {
      if(!metricCache.has(rule.instrumentId) && metricCache.size>=6) continue;
      if(!metricCache.has(rule.instrumentId)) {const clauses=rules.filter(r=>r.instrumentId===rule.instrumentId && r.kind==='metric').flatMap(r=>r.condition.clauses || []);metricCache.set(rule.instrumentId,metricObservation({...rule,condition:{...rule.condition,clauses}}));}
      observations.push({instrumentId:rule.instrumentId,observation:await metricCache.get(rule.instrumentId)});
    } else if (rule.kind === 'price') {
      let price: number | undefined;
      if (rule.instrumentId.startsWith('crypto:binance:')) price = (await binanceFeed.getPrice(rule.instrumentId.split(':').pop() || ''))?.price;
      else if (rule.instrumentId.startsWith('prediction:')) price = radar?.markets.find(item => String(item.id) === rule.instrumentId.split(':').pop())?.yesPrice;
      else if (rule.instrumentId.startsWith('stock:us:')) price = Number((await stockDataService.quote(rule.instrumentId.split(':').pop() || '')).quote?.price);
      const priceScope=rule.instrumentId.startsWith('crypto:binance:') ? 'crypto':rule.instrumentId.startsWith('prediction:') ? 'prediction':rule.instrumentId.startsWith('stock:us:') ? 'stocks':null;
      if (priceScope && price != null && Number.isFinite(price)) observations.push({ instrumentId: rule.instrumentId, observation: { kind: 'price', scope: priceScope, value: price, observedAt: new Date().toISOString() } });
    } else if (rule.kind === 'event') {
      const event = calendar?.events.filter(item => item.impact === 'high').sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
      if (event) observations.push({ instrumentId: rule.instrumentId, observation: { kind: 'event', minutesUntil: (new Date(event.date).getTime() - Date.now()) / 60_000, title: event.titleZh || event.title, actual: event.actual, forecast: event.forecast, observedAt: new Date().toISOString() } });
    } else {
      const hit = news.find(item => rule.condition.keywords?.some(keyword => `${item.title} ${item.source}`.toLowerCase().includes(String(keyword).toLowerCase())));
      if (hit) observations.push({ instrumentId: rule.instrumentId, observation: { kind: 'news', title: hit.title, content: hit.source, value: hit.sentimentScore, observedAt: hit.publishedAt } });
    }
  }
  if(!unifiedAlertMonitorLeaseOwned || !stateStore.refreshLease('unified-alert-monitor',unifiedAlertMonitorOwner,Date.now(),90_000)) return;
  const triggered = triggerUnifiedAlerts(unifiedAlertStore, observations);
  if (!triggered.length) return;
  const telegramConfig = getRuntimeTelegramConfig();
  const chats = parseChatIds(telegramConfig.allowedChatIds, telegramConfig.chatId);
  for (const entry of triggered) {
    const direction = entry.direction === 'bullish' ? '偏利好' : entry.direction === 'bearish' ? '偏利空' : entry.direction === 'neutral' ? '中性/无法判断' : entry.direction;
    const message = `🔔 ${entry.message} · ${direction} · ${entry.instrumentId}`;
    const alertMarket: MarketId = entry.instrumentId.startsWith('crypto:') ? 'crypto' : entry.instrumentId.startsWith('option:') ? 'options' : entry.instrumentId.startsWith('prediction:') ? 'prediction' : 'stocks';
    if (entry.channels.web) {
      pushNotification('alert', message);
      researchRepository.saveAlertDelivery({ id: `delivery_${entry.id}_web`, context: { market: alertMarket, workspace: 'alerts', instrument: entry.instrumentId }, alertId: entry.id, channel: 'web', payload: { message }, status: 'sent', attempts: 1, lastAttemptAt: new Date().toISOString(), deliveredAt: new Date().toISOString() });
    }
    if (entry.channels.telegram && telegramInteractionBot) {
      for (const chatId of chats) {
        const deliveryId = `delivery_${entry.id}_telegram_${chatId}`;
        try {
          await telegramInteractionBot.sendToChat(chatId, telegramReply(escapeTelegramHtml(message)));
          researchRepository.saveAlertDelivery({ id: deliveryId, context: { market: alertMarket, workspace: 'alerts', instrument: entry.instrumentId }, alertId: entry.id, channel: 'telegram', payload: { message, chatId }, status: 'sent', attempts: 1, lastAttemptAt: new Date().toISOString(), deliveredAt: new Date().toISOString() });
        } catch (error: any) {
          researchRepository.saveAlertDelivery({ id: deliveryId, context: { market: alertMarket, workspace: 'alerts', instrument: entry.instrumentId }, alertId: entry.id, channel: 'telegram', payload: { message, chatId }, status: 'failed', attempts: 1, lastAttemptAt: new Date().toISOString(), lastError: error?.message || 'Telegram 投递失败' });
        }
      }
    }
  }
}

async function monitorTelegramSlowAlerts(): Promise<void> {
  if (!telegramInteractionBot) return;
  const telegramConfig = getRuntimeTelegramConfig();
  const chats = new Set(parseChatIds(telegramConfig.allowedChatIds, telegramConfig.chatId));
  const portfolio = paperEngine.getPortfolio();
  const metrics = paperEngine.getRiskMetrics();
  for (const chatId of chats) {
    const notifications = telegramCommandCenterStore.getPreferences(chatId).notifications;
    await monitorTelegramSourceRecovery(chatId).catch(() => {});
    if (telegramAlertSuppressed(chatId, 'high')) continue;
    if (notifications.riskAlerts && portfolio.maxDrawdownPct >= 10) {
      const key = `risk:${new Date().toISOString().slice(0, 10)}:${chatId}`;
      if (!telegramCommandCenterStore.listAudits(chatId, 100).some(item => item.action === 'risk_alert' && item.detail === key)) {
        telegramCommandCenterStore.recordAudit(chatId, 'risk_alert', key);
        await telegramInteractionBot.sendToChat(chatId, telegramReply(`⚠️ <b>模拟盘风险预警</b>\n最大回撤已达 ${formatTelegramNumber(portfolio.maxDrawdownPct, 1)}%，VaR95 $${formatTelegramNumber(metrics.var95Usd)}。建议先检查集中度和临近截止仓位。`));
      }
    }
    if (notifications.signals && !telegramAlertSuppressed(chatId, 'normal')) {
      const scope = telegramScopeForChat(chatId);
      if (scope === 'stocks') {
        if(isTelegramAdmin(chatId))await stockSignalSchedule.run(chatId,{market:scope,paused:telegramAlertSuppressed(chatId,'normal')},async()=>{
          const existing=telegramStockSignalScanner.get(chatId);
          await stockSignalsForChat(chatId,[existing?.status==='partial' ? 'continue':'refresh'],true);
          const completed=await telegramStockSignalScanner.wait(chatId);
          if(!completed || ['discovering','scanning'].includes(completed.status))throw new Error('另一个进程仍在扫描，未将未完成扫描记为成功');
        });
        const snapshot = telegramStockSignalScanner.get(chatId);
        if (snapshot?.status === 'complete') {
          const key = telegramStockSignalNotificationKey(chatId, snapshot);
          const deliveryStateKey = `telegram:stock-signal-last-delivered:${chatId}`;
          const deliveryLeaseKey = `telegram:stock-signal-delivery:${chatId}`;
          const alreadySent = stateStore.get<string>(deliveryStateKey) === snapshot.id;
          const actionable = selectTelegramStockSignalAlerts(snapshot).filter(row=>isStockSignalNotificationFresh(row)).slice(0, 3);
          if (actionable.length && !alreadySent) {
            const owner = `stock-signal:${crypto.randomUUID()}`;
            if (stateStore.acquireLease(deliveryLeaseKey, owner, Date.now(), 30_000)) {
              try {
                const latest = telegramStockSignalScanner.get(chatId);
                const latestNotifications = telegramCommandCenterStore.getPreferences(chatId).notifications;
                if (latest?.id === snapshot.id && telegramScopeForChat(chatId) === 'stocks'
                  && latestNotifications.signals && !telegramAlertSuppressed(chatId, 'normal')) {
                  const deliveryId='stock-signal:'+key;
                  const expiresAt=new Date(Math.min(Date.parse(snapshot.createdAt)+30*60000,...actionable.map(row=>stockQuoteObservationTime(row.updatedAt)!+30*60000))).toISOString();
                  telegramStockSignalOutbox.enqueue({id:deliveryId,context:{market:'stocks',workspace:'signals'},alertId:snapshot.id,channel:'telegram',status:'queued',expiresAt,payload:{chatId,message:[
                    '<b>📡 股票信号更新</b>',
                    ...actionable.map(row => `· ${escapeTelegramHtml(row.candidate.name || row.candidate.symbol)} · ${escapeTelegramHtml(row.action?.actionZh || row.action?.action || '')} · ${escapeTelegramHtml(row.source)}`),
                    '', '发送 /signals 查看当前聊天可见的完整股票池。',
                  ].join('\n')}});
                  await telegramStockSignalOutbox.flush(chatId,()=>telegramScopeForChat(chatId)==='stocks' && telegramCommandCenterStore.getPreferences(chatId).notifications.signals && !telegramAlertSuppressed(chatId,'normal'),async text=>{if(!telegramInteractionBot)throw Error('Telegram暂停');await telegramInteractionBot.sendToChat(chatId,telegramReply(text));});
                  if(['sent','acknowledged'].includes(researchRepository.getAlertDelivery(deliveryId)?.status || '')) {
                    stateStore.set(deliveryStateKey, snapshot.id, 1);
                    telegramCommandCenterStore.recordAudit(chatId, 'stock_signal_scan_push', key);
                  }
                }
              } finally {
                stateStore.releaseLease(deliveryLeaseKey, owner);
              }
            }
          }
        }
        await telegramStockSignalOutbox.flush(chatId,()=>telegramScopeForChat(chatId)==='stocks' && telegramCommandCenterStore.getPreferences(chatId).notifications.signals && !telegramAlertSuppressed(chatId,'normal'),async text=>{if(!telegramInteractionBot)throw Error('Telegram暂停');await telegramInteractionBot.sendToChat(chatId,telegramReply(text));});
      } else if (lastAdvisorReport) {
        const signalKey = `${chatId}:${scope}:${lastAdvisorReport.generatedAt}`;
        if (!telegramSignalPushes.has(signalKey)) {
          const actionable = telegramActions(scope).filter(item => item.action !== 'WAIT').slice(0, 3);
          if (actionable.length) {
            await telegramInteractionBot.sendToChat(chatId, telegramReply([
              `<b>📡 ${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[scope])}市场新助手信号</b>`,
              ...actionable.map(item => `· ${escapeTelegramHtml(item.title || item.symbol)} · ${escapeTelegramHtml(item.actionZh)} · ${formatTelegramNumber(item.confidencePct, 0)}%`),
              '', '发送 /signals 查看完整列表。',
            ].join('\n')));
            telegramSignalPushes.add(signalKey);
          }
        }
      }
    }
  }
}

function startTelegramCommandCenterMonitor(): void {
  if (!telegramInteractionBot) return;
  if (!telegramPriceMonitor) telegramPriceMonitor = setInterval(() => { void monitorTelegramPriceAlerts().catch(() => {}); }, 60_000);
  if (!telegramDigestMonitor) telegramDigestMonitor = setInterval(() => { void monitorTelegramDigests().catch(() => {}); }, 60_000);
  if (!telegramEventMonitor) telegramEventMonitor = setInterval(() => { void monitorTelegramEventAlerts().catch(() => {}); }, 60_000);
  if (!telegramSlowMonitor) telegramSlowMonitor = setInterval(() => { void Promise.all([monitorTelegramSlowAlerts(), monitorTelegramSmartAlerts()]).catch(() => {}); }, 10 * 60_000);
}

function stopTelegramCommandCenterMonitor(): void {
  if (telegramPriceMonitor) clearInterval(telegramPriceMonitor);
  if (telegramSlowMonitor) clearInterval(telegramSlowMonitor);
  if (telegramDigestMonitor) clearInterval(telegramDigestMonitor);
  if (telegramEventMonitor) clearInterval(telegramEventMonitor);
  telegramPriceMonitor = null;
  telegramSlowMonitor = null;
  telegramDigestMonitor = null;
  telegramEventMonitor = null;
}

function requestedMarketScope(value: unknown): MarketScope | undefined {
  const raw = String(value || '').trim();
  return MARKET_SCOPES.includes(raw as MarketScope) ? raw as MarketScope : undefined;
}

function sendPerformanceJson(req: express.Request, res: express.Response, payload: Record<string, unknown>, cacheStatus: string): void {
  const scope = requestedMarketScope(req.query.scope) || 'overview';
  const finalPayload = {
    ...payload,
    scope: payload.scope || scope,
    sourceStatus: payload.sourceStatus || (cacheStatus === 'unavailable' ? 'degraded' : 'ok'),
    updatedAt: payload.updatedAt || new Date().toISOString(),
  };
  const etag = createCacheEtag((finalPayload as any).data);
  res.setHeader('ETag', etag);
  res.setHeader('Cache-Control', 'public, max-age=10, stale-while-revalidate=60');
  res.setHeader('X-MoneyMoney-Cache', cacheStatus);
  if (String(req.headers['if-none-match'] || '') === etag) {
    res.status(304).end();
    return;
  }
  res.json({ ...finalPayload, cacheStatus });
}

app.get('/api/advisor', async (req, res) => {
  try {
    const report = await generateAssistantReport();
    lastAdvisorReport = report;
    const scope = requestedMarketScope(req.query.scope);
    res.json({ success: true, data: scope ? filterAssistantReport(report, scope) : report });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/market-ticker', async (req, res) => {
  const scope = requestedMarketScope(req.query.scope) || 'overview';
  try {
    const cached = await globalCache.fetch(`scope:${scope}:market-ticker`, async () => {
      if (scope === 'overview') return [];
      if (scope === 'crypto') {
        const prices = await binanceFeed.getMultiplePrices(['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']);
        return Object.values(prices).map(item => ({
          label: item.symbol,
          title: `${item.symbol} ${item.price.toLocaleString()} ${item.change24hPct >= 0 ? '+' : ''}${item.change24hPct.toFixed(2)}%`,
          value: item.price,
          changePct: item.change24hPct,
          source: 'Binance',
        }));
      }
      if (scope === 'prediction') {
        const radar = getCachedPredictionRadarSlice('', 240);
        return (radar?.markets || []).slice(0, 8).map(item => ({
          label: item.platform,
          title: item.titleZh || item.title,
          value: Math.round(item.yesPrice * 100),
          changePct: null,
          source: item.platform,
        }));
      }
      if (scope === 'stocks') {
        const symbols = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA'];
        try {
          const text = await fetchTencentText(`https://qt.gtimg.cn/q=${symbols.map(symbol => `us${symbol}`).join(',')}`, 6000);
          const data = text.split(';')
            .map(raw => parseTencentStock(raw.trim()))
            .filter(item => item?.market === 'us' && item.price > 0)
            .map(item => ({
              label: item.code,
              title: `${item.code} ${item.price.toLocaleString()} ${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%`,
              value: item.price,
              changePct: item.changePct,
              source: 'Tencent Finance',
            }));
          if (data.length) return data;
        } catch {}
        const results = await Promise.all(symbols.map(async symbol => {
          try {
            const result = await stockDataService.quote(symbol);
            if (!result.quote) return null;
            const { price, changePct } = result.quote;
            const sign = changePct != null && changePct >= 0 ? '+' : '';
            const pctStr = changePct != null ? `${sign}${changePct.toFixed(2)}%` : '';
            return {
              label: symbol,
              title: `${symbol} ${price.toLocaleString()} ${pctStr}`.trim(),
              value: price,
              changePct,
              source: 'Nasdaq',
            };
          } catch {
            return null;
          }
        }));
        return results.filter(Boolean);
      }
      if (scope === 'options') {
        const symbols = ['SPY', 'QQQ', 'IWM'];
        const results = await Promise.all(symbols.map(async symbol => {
          try {
            const snapshot = await getEquityOptionsSnapshot(symbol);
            const quote = snapshot.quote;
            const iv = quote?.iv30Pct != null ? `IV30 ${quote.iv30Pct.toFixed(1)}%` : '';
            return {
              label: symbol,
              title: `${symbol} ${snapshot.spot.toLocaleString()} ${iv}`.trim(),
              value: snapshot.spot,
              changePct: quote?.changePercent ?? null,
              source: 'CBOE',
            };
          } catch {
            return null;
          }
        }));
        return results.filter(Boolean);
      }
      return [];
    }, { ttl: 15_000, staleTtl: 60_000 });
    if (!Array.isArray(cached.data)) throw cached.error || new Error('行情暂不可用');
    sendPerformanceJson(req, res, { success: true, scope, data: cached.data }, cached.status);
  } catch (error: any) {
    return res.json({ success: false, scope, error: error.message, data: [] });
  }
});

app.get('/api/risk/overview', async (req, res) => {
  try {
    const scope = requestedMarketScope(req.query.scope);
    const token = extractAuthToken(req as any);
    const auth = token ? verifyLoginToken(token) : null;
    if (auth?.role === 'guest' && scope === 'watchlist') {
      return res.status(403).json({ success: false, error: '访客模式不可查看自选和个人风险数据', code: 'GUEST_READ_ONLY' });
    }

    const needsPrediction = !scope || ['overview', 'prediction', 'watchlist'].includes(scope);
    const radar = needsPrediction ? getCachedPredictionRadarSlice('', 240) : null;

    const paper = paperEngine.getPortfolio();
    const metrics = paperEngine.getRiskMetrics();
    const report = lastAdvisorReport ?? {
      journal: { openTrades: getAssistantJournalTrades().filter(trade => trade.status === 'OPEN') },
      regime: { labelZh: '本地快照（后台刷新中）' },
      context: {},
    };
    if (!lastAdvisorReport) refreshAdvisorReportInBackground();

    const scopedReport = scope && scope !== 'overview' && scope !== 'watchlist' ? filterAssistantReport(report, scope) : report;

    const scopedPaper = !needsPrediction
      ? { ...paper, cashBalance: paper.startingBalance, positions: [], tradeLog: [], totalPnl: 0, winsCount: 0, lossesCount: 0, maxDrawdownPct: 0, peakEquity: paper.startingBalance }
      : paper;

    const scopedMetrics = !needsPrediction
      ? { var95Usd: 0, profitFactor: 0, winRate: 0 }
      : metrics;

    const rawOverview = buildPortfolioRiskOverview(scopedReport, scopedPaper, scopedMetrics, {
      ready: !needsPrediction ? true : !!radar,
      markets: needsPrediction ? radar?.markets || [] : [],
    });
    const overview = scope && scope !== 'overview' && scope !== 'watchlist'
      ? filterRiskOverview(rawOverview, scope)
      : rawOverview;
    await recordRiskHistory(overview, scope || 'overview');
    sendPerformanceJson(req, res, {
      success: true,
      data: overview,
      scope,
      sourceStatus: 'ok',
      updatedAt: overview.updatedAt || new Date().toISOString()
    }, 'ok');
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/risk/history', (req, res) => {
  try {
    const limit = Number(req.query.limit || 72);
    const scope = requestedMarketScope(req.query.scope);
    res.json({ success: true, data: getRiskHistory(Number.isFinite(limit) ? limit : 72, scope) });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/research/daily-briefing', (req, res) => {
  try {
    const scope = requestedMarketScope(req.query.scope) || 'overview';
    const isPredictionOrOverview = scope === 'overview' || scope === 'prediction';

    const radar = isPredictionOrOverview ? getCachedPredictionRadarSlice('', 240) : null;
    if (isPredictionOrOverview && !radar) void warmPredictionRadarCache();

    const rawLedger = unifiedPaperLedgerStore.get();
    const scopedLedger = filterUnifiedPaperLedger(rawLedger, scope);
    const perf = calculateUnifiedPerformance(scopedLedger);
    const closedCount = scopedLedger.orders.filter(order => order.side === 'SELL' && Number.isFinite(order.pnlUsd)).length;

    const briefing = buildDailyResearchBriefing({
      scope,
      markets: radar?.markets || [],
      radarReady: !!radar,
      paper: {
        equity: perf.equity,
        cashBalance: perf.cash,
        openPositionsValue: perf.equity - perf.cash,
        totalPnl: perf.totalPnl,
        winRate: perf.winRate,
        openCount: perf.positions,
        closedCount: closedCount,
        maxDrawdownPct: perf.maxDrawdownPct,
      },
      metrics: { var95Usd: 0, profitFactor: 1 }, // var95Usd and profitFactor not fully mapped from unified, use fallback
      forecastLab: isPredictionOrOverview ? getForecastLabReport() : {
        updatedAt: new Date().toISOString(),
        activeCount: 0,
        resolvedCount: 0,
        evaluatedCases: 0,
        evaluatedSamples: 0,
        model: { cases: 0, samples: 0, brier: 0, logLoss: 0, hitRatePct: 0 },
        market: { cases: 0, samples: 0, brier: 0, logLoss: 0, hitRatePct: 0 },
        modelEdgePct: 0,
        verdictZh: '非预测市场视图',
        calibration: [],
        platforms: [],
        groups: [],
        confidenceGroups: [],
        activeCases: [],
        resolvedCases: [],
        noteZh: ''
      },
    });

    sendPerformanceJson(req, res, {
      success: true,
      data: briefing,
      scope,
      sourceStatus: briefing.sourceStatus || 'ok',
      updatedAt: new Date().toISOString()
    }, 'ok');
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/calibration', (req, res) => {
  try {
    res.json({ success: true, data: getAssistantCalibration(requestedMarketScope(req.query.scope)) });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/export/journal', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="moneymoney-signals.csv"');
  res.send(exportJournalCsv(requestedMarketScope(req.query.scope)));
});

app.get('/api/export/paper', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="moneymoney-paper-trades.csv"');
  res.send(exportPaperCsv(requestedMarketScope(req.query.scope)));
});

app.get('/api/export/calibration', (req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="moneymoney-calibration.csv"');
  res.send(exportCalibrationCsv(requestedMarketScope(req.query.scope)));
});

app.get('/api/export/forecast-lab', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="moneymoney-forecast-lab.csv"');
  res.send(exportForecastLabCsv());
});

app.get('/api/export/radar', async (_req, res) => {
  try {
    const radar = await getPredictionRadar('', 500);
    const cell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = radar.markets.map(item => [
      item.platform,
      item.titleZh || item.title,
      item.title,
      item.group,
      (item.yesPrice * 100).toFixed(1),
      item.consensusProbability == null ? '' : (item.consensusProbability * 100).toFixed(1),
      Math.round(item.volume24h),
      Math.round(item.liquidity),
      item.endDate || '',
      item.url || '',
      item.signalZh || '',
    ].map(cell).join(','));
    const csv = '\uFEFF' + [
      ['平台', '中文标题', '原文标题', '分类', '概率%', '共识%', '24H成交$', '流动性$', '截止', '链接', '信号'].map(cell).join(','),
      ...rows,
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="prediction-radar.csv"');
    res.send(csv);
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

app.get('/api/advisor/risk-patrol', (_req, res) => {
  res.json({ success: true, data: riskPatrol.status() });
});

app.post('/api/advisor/risk-patrol/run', async (_req, res) => {
  try {
    res.json({ success: true, data: await riskPatrol.runOnce({ push: true }) });
  } catch (error: any) {
    res.json({ success: false, error: error.message });
  }
});

// --- Binance Feed ---

app.get('/api/binance/prices', async (req, res) => {
  const symbols = req.query.symbols ? (req.query.symbols as string).split(',') : ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];
  const prices = await binanceFeed.getMultiplePrices(symbols);
  res.json({ success: true, data: prices });
});

app.get('/api/binance/price/:symbol', async (req, res) => {
  const ticker = await binanceFeed.getPrice(req.params.symbol.toUpperCase());
  if (!ticker) return res.json({ success: false, error: '获取行情失败' });
  res.json({ success: true, data: ticker });
});

// --- Price Alerts ---

app.get('/api/alerts', (req, res) => {
  if (!adminOnly(req, res)) return;
  const scope = requestedMarketScope(req.query.scope);
  res.json({ success: true, data: scope && !['overview', 'crypto'].includes(scope) ? [] : alertManager.getAlerts() });
});

app.post('/api/alerts/add', async (req, res) => {
  if (!adminOnly(req, res)) return;
  const { symbol, targetPrice, direction } = req.body;
  const alert = alertManager.addAlert(symbol.toUpperCase(), parseFloat(targetPrice), direction.toUpperCase());
  res.json({ success: true, data: alert });
});

app.post('/api/alerts/remove', (req, res) => {
  if (!adminOnly(req, res)) return;
  const removed = alertManager.removeAlert(req.body.id);
  res.json({ success: removed, message: removed ? '预警已删除' : '未找到预警' });
});

// --- Anomaly Detection ---

app.get('/api/anomalies', async (req, res) => {
  try {
    const events = [];
    for (const symbol of ['BTCUSDT', 'ETHUSDT', 'BNBUSDT']) {
      const ticker = await binanceFeed.getPrice(symbol);
      if (!ticker) continue;
      anomalyDetector.recordTick(symbol, ticker.price, ticker.volume24hUsd);
      const anomaly = anomalyDetector.detect(symbol);
      if (anomaly) {
        events.push(anomaly);
        await telegram.send(`⚠️ <b>Anomaly Detected</b>\n\n${anomaly.message}`);
      }
    }
    res.json({ success: true, data: events });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- AI Analysis ---

app.post('/api/ai/market-analysis', async (req, res) => {
  try {
    const { title, prices, sentiment } = req.body;
    const analysis = await llmAnalyzer.summarizeMarket(title, prices, sentiment);
    if (!analysis) return res.json({ success: false, error: 'AI 分析不可用；请在 .env 中添加 GROQ_API_KEY' });
    res.json({ success: true, data: { analysis } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

app.post('/api/ai/market-commentary', async (req, res) => {
  try {
    const force = req.body?.force === true;
    const scope = requestedMarketScope(req.body?.scope) || 'prediction';
    const instrumentRef = String(req.body?.instrumentRef || '').trim();
    const context = { workspace: String(req.body?.workspace || 'analysis'), dataStatus: String(req.body?.dataStatus || 'unknown'), sourceRefs: Array.isArray(req.body?.sourceRefs) ? req.body.sourceRefs : [] };
    const radar = scope === 'prediction' || scope === 'overview'
      ? await getPredictionRadar('', 120)
      : { markets: [] };
    const report = scope === 'prediction'
      ? {}
      : filterAssistantReport(lastAdvisorReport ?? await generateAssistantReport(), scope);
    const result = await getAiMarketCommentary(radar, force, scope, report, instrumentRef, context);
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.json({
      success: false,
      error: e?.status === 429 ? 'AI 免费额度或上游通道暂时限流，请稍后再试。' : String(e?.message || e),
    });
  }
});

// --- Reddit Sentiment ---

app.get('/api/reddit', async (req, res) => {
  try {
    const posts = await redditSentiment.getPosts();
    res.json({ success: true, data: posts });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Whale Monitor ---

app.get('/api/whales', async (req, res) => {
  try {
    const scope = requestedMarketScope(req.query.scope);
    if (scope && !['overview', 'crypto'].includes(scope)) return res.json({ success: true, data: [] });
    const threshold = parseInt(String(req.query.threshold || '1000000'));
    const txs = await whaleMonitor.getRecentWhaleTransactions(threshold);
    res.json({ success: true, data: txs });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Strategy Comparison ---

app.get('/api/strategies', (req, res) => {
  res.json({ success: true, data: strategyComparison.get() });
});

app.post('/api/strategies/reset', (req, res) => {
  res.json({ success: true, data: strategyComparison.resetAll() });
});

// --- Trade Journal ---

app.get('/api/journal', (req, res) => {
  res.json({ success: true, data: tradeJournal.get(50) });
});

app.post('/api/journal/note', express.json(), (req, res) => {
  const { id, noteZh, tags } = req.body ?? {};
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ success: false, error: '缺少交易 ID' });
  }
  const ok = saveTradeNote(id, typeof noteZh === 'string' ? noteZh : '', Array.isArray(tags) ? tags.map(String) : []);
  if (!ok) return res.status(404).json({ success: false, error: '未找到该笔交易' });
  res.json({ success: true });
});

app.get('/api/journal/trades', (_req, res) => {
  const trades = getAssistantJournalTrades();
  res.json({ success: true, data: trades.map(t => ({
    id: t.id,
    venue: t.venue,
    symbol: t.symbol,
    title: t.title,
    direction: t.direction,
    result: t.result,
    rMultiple: t.rMultiple,
    confidencePct: t.confidencePct,
    openedAt: t.openedAt,
    closedAt: t.closedAt ?? '',
    status: t.status,
    noteZh: t.noteZh ?? '',
    tags: t.tags ?? [],
  })) });
});

// --- Binance Portfolio ---

app.get('/api/binance/portfolio', async (req, res) => {
  if (!binancePortfolio.isConfigured) {
    return res.json({ success: false, error: '请在 .env 中添加 BINANCE_API_KEY 和 BINANCE_API_SECRET（建议使用只读密钥）' });
  }
  const portfolio = await binancePortfolio.getPortfolio();
  if (!portfolio) return res.json({ success: false, error: '获取币安账户失败' });
  res.json({ success: true, data: portfolio });
});

// --- Portfolio Overview Dashboard (combines all data) ---

app.get('/api/overview', async (req, res) => {
  try {
    const [binancePrices, paperPortfolio, settings] = await Promise.all([
      binanceFeed.getMultiplePrices(['BTCUSDT', 'ETHUSDT']),
      Promise.resolve(paperEngine.getPortfolio()),
      Promise.resolve(settingsManager.get()),
    ]);

    const openPositions = paperEngine.getOpenPositions();
    const recentTrades = paperEngine.getRecentTrades(5);

    res.json({
      success: true,
      data: {
        crypto: binancePrices,
        paper: {
          equity: paperPortfolio.equity,
          totalPnl: paperPortfolio.totalPnl,
          winRate: paperPortfolio.winRate,
          openPositions: openPositions.length,
          maxDrawdown: paperPortfolio.maxDrawdownPct,
        },
        recentTrades,
        settings: { autoTradeEnabled: settings.autoTradeEnabled, paperTradingEnabled: settings.paperTradingEnabled },
        automation: getAutomationOverview(),
        timestamp: new Date().toISOString(),
      }
    });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Connection Info (for mobile sync) ---

app.get('/api/connection-info', async (req, res) => {
  try {
    const interfaces = os.networkInterfaces();
    let lanIp = '';
    // Find first non-internal IPv4 address (prefer Wi-Fi/Ethernet)
    for (const name of Object.keys(interfaces)) {
      if (/wi-?fi|ethernet|eth|wlan/i.test(name)) {
        const addr = interfaces[name]?.find(a => a.family === 'IPv4' && !a.internal);
        if (addr) { lanIp = addr.address; break; }
      }
    }
    if (!lanIp) {
      outer: for (const name of Object.keys(interfaces)) {
        for (const addr of interfaces[name] || []) {
          if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('127.')) {
            lanIp = addr.address; break outer;
          }
        }
      }
    }

    const url = `http://${lanIp}:${config.appPort}`;
    const qrDataUrl = await QRCode.toDataURL(url, { width: 300, margin: 1 });

    res.json({ success: true, data: { lanIp, url, qrCode: qrDataUrl } });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// Serve service worker with correct MIME type
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Serve manifest
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

// --- Notification Center ---

import { pushNotification as pushNotif, getNotifications, markAllRead } from '../features/notifications';


// --- Response Cache ---
const responseCache = new Map<string, { data: any; ts: number }>();
const externalLoads = new Map<string, Promise<any>>();
const CACHE_TTL = 60_000; // 60 seconds

function getCached(key: string): any | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    responseCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key: string, data: any) {
  responseCache.set(key, { data, ts: Date.now() });
  if (responseCache.size > 500) {
    const oldest = [...responseCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0];
    if (oldest) responseCache.delete(oldest[0]);
  }
}

async function getFreshExternal<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const entry = responseCache.get(key) as { data: T; ts: number } | undefined;
  if (entry && Date.now() - entry.ts <= ttlMs) return entry.data;
  const pending = externalLoads.get(key);
  if (pending) return pending;

  const request = loader().then(data => {
    responseCache.set(key, { data, ts: Date.now() });
    return data;
  }).finally(() => {
    externalLoads.delete(key);
  });
  externalLoads.set(key, request);
  return request;
}


app.get('/api/notifications', (req, res) => {
  res.json({ success: true, data: getNotifications() });
});

import { researchJobsRouter } from '../features/research-jobs-router';

// --- Research Workspace ---

app.use('/api/research', researchJobsRouter);

// Factor research and candidate promotion are intentionally server-gated.
// The catalog describes available calculations only; it never fabricates
// observations when the corresponding market dataset is unavailable.
app.get('/api/research/factors/catalog', (req, res) => {
  try {
    const market = String(req.query.market || '').trim() as MarketId;
    if (!MARKET_IDS.includes(market)) return res.status(400).json({ success: false, error: '必须指定有效市场' });
    const data = getFactorCatalog(market);
    return res.json({ success: true, data, market, instrument: null, dataStatus: 'live', source: 'moneymoney-factor-catalog', updatedAt: new Date().toISOString(), reason: null });
  } catch (error: any) { return res.status(400).json({ success: false, error: error?.message || '因子目录不可用' }); }
});

app.post('/api/research/factors/analyze', express.json(), (req, res) => {
  try {
    const body = req.body || {};
    const market = String(body.market || '').trim() as MarketId;
    const instrument = body.instrument ? String(body.instrument).trim() : undefined;
    assertMarketContext({ market, workspace: 'factor-analysis', instrument });
    if (!Array.isArray(body.values) || !Array.isArray(body.forwardReturns)) throw new Error('因子分析需要 values 和 forwardReturns 数组');
    const result = analyzeFactor({
      market, factorId: String(body.factorId || '').trim(),
      values: body.values.map(Number), forwardReturns: body.forwardReturns.map(Number),
      quantiles: body.quantiles,
    });
    return res.json({ success: true, data: { ...result, instrument: instrument || null }, market, instrument: instrument || null, dataStatus: 'live', source: 'local-factor-engine', updatedAt: new Date().toISOString(), reason: null });
  } catch (error: any) { return res.status(400).json({ success: false, error: error?.message || '因子分析失败' }); }
});

app.get('/api/research/candidates', (req, res) => {
  try {
    const rawMarket = String(req.query.market || '').trim();
    const market = rawMarket ? rawMarket as MarketId : undefined;
    if (market && !MARKET_IDS.includes(market)) return res.status(400).json({ success: false, error: '市场范围无效' });
    const data = strategyCandidateRegistry.list(market);
    return res.json({ success: true, data, market: market || 'all', instrument: null, dataStatus: 'live', source: 'research-repository', updatedAt: new Date().toISOString(), reason: null });
  } catch (error: any) { return res.status(400).json({ success: false, error: error?.message || '候选策略读取失败' }); }
});

app.post('/api/research/candidates', express.json(), (req, res) => {
  try {
    const body = req.body || {};
    const metrics = body.metrics && typeof body.metrics === 'object' ? {
      ...(body.metrics.oosReturnPct !== undefined ? { oosReturnPct: Number(body.metrics.oosReturnPct) } : {}),
      ...(body.metrics.trades !== undefined ? { trades: Number(body.metrics.trades) } : {}),
    } : {};
    const candidate = strategyCandidateRegistry.saveDraft({ id: String(body.id || '').trim(), market: String(body.market || '').trim() as MarketId, instrument: body.instrument ? String(body.instrument).trim() : undefined, version: String(body.version || '').trim(), metrics });
    return res.status(201).json({ success: true, data: candidate, market: candidate.market, instrument: candidate.instrument || null, dataStatus: 'live', source: 'research-repository', updatedAt: new Date(candidate.updatedAt).toISOString(), reason: null });
  } catch (error: any) { return res.status(400).json({ success: false, error: error?.message || '候选策略无效' }); }
});

app.post('/api/research/candidates/:id/evaluate', express.json(), (req, res) => {
  try {
    const body = req.body || {};
    const candidate = strategyCandidateRegistry.evaluate(String(req.params.id), {
      minOutOfSampleReturnPct: body.minOutOfSampleReturnPct === undefined ? 0 : Number(body.minOutOfSampleReturnPct),
      minTrades: body.minTrades === undefined ? 1 : Number(body.minTrades),
    });
    return res.json({ success: true, data: candidate, market: candidate.market, instrument: candidate.instrument || null, dataStatus: 'live', source: 'research-repository', updatedAt: new Date(candidate.updatedAt).toISOString(), reason: candidate.gate.passed ? null : candidate.gate.reasons.join('、') });
  } catch (error: any) { return res.status(400).json({ success: false, error: error?.message || '候选策略评估失败' }); }
});

app.post('/api/research/candidates/:id/approve', express.json(), (req, res) => {
  try {
    const candidate = strategyCandidateRegistry.approve(String(req.params.id));
    return res.json({ success: true, data: candidate, market: candidate.market, instrument: candidate.instrument || null, dataStatus: 'live', source: 'research-repository', updatedAt: new Date(candidate.updatedAt).toISOString(), reason: null });
  } catch (error: any) { return res.status(409).json({ success: false, error: error?.message || '候选策略未达到发布门槛' }); }
});

app.post('/api/research/candidates/:id/reject', express.json(), (req, res) => {
  try {
    const candidate = strategyCandidateRegistry.reject(String(req.params.id));
    return res.json({ success: true, data: candidate, market: candidate.market, instrument: candidate.instrument || null, dataStatus: 'live', source: 'research-repository', updatedAt: new Date(candidate.updatedAt).toISOString(), reason: null });
  } catch (error: any) { return res.status(400).json({ success: false, error: error?.message || '候选策略处理失败' }); }
});

app.post('/api/research/experiments', express.json(), (req, res) => {
  try {
    const body = req.body || {};
    const context = {
      market: String(body.market || body.scope || '').trim() as MarketId,
      workspace: String(body.workspace || 'backtest'),
      instrument: body.instrument ? String(body.instrument) : undefined,
      timeframe: body.timeframe ? String(body.timeframe) : undefined,
      dataStatus: body.dataStatus,
      dataSource: body.dataSource ? String(body.dataSource) : undefined,
      dataFrom: body.dataFrom ? String(body.dataFrom) : undefined,
      dataTo: body.dataTo ? String(body.dataTo) : undefined,
      dataSnapshotHash: body.dataSnapshotHash ? String(body.dataSnapshotHash) : undefined,
      strategyId: body.strategyId ? String(body.strategyId) : undefined,
      strategyVersion: body.strategyVersion ? String(body.strategyVersion) : undefined,
      feeRate: body.feeRate == null ? undefined : Number(body.feeRate), slippage: body.slippage == null ? undefined : Number(body.slippage), seed: body.seed,
    };
    const result = runResearchExperiment({
      context,
      prices: Array.isArray(body.prices) ? body.prices.map(Number) : [],
      signals: Array.isArray(body.signals) ? body.signals : [],
      split: body.split,
      promotion: body.promotion,
    });

    // Save to SQLite for persistence
    researchRepository.saveExperiment(result.experiment.id, {
      ...result,
      input: { context, prices: body.prices || [], signals: body.signals || [], split: body.split, promotion: body.promotion },
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : '实验配置无效' });
  }
});

app.get('/api/research/experiments', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market);
    const instrument=String(req.query.instrument || '').trim();
    if(instrument) assertMarketContext({market,workspace:'research-lab',instrument});
    const data = researchRepository.listExperiments(200).filter(row => row.experiment?.market === market && (!instrument || row.experiment.instrument===instrument)).map(row => ({ ...row.experiment, metrics: row.backtest?.metrics, outOfSample: row.evidence?.outOfSample }));
    return res.json({ success: true, market, data, dataStatus: data.length ? 'historical' : 'empty', source: '持久化研究实验', updatedAt: new Date().toISOString(), reason: data.length ? null : '当前市场尚无研究实验' });
  } catch (error) { return res.status(400).json({ success: false, reason: error instanceof Error ? error.message : '查询失败' }); }
});
app.get('/api/research/experiments/compare', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const ids = String(req.query.ids || '').split(',').filter(Boolean);
    if (ids.length < 2 || ids.length > 6) throw new Error('请选择2–6个实验');
    const results = ids.map(id => researchRepository.getExperiment(id));
    if (results.some(row => !row)) return res.status(404).json({ success: false, reason: '实验不存在' });
    const data = compareExperiments(results);
    const comparison = { ...data, experiments: data.experiments.map(row => ({ ...row,
      freshness: getResearchFreshness({ market: row.market, instrument: row.instrument, timeframe: row.timeframe, createdAt: row.createdAt,
        dataSnapshotHash: row.dataSnapshotHash, strategyId: row.strategyId, strategyVersion: row.strategyVersion }) })) };
    return res.json({ success: true, market: data.market, data: comparison, dataStatus: 'historical', source: '持久化实验原始结果', updatedAt: new Date().toISOString(), reason: data.reason });
  } catch (error) { return res.status(400).json({ success: false, reason: error instanceof Error ? error.message : '比较失败' }); }
});
app.get('/api/research/experiments/:id', (req, res) => {
  if (!adminOnly(req, res)) return;
  const result = researchRepository.getExperiment(String(req.params.id));
  if (!result) return res.status(404).json({ success: false, error: '实验不存在' });
  const experiment = result.experiment || {};
  res.json({ success: true, data: result, market: experiment.market || null, instrument: experiment.instrument || null, dataStatus: result.evidence?.checks?.data?.passed ? 'live' : 'unavailable', source: experiment.dataSource || null, updatedAt: experiment.createdAt || null, reason: result.evidence?.checks?.data?.passed ? null : '实验未声明可用数据源' });
});
app.get('/api/research/experiments/:id/links',(req,res)=>{
  if(!adminOnly(req,res))return;
  const id=String(req.params.id),result=researchRepository.getExperiment(id);
  if(!result)return res.status(404).json({success:false,reason:'实验不存在'});
  const market=result.experiment.market;
  const signals=researchRepository.getAllSignals().filter((row:any)=>row.market===market && row.experimentId===id).map((row:any)=>({id:row.id,instrument:row.instrument,evidenceRefs:row.evidenceRefs || []}));
  const type=({stocks:'stock',crypto:'crypto',options:'option',prediction:'prediction'} as Record<string,string>)[market];
  const orders=unifiedPaperLedgerStore.get().orders.filter(row=>row.instrumentType===type && row.experimentId===id).map(row=>({id:row.id,instrument:row.instrumentId,signalId:row.signalId || null,timestamp:row.timestamp}));
  const decisions=decisionIntelligenceStore.listDecisions(market).filter((row:any)=>row.experimentId===id).map(row=>({id:row.id,instrument:row.instrument}));
  res.json({success:true,market,data:{signals,orders,decisions},dataStatus:signals.length || orders.length || decisions.length?'historical':'empty',reason:'只按显式实验 ID 建立关联；旧记录未关联，不按时间或策略名称猜测配对'});
});

function getResearchFreshness(input: { market: MarketId; instrument?: string; timeframe?: string; createdAt: string; dataSnapshotHash?: string; strategyId?: string; strategyVersion?: string }) {
  const revisions = dataLakeCatalog.listRevisions(input.market);
  const corporateActions = input.market === 'stocks' && input.instrument
    ? dataLakeCatalog.listCorporateActions('stocks', input.instrument.replace(/^stock:(us|nasdaq|nyse):/i, '').replace(/^us(?=[a-z])/i, ''))
    : [];
  const currentStrategyVersion = input.strategyId && ['momentum', 'meanReversion'].includes(input.strategyId)
    ? ASSET_BACKTEST_STRATEGY_VERSION
    : input.strategyId ? globalStrategyRegistry.get(input.strategyId)?.version : undefined;
  return assessResearchFreshness({ ...input, revisions, corporateActions, currentStrategyVersion });
}

app.get('/api/research/experiments/:id/freshness', (req, res) => {
  if (!adminOnly(req, res)) return;
  const result = researchRepository.getExperiment(String(req.params.id));
  if (!result?.experiment) return res.status(404).json({ success: false, error: '实验不存在' });
  try {
    const experiment = result.experiment;
    const freshness = getResearchFreshness({
      market: decisionMarket(experiment.market), instrument: experiment.instrument, timeframe: experiment.timeframe,
      createdAt: experiment.createdAt, dataSnapshotHash: experiment.dataSnapshotHash,
      strategyId: experiment.strategyId, strategyVersion: experiment.strategyVersion,
    });
    return res.json({ success: true, data: freshness, market: experiment.market, instrument: experiment.instrument || null, dataStatus: freshness.status, source: 'research-freshness', updatedAt: new Date().toISOString(), reason: freshness.reason, manualRerunAvailable: Boolean(result.input) });
  } catch (error) { return res.status(400).json({ success: false, error: error instanceof Error ? error.message : '研究时效检查失败' }); }
});

app.get('/api/research/freshness', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const market = decisionMarket(req.query.market);
    const instrument = String(req.query.instrument || '').trim();
    const createdAt = String(req.query.since || '').trim();
    if (!instrument || !createdAt) return res.status(400).json({ success: false, error: '缺少标的或候选保存时间' });
    const freshness = getResearchFreshness({
      market, instrument, timeframe: String(req.query.timeframe || '') || undefined, createdAt,
      dataSnapshotHash: String(req.query.snapshotHash || '') || undefined,
      strategyId: String(req.query.strategyId || '') || undefined,
      strategyVersion: String(req.query.strategyVersion || '') || undefined,
    });
    return res.json({ success: true, data: freshness, market, instrument, dataStatus: freshness.status, source: 'research-freshness', updatedAt: new Date().toISOString(), reason: freshness.reason });
  } catch (error) { return res.status(400).json({ success: false, error: error instanceof Error ? error.message : '研究时效检查失败' }); }
});

app.post('/api/research/experiments/:id/rerun', express.json(), (req, res) => {
  try {
    const previous = researchRepository.getExperiment(String(req.params.id)) as any;
    if (!previous?.input) return res.status(409).json({ success: false, error: '实验缺少可复现输入，无法重跑' });
    const input = { ...previous.input, ...(req.body?.overrides || {}) };
    const result = runResearchExperiment(input);
    researchRepository.saveExperiment(result.experiment.id, { ...result, input });
    res.json({ success: true, data: result, rerunOf: String(req.params.id) });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error?.message || '实验重跑失败' });
  }
});

app.get('/api/research', (req, res) => {
  const scope = requestedMarketScope(req.query.scope);
  const entries = listResearchEntries(Number(req.query.limit) || 50).filter(entry => {
    if (!scope || scope === 'overview' || scope === 'watchlist') return true;
    const entryScope = entry.subjectType === 'crypto' ? 'crypto' : entry.subjectType === 'prediction' ? 'prediction' : entry.subjectType === 'stock' || entry.subjectType === 'macro' ? 'stocks' : entry.subjectType === 'option' ? 'options' : null;
    return entryScope === scope;
  });
  res.json({ success: true, data: entries.map(entry => ({ ...entry, summary: summarizeResearchEntry(entry) })) });
});

app.get('/api/research/:id', (req, res) => {
  const entry = getResearchEntry(String(req.params.id));
  if (!entry) return res.status(404).json({ success: false, error: '研究对象不存在' });
  res.json({ success: true, data: { ...entry, summary: summarizeResearchEntry(entry) } });
});

app.post('/api/research', (req, res) => {
  try {
    const { subjectType, subjectId, title, thesis, tags, id } = req.body || {};
    if (!['prediction', 'crypto', 'stock', 'macro'].includes(subjectType) || !String(subjectId || '').trim() || !String(title || '').trim()) {
      return res.status(400).json({ success: false, error: '请填写有效的研究类型、标识和标题' });
    }
    const entry = upsertResearchEntry({ id, subjectType, subjectId, title, thesis, tags: Array.isArray(tags) ? tags : [] });
    res.json({ success: true, data: { ...entry, summary: summarizeResearchEntry(entry) } });
  } catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});

app.post('/api/research/:id/note', (req, res) => {
  try {
    const entry = addResearchNote(String(req.params.id), req.body?.text, Array.isArray(req.body?.tags) ? req.body.tags : []);
    if (!entry) return res.status(404).json({ success: false, error: '研究对象不存在' });
    res.json({ success: true, data: { ...entry, summary: summarizeResearchEntry(entry) } });
  } catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});

app.post('/api/research/:id/snapshot', (req, res) => {
  try {
    const snapshot = { ...req.body, capturedAt: req.body?.capturedAt || new Date().toISOString(), sources: Array.isArray(req.body?.sources) ? req.body.sources : [] };
    const entry = addResearchSnapshot(String(req.params.id), snapshot);
    if (!entry) return res.status(404).json({ success: false, error: '研究对象不存在' });
    res.json({ success: true, data: { ...entry, summary: summarizeResearchEntry(entry) } });
  } catch (error: any) { res.status(400).json({ success: false, error: error.message }); }
});

app.post('/api/notifications/mark-read', (req, res) => {
  markAllRead();
  res.json({ success: true });
});

// --- Paper Trading APIs ---

function paperDriftSamples() {
  return collectPaperDriftSamples(unifiedPaperLedgerStore.get().orders, {
    experiment: id => researchRepository.getExperiment(id),
    snapshot: id => dataLakeCatalog.getSnapshot(id),
  });
}

const PAPER_DRIFT_MONITOR_LAST_RUN_KEY = 'paper-drift-monitor:last-run-at';
const PAPER_DRIFT_MONITOR_LEASE_KEY = 'paper-drift-monitor:daily-evaluation';
const paperDriftMonitorOwner = `paper-drift-monitor-${process.pid}-${crypto.randomUUID()}`;

async function evaluatePaperDriftMonitor(force = false, now = new Date()): Promise<{
  ran: boolean; evaluatedAt: string; strategies: number; pausedTransitions: number; reason: string | null;
}> {
  if (!force && !shouldRunOncePerShanghaiDay(stateStore.get<string>(PAPER_DRIFT_MONITOR_LAST_RUN_KEY), now)) {
    return { ran: false, evaluatedAt: now.toISOString(), strategies: 0, pausedTransitions: 0, reason: '今日策略偏差复核已完成或尚未到上海时间09:00' };
  }
  if (!stateStore.acquireLease(PAPER_DRIFT_MONITOR_LEASE_KEY, paperDriftMonitorOwner, now.getTime(), 20 * 60_000)) {
    throw new Error('策略偏差日常复核正在其他进程运行');
  }
  try {
    const marketForType = { stock: 'stocks', option: 'options', crypto: 'crypto', prediction: 'prediction' } as const;
    const orders = unifiedPaperLedgerStore.get().orders;
    const identities = new Map<string, { market: MarketId; strategyId: string; strategyVersion: string }>();
    for (const order of orders) {
      if (!order.strategy || !order.strategyVersion || !order.experimentId || !order.signalId || !order.dataSnapshotId || !Number.isInteger(order.backtestTradeIndex)) continue;
      const market = marketForType[order.instrumentType];
      const key = `${market}\0${order.strategy}\0${order.strategyVersion}`;
      identities.set(key, { market, strategyId: order.strategy, strategyVersion: order.strategyVersion });
    }
    const samples = paperDriftSamples();
    let pausedTransitions = 0;
    for (const identity of identities.values()) {
      const result = analyzePaperDrift(samples.filter(item => item.market === identity.market && item.strategyId === identity.strategyId && item.strategyVersion === identity.strategyVersion), now);
      if (driftGate.recordEvaluation(identity.market, identity.strategyId, identity.strategyVersion, result)) {
        pausedTransitions += 1;
        const message = `${identity.market}/${identity.strategyId}@${identity.strategyVersion} 模拟盘与回测偏差超出既有门槛；仅该策略信号提醒已暂停，价格/风险/来源故障提醒和模拟持仓不受影响，需管理员确认恢复。`;
        pushNotification('risk', message);
        void telegram.send(`⚠️ ${message}`).catch(() => {});
      }
    }
    const evaluatedAt = now.toISOString();
    stateStore.set(PAPER_DRIFT_MONITOR_LAST_RUN_KEY, evaluatedAt, 1);
    stateStore.appendAudit({ id: `paper-drift-evaluation-${evaluatedAt}`, action: 'paper_drift_daily_evaluation', detail: `每日复核 ${identities.size} 个策略版本，新增暂停 ${pausedTransitions} 个` });
    return { ran: true, evaluatedAt, strategies: identities.size, pausedTransitions, reason: identities.size ? null : '没有带完整实验、信号、快照和成交索引的策略版本' };
  } finally {
    stateStore.releaseLease(PAPER_DRIFT_MONITOR_LEASE_KEY, paperDriftMonitorOwner);
  }
}

function runPaperDriftMonitor(force = false): Promise<Awaited<ReturnType<typeof evaluatePaperDriftMonitor>>> {
  if (paperDriftMonitorTask) return paperDriftMonitorTask as Promise<Awaited<ReturnType<typeof evaluatePaperDriftMonitor>>>;
  paperDriftMonitorTask = evaluatePaperDriftMonitor(force).finally(() => { paperDriftMonitorTask = null; });
  return paperDriftMonitorTask as Promise<Awaited<ReturnType<typeof evaluatePaperDriftMonitor>>>;
}

function startPaperDriftMonitor(): void {
  if (paperDriftMonitorTimer) return;
  void runPaperDriftMonitor().catch(error => {
    if (!/other process|正在其他进程/.test(String(error?.message || error))) logger.warn('paper_drift_daily_evaluation_failed', { error: String(error?.message || error) });
  });
  paperDriftMonitorTimer = setInterval(() => {
    void runPaperDriftMonitor().catch(error => {
      if (!/other process|正在其他进程/.test(String(error?.message || error))) logger.warn('paper_drift_daily_evaluation_failed', { error: String(error?.message || error) });
    });
  }, 15 * 60_000);
  paperDriftMonitorTimer.unref?.();
}

function stopPaperDriftMonitor(): void {
  if (paperDriftMonitorTimer) clearInterval(paperDriftMonitorTimer);
  paperDriftMonitorTimer = null;
}

function validatePaperOrderReferences(order: UnifiedPaperOrder): void {
  const fields = [order.experimentId, order.signalId, order.dataSnapshotId, order.strategyVersion];
  if (!fields.some(Boolean) && order.backtestTradeIndex === undefined) return;
  const market = ({ stock: 'stocks', option: 'options', crypto: 'crypto', prediction: 'prediction' } as const)[order.instrumentType];
  if (order.strategyVersion && !order.strategy) throw new Error('策略版本必须关联策略');
  if (order.backtestTradeIndex !== undefined && (!order.experimentId || !Number.isInteger(order.backtestTradeIndex) || order.backtestTradeIndex < 0)) throw new Error('回测成交索引必须关联有效实验');
  if (order.experimentId) {
    const experiment = researchRepository.getExperiment(order.experimentId);
    if (!experiment || experiment.experiment?.market !== market ||
        !samePaperInstrument(market, order.instrumentId, experiment.experiment?.instrument || '') ||
        (order.strategy && experiment.experiment?.strategyId !== order.strategy) ||
        (order.strategyVersion && experiment.experiment?.strategyVersion !== order.strategyVersion) ||
        (order.backtestTradeIndex !== undefined && !experiment.backtest?.trades?.[order.backtestTradeIndex])) throw new Error('模拟订单实验与市场、标的或策略不匹配');
  }
  if (order.dataSnapshotId) {
    const snapshot = dataLakeCatalog.getSnapshot(order.dataSnapshotId);
    if (!snapshot || snapshot.market !== market || !samePaperInstrument(market, order.instrumentId, snapshot.instrument)) throw new Error('证据快照与市场或标的不匹配');
    const snapshotTime = Date.parse(snapshot.asOf);
    const orderTime = Date.parse(order.timestamp);
    if (!Number.isFinite(snapshotTime) || snapshotTime > orderTime || orderTime - snapshotTime > 72 * 60 * 60 * 1000) throw new Error('证据快照过期或晚于模拟订单');
  }
}

app.get('/api/research/drift', (req, res) => {
  if (!adminOnly(req, res)) return;
  const market = String(req.query.market || '') as MarketId;
  if (!MARKET_IDS.includes(market)) return res.status(400).json({ success: false, dataStatus: 'failed', reason: '必须指定有效市场' });
  const strategyId = String(req.query.strategyId || '');
  const strategyVersion = String(req.query.strategyVersion || '');
  const samples = paperDriftSamples().filter(item => item.market === market && (!strategyId || item.strategyId === strategyId) && (!strategyVersion || item.strategyVersion === strategyVersion));
  const marketForType = { stock: 'stocks', option: 'options', crypto: 'crypto', prediction: 'prediction' } as const;
  const orders = unifiedPaperLedgerStore.get().orders.filter(order => marketForType[order.instrumentType] === market && (!strategyId || order.strategy === strategyId) && (!strategyVersion || order.strategyVersion === strategyVersion));
  const coverage = summarizePaperDriftCoverage(orders, {
    experiment: id => researchRepository.getExperiment(id),
    snapshot: id => dataLakeCatalog.getSnapshot(id),
  });
  const result = analyzePaperDrift(samples);
  const results = analyzePaperDriftByStrategy(samples);
  res.json({ success: true, market, instrument: null, dataStatus: coverage.freshPairs ? 'historical' : coverage.stalePairs ? 'partial' : 'empty', source: 'paired research experiment + unified paper ledger', updatedAt: result.evaluatedAt, reason: coverage.freshPairs ? null : coverage.stalePairs ? '已有配对但数据快照过期，暂不判断策略偏差' : '没有可评估的明确配对成交', data: { result: strategyId && strategyVersion ? result : null, results, coverage, gates: driftGate.list(market), history: driftGate.listHistory(market, strategyId || undefined, strategyVersion || undefined, 30) } });
});

app.get('/api/research/drift/history', (req, res) => {
  if (!adminOnly(req, res)) return;
  const market = req.query.market == null ? undefined : String(req.query.market) as MarketId;
  if (market && !MARKET_IDS.includes(market)) return res.status(400).json({ success: false, dataStatus: 'failed', reason: '市场范围无效' });
  const strategyId = String(req.query.strategyId || '').trim() || undefined;
  const strategyVersion = String(req.query.strategyVersion || '').trim() || undefined;
  const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
  const data = driftGate.listHistory(market, strategyId, strategyVersion, limit);
  res.json({ success: true, data, market: market || 'all', instrument: null, dataStatus: data.length ? 'historical' : 'empty', source: 'SQLite per-strategy-version drift evaluation history', updatedAt: data[0]?.result.evaluatedAt || null, reason: data.length ? null : '暂无策略偏差复核记录' });
});

app.post('/api/research/drift/evaluate', async (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const result = await runPaperDriftMonitor(true);
    res.json({ success: true, data: result, dataStatus: result.ran ? 'historical' : 'empty', source: 'manual strategy drift evaluation', updatedAt: result.evaluatedAt, reason: result.reason });
  } catch (error: any) {
    res.status(409).json({ success: false, dataStatus: 'partial', source: 'manual strategy drift evaluation', updatedAt: new Date().toISOString(), reason: error?.message || '策略偏差复核失败' });
  }
});

app.post('/api/research/drift/resume', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const market = String(req.body?.market || '') as MarketId;
  const strategyId = String(req.body?.strategyId || '').trim();
  const strategyVersion = String(req.body?.strategyVersion || '').trim();
  if (!MARKET_IDS.includes(market) || !strategyId || !strategyVersion) return res.status(400).json({ success: false, reason: '需指定市场、策略和版本' });
  const resumed = driftGate.resume(market, strategyId, strategyVersion);
  if (resumed) stateStore.appendAudit({ id: `paper-drift-resume-${crypto.randomUUID()}`, action: 'paper_drift_strategy_resumed', detail: `管理员确认恢复 ${market}/${strategyId}@${strategyVersion} 的信号提醒` });
  res.status(resumed ? 200 : 404).json({ success: resumed, market, instrument: null, dataStatus: resumed ? 'live' : 'empty', source: 'strategy drift gate', updatedAt: new Date().toISOString(), reason: resumed ? '管理员已恢复此策略提醒' : '没有待恢复的策略提醒暂停记录' });
});

// Canonical cross-asset paper ledger. Legacy prediction-market endpoints below
// remain untouched for existing clients and stored portfolios.
app.get('/api/paper/ledger', (req, res) => {
  const ledger = unifiedPaperLedgerStore.get();
  const scope = requestedMarketScope(req.query.scope);
  res.json({ success: true, data: scope ? filterUnifiedPaperLedger(ledger, scope) : ledger });
});
app.get('/api/paper/positions', (req, res) => {
  const ledger = unifiedPaperLedgerStore.get();
  const scope = requestedMarketScope(req.query.scope);
  res.json({ success: true, data: scope ? filterUnifiedPaperLedger(ledger, scope).positions : ledger.positions });
});
app.get('/api/paper/performance', (req, res) => {
  const ledger = unifiedPaperLedgerStore.get();
  const scope = requestedMarketScope(req.query.scope);
  res.json({ success: true, data: scope ? calculateUnifiedPerformance(filterUnifiedPaperLedger(ledger, scope)) : unifiedPaperLedgerStore.performance() });
});
app.post('/api/paper/orders', (req, res) => {
  try {
    const body = req.body || {};
    const order: UnifiedPaperOrder = {
      id: String(body.id || `paper_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      instrumentId: String(body.instrumentId || ''), instrumentType: body.instrumentType, title: String(body.title || ''), side: body.side,
      price: Number(body.price), quantity: Number(body.quantity), timestamp: String(body.timestamp || new Date().toISOString()), strategy: body.strategy ? String(body.strategy) : undefined, reason: body.reason ? String(body.reason) : undefined,
      strategyVersion: body.strategyVersion ? String(body.strategyVersion) : undefined,
      experimentId: body.experimentId ? String(body.experimentId) : undefined,
      signalId: body.signalId ? String(body.signalId) : undefined,
      dataSnapshotId: body.dataSnapshotId ? String(body.dataSnapshotId) : undefined,
      backtestTradeIndex: body.backtestTradeIndex === undefined ? undefined : Number(body.backtestTradeIndex),
      feeUsd: Number.isFinite(Number(body.feeUsd)) ? Number(body.feeUsd) : undefined,
      slippageUsd: Number.isFinite(Number(body.slippageUsd)) ? Number(body.slippageUsd) : undefined,
    };
    validatePaperOrderReferences(order);
    const ledger = unifiedPaperLedgerStore.apply(order);
    if (order.strategy && order.strategyVersion && order.experimentId) {
      const samples = paperDriftSamples().filter(item => item.market === ({ stock: 'stocks', option: 'options', crypto: 'crypto', prediction: 'prediction' } as const)[order.instrumentType] && item.strategyId === order.strategy && item.strategyVersion === order.strategyVersion);
      const result = analyzePaperDrift(samples);
      const market = ({ stock: 'stocks', option: 'options', crypto: 'crypto', prediction: 'prediction' } as const)[order.instrumentType];
      if (driftGate.recordEvaluation(market, order.strategy, order.strategyVersion, result)) {
        const message = `${market}/${order.strategy}@${order.strategyVersion} 模拟盘与回测偏差超出门槛；仅策略信号提醒已暂停，需管理员复核恢复。`;
        pushNotification('risk', message);
        void telegram.send(`⚠️ ${message}`).catch(() => {});
      }
    }
    res.status(201).json({ success: true, data: { order, ledger, performance: calculateUnifiedPerformance(ledger) } });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || '统一模拟订单无效' }); }
});
app.get('/api/paper/orders/:id', (req, res) => {
  const order = unifiedPaperLedgerStore.get().orders.find(item => item.id === String(req.params.id));
  if (!order) return res.status(404).json({ success: false, error: '模拟订单不存在' });
  res.json({ success: true, data: order, market: order.instrumentType, instrument: order.instrumentId, dataStatus: 'live', source: 'paper-ledger', updatedAt: order.timestamp, reason: null });
});
app.post('/api/paper/replay', (req, res) => {
  try {
    const ledger = replayUnifiedPaperOrders({ startingCash: Number(req.body?.startingCash) || 1000, orders: Array.isArray(req.body?.orders) ? req.body.orders : [], prices: req.body?.prices });
    res.json({ success: true, data: { ledger, performance: calculateUnifiedPerformance(ledger) } });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || '复盘失败' }); }
});
app.post('/api/paper/unified/reset', (req, res) => res.json({ success: true, data: unifiedPaperLedgerStore.reset(Number(req.body?.startingCash) || 1000) }));

app.get('/api/paper/portfolio', (req, res) => {
  res.json({ success: true, data: paperEngine.getPortfolio() });
});

app.get('/api/paper/risk-metrics', (_req, res) => {
  res.json({ success: true, data: paperEngine.getRiskMetrics() });
});

app.post('/api/paper/monte-carlo', express.json(), (req, res) => {
  const simulations = Math.min(10_000, Math.max(100, Number(req.body?.simulations) || 2000));
  const tradesPerSim = Math.min(100, Math.max(5, Number(req.body?.tradesPerSim) || 20));
  const result = paperEngine.runMonteCarlo(simulations, tradesPerSim, req.body?.seed == null ? 42 : Number(req.body.seed));
  if ('error' in result) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true, data: result });
});

app.post('/api/paper/reset', (req, res) => {
  const balance = req.body?.startingBalance || 1000;
  const portfolio = paperEngine.reset(balance);
  res.json({ success: true, data: paperEngine.getPortfolio() });
});

app.post('/api/paper/preview', async (req, res) => {
  try {
    const { marketId, marketTitle, outcomeIndex, outcomeName, price, amountUsd, reason } = req.body ?? {};
    const result = await paperTradingExecutor.previewOpen({ marketId: Number(marketId), marketTitle: String(marketTitle || ''), outcomeIndex: Number(outcomeIndex) as 0 | 1, outcomeName: String(outcomeName || ''), price: Number(price), amountUsd: Number(amountUsd), reason: String(reason || '') });
    res.json({ success: result.allowed, data: result });
  } catch (e: any) { res.status(400).json({ success: false, error: e.message }); }
});

app.get('/api/trading/capabilities', (_req, res) => {
  res.json({ success: true, data: { mode: 'paper', paper: true, real: false, viewOnly: !config.privateKey, aiPaperTrading: config.aiPaperTradingEnabled } });
});

app.post('/api/paper/open', async (req, res) => {
  try {
    const { marketId, marketTitle, outcomeIndex, outcomeName, price, amountUsd, reason } = req.body;
    const idempotencyKey = String(req.headers['idempotency-key'] || req.body?.idempotencyKey || '').trim();
    if (idempotencyKey) {
      const previous = stateStore.getIdempotent<any>(`paper-open:${idempotencyKey}`);
      if (previous) return res.json(previous);
    }
    const result = await paperTradingExecutor.open({ marketId: Number(marketId), marketTitle: String(marketTitle || ''), outcomeIndex: Number(outcomeIndex) as 0 | 1, outcomeName: String(outcomeName || ''), price: Number(price), amountUsd: Number(amountUsd), reason: String(reason || 'Manual'), idempotencyKey });
    if (result.success && settingsManager.get().telegramEnabled) {
      await telegram.notifyTrade('BUY', `${outcomeName} on "${marketTitle}" @ ${price} | ${amountUsd}`);
    }
    const response = { success: result.success, message: result.message, mode: result.mode, positionId: result.positionId };
    if (idempotencyKey) stateStore.setIdempotent(`paper-open:${idempotencyKey}`, response);
    if (result.success) stateStore.appendAudit({ id: `web-paper-open-${idempotencyKey || Date.now()}`, action: 'paper_open', detail: result.message });
    res.json(response);
  } catch (e: any) {
    res.json({ success: false, message: e.message });
  }
});

app.post('/api/paper/close', async (req, res) => {
  try {
    const { positionId, exitPrice } = req.body;
    const idempotencyKey = String(req.headers['idempotency-key'] || req.body?.idempotencyKey || '').trim();
    if (idempotencyKey) {
      const previous = stateStore.getIdempotent<any>(`paper-close:${idempotencyKey}`);
      if (previous) return res.json(previous);
    }
    const result = await paperTradingExecutor.close({ positionId: String(positionId), exitPrice: Number(exitPrice), idempotencyKey });
    if (result.success && settingsManager.get().telegramEnabled) {
      await telegram.notifyTrade('SELL', `Closed position | ${result.message}`);
    }
    const response = { success: result.success, message: result.message, mode: result.mode, pnl: result.pnl };
    if (idempotencyKey) stateStore.setIdempotent(`paper-close:${idempotencyKey}`, response);
    if (result.success) stateStore.appendAudit({ id: `web-paper-close-${idempotencyKey || Date.now()}`, action: 'paper_close', detail: result.message });
    res.json(response);
  } catch (e: any) {
    res.json({ success: false, message: e.message });
  }
});

app.get('/api/paper/trades', (req, res) => {
  res.json({ success: true, data: paperEngine.getRecentTrades(30) });
});

// --- Kelly Criterion ---

import {
  createAiRunner, stopAiRunner, getAiRunners,
  runnerOpenPosition, runnerClosePosition,
  summarizeRunner, updateAiRunnerPolicy, updateAiRunnerRouting, selectRunnerStockQuote, selectControlledStockQuote, pauseAiRunner, resumeAiRunner, resetAiRunnerCircuit,
  evaluateRunnerOpen, resolveRunnerFill, evaluateRunnerQuoteGate, calculateRunnerExecutionCosts,
  evaluateAiRunnerTrigger, isAiRunnerCallAllowed, appendAiRunnerDecision, listAiRunnerHistory,
  updateAiRunnerMarketState, recordAiRunnerModelCall, evaluateRunnerIndicatorEvidence,
  normalizeAiRunnerStockKlines,
  activateAiRunnerComparison,
  type AiRunner, type AiRunnerDecisionRecord, type AiRunnerInstrumentRef, type AiRunnerMarket,
  type AiRunnerQuote, type AiRunnerDataEvidence,
} from '../features/ai-paper-runner';
import { ResilientDataSourceAdapter } from '../data/source-adapter';
import { AiRunnerTickCoordinator, buildAiRunnerTickIdempotencyKey } from '../features/ai-runner-coordinator';
import { requestAiRunnerIntent, type AiRunnerModelSnapshot } from '../features/ai-runner-model';
import { getAiRuntimeConfig } from '../features/ai-runtime-config';
import { createNasdaqStockAdapters } from '../features/nasdaq-stock-source';
import { createYahooStockAdapter } from '../data/yahoo-adapter';

app.post('/api/kelly', (req, res) => {
  const { probability, price, bankroll, fraction } = req.body;
  const result = kellySizer.calculate(probability, price, bankroll || 1000, fraction);
  res.json({ success: true, data: result });
});

// --- AI Paper Runner ---

const aiRunnerTickCoordinator = new AiRunnerTickCoordinator(stateStore);
const runnerStockQuotes = createNasdaqStockAdapters(fetch, { quoteTtlMs:30_000, timeoutMs:4_000, retries:0 });
const runnerYahooQuotes = new Map<string, ReturnType<typeof createYahooStockAdapter>>();

app.post('/api/ai-runners/:id/routing', express.json(), (req,res) => {
  if (!adminOnly(req,res)) return;
  try {
    const data = updateAiRunnerRouting(String(req.params.id), req.body || {});
    if (!data) return res.status(404).json({success:false,reason:'跑单不存在'});
    stateStore.appendAudit({id:crypto.randomUUID(),action:'ai_runner_routing_updated',detail:`${data.id}: ${data.modelSelection}/${data.quoteSelection}`});
    res.json({success:true,data});
  } catch(error:any) { res.status(400).json({success:false,reason:error.message}); }
});
app.get('/api/paper/chart-markers',(req,res)=>{
  if(!adminOnly(req,res))return;
  const market=String(req.query.market||''),requested=String(req.query.instrument||'');
  if(!['stocks','options','crypto','prediction'].includes(market))return res.status(400).json({success:false,dataStatus:'failed',reason:'图表市场无效'});
  const ledger=unifiedPaperLedgerStore.get();
  const instrument=resolvePaperChartInstrument(ledger,market,requested,(scope,query)=>dataLakeCatalog.resolveInstrument(scope as MarketId,query));
  if(!instrument)return res.status(422).json({success:false,market,instrument:requested,dataStatus:'unsupported',reason:'无法核验当前市场标的身份'});
  const data=paperChartLineage(ledger,market,instrument,req.query.accountId?String(req.query.accountId):undefined,{
    signal:id=>runnerExecutionEvidence.signal(id),
    snapshot:id=>runnerExecutionEvidence.snapshot(id),
  });
  res.json({success:true,market,instrument,dataStatus:data.markers.length?'historical':'empty',source:'统一持久模拟账本',updatedAt:new Date().toISOString(),reason:data.reason,evidenceRefs:data.markers.map(row=>row.snapshotId),data});
});

app.get('/api/ai-runners', (req, res) => {
  if (!adminOnly(req, res)) return;
  if(req.query.market && !MARKET_IDS.includes(String(req.query.market) as MarketId))return res.status(400).json({success:false,reason:'跑单市场无效'});
  const runners = getAiRunners().filter(r=>!req.query.market || r.universe?.market===req.query.market).map(r => ({ ...r, summary: summarizeRunner(r) }));
  res.json({ success: true, enabled: config.aiPaperTradingEnabled, data: runners });
});
import {ComparisonModelBudget} from '../features/ai-comparison-budget';
import {ComparisonScheduler, COMPARISON_MARKETS, type AutomaticComparisonRound, type ComparisonMarket} from '../features/ai-comparison-scheduler';
import {selectComparisonWatchlist} from '../features/ai-comparison-watchlist';
import {fetchRandomOpenRouterFreeModel} from '../features/openrouter-random-model';
const comparisonModelBudget=new ComparisonModelBudget(stateStore);
const comparisonScheduler=new ComparisonScheduler(stateStore);
app.get('/api/ai-runners/comparisons/automatic',(req,res)=>{
  if(!adminOnly(req,res))return;
  try{res.json({success:true,data:comparisonScheduler.list(),budget:comparisonModelBudget.summary(),featureEnabled:config.aiPaperTradingEnabled,
    reason:'独立对照调度；每小时全局最多一轮。现有自主跑单不受此开关或额度影响。'});}
  catch(error:any){res.status(503).json({success:false,reason:error.message});}
});
app.post('/api/ai-runners/comparisons/automatic/rebuild',express.json(),async(req,res)=>{
  if(!adminOnly(req,res))return;
  if(!config.aiPaperTradingEnabled)return res.status(403).json({success:false,reason:'AI模拟能力关闭'});
  try{
    const market=req.body?.market as ComparisonMarket;
    if(!COMPARISON_MARKETS.includes(market))throw new Error('请选择明确市场');
    const ids=unifiedAlertStore.listWatchlist(),pinned=Array.isArray(req.body?.pinned)?req.body.pinned.filter((id:unknown)=>typeof id==='string'&&ids.includes(id)):[];
    const selected=selectComparisonWatchlist(market,ids,pinned,id=>{
      const refs=COMPARISON_MARKETS.map(scope=>dataLakeCatalog.resolveInstrument(scope,id)).filter((ref):ref is NonNullable<typeof ref>=>!!ref);
      if(refs.length>1)throw new Error('自选身份有歧义');
      return refs[0] || null;
    });
    if(!selected.instruments.length){
      const details=[...new Set(selected.excluded.map(row=>row.reason))].slice(0,3);
      return res.status(422).json({success:false,dataStatus:'unavailable',reason:'当前自选没有达到本市场撮合身份门槛的标的'+(details.length?'：'+details.join('；'):''),excluded:selected.excluded});
    }
    const runtime=getAiRuntimeConfig('openrouter'),modelSelection=String(req.body?.modelSelection || 'fixed');
    let model='';
    if(modelSelection==='random-free'){
      if(!runtime.configured)throw new Error('未配置 OpenRouter；无法从免费模型目录随机选型');
      if(runtime.apiUrl!=='https://openrouter.ai/api/v1/chat/completions')throw new Error('随机选型仅支持 OpenRouter 官方接口');
      model=await fetchRandomOpenRouterFreeModel(runtime.apiKey);
    }else if(modelSelection==='fixed'){
      model=String(req.body?.model || runtime.model).trim();
      if(!model || model==='openrouter/free' || model==='openrouter/auto')throw new Error('请填写具体模型 ID，不能使用自动路由');
    }else throw new Error('模型选择模式无效');
    const first=selected.instruments[0];
    const data=stateStore.transaction(()=>{
      const group=createAiRunnerComparison(first.venue,first.symbolOrMarketId,first.title || first.symbolOrMarketId,1000,{},
        {seed:42,model,universe:{kind:'watchlist',sourceWatchlistId:'admin',instruments:selected.instruments}});
      return comparisonScheduler.register({market,groupId:group.id,model,instruments:selected.instruments.map(ref=>ref.symbolOrMarketId),
        excluded:selected.excluded.map(row=>row.instrument+'：'+row.reason)});
    });
    stateStore.appendAudit({id:crypto.randomUUID(),action:'ai_comparison_auto_rebuilt',detail:market+' '+data.groupId+'；旧账户及历史保留；未调用模型'});
    res.json({success:true,data,excluded:selected.excluded,reason:`已冻结管理员自选；三个独立账户各1000虚拟USD；模型 ${model} 已冻结，尚未执行。重建旧组必须人工恢复。`});
  }catch(error:any){res.status(400).json({success:false,reason:error.message});}
});
app.post('/api/ai-runners/comparisons/automatic/control',express.json(),(req,res)=>{
  if(!adminOnly(req,res))return;
  try{
    const {market,paused,enabled}=req.body || {};
    if((enabled===true||paused===false)&&(!config.aiPaperTradingEnabled||!getAiRuntimeConfig('openrouter').configured))throw new Error('AI模拟能力或模型配置不可用，不能恢复调度');
    if(typeof enabled==='boolean'&&market==null){
      if(enabled)for(const scheduled of comparisonScheduler.list().groups){
        const group=getAiRunnerComparison(scheduled.groupId),rows=getAiRunners().filter(row=>group?.runnerIds.includes(row.id));
        if(!validateScheduledAiRunnerComparison(scheduled,group,rows).valid)throw new Error('冻结对照账户、标的或模型配置未通过恢复校验');
      }
      comparisonScheduler.setEnabled(enabled);
    }else if(COMPARISON_MARKETS.includes(market)&&typeof paused==='boolean'){
      const scheduled=comparisonScheduler.list().groups.find(row=>row.market===market),group=scheduled&&getAiRunnerComparison(scheduled.groupId);
      if(!paused&&(!scheduled||!validateScheduledAiRunnerComparison(scheduled,group,getAiRunners().filter(row=>group?.runnerIds.includes(row.id))).valid))throw new Error('对照配置未通过恢复校验');
      comparisonScheduler.pause(market,paused);
    }else throw new Error('调度控制参数无效');
    stateStore.appendAudit({id:crypto.randomUUID(),action:'ai_comparison_auto_control',detail:JSON.stringify({market,paused,enabled})});
    res.json({success:true,data:comparisonScheduler.list(),reason:'启用/恢复后最早下个整点执行；不会立即下单。'});
  }catch(error:any){res.status(400).json({success:false,reason:error.message});}
});
app.get('/api/ai-runners/comparisons/budget',(req,res)=>{
  if(!adminOnly(req,res))return;
  try{res.json({success:true,data:comparisonModelBudget.summary()});}catch(error:any){res.status(503).json({success:false,reason:error.message});}
});
app.get('/api/ai-runners/compare',(req,res)=>{
  if(!adminOnly(req,res))return;
  try {
    const ids=String(req.query.ids || '').split(',').filter(Boolean);
    if(ids.length<2 || ids.length>6 || new Set(ids).size!==ids.length)throw new Error('请选择2–6个不同跑单');
    const runners=getAiRunners(),selected=ids.map(id=>runners.find(row=>row.id===id));
    if(selected.some(row=>!row))throw new Error('所选跑单不存在');
    if(req.query.market && selected.some(row=>row?.universe?.market!==req.query.market))throw new Error('所选跑单不属于当前市场');
    const histories=Object.fromEntries(ids.map(id=>[id,listAiRunnerHistory(id,undefined,200).data]));
    const data=compareAiRunnerReports(selected as AiRunner[],histories);
    res.json({success:true,...data,updatedAt:new Date().toISOString(),source:'独立账户与持久逐轮记录（每个账户最近200轮）',reason:data.reason+'；比较仅覆盖已加载的最近200轮'});
  }catch(error:any){res.status(400).json({success:false,dataStatus:'unavailable',reason:error.message});}
});

app.post('/api/ai-runners/comparisons', express.json(), (req,res) => {
  if (!adminOnly(req,res)) return;
  if (!config.aiPaperTradingEnabled) return res.status(403).json({success:false,error:'AI跑单开关关闭；未创建对照账户'});
  try {
    const {venue,symbolOrMarketId,title,budgetUsd,policy,seed,model,universe}=req.body || {};
    const data=createAiRunnerComparison(venue,String(symbolOrMarketId || ''),String(title || symbolOrMarketId || ''),budgetUsd,policy || {},{seed,model,universe});
    stateStore.appendAudit({id:crypto.randomUUID(),action:'ai_comparison_created',detail:data.id+'；三个账户默认暂停'});
    res.json({success:true,data,reason:'默认暂停；只有明确执行对照轮次才会读取行情及调用已配置模型'});
  } catch(error:any) {res.status(400).json({success:false,error:error.message});}
});
app.get('/api/ai-runners/comparisons/:id', (req,res) => {
  if (!adminOnly(req,res))return;
  const group=getAiRunnerComparison(String(req.params.id));
  if(!group)return res.status(404).json({success:false,reason:'对照实验不存在'});
  res.json({success:true,data:group,samples:listAiRunnerComparisonSamples(group.id).map(({id,at,hash,results})=>({id,at,hash,completed:!!results}))});
});
app.get('/api/ai-runners/comparisons/:id/samples/:sample/replay', (req,res) => {
  if(!adminOnly(req,res))return;
  try {res.json({success:true,...replayAiRunnerComparisonSample(String(req.params.id),String(req.params.sample))});}
  catch(error:any){res.status(404).json({success:false,reason:error.message});}
});
async function runControlledComparison(groupId:string,key:string,scheduled?:AutomaticComparisonRound){
  let activatedIds: string[] = [];
  try {
    if(!config.aiPaperTradingEnabled)throw new Error('AI模拟能力关闭');
    const group=getAiRunnerComparison(groupId);if(!group)throw new Error('对照实验不存在');
    // Scheduled groups cannot be executed manually outside the global hourly claim.
    if(!scheduled&&comparisonScheduler.list().groups.some(row=>row.groupId===groupId))throw new Error('自动对照组由全局整点调度；手动执行不能绕过额度与轮转');
    const guard=()=>{if(scheduled)comparisonScheduler.assertCurrent(scheduled);};
    if(!key || key.length>160)throw new Error('对照执行必须携带有效幂等键');
    const validation=validateAiRunnerComparison(group,getAiRunners().filter(row=>group.runnerIds.includes(row.id)));
    if(!validation.valid)throw new Error(validation.reason);
    if(scheduled){
      const frozen=comparisonScheduler.list().groups.find(row=>row.groupId===group.id);
      const verified=frozen&&validateScheduledAiRunnerComparison(frozen,group,getAiRunners().filter(row=>group.runnerIds.includes(row.id)));
      if(!verified?.valid)throw new Error(verified?.reason || '自动对照冻结配置缺失');
    }
    const result=await aiRunnerTickCoordinator.run('comparison:'+group.id,'ai-comparison:'+group.id+':'+key,async()=>{
      const roundKey='ai-comparison:'+group.id+':'+key;
      guard();
      const primary=getAiRunners().find(row=>row.id===group.runnerIds[0])!;
      const refs=scheduled?primary.universe!.instruments.filter(ref=>ref.symbolOrMarketId===scheduled.instrument):primary.universe!.instruments;
      if(!refs.length)throw new Error('冻结标的身份不匹配');
      const inputs=[];for(const ref of refs)inputs.push(await loadAiRunnerInstrumentSnapshot(primary,ref));
      const sample=buildAiRunnerComparisonSample(group,key,new Date().toISOString(),inputs);
      saveAiRunnerComparisonSample(group.id,sample);
      guard();
      if(scheduled){
        const runtime=getAiRuntimeConfig('openrouter');
        if(!runtime.configured)throw new Error('模型未配置；整轮等待，未调用模型或执行规则订单');
        if(scheduled.market==='prediction')throw new Error('当前跑单快照未保存已核验的双边YES/NO合约及官方结算规则；整轮等待，不以概率或互补价格代替');
        if(inputs.some(input=>input.market!==scheduled.market||!input.quote||!evaluateRunnerQuoteGate(primary.policy,input.quote).allowed))throw new Error(inputs.find(input=>!input.quote||!evaluateRunnerQuoteGate(primary.policy,input.quote).allowed)?.reason || '共享报价未达身份或新鲜度门槛；整轮等待');
        const aiArms=getAiRunners().filter(row=>group.runnerIds.includes(row.id)&&row.mode!=='rules');
        for(const arm of aiArms){
          const at=new Date(),trigger=evaluateAiRunnerTrigger(arm,true,at),allowance=isAiRunnerCallAllowed(arm,true,at);
          if(!trigger.allowed||!allowance.allowed)throw new Error(trigger.reason||allowance.reason||'AI账户暂不可调用；整轮等待');
          if(arm.model!==scheduled.model)throw new Error('冻结模型版本不匹配；整轮等待');
        }
      }
      // Both AI arms each make one model request for their shared frozen snapshots.
      // Reserve the WHOLE round before activation; insufficient quota cannot run rules alone.
      comparisonModelBudget.reserve(roundKey,2);
      activateAiRunnerComparison(group.id,group.runnerIds);
      activatedIds=group.runnerIds;
      try {
        const prepared=[];for(const id of group.runnerIds){guard();prepared.push(await prepareAiRunnerTick(id,'ai-comparison:'+group.id+':'+key+':'+id,sample,roundKey,guard));}
        return {sample,prepared};
      }catch(error){group.runnerIds.forEach(id=>pauseAiRunner(id,'对照准备失败，未提交成交'));throw error;}
    },({sample,prepared})=>{
      guard();
      const current=getAiRunners().filter(row=>group.runnerIds.includes(row.id));
      if(!validateAiRunnerComparison(group,current).valid || current.some(row=>row.status!=='RUNNING'))throw new Error('对照准备期间有账户被暂停或配置改变，整轮未提交成交');
      const results=prepared.map(executePreparedRunnerTick);
      saveAiRunnerComparisonSample(group.id,{...sample,results:results.flatMap(row=>row.decisions)});
      group.runnerIds.forEach(id=>pauseAiRunner(id,scheduled?'对照轮次完成；等待全局整点轮转':'对照轮次完成；等待下一次人工执行'));
      stateStore.appendAudit({id:crypto.randomUUID(),action:'ai_comparison_tick',detail:group.id+'；快照 '+sample.hash});
      return {sampleId:sample.id,snapshotHash:sample.hash,results,reason:validation.reason};
    });
    return result;
  }catch(error){
    activatedIds.forEach(id=>pauseAiRunner(id,'对照轮次失败，未自动恢复'));
    throw error;
  }
}
app.post('/api/ai-runners/comparisons/:id/tick',express.json(),async(req,res)=>{
  if(!adminOnly(req,res))return;
  if(!config.aiPaperTradingEnabled)return res.status(403).json({success:false,reason:'AI跑单开关关闭，未调用模型或创建订单'});
  try{
    const key=String(req.headers['idempotency-key'] || req.body?.idempotencyKey || '').trim();
    const result=await runControlledComparison(String(req.params.id),key);
    if(result.status==='busy')return res.status(409).json({success:false,reason:'该对照正在执行，未重复下单'});
    res.json({success:true,...result});
  }catch(error:any){res.status(400).json({success:false,reason:error.message});}
});

app.post('/api/ai-runners/create', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  if (!config.aiPaperTradingEnabled) return res.status(403).json({ success: false, error: 'AI 自动纸面交易当前关闭，可设置 AI_PAPER_TRADING_ENABLED=true 启用模拟能力' });
  const { venue, symbolOrMarketId, title, budgetUsd, mode, trigger, universe, model } = req.body ?? {};
  if (!venue || !symbolOrMarketId || !budgetUsd || typeof budgetUsd !== 'number' || budgetUsd < 1) {
    return res.status(400).json({ success: false, error: '请填写平台、标的和金额（≥$1）' });
  }
  if (mode != null && !['rules', 'ai-review', 'ai-autonomous-paper'].includes(String(mode))) return res.status(400).json({ success: false, error: '跑单模式无效' });
  if (trigger != null && !['scheduled', 'signal'].includes(String(trigger))) return res.status(400).json({ success: false, error: 'AI 触发方式无效' });
  if (model != null && (typeof model !== 'string' || model.length > 160)) return res.status(400).json({ success: false, error: '模型标识无效' });
  try {
    const runner = createAiRunner(venue, String(symbolOrMarketId), String(title || symbolOrMarketId), budgetUsd, req.body?.policy, { mode, trigger, universe, model });
    res.json({ success: true, data: runner });
  } catch (e: any) { res.status(400).json({ success: false, error: e.message }); }
});

app.post('/api/ai-runners/policy', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const { id, policy } = req.body ?? {};
  let runner;
  try { runner = id && policy ? updateAiRunnerPolicy(String(id), policy) : null; }
  catch (error) { return res.status(400).json({ success: false, error: error instanceof Error ? error.message : '策略风控参数无效' }); }
  if (!runner) return res.status(404).json({ success: false, error: '未找到策略' });
  res.json({ success: true, data: runner });
});

app.post('/api/ai-runners/pause', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const { id, reason } = req.body ?? {};
  const runner = id ? pauseAiRunner(String(id), String(reason || '手动暂停')) : null;
  if (!runner) return res.status(404).json({ success: false, error: '未找到策略' });
  res.json({ success: true, data: runner });
});

app.post('/api/ai-runners/resume', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const { id } = req.body ?? {};
  const runner = id ? resumeAiRunner(String(id)) : null;
  if (!runner) return res.status(404).json({ success: false, error: '未找到策略或仍处于熔断状态' });
  res.json({ success: true, data: runner });
});

app.post('/api/ai-runners/reset-circuit', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const { id } = req.body ?? {};
  const runner = id ? resetAiRunnerCircuit(String(id)) : null;
  if (!runner) return res.status(404).json({ success: false, error: '未找到策略' });
  res.json({ success: true, data: runner });
});

const runnerKlineAdapters = new Map<string, ResilientDataSourceAdapter<unknown[][]>>();
function getRunnerKlineAdapter(symbol: string): ResilientDataSourceAdapter<unknown[][]> {
  const key = symbol.toUpperCase();
  let adapter = runnerKlineAdapters.get(key);
  if (!adapter) {
    adapter = new ResilientDataSourceAdapter<unknown[][]>({
      id: `binance-klines-${key}`,
      group: 'ai-runner-market-data',
      ttlMs: 60_000,
      timeoutMs: 8_000,
      retries: 2,
      fetcher: async (_input, signal) => {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${key}&interval=1h&limit=20`, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.json() as unknown[][];
      },
    });
    runnerKlineAdapters.set(key, adapter);
  }
  return adapter;
}

const runnerStockKlineAdapters = new Map<string, ResilientDataSourceAdapter<unknown[][]>>();
function getRunnerStockKlineAdapter(symbol: string): ResilientDataSourceAdapter<unknown[][]> {
  const key = symbol.replace(/^us/i, '').split('.')[0].toUpperCase();
  let adapter = runnerStockKlineAdapters.get(key);
  if (!adapter) {
    adapter = new ResilientDataSourceAdapter<unknown[][]>({
      id: `stock-klines-${key}`,
      group: 'ai-runner-market-data',
      ttlMs: 60_000,
      timeoutMs: 15_000,
      retries: 2,
      fetcher: async (_input, signal) => {
        const response = await fetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=us${key}.OQ,day,,,40,qfq`, { signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json() as any;
        const dataKey = Object.keys(payload.data || {})[0];
        const rows = dataKey ? (payload.data[dataKey].qfqday || payload.data[dataKey].day) : null;
        if (!Array.isArray(rows) || !rows.length) throw new Error('股票 K 线为空');
        return normalizeAiRunnerStockKlines(rows as unknown[][]);
      },
    });
    runnerStockKlineAdapters.set(key, adapter);
  }
  return adapter;
}

app.post('/api/ai-runners/stop', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const { id } = req.body ?? {};
  const runner = id ? stopAiRunner(String(id)) : null;
  if (!runner) return res.status(404).json({ success: false, error: '未找到跑单或已停止' });
  res.json({ success: true, data: runner });
});

interface AiRunnerInstrumentSnapshot extends AiRunnerModelSnapshot {
  ref: AiRunnerInstrumentRef;
  dataStatus: string;
  source?: string;
  dataAt?: string;
  reason?: string;
  snapshotHash: string;
  evidence?: AiRunnerDataEvidence[];
  quote?: AiRunnerQuote;
  indicatorDataStatus?: string;
  indicatorDataAt?: string;
  indicatorRetrievedAt?: string;
  modelProbability?: number;
  requestedAction?: 'BUY' | 'SELL';
  requestedSide?: 'YES' | 'NO' | 'LONG';
  requestReason?: string;
}

function runnerLedgerInstrumentId(instrument: AiRunnerInstrumentRef): string {
  const symbol = instrument.symbolOrMarketId.toUpperCase();
  if (instrument.venue === 'Stocks') return `stock:us:${symbol}`;
  if (instrument.venue === 'Options') return `option:us:${symbol}`;
  if (instrument.venue === 'Predict.fun') return `prediction:predictfun:${symbol}`;
  return `crypto:binance:${symbol}`;
}

function runnerBookStatus(timestamp: number, maxAgeMs: number, now = Date.now()): 'live' | 'delayed' | 'stale' | 'unavailable' {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'unavailable';
  const age = now - timestamp;
  if (age < 0) return 'unavailable';
  if (age <= 15_000) return 'live';
  if (age <= maxAgeMs) return 'delayed';
  return 'stale';
}

function runnerIndicators(rows: unknown[][]): { closes: number[]; price?: number; rsi14?: number; sma10?: number } {
  const closes = rows.map(row => Number(row[4])).filter(value => Number.isFinite(value) && value > 0);
  if (closes.length < 15) return { closes };
  let gains = 0;
  let losses = 0;
  for (let index = closes.length - 14; index < closes.length; index += 1) {
    const change = closes[index] - closes[index - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const rs = gains / (losses || 1e-9);
  return {
    closes,
    price: closes[closes.length - 1],
    rsi14: 100 - 100 / (1 + rs),
    sma10: closes.slice(-10).reduce((sum, value) => sum + value, 0) / 10,
  };
}

async function loadAiRunnerInstrumentSnapshot(runner: AiRunner, ref: AiRunnerInstrumentRef): Promise<AiRunnerInstrumentSnapshot> {
  const market = runner.universe?.market || (ref.venue === 'Stocks' ? 'stocks' : ref.venue === 'Options' ? 'options' : ref.venue === 'Predict.fun' ? 'prediction' : 'crypto');
  const instrument = ref.symbolOrMarketId.toUpperCase();
  let row: Omit<AiRunnerInstrumentSnapshot, 'snapshotHash'> = {
    ref, market, instrument, dataStatus: 'unavailable', reason: '当前标的来源不可用', candidateSignals: [], evidence: [],
  };
  try {
    if (ref.venue === 'Options') {
      row = { ...row, dataStatus: 'unsupported', reason: '期权合约身份或可靠买卖价不足，当前跑单不支持' };
    } else if (ref.venue === 'Binance') {
      const [barsResult, depth] = await Promise.all([
        getRunnerKlineAdapter(instrument).fetch(),
        binanceFeed.getDepth(instrument, 5),
      ]);
      const bars = barsResult.data || [];
      const metrics = runnerIndicators(bars);
      const indicatorDataAtMs = bars.length ? Number(bars[bars.length - 1][0]) : Number.NaN;
      const indicatorDataAt = Number.isFinite(indicatorDataAtMs) ? new Date(indicatorDataAtMs).toISOString() : undefined;
      const indicatorGate = evaluateRunnerIndicatorEvidence({ status: barsResult.status, dataAt: indicatorDataAt, retrievedAt: barsResult.fetchedAt }, runner.policy.minFreshnessMs);
      const bookAt = Number(depth?.freshness);
      const bookStatus = depth?.sourceStatus === 'ok' ? runnerBookStatus(bookAt, runner.policy.minFreshnessMs) : 'unavailable';
      const bid = Number(depth?.bids?.[0]?.[0]);
      const ask = Number(depth?.asks?.[0]?.[0]);
      const validBook = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask >= bid;
      const dataStatus = !bars.length ? (barsResult.status === 'stale' ? 'stale' : 'unavailable') : validBook ? bookStatus : 'unavailable';
      const dataAt = Number.isFinite(bookAt) && bookAt > 0 ? new Date(bookAt).toISOString() : bars.length ? new Date(Number(bars[bars.length - 1][0])).toISOString() : undefined;
      const mid = validBook ? (bid + ask) / 2 : metrics.price;
      const quote: AiRunnerQuote = {
        market: 'crypto', status: dataStatus, dataStatus, price: Number(mid), fetchedAt: dataAt,
        source: 'Binance 公共盘口', bestBid: validBook ? bid : undefined, bestAsk: validBook ? ask : undefined,
        reason: !bars.length ? barsResult.error || '暂无K线历史' : !validBook ? '盘口没有有效双边报价' : dataStatus === 'stale' ? '盘口报价过期' : undefined,
      };
      const candidateSignals: string[] = [];
      if (indicatorGate.allowed && metrics.rsi14 != null && metrics.rsi14 < 32) candidateSignals.push(`RSI14=${metrics.rsi14.toFixed(1)} 超卖`);
      const aboveSma = metrics.price != null && metrics.sma10 != null && metrics.price > metrics.sma10;
      if (indicatorGate.allowed && metrics.rsi14 != null && metrics.rsi14 > 68) candidateSignals.push(`RSI14=${metrics.rsi14.toFixed(1)} 超买`);
      row = {
        ...row, dataStatus, source: 'Binance K线 + 公共盘口', dataAt,
        indicatorDataStatus: bars.length ? barsResult.status : 'unavailable', indicatorDataAt, indicatorRetrievedAt: barsResult.fetchedAt,
        evidence: [
          { dataset: 'bars', source: 'Binance 1h K线', status: bars.length ? barsResult.status : 'unavailable', dataAt: indicatorDataAt, retrievedAt: barsResult.fetchedAt, reason: indicatorGate.reason || barsResult.error },
          { dataset: 'quote', source: 'Binance 公共盘口', status: bookStatus, dataAt: dataAt, retrievedAt: dataAt, reason: quote.reason },
        ],
        ...(!indicatorGate.allowed ? { reason: indicatorGate.reason } : {}),
        ...(metrics.price != null ? { price: Number(mid) || metrics.price } : {}),
        ...(metrics.rsi14 != null ? { rsi14: metrics.rsi14 } : {}),
        ...(metrics.sma10 != null ? { sma10: metrics.sma10 } : {}),
        candidateSignals, quote,
        reason: dataStatus === 'unavailable' ? quote.reason || barsResult.error || '行情或盘口不可用' : dataStatus === 'stale' ? '报价已过期，禁止触发新订单' : undefined,
      };
      (row as any).aboveSma = aboveSma;
    } else if (ref.venue === 'Stocks') {
      const symbol = instrument.replace(/^US(?=[A-Z])/, '').replace(/\.(OQ|N)$/i,'');
      if (!/^[A-Z][A-Z0-9.:-]{0,19}$/.test(symbol)) throw new Error('股票代码格式无效');
      if ((runner.quoteSelection === 'random-valid' && !runner.comparisonControl) || runner.comparisonControl) {
        let yahoo = runnerYahooQuotes.get(symbol);
        if (!yahoo) { yahoo=createYahooStockAdapter();runnerYahooQuotes.set(symbol,yahoo);if(runnerYahooQuotes.size>100)runnerYahooQuotes.delete(runnerYahooQuotes.keys().next().value!); }
        const [nasdaq,yahooQuote,intraday] = await Promise.all([
          runnerStockQuotes.quote.fetch({symbol}), yahoo.fetch({symbol}), getStockKlineAdapter('1m',symbol).fetch({symbol,period:'1m'}),
        ]);
        const observedNow=Date.now();
        const candidates=[{source:'Nasdaq 公共双边报价',status:nasdaq.status,quote:nasdaq.data},{source:'Yahoo 股票双边报价',status:yahooQuote.status,quote:yahooQuote.data}];
        const chosen=runner.comparisonControl ? selectControlledStockQuote(symbol,candidates,runner.policy.minFreshnessMs,observedNow)
          : selectRunnerStockQuote(symbol,candidates,runner.policy.minFreshnessMs,observedNow);
        // Only completed one-minute candles; source time is never replaced by fetch time.
        const completed=(intraday.data || []).filter(bar=>bar.time+60_000<=observedNow);
        const metrics=runnerIndicators(completed.map(bar=>[bar.time,bar.open,bar.high,bar.low,bar.close,bar.volume]));
        const indicatorDataAt=completed.length ? new Date(completed[completed.length-1].time+60_000).toISOString() : undefined;
        const indicatorStatus=metrics.rsi14!=null && !['stale','unavailable'].includes(intraday.status) ? 'delayed' : 'unavailable';
        const indicatorGate=evaluateRunnerIndicatorEvidence({status:indicatorStatus,dataAt:indicatorDataAt,retrievedAt:intraday.fetchedAt},runner.policy.minFreshnessMs);
        row={...row, source:chosen?.source || '股票双边报价池',dataStatus:chosen?'live':'unavailable',dataAt:chosen?.quote.updatedAt,
          price:chosen?.quote.price,quote:chosen?.quote,indicatorDataStatus:indicatorStatus,indicatorDataAt,indicatorRetrievedAt:intraday.fetchedAt,
          rsi14:metrics.rsi14,sma10:metrics.sma10,candidateSignals:[],
          evidence:[...candidates.map(candidate=>({dataset:'quote' as const,source:candidate.source,status:candidate.status,dataAt:candidate.quote?.asOf || undefined,retrievedAt:candidate===candidates[0]?nasdaq.fetchedAt:yahooQuote.fetchedAt,
            reason:candidate.quote ? '仅符合身份、时间、实时标记及双边价格校验的来源可被随机选中' : (candidate===candidates[0]?nasdaq.error:yahooQuote.error)})),
            {dataset:'bars',source:'Yahoo 完成的1分钟K线',status:indicatorStatus,dataAt:indicatorDataAt,retrievedAt:intraday.fetchedAt,reason:indicatorGate.reason || intraday.error}],
          reason:!chosen?'没有未过期的有效实时双边报价；不使用历史收盘价替代':!indicatorGate.allowed?indicatorGate.reason:undefined};
        (row as any).aboveSma=chosen && metrics.sma10!=null ? chosen.quote.price>metrics.sma10 : undefined;
      } else {
      const history = await getRunnerStockKlineAdapter(symbol).fetch();
      const bars = history.data || [];
      const metrics = runnerIndicators(bars);
      const dataAtMs = bars.length ? Number(bars[bars.length - 1][0]) : Number.NaN;
      const dataAt = Number.isFinite(dataAtMs) ? new Date(dataAtMs).toISOString() : undefined;
      const candidateSignals: string[] = [];
      if (metrics.rsi14 != null && metrics.rsi14 < 32) candidateSignals.push(`RSI14=${metrics.rsi14.toFixed(1)} 超卖`);
      if (metrics.rsi14 != null && metrics.rsi14 > 68) candidateSignals.push(`RSI14=${metrics.rsi14.toFixed(1)} 超买`);
      row = {
        ...row, dataStatus: bars.length ? 'historical' : history.status === 'stale' ? 'stale' : 'unavailable',
        source: '腾讯证券日K历史', dataAt, ...(metrics.price != null ? { price: metrics.price } : {}),
        indicatorDataStatus: bars.length ? 'historical' : history.status, indicatorDataAt: dataAt, indicatorRetrievedAt: history.fetchedAt,
        evidence: [{ dataset: 'bars', source: '腾讯证券日K历史', status: bars.length ? 'historical' : history.status, dataAt, retrievedAt: history.fetchedAt, reason: bars.length ? '历史日K无可验证实时盘口，只用于研究' : history.error }],
        ...(metrics.rsi14 != null ? { rsi14: metrics.rsi14 } : {}), ...(metrics.sma10 != null ? { sma10: metrics.sma10 } : {}),
        candidateSignals, quote: { market: 'stocks', status: 'historical', dataStatus: 'historical', price: metrics.price || 0, fetchedAt: dataAt, source: '腾讯证券日K历史', reason: '当前来源仅提供历史日K，缺少可验证的实时买卖盘口，不能模拟成交' },
        reason: bars.length ? '当前来源仅提供历史日K，缺少可验证的实时买卖盘口，不能模拟成交' : history.error || '暂无股票历史K线',
      };
      (row as any).aboveSma = metrics.price != null && metrics.sma10 != null && metrics.price > metrics.sma10;
      }
    } else if (ref.venue === 'Predict.fun') {
      if (!/^\d+$/.test(instrument)) {
        row = { ...row, dataStatus: 'unsupported', source: 'Predict.fun 官方 API', reason: '事件 ID 不是当前 Predict.fun 接口支持的数字 ID' };
      } else {
        const [marketResponse, bookResponse] = await Promise.all([api.getMarketById(Number(instrument)), api.getOrderbook(Number(instrument))]);
        const marketItem = marketResponse.success ? marketResponse.data : null;
        const outcomeNames = marketItem?.outcomes?.map(item => String(item.name).trim().toUpperCase()) || [];
        if (!marketItem) {
          row = { ...row, dataStatus: 'unavailable', source: 'Predict.fun 官方 API', reason: 'Predict.fun 事件详情不可用' };
        } else if (!((outcomeNames.includes('YES') && outcomeNames.includes('NO')) || (outcomeNames.includes('是') && outcomeNames.includes('否')))) {
          row = { ...row, dataStatus: 'unsupported', source: 'Predict.fun 官方 API', reason: '该事件不是经核验的 YES/NO 二元合约，当前跑单不估算合约价格' };
        } else {
          const book = bookResponse.success ? bookResponse.data : null;
          const bookAt = Number(book?.updateTimestampMs);
          const bookStatus = book ? runnerBookStatus(bookAt, runner.policy.minFreshnessMs) : 'unavailable';
          const bid = Number(book?.bids?.[0]?.[0]);
          const ask = Number(book?.asks?.[0]?.[0]);
          const validBook = Number.isFinite(bid) && bid > 0 && Number.isFinite(ask) && ask >= bid && ask < 1;
          const status = !validBook ? 'unavailable' : bookStatus;
          const dataAt = Number.isFinite(bookAt) ? new Date(bookAt).toISOString() : undefined;
          const midpoint = validBook ? (bid + ask) / 2 : 0;
          const quote: AiRunnerQuote = { market: 'prediction', status, dataStatus: status, price: midpoint, fetchedAt: dataAt, source: 'Predict.fun 官方事件订单簿', bestBid: validBook ? bid : undefined, bestAsk: validBook ? ask : undefined, reason: !validBook ? '订单簿缺少有效双边 YES/NO 报价' : status === 'stale' ? '订单簿报价过期' : undefined };
          // Current endpoint identifies a market book, not two token-scoped books or rules evidence.
          const executableQuote = predictionOutcomeQuote(quote,'YES',new Date(),runner.policy.minFreshnessMs);
          row = {
            ...row, dataStatus: executableQuote.dataStatus!, source: 'Predict.fun 官方事件详情 + 订单簿', dataAt, price: midpoint,
            evidence: [
              { dataset: 'market', source: 'Predict.fun 官方事件详情', status: marketResponse.success ? 'live' : 'unavailable', retrievedAt: new Date().toISOString(), reason: marketResponse.success ? undefined : '官方事件详情不可用' },
              { dataset: 'quote', source: 'Predict.fun 官方事件订单簿（outcome 身份待核验）', status: executableQuote.dataStatus!, dataAt, retrievedAt: new Date().toISOString(), reason: executableQuote.reason },
            ],
            candidateSignals: [], quote: executableQuote,
            reason: executableQuote.reason || '仅取得当前订单簿；缺少独立校准概率，因此规则模式不会推断交易优势',
          };
        }
      }
    }
  } catch (error) {
    const failureReason = error instanceof Error ? error.message.slice(0, 240) : '数据请求失败';
    const failureSource = row.source || (ref.venue === 'Binance' ? 'Binance 公共行情接口' : ref.venue === 'Stocks' ? '腾讯证券行情接口' : ref.venue === 'Predict.fun' ? 'Predict.fun 官方 API' : '当前市场数据源');
    row = {
      ...row, dataStatus: 'unavailable', source: failureSource, reason: failureReason,
      evidence: [...(row.evidence || []), { dataset: 'market', source: failureSource, status: 'unavailable', retrievedAt: new Date().toISOString(), reason: failureReason }],
    };
  }
  const openPosition = runner.positions.some(position => position.status === 'OPEN' && (position.instrumentId === runnerLedgerInstrumentId(ref) || position.instrument?.symbolOrMarketId === ref.symbolOrMarketId));
  row.openPosition = openPosition;
  const indicatorsUsable = !row.indicatorDataStatus || evaluateRunnerIndicatorEvidence({
    status: row.indicatorDataStatus, dataAt: row.indicatorDataAt, retrievedAt: row.indicatorRetrievedAt,
  }, runner.policy.minFreshnessMs).allowed;
  if (row.quote?.status && ['live', 'delayed'].includes(row.quote.status) && indicatorsUsable && row.rsi14 != null && row.price != null) {
    if (ref.venue !== 'Predict.fun' && !openPosition && row.rsi14 < 32) row.candidateSignals = [...(row.candidateSignals || []), '规则策略候选买入'];
    if (ref.venue !== 'Predict.fun' && openPosition && (row.rsi14 > 68 || (row as any).aboveSma === false)) row.candidateSignals = [...(row.candidateSignals || []), '规则策略候选退出'];
  }
  return { ...row, snapshotHash: runnerSnapshotHash(row) };
}

interface PreparedAiRunnerTick {
  runnerId: string;
  idempotencyKey: string;
  snapshots: AiRunnerInstrumentSnapshot[];
  records: AiRunnerDecisionRecord[];
  intent?: { action: 'BUY' | 'SELL' | 'HOLD'; instrument: string; side?: 'YES' | 'NO' | 'LONG'; rationale: string; counterEvidence: string[]; riskNotes: string[] };
  modelVersion?: string;
}

async function prepareAiRunnerTick(runnerId: string, idempotencyKey: string, sample?: AiRunnerComparisonSample,comparisonRoundKey?:string,comparisonGuard?:()=>void): Promise<PreparedAiRunnerTick> {
  const runner = getAiRunners().find(item => item.id === runnerId);
  let now = sample ? new Date(sample.at) : new Date();
  if (!runner) return { runnerId, idempotencyKey, snapshots: [], records: [] };
  if (runner.status !== 'RUNNING') return { runnerId, idempotencyKey, snapshots: [], records: [] };
  const refs = runner.universe?.instruments || [{ venue: runner.venue, symbolOrMarketId: runner.symbolOrMarketId, title: runner.title }];
  const snapshots: AiRunnerInstrumentSnapshot[] = [];
  if(sample){
    for(const input of sample.snapshots){
      const snapshot=structuredClone(input) as unknown as AiRunnerInstrumentSnapshot;
      snapshot.openPosition=runner.positions.some(position=>position.status==='OPEN' && (position.instrumentId===runnerLedgerInstrumentId(snapshot.ref) || position.instrument?.symbolOrMarketId===snapshot.ref.symbolOrMarketId));
      snapshots.push(snapshot);
    }
  }else for (const ref of refs.slice(0, 5)) snapshots.push(await loadAiRunnerInstrumentSnapshot(runner, ref));
  if (!sample) now = new Date();
  const candidateSignal = snapshots.some(item => item.candidateSignals?.length && ['live', 'delayed'].includes(item.quote?.dataStatus || ''));
  let intent: PreparedAiRunnerTick['intent'];
  let modelVersion: string | undefined;
  let aiStatusReason: string | undefined;
  if(runner.comparisonControl&&snapshots.some(snapshot=>snapshot.market!==runner.universe?.market||!snapshot.quote||!evaluateRunnerQuoteGate(runner.policy,snapshot.quote,now).allowed))aiStatusReason='共享行情未通过市场身份或新鲜报价门槛，对照不调用模型';
  if (runner.executionState === 'legacy-readonly') aiStatusReason = '旧跑单没有可核验的统一账本关联，仅保留只读历史';
  if (runner.mode !== 'rules') {
    const latestRunner = getAiRunners().find(item => item.id === runnerId);
    if (!aiStatusReason && (!latestRunner || latestRunner.status !== 'RUNNING')) aiStatusReason = '跑单已停止或暂停，本轮未调用模型';
    const trigger = aiStatusReason ? { allowed: false, reason: aiStatusReason } : evaluateAiRunnerTrigger(latestRunner || runner, candidateSignal, now);
    if (!trigger.allowed) aiStatusReason = trigger.reason;
    else {
      const runtime = getAiRuntimeConfig('openrouter');
      const allowance = isAiRunnerCallAllowed(runner, runtime.configured, now);
      if (!allowance.allowed) aiStatusReason = allowance.reason;
      else {
        const decisionId = `${idempotencyKey}:model`;
        let comparisonQuotaDenied=false;
        try {
          const result = await requestAiRunnerIntent(runner, runtime, snapshots, fetch, (model,attempt) => {
            comparisonGuard?.();
            const current=getAiRunners().find(item=>item.id===runner.id);
            if (!current || current.status!=='RUNNING') throw new Error('跑单已暂停或停止');
            if(current.comparisonControl&&(!comparisonRoundKey||!comparisonModelBudget.consume(comparisonRoundKey,`${runner.id}:${attempt}`))){comparisonQuotaDenied=true;throw new Error('对照请求缺少有效整轮额度或已消费，整轮等待');}
            recordAiRunnerModelCall(runner.id, { at:new Date().toISOString(),model,decisionId:`${decisionId}:attempt:${attempt}` });
          });
          if(comparisonQuotaDenied)throw new Error('对照额度不再有效，整轮等待，未提交规则或AI订单');
          if (result.ok) { intent = result.intent; modelVersion = result.model; }
          else { aiStatusReason = result.reason; modelVersion = result.model; }
        } catch (error) { if(comparisonQuotaDenied)throw error;aiStatusReason = error instanceof Error ? error.message : 'AI 调用失败'; }
      }
    }
  }
  const records = snapshots.map(snapshot => {
    const isChosen = intent?.instrument === snapshot.instrument;
    let action: AiRunnerDecisionRecord['action'] = 'NONE';
    let reason = snapshot.reason || '本轮规则条件未触发';
    const signals = [...(snapshot.candidateSignals || [])];
    const quoteGate = snapshot.quote ? evaluateRunnerQuoteGate(runner.policy, snapshot.quote, now) : { allowed: false, reason: '没有可验证报价' };
    const indicatorGate = snapshot.indicatorDataStatus
      ? evaluateRunnerIndicatorEvidence({ status: snapshot.indicatorDataStatus, dataAt: snapshot.indicatorDataAt, retrievedAt: snapshot.indicatorRetrievedAt }, runner.policy.minFreshnessMs, now)
      : { allowed: true as const };
    const riskChecks: AiRunnerDecisionRecord['riskChecks'] = [
      { name: 'market-scope', passed: snapshot.market === runner.universe?.market, reason: snapshot.market === runner.universe?.market ? undefined : '跨市场数据已拒绝' },
      { name: 'quote-freshness', passed: quoteGate.allowed, reason: quoteGate.reason },
      { name: 'strategy-indicator-evidence', passed: indicatorGate.allowed, reason: indicatorGate.reason },
    ];
    if (runner.executionState === 'legacy-readonly') {
      action = 'REJECTED'; reason = '旧跑单没有可核验的统一账本关联，仅保留只读历史';
      riskChecks.push({ name: 'ledger-isolation', passed: false, reason });
    } else if (runner.mode === 'rules') {
      const hasOpen = snapshot.openPosition === true;
      if (!quoteGate.allowed) {
        reason = quoteGate.reason || snapshot.reason || '没有可执行的新鲜盘口';
      } else if (!indicatorGate.allowed) {
        reason = indicatorGate.reason || '策略指标证据不可用';
      } else if (snapshot.market === 'prediction') {
        if (!hasOpen && snapshot.modelProbability != null && snapshot.quote?.price && snapshot.modelProbability - snapshot.quote.price >= 0.05) {
          (snapshot as any).requestedAction = 'BUY'; (snapshot as any).requestedSide = 'YES';
          (snapshot as any).requestReason = `概率差 ${(snapshot.modelProbability - snapshot.quote.price) * 100}pp`;
        } else if (hasOpen && snapshot.modelProbability != null && snapshot.quote?.price && snapshot.modelProbability <= snapshot.quote.price) {
          (snapshot as any).requestedAction = 'SELL'; (snapshot as any).requestReason = '模型优势消失';
        }
      } else if (!hasOpen && (snapshot.rsi14 ?? 100) < 32) {
        (snapshot as any).requestedAction = 'BUY'; (snapshot as any).requestedSide = 'LONG';
        (snapshot as any).requestReason = `RSI14 ${snapshot.rsi14?.toFixed(1)} 超卖`;
      } else if (hasOpen && ((snapshot.rsi14 ?? 0) > 68 || (snapshot as any).aboveSma === false)) {
        (snapshot as any).requestedAction = 'SELL'; (snapshot as any).requestReason = (snapshot.rsi14 ?? 0) > 68 ? 'RSI14 超买' : '收盘价低于 SMA10';
      }
      if ((snapshot as any).requestedAction) reason = (snapshot as any).requestReason;
    } else if (aiStatusReason) {
      reason = aiStatusReason;
      riskChecks.push({ name: 'ai-trigger-and-quota', passed: false, reason: aiStatusReason });
    } else if (intent && isChosen) {
      action = runner.mode === 'ai-review' ? 'REVIEW' : 'NONE';
      reason = `${intent.action}: ${intent.rationale}${intent.counterEvidence.length ? `；反证：${intent.counterEvidence.join('；')}` : ''}${intent.riskNotes.length ? `；风险：${intent.riskNotes.join('；')}` : ''}`.slice(0, 500);
      signals.push(`AI 置信度 ${(intent as any).confidence != null ? Math.round((intent as any).confidence * 100) : 0}%`);
      riskChecks.push({ name: 'model-intent', passed: true });
      if (runner.mode === 'ai-autonomous-paper' && intent.action !== 'HOLD') {
        (snapshot as any).requestedAction = intent.action;
        (snapshot as any).requestedSide = intent.side || (snapshot.market === 'prediction' ? 'YES' : 'LONG');
        (snapshot as any).requestReason = intent.rationale;
        action = 'NONE';
      }
    } else if (intent && !isChosen) {
      reason = `AI 选择了冻结范围中的 ${intent.instrument}`;
    } else {
      reason = snapshot.reason || '模型未返回可执行建议';
    }
    return {
      id: crypto.randomUUID(), runnerId, idempotencyKey: `${idempotencyKey}:${snapshot.instrument}`,
      at: now.toISOString(), market: snapshot.market as AiRunnerMarket, instrument: snapshot.instrument,
      dataStatus: snapshot.dataStatus, source: snapshot.source, dataAt: snapshot.dataAt,
      evidence: snapshot.evidence, snapshotHash: snapshot.snapshotHash, strategyVersion: runner.strategyVersion,
      modelVersion, signals: signals.slice(0, 20), riskChecks, action, reason,
    };
  });
  return { runnerId, idempotencyKey, snapshots, records, intent, modelVersion };
}

function executePreparedRunnerTick(prepared: PreparedAiRunnerTick): { actions: Array<{ id: string; actionZh: string }>; decisions: AiRunnerDecisionRecord[] } {
  const initialRunner = getAiRunners().find(item => item.id === prepared.runnerId);
  if (!initialRunner) return { actions: [], decisions: [] };
  const actions: Array<{ id: string; actionZh: string }> = [];
  const records = prepared.records.map(record => ({ ...record, riskChecks: [...record.riskChecks] }));
  for (const snapshot of prepared.snapshots) {
    updateAiRunnerMarketState(prepared.runnerId, {
      market: snapshot.market as AiRunnerMarket, status: snapshot.dataStatus,
      instrument: snapshot.instrument,
      source: snapshot.source, dataAt: snapshot.dataAt, reason: snapshot.reason,
      snapshotHash: snapshot.snapshotHash,
      outcomeQuotes: snapshot.market === 'prediction' && snapshot.quote ? { [runnerLedgerInstrumentId(snapshot.ref)]: snapshot.quote } : undefined,
      prices: snapshot.quote && ['live', 'delayed'].includes(snapshot.quote.dataStatus || '') && Number.isFinite(snapshot.quote.price) ? { [snapshot.instrument]: snapshot.quote.price } : {},
    });
  }
  for (let index = 0; index < prepared.snapshots.length; index += 1) {
    const snapshot = prepared.snapshots[index];
    const record = records[index];
    const action = (snapshot as any).requestedAction as 'BUY' | 'SELL' | undefined;
    if (!action) continue;
    const runner = getAiRunners().find(item => item.id === prepared.runnerId);
    if (!runner || runner.status !== 'RUNNING') {
      record.action = 'REJECTED'; record.reason = '跑单已停止或暂停，未创建模拟订单';
      record.riskChecks.push({ name: 'runner-active', passed: false, reason: record.reason });
      continue;
    }
    const ref = snapshot.ref;
    const existing = runner.positions.find(position => position.status === 'OPEN' && (position.instrumentId === runnerLedgerInstrumentId(ref) || position.instrument?.symbolOrMarketId === ref.symbolOrMarketId));
    const side = (snapshot as any).requestedSide as string | undefined;
    const quote = predictionOutcomeQuote(snapshot.quote || { market: snapshot.market as AiRunnerMarket, status: 'unavailable', dataStatus: 'unavailable', price: 0 }, action === 'SELL' ? existing?.side : side,new Date(),runner.policy.minFreshnessMs);
    if (!snapshot.quote) {
      record.action = 'REJECTED'; record.reason = snapshot.reason || '没有可执行报价';
      record.riskChecks.push({ name: 'executable-quote', passed: false, reason: record.reason });
      continue;
    }
    const indicatorEvidenceCheck = record.riskChecks.find(check => check.name === 'strategy-indicator-evidence');
    if (indicatorEvidenceCheck && !indicatorEvidenceCheck.passed) {
      record.action = 'REJECTED'; record.reason = indicatorEvidenceCheck.reason || '策略指标证据已过期，订单拒绝';
      continue;
    }
    const fill = resolveRunnerFill(runner.policy, quote, action);
    if (!fill.allowed || fill.price == null) {
      record.action = 'REJECTED'; record.reason = fill.reason || '模拟撮合拒绝：报价不满足条件';
      record.riskChecks.push({ name: 'executable-quote', passed: false, reason: record.reason });
      continue;
    }
    if (action === 'BUY') {
      if (existing) { record.action = 'REJECTED'; record.reason = '该标的已有未平仓头寸'; continue; }
      const perInstrumentRemaining = runner.universe?.kind === 'watchlist'
        ? Math.max(0, (runner.policy.maxPerInstrumentUsd ?? runner.policy.maxTradeUsd) - runner.positions.filter(position => position.status === 'OPEN' && position.instrumentId === runnerLedgerInstrumentId(ref)).reduce((sum, position) => sum + position.entryPrice * position.quantity, 0))
        : runner.policy.maxTradeUsd;
      const totalRemaining = runner.universe?.kind === 'watchlist'
        ? Math.max(0, (runner.policy.maxInvestedUsd ?? runner.policy.maxBudgetUsd) - runner.positions.filter(position => position.status === 'OPEN').reduce((sum, position) => sum + position.entryPrice * position.quantity, 0))
        : runner.policy.maxTradeUsd;
      const target = Math.min(runner.cashUsd * 0.95, runner.policy.maxTradeUsd, perInstrumentRemaining, totalRemaining);
      const costMultiplier = 1 + (Number(runner.policy.feeRateBps) + Number(runner.policy.additionalSlippageBps)) / 10_000;
      const quantity = Math.floor(target / (fill.price * Math.max(1, costMultiplier)) * 1_000_000) / 1_000_000;
      if (quantity <= 0) { record.action = 'REJECTED'; record.reason = '可用风险预算不足以形成最小模拟订单'; continue; }
      const costs = calculateRunnerExecutionCosts(runner.policy, quote, 'BUY', quantity);
      const notionalAndCosts = fill.price * quantity + costs.feeUsd + costs.slippageUsd;
      const risk = evaluateRunnerOpen(runner, notionalAndCosts, new Date(), runnerLedgerInstrumentId(ref));
      record.riskChecks.push({ name: 'budget-and-risk', passed: risk.allowed, reason: risk.reason });
      if (!risk.allowed) { record.action = 'REJECTED'; record.reason = risk.reason || '风险校验未通过'; continue; }
      const opened = runnerOpenPosition(runner.id, fill.price, quantity, side || 'LONG', snapshot.requestReason || record.reason, ref, { quote, source: snapshot.source, dataAt: snapshot.dataAt, signalId: record.id, dataSnapshotId: runnerExecutionSnapshotId(snapshot.snapshotHash) });
      if (!opened) { record.action = 'REJECTED'; record.reason = '模拟账户更新失败或订单被并发状态拒绝'; continue; }
      const updated = getAiRunners().find(item => item.id === runner.id);
      record.action = 'BUY'; record.reason = `${snapshot.requestReason || record.reason}；按卖一价模拟成交`;
      record.side = snapshot.market === 'prediction' ? side as 'YES' | 'NO' : side as 'LONG' | 'SHORT' | undefined;
      record.orderId = updated?.trades[0]?.orderId;
      runnerExecutionEvidence.save(snapshot,record,runnerLedgerInstrumentId(ref),runner.accountId || 'ai-runner:'+runner.id);
      actions.push({ id: runner.id, actionZh: `BUY ${ref.symbolOrMarketId} ${quantity} @ ${fill.price}` });
    } else {
      if (!existing) { record.action = 'REJECTED'; record.reason = '没有该标的未平仓头寸可退出'; continue; }
      const costs = calculateRunnerExecutionCosts(runner.policy, quote, 'SELL', existing.quantity);
      const pnl = runnerClosePosition(runner.id, existing.id, fill.price, snapshot.requestReason || record.reason, { quote, source: snapshot.source, dataAt: snapshot.dataAt, signalId: record.id, dataSnapshotId: runnerExecutionSnapshotId(snapshot.snapshotHash), ...costs });
      if (pnl == null) { record.action = 'REJECTED'; record.reason = '模拟平仓未完成，持仓保持不变'; continue; }
      const updated = getAiRunners().find(item => item.id === runner.id);
      record.action = 'SELL'; record.reason = `${snapshot.requestReason || record.reason}；按买一价模拟成交，未扣成本净额前盈亏 ${pnl.toFixed(2)}`;
      record.side = snapshot.market === 'prediction' ? existing?.side as 'YES' | 'NO' | undefined : undefined;
      record.orderId = updated?.trades[0]?.orderId;
      runnerExecutionEvidence.save(snapshot,record,runnerLedgerInstrumentId(ref),runner.accountId || 'ai-runner:'+runner.id);
      actions.push({ id: runner.id, actionZh: `SELL ${ref.symbolOrMarketId} @ ${fill.price} PnL=${pnl.toFixed(2)}` });
    }
  }
  records.forEach(record => appendAiRunnerDecision(record));
  return { actions, decisions: records };
}

async function runAiRunnerTick(runnerId: string, idempotencyKey?: string) {
  if (!config.aiPaperTradingEnabled) return { status: 'disabled' as const };
  const runner = getAiRunners().find(item => item.id === runnerId);
  if (!runner) return { status: 'not-found' as const };
  if (runner.status !== 'RUNNING') return { status: 'inactive' as const };
  if (runner.comparisonControl) return { status: 'inactive' as const };
  const key = idempotencyKey?.trim().slice(0, 180) || buildAiRunnerTickIdempotencyKey(runnerId);
  return aiRunnerTickCoordinator.run(runnerId, key,
    () => prepareAiRunnerTick(runnerId, key),
    prepared => executePreparedRunnerTick(prepared));
}

async function tickAllAiRunners(): Promise<Array<{ id: string; actionZh: string }>> {
  if (!config.aiPaperTradingEnabled) return [];
  const results: Array<{ id: string; actionZh: string }> = [];
  for (const runner of getAiRunners().filter(item => item.status === 'RUNNING' && !item.comparisonControl)) {
    try {
      const tick = await runAiRunnerTick(runner.id);
      if (tick.status === 'completed' || tick.status === 'duplicate') results.push(...tick.result.actions);
    } catch (error) {
      const now = new Date();
      appendAiRunnerDecision({
        id: crypto.randomUUID(), runnerId: runner.id, idempotencyKey: `${buildAiRunnerTickIdempotencyKey(runner.id, now)}:failure`,
        at: now.toISOString(), market: runner.universe?.market || 'stocks', instrument: runner.symbolOrMarketId,
        dataStatus: 'failed', source: 'AI paper runner', strategyVersion: runner.strategyVersion,
        signals: [], riskChecks: [{ name: 'tick-execution', passed: false, reason: error instanceof Error ? error.message : '执行失败' }],
        action: 'REJECTED', reason: error instanceof Error ? error.message : '跑单执行失败',
      });
    }
  }
  return results;
}

app.get('/api/ai-runners/:id/history', (req, res) => {
  if (!adminOnly(req, res)) return;
  const runner = getAiRunners().find(item => item.id === String(req.params.id));
  if (!runner) return res.status(404).json({ success: false, error: '未找到跑单' });
  const page = listAiRunnerHistory(runner.id, typeof req.query.cursor === 'string' ? req.query.cursor : undefined, Number(req.query.limit || 50));
  res.json({ success: true, data: page.data, nextCursor: page.nextCursor, runnerId: runner.id, dataStatus: page.data.length ? 'historical' : 'empty', reason: page.data.length ? undefined : '暂无跑单决策记录' });
});

app.post('/api/ai-runners/:id/tick', express.json(), async (req, res) => {
  if (!adminOnly(req, res)) return;
  if (!config.aiPaperTradingEnabled) return res.status(403).json({ success: false, error: 'AI 自动纸面交易当前关闭' });
  let result: Awaited<ReturnType<typeof runAiRunnerTick>>;
  try {
    result = await runAiRunnerTick(String(req.params.id), String(req.headers['idempotency-key'] || req.body?.idempotencyKey || ''));
  } catch (error) {
    const runner = getAiRunners().find(item => item.id === String(req.params.id));
    if (runner) appendAiRunnerDecision({
      id: crypto.randomUUID(), runnerId: runner.id,
      idempotencyKey: `${String(req.headers['idempotency-key'] || req.body?.idempotencyKey || 'manual')}:failure:${Date.now()}`,
      at: new Date().toISOString(), market: runner.universe?.market || 'stocks', instrument: runner.symbolOrMarketId,
      dataStatus: 'failed', source: 'AI paper runner', strategyVersion: runner.strategyVersion,
      signals: [], riskChecks: [{ name: 'tick-execution', passed: false, reason: error instanceof Error ? error.message : '执行失败' }],
      action: 'REJECTED', reason: error instanceof Error ? error.message : '跑单执行失败',
    });
    return res.status(500).json({ success: false, error: error instanceof Error ? error.message : '跑单执行失败' });
  }
  if (result.status === 'disabled') return res.status(403).json({ success: false, error: 'AI 自动纸面交易默认关闭' });
  if (result.status === 'not-found') return res.status(404).json({ success: false, error: '未找到跑单' });
  if (result.status === 'inactive') return res.status(409).json({ success: false, error: '跑单已停止或暂停' });
  if (result.status === 'busy') return res.status(409).json({ success: false, status: 'busy', reason: '该跑单正在由另一个执行器处理' });
  res.json({ success: true, status: result.status, ...result.result });
});

app.post('/api/ai-runners/tick', express.json(), async (req, res) => {
  if (!adminOnly(req, res)) return;
  const results = await tickAllAiRunners();
  res.json({ success: true, actions: results });
});

// --- Automation Operations ---

app.get('/api/ops', (_req, res) => {
  const jobs = getAutomationJobs();
  res.json({ success: true, data: { jobs, overview: getAutomationOverview() } });
});

async function runAutomationJob(jobId: string): Promise<{ message: string }> {
  switch (jobId) {
    case 'radar-refresh':
      await warmPredictionRadarCache();
      return { message: '预测雷达缓存刷新完成' };
    case 'risk-patrol':
      await riskPatrol.runOnce({ push: false });
      return { message: '持仓风险巡检完成' };
    case 'assistant-refresh': {
      lastAdvisorReport = await generateAssistantReport();
      return { message: '智能助手报告刷新完成' };
    }
    case 'ai-runners': {
      if (!config.aiPaperTradingEnabled) return { message: 'AI 模拟跑单已由配置关闭，未调用模型或创建模拟订单' };
      const actions = await tickAllAiRunners();
      return { message: actions.length ? `AI 模拟跑单完成，产生 ${actions.length} 个动作` : 'AI 模拟跑单完成，无新动作' };
    }
    default:
      throw new Error('未知自动化任务');
  }
}

app.post('/api/ops/run/:jobId', async (req, res) => {
  const jobId = String(req.params.jobId) as Parameters<typeof saveAutomationRun>[0];
  if (jobId === 'ai-runners' && !adminOnly(req, res)) return;
  const startedAt = new Date().toISOString();
  try {
    const result = await runAutomationJob(jobId);
    const finishedAt = new Date().toISOString();
    saveAutomationRun(jobId, { status: 'SUCCESS', message: result.message, startedAt, finishedAt });
    res.json({ success: true, data: { jobId, message: result.message, finishedAt } });
  } catch (error: any) {
    const finishedAt = new Date().toISOString();
    try { saveAutomationRun(jobId, { status: 'FAILED', message: error.message, startedAt, finishedAt }); } catch { /* invalid job id */ }
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Server-Sent Events: live AI runner updates + auto-tick ---
const sseClients = new Set<import('express').Response>();

function broadcastSse(event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

app.get('/api/stream', (req, res) => {
  if (!adminOnly(req, res)) return;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Auto-execute AI runners every 60 seconds and push updates to all open pages.
setInterval(() => {
  void (async () => {
    try {
      const actions = await tickAllAiRunners();
      broadcastSse('ai-runner-update', {
        at: new Date().toISOString(),
        actions,
      });
    } catch { /* keep interval alive */ }
  })();
}, 60_000);

// Separate, opt-in scheduler. It never changes the existing standalone runner path.
setInterval(()=>{
  if(!config.aiPaperTradingEnabled)return;
  void (async()=>{
    const round=comparisonScheduler.claim(crypto.randomUUID());if(!round)return;
    let lost=false;
    const heartbeat=setInterval(()=>{try{comparisonScheduler.heartbeat(round);}catch{lost=true;}},40000);heartbeat.unref();
    try{
      const result=await runControlledComparison(round.groupId,round.id,round);
      if(lost)throw new Error('自动对照租约或配置已失效');
      comparisonScheduler.finish(round,result.status==='busy'?'waiting':'completed',result.status==='busy'?'对照组租约正在使用；本小时不重复执行':'本轮已记录共同快照及三个账户结果');
    }catch(error:any){comparisonScheduler.finish(round,'waiting',error.message || '自动对照未能完成；未自动重试');}
    finally{clearInterval(heartbeat);}
  })().catch(error=>logger.warn('automatic comparison scheduler failed',{reason:error instanceof Error?error.message:String(error)}));
},30000).unref();

// --- Backtesting ---

app.get('/api/backtest/preflight', async (req, res) => {
  const scope = String(req.query.scope || '').trim();
  const instrument = String(req.query.instrumentId || req.query.marketId || '').trim();
  const lookback = Number(req.query.lookback || 10);
  const holding = Number(req.query.holding || 5);
  if (!['stocks', 'crypto'].includes(scope)) {
    const result = buildBacktestPreflight({ market: scope, instrument, bars: [], source: null, lookback, holding });
    return res.json({ success: false, ...result, updatedAt: new Date().toISOString() });
  }
  const identityCheck = buildBacktestPreflight({ market: scope, instrument, bars: [], source: null, lookback, holding });
  if (identityCheck.dataStatus === 'unsupported') return res.json({ success: false, ...identityCheck, updatedAt: new Date().toISOString() });
  try {
    let bars: Array<{ time: number; open: number; high: number; low: number; close: number; volume?: number | null }> = [];
    let source: string | null = null;
    let sourceStatus: string | null = null;
    let sourceError: string | null = null;
    let updatedAt: string | null = null;
    if (scope === 'stocks') {
      const overview = await stockDataService.overview(instrument.replace(/^us(?=[A-Z])/i, ''));
      bars = overview.bars;
      const history = overview.snapshots.find(snapshot => snapshot.source.includes('history'));
      source = history?.source || null;
      sourceStatus = history?.status || null;
      sourceError = history?.error || null;
      updatedAt = history?.fetchedAt || null;
    } else {
      const pair = instrument.toUpperCase().replace(/[/:_-]/g, '');
      const klines = await binanceFeed.getKlines(pair, '1d', 1000);
      bars = klines.map((bar: any) => ({ time: Number(bar.time), open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close), volume: Number(bar.volume) }));
      source = 'binance-public-klines';
      sourceStatus = bars.length ? 'live' : 'empty';
      updatedAt = bars.length ? new Date().toISOString() : null;
    }
    const result = buildBacktestPreflight({ market: scope, instrument, bars, source, sourceStatus, sourceError, lookback, holding });
    return res.json({ success: result.dataStatus === 'ready', ...result, updatedAt, reason: result.reason });
  } catch (error) {
    const result = buildBacktestPreflight({ market: scope, instrument, bars: [], source: null, sourceStatus: 'unavailable', sourceError: error instanceof Error ? error.message : null, lookback, holding });
    return res.json({ success: false, ...result, dataStatus: 'unavailable', updatedAt: new Date().toISOString(), reason: error instanceof Error ? error.message : '数据源预检失败' });
  }
});

app.get('/api/backtest', async (req, res) => {
  const scope = String(req.query.scope || 'prediction');
  const lookback = parseInt(req.query.lookback as string, 10) || 10;
  const threshold = parseFloat(req.query.threshold as string) || 0.03;
  const holding = parseInt(req.query.holding as string, 10) || 5;
  const strategy = String(req.query.strategy || 'momentum') === 'meanReversion' ? 'meanReversion' : 'momentum';
  const instrumentId = String(req.query.instrumentId || req.query.marketId || '').trim();

  if (scope === 'options') {
    return res.json({
      success: false,
      scope,
      availability: 'unavailable',
      error: '期权历史数据暂不可用',
      reason: '真实历史期权链、隐含波动率和 Greeks 数据源尚未覆盖',
    });
  }

  if (scope === 'prediction') {
    const marketId = /^\d+$/.test(instrumentId) ? parseInt(instrumentId, 10) : undefined;
    const result = strategy === 'meanReversion'
      ? backtester.runMeanReversionBacktest(lookback, threshold, holding, 1000, marketId)
      : backtester.runMomentumBacktest(lookback, threshold, holding, 1000, marketId);
    return res.json({ success: true, scope, availability: 'ready', dataSource: 'local-prediction-history', instrumentId: instrumentId || 'all', data: result });
  }

  if (!['stocks', 'crypto'].includes(scope)) {
    return res.status(400).json({ success: false, scope, error: '未知市场 scope' });
  }
  if (!instrumentId) {
    return res.json({ success: false, scope, availability: 'unavailable', error: scope === 'stocks' ? '股票回测需要提供标的代码' : '虚拟币回测需要提供交易对' });
  }

  try {
    const data = scope === 'stocks'
      ? await backtester.runStockBacktest(strategy, instrumentId.replace(/^us/i, ''), lookback, threshold, holding, 1000)
      : await backtester.runCryptoBacktest(strategy, instrumentId, lookback, threshold, holding, 1000);
    return res.json({ success: true, scope, data });
  } catch (error) {
    return res.json({
      success: false,
      scope,
      availability: 'unavailable',
      error: scope === 'stocks' ? '股票历史数据暂不可用' : '虚拟币历史数据暂不可用',
      reason: error instanceof Error ? error.message : '历史数据源暂时不可用',
    });
  }
});

// --- Price History ---

app.get('/api/history/:marketId', (req, res) => {
  const data = priceTracker.getMarketHistory(parseInt(req.params.marketId));
  if (!data) return res.json({ success: false, error: '暂无该市场的历史数据' });
  res.json({ success: true, data });
});

app.get('/api/correlations', (req, res) => {
  const scope = requestedMarketScope(req.query.scope);
  res.json({ success: true, data: scope && scope !== 'overview' ? [] : priceTracker.allCorrelations() });
});

// --- News Feed ---

app.get('/api/news', async (req, res) => {
  try {
    const scope = requestedMarketScope(req.query.scope);
    if (scope === 'stocks') {
      const instrumentId = String(req.query.instrumentId || '');
      const symbol = instrumentId.match(/^stock:[^:]+:([A-Z0-9.-]+)$/i)?.[1] || String(req.query.symbol || '');
      if (!symbol) return res.json({ success: true, data: [], reason: '需要先选择股票标的' });
      return res.json({ success: true, data: await getStockNews(symbol) });
    }
    if (scope && !['overview', 'crypto'].includes(scope)) return res.json({ success: true, data: [] });
    const items = await newsFeed.getNews();
    res.json({ success: true, data: items });
  } catch (e: any) {
    res.json({ success: false, error: e.message });
  }
});

// --- Settings ---

app.get('/api/settings', (req, res) => {
  const data = settingsManager.get();
  res.json({ success: true, data, ai: getAiConfigurationStatus(data), telegram: runtimeSecrets.status() });
});

// Canonical cross-asset entry points. Existing /api/stock, /api/binance and
// /api/markets routes stay intact; these routes provide one stable contract.
const chartAnalysis: any = require('../web/public/chart-analysis.js');
function scopedInstrumentType(market: MarketId): InstrumentType {
  return market === 'stocks' ? 'stock' : market === 'options' ? 'option' : market === 'crypto' ? 'crypto' : 'prediction';
}

function telegramInstrumentScope(type: string): MarketScope {
  return type === 'stock' ? 'stocks' : type === 'option' ? 'options' : type === 'crypto' ? 'crypto' : 'prediction';
}

function telegramRefFromId(id: string): any | null {
  const [type, venue, ...symbolParts] = String(id || '').split(':');
  if (!['stock', 'option', 'crypto', 'prediction'].includes(type) || !venue || !symbolParts.join(':').trim()) return null;
  return normalizeInstrumentRef({
    type: type as InstrumentType,
    venue,
    symbol: symbolParts.join(':'),
    title: symbolParts.join(':'),
    aliases: [],
  });
}

function telegramSafeExternalUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value || '').trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function telegramQuickCloseValues(klines: unknown[]): number[] {
  return (Array.isArray(klines) ? klines : []).map(item => {
    if (Array.isArray(item)) return Number(item[4]);
    if (item && typeof item === 'object') {
      const value = (item as any).close ?? (item as any).price ?? (item as any).lastPrice;
      return Number(value);
    }
    return NaN;
  }).filter(Number.isFinite).slice(-24);
}

function telegramStatusLabel(state: string): string {
  return ({ live: '实时', cached: '缓存', degraded: '部分可用', unavailable: '来源不可用' } as Record<string, string>)[state] || '未知';
}

function telegramQuickValue(detail: any): { price: number | null; changePct: number | null; source: string } {
  const q = detail.quote || detail.marketData || {};
  const price = Number(q.price ?? q.lastPrice ?? q.yesPrice ?? q.spot ?? q.close);
  const changePct = Number(q.changePct ?? q.changePercent ?? q.priceChangePercent ?? q.change24hPct);
  const source = String(q.source || q.platform || Object.entries(detail.sourceStatus || {}).find(([, value]) => value === 'ok')?.[0] || '未声明');
  return { price: Number.isFinite(price) ? price : null, changePct: Number.isFinite(changePct) ? changePct : null, source };
}

function telegramQuickDeepLink(ref: any, workspace: string): string | null {
  return buildTelegramDeepLink(telegramPublicBaseUrl(), {
    market: telegramInstrumentScope(ref.type),
    instrument: ref.id,
    timeframe: '1h',
    workspace,
  });
}

function telegramQuickReply(chatId: string, ref: any, detail: any, query: string): TelegramReply {
  const values = telegramQuickValue(detail);
  const status = telegramStatusLabel(detail.status?.state || 'unavailable');
  const change = values.changePct == null ? '暂无涨跌' : `${values.changePct >= 0 ? '+' : ''}${formatTelegramNumber(values.changePct, 2)}%`;
  const value = values.price == null ? '暂无数据' : formatTelegramNumber(values.price, ref.type === 'prediction' ? 3 : ref.type === 'crypto' ? 4 : 2);
  const closes = telegramQuickCloseValues(detail.klines);
  const workspace = telegramWorkspaceForType(ref.type);
  const link = telegramQuickDeepLink(ref, workspace);
  const analysisLink = telegramQuickDeepLink(ref, 'analysis');
  const scope = telegramInstrumentScope(ref.type);
  const keyboard: TelegramInlineKeyboardButton[][] = [
    [
      { text: '⭐ 加入自选', callback_data: telegramContextCallback('quick:watch', ref, workspace, '1h', chatId) },
      link ? { text: '📈 K线/详情', url: link } : { text: '📈 K线/详情', callback_data: telegramScopedCallback('unified:show', scope, ref.id, chatId) },
    ],
    [
      analysisLink ? { text: '🧠 研究分析', url: analysisLink } : { text: '🧠 研究分析', callback_data: telegramScopedCallback('unified:show', scope, ref.id, chatId) },
      { text: '🧪 回测入口', callback_data: telegramContextCallback('quick:backtest', ref, workspace, '1h', chatId) },
    ],
    [
      { text: '📰 新闻/事件', callback_data: telegramContextCallback('quick:timeline', ref, workspace, '1h', chatId) },
      { text: '🔔 设置提醒', callback_data: telegramContextCallback('quick:alert', ref, workspace, '1h', chatId) },
    ],
  ];
  return telegramInlineReply([
    `<b>🔎 快速查询 · ${escapeTelegramHtml(TELEGRAM_SCOPE_LABELS[scope])}</b>`,
    `<b>${escapeTelegramHtml(ref.title || ref.symbol)}</b> · <code>${escapeTelegramHtml(ref.id)}</code>`,
    `价格/概率：${escapeTelegramHtml(value)} · ${escapeTelegramHtml(change)}`,
    `来源：${escapeTelegramHtml(values.source)} · 数据状态：${status}`,
    `更新时间：${escapeTelegramHtml(String(detail.freshness?.fetchedAt || detail.status?.reason || '暂无'))}`,
    `趋势：${sparkline(closes)}`,
    detail.status?.reason ? `说明：${escapeTelegramHtml(detail.status.reason)}` : '说明：当前数据源可用。',
    '',
    '以上为研究与模拟盘信息，不构成交易指令。',
  ].join('\n'), keyboard);
}

async function telegramQuickCandidates(query: string, scope: MarketScope = 'overview', allowCanonicalCrossScope = false): Promise<any[]> {
  const canonical = telegramRefFromId(query);
  if (!isTelegramBareQueryScope(scope)) return [];
  if (canonical) return allowCanonicalCrossScope || telegramInstrumentScope(canonical.type) === scope ? [canonical] : [];
  const candidates = [...await unifiedInstrumentService.search(query, scope).catch(() => [])];
  if (isTelegramBareSymbol(query) && /^[a-z]{1,6}$/i.test(query)) {
    if (scope === 'options') {
      const option = await getEquityOptionsSnapshot(query.toUpperCase()).catch(() => null);
      if (option) candidates.push(normalizeInstrumentRef({ type: 'option', venue: 'cboe', symbol: option.asset, title: `${option.asset} 期权`, aliases: [option.asset] }));
    }
    if (scope === 'stocks' && !candidates.some(item => item.type === 'stock')) {
      candidates.push(normalizeInstrumentRef({ type: 'stock', venue: 'us', symbol: query.toUpperCase(), title: query.toUpperCase(), aliases: [query.toUpperCase()] }));
    }
  }
  const seen = new Set<string>();
  return candidates.filter(item => !seen.has(item.id) && seen.add(item.id)).slice(0, 12);
}

function telegramQuickCandidateReply(query: string, candidates: any[], chatId?: string): TelegramReply {
  const groups: Record<string, any[]> = {};
  for (const item of candidates) (groups[item.type] ||= []).push(item);
  const labels: Record<string, string> = { stock: '股票', option: '期权', crypto: '虚拟币', prediction: '预测市场' };
  const lines = [`<b>🔎 快速查询</b> · ${escapeTelegramHtml(query)}`, '请选择市场和标的：'];
  const keyboard: TelegramInlineKeyboardButton[][] = [];
  for (const type of ['stock', 'option', 'crypto', 'prediction']) {
    for (const item of groups[type] || []) {
      lines.push(`· ${labels[type]}：${escapeTelegramHtml(item.title)} · <code>${escapeTelegramHtml(item.id)}</code>${item.subtitle ? ` · ${escapeTelegramHtml(item.subtitle)}` : ''}`);
      keyboard.push([
        { text: `${labels[type]} ${String(item.title).slice(0, 10)}`, callback_data: telegramContextCallback('quick:select', item, telegramWorkspaceForType(type), '1h', chatId) },
        { text: '⭐ 加自选', callback_data: telegramContextCallback('quick:watch', item, telegramWorkspaceForType(type), '1h', chatId) },
      ]);
    }
  }
  return telegramInlineReply(lines.join('\n'), keyboard);
}
function scopedVenue(market: MarketId): string {
  return market === 'stocks' ? 'us' : market === 'options' ? 'cboe' : market === 'crypto' ? 'binance' : 'predictfun';
}
function overlayQueryConfig(query: Record<string, unknown>): Record<string, unknown> {
  return {
    signals: String(query.signals || 'true') !== 'false',
    patterns: String(query.patterns || 'false') === 'true',
    structures: String(query.structures || 'false') === 'true',
    volume: String(query.volume || 'true') !== 'false',
    indicators: { ma: String(query.ma || 'true') !== 'false', boll: String(query.boll || 'false') === 'true', macd: String(query.macd || 'false') === 'true' },
  };
}
function normalizeHistoricalKlineBars(rows: Array<Record<string, unknown>>): Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> {
  return rows.map(row => {
    const time = row.timestamp instanceof Date ? row.timestamp.getTime() : Date.parse(String(row.timestamp));
    return { time, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0) };
  }).filter(row => [row.time, row.open, row.high, row.low, row.close].every(Number.isFinite));
}
async function scopedKlinePayload(marketInput: string, instrumentInput: string, query: Record<string, unknown>) {
  if (!MARKET_IDS.includes(marketInput as MarketId)) throw new Error('Invalid market context');
  const market = marketInput as MarketId;
  const rawInstrument = decodeURIComponent(String(instrumentInput || '')).trim();
  if (!rawInstrument) throw new Error('Instrument is required');
  const instrument = normalizeInstrumentRef({ type: scopedInstrumentType(market), venue: scopedVenue(market), symbol: rawInstrument, title: rawInstrument, aliases: [], marketId: market });
  assertMarketContext({ market, workspace: 'kline', instrument: instrument.id });
  const timeframe = String(query.timeframe || '1h');
  const asOf = String(query.asOf || '').trim();
  let normalizedBars: Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }> = [];
  let dataStatus: string;
  let klineSource: string | null = null;
  let updatedAt: string;
  let reason: string | null = null;
  let snapshotId: string | null = null;
  if (asOf) {
    const lakeInstrument = market === 'stocks' || market === 'crypto' ? instrument.symbol.toUpperCase() : rawInstrument;
    const historical = await dataLakeCatalog.queryBarsAsOf({ market, instrument: lakeInstrument, timeframe, asOf });
    normalizedBars = normalizeHistoricalKlineBars(historical.rows);
    dataStatus = normalizedBars.length ? 'historical' : historical.dataStatus;
    klineSource = historical.source || 'MoneyMoney 本地时点数据湖';
    updatedAt = historical.updatedAt || asOf;
    snapshotId = historical.snapshot?.id || null;
    reason = normalizedBars.length ? null : (historical.reason || '历史K线数据不可用，未回退到实时数据');
  } else {
    const overview = await unifiedInstrumentService.overview(instrument);
    const bars = Array.isArray(overview.klines) ? overview.klines : [];
    klineSource = Object.entries(overview.sourceStatus).find(([key, status]) => key.toLowerCase().includes('kline') && status !== 'unavailable')?.[0] || null;
    dataStatus = bars.length ? (overview.sourceStatus.klines === 'stale' ? 'cached' : 'live') : (overview.status.state === 'unavailable' ? 'unavailable' : 'empty');
    reason = bars.length ? null : (overview.status.reason || (market === 'options' || market === 'prediction' ? '当前市场暂未提供 K 线数据' : '来源不可用'));
    normalizedBars = bars.map((bar: any) => ({ ...bar, time: Number(bar.time), open: Number(bar.open), high: Number(bar.high), low: Number(bar.low), close: Number(bar.close), volume: Number(bar.volume || 0) })).filter((bar: any) => [bar.time, bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
    updatedAt = overview.freshness.fetchedAt || new Date().toISOString();
  }
  const config = overlayQueryConfig(query);
  const overlays = normalizedBars.length >= 3 ? chartAnalysis.buildChartOverlays({ bars: normalizedBars, config, signals: [] }) : { emptyReason: reason || '暂无数据', config, signals: [], patterns: [], structures: [], annotations: [], explanations: [], lines: [], volume: [] };
  return { market, instrument: instrument.id, timeframe, dataStatus, source: klineSource, updatedAt, reason, ...(asOf ? { asOf, snapshotId } : {}), bars: normalizedBars, overlays };
}

app.get('/api/kline/:market/:instrument', async (req, res) => {
  try {
    res.json({ success: true, data: await scopedKlinePayload(String(req.params.market), String(req.params.instrument), req.query as Record<string, unknown>) });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error?.message || 'K 线数据请求失败', dataStatus: 'unavailable', reason: error?.message || '请求失败' });
  }
});

app.get('/api/kline/:market/:instrument/replay', async (req, res) => {
  try {
    const payload = await scopedKlinePayload(String(req.params.market), String(req.params.instrument), req.query as Record<string, unknown>);
    const currentIndex = Number(req.query.index ?? Math.max(0, payload.bars.length - 1));
    const action = String(req.query.action || 'current');
    const nextIndex = chartAnalysis.stepReplay(currentIndex, payload.bars.length, action);
    const visibleBars = nextIndex >= 0 ? payload.bars.slice(0, nextIndex + 1) : [];
    res.json({ success: true, data: { ...payload, replay: { action, currentIndex, nextIndex, length: payload.bars.length }, bars: visibleBars, overlays: chartAnalysis.buildChartOverlays({ bars: visibleBars, config: payload.overlays.config, signals: [] }) } });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error?.message || 'K 线回放请求失败', dataStatus: 'unavailable', reason: error?.message || '请求失败' });
  }
});

app.post('/api/kline/:market/:instrument/drawings', express.json(), (req, res) => {
  try {
    const marketInput = String(req.params.market);
    if (!MARKET_IDS.includes(marketInput as MarketId)) throw new Error('Invalid market context');
    const market = marketInput as MarketId;
    const rawInstrument = decodeURIComponent(String(req.params.instrument || '')).trim();
    const instrument = normalizeInstrumentRef({ type: scopedInstrumentType(market), venue: scopedVenue(market), symbol: rawInstrument, title: rawInstrument, aliases: [], marketId: market });
    assertMarketContext({ market, workspace: 'kline-drawing', instrument: instrument.id });
    const key = `kline-drawings:${instrument.id}`;
    const items = (stateStore.get<any[]>(key) || []).filter(item => item && typeof item.id === 'string');
    const action = String(req.body?.action || 'create');
    let next = items;
    if (action === 'create') next = [...items, { id: String(req.body?.id || `drawing_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`), type: String(req.body?.type || 'text'), ...((req.body?.properties && typeof req.body.properties === 'object') ? req.body.properties : {}) }];
    else if (action === 'update') next = items.map(item => item.id === String(req.body?.id) ? { ...item, ...((req.body?.properties && typeof req.body.properties === 'object') ? req.body.properties : {}) } : item);
    else if (action === 'delete') next = items.filter(item => item.id !== String(req.body?.id));
    else throw new Error('绘图操作无效');
    stateStore.set(key, next, 1);
    res.json({ success: true, data: { market, instrument: instrument.id, drawings: next, dataStatus: 'live', source: 'local', updatedAt: new Date().toISOString(), reason: null } });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || '绘图操作失败' }); }
});

function validateInstrumentScope(type: InstrumentType, scope: string): boolean {
  if (!scope || scope === 'overview' || scope === 'watchlist') return true;
  return (scope === 'stocks' && type === 'stock')
    || (scope === 'options' && type === 'option')
    || (scope === 'crypto' && type === 'crypto')
    || (scope === 'prediction' && type === 'prediction');
}

app.get('/api/instruments/search', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ success: true, data: [] });
    const rawScope = String(req.query.scope || 'overview');
    if (!MARKET_SCOPES.includes(rawScope as MarketScope)) return res.status(400).json({ success: false, error: '市场范围无效', data: [] });
    const data = await unifiedInstrumentService.search(q, rawScope as MarketScope);
    res.json({ success: true, data, fetchedAt: new Date().toISOString() });
  } catch (error: any) {
    res.status(502).json({ success: false, error: error?.message || '统一搜索暂不可用', data: [] });
  }
});

app.get('/api/instruments/:type/:venue/:symbol/overview', async (req, res) => {
  try {
    const type = String(req.params.type).toLowerCase() as InstrumentType;
    const scope = String(req.query.scope || '');
    if (!['stock', 'option', 'crypto', 'prediction'].includes(type)) return res.status(400).json({ success: false, error: '不支持的标的类型' });
    if (!validateInstrumentScope(type, scope)) return res.status(400).json({ success: false, error: '标的与市场范围不匹配', code: 'INSTRUMENT_SCOPE_MISMATCH' });
    const instrument = normalizeInstrumentRef({ type, venue: String(req.params.venue), symbol: decodeURIComponent(String(req.params.symbol)), title: String(req.query.title || ''), aliases: [] });
    const data = await unifiedInstrumentService.overview(instrument);
    res.json({ success: true, data, sections: data.sections, timeline: data.timeline, status: data.status });
  } catch (error: any) {
    res.status(502).json({ success: false, error: error?.message || '标的详情暂不可用' });
  }
});

app.get('/api/instruments/:type/:venue/:symbol/timeline', async (req, res) => {
  try {
    const type = String(req.params.type).toLowerCase() as InstrumentType;
    const scope = String(req.query.scope || '');
    if (!['stock', 'option', 'crypto', 'prediction'].includes(type)) return res.status(400).json({ success: false, error: '不支持的标的类型' });
    if (!validateInstrumentScope(type, scope)) return res.status(400).json({ success: false, error: '标的与市场范围不匹配', code: 'INSTRUMENT_SCOPE_MISMATCH' });
    const instrument = normalizeInstrumentRef({ type, venue: String(req.params.venue), symbol: decodeURIComponent(String(req.params.symbol)), title: String(req.query.title || ''), aliases: [] });
    const data = await unifiedInstrumentService.timeline(instrument);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(502).json({ success: false, error: error?.message || '标的时间线暂不可用' });
  }
});

// Shared web/Telegram state. The current deployment intentionally has one
// owner; ownerId remains explicit so a future multi-user migration is local.
app.get('/api/watchlist', (req, res) => {
  if (!adminOnly(req, res)) return;
  res.json({ success: true, data: unifiedAlertStore.listWatchlist(), ownerId: 'admin' });
});
app.get('/api/workspace/watchlist', (req, res) => {
  const rawScope = String(req.query.scope || 'watchlist');
  if (!MARKET_SCOPES.includes(rawScope as MarketScope)) {
    return res.status(400).json({ success: false, error: '未知市场 scope' });
  }
  const requestedGroup = String(req.query.group || 'all');
  if (!['all', 'watchlist', 'paper'].includes(requestedGroup)) {
    return res.status(400).json({ success: false, error: '未知标的库分组' });
  }
  const scope = rawScope as MarketScope;
  const scopeForId = (value: string): MarketScope | null => {
    const id = value.toLowerCase();
    if (id.startsWith('stock:')) return 'stocks';
    if (id.startsWith('crypto:')) return 'crypto';
    if (id.startsWith('option:')) return 'options';
    if (id.startsWith('prediction:')) return 'prediction';
    return null;
  };
  const allWatchlist = unifiedAlertStore.listWatchlist().map(instrumentId => ({
    instrumentId: String(instrumentId),
    title: String(instrumentId),
    type: scopeForId(String(instrumentId)),
  }));
  const token = extractAuthToken(req as any);
  const payload = token ? verifyLoginToken(token) : null;
  const watchlist = payload?.role === 'guest' ? [] : scope === 'overview' || scope === 'watchlist'
    ? allWatchlist
    : allWatchlist.filter(item => item.type === scope);
  const paper = payload?.role === 'guest' ? [] : (scope === 'overview' || scope === 'watchlist'
    ? unifiedPaperLedgerStore.get().positions
    : filterUnifiedPaperLedger(unifiedPaperLedgerStore.get(), scope).positions).map(position => ({
      instrumentId: String(position.instrumentId),
      title: String(position.title || position.instrumentId),
      type: position.instrumentType || scopeForId(String(position.instrumentId)),
      quantity: Number(position.quantity || 0),
      currentPrice: Number(position.currentPrice || position.averageEntryPrice || 0),
    }));
  const groups = [
    { id: 'watchlist', label: '我的自选', items: watchlist },
    { id: 'paper', label: '模拟持仓', items: paper },
  ].filter(group => requestedGroup === 'all' || group.id === requestedGroup);
  return res.json({ success: true, scope, group: requestedGroup, groups });
});
app.post('/api/watchlist', (req, res) => {
  if (!adminOnly(req, res)) return;
  const instrumentId = String(req.body?.instrumentId || '').trim();
  if (!instrumentId) return res.status(400).json({ success: false, error: '缺少标的 ID' });
  res.json({ success: true, data: unifiedAlertStore.addWatchlist(instrumentId), ownerId: 'admin' });
});
app.delete('/api/watchlist/:instrumentId', (req, res) => {
  if (!adminOnly(req, res)) return;
  res.json({ success: true, data: unifiedAlertStore.removeWatchlist(decodeURIComponent(req.params.instrumentId)), ownerId: 'admin' });
});

app.get('/api/alert-rules', (req, res) => {
  if (!adminOnly(req, res)) return;
  res.json({ success: true, data: unifiedAlertStore.listRules(), ownerId: 'admin' });
});
app.get('/api/alerts/metric-capabilities', (req,res)=>{
  if(!adminOnly(req,res)) return;
  const instrument=String(req.query.instrument || '');
  res.json({success:true,instrument,fields:alertMetricFields(instrument),source:'当前市场和交易场所能力',dataStatus:alertMetricFields(instrument).length ? 'cached':'unsupported'});
});
app.post('/api/alerts/metric-preview', express.json(),async(req,res)=>{
  if(!adminOnly(req,res)) return;
  const input={...req.body,kind:'metric'} as Partial<UnifiedAlertRule>,validation=validateUnifiedAlertRule(input);
  if(!validation.ok) return res.status(400).json({success:false,reason:validation.error});
  const observation=await metricObservation(input),at=Date.parse(observation.observedAt || '');
  const result=evaluateUnifiedAlert(input as UnifiedAlertRule,observation),fresh=Number.isFinite(at) && at<=Date.now()+60_000 && Date.now()-at<=120_000;
  const clauses=explainMetricConditions(input.condition || {},observation).map(row=>fresh ? row:{...row,matched:false,reason:'来源快照过期或没有时间'});
  res.json({success:true,data:{...result,matched:result.matched && fresh,clauses,observation,durationMinutes:input.condition?.durationMinutes || 0},dataStatus:observation.dataStatus,reason:!fresh ? '来源快照过期或没有时间，当前不能触发提醒':observation.reason || null});
});
app.post('/api/alert-rules', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const rule = unifiedAlertStore.createRule({ ...(req.body || {}), ownerId: 'admin' });
    res.status(201).json({ success: true, data: rule });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || '提醒规则无效' }); }
});
app.patch('/api/alert-rules/:id', (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const rule = unifiedAlertStore.updateRule(String(req.params.id), req.body || {});
    if (!rule) return res.status(404).json({ success: false, error: '提醒规则不存在' });
    res.json({ success: true, data: rule });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || '提醒规则无效' }); }
});
app.delete('/api/alert-rules/:id', (req, res) => {
  if (!adminOnly(req, res)) return;
  res.json({ success: unifiedAlertStore.removeRule(String(req.params.id)) });
});
app.get('/api/alerts/history', (req, res) => {
  if (!adminOnly(req, res)) return;
  res.json({ success: true, data: unifiedAlertStore.listHistory(Number(req.query.limit) || 100) });
});
app.post('/api/alerts/dry-run', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const observations = Array.isArray(req.body?.observations) ? req.body.observations : [];
    res.json({ success: true, data: previewUnifiedAlerts(unifiedAlertStore, observations.map((item: any) => ({ instrumentId: String(item.instrumentId || ''), observation: item.observation || item }))) });
  } catch (error: any) { res.status(400).json({ success: false, error: error?.message || '提醒试运行失败' }); }
});
app.get('/api/alerts/deliveries', (req, res) => {
  if (!adminOnly(req, res)) return;
  res.json({ success: true, data: researchRepository.listAlertDeliveries(Number(req.query.limit) || 100) });
});
app.post('/api/alerts/deliveries/:id/retry', express.json(), async (req, res) => {
  if (!adminOnly(req, res)) return;
  let queued: any;
  try {
    queued = researchRepository.retryAlertDelivery(String(req.params.id));
    if (!queued) return res.status(404).json({ success: false, error: '提醒投递记录不存在' });
  } catch (error: any) { return res.status(409).json({ success: false, error: error?.message || '提醒投递不可重试' }); }

  try {
    if (queued.channel === 'web' && queued.payload?.message) {
      pushNotification('alert', queued.payload.message);
    } else if (queued.channel === 'telegram' && queued.payload?.chatId && telegramInteractionBot) {
      await telegramInteractionBot.sendToChat(queued.payload.chatId, telegramReply(escapeTelegramHtml(queued.payload.message || 'MoneyMoney 提醒')));
    } else {
      throw new Error(queued.channel === 'telegram' ? 'Telegram 未运行或投递记录缺少 chatId' : '投递记录缺少可重试的渠道和内容');
    }
    const delivered = { ...queued, status: 'sent', lastError: undefined, deliveredAt: new Date().toISOString() };
    researchRepository.saveAlertDelivery(delivered);
    return res.json({ success: true, data: delivered });
  } catch (error: any) {
    const failed = { ...queued, status: 'failed', lastError: error?.message || '提醒投递失败' };
    researchRepository.saveAlertDelivery(failed);
    return res.status(502).json({ success: false, error: failed.lastError, data: failed });
  }
});
app.post('/api/alerts/:id/ack', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  const delivery = researchRepository.updateAlertDeliveryStatus(String(req.params.id), 'acknowledged', new Date().toISOString());
  if (!delivery) return res.status(404).json({ success: false, error: '提醒投递记录不存在' });
  res.json({ success: true, data: delivery });
});
app.post('/api/alerts/deliveries/:id/feedback', express.json(), (req, res) => {
  if (!adminOnly(req, res)) return;
  try {
    const delivery = researchRepository.updateAlertDeliveryFeedback(String(req.params.id), req.body?.rating, new Date().toISOString());
    if (!delivery) return res.status(404).json({ success: false, error: '提醒投递记录不存在' });
    return res.json({ success: true, data: delivery });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || '提醒反馈无效' });
  }
});

app.post('/api/settings', (req, res) => {
  const updated = settingsManager.update(req.body);
  res.json({ success: true, data: updated, ai: getAiConfigurationStatus(updated) });
});

app.post('/api/settings/reset', (req, res) => {
  const reset = settingsManager.reset();
  res.json({ success: true, data: reset, ai: getAiConfigurationStatus(reset) });
});

app.get('/api/settings/secrets', (_req, res) => {
  res.json({
    success: true,
    ai: getAiConfigurationStatus(settingsManager.get()),
    telegram: runtimeSecrets.status(),
  });
});

app.post('/api/settings/secrets', (req, res) => {
  const body = req.body || {};
  const patch: Record<string, string | boolean> = {};
  const fields = [
    'openrouterApiKey', 'groqApiKey', 'telegramBotToken', 'telegramChatId',
    'telegramAllowedChatIds', 'telegramAdminChatIds', 'telegramProxyUrl',
  ] as const;
  for (const field of fields) {
    if (typeof body[field] === 'string' && body[field].trim()) patch[field] = body[field];
  }
  if (typeof body.telegramPollingEnabled === 'boolean') patch.telegramPollingEnabled = body.telegramPollingEnabled;
  runtimeSecrets.update(patch);
  const updated = settingsManager.get();
  void reloadTelegramIntegration().catch(error => logger.error('telegram_reload_failed', { error: error instanceof Error ? error.message : String(error) }));
  res.json({
    success: true,
    ai: getAiConfigurationStatus(updated),
    telegram: runtimeSecrets.status(),
  });
});

app.post('/api/ai/test', async (req, res) => {
  const chain = String(req.body?.chain || '').toLowerCase() as AiChain;
  if (chain !== 'openrouter' && chain !== 'groq') {
    res.status(400).json({ success: false, error: 'chain 必须是 openrouter 或 groq' });
    return;
  }
  const result = await testAiConnection(chain);
  res.status(result.success ? 200 : 400).json({ success: result.success, data: result });
});

// --- Telegram Test ---

app.post('/api/telegram/test', async (req, res) => {
  if (!adminOnly(req, res)) return;
  const sent = await telegram.send('🤖 Predict.fun Bot connected! You will receive trading signals here.');
  res.json({ success: sent, message: sent ? '测试消息已发送！' : 'Telegram 未配置或发送失败' });
});

app.post('/api/telegram/test-delivery', express.json(), async (req, res) => {
  if (!adminOnly(req, res)) return;
  const telegramConfig = getRuntimeTelegramConfig();
  const adminChats = [...telegramAdminChatIds()];
  const allowedChats = parseChatIds(telegramConfig.allowedChatIds, telegramConfig.chatId);
  const recipientId = typeof req.body?.chatId === 'string' && req.body.chatId.trim() ? req.body.chatId.trim() : adminChats[0] || '';
  const result = await runTelegramTestDelivery({
    store: stateStore,
    recipientId,
    adminChatIds: adminChats,
    allowedChatIds: allowedChats,
    botConfigured: Boolean(telegramConfig.botToken),
    idempotencyKey: String(req.body?.idempotencyKey || ''),
    sendMessage: async (chatId, text, recordId) => {
      const callbackData = issueTelegramCallback('telegram-test:ack', {
        scope: telegramScopeForChat(chatId), id: recordId, workspace: 'telegram-test', chatId,
      });
      await new TelegramApiTransport(telegramConfig.botToken, telegramConfig.proxyUrl).sendMessage(chatId, text, {
        inline_keyboard: [[{ text: '✅ 我已收到', callback_data: callbackData }]],
      });
    },
  });
  const deliveryStatus = result.status === 'duplicate' ? result.record?.status : result.status;
  const statusCode = deliveryStatus === 'sent' || deliveryStatus === 'acknowledged' ? 200 : deliveryStatus === 'sending' ? 202 : deliveryStatus === 'rejected' ? 403 : deliveryStatus === 'suppressed' ? 429 : deliveryStatus === 'failed' ? 502 : 503;
  const dataStatus = deliveryStatus === 'sent' || deliveryStatus === 'acknowledged' ? 'live' : deliveryStatus === 'failed' ? 'failed' : deliveryStatus === 'sending' ? 'partial' : 'unavailable';
  res.status(statusCode).json({ success: deliveryStatus === 'sent' || deliveryStatus === 'acknowledged', data: result, dataStatus, source: 'explicit administrator Telegram delivery test', updatedAt: new Date().toISOString(), reason: result.reason });
});

app.get('/api/telegram/status', (req, res) => {
  if (!adminOnly(req, res)) return;
  const telegramConfig = getRuntimeTelegramConfig();
  res.json({
    success: true,
    data: {
      configured: telegram.isConfigured,
      pollingEnabled: telegramConfig.pollingEnabled,
      pollingRunning: telegramInteractionBot?.isRunning || false,
      allowedChatCount: parseChatIds(telegramConfig.allowedChatIds, telegramConfig.chatId).length,
      offset: telegramInteractionBot?.offset ?? null,
      polling: telegramInteractionBot?.pollingStatus || null,
      lease: stateStore.getLease('telegram:getUpdates'),
      testDeliveryHistory: listTelegramTestDeliveries(stateStore),
    },
  });
});

app.get('/api/telegram/command-center', (req, res) => {
  if (!adminOnly(req, res)) return;
  const telegramConfig = getRuntimeTelegramConfig();
  const alerts = telegramCommandCenterStore.listPriceAlerts().filter(item => !item.triggered);
  res.json({
    success: true,
    data: {
      chats: parseChatIds(telegramConfig.allowedChatIds, telegramConfig.chatId).length,
      activePriceAlerts: alerts.length,
      auditRecords: telegramCommandCenterStore.listAudits(undefined, 200).length,
      monitor: { price: !!telegramPriceMonitor, event: !!telegramEventMonitor, slow: !!telegramSlowMonitor },
    },
  });
});

// --- Notification Channel Test ---

app.post('/api/notification-channels/test', async (req, res) => {
  if (!adminOnly(req, res)) return;
  const result = await testNotificationChannels();
  res.json({ success: true, data: result });
});

// --- Daily Report ---

app.post('/api/report/daily', async (req, res) => {
  if (!adminOnly(req, res)) return;
  const report = await reportScheduler.sendDailyReport();
  res.json({ success: true, data: { report } });
});

// Start server
async function main() {
  const hasWallet = !!config.privateKey;

  const accessErrors = validateAccessConfiguration(config.appHost, config.lanMode, config.accessToken);
  if (accessErrors.length) throw new Error(accessErrors.join('; '));

  const publicMode = config.lanMode || !!process.env.MONEYMONEY_PUBLIC_BASE_URL || process.env.NODE_ENV === 'production';
  const loginErrors = validateLoginConfiguration({
    publicMode,
    loginUser: config.loginUser,
    loginPass: config.loginPass,
    jwtSecretConfigured: !isJwtSecretDefault(),
  });
  if (loginErrors.length) throw new Error(loginErrors.join('; '));

  if (isJwtSecretDefault()) console.warn('  ⚠️ MONEYMONEY_JWT_SECRET 为默认值，重启后所有 token 失效，请设置随机字符串\n');
  console.log(hasWallet
    ? '\n  Wallet configured for read-only inspection; real trading executor is DISABLED.\n'
    : '\n  Running in VIEW-ONLY mode (no wallet configured)\n');




  const PORT = config.appPort;
  const server = app.listen(PORT, config.appHost, () => {
    console.log(`  ╔══════════════════════════════════════════════╗`);

    console.log(`  ║  💰 MONEYMONEY TRADING DASHBOARD                   ║`);

    console.log(`  ╠══════════════════════════════════════════════╣`);

    console.log(`  ║  Open in browser:                            ║`);

    console.log(`  ║  http://localhost:${PORT}                        ║`);
    console.log(`  ╚══════════════════════════════════════════════╝\n`);
    riskPatrol.start();
    startUnifiedAlertMonitor();
    startCoverageCanaryMonitor();
    startPaperDriftMonitor();
    startMarketHistoryCaptureMonitor();
    if (process.env.MONEYMONEY_DISABLE_GURU_REFRESH !== 'true') startGuruHoldingsRefreshMonitor();
    // Pre-fetch radar data so the first click on the tab is already warm.
    void warmPredictionRadarCache();
    startTelegramInteractionBot();
    startTelegramCommandCenterMonitor();
  });

  server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {

      console.error(`\n  ❌ Port ${PORT} is already in use!`);

      console.error('  Try: taskkill /F /IM node.exe\n');

    } else {

    console.error('  Server error:', err.message);
    }

    process.exit(1);

  });



  // Keep process alive

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n  Shutting down...');
    liveKlineHub.close();
    stopTelegramCommandCenterMonitor();
    stopUnifiedAlertMonitor();
    stopCoverageCanaryMonitor();
    stopPaperDriftMonitor();
    await stopMarketHistoryCaptureMonitor();
    if (process.env.MONEYMONEY_DISABLE_GURU_REFRESH !== 'true') await stopGuruHoldingsRefreshMonitor();
    reportScheduler.stop();
    const current = telegramInteractionBot;
    telegramInteractionBot = null;
    await current?.stop();
    await new Promise<void>(resolve => server.close(() => resolve()));
    process.exit(0);
  };
  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

}



if (require.main === module) {
  main().catch(err => {
    console.error('  ❌ Startup error:', err.message);
    process.exit(1);
  });
}
