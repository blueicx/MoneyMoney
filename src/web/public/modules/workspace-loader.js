(function () {
  'use strict';
  const manifest = __WORKSPACE_MANIFEST__;
  const modules = manifest.modules || manifest;
  const styles = manifest.styles || {};
  const pending = new Map();
  const pendingStyles = new Map();
  const preloadedScripts = new Set();
  let dashboardAuthGate = null;
  let dashboardCoreGate = null;

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
      if (shouldPreloadInitialStockChart(group)) preloadScript(group);
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
    async invoke(group, name, args) {
      try { await ensure(group); return window[name](...args); }
      catch (error) { window.showToast?.(error.message || '工作区加载失败，请重试', 'error'); throw error; }
    },
  };

  function groupsForWorkspace(market, id) {
    if (id === 'overview') return ['overview'];
    if (id === 'guru-holdings') return ['guru'];
    if (id === 'contracts' && market === 'crypto') return ['charts', 'contracts'];
    if (id === 'events') return ['events'];
    if (id === 'stock-quotes' && market === 'stocks') return ['charts'];
    if (id === 'crypto-quotes' && market === 'crypto') return ['charts', 'crypto'];
    if (['breadth', 'insider', 'institutional', 'analyst', 'fundamentals', 'short-interest'].includes(id) && market === 'stocks') return ['stocks'];
    if (['option-chain', 'volatility', 'greeks'].includes(id) && market === 'options') return ['options'];
    if (['funding-rate', 'open-interest', 'on-chain', 'order-flow'].includes(id) && market === 'crypto') return ['crypto'];
    if (id === 'prediction-radar' && market === 'prediction') return ['prediction'];
    if (['research-lab', 'action-center', 'decision-intelligence', 'screener', 'backtest', 'risk', 'fundamentals'].includes(id)) return ['research'];
    if (['watchlist', 'positions', 'paper', 'orders'].includes(id)) return id === 'paper' ? ['portfolio', 'ai'] : ['portfolio'];
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
