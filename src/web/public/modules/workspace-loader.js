(function () {
  'use strict';
  const manifest = __WORKSPACE_MANIFEST__;
  const modules = manifest.modules || manifest;
  const styles = manifest.styles || {};
  const pending = new Map();
  const pendingStyles = new Map();
  const preloadedScripts = new Set();
  const stockKlinePeriods = new Set(['1m', '5m', '15m', '1h', '1d', '3d', '5d', '60d', '120d', '1y', '5y']);
  const pendingStockKlines = new Map();
  let initialStockKlineRequest = null;
  let initialStockKlinePrefetchStarted = false;
  let dashboardAuthGate = null;
  let dashboardCoreGate = null;

  function normalizeStockKlinePeriod(value) {
    const period = String(value || '').trim().toLowerCase();
    return stockKlinePeriods.has(period) ? period : '5m';
  }

  function initialStockKlineRequestFromLocation() {
    const params = new URLSearchParams(location.search);
    if (params.get('market') !== 'stocks' || params.get('workspace') !== 'stock-quotes'
      || params.has('sharedWorkspace') || ['asOf', 'focusDate', 'date'].some(key => params.has(key))) return null;
    const raw = String(params.get('instrument') || '').trim();
    if (!raw) return null;
    const symbol = raw.replace(/^stock:us:/i, '').replace(/^us/i, '').toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return null;
    try {
      if (localStorage.getItem(`moneymoney:kline-as-of:us${symbol}`)) return null;
    } catch {}
    const period = normalizeStockKlinePeriod(params.get('timeframe'));
    const query = new URLSearchParams({ symbol: `us${symbol}`, period, interval: period, adjustment: 'source' });
    if (['1m', '5m', '15m', '1h', '1d'].includes(period)) query.set('chartWindow', '1');
    return { instrument: `stock:us:${symbol}`, symbol: `us${symbol}`, period, url: `/api/stock/kline?${query}` };
  }

  window.MoneyStockKlinePrefetch = {
    normalizePeriod: normalizeStockKlinePeriod,
    start(url) {
      const key = String(url);
      const existing = pendingStockKlines.get(key);
      if (existing) return existing.promise;
      const controller = new AbortController();
      const promise = fetch(key, { credentials: 'include', cache: 'no-store', signal: controller.signal })
        .then(async response => ({ ok: response.ok, status: response.status, body: await response.json() }))
        .catch(error => ({ ok: false, status: 0, body: null, error }));
      pendingStockKlines.set(key, { controller, promise });
      return promise;
    },
    take(url) {
      const entry = pendingStockKlines.get(String(url));
      if (!entry) return null;
      pendingStockKlines.delete(String(url));
      return { promise: entry.promise, abort: () => entry.controller.abort() };
    },
    invalidate() {
      for (const entry of pendingStockKlines.values()) entry.controller.abort();
      pendingStockKlines.clear();
      initialStockKlineRequest = null;
    },
  };

  window.addEventListener('mm-workspace-context', event => {
    if (!initialStockKlineRequest) return;
    const context = event.detail || {};
    const instrument = String(context.instrument || '').trim().toUpperCase();
    if (context.market !== 'stocks' || context.workspace !== 'stock-quotes'
      || instrument !== initialStockKlineRequest.instrument.toUpperCase()) {
      window.MoneyStockKlinePrefetch.invalidate();
    }
  });

  function prefetchInitialStockKline() {
    if (initialStockKlinePrefetchStarted) return;
    initialStockKlinePrefetchStarted = true;
    if (typeof fetch !== 'function') return;
    initialStockKlineRequest = initialStockKlineRequestFromLocation();
    if (!initialStockKlineRequest) return;
    markMmPerformanceStage('stock-kline-prefetch-start');
    window.MoneyStockKlinePrefetch.start(initialStockKlineRequest.url);
  }

  function markMmPerformanceStage(name) {
    if (window.__MM_PERFORMANCE_TRACE__ === true && window.performance?.mark) {
      window.performance.mark(`moneymoney:${name}`);
    }
  }

  function shouldPreloadInitialStockChart(group) {
    if (group !== 'charts') return false;
    const params = new URLSearchParams(location.search);
    return params.get('market') === 'stocks'
      && params.get('workspace') === 'stock-quotes'
      && !params.has('sharedWorkspace');
  }

  function preloadScript(group) {
    const src = modules[group];
    if (!src || preloadedScripts.has(src)) return;
    preloadedScripts.add(src);
    const link = document.createElement('link');
    link.rel = 'preload';
    link.setAttribute('as', 'script');
    link.href = src;
    link.dataset.workspacePreload = group;
    if (group === 'charts') markMmPerformanceStage('chart-preload-start');
    link.onload = () => { if (group === 'charts') markMmPerformanceStage('chart-preload-ready'); };
    link.onerror = () => {
      link.remove();
      preloadedScripts.delete(src);
      if (group === 'charts') markMmPerformanceStage('chart-preload-failed');
    };
    document.head.append(link);
  }

  function waitForDashboardAuth() {
    if (dashboardAuthGate) return dashboardAuthGate;
    dashboardAuthGate = (async () => {
      let authReady = window.mm_authReady;
      if (!authReady || typeof authReady.then !== 'function') {
        await new Promise(resolve => {
          const ready = () => resolve();
          window.addEventListener('mm-auth-client-ready', ready, { once: true });
          if (document.readyState === 'complete') ready();
          else window.addEventListener('load', ready, { once: true });
        });
        authReady = window.mm_authReady;
      }
      if (authReady && typeof authReady.then === 'function') {
        await Promise.resolve(authReady).catch(() => null);
      }
    })();
    return dashboardAuthGate;
  }

  function waitForDashboardCore() {
    if (window.mm_dashboardCoreReady === true) {
      markMmPerformanceStage('dashboard-core-ready');
      return Promise.resolve();
    }
    if (!dashboardCoreGate) {
      dashboardCoreGate = new Promise(resolve => {
        window.addEventListener('mm-dashboard-core-ready', () => {
          markMmPerformanceStage('dashboard-core-ready');
          resolve();
        }, { once: true });
      });
    }
    return dashboardCoreGate;
  }

  function ensureStyle(group) {
    const href = styles[group];
    if (!href) return Promise.resolve();
    if (pendingStyles.has(group)) return pendingStyles.get(group);
    const promise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.workspaceStyle = group;
      link.onload = resolve;
      link.onerror = () => {
        link.remove();
        pendingStyles.delete(group);
        reject(new Error('工作区样式加载失败，请重试'));
      };
      document.head.append(link);
    });
    pendingStyles.set(group, promise);
    return promise;
  }

  function loadScript(group) {
    const src = modules[group];
    if (!src) return Promise.reject(new Error('没有配置此工作区资源'));
    if (group === 'charts') markMmPerformanceStage('chart-module-start');
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.workspaceGroup = group;
      script.onload = () => {
        if (group === 'charts') markMmPerformanceStage('chart-module-ready');
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('工作区加载失败，请重试'));
      };
      document.head.append(script);
    });
  }

  function ensure(group) {
    if (pending.has(group)) return pending.get(group);
    const promise = (async () => {
      // A classic deferred loader can run before the module auth client has
      // assigned mm_authReady. Wait for DOMContentLoaded in that case, then
      // await the session check and core dashboard startup before evaluating a workspace bundle.
      await waitForDashboardAuth();
      markMmPerformanceStage('auth-ready');
      if (shouldPreloadInitialStockChart(group)) {
        preloadScript(group);
        prefetchInitialStockKline();
      }
      await waitForDashboardCore();
      if (group === 'contracts') await ensure('charts');
      await ensureStyle(group);
      await loadScript(group);
      window.dispatchEvent(new CustomEvent('mm-workspace-modules-ready', { detail: { group } }));
    })();
    pending.set(group, promise);
    promise.catch(() => { if (pending.get(group) === promise) pending.delete(group); });
    return promise;
  }

  window.MoneyWorkspaceModules = {
    ensure,
    groupsForWorkspace,
    async invoke(group, name, args) {
      try { await ensure(group); return window[name](...args); }
      catch (error) { window.showToast?.(error.message || '工作区加载失败，请重试', 'error'); throw error; }
    },
  };

  function groupsForWorkspace(market, id) {
    if (id === 'overview') return ['overview'];
    if (id === 'guru-holdings') return ['guru', 'tables'];
    if (id === 'contracts' && market === 'crypto') return ['charts', 'contracts', 'tables'];
    if (id === 'events') return ['events'];
    if (id === 'stock-quotes' && market === 'stocks') return ['charts'];
    if (id === 'crypto-quotes' && market === 'crypto') return ['charts', 'crypto'];
    if (['breadth', 'insider', 'institutional', 'analyst', 'fundamentals', 'short-interest'].includes(id) && market === 'stocks') return ['stocks', 'tables'];
    if (['option-chain', 'volatility', 'greeks'].includes(id) && market === 'options') return ['options', 'tables'];
    if (['funding-rate', 'open-interest', 'on-chain', 'order-flow'].includes(id) && market === 'crypto') return ['crypto', 'tables'];
    if (id === 'prediction-radar' && market === 'prediction') return ['prediction'];
    if (['research-lab', 'action-center', 'decision-intelligence', 'screener', 'backtest', 'risk', 'fundamentals'].includes(id)) return ['research', 'tables'];
    if (['watchlist', 'positions', 'paper', 'orders'].includes(id)) return id === 'paper' ? ['portfolio', 'ai', 'tables'] : ['portfolio', 'tables'];
    if (id === 'analysis') return ['trading'];
    return [];
  }

  const initialParams = new URLSearchParams(location.search);
  const initialWorkspace = initialParams.get('workspace');
  const initialMarket = initialParams.get('market');
  if (initialWorkspace && !initialParams.has('sharedWorkspace')) {
    for (const group of groupsForWorkspace(initialMarket, initialWorkspace)) ensure(group).catch(() => {});
  }

  window.addEventListener('mm-workspace-context', event => {
    const id = event.detail?.workspace || '';
    const market = event.detail?.market || '';
    for (const group of groupsForWorkspace(market, id)) ensure(group).catch(error => window.showToast?.(error.message, 'error'));
  });
})();
