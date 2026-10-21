#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ts = require('typescript');
const { expandDashboardRuntime } = require('./dashboard-source-transform.cjs');
const { optimizeWebAsset } = require('./optimize-web-assets.cjs');
const { deferStockChartMarkup } = require('./stock-workspace-markup.cjs');

const root = path.join(__dirname, '..');
const source = path.join(root, 'src', 'web', 'public');
const target = path.join(root, 'dist', 'web', 'public');

const runtimeScripts = path.join(root, 'dist', 'scripts');
fs.mkdirSync(runtimeScripts, { recursive: true });
fs.copyFileSync(path.join(root, 'scripts', 'state-backup.cjs'), path.join(runtimeScripts, 'state-backup.cjs'));

if (!fs.existsSync(source)) {
  console.error(`Missing web asset source: ${source}`);
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.cpSync(source, target, { recursive: true });

const assets = path.join(target, 'assets');
fs.mkdirSync(assets, { recursive: true });
const manifest = {};
function emit(name, body, extension) {
  const content = Buffer.from(optimizeWebAsset(body, extension));
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const relative = `/assets/${name}.${hash.slice(0, 16)}.${extension}`;
  const file = path.join(target, relative);
  fs.writeFileSync(file, content);
  fs.writeFileSync(file + '.gz', zlib.gzipSync(content, { level: 9 }));
  fs.writeFileSync(file + '.br', zlib.brotliCompressSync(content));
  manifest[relative] = { sha256: hash, bytes: content.length };
  return relative;
}

// Extract declarations only, keeping state in its existing global scope. Classic
// scripts intentionally preserve legacy inline handlers and cross-module state.
const modules = {
  guru: [], research: [], ai: [], charts: [], chartResearch: [], comparison: [], overview: [],
  stocks: [], options: [], crypto: [], prediction: [], portfolio: [], trading: [], events: [], ops: [], tables: [],
};
const asyncWorkspaceGroups = [
  ['charts', /^loadEarlierCryptoKline$/],
  ['overview', /^(?:loadMarketOverview|loadCrossAssetCorrelation|loadResearchBriefing|loadCommandCenter)$/],
  ['research', /^(?:loadDecisionIntelligence|runBacktest|compareBacktests|runMonteCarlo|loadMarketResearch|runEventStudyUi)$/],
  ['charts', /^(?:performStockKlineLoad|loadEarlierStockKline|loadStockChartCompanion|loadStockChartEventRail|loadBinanceKlines|loadBinancePrices|loadBinanceDepth|loadBinanceTrades)$/],
  ['stocks', /^(?:loadGlobalMacroSpot|loadInsiderRadar|loadInstitutionalOwnership|loadAnalystConsensus|loadFundamentalQuality|loadShortInterest|loadEarningsCalendar|loadCotRadar|loadMarketScreener|loadStockSearch|loadStockWatchlistLibrary)$/],
  ['options', /^(?:loadOptions|loadOptionIvSnapshotHistory)$/],
  ['crypto', /^(?:loadFundingCarry|loadOrderFlowLiquidity|loadStablecoinLiquidity|loadPerpetualCrowding|loadBitcoinOnchain|loadDefiTvl|loadDefiProtocols|loadDefiYields|loadBinanceDashboard|loadBinancePortfolio|loadCryptoNews)$/],
  ['prediction', /^(?:loadPredictionRadar|loadForecastLab|loadMarketCompare|loadCalibration|loadCategories|loadCategoryCardStats|selectCategory|loadCategoryOrderbooks|togglePredictionSettlement|togglePredictionHistory)$/],
  ['portfolio', /^(?:loadPaperPortfolio|loadPortfolioRisk|loadScopedPaperPortfolio|loadPaperDriftStatus|loadOrders|loadPositions|loadPortfolioSnapshotHistory|loadDecisionPortfolioAttribution|loadPortfolioSummary|comparePortfolioSnapshotHistory|submitSellOrder|openSellModal)$/],
  ['trading', /^(?:loadTradeAssistant|loadAnalysis|loadRiskPatrol|preflightAssetBacktest|refreshBacktestCandidateFreshness)$/],
  ['events', /^(?:loadMarketTimeline|loadEventCalendar)$/],
  ['ops', /^(?:loadSourceSloPanel|loadOpsConsole|loadSourceHealth|loadMacroIndicators|loadNews|loadMacroCalendar|loadTelegramTestDeliveryHistory|loadTelegramResultCoverage|loadTelegramSettingsForm|testTelegramSettings|saveTelegramSettings|loadTreasuryYields|loadMarketSentiment|runGlobalSearchNow|loadAlertDeliveryFeedback)$/],
];
const syncWorkspaceGroups = [
  ['charts', /^(?:restrictedChartContext|renderAdvancedChartStrategyControls|setChartStrategyParameters|renderChartResearchTools)$/],
  ['overview', /^(?:renderWorkspaceDashboardCards|renderMarketChangeDigest)$/],
  ['stocks', /^(?:stockResearchFreshnessMarkup|workspaceTrendSvg)$/],
  ['ops', /^renderUiPreferencesForm$/],
  ['charts', /^(?:renderChartPatternControls|renderChartSignalMarkers|renderChartSignalList|renderChartSignalLifecycleControls)$/],
  ['prediction', /^attachPredictionRelationshipCheck$/],
  ['charts', /^(?:loadStockKline|stockKlineRequestKey|runStockKlineSingleFlight|drawCandles|drawStockKline|initCryptoChartHover|drawMACD|drawRSI|drawDepthChart|drawStockChartCompanion|buildStockStrategySignals|buildCryptoStrategySignals|handleChartSignalSelection|renderChartPatternMarkers|renderChartPatternList|renderChartStructureList|renderStockChartEventRail|stockChartEventInstrumentId|showStockChartEvidence|focusStockChartTimestamp|redrawStockChartEventMarkers|updateStockKlineFocusControl|setStockKlineViewState|focusStockKlineDate|enterStockIntraday)$/],
  ['stocks', /^(?:renderGlobalMacroSpot|renderAnalystConsensus|renderStockCapitalHistory|renderFundamentalQuality|renderMarketBreadth|renderInsiderRadar|renderInstitutionalOwnership|renderShortInterest|renderMarketScreener|renderInstrumentDetail)$/],
  ['overview', /^fetchMarketOverviewJson$/],
  ['options', /^(?:renderOptionChain|renderOptionStrategies|renderOptionPayoffBuilder|renderOptionIvTermStructure)$/],
  ['crypto', /^(?:renderDefiYieldQuality)$/],
  ['prediction', /^(?:renderPredictionRuleAudit|renderOutcomes|radarMarketCard|renderForecastLab|renderPredictionRadar|renderPredictionLibraryQuick|predictionSparkline|forecastLabGroupTable|renderPredictionSizingResult|selectPredictionLibraryEvent|categoryCardHtml|renderCategories|updateCategoryCard|observeCategoryCards|fetchJsonOrNull|runLimited|toggleConditions)$/],
  ['research', /^(?:renderDecisionPortfolio|renderReviewNotes|renderEventStudyResult|renderDecisionEvidence|renderDecisionEvidenceChanges|renderDecisionSignalQuality)$/],
  ['events', /^(?:renderEventCalendar|renderEventMonthGrid)$/],
  ['ops', /^(?:globalSearchCommands|renderGlobalSearchResults|renderSettingsForm|renderTelegramSettingsForm)$/],
  ['ai', /^(?:renderAiSettingsForm|syncAiRunnerVenueHint)$/],
];
// These async entry points are not needed to initialize the shell. Preserve
// their names and shared state, but discard calls whose context changes while
// the existing workspace bundle is loading (especially administrative writes).
const deferredActionGroups = [
  ['ops', /^(?:loadInstrumentSilences|loadAlerts|addAlert|removeAlert|retryAlertDelivery|ackAlertDelivery|setAlertDeliveryFeedback|loadNotifications|markAllRead|loadSettings|saveSetting|resetSettings|loadConnectionInfo|showWalletModal|testTelegram|testNotificationChannels|loadEconomicIndicators|runOpsJob|runCoverageCanaryFromUi|sendDailyReport|handleTelegramResultAction)$/],
  ['research', /^(?:saveDecisionRecordUi|runDecisionScenario|saveDecisionScenarioUi|saveCurrentDecisionWorkspace|shareDecisionWorkspace|generateDueDecisionReviews|retryDecisionSources|loadJournal|loadReviewNotes|saveNote|loadStrategies|resetStrategies)$/],
  ['ai', /^(?:saveAiSettings|saveAiKey|testAiProvider|pauseRunner|resumeRunner|stopRunner|resetRunnerCircuit)$/],
  ['prediction', /^(?:calculatePredictionSizing|resolveForecastLabCase)$/],
  ['overview', /^(?:loadOverview|loadNewsTicker)$/],
];
function splitWorkspaces(code) {
  const ast = ts.createSourceFile('dashboard.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const changes = [];
  for (const node of ast.statements) {
    if (!ts.isFunctionDeclaration(node) || !node.name) continue;
    const name = node.name.text;
    const isAsync = Boolean(node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.AsyncKeyword));
    const deferredGroup = isAsync ? deferredActionGroups.find(([, pattern]) => pattern.test(name))?.[0] : null;
    const group = /guru/i.test(name) ? 'guru' : /aiRunner/i.test(name) || name === 'loadAiMarketCommentary' ? 'ai'
      : /^(?:renderResearchEntryUi|loadResearchWorkspace|createResearchEntryUi|addResearchNoteUi|addResearchSnapshotUi|openEventResearchFromTimeline)$/.test(name) ? 'research'
        : isAsync ? asyncWorkspaceGroups.find(([, pattern]) => pattern.test(name))?.[0] || deferredGroup || null
          : syncWorkspaceGroups.find(([, pattern]) => pattern.test(name))?.[0] || null;
    if (!group) continue;
    modules[group].push(code.slice(node.getStart(ast), node.end));
    changes.push({ start: node.getStart(ast), end: node.end, body: `function ${name}(...args) { return window.MoneyWorkspaceModules.invoke('${group}', '${name}', args${deferredGroup ? ', true' : ''}); }` });
  }
  for (const change of changes.reverse()) code = code.slice(0, change.start) + change.body + code.slice(change.end);
  return code;
}

let html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
html = expandDashboardRuntime(html, source);
const lazyScripts = /<script\b[^>]*src="\/(?:restricted-strategy|restricted-chart|chart-strategies|chart-strategy-controls|chart-analysis|chart-research|chart-research-controls|live-kline|trading-chart|interactive-history|guru-replay|workflow-polish|action-research-workspace|professional-research|automatic-comparison|contracts-workspace)\.js[^"\s]*"[^>]*><\/script>/g;
html = html.replace(lazyScripts, '');
let number = 0;
const dashboardStartupParts = [];
let collectingDashboardStartup = false;
const dashboardStartupPlaceholder = '<!--__MONEYMONEY_DASHBOARD_STARTUP_BOOTSTRAP__-->';
let dashboardStartupPartNumber = 0;
html = html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) => `<link rel="stylesheet" href="${emit(`dashboard-style-${++number}`, css, 'css')}">`);
html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (tag, attributes, code) => {
  const isDashboardRuntime = /\bdata-dashboard-runtime\b/.test(attributes);
  const src = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
  if (isDashboardRuntime) {
    collectingDashboardStartup = true;
    dashboardStartupParts.push({ name: 'dashboard-startup-runtime', code: fs.readFileSync(path.join(source,'workspace-history.js'),'utf8')+'\n'+splitWorkspaces(code) });
    return dashboardStartupPlaceholder;
  }
  if (collectingDashboardStartup) {
    if (src) {
      const pathname = src.startsWith('/') ? src.split(/[?#]/, 1)[0] : '';
      const file = pathname ? path.join(source, pathname.slice(1)) : '';
      if (!file || !fs.existsSync(file)) return tag;
      const name = `dashboard-startup-${path.basename(pathname).replace(/\.js$/i, '')}`;
      dashboardStartupParts.push({ name, code: fs.readFileSync(file, 'utf8') });
      return '';
    }
    if (code.trim()) dashboardStartupParts.push({
      name: `dashboard-startup-inline-${++dashboardStartupPartNumber}`,
      code: splitWorkspaces(code),
    });
    return '';
  }
  if (/\bsrc\s*=/.test(attributes) || Buffer.byteLength(code) < 1500) return tag;
  const deferredAttributes = /\b(?:async|defer)\b/i.test(attributes) ? attributes : `${attributes} defer`;
  return `<script${deferredAttributes} src="${emit(`dashboard-${++number}`, splitWorkspaces(code), 'js')}"></script>`;
});
modules.guru.push(fs.readFileSync(path.join(source, 'guru-replay.js'), 'utf8'));
modules.tables.push(fs.readFileSync(path.join(source, 'table-tools.js'), 'utf8'));
modules.research.push(
  fs.readFileSync(path.join(source, 'restricted-strategy.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'workflow-polish.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'interactive-history.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'professional-research.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'action-research-workspace.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'ai-evaluation-workspace.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'restricted-validation-workspace.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'candidate-workspace.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'restricted-forward-workspace.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'strategy-builder-workspace.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'data-assets-workspace.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'research-projects-workspace.js'), 'utf8'),
);
modules.charts.push(
  fs.readFileSync(path.join(source, 'restricted-strategy.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'chart-strategies.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'chart-strategy-controls.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'chart-analysis.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'restricted-chart.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'chart-research-lazy.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'live-kline.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'trading-chart.js'), 'utf8'),
);
modules.comparison.push(fs.readFileSync(path.join(source, 'automatic-comparison.js'), 'utf8'));
modules.chartResearch.push(
  fs.readFileSync(path.join(source, 'chart-research.js'), 'utf8'),
  fs.readFileSync(path.join(source, 'chart-research-controls.js'), 'utf8'),
);
modules.portfolio.push(fs.readFileSync(path.join(source, 'watchlist-metadata.js'), 'utf8'));
if (!dashboardStartupParts.length) throw new Error('Dashboard startup runtime was not collected');
const dashboardStartupUrls = dashboardStartupParts.map(part => emit(part.name, part.code, 'js'));
// Download public immutable code during auth; the gated loader still controls execution.
// Reuse the existing credentialed status fetch; no private workspace API is prefetched here.
html = html.replace(/<head>/i, `<head><link rel="preload" as="fetch" href="/api/auth/status" crossorigin="use-credentials"><link rel="preload" as="script" data-dashboard-core-preload href="${dashboardStartupUrls[0]}">`);
const dashboardBootstrap = `(function(){\n'use strict';\nlet started=false;\nfunction loadScript(src){return new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=src;script.async=true;script.dataset.dashboardStartup='true';script.onload=resolve;script.onerror=()=>reject(new Error('页面功能脚本加载失败'));document.head.append(script);});}\nfunction showFailure(){const banner=document.getElementById('network-status-banner');if(banner){banner.hidden=false;banner.textContent='页面功能脚本加载失败，请刷新重试';}else console.error('MoneyMoney dashboard startup bundle failed to load');}\nasync function start(){\n  if(started)return;started=true;\n  let authReady=window.mm_authReady;\n  if(!authReady||typeof authReady.then!=='function') await new Promise(resolve=>{\n    const ready=()=>resolve();\n    window.addEventListener('mm-auth-client-ready',ready,{once:true});\n    if(document.readyState==='complete') ready(); else window.addEventListener('load',ready,{once:true});\n  });\n  authReady=window.mm_authReady;\n  if(authReady&&typeof authReady.then==='function') await Promise.resolve(authReady).catch(()=>null);\n  try{\n    const sources=${JSON.stringify(dashboardStartupUrls)};\n    if(sources.length) await loadScript(sources[0]);\n    if(window.mm_dashboardReady) await Promise.resolve(window.mm_dashboardReady).catch(()=>null);\n    for(const src of sources.slice(1)) await loadScript(src);\n    window.dispatchEvent(new CustomEvent('mm-dashboard-runtime-loaded'));\n  }catch(error){showFailure();}\n}\nvoid start();\n})();`;
const dashboardBootstrapParallel = dashboardBootstrap
  .replace('function loadScript(src){', 'function loadScript(src,ordered=false){')
  .replace('script.async=true;', 'script.async=ordered?false:true;')
  .replace('for(const src of sources.slice(1)) await loadScript(src);', 'await Promise.all(sources.slice(1).map(src=>loadScript(src,true)));');
if (dashboardBootstrapParallel === dashboardBootstrap) throw new Error('Dashboard ordered startup loader was not generated');
const dashboardBootstrapReady = dashboardBootstrapParallel
  .replace(
    'if(window.mm_dashboardReady) await Promise.resolve(window.mm_dashboardReady).catch(()=>null);',
    "if(window.mm_dashboardReady) await Promise.resolve(window.mm_dashboardReady).catch(()=>null);window.mm_dashboardCoreReady=true;window.dispatchEvent(new Event('mm-dashboard-core-ready'));",
  )
  .replace(
    "await Promise.all(sources.slice(1).map(src=>loadScript(src,true)));\n    window.dispatchEvent(new CustomEvent('mm-dashboard-runtime-loaded'));",
    "const optionalPattern=/dashboard-startup-(?:experience-enhancements|practical-experience)\\./;const immediate=sources.slice(1).filter(src=>!optionalPattern.test(src));const deferred=sources.slice(1).filter(src=>optionalPattern.test(src));if(immediate.length)await Promise.all(immediate.map(src=>loadScript(src,true)));window.dispatchEvent(new CustomEvent('mm-dashboard-runtime-loaded'));const loadDeferred=()=>Promise.all(deferred.map(src=>loadScript(src,true))).catch(()=>showFailure());if(deferred.length){if(typeof requestIdleCallback==='function')requestIdleCallback(()=>{void loadDeferred();},{timeout:1200});else setTimeout(()=>{void loadDeferred();},0);}",
  );
const dashboardBootstrapSafe = dashboardBootstrapReady.replace('const sources=', `const loader=document.querySelector('script[data-workspace-loader]');
    if(loader&&!window.MoneyWorkspaceModules)await new Promise((resolve,reject)=>{
      const failed=()=>{cleanup();reject(new Error('工作区加载器下载失败'));};
      const loaded=()=>{if(!window.MoneyWorkspaceModules)return failed();cleanup();resolve();};
      const cleanup=()=>{loader.removeEventListener('load',loaded);loader.removeEventListener('error',failed);};
      if(loader.dataset.loadState==='failed')return failed();
      loader.addEventListener('load',loaded,{once:true});loader.addEventListener('error',failed,{once:true});
    });
    const sources=`);
const dashboardBootstrapUrl = emit('dashboard-startup-bootstrap', dashboardBootstrapSafe, 'js');
html = html.replace(dashboardStartupPlaceholder, `<script defer src="${dashboardBootstrapUrl}"></script>`);
if (html.includes(dashboardStartupPlaceholder)) throw new Error('Dashboard startup bootstrap placeholder was not replaced');
const moduleUrls = Object.fromEntries(Object.entries(modules).map(([group, code]) => [group, emit(`workspace-${group}`, code.join('\n'), 'js')]));
moduleUrls.contracts = emit('workspace-contracts', fs.readFileSync(path.join(source, 'contracts-workspace.js')), 'js');
const styleUrls = {
  research: emit('workspace-research-style', fs.readFileSync(path.join(source, 'action-research-workspace.css')), 'css'),
  contracts: emit('workspace-contracts-style', fs.readFileSync(path.join(source, 'contracts-workspace.css')), 'css'),
};
html = html.replace(/<link\b[^>]*href="\/(?:action-research-workspace|contracts-workspace)\.css[^"\s]*"[^>]*>/g, '');

const fingerprinted = new Map();
html = html.replace(/(src|href)="(\/[^"?]+\.(?:js|css))(?:\?[^"\s]*)?"/g, (tag, attribute, url) => {
  if (url.startsWith('/assets/')) return tag;
  const file = path.join(source, url);
  if (!fs.existsSync(file)) throw new Error(`Unknown dashboard resource ${url}`);
  if (!fingerprinted.has(url)) fingerprinted.set(url, emit(path.basename(url).replace(/\.(js|css)$/, ''), fs.readFileSync(file), path.extname(url).slice(1)));
  return `${attribute}="${fingerprinted.get(url)}"`;
});
const workspaceContracts = require('../dist/features/market-workspace').workspaceAssetContracts();
for(const contract of Object.values(workspaceContracts))for(const group of contract.modules)if(!moduleUrls[group])throw new Error(`Unknown workspace module ${group}`);
const loaderManifest = { modules: moduleUrls, styles: styleUrls, workspaceContracts };
const loader = fs.readFileSync(path.join(source, 'modules', 'workspace-loader.js'), 'utf8').replace('__WORKSPACE_MANIFEST__', JSON.stringify(loaderManifest));
// This loader only starts authenticated reads/preloads. Its existing core gate
// still prevents DOM-dependent workspace code from evaluating before startup.
html = html.replace(/<link\b[^>]*rel="stylesheet"/, tag => `<script async data-workspace-loader onerror="this.dataset.loadState='failed'" src="${emit('workspace-loader', loader, 'js')}"></script>\n${tag}`);
html = html.replace(/<script\b([^>]*)>/gi, (tag, attributes) => {
  if (!/\bsrc\s*=/.test(attributes) || /\b(?:async|defer)\b/i.test(attributes) || /\btype\s*=\s*["']module["']/i.test(attributes)) return tag;
  return `<script${attributes} defer>`;
});
for (const sourceOnlyFile of ['modules/dashboard-runtime.js', 'modules/dashboard-base.css']) {
  fs.rmSync(path.join(target, sourceOnlyFile), { force: true });
}
fs.writeFileSync(path.join(target, 'index.html'), deferStockChartMarkup(html));
fs.writeFileSync(path.join(target, 'asset-manifest.json'), JSON.stringify(manifest, null, 2));
for (const page of ['index.html', 'login.html']) {
  const file = path.join(target, page);
  const content = fs.readFileSync(file);
  fs.writeFileSync(file + '.gz', zlib.gzipSync(content, { level: 9 }));
  fs.writeFileSync(file + '.br', zlib.brotliCompressSync(content));
}
console.log(`Web assets built: ${Object.keys(manifest).length} hashed/precompressed resources; overview, market, research, AI and contracts load on demand`);
